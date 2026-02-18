import type { ParsedTelegramModeCommand } from "../commands/parse-mode-command.js";
import { parseTelegramModeCommand } from "../commands/parse-mode-command.js";
import { stripTelegramCommandMention } from "./telegram-utils.js";

export interface TelegramMessageRouterContext {
	chatId: number;
	text: string;
	clearPendingSaveInput: (chatId: number) => void;
	handleModeCommand: (chatId: number, command: ParsedTelegramModeCommand) => Promise<void>;
	handlePlainMessage: (chatId: number, text: string, normalizedInput: string) => Promise<void>;
	handleSlashMessage: (chatId: number, normalizedInput: string) => Promise<void>;
}

export async function routeTelegramMessage(context: TelegramMessageRouterContext): Promise<void> {
	const normalizedInput = stripTelegramCommandMention(context.text);
	const modeCommand = parseTelegramModeCommand(normalizedInput);
	if (modeCommand) {
		context.clearPendingSaveInput(context.chatId);
		await context.handleModeCommand(context.chatId, modeCommand);
		return;
	}

	if (!normalizedInput.startsWith("/")) {
		await context.handlePlainMessage(context.chatId, context.text, normalizedInput);
		return;
	}

	await context.handleSlashMessage(context.chatId, normalizedInput);
}
