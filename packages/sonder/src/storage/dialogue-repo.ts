import type { DatabaseSync } from "node:sqlite";
import type { DialogueSession, DialogueTurn } from "../types.js";
import { parseStringArray, toJsonString } from "./json.js";

interface DialogueSessionRow {
	id: string;
	item_id: string;
	title: string;
	created_at: string;
}

interface DialogueTurnRow {
	id: string;
	session_id: string;
	role: string;
	content: string;
	model: string;
	provider: string;
	citations_json: string;
	thinking: string | null;
	status: string;
	error_message: string | null;
	created_at: string;
}

export class DialogueRepo {
	private readonly insertSessionStatement;
	private readonly selectSessionByIdStatement;
	private readonly selectSessionsByItemIdStatement;
	private readonly insertTurnStatement;
	private readonly markTurnCompletedStatement;
	private readonly markTurnFailedStatement;
	private readonly selectTurnByIdStatement;
	private readonly selectTurnsBySessionIdStatement;

	constructor(private readonly database: DatabaseSync) {
		this.insertSessionStatement = this.database.prepare(`
			INSERT INTO dialogue_sessions (id, item_id, title, created_at)
			VALUES (?, ?, ?, ?)
		`);
		this.selectSessionByIdStatement = this.database.prepare("SELECT * FROM dialogue_sessions WHERE id = ?");
		this.selectSessionsByItemIdStatement = this.database.prepare(
			"SELECT * FROM dialogue_sessions WHERE item_id = ? ORDER BY created_at DESC",
		);

		this.insertTurnStatement = this.database.prepare(`
			INSERT INTO dialogue_turns (
				id,
				session_id,
				role,
				content,
				model,
				provider,
				citations_json,
				thinking,
				status,
				error_message,
				created_at
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
		this.markTurnCompletedStatement = this.database.prepare(`
			UPDATE dialogue_turns
			SET content = ?, model = ?, provider = ?, citations_json = ?, thinking = ?, status = 'completed', error_message = NULL
			WHERE id = ?
		`);
		this.markTurnFailedStatement = this.database.prepare(`
			UPDATE dialogue_turns
			SET content = ?, model = ?, provider = ?, citations_json = ?, thinking = ?, status = 'failed', error_message = ?
			WHERE id = ?
		`);
		this.selectTurnByIdStatement = this.database.prepare("SELECT * FROM dialogue_turns WHERE id = ?");
		this.selectTurnsBySessionIdStatement = this.database.prepare(
			"SELECT * FROM dialogue_turns WHERE session_id = ? ORDER BY created_at ASC",
		);
	}

	createSession(session: DialogueSession): void {
		this.insertSessionStatement.run(session.id, session.itemId, session.title, session.createdAt);
	}

	findSessionById(id: string): DialogueSession | null {
		const row = this.selectSessionByIdStatement.get(id);
		if (!row) {
			return null;
		}
		return mapSessionRow(row as unknown as DialogueSessionRow);
	}

	listSessionsByItemId(itemId: string): DialogueSession[] {
		const rows = this.selectSessionsByItemIdStatement.all(itemId);
		return rows.map((row) => mapSessionRow(row as unknown as DialogueSessionRow));
	}

	createTurn(turn: DialogueTurn): void {
		this.insertTurnStatement.run(
			turn.id,
			turn.sessionId,
			turn.role,
			turn.content,
			turn.model,
			turn.provider,
			toJsonString(turn.citations),
			turn.thinking,
			turn.status,
			turn.errorMessage,
			turn.createdAt,
		);
	}

	markTurnCompleted(input: {
		turnId: string;
		content: string;
		model: string;
		provider: string;
		citations: string[];
		thinking: string | null;
	}): boolean {
		const result = this.markTurnCompletedStatement.run(
			input.content,
			input.model,
			input.provider,
			toJsonString(input.citations),
			input.thinking,
			input.turnId,
		);
		return result.changes > 0;
	}

	markTurnFailed(input: { turnId: string; errorMessage: string; model?: string; provider?: string }): boolean {
		const result = this.markTurnFailedStatement.run(
			"",
			input.model ?? "failed-response",
			input.provider ?? "runtime-error",
			toJsonString([]),
			null,
			input.errorMessage,
			input.turnId,
		);
		return result.changes > 0;
	}

	findTurnById(id: string): DialogueTurn | null {
		const row = this.selectTurnByIdStatement.get(id);
		if (!row) {
			return null;
		}
		return mapTurnRow(row as unknown as DialogueTurnRow);
	}

	listTurnsBySessionId(sessionId: string): DialogueTurn[] {
		const rows = this.selectTurnsBySessionIdStatement.all(sessionId);
		return rows.map((row) => mapTurnRow(row as unknown as DialogueTurnRow));
	}
}

function mapSessionRow(row: DialogueSessionRow): DialogueSession {
	return {
		id: row.id,
		itemId: row.item_id,
		title: row.title,
		createdAt: row.created_at,
	};
}

function mapTurnRow(row: DialogueTurnRow): DialogueTurn {
	return {
		id: row.id,
		sessionId: row.session_id,
		role: row.role as DialogueTurn["role"],
		content: row.content,
		model: row.model,
		provider: row.provider,
		citations: parseStringArray(row.citations_json),
		thinking: row.thinking,
		status: normalizeTurnStatus(row.status),
		errorMessage: row.error_message,
		createdAt: row.created_at,
	};
}

function normalizeTurnStatus(status: string): DialogueTurn["status"] {
	if (status === "pending" || status === "failed" || status === "completed") {
		return status;
	}
	return "completed";
}
