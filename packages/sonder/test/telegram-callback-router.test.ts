import { describe, expect, it } from "vitest";
import type { ItemMenuStateLike } from "../src/transport/callback-handlers/types.js";
import { buildCallbackPayload } from "../src/transport/telegram-callback.js";
import {
	routeTelegramCallback,
	type TelegramCallbackRouterContext,
} from "../src/transport/telegram-callback-router.js";

type SentMessage = {
	chatId: number;
	text: string;
	options?: { inlineKeyboard?: Array<Array<{ text: string; callbackData: string }>> };
};

function createRouterContext(input: { data: string; overrides?: Partial<TelegramCallbackRouterContext> }): {
	context: TelegramCallbackRouterContext;
	sent: SentMessage[];
	setModes: Array<{ chatId: number; mode: { mode: "item"; itemId: string; sessionId: string } }>;
	opened: Array<{ chatId: number; header: string; itemId: string; sessionId: string }>;
} {
	const sent: SentMessage[] = [];
	const setModes: Array<{ chatId: number; mode: { mode: "item"; itemId: string; sessionId: string } }> = [];
	const opened: Array<{ chatId: number; header: string; itemId: string; sessionId: string }> = [];

	const context: TelegramCallbackRouterContext = {
		chatId: 11,
		data: input.data,
		modelSelector: null,
		getChatMode: () => undefined,
		clearChatMode: () => true,
		deleteItemAndNotify: async () => {},
		getViewerItemUrl: () => "http://viewer/item",
		getContextPanelMenu: () => null,
		createContextPanelMenu: () => "ctx-panel-next",
		listContextTurns: () => ({
			sessionId: "session-1",
			page: 0,
			pageSize: 10,
			total: 0,
			totalPages: 1,
			turns: [],
		}),
		setContextTurnState: () => true,
		detachLastContextTurn: () => null,
		compileContextDump: () => ({
			sessionId: "session-1",
			tokenBudget: 12000,
			approxTotalTokens: 0,
			compiledItems: [],
			excludedItems: [],
			compiledTextPreview: "(empty)",
		}),
		renderContextPanel: () => ({ text: "context panel", inlineKeyboard: [] }),
		getModelMenu: () => null,
		getModelIdByIndex: () => null,
		createModelMenu: () => "model-menu-next",
		buildModelsMenuText: () => "models",
		buildModelsMenuKeyboard: () => [],
		getItemMenu: () => null,
		getMenuItemId: () => null,
		collectMenuTags: () => [],
		buildTimeMenuKeyboard: () => [],
		buildSourceMenuKeyboard: () => [],
		buildSortMenuKeyboard: () => [],
		buildTagMenuKeyboard: () => [],
		buildMenuBackKeyboard: () => [],
		parseTimeFilter: () => null,
		parseSourceFilter: () => null,
		parseSortFilter: () => null,
		parseTagSelection: () => null,
		parseTagPage: () => 0,
		pagedMenuEntries: () => ({ page: 0, totalPages: 1 }),
		buildDiscoveryMenuText: () => "discovery",
		buildDiscoveryMenuKeyboard: () => [],
		getSessionMenu: () => null,
		getSessionIdByIndex: () => null,
		resumeItemDialogue: (sessionId) => ({ itemId: "item-resume", sessionId }),
		createItemDialogue: (itemId) => ({ itemId, sessionId: "session-new" }),
		openItemDialogue: (itemId) => ({ itemId, sessionId: "session-open" }),
		setChatMode: (chatId, mode) => {
			setModes.push({ chatId, mode });
		},
		sendItemModeOpenedMessage: async (chatId, header, itemId, sessionId) => {
			opened.push({ chatId, header, itemId, sessionId });
		},
		getHistoryMenu: () => null,
		listDialogueHistory: () => [],
		getHistoryPage: () => ({ text: "history", pageTurnsCount: 0, safePage: 0, totalPages: 1 }),
		createHistoryMenu: () => "history-next",
		buildHistoryKeyboard: () => [],
		formatDisplayTime: (timestamp) => timestamp,
		splitForTelegram: (text) => [text],
		sendMessage: async (chatId, text, options) => {
			sent.push({ chatId, text, options });
		},
		...input.overrides,
	};

	return { context, sent, setModes, opened };
}

