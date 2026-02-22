import type { DialogueTurn } from "../types.js";

export interface SemanticTurn {
	sessionId: string;
	semanticTurnId: string;
	userTurn: DialogueTurn;
	assistantTurn: DialogueTurn | null;
	createdAt: string;
	summary: string;
}

function summarizeTurn(userContent: string, assistantTurn: DialogueTurn | null): string {
	const userSummary = userContent.trim().replace(/\s+/g, " ").slice(0, 72);
	if (!assistantTurn) {
		return `${userSummary || "(empty user message)"} · pending`;
	}
	if (assistantTurn.status === "failed") {
		const error = assistantTurn.errorMessage ? ` · failed: ${assistantTurn.errorMessage}` : " · failed";
		return `${userSummary || "(empty user message)"}${error}`;
	}
	if (assistantTurn.status === "pending") {
		return `${userSummary || "(empty user message)"} · pending`;
	}
	const assistantPreview = assistantTurn.content.trim().replace(/\s+/g, " ").slice(0, 36);
	if (!assistantPreview) {
		return `${userSummary || "(empty user message)"} · (empty answer)`;
	}
	return `${userSummary || "(empty user message)"} · ${assistantPreview}`;
}

export function buildSemanticTurns(dialogueTurns: DialogueTurn[]): SemanticTurn[] {
	const turns: SemanticTurn[] = [];
	let pendingUser: DialogueTurn | null = null;

	for (const turn of dialogueTurns) {
		if (turn.role === "user") {
			if (pendingUser) {
				turns.push({
					sessionId: pendingUser.sessionId,
					semanticTurnId: pendingUser.id,
					userTurn: pendingUser,
					assistantTurn: null,
					createdAt: pendingUser.createdAt,
					summary: summarizeTurn(pendingUser.content, null),
				});
			}
			pendingUser = turn;
			continue;
		}

		if (turn.role === "assistant" && pendingUser) {
			turns.push({
				sessionId: pendingUser.sessionId,
				semanticTurnId: pendingUser.id,
				userTurn: pendingUser,
				assistantTurn: turn,
				createdAt: pendingUser.createdAt,
				summary: summarizeTurn(pendingUser.content, turn),
			});
			pendingUser = null;
		}
	}

	if (pendingUser) {
		turns.push({
			sessionId: pendingUser.sessionId,
			semanticTurnId: pendingUser.id,
			userTurn: pendingUser,
			assistantTurn: null,
			createdAt: pendingUser.createdAt,
			summary: summarizeTurn(pendingUser.content, null),
		});
	}

	return turns;
}
