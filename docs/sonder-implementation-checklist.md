# Sonder implementation checklist (ask-first + Zotero-style snapshot/annotation)

This checklist is the execution companion to `docs/sonder-feasibility-on-pi.md`.

## 0) Project bootstrap

- [x] Create `packages/sonder/package.json` (workspace package)
- [x] Add `src/main.ts` entrypoint
- [x] Add TypeScript config and build/check scripts
- [x] Add `README.md` with scope and command surface
- [ ] Update root scripts to include `packages/sonder` build/check once package exists

## 1) Core data model (must happen early)

- [x] Define `Item` entity (id, source, createdAt, url, note, tags/topic/space)
- [x] Define `Artifact` entity (id, itemId, type, path, mime, version, extraction status)
- [x] Define `Annotation` entity (id, itemId, artifactId, type, text/comment/color/tags, anchor)
- [x] Define `DialogueSession` entity (id, itemId, title, createdAt)
- [x] Define `DialogueTurn` entity (sessionId, role, content blocks, model/provider, citations)
- [x] Add migrations for schema evolution

## 2) Storage layer

- [x] Implement DB adapter (`storage/db.ts`, SQLite)
- [x] Implement repos: items/artifacts/annotations/dialogue
- [x] Implement artifact file layout (`data/items/<itemId>/...`)
- [ ] Add idempotency keys for duplicate saves

## 3) Telegram transport

- [x] Implement Telegram adapter (`transport/telegram.ts`)
- [ ] Add per-chat queue (mom-style)
- [x] Add command router for `/save`, `/find`, `/open`, `/ask`, `/exit`, `/where`, `/sessions`, `/resume`, `/history`
- [x] Implement command contract for MVP:
  - [x] `/save <url> [#tags...]`
  - [x] `/ask <itemId> <question>`
- [ ] Defer reply-to-item-card UX decision to post-MVP
- [x] Add structured error/report messages

## 4) Snapshot pipeline (Zotero-style principle)

- [x] Build `snapshot/snapshot-service.ts`
- [x] Restrict MVP source scope to public web URLs only
- [x] HTML-first capture path (`snapshot.html` + assets)
- [x] Extracted text pipeline
- [x] Fallback path (screenshot/PDF when HTML capture fails)
- [ ] Version artifacts on re-capture
- [x] Keep annotations outside artifact files (DB only)

## 5) Annotation layer (first-class)

- [x] Support annotation types: highlight, underline, note (MVP)
- [x] Add interim command surface for annotation MVP:
  - [x] `/annotate <itemId> <text> [#tags...]` (create note)
  - [x] `/ann list <itemId>`
  - [x] `/ann del <annotationId>`
- [ ] Implement primary Zotero-like in-snapshot annotation UX:
  - [x] `/open <itemId>` viewer entry
  - [x] selection -> highlight/underline/note actions (viewer API + basic UI)
  - [x] overlay rendering on reopen (basic text-match + selector fallback)
  - [x] click annotation in sidebar -> jump/focus target span
  - [x] polish annotation cards (type/color/comment clarity)
- [ ] Define robust anchors:
  - [ ] PDF: page + rect/path geometry
  - [x] HTML: quote + text-position + selector fallback (MVP/basic)
  - [ ] Image: normalized bounding box (if needed)
- [x] Add annotation CRUD APIs/repo methods (service/repo level)
- [ ] Add annotation tagging/filtering
- [ ] Add anchor validation/repair hooks

## 6) `/ask` core loop and item dialogue mode (primary axis)

- [x] Build `runtime/context-builder.ts`
- [x] Context priority: annotations -> prior dialogue -> extracted text
- [ ] Use `pi-agent-core` for agent loop/tool execution
- [x] Show inline evidence references in responses by default (annotation/artifact IDs)
- [x] Persist full dialogue turns (not just final summaries)
- [x] Disable raw thinking persistence by default
- [ ] Add a reveal-on-demand control for thinking blocks (if available)
- [ ] Add per-turn remove/delete action (post-MVP acceptable)
- [x] Store model/provider per turn
- [x] Add per-chat active dialogue state (`itemId`, `sessionId`) (in-memory MVP)
- [x] Persist per-chat active dialogue state in DB (restart-safe)
- [x] Add `/open <itemId>` to enter item dialogue mode
- [x] Add `/open` without itemId for general chat mode
- [x] Route non-command messages to active dialogue turns
- [x] Add `/exit` and `/where` for mode control
- [x] Add `/sessions <itemId>` and `/resume <sessionId>`
- [x] Add `/history [sessionId]` to inspect recent turns
- [x] Keep `/ask <itemId> <question>` as stateless fallback

## 7) Retrieval (`/find`, `/open`)

