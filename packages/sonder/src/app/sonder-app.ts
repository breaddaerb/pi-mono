import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { type ParseTelegramCommandError, parseTelegramCommand } from "../commands/parse-command.js";
import { type AskResponder, AskService } from "../runtime/ask-service.js";
import {
	AnnotationsRepo,
	ArtifactsRepo,
	ChatModeStateRepo,
	ContextMarkRepo,
	type ContextTurnState,
	type CreateDatabaseOptions,
	createDatabase,
	DialogueRepo,
	ItemsRepo,
	type StoredChatModeState,
} from "../storage/index.js";
import type { Annotation, DialogueTurnStatus, ItemSourceType } from "../types.js";
import { AnnotationService } from "./annotation-service.js";
import { ContextControlService } from "./context-control-service.js";
import { DialogueService } from "./dialogue-service.js";
import { DiscoveryService } from "./discovery-service.js";
import {
	type SaveEvidenceType,
	SaveService,
	type SaveSourceAcquisitionMethod,
	type SaveSourcePlatform,
	type SaveSourceStatus,
} from "./save-service.js";

export interface SonderDialogueSessionInfo {
	itemId: string;
	sessionId: string;
	created: boolean;
}

export interface SonderDeleteItemResult {
	itemId: string;
	deleted: boolean;
}

export interface SonderGeneralChatTurn {
	role: "user" | "assistant";
	content: string;
}

export interface SonderGeneralChatResult {
	sessionId: string;
	answer: string;
	model: string;
	provider: string;
	citations: string[];
}

export interface SonderDialogueTurnItem {
	id: string;
	sessionId: string;
	role: "user" | "assistant" | "system";
	content: string;
	status: DialogueTurnStatus;
	errorMessage: string | null;
	createdAt: string;
}

export interface SonderContextTurnItem {
	semanticTurnId: string;
	createdAt: string;
	state: ContextTurnState;
	summary: string;
}

export interface SonderContextTurnPage {
	sessionId: string;
	page: number;
	pageSize: number;
	total: number;
	totalPages: number;
	turns: SonderContextTurnItem[];
}

export interface SonderContextDump {
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

export interface SonderAppPaths {
	rootDir: string;
	databasePath?: string;
	dataRootDir?: string;
}

export interface SonderAppOptions {
	paths: SonderAppPaths;
	responder: AskResponder;
	persistThinking?: boolean;
	now?: () => Date;
	snapshotFetchImpl?: typeof fetch;
}

export interface SonderListItem {
	id: string;
	createdAt: string;
	sourceType: ItemSourceType;
	originalUrl: string;
	tags: string[];
}

export interface SonderAnnotationItem {
	id: string;
	itemId: string;
	artifactId: string;
	type: Annotation["type"];
	text: string | null;
	comment: string | null;
	color: string | null;
	tags: string[];
	anchor: string;
	createdAt: string;
}

export interface SonderFindItem {
	id: string;
	createdAt: string;
	sourceType: ItemSourceType;
	originalUrl: string;
	tags: string[];
	score: number;
	reasons: string[];
	snippets: string[];
}

export type SonderSaveSourceStatus = SaveSourceStatus;

export type SonderSaveAcquisitionMethod = SaveSourceAcquisitionMethod;

export type SonderSourcePlatform = SaveSourcePlatform;

export type SonderEvidenceType = SaveEvidenceType;

export type SonderCommandResult =
	| {
			type: "save";
			itemId: string;
			usedFallback: boolean;
			artifactIds: string[];
			url: string;
			tags: string[];
			sourcePlatform: SonderSourcePlatform;
			sourceAcquisitionMethod: SonderSaveAcquisitionMethod;
			sourceStatus: SonderSaveSourceStatus;
			sourceStatusReason: string | null;
			evidenceType: SonderEvidenceType;
			needsUserEvidence: boolean;
	  }
	| {
			type: "ask";
			itemId: string;
			sessionId: string;
			userTurnId: string;
			assistantTurnId: string;
			answer: string;
			citations: string[];
	  }
	| {
			type: "list";
			items: SonderListItem[];
	  }
	| {
			type: "find";
			query: string;
			items: SonderFindItem[];
	  }
	| {
			type: "annotate";
			annotation: SonderAnnotationItem;
	  }
	| {
			type: "ann-list";
			itemId: string;
			annotations: SonderAnnotationItem[];
	  }
	| {
			type: "ann-del";
			annotationId: string;
	  };

export type SonderCommandError = ParseTelegramCommandError | { code: "RUNTIME_ERROR"; message: string };

export type SonderProcessResult = { ok: true; value: SonderCommandResult } | { ok: false; error: SonderCommandError };

export class SonderApp {
	readonly database: DatabaseSync;
	readonly itemsRepo: ItemsRepo;
	readonly artifactsRepo: ArtifactsRepo;
	readonly annotationsRepo: AnnotationsRepo;
	readonly dialogueRepo: DialogueRepo;
	readonly contextMarkRepo: ContextMarkRepo;
	readonly askService: AskService;
	readonly dataRootDir: string;
	private readonly responder: AskResponder;
	private readonly chatModeStateRepo: ChatModeStateRepo;
	private readonly annotationService: AnnotationService;
	private readonly contextControlService: ContextControlService;
	private readonly dialogueService: DialogueService;
	private readonly discoveryService: DiscoveryService;
	private readonly saveService: SaveService;

