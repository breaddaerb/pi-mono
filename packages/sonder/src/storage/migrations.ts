export interface Migration {
	version: number;
	sql: string;
}

export const MIGRATIONS: Migration[] = [
	{
		version: 1,
		sql: `
CREATE TABLE IF NOT EXISTS schema_migrations (
	version INTEGER PRIMARY KEY,
	applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
	id TEXT PRIMARY KEY,
	created_at TEXT NOT NULL,
	source_type TEXT NOT NULL,
	original_url TEXT NOT NULL,
	why_note TEXT,
	tags_json TEXT NOT NULL,
	topic TEXT,
	space TEXT
);

CREATE TABLE IF NOT EXISTS artifacts (
	id TEXT PRIMARY KEY,
	item_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	path TEXT NOT NULL,
	mime_type TEXT NOT NULL,
	version INTEGER NOT NULL,
	created_at TEXT NOT NULL,
	FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS annotations (
	id TEXT PRIMARY KEY,
	item_id TEXT NOT NULL,
	artifact_id TEXT NOT NULL,
	type TEXT NOT NULL,
	text TEXT,
	comment TEXT,
	color TEXT,
	tags_json TEXT NOT NULL,
	anchor TEXT NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE,
	FOREIGN KEY(artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dialogue_sessions (
	id TEXT PRIMARY KEY,
	item_id TEXT NOT NULL,
	title TEXT NOT NULL,
	created_at TEXT NOT NULL,
	FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dialogue_turns (
	id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL,
	role TEXT NOT NULL,
	content TEXT NOT NULL,
	model TEXT NOT NULL,
	provider TEXT NOT NULL,
	citations_json TEXT NOT NULL,
	created_at TEXT NOT NULL,
	FOREIGN KEY(session_id) REFERENCES dialogue_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_artifacts_item_id ON artifacts(item_id);
CREATE INDEX IF NOT EXISTS idx_annotations_item_id ON annotations(item_id);
CREATE INDEX IF NOT EXISTS idx_annotations_artifact_id ON annotations(artifact_id);
CREATE INDEX IF NOT EXISTS idx_dialogue_sessions_item_id ON dialogue_sessions(item_id);
CREATE INDEX IF NOT EXISTS idx_dialogue_turns_session_id ON dialogue_turns(session_id);
`,
	},
	{
		version: 2,
		sql: `
ALTER TABLE dialogue_turns ADD COLUMN thinking TEXT;
`,
	},
	{
		version: 3,
		sql: `
CREATE TABLE IF NOT EXISTS chat_mode_states (
	chat_id INTEGER PRIMARY KEY,
	mode TEXT NOT NULL,
	item_id TEXT,
	session_id TEXT NOT NULL,
	history_json TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_mode_states_updated_at ON chat_mode_states(updated_at);
`,
	},
	{
		version: 4,
		sql: `
ALTER TABLE dialogue_turns ADD COLUMN status TEXT NOT NULL DEFAULT 'completed';
ALTER TABLE dialogue_turns ADD COLUMN error_message TEXT;
`,
	},
	{
		version: 5,
		sql: `
CREATE TABLE IF NOT EXISTS ctx_marks (
	session_id TEXT NOT NULL,
	semantic_turn_id TEXT NOT NULL,
	state TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	updated_by TEXT,
	PRIMARY KEY(session_id, semantic_turn_id),
	FOREIGN KEY(session_id) REFERENCES dialogue_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ctx_marks_session_id_updated_at ON ctx_marks(session_id, updated_at);
`,
	},
	{
		version: 6,
		sql: `
CREATE TABLE IF NOT EXISTS item_contents (
	item_id TEXT PRIMARY KEY,
	canonical_md TEXT NOT NULL,
	canonical_version INTEGER NOT NULL,
	canonical_generated_at TEXT NOT NULL,
	raw_type TEXT,
	raw_blob_path TEXT,
	raw_url TEXT,
	fetched_at TEXT,
	FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE
);
	`,
	},
	{
		version: 7,
		sql: `
CREATE TABLE IF NOT EXISTS auth_sessions (
	id TEXT PRIMARY KEY,
	domain TEXT NOT NULL UNIQUE,
	status TEXT NOT NULL,
	storage_state_path TEXT NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	last_validated_at TEXT,
	expires_at TEXT,
	last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_updated_at ON auth_sessions(updated_at);

CREATE TABLE IF NOT EXISTS capture_attempts (
	id TEXT PRIMARY KEY,
	item_id TEXT NOT NULL,
	attempt_order INTEGER NOT NULL,
	attempt_type TEXT NOT NULL,
	request_url TEXT NOT NULL,
	status TEXT NOT NULL,
	reason TEXT,
	http_status INTEGER,
	latency_ms INTEGER,
	meta_json TEXT NOT NULL,
	created_at TEXT NOT NULL,
	FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_capture_attempts_item_attempt_order
	ON capture_attempts(item_id, attempt_order);

CREATE TABLE IF NOT EXISTS item_provenance (
	item_id TEXT PRIMARY KEY,
	original_url TEXT NOT NULL,
	capture_method TEXT NOT NULL,
	winner_attempt_id TEXT,
	evidence_confidence TEXT NOT NULL,
	captured_at TEXT NOT NULL,
	FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE,
	FOREIGN KEY(winner_attempt_id) REFERENCES capture_attempts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_item_provenance_capture_method ON item_provenance(capture_method);
`,
	},
];
