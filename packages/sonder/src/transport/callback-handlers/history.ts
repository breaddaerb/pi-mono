import type { DialogueTurnLike, HistoryMenuStateLike, InlineKeyboard, MessageSender } from "./types.js";

export type HistoryCallbackAction = "hist_prev" | "hist_next" | "hist_back" | "hist_full";

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
