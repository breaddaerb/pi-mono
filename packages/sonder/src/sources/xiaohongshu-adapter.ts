import { readFileSync } from "node:fs";
import { captureSnapshot } from "../snapshot/snapshot-service.js";
import { buildAcquisitionAttempt } from "./acquisition.js";
import type { SourceAdapter, SourceCaptureInput, SourceCaptureResult } from "./types.js";
import {
	cleanXiaohongshuExtractedText,
	looksMostlyBoilerplateForXiaohongshu,
	mapFailureCodeToSourceStatus,
	mapSnapshotFailureToReasonCode,
} from "./utils.js";

export class XiaohongshuSourceAdapter implements SourceAdapter {
	async capture(input: SourceCaptureInput): Promise<SourceCaptureResult> {
		const snapshot = await captureSnapshot({
			itemId: input.itemId,
			url: input.url,
			dataRootDir: input.dataRootDir,
			fetchImpl: input.fetchImpl,
		});
		let status = mapFailureCodeToSourceStatus(snapshot.failureCode);
		let reason = snapshot.failureReason;
		let reasonCode = mapSnapshotFailureToReasonCode(snapshot.failureCode, snapshot.failureReason);
		let reasonHint = snapshot.failureReason;

		if (status === "ok") {
			const extracted = readFileSync(snapshot.extractedTextPath, "utf8");
			const cleaned = cleanXiaohongshuExtractedText(extracted);
			if (looksMostlyBoilerplateForXiaohongshu(extracted, cleaned)) {
				status = "unsupported";
				reason = "Xiaohongshu page appears mostly boilerplate and is not reliable evidence.";
				reasonCode = "XHS_BOILERPLATE_ONLY";
				reasonHint = reason;
			}
		}

		const attempt = buildAcquisitionAttempt({
			method: "direct_fetch",
			inputUrl: input.url,
			effectiveUrl: input.url,
			status,
			reasonCode,
			reasonHint,
			debug: null,
			snapshot,
		});

		return {
			platform: "xiaohongshu",
			status,
			reason,
			reasonCode,
			reasonHint,
			debug: null,
			usable: status === "ok",
			snapshot,
			acquisitionMethod: "direct_fetch",
			attempts: [attempt],
		};
	}
}
