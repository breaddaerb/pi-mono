import type { ChatModeLike, MessageSender } from "./types.js";

export type ContextCallbackAction = "ctx_exit" | "ctx_viewer" | "ctx_del";

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