	constructor(options: SonderAppOptions) {
		const databasePath = options.paths.databasePath ?? join(options.paths.rootDir, "sonder.sqlite");
		this.dataRootDir = options.paths.dataRootDir ?? join(options.paths.rootDir, "data");
		mkdirSync(this.dataRootDir, { recursive: true });

		this.responder = options.responder;
		this.database = createDatabase({ databasePath } satisfies CreateDatabaseOptions);
		this.itemsRepo = new ItemsRepo(this.database);
		this.artifactsRepo = new ArtifactsRepo(this.database);
		this.annotationsRepo = new AnnotationsRepo(this.database);
		this.dialogueRepo = new DialogueRepo(this.database);
		this.contextMarkRepo = new ContextMarkRepo(this.database);
		this.chatModeStateRepo = new ChatModeStateRepo(this.database);
		this.askService = new AskService(
			{
				itemsRepo: this.itemsRepo,
				artifactsRepo: this.artifactsRepo,
				annotationsRepo: this.annotationsRepo,
				dialogueRepo: this.dialogueRepo,
				contextMarkRepo: this.contextMarkRepo,
				responder: options.responder,
			},
			{ persistThinking: options.persistThinking, now: options.now },
		);
		this.annotationService = new AnnotationService({
			annotationsRepo: this.annotationsRepo,
			artifactsRepo: this.artifactsRepo,
			itemsRepo: this.itemsRepo,
			now: options.now,
		});
		this.contextControlService = new ContextControlService({
			dialogueRepo: this.dialogueRepo,
			contextMarkRepo: this.contextMarkRepo,
			now: options.now,
		});
		this.dialogueService = new DialogueService({
			itemsRepo: this.itemsRepo,
			dialogueRepo: this.dialogueRepo,
			askService: this.askService,
		});
		this.discoveryService = new DiscoveryService({
			itemsRepo: this.itemsRepo,
			artifactsRepo: this.artifactsRepo,
			annotationsRepo: this.annotationsRepo,
		});
		this.saveService = new SaveService({
			database: this.database,
			itemsRepo: this.itemsRepo,
			artifactsRepo: this.artifactsRepo,
			dataRootDir: this.dataRootDir,
			now: options.now,
			snapshotFetchImpl: options.snapshotFetchImpl,
		});
	}

	openItemDialogue(itemId: string, preferredSessionId?: string): SonderDialogueSessionInfo {
		return this.dialogueService.openItemDialogue(itemId, preferredSessionId);
	}

	createItemDialogue(itemId: string): SonderDialogueSessionInfo {
		return this.dialogueService.createItemDialogue(itemId);
	}

