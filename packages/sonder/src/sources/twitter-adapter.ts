import { readFileSync } from "node:fs";
import { captureSnapshot } from "../snapshot/snapshot-service.js";
import { buildAcquisitionAttempt } from "./acquisition.js";
import type { SourceAdapter, SourceCaptureInput, SourceCaptureResult } from "./types.js";
import { looksLikeLoginWall, mapFailureCodeToSourceStatus, mapSnapshotFailureToReasonCode } from "./utils.js";

const MIN_TWITTER_USEFUL_CHARACTERS = 140;
const MIN_TWITTER_USEFUL_WORDS = 20;
const MAX_LOW_SIGNAL_BOILERPLATE_CHARACTERS = 700;

const TWITTER_LOW_SIGNAL_BOILERPLATE_SIGNALS = [
	"x. it’s what’s happening",
	"x. it's what's happening",
	"join x today",
	"terms of service",
	"privacy policy",
	"cookie policy",
	"ads info",
	"this browser is no longer supported",
	"javascript is not available",
	"something went wrong",
	"retry",
	"grok",
	"trending",
];

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

function isTwitterStatusUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return /\/status\/\d+/i.test(parsed.pathname);
	} catch {
		return false;
	}
}

function looksLikeTwitterErrorPage(text: string): boolean {
	const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
	const strongSignals = [
		"something went wrong, but don’t fret",
		"something went wrong, but don't fret",
		"privacy related extensions may cause issues on x.com",
	];
	if (strongSignals.some((signal) => normalized.includes(signal))) {
		return true;
	}
	const weakSignals = ["something went wrong", "try again", "give it another shot"];
	const weakHitCount = weakSignals.reduce((count, signal) => count + (normalized.includes(signal) ? 1 : 0), 0);
	return weakHitCount >= 2;
}

function countWordLikeTokens(text: string): number {
	const tokens = text.match(/[\p{L}\p{N}_]+/gu);
	return tokens ? tokens.length : 0;
}

function looksLikeLowSignalTwitterContent(text: string, url: string): boolean {
	if (!isTwitterStatusUrl(url)) {
		return false;
	}
	const normalized = text.replace(/\s+/g, " ").trim();
	if (normalized.length < MIN_TWITTER_USEFUL_CHARACTERS) {
		return true;
	}
	if (countWordLikeTokens(normalized) < MIN_TWITTER_USEFUL_WORDS) {
		return true;
	}
	const lower = normalized.toLowerCase();
	const boilerplateHits = TWITTER_LOW_SIGNAL_BOILERPLATE_SIGNALS.reduce(
		(count, signal) => count + (lower.includes(signal) ? 1 : 0),
		0,
	);
	return boilerplateHits >= 4 && normalized.length < MAX_LOW_SIGNAL_BOILERPLATE_CHARACTERS;
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
			if (looksLikeLoginWall(extracted) || looksLikeTwitterGate(extracted)) {
				status = "login_required";
				reason = "Twitter/X returned login-gated or unusable page content.";
				reasonCode = "TWITTER_LOGIN_WALL";
				reasonHint = reason;
			} else if (looksLikeTwitterErrorPage(extracted)) {
				status = "unsupported";
				reason = "Twitter/X direct fetch returned an error page.";
				reasonCode = "TWITTER_ERROR_PAGE";
				reasonHint = reason;
			} else if (looksLikeLowSignalTwitterContent(extracted, input.url)) {
				status = "unsupported";
				reason = "Twitter/X direct fetch returned low-signal page content.";
				reasonCode = "TWITTER_LOW_SIGNAL_CONTENT";
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
