import type { SonderCommandResult, SonderProcessResult } from "../app/index.js";
import type { ChatModeState } from "./telegram-mode-store.js";
import { formatCommandResult } from "./telegram-renderers.js";

export interface ExtractedUrlInput {
	url: string;
	pastedText: string | null;
}

type SaveResult = Extract<SonderCommandResult, { type: "save" }>;

export interface PlainMessageHandlerContext {
	chatId: number;
	text: string;
	normalizedInput: string;
	hasPendingSaveInput: (chatId: number) => boolean;
	clearPendingSaveInput: (chatId: number) => void;
	getChatMode: (chatId: number) => ChatModeState | undefined;
	processCommand: (input: string) => Promise<SonderProcessResult>;
	saveFromInput: (input: { url: string; tags?: string[]; pastedText?: string | null }) => Promise<SaveResult>;
	sendSaveResultAndMaybeOpenItemMode: (chatId: number, saveResult: SaveResult) => Promise<void>;
	extractUrlAndPastedText: (text: string) => ExtractedUrlInput | null;
	handleActiveModeMessage: (chatId: number, text: string, activeMode: ChatModeState) => Promise<void>;
	sendMessage: (chatId: number, text: string) => Promise<void>;
}

export async function handlePlainMessage(context: PlainMessageHandlerContext): Promise<boolean> {
	if (context.hasPendingSaveInput(context.chatId)) {
		const saveCommandResult = await context.processCommand(`/save ${context.normalizedInput}`);
		if (!saveCommandResult.ok || saveCommandResult.value.type !== "save") {
			const responseText = formatCommandResult(saveCommandResult);
			await context.sendMessage(context.chatId, responseText);
			await context.sendMessage(
				context.chatId,
				"Still waiting for save input. Send: <url> [#tags...] [pasted evidence text], or run /exit to cancel.",
			);
			return true;
		}
		context.clearPendingSaveInput(context.chatId);
		await context.sendSaveResultAndMaybeOpenItemMode(context.chatId, saveCommandResult.value);
		return true;
	}

	const activeMode = context.getChatMode(context.chatId);
	if (!activeMode) {
		const urlInput = context.extractUrlAndPastedText(context.text);
		if (urlInput) {
			const saveResult = await context.saveFromInput({
				url: urlInput.url,
				tags: [],
				pastedText: urlInput.pastedText,
			});
			await context.sendSaveResultAndMaybeOpenItemMode(context.chatId, saveResult);
			return true;
		}
		await context.sendMessage(
			context.chatId,
			"No active dialogue. Use /open <itemId> to discuss an item, or /open for general chat. Use /history <sessionId> to view past turns.",
		);
		return true;
	}

	context.clearPendingSaveInput(context.chatId);
	await context.handleActiveModeMessage(context.chatId, context.text, activeMode);
	return true;
}
