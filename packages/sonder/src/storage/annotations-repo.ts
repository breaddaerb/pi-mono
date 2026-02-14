import type { DatabaseSync } from "node:sqlite";
import type { Annotation } from "../types.js";
import { parseStringArray, toJsonString } from "./json.js";

interface AnnotationRow {
	id: string;
	item_id: string;
	artifact_id: string;
	type: string;
	text: string | null;
	comment: string | null;
	color: string | null;
	tags_json: string;
	anchor: string;
	created_at: string;
	updated_at: string;
}

export class AnnotationsRepo {
	private readonly insertStatement;
	private readonly selectByIdStatement;
	private readonly selectByItemIdStatement;
	private readonly updateByIdStatement;
	private readonly deleteByIdStatement;

	constructor(private readonly database: DatabaseSync) {
		this.insertStatement = this.database.prepare(`
			INSERT INTO annotations (id, item_id, artifact_id, type, text, comment, color, tags_json, anchor, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
		this.selectByIdStatement = this.database.prepare("SELECT * FROM annotations WHERE id = ?");
		this.selectByItemIdStatement = this.database.prepare(
			"SELECT * FROM annotations WHERE item_id = ? ORDER BY created_at ASC",
		);
		this.updateByIdStatement = this.database.prepare(`
			UPDATE annotations
			SET text = ?, comment = ?, color = ?, tags_json = ?, anchor = ?, updated_at = ?
			WHERE id = ?
		`);
		this.deleteByIdStatement = this.database.prepare("DELETE FROM annotations WHERE id = ?");
	}

	create(annotation: Annotation): void {
		this.insertStatement.run(
			annotation.id,
			annotation.itemId,
			annotation.artifactId,
			annotation.type,
			annotation.text,
			annotation.comment,
			annotation.color,
			toJsonString(annotation.tags),
			annotation.anchor,
			annotation.createdAt,
			annotation.updatedAt,
		);
	}

	findById(id: string): Annotation | null {
		const row = this.selectByIdStatement.get(id);
		if (!row) {
			return null;
		}
		return mapAnnotationRow(row as unknown as AnnotationRow);
	}

	listByItemId(itemId: string): Annotation[] {
		const rows = this.selectByItemIdStatement.all(itemId);
		return rows.map((row) => mapAnnotationRow(row as unknown as AnnotationRow));
	}

	updateById(annotation: Annotation): boolean {
		const result = this.updateByIdStatement.run(
			annotation.text,
			annotation.comment,
			annotation.color,
			toJsonString(annotation.tags),
			annotation.anchor,
			annotation.updatedAt,
			annotation.id,
		);
		return result.changes > 0;
	}

	deleteById(id: string): boolean {
		const result = this.deleteByIdStatement.run(id);
		return result.changes > 0;
	}
}

function mapAnnotationRow(row: AnnotationRow): Annotation {
	return {
		id: row.id,
		itemId: row.item_id,
		artifactId: row.artifact_id,
		type: row.type as Annotation["type"],
		text: row.text,
		comment: row.comment,
		color: row.color,
		tags: parseStringArray(row.tags_json),
		anchor: row.anchor,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}
