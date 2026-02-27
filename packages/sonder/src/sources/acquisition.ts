import { readFileSync } from "node:fs";
import type { CaptureSnapshotResult } from "../snapshot/snapshot-service.js";
import type { SourceAcquisitionAttempt, SourceAcquisitionMethod, SourceStatus } from "./types.js";

export function isReaderProxyUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.host.toLowerCase() === "r.jina.ai";
	} catch {
		return false;
	}
}

export function buildReaderProxyUrl(url: string): string {
	return `https://r.jina.ai/${url}`;
}

export function shouldAttemptReaderProxyFallback(status: SourceStatus, inputUrl: string): boolean {
	if (isReaderProxyUrl(inputUrl)) {
		return false;
	}
	if (status === "ok" || status === "not_found") {
		return false;
	}
	return (
		status === "risk_control" ||
		status === "login_required" ||
		status === "forbidden" ||
		status === "unsupported" ||
		status === "blocked" ||
		status === "timeout" ||
		status === "fetch_failed" ||
		status === "error"
	);
}

export function shouldAttemptAuthBrowserFallback(status: SourceStatus): boolean {
	if (status === "ok" || status === "not_found") {
		return false;
	}
	return (
		status === "risk_control" ||
		status === "login_required" ||
		status === "forbidden" ||
		status === "unsupported" ||
		status === "blocked" ||
		status === "timeout" ||
		status === "fetch_failed" ||
		status === "error"
	);
}

export function buildAcquisitionAttempt(input: {
	method: SourceAcquisitionMethod;
	inputUrl: string;
	effectiveUrl: string;
	status: SourceStatus;
	reasonCode: string | null;
	reasonHint: string | null;
	debug: SourceAcquisitionAttempt["debug"];
	snapshot: CaptureSnapshotResult;
}): SourceAcquisitionAttempt {
	return {
		method: input.method,
		inputUrl: input.inputUrl,
		effectiveUrl: input.effectiveUrl,
		status: input.status,
		reasonCode: input.reasonCode,
		reasonHint: input.reasonHint,
		artifacts: {
			text: input.snapshot.extractedTextPath,
			html: input.snapshot.snapshotHtmlPath ?? undefined,
			markdown: readOptionalMarkdownPath(input.snapshot),
		},
		debug: input.debug,
	};
}

function readOptionalMarkdownPath(snapshot: CaptureSnapshotResult): string | undefined {
	if (snapshot.snapshotHtmlPath) {
		return undefined;
	}
	if (!snapshot.extractedTextPath) {
		return undefined;
	}
	try {
		const content = readFileSync(snapshot.extractedTextPath, "utf8");
		if (content.includes("#") || content.includes("```")) {
			return snapshot.extractedTextPath;
		}
		return undefined;
	} catch {
		return undefined;
	}
}
