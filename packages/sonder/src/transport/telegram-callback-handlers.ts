import type { TelegramRuntimeModelSelector } from "./telegram.js";

type InlineKeyboard = Array<Array<{ text: string; callbackData: string }>>;

interface ModelMenuStateLike {
	modelIds: string[];
}

interface SessionMenuStateLike {
	itemId: string;
	sessionIds: string[];
}

interface DialogueSessionInfoLike {
	itemId: string;
	sessionId: string;
}

interface ItemMenuStateLike {
	kind: "find" | "list";
	page: number;
	pageSize: number;
	time: "all" | "today" | "7d" | "30d" | "year";
	source: "any" | "web";
	tag: string | null;
	sort: "newest" | "oldest";
	tagPage: number;
}

interface HistoryMenuStateLike {
	sessionId: string;
	page: number;
	pageSize: number;
}

interface DialogueTurnLike {
	role: "user" | "assistant" | "system";
	content: string;
	status: "pending" | "failed" | "completed";
	errorMessage: string | null;
	createdAt: string;
}

type ChatModeLike =
	| { mode: "item"; itemId: string; sessionId: string }
	| { mode: "general"; sessionId: string; history: Array<{ role: "user" | "assistant"; content: string }> };

export type HistoryCallbackAction = "hist_prev" | "hist_next" | "hist_back" | "hist_full";

export type DiscoveryItemCallbackAction = "find_open" | "find_del" | "list_open" | "list_del";

export type ContextCallbackAction = "ctx_exit" | "ctx_viewer" | "ctx_del";

export type DiscoveryMenuFilterAction =
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

type ChatModeSetter = (chatId: number, mode: { mode: "item"; itemId: string; sessionId: string }) => void;

type MessageSender = (chatId: number, text: string, options?: { inlineKeyboard?: InlineKeyboard }) => Promise<void>;

export interface ModelSetCallbackContext {
	chatId: number;
	menuId: string;
	argument: string;
	modelSelector: TelegramRuntimeModelSelector | null;
	getModelMenu: (chatId: number, menuId: string) => ModelMenuStateLike | null;
	getModelIdByIndex: (menu: ModelMenuStateLike, argument: string) => string | null;
	createModelMenu: (chatId: number, modelIds: string[]) => string;
	buildModelsMenuText: (modelIds: string[], selectedModelId: string) => string;
	buildModelsMenuKeyboard: (menuId: string, modelIds: string[], selectedModelId: string) => InlineKeyboard;
	sendMessage: MessageSender;
}

export async function handleModelSetCallback(context: ModelSetCallbackContext): Promise<boolean> {
	if (!context.modelSelector) {
		await context.sendMessage(context.chatId, "Model selector is available in codex responder mode only.");
		return true;
	}

	const menu = context.getModelMenu(context.chatId, context.menuId);
	if (!menu) {
		await context.sendMessage(context.chatId, "This models menu expired. Use /models again.");
		return true;
	}

	const modelId = context.getModelIdByIndex(menu, context.argument);
	if (!modelId) {
		await context.sendMessage(context.chatId, "Invalid model selection. Use /models again.");
		return true;
	}

	const changed = context.modelSelector.setSelectedModelId(modelId);
	if (!changed) {
		await context.sendMessage(context.chatId, "Failed to set model. Use /models again.");
		return true;
	}

	const modelIds = context.modelSelector.listModels().map((model) => model.id);
	const selectedModelId = context.modelSelector.getSelectedModelId();
	const nextMenuId = context.createModelMenu(context.chatId, modelIds);
	await context.sendMessage(context.chatId, context.buildModelsMenuText(modelIds, selectedModelId), {
		inlineKeyboard: context.buildModelsMenuKeyboard(nextMenuId, modelIds, selectedModelId),
	});
	return true;
}

export interface SessionCallbackContext {
	chatId: number;
	menuId: string;
	argument: string;
	getSessionMenu: (chatId: number, menuId: string) => SessionMenuStateLike | null;
	getSessionIdByIndex: (menu: SessionMenuStateLike, argument: string) => string | null;
	resumeItemDialogue: (sessionId: string) => DialogueSessionInfoLike;
	createItemDialogue: (itemId: string) => DialogueSessionInfoLike;
	setChatMode: ChatModeSetter;
	sendItemModeOpenedMessage: (chatId: number, header: string, itemId: string, sessionId: string) => Promise<void>;
	sendMessage: MessageSender;
}

