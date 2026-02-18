import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { type ParseTelegramCommandError, parseTelegramCommand } from "../commands/parse-command.js";
import { type AskResponder, AskService } from "../runtime/ask-service.js";
import {
	AnnotationsRepo,
	ArtifactsRepo,
	ChatModeStateRepo,
	type CreateDatabaseOptions,
	createDatabase,
	DialogueRepo,
	ItemsRepo,
	type StoredChatModeState,
} from "../storage/index.js";
import type { Annotation, DialogueTurnStatus, ItemSourceType } from "../types.js";
import { AnnotationService } from "./annotation-service.js";
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
	readonly askService: AskService;
	readonly dataRootDir: string;
	private readonly responder: AskResponder;
	private readonly chatModeStateRepo: ChatModeStateRepo;
	private readonly annotationService: AnnotationService;
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
		this.chatModeStateRepo = new ChatModeStateRepo(this.database);
		this.askService = new AskService(
			{
				itemsRepo: this.itemsRepo,
				artifactsRepo: this.artifactsRepo,
				annotationsRepo: this.annotationsRepo,
				dialogueRepo: this.dialogueRepo,
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
		this.ensureItemExists(itemId);
		const ensured = this.askService.ensureSession(itemId, preferredSessionId);
		return {
			itemId,
			sessionId: ensured.sessionId,
			created: ensured.created,
		};
	}

	createItemDialogue(itemId: string): SonderDialogueSessionInfo {
		this.ensureItemExists(itemId);
		const created = this.askService.createSession(itemId);
		return {
			itemId,
			sessionId: created.sessionId,
			created: true,
		};
	}

	listItemDialogues(itemId: string): Array<{ sessionId: string; createdAt: string; title: string }> {
		this.ensureItemExists(itemId);
		return this.dialogueRepo.listSessionsByItemId(itemId).map((session) => ({
			sessionId: session.id,
			createdAt: session.createdAt,
			title: session.title,
		}));
	}

	listDialogueHistory(sessionId: string, limit = 20): SonderDialogueTurnItem[] {
		const session = this.dialogueRepo.findSessionById(sessionId);
		if (!session) {
			throw new Error(`Session not found: ${sessionId}`);
		}
		const turns = this.dialogueRepo.listTurnsBySessionId(sessionId);
		const start = Math.max(0, turns.length - Math.max(1, Math.floor(limit)));
		return turns.slice(start).map((turn) => ({
			id: turn.id,
			sessionId: turn.sessionId,
			role: turn.role,
			content: turn.content,
			status: turn.status,
			errorMessage: turn.errorMessage,
			createdAt: turn.createdAt,
		}));
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
		return this.itemsRepo.findById(itemId) !== null;
	}

	isSessionForItem(itemId: string, sessionId: string): boolean {
		const session = this.dialogueRepo.findSessionById(sessionId);
		return Boolean(session && session.itemId === itemId);
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
		const session = this.dialogueRepo.findSessionById(sessionId);
		if (!session) {
			throw new Error(`Session not found: ${sessionId}`);
		}
		return {
			itemId: session.itemId,
			sessionId: session.id,
			created: false,
		};
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

	private ensureItemExists(itemId: string): void {
		if (!this.itemsRepo.findById(itemId)) {
			throw new Error(`Item not found: ${itemId}`);
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
