import { randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { captureSnapshot } from "../snapshot/snapshot-service.js";
import { buildAcquisitionAttempt } from "./acquisition.js";
import { resolveChromiumExecutablePath } from "./browser-executable.js";
import type {
	AuthBrowserFetchImpl,
	AuthBrowserFetchInput,
	AuthBrowserFetchResult,
	SourceCaptureInput,
	SourceCaptureResult,
	SourcePlatform,
} from "./types.js";
import {
	cleanXiaohongshuExtractedText,
	mapFailureCodeToSourceStatus,
	mapSnapshotFailureToReasonCode,
} from "./utils.js";

const DEFAULT_AUTH_BROWSER_TIMEOUT_MS = 15_000;
const DEFAULT_AUTH_BROWSER_CONTENT_TYPE = "text/html; charset=utf-8";

function validateStorageStateJson(storageStateJson: string): void {
	let parsed: unknown;
	try {
		parsed = JSON.parse(storageStateJson);
	} catch {
		throw new Error("Invalid auth storage state JSON");
	}
	if (typeof parsed !== "object" || parsed === null) {
		throw new Error("Invalid auth storage state JSON");
	}
}

async function defaultAuthBrowserFetch(input: AuthBrowserFetchInput): Promise<AuthBrowserFetchResult> {
	validateStorageStateJson(input.storageStateJson);
	const storageStateFilePath = join(tmpdir(), `sonder-auth-storage-state-${randomUUID()}.json`);
	writeFileSync(storageStateFilePath, input.storageStateJson, "utf8");
	const executablePath = resolveChromiumExecutablePath(undefined);
	const browser = await chromium.launch({ headless: true, executablePath });
	try {
		const context = await browser.newContext({
			storageState: storageStateFilePath,
		});
		try {
			const page = await context.newPage();
			const redirectChain: string[] = [];
			page.on("framenavigated", (frame) => {
				if (frame !== page.mainFrame()) {
					return;
				}
				const nextUrl = frame.url();
				if (redirectChain.at(-1) === nextUrl) {
					return;
				}
				redirectChain.push(nextUrl);
			});

			const navigationResponse = await page.goto(input.url, {
				waitUntil: "domcontentloaded",
				timeout: DEFAULT_AUTH_BROWSER_TIMEOUT_MS,
			});
			await page.waitForTimeout(500);
			const html = await page.content();
			const responseHeaders = navigationResponse?.headers() ?? {};
			return {
				httpStatus: navigationResponse?.status() ?? 200,
				contentType: responseHeaders["content-type"] ?? null,
				finalUrl: page.url(),
				redirectChain,
				html,
			};
		} finally {
			await context.close();
		}
	} finally {
		await browser.close();
		rmSync(storageStateFilePath, { force: true });
	}
}

function toBrowserFetchImpl(input: SourceCaptureInput): AuthBrowserFetchImpl {
	return input.authBrowserFetchImpl ?? defaultAuthBrowserFetch;
}

function includesStrongVerificationSignals(text: string): boolean {
	const normalized = text.toLowerCase();
	return (
		normalized.includes("human verification") ||
		normalized.includes("captcha") ||
		normalized.includes("security verification") ||
		normalized.includes("verify you are human") ||
		normalized.includes("验证后即可继续访问") ||
		normalized.includes("环境异常")
	);
}

function looksLikeTwitterLoginWall(text: string): boolean {
	const normalized = text.toLowerCase();
	return (
		normalized.includes("log in to x") || normalized.includes("join x today") || normalized.includes("sign in to x")
	);
}

function looksLikeRedditLoginWall(text: string): boolean {
	const normalized = text.toLowerCase();
	return (
		normalized.includes("log in to reddit") ||
		normalized.includes("continue in browser") ||
		normalized.includes("you must be logged in")
	);
}

function isRedditUrl(url: string): boolean {
	try {
		return new URL(url).hostname.toLowerCase().includes("reddit.com");
	} catch {
		return false;
	}
}

function looksLikeXiaohongshuLoginWall(text: string): boolean {
	const normalized = text.toLowerCase();
	const cleaned = cleanXiaohongshuExtractedText(text);
	const hasLoginPhrase =
		normalized.includes("请登录") ||
		normalized.includes("登录后") ||
		normalized.includes("去登录") ||
		normalized.includes("扫码登录") ||
		normalized.includes("login");
	if (!hasLoginPhrase) {
		return false;
	}
	// Legitimate XHS pages frequently contain incidental login text.
	// Treat it as wall only when cleaned readable content is still very thin.
	return cleaned.length < 120;
}

function looksLikeAuthWall(
	platform: SourcePlatform,
	effectiveUrl: string,
	html: string,
	extractedText: string,
): boolean {
	const haystack = `${html}\n${extractedText}`;
	if (includesStrongVerificationSignals(haystack)) {
		return true;
	}
	if (platform === "twitter") {
		return looksLikeTwitterLoginWall(haystack);
	}
	if (platform === "web" && isRedditUrl(effectiveUrl)) {
		return looksLikeRedditLoginWall(haystack);
	}
	if (platform === "xiaohongshu") {
		return looksLikeXiaohongshuLoginWall(haystack);
	}
	return false;
}

export async function captureFromAuthBrowser(
	input: SourceCaptureInput & { platform: SourcePlatform; storageStateJson: string },
): Promise<SourceCaptureResult> {
	const fetchInBrowser = toBrowserFetchImpl(input);
	let browserResult: AuthBrowserFetchResult | null = null;
	let browserFailureReason: string | null = null;

	try {
		browserResult = await fetchInBrowser({
			url: input.url,
			storageStateJson: input.storageStateJson,
		});
	} catch (error) {
		browserFailureReason = error instanceof Error ? error.message : String(error);
	}

	const snapshot = await captureSnapshot({
		itemId: input.itemId,
		url: browserResult?.finalUrl ?? input.url,
		dataRootDir: input.dataRootDir,
		skipLoginWallDetection: true,
		fetchImpl: browserResult
			? async () =>
					new Response(browserResult.html, {
						status: 200,
						headers: {
							"content-type": browserResult.contentType ?? DEFAULT_AUTH_BROWSER_CONTENT_TYPE,
						},
					})
			: async () => {
					throw new Error(`AUTH_BROWSER_FETCH_FAILED: ${browserFailureReason ?? "unknown error"}`);
				},
	});

	let status = mapFailureCodeToSourceStatus(snapshot.failureCode);
	let reason = snapshot.failureReason;
	let reasonCode = mapSnapshotFailureToReasonCode(snapshot.failureCode, snapshot.failureReason);
	if (status === "ok" && browserResult) {
		const extractedText = readFileSync(snapshot.extractedTextPath, "utf8");
		if (looksLikeAuthWall(input.platform, browserResult.finalUrl, browserResult.html, extractedText)) {
			status = "login_required";
			reason = "AUTH_SESSION_NOT_EFFECTIVE: authenticated browser still returned login-gated content";
			reasonCode = "AUTH_SESSION_NOT_EFFECTIVE";
		}
	}
	const reasonHint = reason ?? browserFailureReason;
	const attempt = buildAcquisitionAttempt({
		method: "auth_browser_fetch",
		inputUrl: input.url,
		effectiveUrl: browserResult?.finalUrl ?? input.url,
		status,
		reasonCode,
		reasonHint,
		debug: {
			httpStatus: browserResult?.httpStatus ?? null,
			contentType: browserResult?.contentType ?? null,
			finalUrl: browserResult?.finalUrl ?? null,
			redirectChain: browserResult?.redirectChain ?? [],
		},
		snapshot,
	});

	return {
		platform: input.platform,
		status,
		reason,
		reasonCode,
		reasonHint,
		debug: attempt.debug,
		usable: status === "ok",
		snapshot,
		acquisitionMethod: "auth_browser_fetch",
		attempts: [attempt],
	};
}
