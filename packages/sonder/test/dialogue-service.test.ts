import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DialogueService } from "../src/app/dialogue-service.js";
import { AskService } from "../src/runtime/ask-service.js";
import {
	AnnotationsRepo,
	ArtifactsRepo,
	createDatabase,
	DialogueRepo,
	ItemContentRepo,
	ItemsRepo,
} from "../src/storage/index.js";

describe("DialogueService", () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		for (const directory of tempDirs) {
			rmSync(directory, { recursive: true, force: true });
		}
		tempDirs.length = 0;
	});

	it("opens, lists, resumes, and reads history for item sessions", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-dialogue-service-"));
		tempDirs.push(root);
		const database = createDatabase({ databasePath: join(root, "sonder.sqlite") });
		const itemsRepo = new ItemsRepo(database);
		const artifactsRepo = new ArtifactsRepo(database);
		const itemContentRepo = new ItemContentRepo(database);
		const annotationsRepo = new AnnotationsRepo(database);
		const dialogueRepo = new DialogueRepo(database);

		const extractedPath = join(root, "extracted.txt");
		writeFileSync(extractedPath, "dialogue source content", "utf8");
		itemsRepo.create({
			id: "item-dialogue-service",
			createdAt: "2026-02-18T00:00:00.000Z",
			sourceType: "web",
			originalUrl: "https://example.com/dialogue",
			whyNote: null,
			tags: [],
			topic: null,
			space: null,
		});
		artifactsRepo.create({
			id: "artifact-dialogue-service",
			itemId: "item-dialogue-service",
			kind: "extracted-text",
			path: extractedPath,
			mimeType: "text/plain",
			version: 1,
			createdAt: "2026-02-18T00:00:00.000Z",
		});

		const askService = new AskService(
			{
				itemsRepo,
				artifactsRepo,
				itemContentRepo,
				annotationsRepo,
				dialogueRepo,
				responder: async (input) => ({
					answer: `A:${input.question}`,
					model: "gpt-5",
					provider: "openai-codex",
					citations: [],
				}),
			},
			{ now: () => new Date("2026-02-18T00:00:00.000Z") },
		);
		const service = new DialogueService({ itemsRepo, dialogueRepo, askService });

		try {
			const opened = service.openItemDialogue("item-dialogue-service");
			expect(opened.itemId).toBe("item-dialogue-service");
			expect(opened.created).toBe(true);

			const reopened = service.openItemDialogue("item-dialogue-service", opened.sessionId);
			expect(reopened.sessionId).toBe(opened.sessionId);
			expect(reopened.created).toBe(false);
			expect(service.isSessionForItem("item-dialogue-service", opened.sessionId)).toBe(true);
			expect(service.hasItem("item-dialogue-service")).toBe(true);

			await askService.askInSession("item-dialogue-service", "hello", opened.sessionId);
			const history = service.listDialogueHistory(opened.sessionId, 20);
			expect(history).toHaveLength(2);
			expect(history[0]?.role).toBe("user");
			expect(history[1]?.role).toBe("assistant");
			expect(history[1]?.content).toContain("A:hello");

			const resumed = service.resumeItemDialogue(opened.sessionId);
			expect(resumed.itemId).toBe("item-dialogue-service");
			expect(resumed.created).toBe(false);
		} finally {
			database.close();
		}
	});

	it("keeps error semantics for missing item/session lookups", () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-dialogue-service-"));
		tempDirs.push(root);
		const database = createDatabase({ databasePath: join(root, "sonder.sqlite") });
		const itemsRepo = new ItemsRepo(database);
		const artifactsRepo = new ArtifactsRepo(database);
		const itemContentRepo = new ItemContentRepo(database);
		const annotationsRepo = new AnnotationsRepo(database);
		const dialogueRepo = new DialogueRepo(database);
		const askService = new AskService({
			itemsRepo,
			artifactsRepo,
			itemContentRepo,
			annotationsRepo,
			dialogueRepo,
			responder: async () => ({
				answer: "unused",
				model: "gpt-5",
				provider: "openai-codex",
				citations: [],
			}),
		});
		const service = new DialogueService({ itemsRepo, dialogueRepo, askService });

		try {
			expect(() => service.openItemDialogue("missing-item")).toThrow("Item not found: missing-item");
			expect(() => service.listItemDialogues("missing-item")).toThrow("Item not found: missing-item");
			expect(() => service.resumeItemDialogue("missing-session")).toThrow("Session not found: missing-session");
			expect(() => service.listDialogueHistory("missing-session", 20)).toThrow("Session not found: missing-session");
		} finally {
			database.close();
		}
	});
});
