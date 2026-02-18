import { randomUUID } from "node:crypto";
import type { ParsedTelegramModeCommand } from "../commands/parse-mode-command.js";
import { buildCallbackPayload } from "./telegram-callback.js";
import type { ChatModeState } from "./telegram-mode-store.js";

export type ModeCommandModelSelector = {
	listModels: () => Array<{ id: string }>;
	getSelectedModelId: () => string;
	setSelectedModelId: (modelId: string) => boolean;
};

type InlineKeyboard = Array<Array<{ text: string; callbackData: string }>>;

type SendMessage = (chatId: number, text: string, options?: { inlineKeyboard?: InlineKeyboard }) => Promise<void>;

type SessionSummary = { sessionId: string; createdAt: string; title: string };

type HistoryPage = { text: string; pageTurnsCount: number };

type DialogueSessionInfo = { itemId: string; sessionId: string; created: boolean };

export interface ModeCommandHandlerContext {
	chatId: number;
	command: ParsedTelegramModeCommand;
	getChatMode: (chatId: number) => ChatModeState | undefined;
	setChatMode: (chatId: number, mode: ChatModeState) => void;
	clearChatMode: (chatId: number) => boolean;
	modelSelector: ModeCommandModelSelector | null;
	sendMessage: SendMessage;

	openItemDialogue: (itemId: string) => DialogueSessionInfo;
	listItemDialogues: (itemId: string) => SessionSummary[];
	resumeItemDialogue: (sessionId: string) => DialogueSessionInfo;
	createSessionMenu: (chatId: number, itemId: string, sessionIds: string[]) => string;
	createModelMenu: (chatId: number, modelIds: string[]) => string;
	buildModelsMenuText: (modelIds: string[], selectedModelId: string) => string;
	buildModelsMenuKeyboard: (menuId: string, modelIds: string[], selectedModelId: string) => InlineKeyboard;
	sendItemModeOpenedMessage: (chatId: number, header: string, itemId: string, sessionId: string) => Promise<void>;

	createHistoryMenu: (chatId: number, sessionId: string, page: number, pageSize: number) => string;
	getHistoryPage: (sessionId: string, page: number, pageSize: number) => HistoryPage;
	buildHistoryKeyboard: (menuId: string, pageTurnsCount: number) => InlineKeyboard;
	splitForTelegram: (text: string) => string[];
	truncateMiddle: (text: string, maxLength: number) => string;
	formatDisplayTime: (timestamp: string) => string;
}

