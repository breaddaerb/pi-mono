import { compileContextProjection } from "../runtime/context-compiler.js";
import { buildSemanticTurns } from "../runtime/semantic-turn-service.js";
import type { ContextMarkRepo, ContextTurnState, DialogueRepo } from "../storage/index.js";

export interface ContextControlTurn {
	semanticTurnId: string;
	createdAt: string;
	state: ContextTurnState;
	summary: string;
}

export interface ContextControlTurnPage {
	sessionId: string;
	page: number;
	pageSize: number;
	total: number;
	totalPages: number;
	turns: ContextControlTurn[];
}

export interface ContextControlDump {
	sessionId: string;
	tokenBudget: number;
	approxTotalTokens: number;
	compiledItems: Array<{ semanticTurnId: string; reason: "active"; approxTokens: number }>;
	excludedItems: Array<{
		semanticTurnId: string;
		reason: "detached" | "pruned_active";
		approxTokens: number;
	}>;
	compiledTextPreview: string;
}

export interface ContextControlServiceOptions {
	dialogueRepo: DialogueRepo;
	contextMarkRepo: ContextMarkRepo;
	now?: () => Date;
}

function buildStateMap(contextMarkRepo: ContextMarkRepo, sessionId: string): Map<string, ContextTurnState> {
	const marks = contextMarkRepo.listBySessionId(sessionId);
	return new Map<string, ContextTurnState>(marks.map((mark) => [mark.semanticTurnId, mark.state]));
}

export class ContextControlService {
	private readonly now: () => Date;

	constructor(private readonly options: ContextControlServiceOptions) {
		this.now = options.now ?? (() => new Date());
	}

	listTurns(sessionId: string, page = 0, pageSize = 10): ContextControlTurnPage {
		this.ensureSessionExists(sessionId);
		const semanticTurns = buildSemanticTurns(this.options.dialogueRepo.listTurnsBySessionId(sessionId));
		const stateByTurn = buildStateMap(this.options.contextMarkRepo, sessionId);
		const sorted = [...semanticTurns].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
		const safePageSize = Math.max(1, Math.floor(pageSize));
		const total = sorted.length;
		const totalPages = Math.max(1, Math.ceil(total / safePageSize));
		const safePage = Math.max(0, Math.min(Math.floor(page), totalPages - 1));
		const start = safePage * safePageSize;
		const pageTurns = sorted.slice(start, start + safePageSize);
		return {
			sessionId,
			page: safePage,
			pageSize: safePageSize,
			total,
			totalPages,
			turns: pageTurns.map((turn) => ({
				semanticTurnId: turn.semanticTurnId,
				createdAt: turn.createdAt,
				state: stateByTurn.get(turn.semanticTurnId) ?? "ACTIVE",
				summary: turn.summary,
			})),
		};
	}

	setTurnState(
		sessionId: string,
		semanticTurnId: string,
		state: ContextTurnState,
		updatedBy?: string | null,
	): boolean {
		this.ensureSemanticTurnExists(sessionId, semanticTurnId);
		this.options.contextMarkRepo.upsertState({
			sessionId,
			semanticTurnId,
			state,
			updatedAt: this.now().toISOString(),
			updatedBy: updatedBy ?? null,
		});
		return true;
	}

	detachLastTurn(sessionId: string, updatedBy?: string | null): string | null {
		this.ensureSessionExists(sessionId);
		const semanticTurns = buildSemanticTurns(this.options.dialogueRepo.listTurnsBySessionId(sessionId));
		const lastTurn = semanticTurns[semanticTurns.length - 1];
		if (!lastTurn) {
			return null;
		}
		this.options.contextMarkRepo.upsertState({
			sessionId,
			semanticTurnId: lastTurn.semanticTurnId,
			state: "DETACHED",
			updatedAt: this.now().toISOString(),
			updatedBy: updatedBy ?? null,
		});
		return lastTurn.semanticTurnId;
	}

	compileDump(sessionId: string, tokenBudget: number): ContextControlDump {
		this.ensureSessionExists(sessionId);
		const semanticTurns = buildSemanticTurns(this.options.dialogueRepo.listTurnsBySessionId(sessionId));
		const stateBySemanticTurnId = buildStateMap(this.options.contextMarkRepo, sessionId);
		const compiled = compileContextProjection({
			semanticTurns,
			stateBySemanticTurnId,
			tokenBudget,
		});
		return {
			sessionId,
			tokenBudget,
			approxTotalTokens: compiled.approxTotalTokens,
			compiledItems: compiled.compiledItems,
			excludedItems: compiled.excludedItems,
			compiledTextPreview: compiled.compiledTextPreview,
		};
	}

	private ensureSessionExists(sessionId: string): void {
		const session = this.options.dialogueRepo.findSessionById(sessionId);
		if (!session) {
			throw new Error(`Session not found: ${sessionId}`);
		}
	}

	private ensureSemanticTurnExists(sessionId: string, semanticTurnId: string): void {
		this.ensureSessionExists(sessionId);
		const semanticTurns = buildSemanticTurns(this.options.dialogueRepo.listTurnsBySessionId(sessionId));
		const exists = semanticTurns.some((turn) => turn.semanticTurnId === semanticTurnId);
		if (!exists) {
			throw new Error(`Semantic turn not found: ${semanticTurnId}`);
		}
	}
}
