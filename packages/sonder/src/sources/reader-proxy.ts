import { readFileSync } from "node:fs";
import { captureSnapshot } from "../snapshot/snapshot-service.js";
import { buildAcquisitionAttempt, buildReaderProxyUrl } from "./acquisition.js";
import type { SourceCaptureInput, SourceCaptureResult, SourcePlatform } from "./types.js";
import {
	cleanXiaohongshuExtractedText,
	looksLikeLoginWall,
	looksMostlyBoilerplateForXiaohongshu,
	mapFailureCodeToSourceStatus,
	mapSnapshotFailureToReasonCode,
} from "./utils.js";

const MIN_READER_TEXT_LENGTH = 80;
const MIN_READER_SUBSTANTIAL_CONTENT_LENGTH = 500;

export async function captureFromReaderProxy(
	input: SourceCaptureInput & { platform: SourcePlatform },
): Promise<SourceCaptureResult> {
	const readerUrl = buildReaderProxyUrl(input.url);
	const snapshot = await captureSnapshot({
		itemId: input.itemId,
		url: readerUrl,
		dataRootDir: input.dataRootDir,
		fetchImpl: input.fetchImpl,
		skipLoginWallDetection: true,
	});
	let status = mapFailureCodeToSourceStatus(snapshot.failureCode);
	let reason = snapshot.failureReason;
	let reasonCode = mapSnapshotFailureToReasonCode(snapshot.failureCode, snapshot.failureReason);
	let reasonHint = snapshot.failureReason;

	if (status === "ok") {
		const extracted = readExtracted(snapshot.extractedTextPath);
		const normalizedExtracted = extracted.replace(/\s+/g, " ").trim();
		const isSubstantial = normalizedExtracted.length >= MIN_READER_SUBSTANTIAL_CONTENT_LENGTH;
		if (looksLikeReaderErrorResponse(extracted)) {
			status = "error";
			reason = "Reader proxy returned an upstream error page.";
			reasonCode = "READER_PROXY_UPSTREAM_ERROR";
			reasonHint = reason;
		} else if (input.platform === "xiaohongshu") {
			const cleaned = cleanXiaohongshuExtractedText(extracted);
			if (looksMostlyBoilerplateForXiaohongshu(extracted, cleaned)) {
				status = "unsupported";
				reason = "Reader proxy result appears mostly Xiaohongshu boilerplate.";
				reasonCode = "READER_PROXY_XHS_BOILERPLATE";
				reasonHint = reason;
			} else if (normalizedExtracted.length < MIN_READER_TEXT_LENGTH) {
				status = "unsupported";
				reason = "Reader proxy returned too little content.";
				reasonCode = "READER_PROXY_CONTENT_TOO_SHORT";
				reasonHint = reason;
			}
		} else if (looksLikeLoginWall(extracted) && !isSubstantial) {
			status = "login_required";
			reason = "Reader proxy still returned login-gated content.";
			reasonCode = "READER_PROXY_LOGIN_WALL";
			reasonHint = reason;
		} else if (normalizedExtracted.length < MIN_READER_TEXT_LENGTH) {
			status = "unsupported";
			reason = "Reader proxy returned too little content.";
			reasonCode = "READER_PROXY_CONTENT_TOO_SHORT";
			reasonHint = reason;
		}
	}

	const attempt = buildAcquisitionAttempt({
		method: "reader_proxy",
		inputUrl: input.url,
		effectiveUrl: readerUrl,
		status,
		reasonCode,
		reasonHint,
		debug: {
			httpStatus: null,
			contentType: null,
			finalUrl: readerUrl,
			redirectChain: [],
		},
		snapshot,
	});

	return {
		platform: input.platform,
		status,
		reason,
		reasonCode,
		reasonHint,
		debug: attempt.debug,
		usable: status === "ok",
		snapshot,
		acquisitionMethod: "reader_proxy",
		attempts: [attempt],
	};
}

function readExtracted(path: string): string {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}

function looksLikeReaderErrorResponse(text: string): boolean {
	const normalized = text.toLowerCase();
	return (
		normalized.includes("reader error") ||
		normalized.includes("upstream error") ||
		normalized.includes("error fetching") ||
		normalized.includes("request failed")
	);
}
