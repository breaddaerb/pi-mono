import { readFileSync } from "node:fs";
import { captureSnapshot } from "../snapshot/snapshot-service.js";
import { buildAcquisitionAttempt } from "./acquisition.js";
import type { SourceAdapter, SourceCaptureInput, SourceCaptureResult, SourceStatus } from "./types.js";
import { mapFailureCodeToSourceStatus, mapSnapshotFailureToReasonCode } from "./utils.js";
import { fetchWechatInBrowser } from "./wechat-browser.js";
import {
	fetchWechatWithTrace,
	WECHAT_ANDROID_CHROME_PROFILE,
	WECHAT_IOS_SAFARI_PROFILE,
	WechatCookieJar,
	type WechatFetchProfile,
	type WechatHttpTrace,
} from "./wechat-http.js";
import { detectWechatRiskControl } from "./wechat-risk-control.js";

const MIN_WECHAT_EXTRACTED_TEXT_LENGTH = 240;
const WECHAT_BROWSER_EXECUTABLE_PATH_ENV = "SONDER_WECHAT_BROWSER_EXECUTABLE_PATH";
const WECHAT_BROWSER_TIMEOUT_MS_ENV = "SONDER_WECHAT_BROWSER_TIMEOUT_MS";

function toDebug(trace: WechatHttpTrace | null): SourceCaptureResult["debug"] {
	if (!trace) {
		return null;
	}
	return {
		httpStatus: trace.httpStatus,
		contentType: trace.contentType,
		finalUrl: trace.finalUrl,
		redirectChain: [...trace.redirectChain],
	};
}

function classifyWechatHttpStatus(httpStatus: number): SourceCaptureResult["status"] {
	if (httpStatus === 403) {
		return "forbidden";
	}
	if (httpStatus === 404) {
		return "not_found";
	}
	return "error";
}

function readWechatBrowserTimeoutMs(env: NodeJS.ProcessEnv): number | undefined {
	const raw = env[WECHAT_BROWSER_TIMEOUT_MS_ENV];
	if (!raw) {
		return undefined;
	}
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return undefined;
	}
	return parsed;
}

function shouldAttemptWechatBrowserFallback(status: SourceStatus): boolean {
	return status === "risk_control" || status === "login_required" || status === "forbidden";
}

function looksLikeWechatLoginWallText(text: string): boolean {
	const normalized = text.toLowerCase();
	const hasStrongCaptchaSignals =
		normalized.includes("环境异常") ||
		normalized.includes("去验证") ||
		normalized.includes("验证后即可继续访问") ||
		normalized.includes("human verification") ||
		normalized.includes("captcha");
	if (hasStrongCaptchaSignals) {
		return true;
	}
	const hasLoginSignals =
		normalized.includes("please log in") ||
		normalized.includes("please login") ||
		normalized.includes("sign in") ||
		normalized.includes("log in") ||
		normalized.includes("login") ||
		normalized.includes("请登录") ||
		normalized.includes("登录");
	if (!hasLoginSignals) {
		return false;
	}
	const compactLength = normalized.replaceAll(/\s+/g, " ").trim().length;
	return compactLength < MIN_WECHAT_EXTRACTED_TEXT_LENGTH;
}

function buildWechatCaptureResult(input: {
	url: string;
	method: "direct_fetch" | "browser_fetch";
	snapshot: SourceCaptureResult["snapshot"];
	status: SourceCaptureResult["status"];
	reason: string | null;
	reasonCode: string | null;
	reasonHint: string | null;
	debug: SourceCaptureResult["debug"];
}): SourceCaptureResult {
	const effectiveUrl = input.debug?.finalUrl ?? input.url;
	const attempt = buildAcquisitionAttempt({
		method: input.method,
		inputUrl: input.url,
		effectiveUrl,
		status: input.status,
		reasonCode: input.reasonCode,
		reasonHint: input.reasonHint,
		debug: input.debug,
		snapshot: input.snapshot,
	});
	return {
		platform: "wechat",
		status: input.status,
		reason: input.reason,
		reasonCode: input.reasonCode,
		reasonHint: input.reasonHint,
		debug: input.debug,
		usable: input.status === "ok",
		snapshot: input.snapshot,
		acquisitionMethod: input.method,
		attempts: [attempt],
	};
}

