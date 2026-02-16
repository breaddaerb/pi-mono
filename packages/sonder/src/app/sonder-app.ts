import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { type ParseTelegramCommandError, parseTelegramCommand } from "../commands/parse-command.js";
import { type AskResponder, AskService } from "../runtime/ask-service.js";
import { captureFromSource, type SourcePlatform, type SourceStatus } from "../sources/index.js";
import { cleanExtractedTextForPlatform, detectSourcePlatform } from "../sources/utils.js";
import {
	AnnotationsRepo,
	ArtifactsRepo,
	type CreateDatabaseOptions,
	createDatabase,
	DialogueRepo,
	ItemsRepo,
} from "../storage/index.js";
import type { Annotation, Artifact, DialogueTurnStatus, Item, ItemSourceType } from "../types.js";

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
	originalUrl: string;
	tags: string[];
	score: number;
	reasons: string[];
	snippets: string[];
}

export type SonderSaveSourceStatus = SourceStatus;

export type SonderSourcePlatform = SourcePlatform;

export type SonderEvidenceType = "snapshot" | "pasted_text" | "fallback_text";

export type SonderCommandResult =
	| {
			type: "save";
			itemId: string;
			usedFallback: boolean;
			artifactIds: string[];
			url: string;
			tags: string[];
			sourcePlatform: SonderSourcePlatform;
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
			status: turn.status,
			errorMessage: turn.errorMessage,
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

	async saveFromInput(input: {
		url: string;
		tags?: string[];
		pastedText?: string | null;
	}): Promise<Extract<SonderCommandResult, { type: "save" }>> {
		return this.handleSave(input.url, input.tags ?? [], input.pastedText ?? null);
	}

	async processCommand(input: string): Promise<SonderProcessResult> {
		const parsed = parseTelegramCommand(input);
		if (!parsed.ok) {
			return parsed;
		}

		try {
			if (parsed.value.type === "save") {
				const result = await this.handleSave(parsed.value.url, parsed.value.tags, parsed.value.pastedText);
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

	private async handleSave(
		url: string,
		tags: string[],
		pastedText: string | null,
	): Promise<Extract<SonderCommandResult, { type: "save" }>> {
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

		const sourceCapture = await captureFromSource({
			itemId,
			url,
			dataRootDir: this.dataRootDir,
			fetchImpl: this.options.snapshotFetchImpl,
		});
		const snapshot = sourceCapture.snapshot;

		const normalizedPastedText = this.normalizePastedText(pastedText);
		const autoDerivedEvidenceText = this.deriveAutoEvidenceText({
			platform: sourceCapture.platform,
			usable: sourceCapture.usable,
			extractedTextPath: snapshot.extractedTextPath,
		});
		const effectiveEvidenceText = normalizedPastedText ?? autoDerivedEvidenceText;
		const usePastedEvidence =
			Boolean(effectiveEvidenceText) &&
			(!sourceCapture.usable || this.shouldPreferPastedEvidenceForPlatform(sourceCapture.platform));
		let extractedTextPath = snapshot.extractedTextPath;
		let evidenceMdPath: string | null = null;
		if (usePastedEvidence && effectiveEvidenceText) {
			evidenceMdPath = join(snapshot.itemDirectory, "evidence.md");
			extractedTextPath = join(snapshot.itemDirectory, "evidence-extracted.txt");
			writeFileSync(evidenceMdPath, effectiveEvidenceText, "utf8");
			writeFileSync(extractedTextPath, effectiveEvidenceText, "utf8");
		}

		const artifactIds: string[] = [];
		const snapshotAssetsArtifact = this.createArtifact(
			itemId,
			"snapshot-assets",
			snapshot.snapshotAssetsDirectory,
			"application/json",
		);
		this.artifactsRepo.create(snapshotAssetsArtifact);
		artifactIds.push(snapshotAssetsArtifact.id);

		const extractedTextArtifact = this.createArtifact(itemId, "extracted-text", extractedTextPath, "text/plain");
		this.artifactsRepo.create(extractedTextArtifact);
		artifactIds.push(extractedTextArtifact.id);

		if (snapshot.snapshotHtmlPath && !usePastedEvidence) {
			const htmlArtifact = this.createArtifact(itemId, "snapshot-html", snapshot.snapshotHtmlPath, "text/html");
			this.artifactsRepo.create(htmlArtifact);
			artifactIds.push(htmlArtifact.id);
		}

		if (evidenceMdPath) {
			const evidenceArtifact = this.createArtifact(itemId, "evidence-md", evidenceMdPath, "text/markdown");
			this.artifactsRepo.create(evidenceArtifact);
			artifactIds.push(evidenceArtifact.id);
		}

		if (snapshot.screenshotFallbackPath && !usePastedEvidence) {
			const fallbackArtifact = this.createArtifact(
				itemId,
				"screenshot-fallback",
				snapshot.screenshotFallbackPath,
				"text/plain",
			);
			this.artifactsRepo.create(fallbackArtifact);
			artifactIds.push(fallbackArtifact.id);
		}

		const sourcePlatform = sourceCapture.platform;
		const sourceStatus = sourceCapture.status;
		const sourceStatusReason = sourceCapture.reason;
		const evidenceType: SonderEvidenceType = usePastedEvidence
			? "pasted_text"
			: sourceCapture.usable
				? "snapshot"
				: "fallback_text";

		return {
			type: "save",
			itemId,
			usedFallback: snapshot.usedFallback,
			artifactIds,
			url,
			tags,
			sourcePlatform,
			sourceStatus,
			sourceStatusReason,
			evidenceType,
			needsUserEvidence: !sourceCapture.usable && !usePastedEvidence,
		};
	}

	private findItems(query: string, limit: number): SonderFindItem[] {
		const normalizedQuery = query.trim().toLowerCase();
		if (!normalizedQuery) {
			return [];
		}
		const queryTerms = this.extractQueryTerms(normalizedQuery);
		if (queryTerms.length === 0) {
			return [];
		}
		const items = this.itemsRepo.listRecent(500);
		const scored: SonderFindItem[] = [];

		for (const item of items) {
			let score = 0;
			const reasonSet = new Set<string>();
			const snippets: string[] = [];

			const urlMatches = this.collectMatchedTerms(item.originalUrl.toLowerCase(), queryTerms);
			if (urlMatches.length > 0) {
				score += urlMatches.length * 5;
				if (item.originalUrl.toLowerCase().includes(normalizedQuery)) {
					score += 3;
				}
				reasonSet.add("url");
				this.pushSnippet(snippets, "url", item.originalUrl, urlMatches);
			}

			const tagsText = item.tags.join(" ");
			const tagMatches = this.collectMatchedTerms(tagsText.toLowerCase(), queryTerms);
			if (tagMatches.length > 0) {
				score += tagMatches.length * 7;
				reasonSet.add("tags");
				this.pushSnippet(snippets, "tags", tagsText, tagMatches);
			}

			const noteText = [item.whyNote, item.topic, item.space]
				.filter((part): part is string => Boolean(part))
				.join(" ");
			if (noteText.length > 0) {
				const noteMatches = this.collectMatchedTerms(noteText.toLowerCase(), queryTerms);
				if (noteMatches.length > 0) {
					score += noteMatches.length * 6;
					reasonSet.add("item-note");
					this.pushSnippet(snippets, "item-note", noteText, noteMatches);
				}
			}

			const annotations = this.annotationsRepo.listByItemId(item.id);
			for (const annotation of annotations) {
				const annotationText = `${annotation.text ?? ""} ${annotation.comment ?? ""}`.trim();
				if (annotationText.length > 0) {
					const annotationMatches = this.collectMatchedTerms(annotationText.toLowerCase(), queryTerms);
					if (annotationMatches.length > 0) {
						score += annotationMatches.length * 10;
						reasonSet.add("annotations");
						this.pushSnippet(snippets, "annotations", annotationText, annotationMatches);
					}
				}
				const annotationTagText = annotation.tags.join(" ");
				if (annotationTagText.length > 0) {
					const annotationTagMatches = this.collectMatchedTerms(annotationTagText.toLowerCase(), queryTerms);
					if (annotationTagMatches.length > 0) {
						score += annotationTagMatches.length * 8;
						reasonSet.add("annotation-tags");
						this.pushSnippet(snippets, "annotation-tags", annotationTagText, annotationTagMatches);
					}
				}
			}

			const extractedText = this.readExtractedTextForItem(item);
			if (extractedText.length > 0) {
				const contentMatches = this.collectMatchedTerms(extractedText.toLowerCase(), queryTerms);
				if (contentMatches.length > 0) {
					score += contentMatches.length * 2;
					if (extractedText.toLowerCase().includes(normalizedQuery)) {
						score += 2;
					}
					reasonSet.add("content");
					this.pushSnippet(snippets, "content", extractedText, contentMatches);
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
				reasons: [...reasonSet],
				snippets,
			});
		}

		scored.sort(
			(left, right) =>
				right.score - left.score ||
				right.originalUrl.localeCompare(left.originalUrl) ||
				right.id.localeCompare(left.id),
		);
		return scored.slice(0, Math.max(1, Math.floor(limit)));
	}

	private extractQueryTerms(query: string): string[] {
		const tokens = query
			.toLowerCase()
			.split(/[^\p{L}\p{N}_-]+/u)
			.map((token) => token.trim())
			.filter((token) => token.length >= 2);
		return [...new Set(tokens)];
	}

	private collectMatchedTerms(textLower: string, queryTerms: string[]): string[] {
		return queryTerms.filter((term) => textLower.includes(term));
	}

	private pushSnippet(snippets: string[], label: string, sourceText: string, matchedTerms: string[]): void {
		if (snippets.length >= 3 || matchedTerms.length === 0) {
			return;
		}
		const snippet = this.buildSnippet(sourceText, matchedTerms);
		if (!snippet) {
			return;
		}
		snippets.push(`${label}: ${snippet}`);
	}

	private buildSnippet(sourceText: string, matchedTerms: string[]): string | null {
		const compact = sourceText.replace(/\s+/g, " ").trim();
		if (!compact) {
			return null;
		}
		const lower = compact.toLowerCase();
		let matchIndex = -1;
		let matchLength = 0;
		for (const term of matchedTerms) {
			const index = lower.indexOf(term.toLowerCase());
			if (index >= 0) {
				matchIndex = index;
				matchLength = term.length;
				break;
			}
		}
		if (matchIndex < 0) {
			return compact.length <= 96 ? compact : `${compact.slice(0, 93)}...`;
		}
		const start = Math.max(0, matchIndex - 28);
		const end = Math.min(compact.length, matchIndex + matchLength + 48);
		const window = compact.slice(start, end).trim();
		const prefixed = start > 0 ? `...${window}` : window;
		const suffixed = end < compact.length ? `${prefixed}...` : prefixed;
		return suffixed.length <= 100 ? suffixed : `${suffixed.slice(0, 97)}...`;
	}

	private shouldPreferPastedEvidenceForPlatform(platform: SonderSourcePlatform): boolean {
		return platform === "twitter" || platform === "wechat";
	}

	private normalizePastedText(text: string | null): string | null {
		if (!text) {
			return null;
		}
		const normalized = text.replace(/\r\n/g, "\n").trim();
		return normalized.length > 0 ? normalized : null;
	}

	private deriveAutoEvidenceText(input: {
		platform: SonderSourcePlatform;
		usable: boolean;
		extractedTextPath: string;
	}): string | null {
		if (input.usable) {
			return null;
		}
		if (input.platform !== "xiaohongshu") {
			return null;
		}
		try {
			const rawText = readFileSync(input.extractedTextPath, "utf8");
			const cleaned = cleanExtractedTextForPlatform(input.platform, rawText).trim();
			if (cleaned.length >= 60) {
				return cleaned;
			}
			const fallbackCleaned = rawText
				.replaceAll(/沪ICP备\d+号?|沪B2-\d+|网信算备\d+号|沪网文\(\d{4}\)\d+-\d+号/gi, " ")
				.replaceAll(/\(沪\)网械平台备字\[\d{4}\]第\d+号|\(沪\)-经营性-\d{4}-\d+/gi, " ")
				.replaceAll(/上海市互联网举报中心|网上有害信息举报专区|行吟信息科技（上海）有限公司/gi, " ")
				.replaceAll(/地址：上海市黄浦区马当路388号C座|电话：\d+-\d+/gi, " ")
				.replaceAll(/©\s*\d{4}\s*-\s*\d{4}/gi, " ")
				.replaceAll(/小红书|创作中心|业务合作|发现|发布|通知|登录|更多/gi, " ")
				.replaceAll(/\s+/g, " ")
				.trim();
			if (fallbackCleaned.length < 60) {
				return null;
			}
			return fallbackCleaned;
		} catch {
			return null;
		}
	}

	private readExtractedTextForItem(item: Item): string {
		const artifact = this.artifactsRepo
			.listByItemId(item.id)
			.find((candidate) => candidate.kind === "extracted-text");
		if (!artifact) {
			return "";
		}
		try {
			const rawText = readFileSync(artifact.path, "utf8");
			const platform = detectSourcePlatform(item.originalUrl);
			return cleanExtractedTextForPlatform(platform, rawText);
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
