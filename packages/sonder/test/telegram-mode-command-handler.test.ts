import { describe, expect, it } from "vitest";
import type { ParsedTelegramModeCommand } from "../src/commands/parse-mode-command.js";
import { handleModeCommand } from "../src/transport/telegram-mode-command-handler.js";
import type { ChatModeState } from "../src/transport/telegram-mode-store.js";

type SentMessage = {
	chatId: number;
	text: string;
	options?: { inlineKeyboard?: Array<Array<{ text: string; callbackData: string }>> };
};

function createModeContext(input: {
	chatId?: number;
	command: ParsedTelegramModeCommand;
	mode?: ChatModeState;
	modelSelector?: {
		listModels: () => Array<{ id: string }>;
		getSelectedModelId: () => string;
		setSelectedModelId: (modelId: string) => boolean;
	} | null;
	sessions?: Array<{ sessionId: string; createdAt: string; title: string }>;
	historyPageText?: string;
	historyPageTurns?: number;
}): {
	context: Parameters<typeof handleModeCommand>[0];
	sent: SentMessage[];
	lastMode: ChatModeState | undefined;
	opened: Array<{ chatId: number; header: string; itemId: string; sessionId: string }>;
} {
	const sent: SentMessage[] = [];
	let mode = input.mode;
	const opened: Array<{ chatId: number; header: string; itemId: string; sessionId: string }> = [];

	const context: Parameters<typeof handleModeCommand>[0] = {
		chatId: input.chatId ?? 1,
		command: input.command,
		getChatMode: () => mode,
		setChatMode: (_chatId, nextMode) => {
			mode = nextMode;
		},
		clearChatMode: () => {
			const existed = mode !== undefined;
			mode = undefined;
			return existed;
		},
		modelSelector: input.modelSelector ?? null,
		sendMessage: async (chatId, text, options) => {
			sent.push({ chatId, text, options });
		},
		openItemDialogue: (itemId) => ({ itemId, sessionId: `session-${itemId}`, created: false }),
		listItemDialogues: () =>
			input.sessions ?? [{ sessionId: "session-1", createdAt: "2026-02-18T00:00:00.000Z", title: "Session" }],
		resumeItemDialogue: (sessionId) => ({ itemId: "item-1", sessionId, created: false }),
		createSessionMenu: (_chatId, _itemId, _sessionIds) => "sess-menu",
		createModelMenu: (_chatId, _modelIds) => "model-menu",
		buildModelsMenuText: (modelIds, selectedModelId) =>
			`Models (Codex)\nCurrent: ${selectedModelId}\n\n${modelIds.join("\n")}`,
		buildModelsMenuKeyboard: (_menuId, modelIds) =>
			modelIds.map((_, index) => [{ text: `${index + 1} Use`, callbackData: `model:${index + 1}` }]),
		sendItemModeOpenedMessage: async (chatId, header, itemId, sessionId) => {
			opened.push({ chatId, header, itemId, sessionId });
		},
		createHistoryMenu: (_chatId, _sessionId, _page, _pageSize) => "hist-menu",
		getHistoryPage: () => ({
			text: input.historyPageText ?? "History page",
			pageTurnsCount: input.historyPageTurns ?? 1,
		}),
		buildHistoryKeyboard: (_menuId, pageTurnsCount) =>
			pageTurnsCount > 0
				? [[{ text: "Prev", callbackData: "hist:prev" }]]
				: [[{ text: "Back", callbackData: "hist:back" }]],
		splitForTelegram: (text) => [text],
		truncateMiddle: (text) => text,
		formatDisplayTime: () => "2026-02-18 08:00:00 (UTC+8)",
	};

	return {
		context,
		sent,
		get lastMode() {
			return mode;
		},
		opened,
	};
}

describe("telegram mode command handler", () => {
	it("opens general mode for /open without item id", async () => {
		const state = createModeContext({
			command: { type: "open", itemId: undefined },
		});
		await handleModeCommand(state.context);

		expect(state.lastMode).toBeDefined();
		expect(state.lastMode?.mode).toBe("general");
		expect(state.sent).toHaveLength(1);
		expect(state.sent[0]?.text).toContain("Opened general dialogue mode");
	});

	it("shows guidance when /models is requested without model selector", async () => {
		const state = createModeContext({ command: { type: "models" }, modelSelector: null });
		await handleModeCommand(state.context);

		expect(state.sent).toHaveLength(1);
		expect(state.sent[0]?.text).toContain("codex responder mode only");
	});

	it("renders models menu with selector when available", async () => {
		const state = createModeContext({
			command: { type: "models" },
			modelSelector: {
				listModels: () => [{ id: "gpt-5.2" }, { id: "gpt-5.2-mini" }],
				getSelectedModelId: () => "gpt-5.2",
				setSelectedModelId: () => true,
			},
		});
		await handleModeCommand(state.context);

		expect(state.sent).toHaveLength(1);
		expect(state.sent[0]?.text).toContain("Models (Codex)");
		expect(state.sent[0]?.options?.inlineKeyboard?.[0]?.[0]?.callbackData).toBe("model:1");
	});

	it("resumes item dialogue for /resume", async () => {
		const state = createModeContext({
			command: { type: "resume", sessionId: "session-9" },
		});
		await handleModeCommand(state.context);

		expect(state.lastMode?.mode).toBe("item");
		expect(state.lastMode && state.lastMode.mode === "item" ? state.lastMode.sessionId : null).toBe("session-9");
		expect(state.opened).toHaveLength(1);
		expect(state.opened[0]?.header).toContain("Item dialogue resumed");
	});
});
