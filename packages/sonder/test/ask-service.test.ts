import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AskService, createDatabase } from "../src/index.js";
import { AnnotationsRepo, ArtifactsRepo, DialogueRepo, ItemsRepo } from "../src/storage/index.js";
import type { Annotation, Artifact, Item } from "../src/types.js";

describe("AskService", () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		for (const directory of tempDirs) {
			rmSync(directory, { recursive: true, force: true });
		}
		tempDirs.length = 0;
	});

	it("builds annotation-first context and persists user+assistant turns", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-ask-"));
		tempDirs.push(root);

		const extractedPath = join(root, "data", "items", "item_1", "extracted.txt");
		mkdirSync(dirname(extractedPath), { recursive: true });
		writeFileSync(extractedPath, "Extracted article text body.", "utf8");

		const database = createDatabase({ databasePath: join(root, "sonder.sqlite") });
		const itemsRepo = new ItemsRepo(database);
		const artifactsRepo = new ArtifactsRepo(database);
		const annotationsRepo = new AnnotationsRepo(database);
		const dialogueRepo = new DialogueRepo(database);

		const item: Item = {
			id: "item_1",
			createdAt: "2026-02-14T02:00:00.000Z",
			sourceType: "web",
			originalUrl: "https://lucumr.pocoo.org/2026/2/9/a-language-for-agents",
			whyNote: null,
			tags: ["agents"],
			topic: null,
			space: null,
		};
		itemsRepo.create(item);

		const extractedArtifact: Artifact = {
			id: "art_extracted",
			itemId: item.id,
			kind: "extracted-text",
			path: extractedPath,
			mimeType: "text/plain",
			version: 1,
			createdAt: "2026-02-14T02:00:01.000Z",
		};
		artifactsRepo.create(extractedArtifact);

		const annotation: Annotation = {
			id: "ann_1",
			itemId: item.id,
			artifactId: extractedArtifact.id,
			type: "highlight",
			text: "Why New Languages Work",
			comment: "core point",
			color: "#ffd400",
			tags: ["core"],
			anchor: '{"type":"quote"}',
			createdAt: "2026-02-14T02:00:02.000Z",
			updatedAt: "2026-02-14T02:00:02.000Z",
		};
		annotationsRepo.create(annotation);

		let capturedPrompt = "";
		const askService = new AskService({
			itemsRepo,
			artifactsRepo,
			annotationsRepo,
			dialogueRepo,
			responder: async (input) => {
				capturedPrompt = input.prompt;
				return {
					answer: "Main thesis: design languages that optimize local reasoning. [ann:ann_1] [art:art_extracted]",
					model: "gpt-5",
					provider: "openai-codex",
					citations: ["ann:ann_1", "art:art_extracted"],
					thinking: "internal chain",
				};
			},
		});

		const result = await askService.ask(item.id, "What is the main thesis?");

		expect(result.answer).toContain("[ann:ann_1]");
		expect(result.citations).toEqual(["ann:ann_1", "art:art_extracted"]);
		expect(capturedPrompt).toContain("Annotation evidence (priority):");
		expect(capturedPrompt).toContain("[ann:ann_1]");
		expect(capturedPrompt).toContain("Extracted article text body.");

		const turns = dialogueRepo.listTurnsBySessionId(result.sessionId);
		expect(turns).toHaveLength(2);
		expect(turns[0].role).toBe("user");
		expect(turns[0].status).toBe("completed");
		expect(turns[1].role).toBe("assistant");
		expect(turns[1].status).toBe("completed");
		expect(turns[1].errorMessage).toBeNull();
		expect(turns[1].thinking).toBeNull();

		database.close();
	});

	it("rejects empty model answers", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-ask-"));
		tempDirs.push(root);
		const extractedPath = join(root, "data", "items", "item_0", "extracted.txt");
		mkdirSync(dirname(extractedPath), { recursive: true });
		writeFileSync(extractedPath, "Text", "utf8");

		const database = createDatabase({ databasePath: join(root, "sonder.sqlite") });
		const itemsRepo = new ItemsRepo(database);
		const artifactsRepo = new ArtifactsRepo(database);
		const annotationsRepo = new AnnotationsRepo(database);
		const dialogueRepo = new DialogueRepo(database);

		itemsRepo.create({
			id: "item_0",
			createdAt: "2026-02-14T03:00:00.000Z",
			sourceType: "web",
			originalUrl: "https://example.com",
			whyNote: null,
			tags: [],
			topic: null,
			space: null,
		});
		artifactsRepo.create({
			id: "art_extracted_0",
			itemId: "item_0",
			kind: "extracted-text",
			path: extractedPath,
			mimeType: "text/plain",
			version: 1,
			createdAt: "2026-02-14T03:00:01.000Z",
		});

		const askService = new AskService({
			itemsRepo,
			artifactsRepo,
			annotationsRepo,
			dialogueRepo,
			responder: async () => ({
				answer: "",
				model: "gpt-5",
				provider: "openai-codex",
				citations: [],
			}),
		});

		await expect(askService.ask("item_0", "Q?")).rejects.toThrow("Model returned an empty answer.");
		const sessionId = dialogueRepo.listSessionsByItemId("item_0")[0]?.id;
		if (!sessionId) {
			throw new Error("Expected session after failed ask");
		}
		const turns = dialogueRepo.listTurnsBySessionId(sessionId);
		expect(turns).toHaveLength(2);
		expect(turns[0].role).toBe("user");
		expect(turns[0].status).toBe("completed");
		expect(turns[1].role).toBe("assistant");
		expect(turns[1].status).toBe("failed");
		expect(turns[1].errorMessage).toContain("Model returned an empty answer");
		database.close();
	});

	it("persists failed assistant turn when responder throws", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-ask-"));
		tempDirs.push(root);
		const extractedPath = join(root, "data", "items", "item_throw", "extracted.txt");
		mkdirSync(dirname(extractedPath), { recursive: true });
		writeFileSync(extractedPath, "Text", "utf8");

		const database = createDatabase({ databasePath: join(root, "sonder.sqlite") });
		const itemsRepo = new ItemsRepo(database);
		const artifactsRepo = new ArtifactsRepo(database);
		const annotationsRepo = new AnnotationsRepo(database);
		const dialogueRepo = new DialogueRepo(database);

		itemsRepo.create({
			id: "item_throw",
			createdAt: "2026-02-14T03:30:00.000Z",
			sourceType: "web",
			originalUrl: "https://example.com",
			whyNote: null,
			tags: [],
			topic: null,
			space: null,
		});
		artifactsRepo.create({
			id: "art_extracted_throw",
			itemId: "item_throw",
			kind: "extracted-text",
			path: extractedPath,
			mimeType: "text/plain",
			version: 1,
			createdAt: "2026-02-14T03:30:01.000Z",
		});

		const askService = new AskService({
			itemsRepo,
			artifactsRepo,
			annotationsRepo,
			dialogueRepo,
			responder: async () => {
				throw new Error("provider timeout");
			},
		});

		await expect(askService.ask("item_throw", "Q?")).rejects.toThrow("provider timeout");
		const sessionId = dialogueRepo.listSessionsByItemId("item_throw")[0]?.id;
		if (!sessionId) {
			throw new Error("Expected session after failed ask");
		}
		const turns = dialogueRepo.listTurnsBySessionId(sessionId);
		expect(turns).toHaveLength(2);
		expect(turns[1].status).toBe("failed");
		expect(turns[1].errorMessage).toContain("provider timeout");

		database.close();
	});

	it("can persist thinking when explicitly enabled", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-ask-"));
		tempDirs.push(root);
		const extractedPath = join(root, "data", "items", "item_2", "extracted.txt");
		mkdirSync(dirname(extractedPath), { recursive: true });
		writeFileSync(extractedPath, "Text", "utf8");

		const database = createDatabase({ databasePath: join(root, "sonder.sqlite") });
		const itemsRepo = new ItemsRepo(database);
		const artifactsRepo = new ArtifactsRepo(database);
		const annotationsRepo = new AnnotationsRepo(database);
		const dialogueRepo = new DialogueRepo(database);

		itemsRepo.create({
			id: "item_2",
			createdAt: "2026-02-14T03:00:00.000Z",
			sourceType: "web",
			originalUrl: "https://example.com",
			whyNote: null,
			tags: [],
			topic: null,
			space: null,
		});
		artifactsRepo.create({
			id: "art_extracted_2",
			itemId: "item_2",
			kind: "extracted-text",
			path: extractedPath,
			mimeType: "text/plain",
			version: 1,
			createdAt: "2026-02-14T03:00:01.000Z",
		});

		const askService = new AskService(
			{
				itemsRepo,
				artifactsRepo,
				annotationsRepo,
				dialogueRepo,
				responder: async () => ({
					answer: "ok",
					model: "gpt-5",
					provider: "openai-codex",
					citations: ["art:art_extracted_2"],
					thinking: "stored thought",
				}),
			},
			{ persistThinking: true },
		);

		const result = await askService.ask("item_2", "Q?");
		expect(result.answer).toBe("ok");
		const turns = dialogueRepo.listTurnsBySessionId(result.sessionId);
		expect(turns[1].status).toBe("completed");
		expect(turns[1].errorMessage).toBeNull();
		expect(turns[1].thinking).toBe("stored thought");

		database.close();
	});
});