function evaluateWechatSnapshot(input: {
	url: string;
	method: "direct_fetch" | "browser_fetch";
	snapshot: SourceCaptureResult["snapshot"];
	trace: WechatHttpTrace | null;
}): SourceCaptureResult {
	if (input.trace) {
		const riskControl = detectWechatRiskControl(input.trace);
		if (riskControl.isRiskControl) {
			return buildWechatCaptureResult({
				url: input.url,
				method: input.method,
				snapshot: input.snapshot,
				status: "risk_control",
				reason: riskControl.reasonHint,
				reasonCode: riskControl.reasonCode,
				reasonHint: riskControl.reasonHint,
				debug: toDebug(input.trace),
			});
		}
	}

	const status = mapFailureCodeToSourceStatus(input.snapshot.failureCode);
	if (status !== "ok") {
		const reasonCode = mapSnapshotFailureToReasonCode(input.snapshot.failureCode, input.snapshot.failureReason);
		const httpStatus = input.trace?.httpStatus;
		const resolvedStatus = httpStatus === 403 || httpStatus === 404 ? classifyWechatHttpStatus(httpStatus) : status;
		return buildWechatCaptureResult({
			url: input.url,
			method: input.method,
			snapshot: input.snapshot,
			status: resolvedStatus,
			reason: input.snapshot.failureReason,
			reasonCode,
			reasonHint: input.snapshot.failureReason,
			debug: toDebug(input.trace),
		});
	}

	const extracted = readFileSync(input.snapshot.extractedTextPath, "utf8");
	if (looksLikeWechatLoginWallText(extracted)) {
		const reason = "WeChat returned login-gated content instead of article text.";
		return buildWechatCaptureResult({
			url: input.url,
			method: input.method,
			snapshot: input.snapshot,
			status: "login_required",
			reason,
			reasonCode: "WECHAT_LOGIN_WALL",
			reasonHint: reason,
			debug: toDebug(input.trace),
		});
	}

	if (extracted.trim().length < MIN_WECHAT_EXTRACTED_TEXT_LENGTH) {
		const reason = "WeChat response is too short to be reliable evidence.";
		return buildWechatCaptureResult({
			url: input.url,
			method: input.method,
			snapshot: input.snapshot,
			status: "unsupported",
			reason,
			reasonCode: "WECHAT_CONTENT_TOO_SHORT",
			reasonHint: reason,
			debug: toDebug(input.trace),
		});
	}

	return buildWechatCaptureResult({
		url: input.url,
		method: input.method,
		snapshot: input.snapshot,
		status: "ok",
		reason: null,
		reasonCode: null,
		reasonHint: null,
		debug: toDebug(input.trace),
	});
}

export class WechatSourceAdapter implements SourceAdapter {
	private async captureWithProfile(
		input: SourceCaptureInput,
		profile: WechatFetchProfile,
		cookieJar: WechatCookieJar,
	): Promise<{ snapshot: Awaited<ReturnType<typeof captureSnapshot>>; trace: WechatHttpTrace }> {
		let trace: WechatHttpTrace | null = null;
		const snapshot = await captureSnapshot({
			itemId: input.itemId,
			url: input.url,
			dataRootDir: input.dataRootDir,
			fetchImpl: async (_url, _init) => {
				trace = await fetchWechatWithTrace({
					url: input.url,
					fetchImpl: input.fetchImpl,
					profile,
					cookieJar,
					maxRedirects: 5,
				});
				return new Response(trace.body, {
					status: trace.httpStatus,
					headers: trace.responseHeaders,
				});
			},
		});
		if (!trace) {
			throw new Error("WECHAT_TRACE_MISSING: no response trace captured");
		}
		return { snapshot, trace };
	}

	private async captureWithBrowser(input: SourceCaptureInput): Promise<SourceCaptureResult> {
		let trace: WechatHttpTrace | null = null;
		const snapshot = await captureSnapshot({
			itemId: input.itemId,
			url: input.url,
			dataRootDir: input.dataRootDir,
			skipLoginWallDetection: true,
			fetchImpl: async () => {
				trace = await fetchWechatInBrowser({
					url: input.url,
					executablePath: process.env[WECHAT_BROWSER_EXECUTABLE_PATH_ENV],
					timeoutMs: readWechatBrowserTimeoutMs(process.env),
				});
				return new Response(trace.body, {
					status: trace.httpStatus,
					headers: trace.responseHeaders,
				});
			},
		});
		return evaluateWechatSnapshot({
			url: input.url,
			method: "browser_fetch",
			snapshot,
			trace,
		});
	}

	async capture(input: SourceCaptureInput): Promise<SourceCaptureResult> {
		const cookieJar = new WechatCookieJar();
		const primaryAttempt = await this.captureWithProfile(input, WECHAT_IOS_SAFARI_PROFILE, cookieJar);
		let selectedAttempt = primaryAttempt;

		const primaryRiskControl = detectWechatRiskControl(primaryAttempt.trace);
		if (primaryRiskControl.isRiskControl) {
			const retryAttempt = await this.captureWithProfile(input, WECHAT_ANDROID_CHROME_PROFILE, cookieJar);
			selectedAttempt = retryAttempt;
		}

		const directResult = evaluateWechatSnapshot({
			url: input.url,
			method: "direct_fetch",
			snapshot: selectedAttempt.snapshot,
			trace: selectedAttempt.trace,
		});
		if (!shouldAttemptWechatBrowserFallback(directResult.status)) {
			return directResult;
		}

		try {
			const browserResult = await this.captureWithBrowser(input);
			if (browserResult.usable) {
				return {
					...browserResult,
					attempts: [...directResult.attempts, ...browserResult.attempts],
				};
			}
			return {
				...directResult,
				attempts: [...directResult.attempts, ...browserResult.attempts],
			};
		} catch {
			return directResult;
		}
	}
}
