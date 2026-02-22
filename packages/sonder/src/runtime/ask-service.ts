import { randomUUID } from "node:crypto";
import type {
	AnnotationsRepo,
	ArtifactsRepo,
	ContextMarkRepo,
	ContextTurnState,
	DialogueRepo,
	ItemsRepo,
} from "../storage/index.js";
import type { DialogueSession, DialogueTurn } from "../types.js";
import { type AskContext, buildAskContext, renderAskPrompt } from "./context-builder.js";
import { compileContextProjection } from "./context-compiler.js";
import { buildSemanticTurns } from "./semantic-turn-service.js";

export interface AskResponderInput {
	itemId: string;
	question: string;
	prompt: string;
	context: AskContext;
}

export interface AskResponderOutput {
	answer: string;
	model: string;
	provider: string;
	citations: string[];
	thinking?: string;
}

export type AskResponder = (input: AskResponderInput) => Promise<AskResponderOutput>;

export interface AskServiceDependencies {
	itemsRepo: ItemsRepo;
	artifactsRepo: ArtifactsRepo;
	annotationsRepo: AnnotationsRepo;
	dialogueRepo: DialogueRepo;
	contextMarkRepo?: ContextMarkRepo;
	responder: AskResponder;
}

export interface AskServiceOptions {
	persistThinking?: boolean;
	now?: () => Date;
	maxExtractedTextCharacters?: number;
	dialogueContextTokenBudget?: number;
}

export interface AskResult {
	sessionId: string;
	userTurnId: string;
	assistantTurnId: string;
	answer: string;
	citations: string[];
}

export interface EnsureSessionResult {
	sessionId: string;
	created: boolean;
}

export class AskService {
	private readonly persistThinking: boolean;
	private readonly now: () => Date;
	private readonly maxExtractedTextCharacters: number | undefined;
	private readonly dialogueContextTokenBudget: number;

	constructor(
		private readonly dependencies: AskServiceDependencies,
		options: AskServiceOptions = {},
	) {
		this.persistThinking = options.persistThinking ?? false;
		this.now = options.now ?? (() => new Date());
		if (options.maxExtractedTextCharacters !== undefined) {
			this.maxExtractedTextCharacters = Math.max(1, Math.floor(options.maxExtractedTextCharacters));
		}
		this.dialogueContextTokenBudget =
			options.dialogueContextTokenBudget !== undefined && Number.isFinite(options.dialogueContextTokenBudget)
				? Math.max(1, Math.floor(options.dialogueContextTokenBudget))
				: 12_000;
	}

	async ask(itemId: string, question: string): Promise<AskResult> {
		return this.askInSession(itemId, question);
	}

