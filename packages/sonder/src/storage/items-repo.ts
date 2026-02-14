import type { DatabaseSync } from "node:sqlite";
import type { Item } from "../types.js";
import { parseStringArray, toJsonString } from "./json.js";

interface ItemRow {
	id: string;
	created_at: string;
	source_type: string;
	original_url: string;
	why_note: string | null;
	tags_json: string;
	topic: string | null;
	space: string | null;
}

export class ItemsRepo {
	private readonly insertStatement;
	private readonly selectByIdStatement;
	private readonly listRecentStatement;

	constructor(private readonly database: DatabaseSync) {
		this.insertStatement = this.database.prepare(`
			INSERT INTO items (id, created_at, source_type, original_url, why_note, tags_json, topic, space)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`);
		this.selectByIdStatement = this.database.prepare("SELECT * FROM items WHERE id = ?");
		this.listRecentStatement = this.database.prepare("SELECT * FROM items ORDER BY created_at DESC LIMIT ?");
	}

	create(item: Item): void {
		this.insertStatement.run(
			item.id,
			item.createdAt,
			item.sourceType,
			item.originalUrl,
			item.whyNote,
			toJsonString(item.tags),
			item.topic,
			item.space,
		);
	}

	findById(id: string): Item | null {
		const row = this.selectByIdStatement.get(id);
		if (!row) {
			return null;
		}
		return mapItemRow(row as unknown as ItemRow);
	}

	listRecent(limit = 20): Item[] {
		const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 20;
		const rows = this.listRecentStatement.all(normalizedLimit);
		return rows.map((row) => mapItemRow(row as unknown as ItemRow));
	}
}

function mapItemRow(row: ItemRow): Item {
	return {
		id: row.id,
		createdAt: row.created_at,
		sourceType: row.source_type as Item["sourceType"],
		originalUrl: row.original_url,
		whyNote: row.why_note,
		tags: parseStringArray(row.tags_json),
		topic: row.topic,
		space: row.space,
	};
}
