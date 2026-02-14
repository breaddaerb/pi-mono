import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS } from "./migrations.js";

export interface CreateDatabaseOptions {
	databasePath: string;
}

export function createDatabase(options: CreateDatabaseOptions): DatabaseSync {
	mkdirSync(dirname(options.databasePath), { recursive: true });

	const database = new DatabaseSync(options.databasePath, {
		enableForeignKeyConstraints: true,
		timeout: 5_000,
	});

	database.exec("PRAGMA journal_mode=WAL;");
	applyMigrations(database);

	return database;
}

export function applyMigrations(database: DatabaseSync): void {
	database.exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY,
			applied_at TEXT NOT NULL
		);
	`);

	const selectMigration = database.prepare("SELECT version FROM schema_migrations WHERE version = ?");
	const insertMigration = database.prepare(
		"INSERT INTO schema_migrations (version, applied_at) VALUES (?, datetime('now'))",
	);

	for (const migration of MIGRATIONS) {
		const applied = selectMigration.get(migration.version);
		if (applied) {
			continue;
		}

		database.exec("BEGIN IMMEDIATE TRANSACTION;");
		try {
			database.exec(migration.sql);
			insertMigration.run(migration.version);
			database.exec("COMMIT;");
		} catch (error) {
			database.exec("ROLLBACK;");
			throw error;
		}
	}
}
