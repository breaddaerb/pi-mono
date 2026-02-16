# Sonder retrieval scaling path (FTS design draft)

This note defines a forward-compatible path for scaling `/find` beyond the current in-memory + file-scan approach.

## Goals

- Preserve current Telegram UX (`/find`, `/list`, filter menus, snippets/reasons)
- Keep non-embedding retrieval path (keyword-first)
- Remove per-request file reads in hot path
- Support full-corpus search (not limited to recent fixed window)
- Keep migration/backfill safe for existing local databases

## Current bottlenecks

- `/find` scans recent items in memory and reads extracted text files at query time
- Relevance work is CPU + filesystem bound in request path
- Scaling ceiling is tied to recent-window cap and per-item I/O

## Target architecture

Introduce a dedicated search index table pair:

1. `item_search_docs` (metadata + denormalized text)
2. `item_search_fts` (SQLite FTS5 virtual table)

### Proposed schema sketch

```sql
CREATE TABLE item_search_docs (
  item_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  source_type TEXT NOT NULL,
  original_url TEXT NOT NULL,
  tags_text TEXT NOT NULL,
  note_text TEXT NOT NULL,
  annotations_text TEXT NOT NULL,
  annotation_tags_text TEXT NOT NULL,
  content_text TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE
);

CREATE VIRTUAL TABLE item_search_fts USING fts5(
  item_id UNINDEXED,
  original_url,
  tags_text,
  note_text,
  annotations_text,
  annotation_tags_text,
  content_text,
  tokenize='unicode61 remove_diacritics 2'
);
```

## Query path

1. Build FTS query from tokenized `/find` input
2. Query top-N candidate item IDs by BM25 score from `item_search_fts`
3. Join with `item_search_docs` + `items` for metadata
4. Apply existing Telegram filters (time/source/tag/sort)
5. Compute reason labels + snippets from denormalized columns (no file I/O)

## Write/update path

Re-index item on:

- item create/update
- annotation create/update/delete
- extracted-text/evidence update

Use app-layer helper:

- `reindexItemSearchDocument(itemId)`

Behavior:

1. Compose denormalized fields from current repos/artifacts
2. UPSERT `item_search_docs`
3. DELETE + INSERT corresponding `item_search_fts` row inside one transaction

## Migration/backfill plan

### Migration 1: add tables

- Add new migration creating `item_search_docs` and `item_search_fts`
- Add supporting index on `item_search_docs(updated_at)`

### Migration 2: lazy backfill marker

- Add small metadata table or use `schema_migrations` companion marker for backfill progress
- Keep system functional before full backfill

### Runtime backfill strategy

- On startup (or first `/find`), detect missing indexed docs
- Backfill in small batches to avoid long startup stalls
- Idempotent by design (UPSERT)

## Compatibility and rollout

- Keep current `/find` behavior as fallback behind feature flag during rollout
- Add parity tests comparing old/new ranking expectations on seeded fixtures
- Once stable, remove file-scan code path

## Test plan (future)

- Migration + backfill smoke tests
- Re-index correctness on annotation CRUD
- `/find` correctness on large seeded corpus (>10k items synthetic)
- Regression tests for reasons/snippets/filter interaction

## Non-goals

- Embeddings/hybrid retrieval in this phase
- Cross-item semantic rerank models

