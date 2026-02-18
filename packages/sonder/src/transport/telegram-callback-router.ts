import type {
	ChatModeLike,
	DialogueSessionInfoLike,
	DialogueTurnLike,
	HistoryMenuStateLike,
	InlineKeyboard,
	ItemMenuStateLike,
	ModelMenuStateLike,
	SessionMenuStateLike,
} from "./callback-handlers/types.js";
import type { TelegramRuntimeModelSelector } from "./telegram.js";
import { type CallbackAction, parseCallbackPayload } from "./telegram-callback.js";
import {
	type ContextCallbackAction,
	type DiscoveryItemCallbackAction,
	type DiscoveryMenuFilterAction,
	type HistoryCallbackAction,
	handleContextActionCallback,
	handleDiscoveryItemCallback,
	handleDiscoveryMenuFilterCallback,
	handleHistoryCallback,
	handleModelSetCallback,
	handleSessionNewCallback,
	handleSessionResumeCallback,
} from "./telegram-callback-handlers.js";

const UNSUPPORTED_ACTION_MESSAGE = "Unsupported action. Use /open or /find again.";

function asContextAction(action: CallbackAction): ContextCallbackAction | null {
	if (action === "ctx_exit" || action === "ctx_del" || action === "ctx_viewer") {
		return action;
	}
	return null;
}

function asDiscoveryMenuFilterAction(action: CallbackAction): DiscoveryMenuFilterAction | null {
	if (
		action === "menu_time" ||
		action === "menu_time_set" ||
		action === "menu_source" ||
		action === "menu_source_set" ||
		action === "menu_tag" ||
		action === "menu_tag_set" ||
		action === "menu_tag_page" ||
		action === "menu_sort" ||
		action === "menu_sort_set" ||
		action === "menu_back" ||
		action === "menu_clear" ||
		action === "menu_prev" ||
		action === "menu_next"
	) {
		return action;
	}
	return null;
}

function asHistoryAction(action: CallbackAction): HistoryCallbackAction | null {
	if (action === "hist_prev" || action === "hist_next" || action === "hist_back" || action === "hist_full") {
		return action;
	}
	return null;
}

function asDiscoveryAction(action: CallbackAction): DiscoveryItemCallbackAction | null {
	if (action === "find_open" || action === "find_del" || action === "list_open" || action === "list_del") {
		return action;
	}
	return null;
}

export interface TelegramCallbackRouterContext {
	chatId: number;
	data: string;
	modelSelector: TelegramRuntimeModelSelector | null;
	getChatMode: (chatId: number) => ChatModeLike | undefined;
	clearChatMode: (chatId: number) => boolean;
	deleteItemAndNotify: (chatId: number, itemId: string) => Promise<void>;
	getViewerItemUrl?: (itemId: string) => string;

	getModelMenu: (chatId: number, menuId: string) => ModelMenuStateLike | null;
	getModelIdByIndex: (menu: ModelMenuStateLike, argument: string) => string | null;
	createModelMenu: (chatId: number, modelIds: string[]) => string;
	buildModelsMenuText: (modelIds: string[], selectedModelId: string) => string;
	buildModelsMenuKeyboard: (menuId: string, modelIds: string[], selectedModelId: string) => InlineKeyboard;

	getItemMenu: (chatId: number, menuId: string) => ItemMenuStateLike | null;
	getMenuItemId: (menu: ItemMenuStateLike, argument: string) => string | null;
	collectMenuTags: (menu: ItemMenuStateLike) => string[];
	buildTimeMenuKeyboard: (menuId: string) => InlineKeyboard;
	buildSourceMenuKeyboard: (menuId: string) => InlineKeyboard;
	buildSortMenuKeyboard: (menuId: string) => InlineKeyboard;
	buildTagMenuKeyboard: (menuId: string, menu: ItemMenuStateLike) => InlineKeyboard;
	buildMenuBackKeyboard: (menuId: string) => InlineKeyboard;
	parseTimeFilter: (argument: string) => ItemMenuStateLike["time"] | null;
	parseSourceFilter: (argument: string) => ItemMenuStateLike["source"] | null;
	parseSortFilter: (argument: string) => ItemMenuStateLike["sort"] | null;
	parseTagSelection: (menu: ItemMenuStateLike, argument: string) => string | null;
	parseTagPage: (argument: string, totalPages: number) => number;
	pagedMenuEntries: (menu: ItemMenuStateLike) => { page: number; totalPages: number };
	buildDiscoveryMenuText: (menu: ItemMenuStateLike) => string;
	buildDiscoveryMenuKeyboard: (menuId: string, menu: ItemMenuStateLike) => InlineKeyboard;

