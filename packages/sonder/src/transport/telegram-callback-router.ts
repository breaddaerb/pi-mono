import type {
	ChatModeLike,
	ContextPanelMenuStateLike,
	DialogueSessionInfoLike,
	DialogueTurnLike,
	HistoryMenuStateLike,
	InlineKeyboard,
	ItemMenuStateLike,
	ModelMenuStateLike,
	SessionMenuStateLike,
} from "./callback-handlers/types.js";
import type { TelegramRuntimeModelSelector } from "./telegram.js";
import { type CallbackAction, type CallbackPayload, parseCallbackPayload } from "./telegram-callback.js";
import {
	type ContextCallbackAction,
	type ContextControlCallbackAction,
	type DiscoveryItemCallbackAction,
	type DiscoveryMenuFilterAction,
	type HistoryCallbackAction,
	handleContextActionCallback,
	handleContextControlCallback,
	handleDiscoveryItemCallback,
	handleDiscoveryMenuFilterCallback,
	handleHistoryCallback,
	handleModelSetCallback,
	handleSessionNewCallback,
	handleSessionResumeCallback,
} from "./telegram-callback-handlers.js";

const UNSUPPORTED_ACTION_MESSAGE = "Unsupported action. Use /open or /find again.";

type TelegramCallbackActionHandler = (
	context: TelegramCallbackRouterContext,
	payload: CallbackPayload,
) => Promise<boolean>;

function createContextActionHandler(action: ContextCallbackAction): TelegramCallbackActionHandler {
	return async (context) => {
		return handleContextActionCallback({
			chatId: context.chatId,
			action,
			getChatMode: context.getChatMode,
			clearChatMode: context.clearChatMode,
			deleteItemAndNotify: context.deleteItemAndNotify,
			getViewerItemUrl: context.getViewerItemUrl,
			sendMessage: context.sendMessage,
		});
	};
}

function createContextControlHandler(action: ContextControlCallbackAction): TelegramCallbackActionHandler {
	return async (context, payload) => {
		return handleContextControlCallback({
			chatId: context.chatId,
			action,
			menuId: payload.menuId,
			argument: payload.argument,
			getChatMode: context.getChatMode,
			getContextPanelMenu: context.getContextPanelMenu,
			createContextPanelMenu: context.createContextPanelMenu,
			listContextTurns: context.listContextTurns,
			setContextTurnState: context.setContextTurnState,
			detachLastContextTurn: context.detachLastContextTurn,
			compileContextDump: context.compileContextDump,
			renderContextPanel: context.renderContextPanel,
			splitForTelegram: context.splitForTelegram,
			sendMessage: context.sendMessage,
		});
	};
}

