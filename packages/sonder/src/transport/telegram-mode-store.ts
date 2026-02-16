import type { SonderApp } from "../app/index.js";

export interface ChatModeStateItem {
	mode: "item";
	itemId: string;
	sessionId: string;
}

export interface ChatModeStateGeneral {
	mode: "general";
	sessionId: string;
	history: Array<{ role: "user" | "assistant"; content: string }>;
}

export type ChatModeState = ChatModeStateItem | ChatModeStateGeneral;

const MAX_GENERAL_HISTORY_ENTRIES = 24;
const MAX_GENERAL_HISTORY_CHARACTERS = 12_000;

function clampGeneralHistory(history: Array<{ role: "user" | "assistant"; content: string }>): Array<{
	role: "user" | "assistant";
	content: string;
}> {
	const normalized = history
		.filter((entry) => (entry.role === "user" || entry.role === "assistant") && typeof entry.content === "string")
		.map((entry) => ({ role: entry.role, content: entry.content }));

	while (normalized.length > MAX_GENERAL_HISTORY_ENTRIES) {
		normalized.shift();
	}

	const totalChars = (): number => normalized.reduce((sum, entry) => sum + entry.content.length, 0);
	while (normalized.length > 2 && totalChars() > MAX_GENERAL_HISTORY_CHARACTERS) {
		normalized.shift();
	}

	return normalized;
}

export class TelegramChatModeStore {
	private readonly memoryModes = new Map<number, ChatModeState>();

	constructor(private readonly app: SonderApp) {}

	get(chatId: number): ChatModeState | undefined {
		const memoryMode = this.memoryModes.get(chatId);
		if (memoryMode) {
			return memoryMode;
		}

		const stored = this.app.loadChatModeState(chatId);
		if (!stored) {
			return undefined;
		}

		if (stored.mode === "item") {
			if (!this.app.hasItem(stored.itemId) || !this.app.isSessionForItem(stored.itemId, stored.sessionId)) {
				this.app.clearChatModeState(chatId);
				return undefined;
			}
			const restored: ChatModeState = { mode: "item", itemId: stored.itemId, sessionId: stored.sessionId };
			this.memoryModes.set(chatId, restored);
			return restored;
		}

		const clampedHistory = clampGeneralHistory(stored.history);
		if (clampedHistory.length !== stored.history.length) {
			this.app.saveChatModeState(
				{ chatId, mode: "general", itemId: null, sessionId: stored.sessionId, history: clampedHistory },
				new Date().toISOString(),
			);
		}
		const restored: ChatModeState = { mode: "general", sessionId: stored.sessionId, history: clampedHistory };
		this.memoryModes.set(chatId, restored);
		return restored;
	}

	set(chatId: number, mode: ChatModeState): void {
		if (mode.mode === "item") {
			this.memoryModes.set(chatId, mode);
			this.app.saveChatModeState(
				{ chatId, mode: "item", itemId: mode.itemId, sessionId: mode.sessionId, history: [] },
				new Date().toISOString(),
			);
			return;
		}
		const clampedHistory = clampGeneralHistory(mode.history);
		const normalizedMode: ChatModeState = {
			mode: "general",
			sessionId: mode.sessionId,
			history: clampedHistory,
		};
		this.memoryModes.set(chatId, normalizedMode);
		this.app.saveChatModeState(
			{ chatId, mode: "general", itemId: null, sessionId: mode.sessionId, history: clampedHistory },
			new Date().toISOString(),
		);
	}

	clear(chatId: number): boolean {
		const existed = this.memoryModes.delete(chatId);
		const existedInDb = this.app.clearChatModeState(chatId);
		return existed || existedInDb;
	}
}
