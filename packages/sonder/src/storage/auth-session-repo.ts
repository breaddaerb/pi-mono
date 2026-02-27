import type { DatabaseSync } from "node:sqlite";
import type { AuthSession } from "../types.js";

interface AuthSessionRow {
	id: string;
	domain: string;
	status: string;
	storage_state_path: string;
	created_at: string;
	updated_at: string;
	last_validated_at: string | null;
	expires_at: string | null;
	last_error: string | null;
}

export class AuthSessionRepo {
	private readonly upsertStatement;
	private readonly selectByDomainStatement;
	private readonly listByUpdatedAtStatement;
	private readonly deleteByDomainStatement;

	constructor(private readonly database: DatabaseSync) {
		this.upsertStatement = this.database.prepare(`
			INSERT INTO auth_sessions (
				id,
				domain,
				status,
				storage_state_path,
				created_at,
				updated_at,
				last_validated_at,
				expires_at,
				last_error
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(domain) DO UPDATE SET
				id = excluded.id,
				status = excluded.status,
				storage_state_path = excluded.storage_state_path,
				updated_at = excluded.updated_at,
				last_validated_at = excluded.last_validated_at,
				expires_at = excluded.expires_at,
				last_error = excluded.last_error
		`);
		this.selectByDomainStatement = this.database.prepare("SELECT * FROM auth_sessions WHERE domain = ?");
		this.listByUpdatedAtStatement = this.database.prepare(
			"SELECT * FROM auth_sessions ORDER BY updated_at DESC LIMIT ?",
		);
		this.deleteByDomainStatement = this.database.prepare("DELETE FROM auth_sessions WHERE domain = ?");
	}

	upsert(session: AuthSession): void {
		this.upsertStatement.run(
			session.id,
			session.domain,
			session.status,
			session.storageStatePath,
			session.createdAt,
			session.updatedAt,
			session.lastValidatedAt,
			session.expiresAt,
			session.lastError,
		);
	}

	findByDomain(domain: string): AuthSession | null {
		const row = this.selectByDomainStatement.get(domain);
		if (!row) {
			return null;
		}
		return mapAuthSessionRow(row as unknown as AuthSessionRow);
	}

	listByUpdatedAt(limit = 20): AuthSession[] {
		const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 20;
		const rows = this.listByUpdatedAtStatement.all(normalizedLimit);
		return rows.map((row) => mapAuthSessionRow(row as unknown as AuthSessionRow));
	}

	deleteByDomain(domain: string): boolean {
		const result = this.deleteByDomainStatement.run(domain);
		return result.changes > 0;
	}
}

function mapAuthSessionRow(row: AuthSessionRow): AuthSession {
	return {
		id: row.id,
		domain: row.domain,
		status: row.status as AuthSession["status"],
		storageStatePath: row.storage_state_path,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		lastValidatedAt: row.last_validated_at,
		expiresAt: row.expires_at,
		lastError: row.last_error,
	};
}
