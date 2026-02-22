import { describe, expect, it } from "vitest";
import {
	type ActiveModeMessageHandlerContext,
	handleActiveModeMessage,
} from "../src/transport/telegram-active-mode-message-handler.js";
import type { ChatModeState } from "../src/transport/telegram-mode-store.js";

type SentMessage = {
	chatId: number;
	text: string;
	options?: { inlineKeyboard?: Array<Array<{ text: string; callbackData: string }>> };
};

function createContext(input: { activeMode: ChatModeState; answer?: string; itemId?: string }): {
	context: ActiveModeMessageHandlerContext;
	sent: SentMessage[];
	setModes: Array<{ chatId: number; mode: ChatModeState }>;
	askCalls: Array<{ itemId: string; sessionId: string; message: string }>;
	chatCalls: Array<{ sessionId: string; message: string; historyLength: number }>;
} {
	const sent: SentMessage[] = [];
	const setModes: Array<{ chatId: number; mode: ChatModeState }> = [];
	const askCalls: Array<{ itemId: string; sessionId: string; message: string }> = [];
	const chatCalls: Array<{ sessionId: string; message: string; historyLength: number }> = [];

	return {
		context: {
			chatId: 7,
			text: "hello",
			activeMode: input.activeMode,
			askInItemDialogue: async (itemId, sessionId, message) => {
				askCalls.push({ itemId, sessionId, message });
				return { answer: input.answer ?? "item answer", itemId: input.itemId ?? itemId };
			},
			chatWithoutItem: async (sessionId, message, history) => {
				chatCalls.push({ sessionId, message, historyLength: history.length });
				return { answer: input.answer ?? "general answer" };
			},
			setChatMode: (chatId, mode) => {
				setModes.push({ chatId, mode });
			},
			formatContextualAnswer: (_chatId, answer, itemId) =>
				itemId ? `item:${itemId}:${answer}` : `general:${answer}`,
			splitForTelegram: (text) => [text],
			buildItemReplyKeyboard: () => [[{ text: "Open Context Panel", callbackData: "ctx" }]],
			sendMessage: async (chatId, text, options) => {
				sent.push({ chatId, text, options });
			},
		},
		sent,
		setModes,
		askCalls,
		chatCalls,
	};
}

describe("telegram active-mode message handler", () => {
	it("handles item-mode messages via askInItemDialogue", async () => {
		const state = createContext({
			activeMode: { mode: "item", itemId: "item-1", sessionId: "session-1" },
			answer: "item response",
		});
		await handleActiveModeMessage(state.context);

		expect(state.askCalls).toEqual([{ itemId: "item-1", sessionId: "session-1", message: "hello" }]);
		expect(state.chatCalls).toHaveLength(0);
		expect(state.setModes).toHaveLength(0);
		expect(state.sent).toEqual([
			{
				chatId: 7,
				text: "item:item-1:item response",
				options: { inlineKeyboard: [[{ text: "Open Context Panel", callbackData: "ctx" }]] },
			},
		]);
	});

	it("handles general-mode messages and persists updated history", async () => {
		const state = createContext({
			activeMode: { mode: "general", sessionId: "general-1", history: [] },
			answer: "general response",
		});
		await handleActiveModeMessage(state.context);

		expect(state.askCalls).toHaveLength(0);
		expect(state.chatCalls).toEqual([{ sessionId: "general-1", message: "hello", historyLength: 0 }]);
		expect(state.setModes).toHaveLength(1);
		expect(state.setModes[0]?.mode).toEqual({
			mode: "general",
			sessionId: "general-1",
			history: [
				{ role: "user", content: "hello" },
				{ role: "assistant", content: "general response" },
			],
		});
		expect(state.sent).toEqual([{ chatId: 7, text: "general:general response", options: undefined }]);
	});
});
