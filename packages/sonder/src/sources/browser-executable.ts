import { existsSync } from "node:fs";

export const COMMON_CHROMIUM_EXECUTABLE_PATHS = [
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/Applications/Chromium.app/Contents/MacOS/Chromium",
	"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
	"/usr/bin/google-chrome",
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
	"C:/Program Files/Google/Chrome/Application/chrome.exe",
	"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
];

export function resolveChromiumExecutablePath(explicitPath: string | undefined): string | undefined {
	if (explicitPath && explicitPath.trim().length > 0) {
		return explicitPath;
	}
	for (const candidate of COMMON_CHROMIUM_EXECUTABLE_PATHS) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return undefined;
}
