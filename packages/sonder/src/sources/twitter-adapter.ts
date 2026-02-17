import { readFileSync } from "node:fs";
import { captureSnapshot } from "../snapshot/snapshot-service.js";
import type { SourceAdapter, SourceCaptureInput, SourceCaptureResult } from "./types.js";
import { looksLikeLoginWall, mapFailureCodeToSourceStatus, mapSnapshotFailureToReasonCode } from "./utils.js";

function looksLikeTwitterGate(text: string): boolean {
	const normalized = text.toLowerCase();
	const signals = [
		"log in to x",
		"join x",
		"sign in to x",
		"this browser is no longer supported",
		"create an account",
	];
	return signals.some((signal) => normalized.includes(signal));
}

export class TwitterSourceAdapter implements SourceAdapter {
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
				platform: "twitter",
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
		if (looksLikeLoginWall(extracted) || looksLikeTwitterGate(extracted) || extracted.trim().length < 32) {
			return {
				platform: "twitter",
				status: "login_required",
				reason: "Twitter/X returned login-gated or unusable page content.",
				reasonCode: "TWITTER_LOGIN_WALL",
				reasonHint: "Twitter/X returned login-gated or unusable page content.",
				debug: null,
				usable: false,
				snapshot,
			};
		}

		return {
			platform: "twitter",
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
