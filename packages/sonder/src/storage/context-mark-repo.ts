import type { DatabaseSync } from "node:sqlite";

export type ContextTurnState = "ACTIVE" | "DETACHED";

export interface ContextMark {
	sessionId: string;
	semanticTurnId: string;
	state: ContextTurnState;
	updatedAt: string;
	updatedBy: string | null;
}

interface ContextMarkRow {
	session_id: string;
	semantic_turn_id: string;
	state: string;
	updated_at: string;
	updated_by: string | null;
}

function normalizeState(state: string): ContextTurnState {
	if (state === "DETACHED") {
		return "DETACHED";
	}
	return "ACTIVE";
}

function mapRow(row: ContextMarkRow): ContextMark {
	return {
		sessionId: row.session_id,
		semanticTurnId: row.semantic_turn_id,
		state: normalizeState(row.state),
		updatedAt: row.updated_at,
		updatedBy: row.updated_by,
	};
}

export class ContextMarkRepo {
	private readonly upsertStatement;
	private readonly selectByIdStatement;
	private readonly selectBySessionIdStatement;
	private readonly deleteBySessionIdStatement;

	constructor(private readonly database: DatabaseSync) {
		this.upsertStatement = this.database.prepare(`
			INSERT INTO ctx_marks (session_id, semantic_turn_id, state, updated_at, updated_by)
			VALUES (?, ?, ?, ?, ?)
			ON CONFLICT(session_id, semantic_turn_id) DO UPDATE SET
				state = excluded.state,
				updated_at = excluded.updated_at,
				updated_by = excluded.updated_by
		`);
		this.selectByIdStatement = this.database.prepare(
			"SELECT * FROM ctx_marks WHERE session_id = ? AND semantic_turn_id = ?",
		);
		this.selectBySessionIdStatement = this.database.prepare(
			"SELECT * FROM ctx_marks WHERE session_id = ? ORDER BY updated_at DESC",
		);
		this.deleteBySessionIdStatement = this.database.prepare("DELETE FROM ctx_marks WHERE session_id = ?");
	}

	upsertState(input: {
		sessionId: string;
		semanticTurnId: string;
		state: ContextTurnState;
		updatedAt: string;
		updatedBy?: string | null;
	}): void {
		this.upsertStatement.run(
			input.sessionId,
			input.semanticTurnId,
			input.state,
			input.updatedAt,
			input.updatedBy ?? null,
		);
	}

	getState(sessionId: string, semanticTurnId: string): ContextTurnState | null {
		const row = this.selectByIdStatement.get(sessionId, semanticTurnId);
		if (!row) {
			return null;
		}
		const mark = mapRow(row as unknown as ContextMarkRow);
		return mark.state;
	}

	listBySessionId(sessionId: string): ContextMark[] {
		const rows = this.selectBySessionIdStatement.all(sessionId);
		return rows.map((row) => mapRow(row as unknown as ContextMarkRow));
	}

	deleteBySessionId(sessionId: string): boolean {
		const result = this.deleteBySessionIdStatement.run(sessionId);
		return result.changes > 0;
	}
}
