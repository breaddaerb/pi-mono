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

export type HistoryCallbackAction = "hist_prev" | "hist_next" | "hist_back" | "hist_full";

export type DiscoveryItemCallbackAction = "find_open" | "find_del" | "list_open" | "list_del";

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
