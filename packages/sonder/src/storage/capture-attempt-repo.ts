import type { DatabaseSync } from "node:sqlite";
import type { CaptureAttempt } from "../types.js";

interface CaptureAttemptRow {
	id: string;
	item_id: string;
	attempt_order: number;
	attempt_type: string;
	request_url: string;
	status: string;
	reason: string | null;
	http_status: number | null;
	latency_ms: number | null;
	meta_json: string;
	created_at: string;
}

export class CaptureAttemptRepo {
	private readonly insertStatement;
	private readonly selectByIdStatement;
	private readonly selectByItemIdStatement;

	constructor(private readonly database: DatabaseSync) {
		this.insertStatement = this.database.prepare(`
			INSERT INTO capture_attempts (
				id,
				item_id,
				attempt_order,
				attempt_type,
				request_url,
				status,
				reason,
				http_status,
				latency_ms,
				meta_json,
				created_at
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
		this.selectByIdStatement = this.database.prepare("SELECT * FROM capture_attempts WHERE id = ?");
		this.selectByItemIdStatement = this.database.prepare(
			"SELECT * FROM capture_attempts WHERE item_id = ? ORDER BY attempt_order ASC, created_at ASC",
		);
	}

	create(attempt: CaptureAttempt): void {
		this.insertStatement.run(
			attempt.id,
			attempt.itemId,
			attempt.attemptOrder,
			attempt.attemptType,
			attempt.requestUrl,
			attempt.status,
			attempt.reason,
			attempt.httpStatus,
			attempt.latencyMs,
			attempt.metaJson,
			attempt.createdAt,
		);
	}

	findById(id: string): CaptureAttempt | null {
		const row = this.selectByIdStatement.get(id);
		if (!row) {
			return null;
		}
		return mapCaptureAttemptRow(row as unknown as CaptureAttemptRow);
	}

	listByItemId(itemId: string): CaptureAttempt[] {
		const rows = this.selectByItemIdStatement.all(itemId);
		return rows.map((row) => mapCaptureAttemptRow(row as unknown as CaptureAttemptRow));
	}
}

function mapCaptureAttemptRow(row: CaptureAttemptRow): CaptureAttempt {
	return {
		id: row.id,
		itemId: row.item_id,
		attemptOrder: row.attempt_order,
		attemptType: row.attempt_type as CaptureAttempt["attemptType"],
		requestUrl: row.request_url,
		status: row.status as CaptureAttempt["status"],
		reason: row.reason,
		httpStatus: row.http_status,
		latencyMs: row.latency_ms,
		metaJson: row.meta_json,
		createdAt: row.created_at,
	};
}