export async function handleSessionResumeCallback(context: SessionCallbackContext): Promise<boolean> {
	const menu = context.getSessionMenu(context.chatId, context.menuId);
	if (!menu) {
		await context.sendMessage(context.chatId, "This sessions menu expired. Use /sessions again.");
		return true;
	}

	const sessionId = context.getSessionIdByIndex(menu, context.argument);
	if (!sessionId) {
		await context.sendMessage(context.chatId, "Invalid session selection. Use /sessions again.");
		return true;
	}

	const resumed = context.resumeItemDialogue(sessionId);
	context.setChatMode(context.chatId, { mode: "item", itemId: resumed.itemId, sessionId: resumed.sessionId });
	await context.sendItemModeOpenedMessage(
		context.chatId,
		"🧠 Item dialogue resumed.",
		resumed.itemId,
		resumed.sessionId,
	);
	return true;
}

export async function handleSessionNewCallback(context: SessionCallbackContext): Promise<boolean> {
	const menu = context.getSessionMenu(context.chatId, context.menuId);
	if (!menu) {
		await context.sendMessage(context.chatId, "This sessions menu expired. Use /sessions again.");
		return true;
	}

	const opened = context.createItemDialogue(menu.itemId);
	context.setChatMode(context.chatId, { mode: "item", itemId: opened.itemId, sessionId: opened.sessionId });
	await context.sendItemModeOpenedMessage(
		context.chatId,
		"🧠 New item session started.",
		opened.itemId,
		opened.sessionId,
	);
	return true;
}

export interface ContextActionCallbackContext {
	chatId: number;
	action: ContextCallbackAction;
	getChatMode: (chatId: number) => ChatModeLike | undefined;
	clearChatMode: (chatId: number) => boolean;
	deleteItemAndNotify: (chatId: number, itemId: string) => Promise<void>;
	getViewerItemUrl?: (itemId: string) => string;
	sendMessage: MessageSender;
}

export async function handleContextActionCallback(context: ContextActionCallbackContext): Promise<boolean> {
	const mode = context.getChatMode(context.chatId);
	if (!mode) {
		await context.sendMessage(context.chatId, "No active context. Use /find or /list, then open an item.");
		return true;
	}

	if (context.action === "ctx_exit") {
		context.clearChatMode(context.chatId);
		await context.sendMessage(context.chatId, "Exited active dialogue mode.");
		return true;
	}

	if (context.action === "ctx_del") {
		if (mode.mode !== "item") {
			await context.sendMessage(context.chatId, "Delete is available in item mode only.");
			return true;
		}
		await context.deleteItemAndNotify(context.chatId, mode.itemId);
		return true;
	}

	if (mode.mode !== "item") {
		await context.sendMessage(context.chatId, "Viewer is available in item mode only.");
		return true;
	}
	if (!context.getViewerItemUrl) {
		await context.sendMessage(context.chatId, "Viewer is not enabled for this run.");
		return true;
	}
	await context.sendMessage(context.chatId, context.getViewerItemUrl(mode.itemId));
	return true;
}

export interface DiscoveryItemCallbackContext {
	chatId: number;
	menuId: string;
	action: DiscoveryItemCallbackAction;
	argument: string;
	getItemMenu: (chatId: number, menuId: string) => ItemMenuStateLike | null;
	getMenuItemId: (menu: ItemMenuStateLike, argument: string) => string | null;
	deleteItemAndNotify: (chatId: number, itemId: string) => Promise<void>;
	buildDiscoveryMenuText: (menu: ItemMenuStateLike) => string;
	buildDiscoveryMenuKeyboard: (menuId: string, menu: ItemMenuStateLike) => InlineKeyboard;
	openItemDialogue: (itemId: string) => DialogueSessionInfoLike;
	setChatMode: ChatModeSetter;
	sendItemModeOpenedMessage: (chatId: number, header: string, itemId: string, sessionId: string) => Promise<void>;
	sendMessage: MessageSender;
}

