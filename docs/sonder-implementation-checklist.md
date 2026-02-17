# Sonder implementation checklist (reference/audit)

This file is the long-lived implementation reference.

- Use `packages/sonder/TODO.md` for active execution planning.
- Use this file for architecture invariants, acceptance gates, and post-MVP quality checkpoints.

## 1) Architecture invariants

These should remain true unless intentionally redesigned.

- Telegram-first UX with button-first discovery flows
- Item-anchored dialogue as primary interaction model
- `/open` supports both item mode (`/open <itemId>`) and general mode (`/open`)
- Snapshot artifacts are durable local evidence (`snapshot.html + assets`, extracted text, fallback artifact)
- Usable `text/plain`/markdown captures are accepted as text evidence (not auto-marked blocked)
- Save pipeline persists item/artifact metadata transactionally and cleans partial artifacts on failure
- Annotations are DB entities (do not mutate snapshot artifacts)
- Context order for ask/runtime: annotations -> dialogue history -> extracted text
- Dialogue turn lifecycle is explicit (`pending` -> `completed` or `failed`) and failures are persisted
- Active per-chat mode/session is persisted and restored across restarts
- Restored item-mode state is validated (item+session) and invalid state is auto-cleared
- Telegram transport consumes app-level APIs (does not reach into app DB/repo internals)
- Telegram transport helpers are modularized (callback parsing, renderers, mode store, input parsing)
- General chat history persistence is bounded (entry + character caps)
- History pagination state transitions are clamped to valid page bounds
- Command parsing is centralized in `src/commands` (core + mode commands)
- Command dispatch uses exact command tokens (no prefix-style matching like `/saveX`)
- `/ask` remains compatibility fallback; Telegram primary UX is open-first contextual asking
- Retrieval remains lean non-embedding for current phase

## 2) MVP acceptance gates (status)

- [x] Save a public web URL and reopen snapshot offline
- [x] Artifact outputs exist (`snapshot.html + assets`, extracted text, fallback)
- [x] Add highlights/underlines/notes and retrieve them later
- [x] `/ask` uses annotations in answer context
- [x] Responses include inline evidence references
- [x] Full dialogue trajectory persists and is reopenable
- [x] Enter item dialogue via `/open <itemId>`, continue multi-turn discussion, exit with `/exit`
- [x] Enter general dialogue via `/open` and run multi-turn chat
- [x] Active dialogue mode/session survives process restart
- [x] Discovery supports no-ID open flows (`/find`, `/list`, buttons)
- [x] Codex/OpenAI runtime path works end-to-end

## 3) Post-MVP quality checklist

### 3.1 Viewer quality and reliability

- [x] Annotation cards and sidebar interaction hierarchy improved
- [x] Anchor status surfaced (`anchor` / `fallback` / `unresolved`)
- [x] Manual anchor repair action available
- [x] Viewer-side filtering by type/status/tag available
- [x] Viewer API maps validation/domain errors to 400/404 (not generic 500)
- [ ] Add deeper automated tests for anchor repair and edge HTML drift scenarios

### 3.2 Retrieval quality (non-embedding)

- [x] `/find` + `/list` support Telegram filter controls (time/source/tag/sort)
- [x] Selector-panel UX for time/source/sort
- [x] Discovery pagination supports `Prev` + `Next`
- [x] `/find` without query falls back to browse behavior
- [x] Weighted keyword ranking with reasons/snippets
- [x] Retrieval scaling draft exists (FTS schema + migration/backfill plan)
- [ ] Further tune ranking/snippet presentation for clarity

### 3.3 Reliability/operations

- [ ] Retry policy for capture/search/model calls
- [ ] Per-chat queue + backpressure controls
- [ ] Structured logs/event tracing
- [ ] Export flow (item + artifacts + annotations + dialogue JSON)
- [ ] Retention/privacy controls

### 3.4 Dialogue lifecycle correctness

- [x] Dialogue turn status model exists (`pending | failed | completed`)
- [x] Failed assistant turns persist failure metadata
- [x] Ask flow transitions assistant turns from pending to completed/failed
- [x] History rendering surfaces failed-turn status and error summary
- [x] Tests cover success, responder-failure, and restart/read-path rendering of failed turns

## 4) Documentation contract

When behavior changes, update all three in the same cycle:

1. `packages/sonder/README.md` (user-facing usage)
2. `packages/sonder/TODO.md` (active implementation tracker)
3. `docs/sonder-implementation-checklist.md` (reference/audit status)