function createDiscoveryMenuFilterHandler(action: DiscoveryMenuFilterAction): TelegramCallbackActionHandler {
	return async (context, payload) => {
		return handleDiscoveryMenuFilterCallback({
			chatId: context.chatId,
			menuId: payload.menuId,
			action,
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
	};
}

function createSessionResumeHandler(): TelegramCallbackActionHandler {
	return async (context, payload) => {
		return handleSessionResumeCallback({
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
	};
}

function createSessionNewHandler(): TelegramCallbackActionHandler {
	return async (context, payload) => {
		return handleSessionNewCallback({
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
	};
}

function createHistoryActionHandler(action: HistoryCallbackAction): TelegramCallbackActionHandler {
	return async (context, payload) => {
		return handleHistoryCallback({
			chatId: context.chatId,
			menuId: payload.menuId,
			action,
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
	};
}

function createDiscoveryItemHandler(action: DiscoveryItemCallbackAction): TelegramCallbackActionHandler {
	return async (context, payload) => {
		return handleDiscoveryItemCallback({
			chatId: context.chatId,
			menuId: payload.menuId,
			action,
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
	};
}

function createModelSetHandler(): TelegramCallbackActionHandler {
	return async (context, payload) => {
		return handleModelSetCallback({
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
	};
}

const CALLBACK_ACTION_HANDLERS: Record<CallbackAction, TelegramCallbackActionHandler> = {
	ctx_exit: createContextActionHandler("ctx_exit"),
	ctx_viewer: createContextActionHandler("ctx_viewer"),
	ctx_del: createContextActionHandler("ctx_del"),
	ctx_panel: createContextControlHandler("ctx_panel"),
	ctx_detach_last: createContextControlHandler("ctx_detach_last"),
	ctxp_prev: createContextControlHandler("ctxp_prev"),
	ctxp_next: createContextControlHandler("ctxp_next"),
	ctxp_detach: createContextControlHandler("ctxp_detach"),
	ctxp_attach: createContextControlHandler("ctxp_attach"),
	ctxp_dump: createContextControlHandler("ctxp_dump"),
	model_set: createModelSetHandler(),
	menu_time: createDiscoveryMenuFilterHandler("menu_time"),
	menu_time_set: createDiscoveryMenuFilterHandler("menu_time_set"),
	menu_source: createDiscoveryMenuFilterHandler("menu_source"),
	menu_source_set: createDiscoveryMenuFilterHandler("menu_source_set"),
	menu_tag: createDiscoveryMenuFilterHandler("menu_tag"),
	menu_tag_set: createDiscoveryMenuFilterHandler("menu_tag_set"),
	menu_tag_page: createDiscoveryMenuFilterHandler("menu_tag_page"),
	menu_sort: createDiscoveryMenuFilterHandler("menu_sort"),
	menu_sort_set: createDiscoveryMenuFilterHandler("menu_sort_set"),
	menu_back: createDiscoveryMenuFilterHandler("menu_back"),
	menu_clear: createDiscoveryMenuFilterHandler("menu_clear"),
	menu_prev: createDiscoveryMenuFilterHandler("menu_prev"),
	menu_next: createDiscoveryMenuFilterHandler("menu_next"),
	sess_resume: createSessionResumeHandler(),
	sess_new: createSessionNewHandler(),
	hist_prev: createHistoryActionHandler("hist_prev"),
	hist_next: createHistoryActionHandler("hist_next"),
	hist_back: createHistoryActionHandler("hist_back"),
	hist_full: createHistoryActionHandler("hist_full"),
	find_open: createDiscoveryItemHandler("find_open"),
	find_del: createDiscoveryItemHandler("find_del"),
	list_open: createDiscoveryItemHandler("list_open"),
	list_del: createDiscoveryItemHandler("list_del"),
};

export interface TelegramCallbackRouterContext {
	chatId: number;
	data: string;
	modelSelector: TelegramRuntimeModelSelector | null;
	getChatMode: (chatId: number) => ChatModeLike | undefined;
	clearChatMode: (chatId: number) => boolean;
	deleteItemAndNotify: (chatId: number, itemId: string) => Promise<void>;
	getViewerItemUrl?: (itemId: string) => string;

	getContextPanelMenu: (chatId: number, menuId: string) => ContextPanelMenuStateLike | null;
	createContextPanelMenu: (
		chatId: number,
		sessionId: string,
		page: number,
		pageSize: number,
		rowSemanticTurnIds: string[],
	) => string;
	listContextTurns: (
		sessionId: string,
		page: number,
		pageSize: number,
	) => {
		sessionId: string;
		page: number;
		pageSize: number;
		total: number;
		totalPages: number;
		turns: Array<{ semanticTurnId: string; createdAt: string; state: "ACTIVE" | "DETACHED"; summary: string }>;
	};
	setContextTurnState: (sessionId: string, semanticTurnId: string, state: "ACTIVE" | "DETACHED") => boolean;
	detachLastContextTurn: (sessionId: string) => string | null;
	compileContextDump: (
		sessionId: string,
		tokenBudget: number,
	) => {
		sessionId: string;
		tokenBudget: number;
		approxTotalTokens: number;
		compiledItems: Array<{ semanticTurnId: string; reason: "active"; approxTokens: number }>;
		excludedItems: Array<{
			semanticTurnId: string;
			reason: "detached" | "pruned_active";
			approxTokens: number;
		}>;
		compiledTextPreview: string;
	};
	renderContextPanel: (
		menuId: string,
		page: {
			sessionId: string;
			page: number;
			pageSize: number;
			total: number;
			totalPages: number;
			turns: Array<{ semanticTurnId: string; createdAt: string; state: "ACTIVE" | "DETACHED"; summary: string }>;
		},
	) => { text: string; inlineKeyboard: InlineKeyboard };

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

	const actionHandler = CALLBACK_ACTION_HANDLERS[payload.action];
	const handled = await actionHandler(context, payload);
	if (handled) {
		return;
	}

	await context.sendMessage(context.chatId, UNSUPPORTED_ACTION_MESSAGE);
}
