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
- [ ] Add command router for `/save`, `/find`, `/open`, `/ask`, `/exit`, `/where`, `/sessions`, `/resume`
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
- [x] Add per-chat active dialogue state (`itemId`, `sessionId`)
- [x] Add `/open <itemId>` to enter item dialogue mode
- [x] Add `/open` without itemId for general chat mode
- [x] Route non-command messages to active dialogue turns
- [x] Add `/exit` and `/where` for mode control
- [x] Add `/sessions <itemId>` and `/resume <sessionId>`
- [x] Keep `/ask <itemId> <question>` as stateless fallback

## 7) Retrieval (`/find`, `/open`)

- [ ] Metadata filters (source/time/tags/topic/space)
- [ ] Keyword search on extracted text + annotation text/comment
- [ ] Embedding generation (item-level MVP)
- [ ] Hybrid ranking (filter + keyword + vector)
- [ ] `/open` returns compact item card + key annotations + latest dialogue pointers
- [x] `/open` launches local snapshot annotation viewer for direct highlighting/notes
- [ ] `/open` enters item-anchored dialogue space (or sets active dialogue context)

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
- [ ] `/find` returns relevant items by metadata + semantic intent
- [x] Codex/OpenAI-only model path works end-to-end
