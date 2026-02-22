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
	buildItemReplyKeyboard: () => Array<Array<{ text: string; callbackData: string }>>;
	sendMessage: (
		chatId: number,
		text: string,
		options?: { inlineKeyboard?: Array<Array<{ text: string; callbackData: string }>> },
	) => Promise<void>;
}

export async function handleActiveModeMessage(context: ActiveModeMessageHandlerContext): Promise<void> {
	if (context.activeMode.mode === "item") {
		const askResult = await context.askInItemDialogue(
			context.activeMode.itemId,
			context.activeMode.sessionId,
			context.text,
		);
		const formatted = context.formatContextualAnswer(context.chatId, askResult.answer, askResult.itemId);
		const chunks = context.splitForTelegram(formatted);
		for (let index = 0; index < chunks.length; index++) {
			const chunk = chunks[index];
			const isLast = index === chunks.length - 1;
			await context.sendMessage(
				context.chatId,
				chunk,
				isLast ? { inlineKeyboard: context.buildItemReplyKeyboard() } : undefined,
			);
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