describe("telegram callback router", () => {
	it("returns unsupported message for malformed callback payload", async () => {
		const state = createRouterContext({ data: "bad-payload" });
		await routeTelegramCallback(state.context);

		expect(state.sent).toHaveLength(1);
		expect(state.sent[0]?.text).toContain("Unsupported action");
	});

	it("routes ctx_* callbacks to context handler", async () => {
		const state = createRouterContext({
			data: buildCallbackPayload("ctx_exit", "ctx", 0),
			overrides: {
				getChatMode: () => undefined,
			},
		});
		await routeTelegramCallback(state.context);

		expect(state.sent).toHaveLength(1);
		expect(state.sent[0]?.text).toContain("No active context");
	});

	it("routes context control callbacks via action registry", async () => {
		const state = createRouterContext({
			data: buildCallbackPayload("ctx_panel", "ctx", 0),
			overrides: {
				getChatMode: () => ({ mode: "item", itemId: "item-1", sessionId: "session-1" }),
				renderContextPanel: () => ({ text: "Context panel", inlineKeyboard: [] }),
			},
		});
		await routeTelegramCallback(state.context);

		expect(state.sent).toHaveLength(1);
		expect(state.sent[0]?.text).toContain("Context panel");
	});

	it("routes hist_back callbacks to history handler", async () => {
		const state = createRouterContext({
			data: buildCallbackPayload("hist_back", "hist-menu", 0),
			overrides: {
				getHistoryMenu: () => ({ sessionId: "session-1", page: 0, pageSize: 8 }),
			},
		});
		await routeTelegramCallback(state.context);

		expect(state.sent).toHaveLength(1);
		expect(state.sent[0]?.text).toContain("Back to item dialogue");
	});

	it("routes discovery open callbacks to discovery-item handler", async () => {
		const menu: ItemMenuStateLike = {
			kind: "find",
			page: 0,
			pageSize: 5,
			time: "all",
			source: "any",
			tag: null,
			sort: "newest",
			tagPage: 0,
		};
		const state = createRouterContext({
			data: buildCallbackPayload("find_open", "menu-1", 1),
			overrides: {
				getItemMenu: () => menu,
				getMenuItemId: () => "item-42",
			},
		});
		await routeTelegramCallback(state.context);

		expect(state.setModes).toEqual([
			{ chatId: 11, mode: { mode: "item", itemId: "item-42", sessionId: "session-open" } },
		]);
		expect(state.opened).toHaveLength(1);
		expect(state.opened[0]?.header).toContain("opened from result #1");
	});

	it("routes model_set callbacks via action registry", async () => {
		const state = createRouterContext({
			data: buildCallbackPayload("model_set", "menu-model", 1),
		});
		await routeTelegramCallback(state.context);

		expect(state.sent).toHaveLength(1);
		expect(state.sent[0]?.text).toContain("codex responder mode only");
	});

	it("routes menu filter callbacks via action registry", async () => {
		const menu: ItemMenuStateLike = {
			kind: "find",
			page: 0,
			pageSize: 5,
			time: "all",
			source: "any",
			tag: null,
			sort: "newest",
			tagPage: 0,
		};
		const state = createRouterContext({
			data: buildCallbackPayload("menu_time", "menu-filters", 0),
			overrides: {
				getItemMenu: () => menu,
				buildTimeMenuKeyboard: () => [[{ text: "Today", callbackData: "cb:today" }]],
			},
		});
		await routeTelegramCallback(state.context);

		expect(state.sent).toHaveLength(1);
		expect(state.sent[0]?.text).toContain("Select time filter");
		expect(state.sent[0]?.options?.inlineKeyboard?.[0]?.[0]?.callbackData).toBe("cb:today");
	});
});