	listItemDialogues(itemId: string): Array<{ sessionId: string; createdAt: string; title: string }> {
		return this.dialogueService.listItemDialogues(itemId);
	}

	listDialogueHistory(sessionId: string, limit = 20): SonderDialogueTurnItem[] {
		return this.dialogueService.listDialogueHistory(sessionId, limit);
	}

	listContextTurns(sessionId: string, page = 0, pageSize = 10): SonderContextTurnPage {
		return this.contextControlService.listTurns(sessionId, page, pageSize);
	}

	setContextTurnState(sessionId: string, semanticTurnId: string, state: ContextTurnState): boolean {
		return this.contextControlService.setTurnState(sessionId, semanticTurnId, state);
	}

	detachLastContextTurn(sessionId: string): string | null {
		return this.contextControlService.detachLastTurn(sessionId);
	}

	compileContextDump(sessionId: string, tokenBudget: number): SonderContextDump {
		return this.contextControlService.compileDump(sessionId, tokenBudget);
	}

	loadChatModeState(chatId: number): StoredChatModeState | null {
		return this.chatModeStateRepo.findByChatId(chatId);
	}

	saveChatModeState(state: Omit<StoredChatModeState, "updatedAt">, updatedAt: string): void {
		this.chatModeStateRepo.upsert(state, updatedAt);
	}

	clearChatModeState(chatId: number): boolean {
		return this.chatModeStateRepo.deleteByChatId(chatId);
	}

	hasItem(itemId: string): boolean {
		return this.dialogueService.hasItem(itemId);
	}

	isSessionForItem(itemId: string, sessionId: string): boolean {
		return this.dialogueService.isSessionForItem(itemId, sessionId);
	}

	createAnnotation(input: {
		itemId: string;
		type: Annotation["type"];
		text: string | null;
		comment?: string | null;
		color?: string | null;
		tags?: string[];
		anchor?: string;
	}): SonderAnnotationItem {
		const annotation = this.annotationService.create(input);
		return this.toAnnotationItem(annotation);
	}

	listAnnotations(itemId: string): SonderAnnotationItem[] {
		return this.annotationService.list(itemId).map((annotation) => this.toAnnotationItem(annotation));
	}

	deleteItem(itemId: string): SonderDeleteItemResult {
		const item = this.itemsRepo.findById(itemId);
		if (!item) {
			return { itemId, deleted: false };
		}
		const deleted = this.itemsRepo.deleteById(itemId);
		if (deleted) {
			const itemDirectory = join(this.dataRootDir, "items", itemId);
			rmSync(itemDirectory, { recursive: true, force: true });
		}
		return { itemId, deleted };
	}

	updateAnnotation(input: {
		annotationId: string;
		text?: string | null;
		comment?: string | null;
		color?: string | null;
		tags?: string[];
		anchor?: string;
	}): SonderAnnotationItem {
		const updated = this.annotationService.update(input);
		return this.toAnnotationItem(updated);
	}

	deleteAnnotation(annotationId: string): boolean {
		return this.annotationService.delete(annotationId);
	}

	resumeItemDialogue(sessionId: string): SonderDialogueSessionInfo {
		return this.dialogueService.resumeItemDialogue(sessionId);
	}

	async askInItemDialogue(
		itemId: string,
		sessionId: string,
		question: string,
	): Promise<Extract<SonderCommandResult, { type: "ask" }>> {
		const askResult = await this.askService.askInSession(itemId, question, sessionId);
		return {
			type: "ask",
			itemId,
			sessionId: askResult.sessionId,
			userTurnId: askResult.userTurnId,
			assistantTurnId: askResult.assistantTurnId,
			answer: askResult.answer,
			citations: askResult.citations,
		};
	}

