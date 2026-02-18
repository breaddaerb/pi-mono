import type { TelegramRuntimeModelSelector } from "../telegram.js";
import type { InlineKeyboard, MessageSender, ModelMenuStateLike } from "./types.js";

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
