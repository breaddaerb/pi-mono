import type { CaptureSnapshotResult } from "../snapshot/snapshot-service.js";

export type SourcePlatform = "twitter" | "wechat" | "xiaohongshu" | "arxiv" | "web";

export type SourceStatus =
	| "ok"
	| "risk_control"
	| "login_required"
	| "not_found"
	| "forbidden"
	| "unsupported"
	| "blocked"
	| "timeout"
	| "fetch_failed"
	| "error";

export interface SourceCaptureInput {
	itemId: string;
	url: string;
	dataRootDir: string;
	fetchImpl?: typeof fetch;
}

export interface SourceCaptureDebug {
	httpStatus: number | null;
	contentType: string | null;
	finalUrl: string | null;
	redirectChain: string[];
}

export interface SourceCaptureResult {
	platform: SourcePlatform;
	status: SourceStatus;
	reason: string | null;
	reasonCode: string | null;
	reasonHint: string | null;
	debug: SourceCaptureDebug | null;
	usable: boolean;
	snapshot: CaptureSnapshotResult;
}

export interface SourceAdapter {
	capture(input: SourceCaptureInput): Promise<SourceCaptureResult>;
}
