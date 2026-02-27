import type { SonderApp } from "../app/index.js";
import { formatDiscoveryReasonSummary } from "./telegram-retrieval-reasons.js";

const MAX_TELEGRAM_MESSAGE_LENGTH = 3500;

function formatAuthSessionStatus(status: {
	domain: string;
	exists: boolean;
	status: string;
	hasEncryptedState: boolean;
	updatedAt: string | null;
	lastValidatedAt: string | null;
	expiresAt: string | null;
	lastError: string | null;
}): string {
	const lines = [
		`Domain: ${status.domain}`,
		`Exists: ${status.exists ? "yes" : "no"}`,
		`Status: ${status.status}`,
		`Encrypted state: ${status.hasEncryptedState ? "yes" : "no"}`,
		`Updated: ${status.updatedAt ?? "-"}`,
		`Validated: ${status.lastValidatedAt ?? "-"}`,
		`Expires: ${status.expiresAt ?? "-"}`,
	];
	if (status.lastError) {
		lines.push(`Error: ${truncateMiddle(status.lastError, 180)}`);
	}
	return lines.join("\n");
}

function buildSourceFallbackHint(status: string): string {
	if (status === "risk_control") {
		return "\nLink usability: WeChat verification/risk control was triggered. Options: retry later, or re-send with pasted text: /save <url> <pasted text>";
	}
	if (status === "login_required") {
		return "\nLink usability: source requires login/client context. Re-send with pasted text: /save <url> <pasted text>";
	}
	return "\nLink usability: not usable for reliable evidence. Re-send with pasted text: /save <url> <pasted text>";
}

export function formatPollingError(error: unknown): string {
	if (!(error instanceof Error)) {
		return String(error);
	}
	const cause = error.cause;
	if (cause && typeof cause === "object") {
		const code = "code" in cause ? String(cause.code) : undefined;
		const message = "message" in cause ? String(cause.message) : undefined;
		if (code || message) {
			return `${error.message}${code || message ? ` (cause: ${[code, message].filter(Boolean).join(" - ")})` : ""}`;
		}
	}
	return error.message;
}

export function truncateMiddle(text: string, maxLength: number): string {
	if (text.length <= maxLength) {
		return text;
	}
	const left = Math.floor((maxLength - 3) / 2);
	const right = maxLength - 3 - left;
	return `${text.slice(0, left)}...${text.slice(text.length - right)}`;
}

export function splitForTelegram(text: string): string[] {
	if (text.length <= MAX_TELEGRAM_MESSAGE_LENGTH) {
		return [text];
	}
	const chunks: string[] = [];
	let remaining = text;
	while (remaining.length > MAX_TELEGRAM_MESSAGE_LENGTH) {
		const candidate = remaining.slice(0, MAX_TELEGRAM_MESSAGE_LENGTH);
		const splitIndex = candidate.lastIndexOf("\n");
		if (splitIndex > 0) {
			chunks.push(remaining.slice(0, splitIndex));
			remaining = remaining.slice(splitIndex + 1);
			continue;
		}
		chunks.push(candidate);
		remaining = remaining.slice(MAX_TELEGRAM_MESSAGE_LENGTH);
	}
	if (remaining.length > 0) {
		chunks.push(remaining);
	}
	return chunks;
}