	async chatWithoutItem(
		sessionId: string,
		question: string,
		history: SonderGeneralChatTurn[],
	): Promise<SonderGeneralChatResult> {
		const historyLines = history.map((turn) => `${turn.role}: ${turn.content}`).join("\n");
		const prompt = [
			"You are in a general conversation mode without a specific item.",
			historyLines ? `Conversation history:\n${historyLines}` : "Conversation history: (none)",
			`User: ${question}`,
		].join("\n\n");
		const response = await this.responder({
			itemId: `general:${sessionId}`,
			question,
			prompt,
			context: {
				item: {
					id: `general:${sessionId}`,
					createdAt: new Date().toISOString(),
					sourceType: "web",
					originalUrl: "about:blank",
					whyNote: null,
					tags: [],
					topic: null,
					space: null,
				},
				annotationEvidence: [],
				dialogueHistory: [],
				extractedText: "",
			},
		});
		return {
			sessionId,
			answer: response.answer,
			model: response.model,
			provider: response.provider,
			citations: response.citations,
		};
	}

	close(): void {
		this.database.close();
	}

	async saveFromInput(input: {
		url: string;
		tags?: string[];
		pastedText?: string | null;
	}): Promise<Extract<SonderCommandResult, { type: "save" }>> {
		const saved = await this.saveService.save({
			url: input.url,
			tags: input.tags ?? [],
			pastedText: input.pastedText ?? null,
		});
		return {
			type: "save",
			...saved,
		};
	}

	async processCommand(input: string): Promise<SonderProcessResult> {
		const parsed = parseTelegramCommand(input);
		if (!parsed.ok) {
			return parsed;
		}

		try {
			if (parsed.value.type === "save") {
				const result = await this.saveFromInput({
					url: parsed.value.url,
					tags: parsed.value.tags,
					pastedText: parsed.value.pastedText,
				});
				return { ok: true, value: result };
			}
			if (parsed.value.type === "list") {
				return {
					ok: true,
					value: {
						type: "list",
						items: this.discoveryService.listItems(parsed.value.limit),
					},
				};
			}
			if (parsed.value.type === "find") {
				return {
					ok: true,
					value: {
						type: "find",
						query: parsed.value.query,
						items: this.discoveryService.findItems(parsed.value.query, parsed.value.limit),
					},
				};
			}
			if (parsed.value.type === "annotate") {
				const annotation = this.createAnnotation({
					itemId: parsed.value.itemId,
					type: "note",
					text: parsed.value.text,
					tags: parsed.value.tags,
					anchor: undefined,
				});
				return {
					ok: true,
					value: {
						type: "annotate",
						annotation,
					},
				};
			}
			if (parsed.value.type === "ann-list") {
				const annotations = this.listAnnotations(parsed.value.itemId);
				return {
					ok: true,
					value: {
						type: "ann-list",
						itemId: parsed.value.itemId,
						annotations,
					},
				};
			}
			if (parsed.value.type === "ann-del") {
				const deleted = this.deleteAnnotation(parsed.value.annotationId);
				if (!deleted) {
					throw new Error(`Annotation not found: ${parsed.value.annotationId}`);
				}
				return {
					ok: true,
					value: {
						type: "ann-del",
						annotationId: parsed.value.annotationId,
					},
				};
			}

			const askResult = await this.askService.ask(parsed.value.itemId, parsed.value.question);
			return {
				ok: true,
				value: {
					type: "ask",
					itemId: parsed.value.itemId,
					sessionId: askResult.sessionId,
					userTurnId: askResult.userTurnId,
					assistantTurnId: askResult.assistantTurnId,
					answer: askResult.answer,
					citations: askResult.citations,
				},
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { ok: false, error: { code: "RUNTIME_ERROR", message } };
		}
	}

	private toAnnotationItem(annotation: Annotation): SonderAnnotationItem {
		return {
			id: annotation.id,
			itemId: annotation.itemId,
			artifactId: annotation.artifactId,
			type: annotation.type,
			text: annotation.text,
			comment: annotation.comment,
			color: annotation.color,
			tags: annotation.tags,
			anchor: annotation.anchor,
			createdAt: annotation.createdAt,
		};
	}
}
