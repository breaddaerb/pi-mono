import { captureSnapshot } from "../snapshot/snapshot-service.js";
import type { SourceAdapter, SourceCaptureInput, SourceCaptureResult, SourcePlatform } from "./types.js";
import { mapFailureCodeToSourceStatus } from "./utils.js";

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
		return {
			platform: this.platform,
			status,
			reason: snapshot.failureReason,
			usable: status === "ok",
			snapshot,
		};
	}
}
