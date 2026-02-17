import { readFileSync } from "node:fs";
import { captureSnapshot } from "../snapshot/snapshot-service.js";
import { buildAcquisitionAttempt } from "./acquisition.js";
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
		let status = mapFailureCodeToSourceStatus(snapshot.failureCode);
		let reason = snapshot.failureReason;
		let reasonCode = mapSnapshotFailureToReasonCode(snapshot.failureCode, snapshot.failureReason);
		let reasonHint = snapshot.failureReason;

		if (status === "ok") {
			const extracted = readFileSync(snapshot.extractedTextPath, "utf8");
			if (looksLikeLoginWall(extracted) || looksLikeTwitterGate(extracted) || extracted.trim().length < 32) {
				status = "login_required";
				reason = "Twitter/X returned login-gated or unusable page content.";
				reasonCode = "TWITTER_LOGIN_WALL";
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
			platform: "twitter",
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
