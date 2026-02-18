import { describe, expect, it } from "vitest";
import {
	type HistoryCallbackAction,
	type HistoryCallbackContext,
	handleDiscoveryItemCallback,
	handleDiscoveryMenuFilterCallback,
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

type DiscoveryAction = "find_open" | "find_del" | "list_open" | "list_del";

function createDiscoveryContext(input: {
	action: DiscoveryAction;
	argument: string;
	menuKind?: "find" | "list";
	menuExists?: boolean;
	itemId?: string | null;
}): {
	context: Parameters<typeof handleDiscoveryItemCallback>[0];
	sent: SentMessage[];
	chatModes: Array<{ mode: "item"; itemId: string; sessionId: string }>;
	openedMessages: Array<{ chatId: number; header: string; itemId: string; sessionId: string }>;
	deleted: string[];
} {
	const sent: SentMessage[] = [];
	const chatModes: Array<{ mode: "item"; itemId: string; sessionId: string }> = [];
	const openedMessages: Array<{ chatId: number; header: string; itemId: string; sessionId: string }> = [];
	const deleted: string[] = [];
	const menu =
		input.menuExists === false
			? null
			: {
					kind: input.menuKind ?? "find",
					page: 0,
					pageSize: 5,
					time: "all" as const,
					source: "any" as const,
					tag: null,
					sort: "newest" as const,
					tagPage: 0,
				};
	const selectedItemId = input.itemId === undefined ? "item-1" : input.itemId;

	return {
		context: {
			chatId: 7,
			menuId: "menu-d",
			action: input.action,
			argument: input.argument,
			getItemMenu: () => menu,
			getMenuItemId: () => selectedItemId,
			deleteItemAndNotify: async (_chatId, itemId) => {
				deleted.push(itemId);
			},
			buildDiscoveryMenuText: () => "Discovery text",
			buildDiscoveryMenuKeyboard: (menuId) => [[{ text: "1 Open", callbackData: `${menuId}:1` }]],
			openItemDialogue: (itemId) => ({ itemId, sessionId: `session-for-${itemId}` }),
			setChatMode: (_chatId, mode) => {
				chatModes.push(mode);
			},
			sendItemModeOpenedMessage: async (chatId, header, itemId, sessionId) => {
				openedMessages.push({ chatId, header, itemId, sessionId });
			},
			sendMessage: async (chatId, text, options) => {
				sent.push({ chatId, text, options });
			},
		},
		sent,
		chatModes,
		openedMessages,
		deleted,
	};
}

type DiscoveryMenuAction =
	| "menu_time"
	| "menu_time_set"
	| "menu_source"
	| "menu_source_set"
	| "menu_tag"
	| "menu_tag_set"
	| "menu_tag_page"
	| "menu_sort"
	| "menu_sort_set"
	| "menu_back"
	| "menu_clear"
	| "menu_prev"
	| "menu_next";

function createDiscoveryMenuFilterContext(input: {
	action: DiscoveryMenuAction;
	argument: string;
	menuExists?: boolean;
	tags?: string[];
	page?: number;
	totalPages?: number;
}): {
	context: Parameters<typeof handleDiscoveryMenuFilterCallback>[0];
	sent: SentMessage[];
	menuState: {
		kind: "find" | "list";
		page: number;
		pageSize: number;
		time: "all" | "today" | "7d" | "30d" | "year";
		source: "any" | "web";
		tag: string | null;
		sort: "newest" | "oldest";
		tagPage: number;
	};
} {
	const sent: SentMessage[] = [];
	const menuState = {
		kind: "find" as const,
		page: input.page ?? 0,
		pageSize: 5,
		time: "all" as const,
		source: "any" as const,
		tag: null,
		sort: "newest" as const,
		tagPage: 0,
	};

	return {
		context: {
			chatId: 7,
			menuId: "menu-f",
			action: input.action,
			argument: input.argument,
			getItemMenu: () => (input.menuExists === false ? null : menuState),
			collectMenuTags: () => input.tags ?? ["alpha", "beta"],
			buildTimeMenuKeyboard: (menuId) => [[{ text: "Today", callbackData: `${menuId}:time` }]],
			buildSourceMenuKeyboard: (menuId) => [[{ text: "Web", callbackData: `${menuId}:source` }]],
			buildSortMenuKeyboard: (menuId) => [[{ text: "Newest", callbackData: `${menuId}:sort` }]],
			buildTagMenuKeyboard: (menuId) => [[{ text: "alpha", callbackData: `${menuId}:tag` }]],
			buildMenuBackKeyboard: (menuId) => [[{ text: "Back", callbackData: `${menuId}:back` }]],
			parseTimeFilter: (argument) => (argument === "1" ? "today" : argument === "0" ? "all" : null),
			parseSourceFilter: (argument) => (argument === "1" ? "web" : argument === "0" ? "any" : null),
			parseSortFilter: (argument) => (argument === "1" ? "oldest" : argument === "0" ? "newest" : null),
			parseTagSelection: (_menu, argument) => (argument === "1" ? "alpha" : null),
			parseTagPage: (argument, totalPages) => {
				const parsed = Number.parseInt(argument, 10);
				if (!Number.isFinite(parsed)) {
					return 0;
				}
				if (parsed < 0) {
					return totalPages - 1;
				}
				if (parsed >= totalPages) {
					return 0;
				}
				return parsed;
			},
			pagedMenuEntries: (menu) => ({
				page: menu.page,
				totalPages: input.totalPages ?? 2,
			}),
			buildDiscoveryMenuText: (menu) => `Filters: ${menu.time}/${menu.source}/${menu.sort} page=${menu.page}`,
			buildDiscoveryMenuKeyboard: (menuId) => [[{ text: "Next", callbackData: `${menuId}:next` }]],
			sendMessage: async (chatId, text, options) => {
				sent.push({ chatId, text, options });
			},
		},
		sent,
		menuState,
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

	it("handles discovery open callback and enters item mode", async () => {
		const { context, sent, chatModes, openedMessages } = createDiscoveryContext({
			action: "find_open",
			argument: "1",
			menuKind: "find",
			itemId: "item-open",
		});
		const handled = await handleDiscoveryItemCallback(context);

		expect(handled).toBe(true);
		expect(chatModes).toEqual([{ mode: "item", itemId: "item-open", sessionId: "session-for-item-open" }]);
		expect(openedMessages).toHaveLength(1);
		expect(openedMessages[0]?.header).toContain("Item mode opened from result #1");
		expect(sent).toHaveLength(0);
	});

	it("handles discovery delete callback and re-renders menu", async () => {
		const { context, sent, deleted } = createDiscoveryContext({
			action: "list_del",
			argument: "1",
			menuKind: "list",
			itemId: "item-del",
		});
		const handled = await handleDiscoveryItemCallback(context);

		expect(handled).toBe(true);
		expect(deleted).toEqual(["item-del"]);
		expect(sent).toHaveLength(1);
		expect(sent[0]?.text).toBe("Discovery text");
		expect(sent[0]?.options?.inlineKeyboard?.[0]?.[0]?.callbackData).toBe("menu-d:1");
	});

	it("returns guidance when discovery menu action does not match menu kind", async () => {
		const { context, sent } = createDiscoveryContext({
			action: "find_open",
			argument: "1",
			menuKind: "list",
		});
		const handled = await handleDiscoveryItemCallback(context);

		expect(handled).toBe(true);
		expect(sent).toHaveLength(1);
		expect(sent[0]?.text).toContain("no longer valid");
	});

	it("opens time selector for discovery filter callback", async () => {
		const { context, sent } = createDiscoveryMenuFilterContext({ action: "menu_time", argument: "0" });
		const handled = await handleDiscoveryMenuFilterCallback(context);

		expect(handled).toBe(true);
		expect(sent).toHaveLength(1);
		expect(sent[0]?.text).toContain("Select time filter");
		expect(sent[0]?.options?.inlineKeyboard?.[0]?.[0]?.callbackData).toBe("menu-f:time");
	});

	it("shows no-tags guidance in discovery tag selector", async () => {
		const { context, sent } = createDiscoveryMenuFilterContext({
			action: "menu_tag",
			argument: "0",
			tags: [],
		});
		const handled = await handleDiscoveryMenuFilterCallback(context);

		expect(handled).toBe(true);
		expect(sent).toHaveLength(1);
		expect(sent[0]?.text).toContain("No tags available");
		expect(sent[0]?.options?.inlineKeyboard?.[0]?.[0]?.callbackData).toBe("menu-f:back");
	});

	it("applies time filter and re-renders discovery menu", async () => {
		const { context, sent, menuState } = createDiscoveryMenuFilterContext({
			action: "menu_time_set",
			argument: "1",
		});
		const handled = await handleDiscoveryMenuFilterCallback(context);

		expect(handled).toBe(true);
		expect(menuState.time).toBe("today");
		expect(menuState.page).toBe(0);
		expect(sent).toHaveLength(1);
		expect(sent[0]?.text).toContain("today");
	});

	it("wraps discovery next-page navigation", async () => {
		const { context, sent, menuState } = createDiscoveryMenuFilterContext({
			action: "menu_next",
			argument: "0",
			page: 1,
			totalPages: 2,
		});
		const handled = await handleDiscoveryMenuFilterCallback(context);

		expect(handled).toBe(true);
		expect(menuState.page).toBe(0);
		expect(sent).toHaveLength(1);
		expect(sent[0]?.text).toContain("page=0");
	});
});
