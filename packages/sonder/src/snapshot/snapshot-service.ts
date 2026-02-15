import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getArtifactFilePath, getItemArtifactDirectory } from "../storage/artifact-paths.js";
import { extractAssetUrls } from "./assets.js";
import { extractReadableTextFromHtml } from "./text-extraction.js";

export interface CaptureSnapshotOptions {
	itemId: string;
	url: string;
	dataRootDir: string;
	fetchImpl?: typeof fetch;
}

export type SnapshotFailureCode =
	| "none"
	| "login_required"
	| "blocked"
	| "timeout"
	| "fetch_failed"
	| "unsupported_content_type";

export interface CaptureSnapshotResult {
	itemDirectory: string;
	snapshotHtmlPath: string | null;
	snapshotAssetsDirectory: string;
	extractedTextPath: string;
	screenshotFallbackPath: string | null;
	assetUrls: string[];
	usedFallback: boolean;
	failureCode: SnapshotFailureCode;
	failureReason: string | null;
}

function formatFallbackContent(url: string, reason: string, code: SnapshotFailureCode): string {
	const timestamp = new Date().toISOString();
	return [
		"Snapshot fallback (text-only)",
		`url: ${url}`,
		`timestamp: ${timestamp}`,
		`failure_code: ${code}`,
		`reason: ${reason}`,
	].join("\n");
}

function classifyFailureCode(reason: string): SnapshotFailureCode {
	const normalized = reason.toLowerCase();
	if (normalized.includes("unsupported content-type")) {
		return "unsupported_content_type";
	}
	if (normalized.includes("timeout") || normalized.includes("timed out") || normalized.includes("abort")) {
		return "timeout";
	}
	if (
		normalized.includes("http 401") ||
		normalized.includes("http 403") ||
		normalized.includes("login") ||
		normalized.includes("verify") ||
		normalized.includes("captcha") ||
		normalized.includes("sign in") ||
		normalized.includes("human verification") ||
		normalized.includes("环境异常") ||
		normalized.includes("去验证") ||
		normalized.includes("验证") ||
		normalized.includes("请登录") ||
		normalized.includes("登录")
	) {
		return "login_required";
	}
	if (normalized.includes("http 429") || normalized.includes("forbidden") || normalized.includes("blocked")) {
		return "blocked";
	}
	return "fetch_failed";
}

function isLikelyLoginBlockedPage(url: string, html: string, extractedText: string): boolean {
	const lowerUrl = url.toLowerCase();
	const lowerHtml = html.toLowerCase();
	const lowerExtracted = extractedText.toLowerCase();
	const haystack = `${lowerHtml}\n${lowerExtracted}`;
	const signals = [
		"human verification",
		"captcha",
		"please log in",
		"please login",
		"sign in",
		"环境异常",
		"去验证",
		"验证后即可继续访问",
		"请登录",
	];
	const hasSignal = signals.some((signal) => haystack.includes(signal));
	if (!hasSignal) {
		return false;
	}
	if (lowerUrl.includes("mp.weixin.qq.com")) {
		return true;
	}
	if (lowerUrl.includes("x.com") || lowerUrl.includes("twitter.com")) {
		return true;
	}
	if (lowerUrl.includes("xiaohongshu.com")) {
		return true;
	}
	return true;
}

export async function captureSnapshot(options: CaptureSnapshotOptions): Promise<CaptureSnapshotResult> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const itemDirectory = getItemArtifactDirectory(options.dataRootDir, options.itemId);
	mkdirSync(itemDirectory, { recursive: true });

	const snapshotHtmlPath = getArtifactFilePath(options.dataRootDir, options.itemId, "snapshot.html");
	const assetsDirectory = getArtifactFilePath(options.dataRootDir, options.itemId, "assets");
	const assetsManifestPath = join(assetsDirectory, "manifest.json");
	const extractedTextPath = getArtifactFilePath(options.dataRootDir, options.itemId, "extracted.txt");
	const fallbackPath = getArtifactFilePath(options.dataRootDir, options.itemId, "screenshot-fallback.txt");

	mkdirSync(assetsDirectory, { recursive: true });

	try {
		const response = await fetchImpl(options.url, {
			headers: {
				accept: "text/html,application/xhtml+xml",
			},
		});
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}
		const contentType = response.headers.get("content-type") ?? "";
		if (!contentType.toLowerCase().includes("text/html")) {
			throw new Error(`Unsupported content-type: ${contentType}`);
		}

		const html = await response.text();
		const assetUrls = extractAssetUrls(html, options.url);
		const extractedText = extractReadableTextFromHtml(html);
		if (isLikelyLoginBlockedPage(options.url, html, extractedText)) {
			throw new Error("LOGIN_REQUIRED: source returned verification/login wall");
		}

		writeFileSync(snapshotHtmlPath, html, "utf8");
		writeFileSync(assetsManifestPath, JSON.stringify({ sourceUrl: options.url, assetUrls }, null, 2), "utf8");
		writeFileSync(extractedTextPath, extractedText, "utf8");

		return {
			itemDirectory,
			snapshotHtmlPath,
			snapshotAssetsDirectory: assetsDirectory,
			extractedTextPath,
			screenshotFallbackPath: null,
			assetUrls,
			usedFallback: false,
			failureCode: "none",
			failureReason: null,
		};
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		const failureCode = classifyFailureCode(reason);
		const fallbackText = formatFallbackContent(options.url, reason, failureCode);
		writeFileSync(fallbackPath, fallbackText, "utf8");
		writeFileSync(assetsManifestPath, JSON.stringify({ sourceUrl: options.url, assetUrls: [] }, null, 2), "utf8");
		writeFileSync(extractedTextPath, fallbackText, "utf8");

		return {
			itemDirectory,
			snapshotHtmlPath: null,
			snapshotAssetsDirectory: assetsDirectory,
			extractedTextPath,
			screenshotFallbackPath: fallbackPath,
			assetUrls: [],
			usedFallback: true,
			failureCode,
			failureReason: reason,
		};
	}
}
