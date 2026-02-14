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

	constructor(private readonly database: DatabaseSync) {
		this.insertStatement = this.database.prepare(`
			INSERT INTO items (id, created_at, source_type, original_url, why_note, tags_json, topic, space)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`);
		this.selectByIdStatement = this.database.prepare("SELECT * FROM items WHERE id = ?");
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
