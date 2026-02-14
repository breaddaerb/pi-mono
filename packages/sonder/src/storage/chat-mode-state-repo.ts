import type { DatabaseSync } from "node:sqlite";

export type StoredChatModeState =
	| {
			mode: "item";
			chatId: number;
			itemId: string;
			sessionId: string;
			history: Array<{ role: "user" | "assistant"; content: string }>;
			updatedAt: string;
	  }
	| {
			mode: "general";
			chatId: number;
			itemId: null;
			sessionId: string;
			history: Array<{ role: "user" | "assistant"; content: string }>;
			updatedAt: string;
	  };

interface ChatModeStateRow {
	chat_id: number;
	mode: string;
	item_id: string | null;
	session_id: string;
	history_json: string;
	updated_at: string;
}

function parseHistory(json: string): Array<{ role: "user" | "assistant"; content: string }> {
	const parsed: unknown = JSON.parse(json);
	if (!Array.isArray(parsed)) {
		return [];
	}
	const history: Array<{ role: "user" | "assistant"; content: string }> = [];
	for (const entry of parsed) {
		if (!entry || typeof entry !== "object") {
			continue;
		}
		const role = "role" in entry ? entry.role : undefined;
		const content = "content" in entry ? entry.content : undefined;
		if ((role === "user" || role === "assistant") && typeof content === "string") {
			history.push({ role, content });
		}
	}
	return history;
}

function mapRow(row: ChatModeStateRow): StoredChatModeState | null {
	if (row.mode !== "item" && row.mode !== "general") {
		return null;
	}
	if (row.mode === "item") {
		if (!row.item_id) {
			return null;
		}
		return {
			mode: "item",
			chatId: row.chat_id,
			itemId: row.item_id,
			sessionId: row.session_id,
			history: parseHistory(row.history_json),
			updatedAt: row.updated_at,
		};
	}
	return {
		mode: "general",
		chatId: row.chat_id,
		itemId: null,
		sessionId: row.session_id,
		history: parseHistory(row.history_json),
		updatedAt: row.updated_at,
	};
}

export class ChatModeStateRepo {
	private readonly upsertStatement;
	private readonly selectByChatIdStatement;
	private readonly deleteByChatIdStatement;

	constructor(private readonly database: DatabaseSync) {
		this.upsertStatement = this.database.prepare(`
			INSERT INTO chat_mode_states (chat_id, mode, item_id, session_id, history_json, updated_at)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(chat_id) DO UPDATE SET
				mode = excluded.mode,
				item_id = excluded.item_id,
				session_id = excluded.session_id,
				history_json = excluded.history_json,
				updated_at = excluded.updated_at
		`);
		this.selectByChatIdStatement = this.database.prepare("SELECT * FROM chat_mode_states WHERE chat_id = ?");
		this.deleteByChatIdStatement = this.database.prepare("DELETE FROM chat_mode_states WHERE chat_id = ?");
	}

	upsert(state: Omit<StoredChatModeState, "updatedAt">, updatedAt: string): void {
		this.upsertStatement.run(
			state.chatId,
			state.mode,
			state.mode === "item" ? state.itemId : null,
			state.sessionId,
			JSON.stringify(state.history),
			updatedAt,
		);
	}

	findByChatId(chatId: number): StoredChatModeState | null {
		const row = this.selectByChatIdStatement.get(chatId);
		if (!row) {
			return null;
		}
		return mapRow(row as unknown as ChatModeStateRow);
	}

	deleteByChatId(chatId: number): boolean {
		const result = this.deleteByChatIdStatement.run(chatId);
		return result.changes > 0;
	}
}
