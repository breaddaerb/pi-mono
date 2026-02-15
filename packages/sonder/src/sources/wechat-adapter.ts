import { readFileSync } from "node:fs";
import { captureSnapshot } from "../snapshot/snapshot-service.js";
import type { SourceAdapter, SourceCaptureInput, SourceCaptureResult } from "./types.js";
import { looksLikeLoginWall, mapFailureCodeToSourceStatus } from "./utils.js";

export class WechatSourceAdapter implements SourceAdapter {
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
				platform: "wechat",
				status,
				reason: snapshot.failureReason,
				usable: false,
				snapshot,
			};
		}

		const extracted = readFileSync(snapshot.extractedTextPath, "utf8");
		if (looksLikeLoginWall(extracted) || extracted.trim().length < 240) {
			return {
				platform: "wechat",
				status: "login_required",
				reason: "WeChat returned verification/login content instead of article text.",
				usable: false,
				snapshot,
			};
		}

		return {
			platform: "wechat",
			status: "ok",
			reason: null,
			usable: true,
			snapshot,
		};
	}
}
