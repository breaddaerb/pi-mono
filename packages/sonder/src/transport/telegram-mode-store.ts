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

		const restored: ChatModeState = { mode: "general", sessionId: stored.sessionId, history: stored.history };
		this.memoryModes.set(chatId, restored);
		return restored;
	}

	set(chatId: number, mode: ChatModeState): void {
		this.memoryModes.set(chatId, mode);
		if (mode.mode === "item") {
			this.app.saveChatModeState(
				{ chatId, mode: "item", itemId: mode.itemId, sessionId: mode.sessionId, history: [] },
				new Date().toISOString(),
			);
			return;
		}
		this.app.saveChatModeState(
			{ chatId, mode: "general", itemId: null, sessionId: mode.sessionId, history: mode.history },
			new Date().toISOString(),
		);
	}

	clear(chatId: number): boolean {
		const existed = this.memoryModes.delete(chatId);
		const existedInDb = this.app.clearChatModeState(chatId);
		return existed || existedInDb;
	}
}
