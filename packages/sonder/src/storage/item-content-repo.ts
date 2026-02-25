import type { DatabaseSync } from "node:sqlite";
import type { ItemContent } from "../types.js";

interface ItemContentRow {
	item_id: string;
	canonical_md: string;
	canonical_version: number;
	canonical_generated_at: string;
	raw_type: string | null;
	raw_blob_path: string | null;
	raw_url: string | null;
	fetched_at: string | null;
}

export class ItemContentRepo {
	private readonly selectByItemIdStatement;
	private readonly upsertStatement;

	constructor(private readonly database: DatabaseSync) {
		this.selectByItemIdStatement = this.database.prepare("SELECT * FROM item_contents WHERE item_id = ?");
		this.upsertStatement = this.database.prepare(`
			INSERT INTO item_contents (
				item_id,
				canonical_md,
				canonical_version,
				canonical_generated_at,
				raw_type,
				raw_blob_path,
				raw_url,
				fetched_at
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(item_id) DO UPDATE SET
				canonical_md = excluded.canonical_md,
				canonical_version = excluded.canonical_version,
				canonical_generated_at = excluded.canonical_generated_at,
				raw_type = excluded.raw_type,
				raw_blob_path = excluded.raw_blob_path,
				raw_url = excluded.raw_url,
				fetched_at = excluded.fetched_at
		`);
	}

	findByItemId(itemId: string): ItemContent | null {
		const row = this.selectByItemIdStatement.get(itemId);
		if (!row) {
			return null;
		}
		return mapItemContentRow(row as unknown as ItemContentRow);
	}

	upsert(content: ItemContent): void {
		this.upsertStatement.run(
			content.itemId,
			content.canonicalMd,
			content.canonicalVersion,
			content.canonicalGeneratedAt,
			content.rawType,
			content.rawBlobPath,
			content.rawUrl,
			content.fetchedAt,
		);
	}
}

function mapItemContentRow(row: ItemContentRow): ItemContent {
	return {
		itemId: row.item_id,
		canonicalMd: row.canonical_md,
		canonicalVersion: row.canonical_version,
		canonicalGeneratedAt: row.canonical_generated_at,
		rawType: (row.raw_type as ItemContent["rawType"]) ?? null,
		rawBlobPath: row.raw_blob_path,
		rawUrl: row.raw_url,
		fetchedAt: row.fetched_at,
	};
}
