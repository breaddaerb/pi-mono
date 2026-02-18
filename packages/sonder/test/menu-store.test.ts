import { describe, expect, it } from "vitest";
import { TelegramMenuStore } from "../src/transport/menu-store.js";

describe("telegram menu store", () => {
	it("creates and retrieves all menu types for a chat", () => {
		const store = new TelegramMenuStore(60_000, () => 1_000);
		const itemMenuId = store.createItemMenu(1, "find", [], "query");
		const sessionMenuId = store.createSessionMenu(1, "item-1", ["session-1"]);
		const modelMenuId = store.createModelMenu(1, ["gpt-5.2"]);
		const historyMenuId = store.createHistoryMenu(1, "session-1", 0, 8);

		expect(store.getItemMenu(1, itemMenuId)?.query).toBe("query");
		expect(store.getSessionMenu(1, sessionMenuId)?.itemId).toBe("item-1");
		expect(store.getModelMenu(1, modelMenuId)?.modelIds).toEqual(["gpt-5.2"]);
		expect(store.getHistoryMenu(1, historyMenuId)?.sessionId).toBe("session-1");
	});

	it("expires menu entries based on ttl", () => {
		let nowMs = 1_000;
		const store = new TelegramMenuStore(10, () => nowMs);
		const itemMenuId = store.createItemMenu(1, "list", [], null);
		expect(store.getItemMenu(1, itemMenuId)).not.toBeNull();

		nowMs = 1_011;
		expect(store.getItemMenu(1, itemMenuId)).toBeNull();
	});

	it("iterates item menus for the requested chat only", () => {
		const store = new TelegramMenuStore(60_000, () => 1_000);
		store.createItemMenu(
			1,
			"find",
			[
				{
					id: "item-1",
					createdAt: "2026-01-01T00:00:00.000Z",
					sourceType: "web",
					originalUrl: "https://example.com/1",
					tags: [],
					reasons: [],
					snippets: [],
				},
			],
			"q",
		);
		store.createItemMenu(2, "list", [], null);

		const visited: number[] = [];
		store.forEachItemMenu(1, (menu) => {
			visited.push(menu.entries.length);
		});

		expect(visited).toEqual([1]);
	});
});
