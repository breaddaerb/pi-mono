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
	created_at: string;
}

export class DialogueRepo {
	private readonly insertSessionStatement;
	private readonly selectSessionByIdStatement;
	private readonly insertTurnStatement;
	private readonly selectTurnByIdStatement;

	constructor(private readonly database: DatabaseSync) {
		this.insertSessionStatement = this.database.prepare(`
			INSERT INTO dialogue_sessions (id, item_id, title, created_at)
			VALUES (?, ?, ?, ?)
		`);
		this.selectSessionByIdStatement = this.database.prepare("SELECT * FROM dialogue_sessions WHERE id = ?");

		this.insertTurnStatement = this.database.prepare(`
			INSERT INTO dialogue_turns (id, session_id, role, content, model, provider, citations_json, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`);
		this.selectTurnByIdStatement = this.database.prepare("SELECT * FROM dialogue_turns WHERE id = ?");
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

	createTurn(turn: DialogueTurn): void {
		this.insertTurnStatement.run(
			turn.id,
			turn.sessionId,
			turn.role,
			turn.content,
			turn.model,
			turn.provider,
			toJsonString(turn.citations),
			turn.createdAt,
		);
	}

	findTurnById(id: string): DialogueTurn | null {
		const row = this.selectTurnByIdStatement.get(id);
		if (!row) {
			return null;
		}
		return mapTurnRow(row as unknown as DialogueTurnRow);
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
		createdAt: row.created_at,
	};
}
