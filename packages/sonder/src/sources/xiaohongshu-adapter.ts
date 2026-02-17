import { readFileSync } from "node:fs";
import { captureSnapshot } from "../snapshot/snapshot-service.js";
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
		const status = mapFailureCodeToSourceStatus(snapshot.failureCode);
		if (status !== "ok") {
			return {
				platform: "xiaohongshu",
				status,
				reason: snapshot.failureReason,
				reasonCode: mapSnapshotFailureToReasonCode(snapshot.failureCode, snapshot.failureReason),
				reasonHint: snapshot.failureReason,
				debug: null,
				usable: false,
				snapshot,
			};
		}

		const extracted = readFileSync(snapshot.extractedTextPath, "utf8");
		const cleaned = cleanXiaohongshuExtractedText(extracted);
		if (looksMostlyBoilerplateForXiaohongshu(extracted, cleaned)) {
			return {
				platform: "xiaohongshu",
				status: "unsupported",
				reason: "Xiaohongshu page appears mostly boilerplate and is not reliable evidence.",
				reasonCode: "XHS_BOILERPLATE_ONLY",
				reasonHint: "Xiaohongshu page appears mostly boilerplate and is not reliable evidence.",
				debug: null,
				usable: false,
				snapshot,
			};
		}

		return {
			platform: "xiaohongshu",
			status: "ok",
			reason: null,
			reasonCode: null,
			reasonHint: null,
			debug: null,
			usable: true,
			snapshot,
		};
	}
}
