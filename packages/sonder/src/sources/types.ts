import type { CaptureSnapshotResult } from "../snapshot/snapshot-service.js";

export type SourcePlatform = "twitter" | "wechat" | "xiaohongshu" | "arxiv" | "web";

export type SourceStatus = "ok" | "login_required" | "blocked" | "timeout" | "fetch_failed";

export interface SourceCaptureInput {
	itemId: string;
	url: string;
	dataRootDir: string;
	fetchImpl?: typeof fetch;
}

export interface SourceCaptureResult {
	platform: SourcePlatform;
	status: SourceStatus;
	reason: string | null;
	usable: boolean;
	snapshot: CaptureSnapshotResult;
}

export interface SourceAdapter {
	capture(input: SourceCaptureInput): Promise<SourceCaptureResult>;
}
