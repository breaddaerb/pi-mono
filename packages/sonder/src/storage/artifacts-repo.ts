import type { DatabaseSync } from "node:sqlite";
import type { Artifact } from "../types.js";

interface ArtifactRow {
	id: string;
	item_id: string;
	kind: string;
	path: string;
	mime_type: string;
	version: number;
	created_at: string;
}

export class ArtifactsRepo {
	private readonly insertStatement;
	private readonly selectByIdStatement;
	private readonly selectByItemIdStatement;

	constructor(private readonly database: DatabaseSync) {
		this.insertStatement = this.database.prepare(`
			INSERT INTO artifacts (id, item_id, kind, path, mime_type, version, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`);
		this.selectByIdStatement = this.database.prepare("SELECT * FROM artifacts WHERE id = ?");
		this.selectByItemIdStatement = this.database.prepare(
			"SELECT * FROM artifacts WHERE item_id = ? ORDER BY version DESC, created_at DESC",
		);
	}

	create(artifact: Artifact): void {
		this.insertStatement.run(
			artifact.id,
			artifact.itemId,
			artifact.kind,
			artifact.path,
			artifact.mimeType,
			artifact.version,
			artifact.createdAt,
		);
	}

	findById(id: string): Artifact | null {
		const row = this.selectByIdStatement.get(id);
		if (!row) {
			return null;
		}
		return mapArtifactRow(row as unknown as ArtifactRow);
	}

	listByItemId(itemId: string): Artifact[] {
		const rows = this.selectByItemIdStatement.all(itemId);
		return rows.map((row) => mapArtifactRow(row as unknown as ArtifactRow));
	}
}

function mapArtifactRow(row: ArtifactRow): Artifact {
	return {
		id: row.id,
		itemId: row.item_id,
		kind: row.kind as Artifact["kind"],
		path: row.path,
		mimeType: row.mime_type,
		version: row.version,
		createdAt: row.created_at,
	};
}
