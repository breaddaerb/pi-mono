import type { ContextTurnState } from "../../storage/index.js";
import type { ChatModeLike, ContextPanelMenuStateLike, InlineKeyboard, MessageSender } from "./types.js";

export type ContextControlCallbackAction =
	| "ctx_panel"
	| "ctx_detach_last"
	| "ctxp_prev"
	| "ctxp_next"
	| "ctxp_detach"
	| "ctxp_attach"
	| "ctxp_dump";

interface ContextPanelTurnLike {
	semanticTurnId: string;
	createdAt: string;
	state: ContextTurnState;
	summary: string;
}

interface ContextPanelPageLike {
	sessionId: string;
	page: number;
	pageSize: number;
	total: number;
	totalPages: number;
	turns: ContextPanelTurnLike[];
}

interface ContextDumpLike {
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
}

export interface ContextControlCallbackContext {
	chatId: number;
	action: ContextControlCallbackAction;
	menuId: string;
	argument: string;
	getChatMode: (chatId: number) => ChatModeLike | undefined;
	getContextPanelMenu: (chatId: number, menuId: string) => ContextPanelMenuStateLike | null;
	createContextPanelMenu: (
		chatId: number,
		sessionId: string,
		page: number,
		pageSize: number,
		rowSemanticTurnIds: string[],
	) => string;
	listContextTurns: (sessionId: string, page: number, pageSize: number) => ContextPanelPageLike;
	setContextTurnState: (sessionId: string, semanticTurnId: string, state: ContextTurnState) => boolean;
	detachLastContextTurn: (sessionId: string) => string | null;
	compileContextDump: (sessionId: string, tokenBudget: number) => ContextDumpLike;
	renderContextPanel: (menuId: string, page: ContextPanelPageLike) => { text: string; inlineKeyboard: InlineKeyboard };
	splitForTelegram: (text: string) => string[];
	sendMessage: MessageSender;
}

const DEFAULT_CONTEXT_PANEL_PAGE_SIZE = 10;
const DEFAULT_CONTEXT_DUMP_TOKEN_BUDGET = 12_000;

function getActiveItemSessionId(
	getChatMode: (chatId: number) => ChatModeLike | undefined,
	chatId: number,
): string | null {
	const mode = getChatMode(chatId);
	if (!mode || mode.mode !== "item") {
		return null;
	}
	return mode.sessionId;
}

function parseRowIndex(argument: string): number | null {
	const index = Number.parseInt(argument, 10);
	if (!Number.isFinite(index) || index <= 0) {
		return null;
	}
	return index - 1;
}

function formatContextDump(dump: ContextDumpLike): string {
	const included =
		dump.compiledItems.length === 0
			? "(none)"
			: dump.compiledItems
					.map((item, index) => `${index + 1}. ${item.semanticTurnId} · ${item.reason} · ~${item.approxTokens}`)
					.join("\n");
	const excluded =
		dump.excludedItems.length === 0
			? "(none)"
			: dump.excludedItems
					.map((item, index) => `${index + 1}. ${item.semanticTurnId} · ${item.reason} · ~${item.approxTokens}`)
					.join("\n");
	return [
		`Context dump for ${dump.sessionId}`,
		`Token budget: ${dump.tokenBudget} · approx used: ${dump.approxTotalTokens}`,
		"",
		"Included:",
		included,
		"",
		"Excluded:",
		excluded,
		"",
		"Compiled preview:",
		dump.compiledTextPreview,
	].join("\n");
}

async function sendPanel(
	context: ContextControlCallbackContext,
	sessionId: string,
	page: number,
	pageSize: number,
): Promise<void> {
	const pageData = context.listContextTurns(sessionId, page, pageSize);
	const menuId = context.createContextPanelMenu(
		context.chatId,
		sessionId,
		pageData.page,
		pageData.pageSize,
		pageData.turns.map((turn) => turn.semanticTurnId),
	);
	const rendered = context.renderContextPanel(menuId, pageData);
	await context.sendMessage(context.chatId, rendered.text, { inlineKeyboard: rendered.inlineKeyboard });
}

export async function handleContextControlCallback(context: ContextControlCallbackContext): Promise<boolean> {
	if (context.action === "ctx_panel") {
		const sessionId = getActiveItemSessionId(context.getChatMode, context.chatId);
		if (!sessionId) {
			await context.sendMessage(
				context.chatId,
				"Context panel is available in item mode only. Use /open <itemId> first.",
			);
			return true;
		}
		await sendPanel(context, sessionId, 0, DEFAULT_CONTEXT_PANEL_PAGE_SIZE);
		return true;
	}

	if (context.action === "ctx_detach_last") {
		const sessionId = getActiveItemSessionId(context.getChatMode, context.chatId);
		if (!sessionId) {
			await context.sendMessage(
				context.chatId,
				"Detach-last is available in item mode only. Use /open <itemId> first.",
			);
			return true;
		}
		const detachedTurnId = context.detachLastContextTurn(sessionId);
		if (!detachedTurnId) {
			await context.sendMessage(context.chatId, "No turns available to detach in this session.");
			return true;
		}
		await context.sendMessage(context.chatId, "Detached most recent turn from next-round context.");
		await sendPanel(context, sessionId, 0, DEFAULT_CONTEXT_PANEL_PAGE_SIZE);
		return true;
	}

	const panelMenu = context.getContextPanelMenu(context.chatId, context.menuId);
	if (!panelMenu) {
		await context.sendMessage(context.chatId, "This context panel expired. Use Open Context Panel again.");
		return true;
	}

	if (context.action === "ctxp_dump") {
		const dump = context.compileContextDump(panelMenu.sessionId, DEFAULT_CONTEXT_DUMP_TOKEN_BUDGET);
		for (const chunk of context.splitForTelegram(formatContextDump(dump))) {
			await context.sendMessage(context.chatId, chunk);
		}
		return true;
	}

	if (context.action === "ctxp_prev" || context.action === "ctxp_next") {
		const currentPage = context.listContextTurns(panelMenu.sessionId, panelMenu.page, panelMenu.pageSize);
		const delta = context.action === "ctxp_prev" ? -1 : 1;
		const nextPage = Math.max(0, Math.min(currentPage.page + delta, currentPage.totalPages - 1));
		await sendPanel(context, panelMenu.sessionId, nextPage, panelMenu.pageSize);
		return true;
	}

	const rowIndex = parseRowIndex(context.argument);
	if (rowIndex === null) {
		await context.sendMessage(context.chatId, "Invalid context panel selection.");
		return true;
	}

	const snapshotTurnId = panelMenu.rowSemanticTurnIds[rowIndex];
	if (!snapshotTurnId) {
		await context.sendMessage(context.chatId, "Invalid context panel selection.");
		return true;
	}

	const pageData = context.listContextTurns(panelMenu.sessionId, panelMenu.page, panelMenu.pageSize);
	const currentTurnAtRow = pageData.turns[rowIndex];
	if (!currentTurnAtRow || currentTurnAtRow.semanticTurnId !== snapshotTurnId) {
		await context.sendMessage(context.chatId, "This context panel expired. Use Open Context Panel again.");
		return true;
	}

	if (context.action === "ctxp_detach") {
		context.setContextTurnState(panelMenu.sessionId, snapshotTurnId, "DETACHED");
		await sendPanel(context, panelMenu.sessionId, pageData.page, pageData.pageSize);
		return true;
	}

	context.setContextTurnState(panelMenu.sessionId, snapshotTurnId, "ACTIVE");
	await sendPanel(context, panelMenu.sessionId, pageData.page, pageData.pageSize);
	return true;
}
