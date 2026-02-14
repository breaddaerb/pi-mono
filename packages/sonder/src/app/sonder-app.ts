import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { type ParseTelegramCommandError, parseTelegramCommand } from "../commands/parse-command.js";
import { type AskResponder, AskService } from "../runtime/ask-service.js";
import { captureSnapshot } from "../snapshot/snapshot-service.js";
import {
	AnnotationsRepo,
	ArtifactsRepo,
	type CreateDatabaseOptions,
	createDatabase,
	DialogueRepo,
	ItemsRepo,
} from "../storage/index.js";
import type { Annotation, Artifact, Item, ItemSourceType } from "../types.js";

export interface SonderDialogueSessionInfo {
	itemId: string;
	sessionId: string;
	created: boolean;
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
	tags: string[];
	createdAt: string;
}

export type SonderCommandResult =
	| {
			type: "save";
			itemId: string;
			usedFallback: boolean;
			artifactIds: string[];
			url: string;
			tags: string[];
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

	constructor(private readonly options: SonderAppOptions) {
		const databasePath = options.paths.databasePath ?? join(options.paths.rootDir, "sonder.sqlite");
		this.dataRootDir = options.paths.dataRootDir ?? join(options.paths.rootDir, "data");
		mkdirSync(this.dataRootDir, { recursive: true });

		this.responder = options.responder;
		this.database = createDatabase({ databasePath } satisfies CreateDatabaseOptions);
		this.itemsRepo = new ItemsRepo(this.database);
		this.artifactsRepo = new ArtifactsRepo(this.database);
		this.annotationsRepo = new AnnotationsRepo(this.database);
		this.dialogueRepo = new DialogueRepo(this.database);
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

	listItemDialogues(itemId: string): Array<{ sessionId: string; createdAt: string; title: string }> {
		this.ensureItemExists(itemId);
		return this.dialogueRepo.listSessionsByItemId(itemId).map((session) => ({
			sessionId: session.id,
			createdAt: session.createdAt,
			title: session.title,
		}));
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

	async processCommand(input: string): Promise<SonderProcessResult> {
		const parsed = parseTelegramCommand(input);
		if (!parsed.ok) {
			return parsed;
		}

		try {
			if (parsed.value.type === "save") {
				const result = await this.handleSave(parsed.value.url, parsed.value.tags);
				return { ok: true, value: result };
			}
			if (parsed.value.type === "list") {
				return {
					ok: true,
					value: {
						type: "list",
						items: this.itemsRepo.listRecent(parsed.value.limit).map((item) => ({
							id: item.id,
							createdAt: item.createdAt,
							sourceType: item.sourceType,
							originalUrl: item.originalUrl,
							tags: item.tags,
						})),
					},
				};
			}
			if (parsed.value.type === "annotate") {
				const annotation = this.handleAnnotate(parsed.value.itemId, parsed.value.text, parsed.value.tags);
				return {
					ok: true,
					value: {
						type: "annotate",
						annotation,
					},
				};
			}
			if (parsed.value.type === "ann-list") {
				this.ensureItemExists(parsed.value.itemId);
				const annotations = this.annotationsRepo
					.listByItemId(parsed.value.itemId)
					.map((annotation) => this.toAnnotationItem(annotation));
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
				const deleted = this.annotationsRepo.deleteById(parsed.value.annotationId);
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

	private async handleSave(url: string, tags: string[]): Promise<Extract<SonderCommandResult, { type: "save" }>> {
		const now = (this.options.now ?? (() => new Date()))().toISOString();
		const itemId = randomUUID();
		const item: Item = {
			id: itemId,
			createdAt: now,
			sourceType: "web",
			originalUrl: url,
			whyNote: null,
			tags,
			topic: null,
			space: null,
		};
		this.itemsRepo.create(item);

		const snapshot = await captureSnapshot({
			itemId,
			url,
			dataRootDir: this.dataRootDir,
		});

		const artifactIds: string[] = [];
		const snapshotAssetsArtifact = this.createArtifact(
			itemId,
			"snapshot-assets",
			snapshot.snapshotAssetsDirectory,
			"application/json",
		);
		this.artifactsRepo.create(snapshotAssetsArtifact);
		artifactIds.push(snapshotAssetsArtifact.id);

		const extractedTextArtifact = this.createArtifact(
			itemId,
			"extracted-text",
			snapshot.extractedTextPath,
			"text/plain",
		);
		this.artifactsRepo.create(extractedTextArtifact);
		artifactIds.push(extractedTextArtifact.id);

		if (snapshot.snapshotHtmlPath) {
			const htmlArtifact = this.createArtifact(itemId, "snapshot-html", snapshot.snapshotHtmlPath, "text/html");
			this.artifactsRepo.create(htmlArtifact);
			artifactIds.push(htmlArtifact.id);
		}

		if (snapshot.screenshotFallbackPath) {
			const fallbackArtifact = this.createArtifact(
				itemId,
				"screenshot-fallback",
				snapshot.screenshotFallbackPath,
				"text/plain",
			);
			this.artifactsRepo.create(fallbackArtifact);
			artifactIds.push(fallbackArtifact.id);
		}

		return {
			type: "save",
			itemId,
			usedFallback: snapshot.usedFallback,
			artifactIds,
			url,
			tags,
		};
	}

	private handleAnnotate(itemId: string, text: string, tags: string[]): SonderAnnotationItem {
		this.ensureItemExists(itemId);
		const annotationId = randomUUID();
		const now = (this.options.now ?? (() => new Date()))().toISOString();
		const artifactId = this.selectAnnotationArtifactId(itemId);
		const annotation: Annotation = {
			id: annotationId,
			itemId,
			artifactId,
			type: "note",
			text,
			comment: null,
			color: null,
			tags,
			anchor: `item://${itemId}#note:${annotationId}`,
			createdAt: now,
			updatedAt: now,
		};
		this.annotationsRepo.create(annotation);
		return this.toAnnotationItem(annotation);
	}

	private selectAnnotationArtifactId(itemId: string): string {
		const artifacts = this.artifactsRepo.listByItemId(itemId);
		if (artifacts.length === 0) {
			throw new Error(`No artifacts found for item: ${itemId}`);
		}

		const extractedTextArtifact = artifacts.find((artifact) => artifact.kind === "extracted-text");
		if (extractedTextArtifact) {
			return extractedTextArtifact.id;
		}
		const snapshotHtmlArtifact = artifacts.find((artifact) => artifact.kind === "snapshot-html");
		if (snapshotHtmlArtifact) {
			return snapshotHtmlArtifact.id;
		}
		return artifacts[0].id;
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
			tags: annotation.tags,
			createdAt: annotation.createdAt,
		};
	}

	private createArtifact(itemId: string, kind: Artifact["kind"], path: string, mimeType: string): Artifact {
		const now = (this.options.now ?? (() => new Date()))().toISOString();
		return {
			id: randomUUID(),
			itemId,
			kind,
			path,
			mimeType,
			version: 1,
			createdAt: now,
		};
	}
}
