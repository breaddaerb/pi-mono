import { captureSnapshot } from "../snapshot/snapshot-service.js";
import { buildAcquisitionAttempt } from "./acquisition.js";
import type { SourceAdapter, SourceCaptureInput, SourceCaptureResult, SourcePlatform } from "./types.js";
import { mapFailureCodeToSourceStatus, mapSnapshotFailureToReasonCode } from "./utils.js";

export class GenericSourceAdapter implements SourceAdapter {
	constructor(private readonly platform: SourcePlatform) {}

	async capture(input: SourceCaptureInput): Promise<SourceCaptureResult> {
		const snapshot = await captureSnapshot({
			itemId: input.itemId,
			url: input.url,
			dataRootDir: input.dataRootDir,
			fetchImpl: input.fetchImpl,
		});
		const status = mapFailureCodeToSourceStatus(snapshot.failureCode);
		const reasonCode = mapSnapshotFailureToReasonCode(snapshot.failureCode, snapshot.failureReason);
		const reasonHint = snapshot.failureReason;
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
			platform: this.platform,
			status,
			reason: snapshot.failureReason,
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
