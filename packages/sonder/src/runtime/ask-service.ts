import { randomUUID } from "node:crypto";
import type { AnnotationsRepo, ArtifactsRepo, DialogueRepo, ItemsRepo } from "../storage/index.js";
import type { DialogueSession, DialogueTurn } from "../types.js";
import { type AskContext, buildAskContext, renderAskPrompt } from "./context-builder.js";

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
	responder: AskResponder;
}

export interface AskServiceOptions {
	persistThinking?: boolean;
	now?: () => Date;
}

export interface AskResult {
	sessionId: string;
	userTurnId: string;
	assistantTurnId: string;
	answer: string;
	citations: string[];
}

function ensureInlineReferences(answer: string, citations: string[]): string {
	if (citations.length === 0) {
		return answer;
	}
	const hasInlineReferences = citations.some((citation) => answer.includes(`[${citation}]`));
	if (hasInlineReferences) {
		return answer;
	}
	const suffix = citations.map((citation) => `[${citation}]`).join(" ");
	return `${answer}\n\nEvidence: ${suffix}`;
}

export class AskService {
	private readonly persistThinking: boolean;
	private readonly now: () => Date;

	constructor(
		private readonly dependencies: AskServiceDependencies,
		options: AskServiceOptions = {},
	) {
		this.persistThinking = options.persistThinking ?? false;
		this.now = options.now ?? (() => new Date());
	}

	async ask(itemId: string, question: string): Promise<AskResult> {
		const item = this.dependencies.itemsRepo.findById(itemId);
		if (!item) {
			throw new Error(`Item not found: ${itemId}`);
		}

		const session = this.getOrCreateSession(itemId);
		const priorTurns = this.dependencies.dialogueRepo.listTurnsBySessionId(session.id);
		const annotations = this.dependencies.annotationsRepo.listByItemId(itemId);
		const artifacts = this.dependencies.artifactsRepo.listByItemId(itemId);
		const extractedTextArtifact = artifacts.find((artifact) => artifact.kind === "extracted-text") ?? null;

		const context = buildAskContext({
			item,
			annotations,
			dialogueTurns: priorTurns,
			extractedTextPath: extractedTextArtifact?.path ?? null,
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
		});
		this.dependencies.dialogueRepo.createTurn(userTurn);

		const response = await this.dependencies.responder({
			itemId,
			question,
			prompt,
			context,
		});

		const assistantAnswer = ensureInlineReferences(response.answer, response.citations);
		const assistantTurn = this.createTurn({
			sessionId: session.id,
			role: "assistant",
			content: assistantAnswer,
			model: response.model,
			provider: response.provider,
			citations: response.citations,
			thinking: this.persistThinking ? (response.thinking ?? null) : null,
		});
		this.dependencies.dialogueRepo.createTurn(assistantTurn);

		return {
			sessionId: session.id,
			userTurnId: userTurn.id,
			assistantTurnId: assistantTurn.id,
			answer: assistantAnswer,
			citations: response.citations,
		};
	}

	private getOrCreateSession(itemId: string): DialogueSession {
		const existing = this.dependencies.dialogueRepo.listSessionsByItemId(itemId)[0];
		if (existing) {
			return existing;
		}

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
