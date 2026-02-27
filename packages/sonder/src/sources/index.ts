import { shouldAttemptAuthBrowserFallback, shouldAttemptReaderProxyFallback } from "./acquisition.js";
import { isAuthEligibleDomain } from "./auth/domain-policy.js";
import { captureFromAuthBrowser } from "./auth-browser-adapter.js";
import { GenericSourceAdapter } from "./generic-adapter.js";
import { captureFromReaderProxy } from "./reader-proxy.js";
import { TwitterSourceAdapter } from "./twitter-adapter.js";
import type { SourceAdapter, SourceCaptureInput, SourceCaptureResult, SourcePlatform } from "./types.js";
import { detectSourcePlatform } from "./utils.js";
import { WechatSourceAdapter } from "./wechat-adapter.js";
import { XiaohongshuSourceAdapter } from "./xiaohongshu-adapter.js";

export {
	AuthSessionManager,
	type AuthSessionManagerOptions,
	type AuthSessionStatusView,
} from "./auth/auth-session-manager.js";
export { decryptAuthState, encryptAuthState } from "./auth/auth-state-crypto.js";
export {
	assertAuthEligibleDomain,
	getAuthLoginUrl,
	isAuthEligibleDomain,
	normalizeAuthDomain,
} from "./auth/domain-policy.js";

function createAdapter(platform: SourcePlatform): SourceAdapter {
	if (platform === "twitter") {
		return new TwitterSourceAdapter();
	}
	if (platform === "wechat") {
		return new WechatSourceAdapter();
	}
	if (platform === "xiaohongshu") {
		return new XiaohongshuSourceAdapter();
	}
	return new GenericSourceAdapter(platform);
}

export async function captureFromSource(input: SourceCaptureInput): Promise<SourceCaptureResult> {
	const platform = detectSourcePlatform(input.url);
	const adapter = createAdapter(platform);
	const directResult = await adapter.capture(input);
	let bestResult: SourceCaptureResult = directResult;
	let attempts = [...directResult.attempts];

	if (shouldAttemptReaderProxyFallback(directResult.status, input.url)) {
		const readerResult = await captureFromReaderProxy({
			...input,
			platform,
		});
		attempts = [...attempts, ...readerResult.attempts];
		if (readerResult.usable) {
			bestResult = readerResult;
		}
	}

	if (
		input.authStorageStateJson &&
		isAuthEligibleDomain(input.url) &&
		shouldAttemptAuthBrowserFallback(bestResult.status)
	) {
		const authBrowserResult = await captureFromAuthBrowser({
			...input,
			platform,
			storageStateJson: input.authStorageStateJson,
		});
		attempts = [...attempts, ...authBrowserResult.attempts];
		if (authBrowserResult.usable) {
			return {
				...authBrowserResult,
				attempts,
			};
		}
	}

	return {
		...bestResult,
		attempts,
	};
}

export type {
	AuthBrowserFetchImpl,
	AuthBrowserFetchInput,
	AuthBrowserFetchResult,
	SourceAcquisitionArtifacts,
	SourceAcquisitionAttempt,
	SourceAcquisitionMethod,
	SourceAdapter,
	SourceCaptureDebug,
	SourceCaptureInput,
	SourceCaptureResult,
	SourcePlatform,
	SourceStatus,
} from "./types.js";
export { detectSourcePlatform } from "./utils.js";