export async function handleDiscoveryItemCallback(context: DiscoveryItemCallbackContext): Promise<boolean> {
	const menu = context.getItemMenu(context.chatId, context.menuId);
	if (!menu) {
		await context.sendMessage(context.chatId, "This menu expired. Use /open or /find again.");
		return true;
	}

	const expectedKind: ItemMenuStateLike["kind"] = context.action.startsWith("list_") ? "list" : "find";
	if (menu.kind !== expectedKind) {
		await context.sendMessage(
			context.chatId,
			"This menu action is no longer valid. Use /open, /list, or /find again.",
		);
		return true;
	}

	const itemId = context.getMenuItemId(menu, context.argument);
	if (!itemId) {
		await context.sendMessage(context.chatId, "Invalid selection. Use /list or /find again.");
		return true;
	}

	if (context.action === "find_del" || context.action === "list_del") {
		await context.deleteItemAndNotify(context.chatId, itemId);
		const refreshedMenu = context.getItemMenu(context.chatId, context.menuId);
		if (refreshedMenu) {
			const responseText = context.buildDiscoveryMenuText(refreshedMenu);
			const inlineKeyboard = context.buildDiscoveryMenuKeyboard(context.menuId, refreshedMenu);
			await context.sendMessage(context.chatId, responseText, { inlineKeyboard });
		}
		return true;
	}

	const opened = context.openItemDialogue(itemId);
	context.setChatMode(context.chatId, {
		mode: "item",
		itemId: opened.itemId,
		sessionId: opened.sessionId,
	});
	const prompt = `🧠 Item mode opened from result #${context.argument}.`;
	await context.sendItemModeOpenedMessage(context.chatId, prompt, opened.itemId, opened.sessionId);
	return true;
}

export interface DiscoveryMenuFilterCallbackContext {
	chatId: number;
	menuId: string;
	action: DiscoveryMenuFilterAction;
	argument: string;
	getItemMenu: (chatId: number, menuId: string) => ItemMenuStateLike | null;
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
	sendMessage: MessageSender;
}

export async function handleDiscoveryMenuFilterCallback(context: DiscoveryMenuFilterCallbackContext): Promise<boolean> {
	const menu = context.getItemMenu(context.chatId, context.menuId);
	if (!menu) {
		await context.sendMessage(context.chatId, "This menu expired. Use /list or /find again.");
		return true;
	}

	if (context.action === "menu_time") {
		await context.sendMessage(context.chatId, "Select time filter", {
			inlineKeyboard: context.buildTimeMenuKeyboard(context.menuId),
		});
		return true;
	}
	if (context.action === "menu_source") {
		await context.sendMessage(context.chatId, "Select source filter", {
			inlineKeyboard: context.buildSourceMenuKeyboard(context.menuId),
		});
		return true;
	}
	if (context.action === "menu_tag") {
		menu.tagPage = 0;
		const tags = context.collectMenuTags(menu);
		if (tags.length === 0) {
			await context.sendMessage(context.chatId, "No tags available for this menu.", {
				inlineKeyboard: context.buildMenuBackKeyboard(context.menuId),
			});
			return true;
		}
		await context.sendMessage(context.chatId, "Select tag filter", {
			inlineKeyboard: context.buildTagMenuKeyboard(context.menuId, menu),
		});
		return true;
	}
	if (context.action === "menu_sort") {
		await context.sendMessage(context.chatId, "Select sort order", {
			inlineKeyboard: context.buildSortMenuKeyboard(context.menuId),
		});
		return true;
	}

	if (context.action === "menu_time_set") {
		const next = context.parseTimeFilter(context.argument);
		if (next) {
			menu.time = next;
			menu.page = 0;
		}
	}
	if (context.action === "menu_source_set") {
		const next = context.parseSourceFilter(context.argument);
		if (next) {
			menu.source = next;
			menu.page = 0;
		}
	}
	if (context.action === "menu_sort_set") {
		const next = context.parseSortFilter(context.argument);
		if (next) {
			menu.sort = next;
			menu.page = 0;
		}
	}
	if (context.action === "menu_tag_set") {
		if (context.argument === "0") {
			menu.tag = null;
		} else {
			menu.tag = context.parseTagSelection(menu, context.argument);
		}
		menu.page = 0;
		menu.tagPage = 0;
	}
	if (context.action === "menu_tag_page") {
		const tags = context.collectMenuTags(menu);
		const totalPages = Math.max(1, Math.ceil(tags.length / 6));
		menu.tagPage = context.parseTagPage(context.argument, totalPages);
		await context.sendMessage(context.chatId, "Select tag filter", {
			inlineKeyboard: context.buildTagMenuKeyboard(context.menuId, menu),
		});
		return true;
	}
	if (context.action === "menu_clear") {
		menu.time = "all";
		menu.source = "any";
		menu.tag = null;
		menu.sort = "newest";
		menu.page = 0;
		menu.tagPage = 0;
	}
	if (context.action === "menu_prev" || context.action === "menu_next") {
		const pageInfo = context.pagedMenuEntries(menu);
		if (pageInfo.totalPages <= 1) {
			menu.page = 0;
		} else if (context.action === "menu_next") {
			menu.page = (pageInfo.page + 1) % pageInfo.totalPages;
		} else {
			menu.page = (pageInfo.page - 1 + pageInfo.totalPages) % pageInfo.totalPages;
		}
	}
	const responseText = context.buildDiscoveryMenuText(menu);
	const keyboard = context.buildDiscoveryMenuKeyboard(context.menuId, menu);
	await context.sendMessage(context.chatId, responseText, { inlineKeyboard: keyboard });
	return true;
}

