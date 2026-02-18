import type { SonderCommandResult, SonderProcessResult } from "../app/index.js";
import { formatCommandResult } from "./telegram-renderers.js";

type MenuKind = "find" | "list";

type ItemMenuEntry = {
	id: string;
	createdAt: string;
	sourceType: string;
	originalUrl: string;
	tags: string[];
	reasons: string[];
	snippets: string[];
};

type SaveResult = Extract<SonderCommandResult, { type: "save" }>;

export interface SlashMessageHandlerContext {
	chatId: number;
	normalizedInput: string;
	markSaveInputPending: (chatId: number) => void;
	clearPendingSaveInput: (chatId: number) => void;
	processCommand: (input: string) => Promise<SonderProcessResult>;
	sendSaveResultAndMaybeOpenItemMode: (chatId: number, saveResult: SaveResult) => Promise<void>;
	createItemMenu: (chatId: number, kind: MenuKind, entries: ItemMenuEntry[], query: string | null) => string;
	getItemMenu: (chatId: number, menuId: string) => unknown | null;
	buildDiscoveryMenuText: (menu: unknown) => string;
	buildDiscoveryMenuKeyboard: (menuId: string, menu: unknown) => Array<Array<{ text: string; callbackData: string }>>;
	splitForTelegram: (text: string) => string[];
	sendMessage: (
		chatId: number,
		text: string,
		options?: { inlineKeyboard?: Array<Array<{ text: string; callbackData: string }>> },
	) => Promise<void>;
}

export async function handleSlashMessage(context: SlashMessageHandlerContext): Promise<void> {
	if (context.normalizedInput.startsWith("/ask")) {
		context.clearPendingSaveInput(context.chatId);
		await context.sendMessage(
			context.chatId,
			"In Telegram, /ask is deprecated. Use /find or /list, tap Open, then ask in plain text.",
		);
		return;
	}

	const normalized = context.normalizedInput.trim();
	if (normalized === "/save") {
		context.markSaveInputPending(context.chatId);
		await context.sendMessage(
			context.chatId,
			"Send save input in your next message: <url> [#tags...] [pasted evidence text].\nExample: https://example.com/article #ml This argues that test-time scaling...",
		);
		return;
	}

	context.clearPendingSaveInput(context.chatId);
	const commandText = normalized === "/find" ? "/list" : context.normalizedInput;
	const result = await context.processCommand(commandText);
	if (result.ok && result.value.type === "save") {
		await context.sendSaveResultAndMaybeOpenItemMode(context.chatId, result.value);
		return;
	}

	if (result.ok && (result.value.type === "find" || result.value.type === "list") && result.value.items.length > 0) {
		const menuKind: MenuKind = result.value.type;
		const entries: ItemMenuEntry[] =
			result.value.type === "find"
				? result.value.items.map((item) => ({
						id: item.id,
						createdAt: item.createdAt,
						sourceType: String(item.sourceType),
						originalUrl: item.originalUrl,
						tags: item.tags,
						reasons: item.reasons,
						snippets: item.snippets,
					}))
				: result.value.items.map((item) => ({
						id: item.id,
						createdAt: item.createdAt,
						sourceType: String(item.sourceType),
						originalUrl: item.originalUrl,
						tags: item.tags,
						reasons: [],
						snippets: [],
					}));
		const query = result.value.type === "find" ? result.value.query : null;
		const menuId = context.createItemMenu(context.chatId, menuKind, entries, query);
		const menu = context.getItemMenu(context.chatId, menuId);
		if (!menu) {
			await context.sendMessage(context.chatId, "Failed to open discovery menu. Try again.");
			return;
		}
		const responseText = context.buildDiscoveryMenuText(menu);
		const inlineKeyboard = context.buildDiscoveryMenuKeyboard(menuId, menu);
		await context.sendMessage(context.chatId, responseText, { inlineKeyboard });
		return;
	}

	const responseText = formatCommandResult(result);
	for (const chunk of context.splitForTelegram(responseText)) {
		await context.sendMessage(context.chatId, chunk);
	}
}
