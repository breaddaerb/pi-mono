import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	AnnotationsRepo,
	ArtifactsRepo,
	ChatModeStateRepo,
	ContextMarkRepo,
	createDatabase,
	DialogueRepo,
	getArtifactFilePath,
	getItemArtifactDirectory,
	ItemsRepo,
} from "../src/storage/index.js";
import type { Annotation, Artifact, DialogueSession, DialogueTurn, Item } from "../src/types.js";

describe("storage smoke", () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		for (const directory of tempDirs) {
			rmSync(directory, { recursive: true, force: true });
		}
		tempDirs.length = 0;
	});

	it("applies migrations and round-trips core entities", () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-storage-"));
		tempDirs.push(root);

		const database = createDatabase({ databasePath: join(root, "sonder.sqlite") });
		const itemsRepo = new ItemsRepo(database);
		const artifactsRepo = new ArtifactsRepo(database);
		const annotationsRepo = new AnnotationsRepo(database);
		const dialogueRepo = new DialogueRepo(database);
		const contextMarkRepo = new ContextMarkRepo(database);
		const chatModeStateRepo = new ChatModeStateRepo(database);

		const item: Item = {
			id: "item_1",
			createdAt: "2026-02-14T01:00:00.000Z",
			sourceType: "web",
			originalUrl: "https://lucumr.pocoo.org/2026/2/9/a-language-for-agents",
			whyNote: "language design for agents",
			tags: ["agents", "language"],
			topic: "language-design",
			space: "sonder",
		};
		itemsRepo.create(item);

		const artifact: Artifact = {
			id: "art_1",
			itemId: item.id,
			kind: "snapshot-html",
			path: "data/items/item_1/snapshot.html",
			mimeType: "text/html",
			version: 1,
			createdAt: "2026-02-14T01:00:01.000Z",
		};
		artifactsRepo.create(artifact);

		const annotation: Annotation = {
			id: "ann_1",
			itemId: item.id,
			artifactId: artifact.id,
			type: "highlight",
			text: "Why New Languages Work",
			comment: "Good section",
			color: "#ffd400",
			tags: ["thesis"],
			anchor: '{"type":"quote","exact":"Why New Languages Work"}',
			createdAt: "2026-02-14T01:00:02.000Z",
			updatedAt: "2026-02-14T01:00:02.000Z",
		};
		annotationsRepo.create(annotation);

		const session: DialogueSession = {
			id: "session_1",
			itemId: item.id,
			title: "Main thesis",
			createdAt: "2026-02-14T01:00:03.000Z",
		};
		dialogueRepo.createSession(session);

		const turn: DialogueTurn = {
			id: "turn_1",
			sessionId: session.id,
			role: "assistant",
			content: "The article argues agent ergonomics can justify new language design.",
			model: "gpt-5",
			provider: "openai-codex",
			citations: ["ann:ann_1", "art:art_1"],
			thinking: null,
			status: "completed",
			errorMessage: null,
			createdAt: "2026-02-14T01:00:04.000Z",
		};
		dialogueRepo.createTurn(turn);

		expect(itemsRepo.findById(item.id)).toEqual(item);
		expect(itemsRepo.listRecent()).toEqual([item]);
		expect(artifactsRepo.findById(artifact.id)).toEqual(artifact);
		expect(artifactsRepo.listByItemId(item.id)).toEqual([artifact]);
		expect(annotationsRepo.findById(annotation.id)).toEqual(annotation);
		expect(annotationsRepo.listByItemId(item.id)).toEqual([annotation]);
		expect(annotationsRepo.deleteById(annotation.id)).toBe(true);
		expect(annotationsRepo.findById(annotation.id)).toBeNull();
		expect(dialogueRepo.findSessionById(session.id)).toEqual(session);
		expect(dialogueRepo.listSessionsByItemId(item.id)).toEqual([session]);
		expect(dialogueRepo.findTurnById(turn.id)).toEqual(turn);
		expect(dialogueRepo.listTurnsBySessionId(session.id)).toEqual([turn]);

		contextMarkRepo.upsertState({
			sessionId: session.id,
			semanticTurnId: "turn_1",
			state: "DETACHED",
			updatedAt: "2026-02-14T01:00:05.000Z",
		});
		expect(contextMarkRepo.getState(session.id, "turn_1")).toBe("DETACHED");

		chatModeStateRepo.upsert(
			{
				chatId: 42,
				mode: "item",
				itemId: item.id,
				sessionId: session.id,
				history: [],
			},
			"2026-02-14T01:00:05.000Z",
		);
		expect(chatModeStateRepo.findByChatId(42)).toMatchObject({
			chatId: 42,
			mode: "item",
			itemId: item.id,
			sessionId: session.id,
		});
		expect(chatModeStateRepo.deleteByChatId(42)).toBe(true);
		expect(chatModeStateRepo.findByChatId(42)).toBeNull();

		database.close();
	});

	it("builds artifact paths with data/items/<itemId>/... layout", () => {
		const root = "/tmp/sonder";
		const directory = getItemArtifactDirectory(root, "item_abc");
		const filePath = getArtifactFilePath(root, "item_abc", "snapshot.html");

		expect(directory).toBe(join(root, "items", "item_abc"));
		expect(filePath).toBe(join(root, "items", "item_abc", "snapshot.html"));
	});
});
