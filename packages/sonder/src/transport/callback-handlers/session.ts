import type { ChatModeSetter, DialogueSessionInfoLike, MessageSender, SessionMenuStateLike } from "./types.js";

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
