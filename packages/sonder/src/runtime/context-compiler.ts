import type { ContextTurnState } from "../storage/context-mark-repo.js";
import type { DialogueTurn } from "../types.js";
import type { SemanticTurn } from "./semantic-turn-service.js";

export type ContextCompilerIncludedReason = "active";
export type ContextCompilerExcludedReason = "detached" | "pruned_active";

export interface ContextCompilerIncludedItem {
	semanticTurnId: string;
	reason: ContextCompilerIncludedReason;
	approxTokens: number;
}

export interface ContextCompilerExcludedItem {
	semanticTurnId: string;
	reason: ContextCompilerExcludedReason;
	approxTokens: number;
}

export interface ContextCompilerOutput {
	includedTurns: DialogueTurn[];
	compiledItems: ContextCompilerIncludedItem[];
	excludedItems: ContextCompilerExcludedItem[];
	compiledTextPreview: string;
	approxTotalTokens: number;
}

export interface ContextCompilerInput {
	semanticTurns: SemanticTurn[];
	stateBySemanticTurnId: ReadonlyMap<string, ContextTurnState>;
	tokenBudget: number;
}

function estimateTurnTokens(turn: SemanticTurn): number {
	const assistantContent =
		turn.assistantTurn?.status === "failed"
			? (turn.assistantTurn.errorMessage ?? "")
			: (turn.assistantTurn?.content ?? "");
	const text = `${turn.userTurn.content}\n${assistantContent}`;
	return Math.max(1, Math.ceil(text.length / 4));
}

function flattenTurns(semanticTurns: SemanticTurn[]): DialogueTurn[] {
	const turns: DialogueTurn[] = [];
	for (const semanticTurn of semanticTurns) {
		turns.push(semanticTurn.userTurn);
		if (semanticTurn.assistantTurn) {
			turns.push(semanticTurn.assistantTurn);
		}
	}
	return turns;
}

function buildCompiledPreview(semanticTurns: SemanticTurn[]): string {
	if (semanticTurns.length === 0) {
		return "(empty)";
	}
	return semanticTurns
		.map((turn) => {
			const userLine = `user: ${turn.userTurn.content}`;
			const assistant = turn.assistantTurn;
			if (!assistant) {
				return userLine;
			}
			if (assistant.status === "failed") {
				const detail = assistant.errorMessage ? `failed: ${assistant.errorMessage}` : "failed";
				return `${userLine}\nassistant: (${detail})`;
			}
			return `${userLine}\nassistant: ${assistant.content}`;
		})
		.join("\n\n");
}

export function compileContextProjection(input: ContextCompilerInput): ContextCompilerOutput {
	const sorted = [...input.semanticTurns].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
	const detached: Array<{ turn: SemanticTurn; approxTokens: number }> = [];
	const active: Array<{ turn: SemanticTurn; approxTokens: number }> = [];

	for (const turn of sorted) {
		const state = input.stateBySemanticTurnId.get(turn.semanticTurnId) ?? "ACTIVE";
		const approxTokens = estimateTurnTokens(turn);
		if (state === "DETACHED") {
			detached.push({ turn, approxTokens });
			continue;
		}
		active.push({ turn, approxTokens });
	}

	const keptActive = [...active];
	let approxTotalTokens = keptActive.reduce((sum, item) => sum + item.approxTokens, 0);
	const excludedItems: ContextCompilerExcludedItem[] = detached.map((item) => ({
		semanticTurnId: item.turn.semanticTurnId,
		reason: "detached",
		approxTokens: item.approxTokens,
	}));

	const tokenBudget =
		Number.isFinite(input.tokenBudget) && input.tokenBudget > 0
			? Math.floor(input.tokenBudget)
			: Number.MAX_SAFE_INTEGER;
	while (approxTotalTokens > tokenBudget && keptActive.length > 0) {
		const removed = keptActive.shift();
		if (!removed) {
			break;
		}
		approxTotalTokens -= removed.approxTokens;
		excludedItems.push({
			semanticTurnId: removed.turn.semanticTurnId,
			reason: "pruned_active",
			approxTokens: removed.approxTokens,
		});
	}

	const includedSemanticTurns = keptActive.map((item) => item.turn);
	const compiledItems: ContextCompilerIncludedItem[] = keptActive.map((item) => ({
		semanticTurnId: item.turn.semanticTurnId,
		reason: "active",
		approxTokens: item.approxTokens,
	}));

	return {
		includedTurns: flattenTurns(includedSemanticTurns),
		compiledItems,
		excludedItems,
		compiledTextPreview: buildCompiledPreview(includedSemanticTurns),
		approxTotalTokens,
	};
}
