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
import type { Artifact, Item, ItemSourceType } from "../types.js";

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

	constructor(private readonly options: SonderAppOptions) {
		const databasePath = options.paths.databasePath ?? join(options.paths.rootDir, "sonder.sqlite");
		this.dataRootDir = options.paths.dataRootDir ?? join(options.paths.rootDir, "data");
		mkdirSync(this.dataRootDir, { recursive: true });

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
						items: this.itemsRepo.listRecent().map((item) => ({
							id: item.id,
							createdAt: item.createdAt,
							sourceType: item.sourceType,
							originalUrl: item.originalUrl,
							tags: item.tags,
						})),
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