export function formatCommandResult(result: Awaited<ReturnType<SonderApp["processCommand"]>>): string {
	if (!result.ok) {
		return `Error (${result.error.code}): ${result.error.message}`;
	}

	if (result.value.type === "save") {
		const mode =
			result.value.evidenceType === "snapshot"
				? "snapshot mode"
				: result.value.evidenceType === "pasted_text"
					? "pasted-text evidence mode"
					: "fallback text mode";
		const tags = result.value.tags.length > 0 ? `\nTags: ${result.value.tags.map((tag) => `#${tag}`).join(" ")}` : "";
		const acquisition = `\nAcquisition: ${result.value.sourceAcquisitionMethod}`;
		const source = `\nSource: ${result.value.sourcePlatform} · ${result.value.sourceStatus}`;
		const reason = result.value.sourceStatusReason
			? `\nReason: ${truncateMiddle(result.value.sourceStatusReason, 180)}`
			: "";
		const needsEvidence = result.value.needsUserEvidence ? buildSourceFallbackHint(result.value.sourceStatus) : "";
		return (
			[
				"Saved item",
				`ID: ${result.value.itemId}`,
				`URL: ${result.value.url}`,
				`Capture: ${mode}`,
				`Artifacts: ${result.value.artifactIds.length}`,
			].join("\n") +
			acquisition +
			source +
			reason +
			tags +
			needsEvidence
		);
	}

	if (result.value.type === "list") {
		if (result.value.items.length === 0) {
			return "No saved items yet. Use /save <url> first.";
		}
		const lines = result.value.items.map((item, index) => {
			const tags = item.tags.length > 0 ? ` ${item.tags.map((tag) => `#${tag}`).join(" ")}` : "";
			const url = truncateMiddle(item.originalUrl, 100);
			return `${index + 1}. ${url}${tags}`;
		});
		return `🗂 Recent items (${result.value.items.length})\n\n${lines.join("\n\n")}`;
	}

	if (result.value.type === "find") {
		if (result.value.items.length === 0) {
			return `No items matched: ${result.value.query}`;
		}
		const lines = result.value.items.map((item, index) => {
			const tags = item.tags.length > 0 ? ` ${item.tags.map((tag) => `#${tag}`).join(" ")}` : "";
			const snippetLine = item.snippets.length > 0 ? `\n   match: ${truncateMiddle(item.snippets[0], 120)}` : "";
			return `${index + 1}. ${truncateMiddle(item.originalUrl, 100)}${tags}\n   reasons: ${formatDiscoveryReasonSummary(item.reasons)}${snippetLine}`;
		});
		return `🔎 Found ${result.value.items.length} results for: ${result.value.query}\n\n${lines.join("\n\n")}`;
	}

	if (result.value.type === "annotate") {
		const tags =
			result.value.annotation.tags.length > 0
				? `\nTags: ${result.value.annotation.tags.map((tag) => `#${tag}`).join(" ")}`
				: "";
		return `Annotation saved\nID: ${result.value.annotation.id}\nItem: ${result.value.annotation.itemId}\nText: ${result.value.annotation.text ?? ""}${tags}`;
	}

	if (result.value.type === "ann-list") {
		if (result.value.annotations.length === 0) {
			return `No annotations for item ${result.value.itemId}.`;
		}
		const lines = result.value.annotations.map((annotation, index) => {
			const tags = annotation.tags.length > 0 ? ` ${annotation.tags.map((tag) => `#${tag}`).join(" ")}` : "";
			const preview = truncateMiddle(annotation.text ?? "(empty)", 120);
			return `${index + 1}. ${annotation.id}\n   ${preview}${tags}`;
		});
		return `Annotations for ${result.value.itemId} (${result.value.annotations.length})\n\n${lines.join("\n\n")}`;
	}

	if (result.value.type === "ann-del") {
		return `Annotation deleted\nID: ${result.value.annotationId}`;
	}
	if (result.value.type === "auth-login") {
		return `Auth session login stored\n${formatAuthSessionStatus(result.value.session)}`;
	}
	if (result.value.type === "auth-login-start") {
		const statusLine = result.value.status.alreadyPending ? "already pending" : "started";
		return [
			`Auth login ${statusLine}`,
			`Domain: ${result.value.status.domain}`,
			`Login URL: ${result.value.status.loginUrl}`,
			"",
			"Complete login in the opened browser window, then run:",
			`/auth done ${result.value.status.domain}`,
			"",
			"To abort:",
			`/auth cancel ${result.value.status.domain}`,
		].join("\n");
	}
	if (result.value.type === "auth-status") {
		return `Auth session status\n${formatAuthSessionStatus(result.value.session)}`;
	}
	if (result.value.type === "auth-list") {
		if (result.value.sessions.length === 0) {
			return "No auth sessions found.";
		}
		const lines = result.value.sessions.map((session, index) => {
			const suffix = session.lastError ? ` (error: ${truncateMiddle(session.lastError, 80)})` : "";
			return `${index + 1}. ${session.domain} · ${session.status} · encrypted=${session.hasEncryptedState ? "yes" : "no"}${suffix}`;
		});
		return `Auth sessions (${result.value.sessions.length})\n\n${lines.join("\n")}`;
	}
	if (result.value.type === "auth-logout") {
		return result.value.revoked
			? `Auth session revoked\nDomain: ${result.value.domain}`
			: `No auth session found for domain: ${result.value.domain}`;
	}
	if (result.value.type === "auth-login-cancel") {
		return result.value.cancelled
			? `Auth login cancelled\nDomain: ${result.value.domain}`
			: `No pending auth login for domain: ${result.value.domain}`;
	}

	const citations = result.value.citations.length > 0 ? `\n\nCitations: ${result.value.citations.join(" ")}` : "";
	return `Answer for ${result.value.itemId}\n\n${result.value.answer}${citations}`;
}