	async askInSession(itemId: string, question: string, sessionId?: string): Promise<AskResult> {
		const item = this.dependencies.itemsRepo.findById(itemId);
		if (!item) {
			throw new Error(`Item not found: ${itemId}`);
		}

		const { session } = this.getOrCreateSession(itemId, sessionId);
		const priorTurns = this.dependencies.dialogueRepo.listTurnsBySessionId(session.id);
		const semanticTurns = buildSemanticTurns(priorTurns);
		const stateBySemanticTurnId = this.buildContextStateMap(session.id);
		const compiledContext = compileContextProjection({
			semanticTurns,
			stateBySemanticTurnId,
			tokenBudget: this.dialogueContextTokenBudget,
		});
		const annotations = this.dependencies.annotationsRepo.listByItemId(itemId);
		const artifacts = this.dependencies.artifactsRepo.listByItemId(itemId);
		const extractedTextArtifact = artifacts.find((artifact) => artifact.kind === "extracted-text") ?? null;

		const context = buildAskContext({
			item,
			annotations,
			dialogueTurns: compiledContext.includedTurns,
			extractedTextPath: extractedTextArtifact?.path ?? null,
			maxExtractedTextCharacters: this.maxExtractedTextCharacters,
		});
		const prompt = renderAskPrompt(question, context);

		const userTurn = this.createTurn({
			sessionId: session.id,
			role: "user",
			content: question,
			model: "user",
			provider: "telegram",
			citations: [],
			thinking: null,
			status: "completed",
			errorMessage: null,
		});
		this.dependencies.dialogueRepo.createTurn(userTurn);

		const assistantTurn = this.createTurn({
			sessionId: session.id,
			role: "assistant",
			content: "",
			model: "pending-response",
			provider: "pending-response",
			citations: [],
			thinking: null,
			status: "pending",
			errorMessage: null,
		});
		this.dependencies.dialogueRepo.createTurn(assistantTurn);

		try {
			const response = await this.dependencies.responder({
				itemId,
				question,
				prompt,
				context,
			});

			if (response.answer.trim().length === 0) {
				throw new Error("Model returned an empty answer.");
			}

			const assistantAnswer = response.answer;
			const markedCompleted = this.dependencies.dialogueRepo.markTurnCompleted({
				turnId: assistantTurn.id,
				content: assistantAnswer,
				model: response.model,
				provider: response.provider,
				citations: response.citations,
				thinking: this.persistThinking ? (response.thinking ?? null) : null,
			});
			if (!markedCompleted) {
				throw new Error(`Failed to mark assistant turn as completed: ${assistantTurn.id}`);
			}

			return {
				sessionId: session.id,
				userTurnId: userTurn.id,
				assistantTurnId: assistantTurn.id,
				answer: assistantAnswer,
				citations: response.citations,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const markedFailed = this.dependencies.dialogueRepo.markTurnFailed({
				turnId: assistantTurn.id,
				errorMessage: message,
			});
			if (!markedFailed) {
				throw new Error(`Failed to persist failed assistant turn ${assistantTurn.id}. Original error: ${message}`);
			}
			throw error;
		}
	}

	ensureSession(itemId: string, preferredSessionId?: string): EnsureSessionResult {
		const { session, created } = this.getOrCreateSession(itemId, preferredSessionId);
		return { sessionId: session.id, created };
	}

	createSession(itemId: string): EnsureSessionResult {
		const item = this.dependencies.itemsRepo.findById(itemId);
		if (!item) {
			throw new Error(`Item not found: ${itemId}`);
		}
		const session = this.createSessionRecord(itemId);
		return { sessionId: session.id, created: true };
	}

	private buildContextStateMap(sessionId: string): Map<string, ContextTurnState> {
		const contextMarkRepo = this.dependencies.contextMarkRepo;
		if (!contextMarkRepo) {
			return new Map<string, ContextTurnState>();
		}
		const marks = contextMarkRepo.listBySessionId(sessionId);
		return new Map<string, ContextTurnState>(marks.map((mark) => [mark.semanticTurnId, mark.state]));
	}

	private getOrCreateSession(
		itemId: string,
		preferredSessionId?: string,
	): { session: DialogueSession; created: boolean } {
		if (preferredSessionId) {
			const preferred = this.dependencies.dialogueRepo.findSessionById(preferredSessionId);
			if (!preferred) {
				throw new Error(`Session not found: ${preferredSessionId}`);
			}
			if (preferred.itemId !== itemId) {
				throw new Error(`Session ${preferredSessionId} does not belong to item ${itemId}`);
			}
			return { session: preferred, created: false };
		}

		const existing = this.dependencies.dialogueRepo.listSessionsByItemId(itemId)[0];
		if (existing) {
			return { session: existing, created: false };
		}

		const session = this.createSessionRecord(itemId);
		return { session, created: true };
	}

	private createSessionRecord(itemId: string): DialogueSession {
		const session: DialogueSession = {
			id: randomUUID(),
			itemId,
			title: `Item ${itemId}`,
			createdAt: this.now().toISOString(),
		};
		this.dependencies.dialogueRepo.createSession(session);
		return session;
	}

	private createTurn(input: Omit<DialogueTurn, "id" | "createdAt">): DialogueTurn {
		return {
			id: randomUUID(),
			createdAt: this.now().toISOString(),
			...input,
		};
	}
}
