import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContextMarkRepo, createDatabase, DialogueRepo, ItemsRepo } from "../src/storage/index.js";

describe("context mark repo", () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		for (const directory of tempDirs) {
			rmSync(directory, { recursive: true, force: true });
		}
		tempDirs.length = 0;
	});

	it("upserts and lists context turn state by session", () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-context-mark-"));
		tempDirs.push(root);
		const database = createDatabase({ databasePath: join(root, "sonder.sqlite") });
		const itemsRepo = new ItemsRepo(database);
		const dialogueRepo = new DialogueRepo(database);
		const contextMarkRepo = new ContextMarkRepo(database);

		itemsRepo.create({
			id: "item_1",
			createdAt: "2026-02-20T00:00:00.000Z",
			sourceType: "web",
			originalUrl: "https://example.com/item",
			whyNote: null,
			tags: [],
			topic: null,
			space: null,
		});
		dialogueRepo.createSession({
			id: "sess_1",
			itemId: "item_1",
			title: "item_1",
			createdAt: "2026-02-20T00:00:01.000Z",
		});

		contextMarkRepo.upsertState({
			sessionId: "sess_1",
			semanticTurnId: "u1",
			state: "DETACHED",
			updatedAt: "2026-02-20T00:00:02.000Z",
			updatedBy: "test",
		});

		expect(contextMarkRepo.getState("sess_1", "u1")).toBe("DETACHED");
		expect(contextMarkRepo.getState("sess_1", "missing")).toBeNull();

		contextMarkRepo.upsertState({
			sessionId: "sess_1",
			semanticTurnId: "u1",
			state: "ACTIVE",
			updatedAt: "2026-02-20T00:00:03.000Z",
		});

		const marks = contextMarkRepo.listBySessionId("sess_1");
		expect(marks).toHaveLength(1);
		expect(marks[0]?.state).toBe("ACTIVE");
		expect(marks[0]?.updatedBy).toBeNull();

		database.close();
	});
});