	getSessionMenu: (chatId: number, menuId: string) => SessionMenuStateLike | null;
	getSessionIdByIndex: (menu: SessionMenuStateLike, argument: string) => string | null;
	resumeItemDialogue: (sessionId: string) => DialogueSessionInfoLike;
	createItemDialogue: (itemId: string) => DialogueSessionInfoLike;
	openItemDialogue: (itemId: string) => DialogueSessionInfoLike;
	setChatMode: (chatId: number, mode: { mode: "item"; itemId: string; sessionId: string }) => void;
	sendItemModeOpenedMessage: (chatId: number, header: string, itemId: string, sessionId: string) => Promise<void>;

	getHistoryMenu: (chatId: number, menuId: string) => HistoryMenuStateLike | null;
	listDialogueHistory: (sessionId: string, limit: number) => DialogueTurnLike[];
	getHistoryPage: (
		sessionId: string,
		page: number,
		pageSize: number,
	) => { text: string; pageTurnsCount: number; safePage: number; totalPages: number };
	createHistoryMenu: (chatId: number, sessionId: string, page: number, pageSize: number) => string;
	buildHistoryKeyboard: (menuId: string, pageTurnsCount: number) => InlineKeyboard;
	formatDisplayTime: (timestamp: string) => string;
	splitForTelegram: (text: string) => string[];

	sendMessage: (chatId: number, text: string, options?: { inlineKeyboard?: InlineKeyboard }) => Promise<void>;
}

