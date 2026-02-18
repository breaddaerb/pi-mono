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
