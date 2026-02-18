import { describe, expect, it } from "vitest";
import {
	type HistoryCallbackAction,
	type HistoryCallbackContext,
	handleHistoryCallback,
} from "../src/transport/telegram-callback-handlers.js";

type SentMessage = {
	chatId: number;
	text: string;
	options?: { inlineKeyboard?: Array<Array<{ text: string; callbackData: string }>> };
};

type DialogueTurnLike = {
	role: "user" | "assistant" | "system";
	content: string;
	status: "pending" | "failed" | "completed";
	errorMessage: string | null;
	createdAt: string;
};

function createHistoryContext(input: {
	action: HistoryCallbackAction;
	argument: string;
	menu?: { sessionId: string; page: number; pageSize: number } | null;
	turns?: DialogueTurnLike[];
}): { context: HistoryCallbackContext; sent: SentMessage[] } {
	const sent: SentMessage[] = [];
	const menu = input.menu === undefined ? { sessionId: "sess-1", page: 0, pageSize: 2 } : input.menu;
	const turns: DialogueTurnLike[] = input.turns ?? [
		{
			role: "assistant",
			content: "first answer",
			status: "completed",
			errorMessage: null,
			createdAt: "2026-02-18T00:00:00.000Z",
		},
		{
			role: "assistant",
			content: "second answer",
			status: "completed",
			errorMessage: null,
			createdAt: "2026-02-18T00:01:00.000Z",
		},
	];

	return {
		context: {
			chatId: 7,
			menuId: "menu-a",
			action: input.action,
			argument: input.argument,
			getHistoryMenu: () => menu,
			listDialogueHistory: () => turns,
			getHistoryPage: (_sessionId, page) => ({
				text: `History page ${page + 1}`,
				pageTurnsCount: 2,
				safePage: page,
				totalPages: 3,
			}),
			createHistoryMenu: (_chatId, _sessionId, page) => `menu-${page}`,
			buildHistoryKeyboard: (menuId, pageTurnsCount) =>
				[
					[
						{ text: "Prev", callbackData: `${menuId}:prev` },
						{ text: "Next", callbackData: `${menuId}:next` },
					],
				].slice(0, Math.max(1, pageTurnsCount > 0 ? 1 : 0)),
			formatDisplayTime: () => "2026-02-18 08:00:00 (UTC+8)",
			splitForTelegram: (text) => [text],
			sendMessage: async (chatId, text, options) => {
				sent.push({ chatId, text, options });
			},
		},
		sent,
	};
}

describe("telegram callback handlers", () => {
	it("handles history full callback and sends full turn content", async () => {
		const { context, sent } = createHistoryContext({ action: "hist_full", argument: "1" });
		const handled = await handleHistoryCallback(context);

		expect(handled).toBe(true);
		expect(sent).toHaveLength(1);
		expect(sent[0]?.text).toContain("History turn 1");
		expect(sent[0]?.text).toContain("Role: assistant");
		expect(sent[0]?.text).toContain("Time: 2026-02-18 08:00:00 (UTC+8)");
		expect(sent[0]?.text).toContain("first answer");
	});

	it("returns guidance for invalid history index", async () => {
		const { context, sent } = createHistoryContext({ action: "hist_full", argument: "0" });
		const handled = await handleHistoryCallback(context);

		expect(handled).toBe(true);
		expect(sent).toHaveLength(1);
		expect(sent[0]?.text).toContain("Invalid history selection");
	});

	it("handles history pagination callback and sends paged response with keyboard", async () => {
		const { context, sent } = createHistoryContext({ action: "hist_next", argument: "0" });
		const handled = await handleHistoryCallback(context);

		expect(handled).toBe(true);
		expect(sent).toHaveLength(1);
		expect(sent[0]?.text).toContain("History page 2");
		expect(sent[0]?.options?.inlineKeyboard?.[0]?.[0]?.callbackData).toBe("menu-1:prev");
	});

	it("returns expired guidance when history menu is missing", async () => {
		const { context, sent } = createHistoryContext({ action: "hist_back", argument: "0", menu: null });
		const handled = await handleHistoryCallback(context);

		expect(handled).toBe(true);
		expect(sent).toHaveLength(1);
		expect(sent[0]?.text).toContain("history menu expired");
	});
});
