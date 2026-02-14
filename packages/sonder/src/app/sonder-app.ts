import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
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

export interface SonderDialogueTurnItem {
	id: string;
	sessionId: string;
	role: "user" | "assistant" | "system";
	content: string;
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
	originalUrl: string;
	tags: string[];
	score: number;
	reasons: string[];
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
			createdAt: turn.createdAt,
		}));
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
		this.ensureItemExists(input.itemId);
		const annotationId = randomUUID();
		const now = (this.options.now ?? (() => new Date()))().toISOString();
		const artifactId = this.selectAnnotationArtifactId(input.itemId);
		const annotation: Annotation = {
			id: annotationId,
			itemId: input.itemId,
			artifactId,
			type: input.type,
			text: input.text,
			comment: input.comment ?? null,
			color: input.color ?? null,
			tags: input.tags ?? [],
			anchor: input.anchor ?? `item://${input.itemId}#${input.type}:${annotationId}`,
			createdAt: now,
			updatedAt: now,
		};
		this.annotationsRepo.create(annotation);
		return this.toAnnotationItem(annotation);
	}

	listAnnotations(itemId: string): SonderAnnotationItem[] {
		this.ensureItemExists(itemId);
		return this.annotationsRepo.listByItemId(itemId).map((annotation) => this.toAnnotationItem(annotation));
	}

	updateAnnotation(input: {
		annotationId: string;
		text?: string | null;
		comment?: string | null;
		color?: string | null;
		tags?: string[];
		anchor?: string;
	}): SonderAnnotationItem {
		const existing = this.annotationsRepo.findById(input.annotationId);
		if (!existing) {
			throw new Error(`Annotation not found: ${input.annotationId}`);
		}
		const updated: Annotation = {
			...existing,
			text: input.text !== undefined ? input.text : existing.text,
			comment: input.comment !== undefined ? input.comment : existing.comment,
			color: input.color !== undefined ? input.color : existing.color,
			tags: input.tags ?? existing.tags,
			anchor: input.anchor ?? existing.anchor,
			updatedAt: (this.options.now ?? (() => new Date()))().toISOString(),
		};
		this.annotationsRepo.updateById(updated);
		return this.toAnnotationItem(updated);
	}

	deleteAnnotation(annotationId: string): boolean {
		return this.annotationsRepo.deleteById(annotationId);
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
			if (parsed.value.type === "find") {
				return {
					ok: true,
					value: {
						type: "find",
						query: parsed.value.query,
						items: this.findItems(parsed.value.query, parsed.value.limit),
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

	private findItems(query: string, limit: number): SonderFindItem[] {
		const normalizedQuery = query.trim().toLowerCase();
		if (!normalizedQuery) {
			return [];
		}
		const queryTerms = normalizedQuery.split(/\s+/).filter((term) => term.length > 0);
		const items = this.itemsRepo.listRecent(500);
		const scored: SonderFindItem[] = [];

		for (const item of items) {
			let score = 0;
			const reasons: string[] = [];
			const urlLower = item.originalUrl.toLowerCase();
			const tagsLower = item.tags.map((tag) => tag.toLowerCase());

			for (const term of queryTerms) {
				if (urlLower.includes(term)) {
					score += 3;
					if (!reasons.includes("url")) {
						reasons.push("url");
					}
				}
				if (tagsLower.some((tag) => tag.includes(term))) {
					score += 4;
					if (!reasons.includes("tags")) {
						reasons.push("tags");
					}
				}
			}

			const annotations = this.annotationsRepo.listByItemId(item.id);
			for (const annotation of annotations) {
				const text = `${annotation.text ?? ""} ${annotation.comment ?? ""}`.toLowerCase();
				for (const term of queryTerms) {
					if (text.includes(term)) {
						score += 5;
						if (!reasons.includes("annotations")) {
							reasons.push("annotations");
						}
					}
				}
			}

			const extractedText = this.readExtractedTextForItem(item.id).toLowerCase();
			for (const term of queryTerms) {
				if (term.length >= 3 && extractedText.includes(term)) {
					score += 2;
					if (!reasons.includes("content")) {
						reasons.push("content");
					}
				}
			}

			if (score <= 0) {
				continue;
			}
			scored.push({
				id: item.id,
				originalUrl: item.originalUrl,
				tags: item.tags,
				score,
				reasons,
			});
		}

		scored.sort((left, right) => right.score - left.score || right.id.localeCompare(left.id));
		return scored.slice(0, Math.max(1, Math.floor(limit)));
	}

	private readExtractedTextForItem(itemId: string): string {
		const artifact = this.artifactsRepo.listByItemId(itemId).find((candidate) => candidate.kind === "extracted-text");
		if (!artifact) {
			return "";
		}
		try {
			return readFileSync(artifact.path, "utf8");
		} catch {
			return "";
		}
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
			comment: annotation.comment,
			color: annotation.color,
			tags: annotation.tags,
			anchor: annotation.anchor,
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
