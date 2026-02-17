import type { SnapshotFailureCode } from "../snapshot/snapshot-service.js";
import type { SourcePlatform, SourceStatus } from "./types.js";

function unwrapJinaAiUrl(url: URL): string | null {
	if (url.host.toLowerCase() !== "r.jina.ai") {
		return null;
	}
	const candidatePath = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
	if (!candidatePath.startsWith("http://") && !candidatePath.startsWith("https://")) {
		return null;
	}
	return `${candidatePath}${url.search}`;
}

function detectSourcePlatformInternal(url: string, depth: number): SourcePlatform {
	if (depth > 2) {
		return "web";
	}
	try {
		const parsed = new URL(url);
		const wrapped = unwrapJinaAiUrl(parsed);
		if (wrapped) {
			return detectSourcePlatformInternal(wrapped, depth + 1);
		}
		const host = parsed.host.toLowerCase();
		if (host === "x.com" || host === "twitter.com") {
			return "twitter";
		}
		if (host === "mp.weixin.qq.com") {
			return "wechat";
		}
		if (host.includes("xiaohongshu.com")) {
			return "xiaohongshu";
		}
		if (host === "arxiv.org") {
			return "arxiv";
		}
	} catch {
		// no-op
	}
	return "web";
}

export function detectSourcePlatform(url: string): SourcePlatform {
	return detectSourcePlatformInternal(url, 0);
}

export function mapFailureCodeToSourceStatus(code: SnapshotFailureCode): SourceStatus {
	if (code === "none") {
		return "ok";
	}
	if (code === "login_required") {
		return "login_required";
	}
	if (code === "blocked") {
		return "blocked";
	}
	if (code === "timeout") {
		return "timeout";
	}
	if (code === "unsupported_content_type") {
		return "unsupported";
	}
	if (code === "fetch_failed") {
		return "error";
	}
	return "error";
}

export function mapSnapshotFailureToReasonCode(code: SnapshotFailureCode, reason: string | null): string | null {
	if (code === "none") {
		return null;
	}
	if (code === "login_required") {
		return "LOGIN_REQUIRED";
	}
	if (code === "blocked") {
		return "REQUEST_BLOCKED";
	}
	if (code === "timeout") {
		return "REQUEST_TIMEOUT";
	}
	if (code === "unsupported_content_type") {
		return "UNSUPPORTED_CONTENT_TYPE";
	}
	if (reason) {
		const normalized = reason.toLowerCase();
		if (normalized.includes("http 404")) {
			return "HTTP_404";
		}
		if (normalized.includes("http 403")) {
			return "HTTP_403";
		}
	}
	return "REQUEST_ERROR";
}

export function looksLikeLoginWall(text: string): boolean {
	const normalized = text.toLowerCase();
	const signals = [
		"login",
		"log in",
		"sign in",
		"captcha",
		"verify",
		"human verification",
		"环境异常",
		"去验证",
		"验证后即可继续访问",
		"请登录",
		"登录",
	];
	return signals.some((signal) => normalized.includes(signal));
}

const XHS_BOILERPLATE_FRAGMENT_PATTERNS: RegExp[] = [
	/沪icp\d+|沪icp|沪ICP备\d+号?/gi,
	/\d{4}沪公网安备\d+|沪公网安备\d+/gi,
	/沪b2-\d+/gi,
	/备\d{7,}号/gi,
	/\(沪\)网械平台备字\[\d{4}\]第\d+号/gi,
	/\(沪\)-经营性-\d{4}-\d+/gi,
	/沪网文\(\d{4}\)\d+-\d+号/gi,
	/网信算备\d+号/gi,
	/增值电信业务经营许可证/gi,
	/违法不良信息举报电话[:：]?\s*\d+/gi,
	/上海市互联网举报中心/gi,
	/网上有害信息举报专区/gi,
	/营业执照/gi,
	/自营经营者信息/gi,
	/行吟信息科技（上海）有限公司/gi,
	/医疗器械网络交易服务第三方平台备案/gi,
	/互联网药品信息服务资格证书/gi,
	/网络文化经营许可证/gi,
	/个性化推荐算法/gi,
	/地址：上海市黄浦区马当路388号c座/gi,
	/©\s*\d{4}\s*-\s*\d{4}/gi,
	/创作中心/gi,
	/业务合作/gi,
	/发现/gi,
	/发布/gi,
	/通知/gi,
	/登录/gi,
	/更多/gi,
	/加载中/gi,
	/小红书/gi,
];

const XHS_BOILERPLATE_LINE_PATTERNS: RegExp[] = [/^我$/, /^电话[:：]?\s*\d+/i, /^©\s*\d{4}/i];

function stripXiaohongshuBoilerplateFragments(text: string): string {
	let current = text;
	for (const pattern of XHS_BOILERPLATE_FRAGMENT_PATTERNS) {
		current = current.replace(pattern, " ");
	}
	return current;
}

function isXiaohongshuBoilerplateLine(line: string): boolean {
	const normalized = line.trim();
	if (!normalized) {
		return true;
	}
	return XHS_BOILERPLATE_LINE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function cleanXiaohongshuExtractedText(text: string): string {
	const stripped = stripXiaohongshuBoilerplateFragments(text);
	const rawLines = stripped
		.split(/\r?\n|\s+[|｜•·]\s+|\s{3,}/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	const dedup = new Set<string>();
	const kept: string[] = [];
	for (const line of rawLines) {
		const compact = line.replace(/\s+/g, " ").trim();
		if (isXiaohongshuBoilerplateLine(compact)) {
			continue;
		}
		if (compact.length < 6) {
			continue;
		}
		if (dedup.has(compact)) {
			continue;
		}
		dedup.add(compact);
		kept.push(compact);
	}
	return kept.join("\n").trim();
}

export function looksMostlyBoilerplateForXiaohongshu(original: string, cleaned: string): boolean {
	if (!cleaned) {
		return true;
	}
	const originalLen = Math.max(1, original.trim().length);
	const cleanedLen = cleaned.length;
	if (cleanedLen < 24) {
		return true;
	}
	const keepRatio = cleanedLen / originalLen;
	return keepRatio < 0.06;
}

export function cleanExtractedTextForPlatform(platform: SourcePlatform, text: string): string {
	if (platform === "xiaohongshu") {
		return cleanXiaohongshuExtractedText(text);
	}
	return text;
}