export async function handleModeCommand(context: ModeCommandHandlerContext): Promise<void> {
	const { chatId, command } = context;
	if (command.type === "open") {
		if (!command.itemId) {
			const sessionId = randomUUID();
			context.setChatMode(chatId, {
				mode: "general",
				sessionId,
				history: [],
			});
			await context.sendMessage(
				chatId,
				`Opened general dialogue mode. Session: ${sessionId}. Send messages directly, /exit to leave.`,
			);
			return;
		}

		const opened = context.openItemDialogue(command.itemId);
		context.setChatMode(chatId, {
			mode: "item",
			itemId: opened.itemId,
			sessionId: opened.sessionId,
		});
		await context.sendItemModeOpenedMessage(chatId, "🧠 Item mode opened.", opened.itemId, opened.sessionId);
		return;
	}

	if (command.type === "exit") {
		const existed = context.clearChatMode(chatId);
		await context.sendMessage(chatId, existed ? "Exited active dialogue mode." : "No active dialogue mode.");
		return;
	}

	if (command.type === "where") {
		const mode = context.getChatMode(chatId);
		const modelLine = context.modelSelector ? `\nModel: ${context.modelSelector.getSelectedModelId()}` : "";
		if (!mode) {
			await context.sendMessage(chatId, `No active dialogue mode.${modelLine}`);
			return;
		}
		if (mode.mode === "item") {
			await context.sendMessage(
				chatId,
				`Active item dialogue\nItem: ${mode.itemId}\nSession: ${mode.sessionId}${modelLine}`,
			);
			return;
		}
		await context.sendMessage(chatId, `Active general dialogue\nSession: ${mode.sessionId}${modelLine}`);
		return;
	}

	if (command.type === "models") {
		if (!context.modelSelector) {
			await context.sendMessage(chatId, "Model selector is available in codex responder mode only.");
			return;
		}
		const modelIds = context.modelSelector.listModels().map((model) => model.id);
		if (modelIds.length === 0) {
			await context.sendMessage(chatId, "No codex models available.");
			return;
		}
		const selectedModelId = context.modelSelector.getSelectedModelId();
		const menuId = context.createModelMenu(chatId, modelIds);
		await context.sendMessage(chatId, context.buildModelsMenuText(modelIds, selectedModelId), {
			inlineKeyboard: context.buildModelsMenuKeyboard(menuId, modelIds, selectedModelId),
		});
		return;
	}

	if (command.type === "sessions") {
		const activeMode = context.getChatMode(chatId);
		const activeItemId = activeMode && activeMode.mode === "item" ? activeMode.itemId : undefined;
		const itemId = command.itemId ?? activeItemId;
		if (!itemId) {
			await context.sendMessage(chatId, "No active item. Use /find or /list, tap Open, then run /sessions.");
			return;
		}
		const sessions = context.listItemDialogues(itemId);
		if (sessions.length === 0) {
			await context.sendMessage(chatId, "No sessions for current item.");
			return;
		}
		const lines = sessions.map((session, index) => `${index + 1}. ${context.formatDisplayTime(session.createdAt)}`);
		const menuId = context.createSessionMenu(
			chatId,
			itemId,
			sessions.map((session) => session.sessionId),
		);
		const keyboard: InlineKeyboard = [
			...sessions.map((_, index) => [
				{ text: `${index + 1} Resume`, callbackData: buildCallbackPayload("sess_resume", menuId, index + 1) },
			]),
			[{ text: "New Session", callbackData: buildCallbackPayload("sess_new", menuId, 0) }],
		];
		await context.sendMessage(chatId, `Sessions\n\n${lines.join("\n")}`, { inlineKeyboard: keyboard });
		return;
	}

	if (command.type === "history") {
		if (command.sessionId) {
			const pageSize = 8;
			const menuId = context.createHistoryMenu(chatId, command.sessionId, 0, pageSize);
			const historyPage = context.getHistoryPage(command.sessionId, 0, pageSize);
			const keyboard = context.buildHistoryKeyboard(menuId, historyPage.pageTurnsCount);
			for (const chunk of context.splitForTelegram(historyPage.text)) {
				await context.sendMessage(
					chatId,
					chunk,
					chunk === historyPage.text ? { inlineKeyboard: keyboard } : undefined,
				);
			}
			return;
		}

		const mode = context.getChatMode(chatId);
		if (!mode) {
			await context.sendMessage(chatId, "No active dialogue mode and no sessionId provided.");
			return;
		}
		if (mode.mode === "general") {
			if (mode.history.length === 0) {
				await context.sendMessage(chatId, `General history is empty for session ${mode.sessionId}.`);
				return;
			}
			const lines = mode.history.map((turn) => `${turn.role}: ${context.truncateMiddle(turn.content, 280)}`);
			for (const chunk of context.splitForTelegram(`History for ${mode.sessionId}\n\n${lines.join("\n\n")}`)) {
				await context.sendMessage(chatId, chunk);
			}
			return;
		}

		const pageSize = 8;
		const menuId = context.createHistoryMenu(chatId, mode.sessionId, 0, pageSize);
		const historyPage = context.getHistoryPage(mode.sessionId, 0, pageSize);
		const keyboard = context.buildHistoryKeyboard(menuId, historyPage.pageTurnsCount);
		for (const chunk of context.splitForTelegram(historyPage.text)) {
			await context.sendMessage(
				chatId,
				chunk,
				chunk === historyPage.text ? { inlineKeyboard: keyboard } : undefined,
			);
		}
		return;
	}

	const resumed = context.resumeItemDialogue(command.sessionId);
	context.setChatMode(chatId, {
		mode: "item",
		itemId: resumed.itemId,
		sessionId: resumed.sessionId,
	});
	await context.sendItemModeOpenedMessage(chatId, "🧠 Item dialogue resumed.", resumed.itemId, resumed.sessionId);
}
