import { GenericSourceAdapter } from "./generic-adapter.js";
import { TwitterSourceAdapter } from "./twitter-adapter.js";
import type { SourceAdapter, SourceCaptureInput, SourceCaptureResult, SourcePlatform } from "./types.js";
import { detectSourcePlatform } from "./utils.js";
import { WechatSourceAdapter } from "./wechat-adapter.js";
import { XiaohongshuSourceAdapter } from "./xiaohongshu-adapter.js";

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
	return adapter.capture(input);
}

export type { SourceAdapter, SourceCaptureInput, SourceCaptureResult, SourcePlatform, SourceStatus } from "./types.js";
export { detectSourcePlatform } from "./utils.js";