export interface HistoryCallbackContext {
	chatId: number;
	menuId: string;
	action: HistoryCallbackAction;
	argument: string;
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
	sendMessage: MessageSender;
}

export async function handleHistoryCallback(context: HistoryCallbackContext): Promise<boolean> {
	const menu = context.getHistoryMenu(context.chatId, context.menuId);
	if (!menu) {
		await context.sendMessage(context.chatId, "This history menu expired. Use /history again.");
		return true;
	}

	if (context.action === "hist_back") {
		await context.sendMessage(context.chatId, "Back to item dialogue. Send your next message.");
		return true;
	}

	if (context.action === "hist_full") {
		const index = Number.parseInt(context.argument, 10);
		if (!Number.isFinite(index) || index <= 0) {
			await context.sendMessage(context.chatId, "Invalid history selection. Use /history again.");
			return true;
		}
		const turns = context.listDialogueHistory(menu.sessionId, 200);
		const totalPages = Math.max(1, Math.ceil(turns.length / menu.pageSize));
		const safePage = Math.max(0, Math.min(menu.page, totalPages - 1));
		const start = safePage * menu.pageSize;
		const turn = turns.slice(start, start + menu.pageSize)[index - 1];
		if (!turn) {
			await context.sendMessage(context.chatId, "History turn not found on this page.");
			return true;
		}
		const fullContent = turn.content || (turn.status === "failed" ? "(assistant turn failed)" : "(empty)");
		const statusLine = `Status: ${turn.status}`;
		const errorLine = turn.errorMessage ? `\nError: ${turn.errorMessage}` : "";
		const fullText = `History turn ${index} (page ${safePage + 1})\nRole: ${turn.role}\n${statusLine}${errorLine}\nTime: ${context.formatDisplayTime(turn.createdAt)}\n\n${fullContent}`;
		for (const chunk of context.splitForTelegram(fullText)) {
			await context.sendMessage(context.chatId, chunk);
		}
		return true;
	}

	const currentPage = context.getHistoryPage(menu.sessionId, menu.page, menu.pageSize);
	const direction = context.action === "hist_prev" ? -1 : 1;
	const clampedNextPage = Math.max(0, Math.min(currentPage.safePage + direction, currentPage.totalPages - 1));
	const nextMenuId = context.createHistoryMenu(context.chatId, menu.sessionId, clampedNextPage, menu.pageSize);
	const historyPage = context.getHistoryPage(menu.sessionId, clampedNextPage, menu.pageSize);
	await context.sendMessage(context.chatId, historyPage.text, {
		inlineKeyboard: context.buildHistoryKeyboard(nextMenuId, historyPage.pageTurnsCount),
	});
	return true;
}
