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

export type SourceAcquisitionMethod = "direct_fetch" | "reader_proxy" | "user_paste";

export interface SourceAcquisitionArtifacts {
	text?: string;
	markdown?: string;
	html?: string;
}

export interface SourceAcquisitionAttempt {
	method: SourceAcquisitionMethod;
	inputUrl: string;
	effectiveUrl: string;
	status: SourceStatus;
	reasonCode: string | null;
	reasonHint: string | null;
	artifacts: SourceAcquisitionArtifacts;
	debug: SourceCaptureDebug | null;
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
	acquisitionMethod: SourceAcquisitionMethod;
	attempts: SourceAcquisitionAttempt[];
}

export interface SourceAdapter {
	capture(input: SourceCaptureInput): Promise<SourceCaptureResult>;
}
