import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import type { WechatHttpTrace } from "./wechat-http.js";

const DEFAULT_NAVIGATION_TIMEOUT_MS = 12_000;
const DEFAULT_USER_AGENT =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const COMMON_CHROMIUM_EXECUTABLE_PATHS = [
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/Applications/Chromium.app/Contents/MacOS/Chromium",
	"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
	"/usr/bin/google-chrome",
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
	"C:/Program Files/Google/Chrome/Application/chrome.exe",
	"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
];

export interface FetchWechatInBrowserOptions {
	url: string;
	executablePath?: string;
	timeoutMs?: number;
}

function resolveExecutablePath(explicitPath: string | undefined): string | undefined {
	if (explicitPath && explicitPath.trim().length > 0) {
		return explicitPath;
	}
	for (const path of COMMON_CHROMIUM_EXECUTABLE_PATHS) {
		if (existsSync(path)) {
			return path;
		}
	}
	return undefined;
}

function normalizeHeaderValue(value: string): string {
	return value.replaceAll(/[\r\n]+/g, ", ").trim();
}

function toSafeHeaders(rawHeaders: Record<string, string>): Headers {
	const headers = new Headers();
	for (const [name, value] of Object.entries(rawHeaders)) {
		const normalized = normalizeHeaderValue(value);
		if (normalized.length === 0) {
			continue;
		}
		try {
			headers.set(name, normalized);
		} catch {
			// Skip invalid header names/values from browser runtime.
		}
	}
	return headers;
}

export async function fetchWechatInBrowser(options: FetchWechatInBrowserOptions): Promise<WechatHttpTrace> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS;
	const executablePath = resolveExecutablePath(options.executablePath);
	const browser = await chromium.launch({
		headless: true,
		executablePath,
	});
	try {
		const context = await browser.newContext({
			userAgent: DEFAULT_USER_AGENT,
			locale: "zh-CN",
			timezoneId: "Asia/Shanghai",
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

			const navigationResponse = await page.goto(options.url, {
				waitUntil: "domcontentloaded",
				timeout: timeoutMs,
			});
			await page.waitForTimeout(750);
			const html = await page.content();
			const rawHeaders = navigationResponse?.headers() ?? {};
			const headers = toSafeHeaders(rawHeaders);
			const trace: WechatHttpTrace = {
				httpStatus: navigationResponse?.status() ?? 200,
				contentType: headers.get("content-type"),
				finalUrl: page.url(),
				redirectChain,
				body: html,
				responseHeaders: headers,
			};
			return trace;
		} finally {
			await context.close();
		}
	} finally {
		await browser.close();
	}
}
