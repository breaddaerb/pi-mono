import type { ChatModeState } from "./telegram-mode-store.js";

export interface ActiveModeMessageHandlerContext {
	chatId: number;
	text: string;
	activeMode: ChatModeState;
	askInItemDialogue: (
		itemId: string,
		sessionId: string,
		message: string,
	) => Promise<{ answer: string; itemId: string }>;
	chatWithoutItem: (
		sessionId: string,
		message: string,
		history: Array<{ role: "user" | "assistant"; content: string }>,
	) => Promise<{ answer: string }>;
	setChatMode: (chatId: number, mode: ChatModeState) => void;
	formatContextualAnswer: (chatId: number, answer: string, itemId?: string) => string;
	splitForTelegram: (text: string) => string[];
	sendMessage: (chatId: number, text: string) => Promise<void>;
}

export async function handleActiveModeMessage(context: ActiveModeMessageHandlerContext): Promise<void> {
	if (context.activeMode.mode === "item") {
		const askResult = await context.askInItemDialogue(
			context.activeMode.itemId,
			context.activeMode.sessionId,
			context.text,
		);
		const formatted = context.formatContextualAnswer(context.chatId, askResult.answer, askResult.itemId);
		for (const chunk of context.splitForTelegram(formatted)) {
			await context.sendMessage(context.chatId, chunk);
		}
		return;
	}

	const response = await context.chatWithoutItem(
		context.activeMode.sessionId,
		context.text,
		context.activeMode.history,
	);
	context.activeMode.history.push({ role: "user", content: context.text });
	context.activeMode.history.push({ role: "assistant", content: response.answer });
	context.setChatMode(context.chatId, context.activeMode);
	const formatted = context.formatContextualAnswer(context.chatId, response.answer);
	for (const chunk of context.splitForTelegram(formatted)) {
		await context.sendMessage(context.chatId, chunk);
	}
}
