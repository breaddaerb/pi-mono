import { readFileSync } from "node:fs";
import { captureSnapshot } from "../snapshot/snapshot-service.js";
import { buildAcquisitionAttempt } from "./acquisition.js";
import type { SourceAdapter, SourceCaptureInput, SourceCaptureResult } from "./types.js";
import { looksLikeLoginWall, mapFailureCodeToSourceStatus, mapSnapshotFailureToReasonCode } from "./utils.js";
import {
	fetchWechatWithTrace,
	WECHAT_ANDROID_CHROME_PROFILE,
	WECHAT_IOS_SAFARI_PROFILE,
	WechatCookieJar,
	type WechatFetchProfile,
	type WechatHttpTrace,
} from "./wechat-http.js";
import { detectWechatRiskControl } from "./wechat-risk-control.js";

const MIN_WECHAT_EXTRACTED_TEXT_LENGTH = 240;

function toDebug(trace: WechatHttpTrace | null): SourceCaptureResult["debug"] {
	if (!trace) {
		return null;
	}
	return {
		httpStatus: trace.httpStatus,
		contentType: trace.contentType,
		finalUrl: trace.finalUrl,
		redirectChain: [...trace.redirectChain],
	};
}

function classifyWechatHttpStatus(httpStatus: number): SourceCaptureResult["status"] {
	if (httpStatus === 403) {
		return "forbidden";
	}
	if (httpStatus === 404) {
		return "not_found";
	}
	return "error";
}

function buildWechatDirectResult(input: {
	url: string;
	snapshot: SourceCaptureResult["snapshot"];
	status: SourceCaptureResult["status"];
	reason: string | null;
	reasonCode: string | null;
	reasonHint: string | null;
	debug: SourceCaptureResult["debug"];
}): SourceCaptureResult {
	const effectiveUrl = input.debug?.finalUrl ?? input.url;
	const attempt = buildAcquisitionAttempt({
		method: "direct_fetch",
		inputUrl: input.url,
		effectiveUrl,
		status: input.status,
		reasonCode: input.reasonCode,
		reasonHint: input.reasonHint,
		debug: input.debug,
		snapshot: input.snapshot,
	});
	return {
		platform: "wechat",
		status: input.status,
		reason: input.reason,
		reasonCode: input.reasonCode,
		reasonHint: input.reasonHint,
		debug: input.debug,
		usable: input.status === "ok",
		snapshot: input.snapshot,
		acquisitionMethod: "direct_fetch",
		attempts: [attempt],
	};
}

export class WechatSourceAdapter implements SourceAdapter {
	private async captureWithProfile(
		input: SourceCaptureInput,
		profile: WechatFetchProfile,
		cookieJar: WechatCookieJar,
	): Promise<{ snapshot: Awaited<ReturnType<typeof captureSnapshot>>; trace: WechatHttpTrace }> {
		let trace: WechatHttpTrace | null = null;
		const snapshot = await captureSnapshot({
			itemId: input.itemId,
			url: input.url,
			dataRootDir: input.dataRootDir,
			fetchImpl: async (_url, _init) => {
				trace = await fetchWechatWithTrace({
					url: input.url,
					fetchImpl: input.fetchImpl,
					profile,
					cookieJar,
					maxRedirects: 5,
				});
				return new Response(trace.body, {
					status: trace.httpStatus,
					headers: trace.responseHeaders,
				});
			},
		});
		if (!trace) {
			throw new Error("WECHAT_TRACE_MISSING: no response trace captured");
		}
		return { snapshot, trace };
	}

	async capture(input: SourceCaptureInput): Promise<SourceCaptureResult> {
		const cookieJar = new WechatCookieJar();
		const primaryAttempt = await this.captureWithProfile(input, WECHAT_IOS_SAFARI_PROFILE, cookieJar);
		let selectedAttempt = primaryAttempt;

		const primaryRiskControl = detectWechatRiskControl(primaryAttempt.trace);
		if (primaryRiskControl.isRiskControl) {
			const retryAttempt = await this.captureWithProfile(input, WECHAT_ANDROID_CHROME_PROFILE, cookieJar);
			selectedAttempt = retryAttempt;
		}

		const riskControl = detectWechatRiskControl(selectedAttempt.trace);
		if (riskControl.isRiskControl) {
			return buildWechatDirectResult({
				url: input.url,
				snapshot: selectedAttempt.snapshot,
				status: "risk_control",
				reason: riskControl.reasonHint,
				reasonCode: riskControl.reasonCode,
				reasonHint: riskControl.reasonHint,
				debug: toDebug(selectedAttempt.trace),
			});
		}

		const status = mapFailureCodeToSourceStatus(selectedAttempt.snapshot.failureCode);
		if (status !== "ok") {
			const reasonCode = mapSnapshotFailureToReasonCode(
				selectedAttempt.snapshot.failureCode,
				selectedAttempt.snapshot.failureReason,
			);
			const httpStatus = selectedAttempt.trace.httpStatus;
			const resolvedStatus =
				httpStatus === 403 || httpStatus === 404 ? classifyWechatHttpStatus(httpStatus) : status;
			return buildWechatDirectResult({
				url: input.url,
				snapshot: selectedAttempt.snapshot,
				status: resolvedStatus,
				reason: selectedAttempt.snapshot.failureReason,
				reasonCode,
				reasonHint: selectedAttempt.snapshot.failureReason,
				debug: toDebug(selectedAttempt.trace),
			});
		}

		const extracted = readFileSync(selectedAttempt.snapshot.extractedTextPath, "utf8");
		if (looksLikeLoginWall(extracted)) {
			const reason = "WeChat returned login-gated content instead of article text.";
			return buildWechatDirectResult({
				url: input.url,
				snapshot: selectedAttempt.snapshot,
				status: "login_required",
				reason,
				reasonCode: "WECHAT_LOGIN_WALL",
				reasonHint: reason,
				debug: toDebug(selectedAttempt.trace),
			});
		}

		if (extracted.trim().length < MIN_WECHAT_EXTRACTED_TEXT_LENGTH) {
			const reason = "WeChat response is too short to be reliable evidence.";
			return buildWechatDirectResult({
				url: input.url,
				snapshot: selectedAttempt.snapshot,
				status: "unsupported",
				reason,
				reasonCode: "WECHAT_CONTENT_TOO_SHORT",
				reasonHint: reason,
				debug: toDebug(selectedAttempt.trace),
			});
		}

		return buildWechatDirectResult({
			url: input.url,
			snapshot: selectedAttempt.snapshot,
			status: "ok",
			reason: null,
			reasonCode: null,
			reasonHint: null,
			debug: toDebug(selectedAttempt.trace),
		});
	}
}