export async function routeTelegramCallback(context: TelegramCallbackRouterContext): Promise<void> {
	const payload = parseCallbackPayload(context.data);
	if (!payload) {
		await context.sendMessage(context.chatId, UNSUPPORTED_ACTION_MESSAGE);
		return;
	}

	if (payload.action.startsWith("ctx_")) {
		const contextAction = asContextAction(payload.action);
		if (!contextAction) {
			await context.sendMessage(context.chatId, UNSUPPORTED_ACTION_MESSAGE);
			return;
		}
		const handled = await handleContextActionCallback({
			chatId: context.chatId,
			action: contextAction,
			getChatMode: context.getChatMode,
			clearChatMode: context.clearChatMode,
			deleteItemAndNotify: context.deleteItemAndNotify,
			getViewerItemUrl: context.getViewerItemUrl,
			sendMessage: context.sendMessage,
		});
		if (handled) {
			return;
		}
	}

	if (payload.action === "model_set") {
		const handled = await handleModelSetCallback({
			chatId: context.chatId,
			menuId: payload.menuId,
			argument: payload.argument,
			modelSelector: context.modelSelector,
			getModelMenu: context.getModelMenu,
			getModelIdByIndex: context.getModelIdByIndex,
			createModelMenu: context.createModelMenu,
			buildModelsMenuText: context.buildModelsMenuText,
			buildModelsMenuKeyboard: context.buildModelsMenuKeyboard,
			sendMessage: context.sendMessage,
		});
		if (handled) {
			return;
		}
	}

	const menuFilterAction = asDiscoveryMenuFilterAction(payload.action);
	if (menuFilterAction) {
		const handled = await handleDiscoveryMenuFilterCallback({
			chatId: context.chatId,
			menuId: payload.menuId,
			action: menuFilterAction,
			argument: payload.argument,
			getItemMenu: context.getItemMenu,
			collectMenuTags: context.collectMenuTags,
			buildTimeMenuKeyboard: context.buildTimeMenuKeyboard,
			buildSourceMenuKeyboard: context.buildSourceMenuKeyboard,
			buildSortMenuKeyboard: context.buildSortMenuKeyboard,
			buildTagMenuKeyboard: context.buildTagMenuKeyboard,
			buildMenuBackKeyboard: context.buildMenuBackKeyboard,
			parseTimeFilter: context.parseTimeFilter,
			parseSourceFilter: context.parseSourceFilter,
			parseSortFilter: context.parseSortFilter,
			parseTagSelection: context.parseTagSelection,
			parseTagPage: context.parseTagPage,
			pagedMenuEntries: context.pagedMenuEntries,
			buildDiscoveryMenuText: context.buildDiscoveryMenuText,
			buildDiscoveryMenuKeyboard: context.buildDiscoveryMenuKeyboard,
			sendMessage: context.sendMessage,
		});
		if (handled) {
			return;
		}
	}

	if (payload.action === "sess_resume") {
		const handled = await handleSessionResumeCallback({
			chatId: context.chatId,
			menuId: payload.menuId,
			argument: payload.argument,
			getSessionMenu: context.getSessionMenu,
			getSessionIdByIndex: context.getSessionIdByIndex,
			resumeItemDialogue: context.resumeItemDialogue,
			createItemDialogue: context.createItemDialogue,
			setChatMode: context.setChatMode,
			sendItemModeOpenedMessage: context.sendItemModeOpenedMessage,
			sendMessage: context.sendMessage,
		});
		if (handled) {
			return;
		}
	}

	if (payload.action === "sess_new") {
		const handled = await handleSessionNewCallback({
			chatId: context.chatId,
			menuId: payload.menuId,
			argument: payload.argument,
			getSessionMenu: context.getSessionMenu,
			getSessionIdByIndex: context.getSessionIdByIndex,
			resumeItemDialogue: context.resumeItemDialogue,
			createItemDialogue: context.createItemDialogue,
			setChatMode: context.setChatMode,
			sendItemModeOpenedMessage: context.sendItemModeOpenedMessage,
			sendMessage: context.sendMessage,
		});
		if (handled) {
			return;
		}
	}

	const historyAction = asHistoryAction(payload.action);
	if (historyAction) {
		const handled = await handleHistoryCallback({
			chatId: context.chatId,
			menuId: payload.menuId,
			action: historyAction,
			argument: payload.argument,
			getHistoryMenu: context.getHistoryMenu,
			listDialogueHistory: context.listDialogueHistory,
			getHistoryPage: context.getHistoryPage,
			createHistoryMenu: context.createHistoryMenu,
			buildHistoryKeyboard: context.buildHistoryKeyboard,
			formatDisplayTime: context.formatDisplayTime,
			splitForTelegram: context.splitForTelegram,
			sendMessage: context.sendMessage,
		});
		if (handled) {
			return;
		}
	}

	const discoveryAction = asDiscoveryAction(payload.action);
	if (!discoveryAction) {
		await context.sendMessage(context.chatId, UNSUPPORTED_ACTION_MESSAGE);
		return;
	}
	const handled = await handleDiscoveryItemCallback({
		chatId: context.chatId,
		menuId: payload.menuId,
		action: discoveryAction,
		argument: payload.argument,
		getItemMenu: context.getItemMenu,
		getMenuItemId: context.getMenuItemId,
		deleteItemAndNotify: context.deleteItemAndNotify,
		buildDiscoveryMenuText: context.buildDiscoveryMenuText,
		buildDiscoveryMenuKeyboard: context.buildDiscoveryMenuKeyboard,
		openItemDialogue: context.openItemDialogue,
		setChatMode: context.setChatMode,
		sendItemModeOpenedMessage: context.sendItemModeOpenedMessage,
		sendMessage: context.sendMessage,
	});
	if (handled) {
		return;
	}
}