- [ ] Metadata filters (source/time/tags/topic/space)
- [x] Keyword search on extracted text + annotation text/comment (MVP `/find`)
- [ ] Embedding generation (item-level MVP)
- [ ] Hybrid ranking (filter + keyword + vector)
- [x] `/find <query> [limit]` returns keyword-ranked items with match reasons
- [ ] `/open` returns compact item card + key annotations + latest dialogue pointers
- [x] `/open` launches local snapshot annotation viewer for direct highlighting/notes
- [x] `/open` enters item-anchored dialogue space (sets active dialogue context)

## 8) Auth and model management

- [x] Integrate OAuth provider flow (Codex path)
- [x] Limit MVP runtime to Codex/OpenAI model path
- [x] Add secure token/session storage integration

## 9) Reliability and operations

- [ ] Retry policy for capture/search/model calls
- [ ] Queue + backpressure controls per chat
- [ ] Structured logs + event tracing
- [ ] Data export (item + artifacts + annotations + dialogue JSON)
- [ ] Retention/privacy policy toggles (thinking traces, raw content)

## 10) MVP acceptance gates

- [x] Save a public web URL and reopen snapshot offline
- [x] Artifact outputs exist: `snapshot.html + assets`, extracted text, screenshot fallback on failure
- [x] Add highlights/underlines/notes and retrieve them later (viewer workflow, MVP/basic)
- [x] `/ask` uses annotations explicitly in answer context
- [x] `/ask` responses include inline evidence refs by default
- [x] Full dialogue trajectory persists and is reopenable
- [x] Enter item dialogue via `/open <itemId>`, continue multi-turn discussion, and exit with `/exit`
- [x] Enter general dialogue via `/open` (no item), chat multi-turn, and exit with `/exit`
- [x] Active dialogue mode/session survives process restart (per-chat persisted state)
- [ ] `/find` returns relevant items by metadata + semantic intent
- [x] Codex/OpenAI-only model path works end-to-end

## 11) Post-MVP optimization order (agreed)

Priority order:
1. Entry discovery UX
2. Viewer polish
3. Retrieval quality
4. Ops/reliability

### 11.1 Entry discovery UX (P1)

#### P1.1 Callback foundation + `/find` buttons

- [x] Add Telegram inline keyboard callback routing contract (`sx:v1:<action>:<menuId>:<arg>`)
- [x] Add ephemeral menu state per chat for index -> internal ID/session mapping
- [x] Redesign `/find <query>` reply to index list + `Open` buttons (no ID exposure)
- [x] Add stale callback handling (expired menu -> recovery hint)

#### P1.2 Item mode panel + contextual clarity

- [x] Keep `/open` (no arg) as general-chat entry (no picker semantics)
- [x] After `/save`, auto-enter item mode for the saved item (default continuity)
- [x] Add item action panel (`Exit`, optional `Open Viewer`)
- [x] Show compact session summary in item-mode card (active turns + recent sessions count + recent activity datetime)
- [x] Add compact context banner in contextual replies
- [x] Add tests for panel callback flows and contextual reply rendering

#### P1.3 Sessions/history no-ID flow

- [x] Redesign sessions listing to indexed `Resume` buttons + `New Session`
- [x] Add button-driven history pagination (`Prev/Next/Back`) without IDs
- [x] Extend `/list [limit]` to include indexed `Open` inline buttons (simpler than `/find`)
- [x] Keep legacy ID-based commands as compatibility fallback only
- [x] Make `/sessions` context-first in Telegram UX (primary path: active item -> `/sessions`)
- [x] Deprecate `/ask` in Telegram UX and guide users to item-mode plain-text asks
- [x] Add end-to-end tests for discover (`/find` + `/list`) -> enter -> resume -> history -> exit flows
- [x] Update README to make button/context flow the primary UX

### 11.2 Viewer polish (P2)

- [x] Improve in-viewer visual hierarchy and interaction affordances
- [x] Improve annotation card ergonomics + active-selection feedback in sidebar
- [x] Keep annotation-list scrolling isolated below the top action bar (no visual overlap)
- [x] Remove post-annotation iframe reload flicker/scroll jump (seamless update)
- [x] Add robust anchor validation/repair hooks (HTML first)
- [x] Add HTML anchor resolution status hooks in viewer (`anchor`/`fallback`/`unresolved`)
- [x] Add manual `Repair anchor` action for fallback/unresolved annotations
- [x] Add annotation tagging/filtering UX (viewer-first)

### 11.3 Retrieval quality (P3, non-embedding)

- [x] Add button-driven metadata filter chips for `/find` + `/list` (time/source/tag/sort/clear/next)
- [x] Use two-step option panels for time/source/sort filter selection
- [x] Support `/find` without query as browse fallback (`/list` behavior)
- [ ] Improve keyword-first ranking + snippet quality
- [x] Defer hybrid retrieval (keyword + vector) for now

### 11.4 Ops/reliability (P4)

- [ ] Add retry policy for capture/search/model calls
- [ ] Add per-chat queue + backpressure controls
- [ ] Add structured logs/event tracing + export/retention controls
