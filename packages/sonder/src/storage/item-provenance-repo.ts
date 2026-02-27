import type { DatabaseSync } from "node:sqlite";
import type { ItemProvenance } from "../types.js";

interface ItemProvenanceRow {
	item_id: string;
	original_url: string;
	capture_method: string;
	winner_attempt_id: string | null;
	evidence_confidence: string;
	captured_at: string;
}

export class ItemProvenanceRepo {
	private readonly upsertStatement;
	private readonly selectByItemIdStatement;

	constructor(private readonly database: DatabaseSync) {
		this.upsertStatement = this.database.prepare(`
			INSERT INTO item_provenance (
				item_id,
				original_url,
				capture_method,
				winner_attempt_id,
				evidence_confidence,
				captured_at
			)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(item_id) DO UPDATE SET
				original_url = excluded.original_url,
				capture_method = excluded.capture_method,
				winner_attempt_id = excluded.winner_attempt_id,
				evidence_confidence = excluded.evidence_confidence,
				captured_at = excluded.captured_at
		`);
		this.selectByItemIdStatement = this.database.prepare("SELECT * FROM item_provenance WHERE item_id = ?");
	}

	upsert(provenance: ItemProvenance): void {
		this.upsertStatement.run(
			provenance.itemId,
			provenance.originalUrl,
			provenance.captureMethod,
			provenance.winnerAttemptId,
			provenance.evidenceConfidence,
			provenance.capturedAt,
		);
	}

	findByItemId(itemId: string): ItemProvenance | null {
		const row = this.selectByItemIdStatement.get(itemId);
		if (!row) {
			return null;
		}
		return mapItemProvenanceRow(row as unknown as ItemProvenanceRow);
	}
}

function mapItemProvenanceRow(row: ItemProvenanceRow): ItemProvenance {
	return {
		itemId: row.item_id,
		originalUrl: row.original_url,
		captureMethod: row.capture_method as ItemProvenance["captureMethod"],
		winnerAttemptId: row.winner_attempt_id,
		evidenceConfidence: row.evidence_confidence as ItemProvenance["evidenceConfidence"],
		capturedAt: row.captured_at,
	};
}
