# Sonder TODO

Canonical active tracker for ongoing Sonder implementation work.

Note: `docs/sonder-implementation-checklist.md` is now a reference/audit document (architecture + acceptance), not the day-to-day task board.

## Milestone 1: Foundation (current)

- [x] Scaffold package structure (`package.json`, tsconfig, `src/main.ts`, `src/index.ts`)
- [x] Add core domain types:
  - [x] `Item`
  - [x] `Artifact`
  - [x] `Annotation` (`highlight | underline | note`)
  - [x] `DialogueSession`
  - [x] `DialogueTurn`
- [x] Add command contract parser tests:
  - [x] `/save <url> [#tags...]`
  - [x] `/ask <itemId> <question>`
- [x] Add baseline package README with confirmed MVP scope

## Milestone 2: Storage and persistence

- [x] Implement SQLite adapter and migration setup
- [x] Create repositories (items, artifacts, annotations, dialogue)
- [x] Add storage smoke tests
- [x] Add local artifact file layout (`data/items/<itemId>/...`)

## Milestone 3: Snapshot pipeline

- [x] Public web URL only (MVP source scope)
- [x] HTML snapshot + assets
- [x] Extracted text
- [x] Screenshot fallback (text-only fallback for MVP)

## Milestone 4: Ask-first runtime

- [x] Context builder: annotations -> prior dialogue -> extracted text
- [x] Inline evidence refs in answers by default
- [x] Full turn persistence
- [x] Thinking persistence disabled by default (reveal-on-demand UX later)

## Milestone 5: Command application layer

- [x] Add `SonderApp` orchestration service (`/save`, `/ask`)
- [x] Wire parse -> save/snapshot/storage and parse -> ask/runtime flow
- [x] Add end-to-end tests for save + ask command flow

## Milestone 6: Local CLI runner

- [x] Wire `src/main.ts` to execute one command and print JSON result
- [x] Add `--root` path support for persistent local data
- [x] Add CLI tests for save->ask and usage errors

## Milestone 7: Telegram transport skeleton

- [x] Add long-polling Telegram transport module
- [x] Add `--telegram` mode in CLI entrypoint
- [x] Wire transport -> SonderApp command processing
- [x] Add transport tests with fake Telegram API

## Milestone 8: Telegram UX and operations polish

- [x] Replace raw JSON Telegram replies with readable command-oriented responses
- [x] Add Telegram response splitting for long answers
- [x] Add `/list [limit]` support
- [x] Add `--telegram-check` connectivity command
- [x] Add proxy support and low-level polling diagnostics

## Milestone 9: Annotation bridge (command-note, interim)

- [x] Add app command: `/annotate <itemId> <text> [#tags...]`
- [x] Persist annotation as `type: note` with stable anchor (`item://<itemId>#note:<annotationId>`)
- [x] Select canonical artifact for note linkage (prefer extracted-text, fallback snapshot-html)
- [x] Add app command: `/ann list <itemId>`
- [x] Add app command: `/ann del <annotationId>`
- [x] Add parser coverage for `/annotate`, `/ann list`, `/ann del`
- [x] Add app/service tests for create/list/delete annotation flows
- [x] Add Telegram formatted responses for annotation commands
- [x] Ensure `/ask` context includes newly created note annotations end-to-end
- [x] Update README command surface and examples

## Milestone 10: Zotero-like annotation UX (viewer-first, primary)

- [x] Add `/open <itemId>` flow that returns/opens a local viewer URL
- [x] Add snapshot viewer server (local) to render saved `snapshot.html`
- [x] Implement text selection capture in viewer
- [x] Add in-viewer actions: `highlight`, `underline`, `note`
- [x] Persist annotation anchors for HTML with redundancy:
  - [x] quote (`exact`, `prefix`, `suffix`)
  - [x] text-position range
  - [x] selector/range fallback (MVP/basic)
- [x] Add annotation overlay rendering on reopen (basic text-match + selector fallback)
- [x] Add annotation edit/delete from viewer
- [x] Keep annotations DB-only (no mutation of snapshot artifact files)
- [x] Add end-to-end test: open -> annotate exact sentence -> ask cites annotation
- [x] Keep command-note path as fallback API, not primary UX

## Milestone 11: Item-anchored dialogue mode (primary ask UX)

- [x] Add per-chat dialogue state store: active `itemId` + `sessionId`
- [x] Add command: `/open <itemId>` enters dialogue mode for that item
- [x] Add command: `/open` enters general chat mode (no item required)
- [x] Add command: `/exit` leaves current dialogue mode
- [x] Add command: `/where` shows current active item/session
- [x] Route non-command messages to active item session as dialogue turns
- [x] Keep `/ask <itemId> <question>` as stateless fallback path
- [x] Add command: `/sessions <itemId>` and `/resume <sessionId>`
- [x] Add command: `/history [sessionId]` for transcript review
- [x] Update Telegram responses for mode transitions and errors
- [x] Add tests for open -> discuss -> exit -> resume flow
- [x] Ensure dialogue context still prioritizes annotations -> history -> extracted text

## Milestone 12: Viewer UX polish + durable dialogue state

- [x] Add click-to-jump from annotation sidebar to highlighted span in snapshot
- [x] Add clearer annotation cards (type/color/comment separation)
- [x] Preserve and restore viewer-side scroll/focus after create/edit/delete operations
- [x] Persist per-chat active dialogue mode/session in SQLite (survive process restart)
- [x] Add startup restore for active sessions in Telegram runner
- [x] Add tests for dialogue state persistence across app restart
- [x] Update README with restart behavior and persistence notes

## Milestone 13: Retrieval MVP (`/find`)

- [x] Add command contract: `/find <query> [limit]`
- [x] Implement keyword retrieval across URL/tags/annotations/extracted text
- [x] Add ranked result output with match reasons
- [x] Add Telegram formatting for find results
- [x] Add parser/app/transport tests for find flows
- [x] Update README usage with `/find` examples

## Milestone 14: Optimization I — Entry & discovery UX (highest priority)

### P1.1 Callback/button foundation + `/find` button surface

- [x] Add Telegram inline keyboard callback routing (`sx:v1:<action>:<menuId>:<arg>`)
- [x] Add ephemeral per-chat menu state for index -> internal ID mapping
- [x] Redesign `/find <query>` output to index-based list + `Open` buttons (no ID exposure)
- [x] Add stale/expired callback handling with recovery hints (`/open` or `/find`)
- [x] Add tests for callback routing + `/find` button actions

### P1.2 Item mode action panel + contextual clarity

- [x] Keep `/open` (without ID) as general chat mode (no recent-item picker)
- [x] After `/save`, auto-enter the newly saved item dialogue mode (natural continuation)
- [x] Add item-mode action panel: `Exit` (+ optional `Open Viewer`)
- [x] Show compact session summary in item-mode card (active turns + recent sessions count + recent activity datetime)
- [x] Add compact context banner for item/general mode replies
- [x] Add tests for item-mode panel interactions and contextual replies
- [x] Add tests for `/save` -> auto-open item-mode behavior

### P1.3 Sessions/history no-id flow + command simplification

- [x] Redesign sessions list to index-based `Resume` buttons + `New Session`
- [x] Add button-driven history pagination (`Prev/Next/Back`) with no ID exposure
- [x] Extend `/list [limit]` output to index-based rows with `Open` buttons (simpler than `/find`)
- [x] Keep legacy ID commands as compatibility fallback (not primary UX)
- [x] Make `/sessions` context-first in Telegram UX (active item required for primary flow)
- [x] Deprecate `/ask` in Telegram UX (keep command as compatibility fallback)
- [x] Document cleaned primary command surface in README (`/save /find /open /sessions /exit /help`)
- [x] Add end-to-end Telegram tests for find/list -> open -> sessions -> resume -> history -> exit

## Milestone 15: Optimization II — Viewer polish

- [x] Improve annotation viewer visual hierarchy and interaction affordances
- [x] Remove iframe reload scroll-jump flicker after create/edit/delete (in-place overlay update or seamless restore)
- [x] Add stronger anchor validation and repair hooks for difficult HTML drift
- [x] Add HTML anchor resolution status hooks in viewer cards (`anchor` / `fallback` / `unresolved`)
- [x] Add viewer-side `Repair anchor` action for fallback/unresolved annotations
- [x] Improve annotation card ergonomics and selection feedback
- [x] Keep annotation list scroll region separated from top action bar (no overlap while scrolling)
- [x] Add annotation filtering UX in viewer (type/comment/unresolved/tag)
- [ ] Add command-surface annotation filtering where applicable
- [ ] Add tests for viewer polish and anchor repair behavior
- [ ] Update README usage/docs for viewer UX updates

## Milestone 16: Optimization III — Retrieval quality (non-embedding, lean)

- [x] Add button-driven filter chips for `/find` and `/list` (time/source/tag/sort/clear/next)
- [x] Use option-panel selectors for time/source/sort filters (no cycle-click UX)
- [x] Add discovery pagination controls (`Prev` + `Next`) and paged tag selector panel
- [x] Treat `/find` without query as browse fallback (`/list` behavior)
- [x] Keep keyword ranking path and improve filter-first relevance (weighted keyword scoring)
- [x] Add clearer match snippets/reasons presentation in `/find` results
- [x] Add tests for filter callbacks, filter application, and `/find` empty fallback behavior
- [x] Update README usage with filter-enabled `/find` + `/list`
- [x] Defer embedding/hybrid retrieval for now (intentionally out of current scope)

## Milestone 17: Optimization IV — Reliability & ops

- [ ] Add retry policy for capture/search/model calls
- [ ] Add per-chat queue + backpressure controls
- [ ] Add structured logs and event tracing
- [ ] Add export flow (item + artifacts + annotations + dialogue JSON)
- [ ] Add retention/privacy toggles
- [ ] Add ops-focused tests and runbook notes

## Milestone 18: Multi-source ingestion (next)

- [x] Add Telegram URL+text ingestion path for blocked sources (non-command message)
- [x] Add snapshot failure classification (`login_required`/`blocked`/`timeout`/`fetch_failed`)
- [x] Add pasted-evidence artifacts (`evidence.md` + extracted text) when fetch fallback occurs
- [x] Define source adapter interface (`saveFromSource`) with normalized capture diagnostics
- [ ] Add source-type metadata and attribution fields (platform, author, publish time, canonical URL)
- [x] Implement X/Twitter URL ingestion adapter (gated/unusable detection + diagnostics)
- [x] Implement Xiaohongshu URL ingestion adapter (platform-specific cleaner extraction)
- [x] Implement WeChat article URL ingestion adapter (verification-wall detection + diagnostics)
- [x] Add fallback extraction strategy per source (HTML first, then text/pasted fallback)
- [x] Treat usable `text/plain` responses as first-class text evidence (no forced pasted-evidence retry)
- [x] Add parser/transport UX for source-specific save diagnostics
- [x] Add `reader_proxy` fallback acquisition strategy (`r.jina.ai/<url>`) for non-OK direct fetches
- [x] Add tests for source adapters and save diagnostics consistency
- [x] Update README with source support matrix and caveats

## Milestone 19: Review follow-up hardening (architecture + invariants)

### 19.1 Turn lifecycle correctness (priority)

- [x] Add explicit dialogue turn status model: `pending | failed | completed`
- [x] Add migration for turn status and failure metadata (for failed assistant turns)
- [x] Refactor ask flow to persist failed turns instead of dropping runtime failures:
  - [x] create pending assistant turn before responder call
  - [x] transition to `completed` on success (content/citations/model/provider)
  - [x] transition to `failed` on responder/runtime error (error summary persisted)
- [x] Update app/transport history rendering to surface turn status clearly
- [x] Add tests for success, responder error, and restart/read-path rendering of failed turns

### 19.2 Boundary cleanup and modularity

- [x] Split `transport/telegram.ts` into smaller modules (router, menu state, renderers, mode store)
- [x] Remove transport-level direct dependency on app internals (`database`, repos)
- [x] Expose app-level APIs for transport-required data instead of repo access
- [x] Unify command parsing path (`parse-command` + mode command parsing) to avoid semantic drift

### 19.3 Failure handling and contracts

- [x] Map viewer request validation/domain errors to proper HTTP classes (400/404/500)
- [x] Add exact command token matching (avoid `/saveX` style accidental matches)
- [x] Validate restored chat mode state against current item/session existence and auto-heal invalid state
- [x] Add save-path consistency guardrails (transaction + cleanup on partial failure)

### 19.4 Performance and operability (without major product changes)

- [x] Bound general-chat history growth (persisted + in-memory)
- [x] Clamp history page state transitions (no unbounded page drift)
- [x] Prepare retrieval scaling path (index/FTS design draft + migration plan) while keeping current UX (`docs/sonder-retrieval-scaling-plan.md`)
- [x] Add focused regression tests for the above invariants

## Milestone 20: Security hardening (deferred for now, single-user local)

- [ ] Harden viewer HTML sanitization beyond tag stripping (attributes/protocols/scriptable vectors)
- [ ] Add strict postMessage origin/source checks in viewer UI
- [ ] Add security regression tests for malicious snapshot payloads

## Milestone 21: Telegram/viewer UX follow-up

- [x] Replace prompt-based viewer note editing with inline note editor in annotation cards
- [x] Standardize Telegram/viewer displayed timestamps to `Asia/Shanghai` (`UTC+8`) while keeping UTC persistence
- [x] Prefer `gpt-5.2` as default Codex model when available (fallback to first available model)
- [x] Register Telegram slash command suggestions on startup via `setMyCommands`
- [x] Support `/save` suggestion flow where bare `/save` prompts for next-message URL input
- [x] Classify low-signal Twitter status direct captures as unusable to trigger `reader_proxy` fallback

## Milestone 22: Structural refactor program (maintain behavior, reduce complexity)

Goal: keep Telegram/viewer behavior stable while reducing monolith pressure in `transport/telegram.ts`, `viewer/server.ts`, and `app/sonder-app.ts`.

### 22.1 Telegram runner decomposition (highest priority)

- [x] Extract first callback handler module (`transport/telegram-callback-handlers.ts`) for `sess_*` + `model_set` branches
- [x] Keep callback payload compatibility while delegating to extracted handlers (no schema changes)
- [x] Add regression coverage via existing `test/telegram-transport.test.ts` for extracted session/model callback paths
- [x] Extract callback action handling into dedicated modules:
  - [x] `transport/callback-handlers/discovery.ts` (`find_*`, `list_*`, `menu_*`)
  - [x] `transport/callback-handlers/session.ts` (`sess_*`)
  - [x] `transport/callback-handlers/history.ts` (`hist_*`)
  - [x] `transport/callback-handlers/context.ts` (`ctx_*`) + `transport/callback-handlers/model.ts` (`model_*`)
- [x] Extract message routing from `TelegramBotRunner` into `transport/telegram-message-router.ts`
- [x] Move menu/session/history/model map lifecycle logic into a `transport/menu-store.ts`
- [x] Keep `TelegramBotRunner` as coordinator only (poll -> route -> send)
- [x] Add focused regression tests per extracted handler module (no behavior change assertions)
- [x] Progress 2026-02-18: extracted `sess_*` + `model_set` callback branches into `transport/telegram-callback-handlers.ts`
- [x] Progress 2026-02-18: extracted `hist_*` callback branch into `transport/telegram-callback-handlers.ts` + added focused handler tests
- [x] Progress 2026-02-18: extracted discovery open/delete callback branch (`find_*`, `list_*`) into `transport/telegram-callback-handlers.ts`
- [x] Progress 2026-02-18: extracted discovery filter callback branch (`menu_*`) into `transport/telegram-callback-handlers.ts` + added focused handler tests
- [x] Progress 2026-02-18: split callback handlers into dedicated modules under `transport/callback-handlers/`
- [x] Progress 2026-02-18: extracted callback orchestration into `transport/telegram-callback-router.ts`
- [x] Progress 2026-02-18: extracted mode command orchestration into `transport/telegram-mode-command-handler.ts`
- [x] Progress 2026-02-18: extracted message sub-routes into `transport/telegram-active-mode-message-handler.ts`, `transport/telegram-plain-message-handler.ts`, `transport/telegram-slash-command-handler.ts`
- [x] Progress 2026-02-18: extracted message branch routing into `transport/telegram-message-router.ts` + added focused router tests
- [x] Progress 2026-02-18: extracted shared utilities (`telegram-discovery-filters.ts`, `telegram-display-time.ts`, `telegram-utils.ts`)
- [x] Progress 2026-02-18: extracted menu map lifecycle into `transport/menu-store.ts` + added focused store tests
- [x] Progress 2026-02-18: extracted discovery filtering/render helpers into `transport/telegram-discovery-menu.ts` + focused menu tests
- [x] Progress 2026-02-18: extracted runner-heavy message/callback orchestration into `transport/telegram-runner-coordinator.ts`; `TelegramBotRunner` now poll/route coordinator only

Acceptance criteria:
- `transport/telegram.ts` reduced to coordination/orchestration without domain-heavy branching
- existing `test/telegram-transport.test.ts` remains green
- no command/callback payload schema changes

### 22.2 Viewer server split (server vs frontend script)

- [x] Move embedded viewer browser script to `viewer/client-script.ts` TypeScript module
- [x] Keep server template minimal and inject static viewer client bundle (`/viewer/static/client.js`)
- [x] Extract snapshot sanitization utilities to `viewer/sanitize.ts`
- [x] Extract overlay injection logic to `viewer/overlay.ts`
- [x] Add targeted tests for sanitization + overlay injection independently from HTTP routing
- [x] Progress 2026-02-18: extracted snapshot sanitization into `viewer/sanitize.ts` + added focused `viewer-sanitize.test.ts`
- [x] Progress 2026-02-18: moved embedded viewer browser script to `viewer/client-script.ts`; viewer page now loads `/viewer/static/client.js`
- [x] Progress 2026-02-18: extracted overlay injection into `viewer/overlay.ts` + added focused `viewer-overlay.test.ts`

Acceptance criteria:
- `viewer/server.ts` primarily handles HTTP routes and response composition
- viewer UX behavior remains unchanged (annotation create/edit/delete/filter/repair)
- sanitizer and overlay logic testable without spinning full server

### 22.3 App service decomposition (`SonderApp`)

- [x] Introduce use-case services:
  - [x] `app/save-service.ts` (save/acquisition/artifact persistence)
  - [x] `app/discovery-service.ts` (list/find scoring/snippets/filters)
  - [x] `app/dialogue-service.ts` (open/create/resume/history)
  - [x] `app/annotation-service.ts` (annotation CRUD + artifact selection)
- [ ] Keep `SonderApp` as facade delegating to use-case services
- [ ] Remove duplicate utility logic currently spread across `SonderApp` methods
- [ ] Preserve public API signatures where possible

- [x] Progress 2026-02-18: extracted save/acquisition flow into `app/save-service.ts`; `SonderApp.saveFromInput()` now delegates to service + added focused `test/save-service.test.ts`
- [x] Progress 2026-02-18: extracted discovery list/find scoring into `app/discovery-service.ts`; `SonderApp.processCommand()` now delegates list/find flows + added focused `test/discovery-service.test.ts`
- [x] Progress 2026-02-18: extracted annotation CRUD and artifact selection into `app/annotation-service.ts`; `SonderApp` now delegates annotation flows + added focused `test/annotation-service.test.ts`
- [x] Progress 2026-02-18: extracted open/resume/history logic into `app/dialogue-service.ts`; `SonderApp` now delegates dialogue session/history checks + added focused `test/dialogue-service.test.ts`

Acceptance criteria:
- smaller cohesive service modules with explicit dependencies
- no user-visible command behavior changes
- app-level tests still pass with equivalent outputs

### 22.4 Contract hardening and typed internal protocols

- [x] Replace stringly callback branching with typed handler registry (`CallbackAction -> handler`)
- [x] Normalize retrieval reason labels at source (user-facing mapping centralized)
- [x] Add invariant checks for menu state transitions and stale callback recovery paths
- [x] Add snapshot/viewer security regression cases for attributes/protocol stripping

- [x] Progress 2026-02-18: callback router now uses typed `CallbackAction -> handler` registry in `transport/telegram-callback-router.ts`
- [x] Progress 2026-02-18: centralized Telegram discovery reason label mapping in `transport/telegram-retrieval-reasons.ts`
- [x] Progress 2026-02-18: added discovery menu invariant/stale-callback guards for invalid filter and tag-selection transitions
- [x] Progress 2026-02-18: expanded viewer sanitizer regression tests to cover obfuscated protocol payloads

Acceptance criteria:
- fewer ad-hoc `if/else` chains for callback routing
- internal reason labels do not leak directly to Telegram UI without mapping
- stale/invalid callback flows consistently recover with guidance

### 22.5 Refactor execution guardrails

- [ ] Execute in small PR-sized slices (one sub-area at a time)
- [ ] For each slice: add/adjust tests first or in same change-set
- [ ] Run `npm run check` after each slice
- [ ] Keep command surface and callback payload format backward compatible during refactor window

## Milestone 23: Context Control (Telegram, detach-first MVP)

Goal: let users manually control model context in `/open` item dialogue mode without altering visible conversation history.

- [x] Add `ctx_marks` persistence (session-scoped) with `ACTIVE | DETACHED` state model
- [x] Add `ContextMarkRepo` and app/runtime service wiring for mark CRUD
- [x] Add semantic turn derivation service from existing `dialogue_turns` (user+assistant pairing)
- [x] Add context compiler (authoritative projection) with policy:
  - [x] include ACTIVE turns in chronological order
  - [x] exclude DETACHED turns
  - [x] prune oldest ACTIVE first under budget
- [x] Integrate compiler into `AskService.askInSession(...)` before prompt construction
- [x] Add Telegram quick actions on item replies:
  - [x] `Open Context Panel`
  - [x] `Detach last turn`
- [x] Add context panel callbacks + pagination:
  - [x] detach / re-attach per semantic turn
  - [x] show included vs detached sections
- [x] Add context dump action showing included/excluded reasons + compiled preview
- [x] Keep `/ask` as compatibility fallback; keep Telegram UX centered on `/open` flow
- [x] Add tests:
  - [x] semantic turn builder tests
  - [x] context compiler tests
  - [x] context mark repo tests
  - [x] Telegram context panel/quick-action integration tests
  - [x] ask-service context projection tests
- [ ] Phase-2 follow-up (deferred): add `PINNED` state, panel single-message edit (`editMessageText`), and panel search

## Milestone 24: Canonical Markdown Layer (foundation for future viewer)

Objective: persist a deterministic `canonical_md` per item and enforce canonical-only rendering/anchoring going forward.

### 24.1 Storage: item content read model

- [x] Add SQLite migration: create `item_contents` table keyed by `item_id` with fields:
  - [x] `canonical_md` (TEXT)
  - [x] `canonical_version` (INT)
  - [x] `canonical_generated_at` (timestamp TEXT)
  - [x] (optional) raw attribution fields (`raw_type`, `raw_blob_path`, `raw_url`, `fetched_at`)
- [x] Add `ItemContentRepo` (find/upsert) + export from `storage/index.ts`
- [x] Extend storage smoke tests for item content round-trip + cascade delete

### 24.2 Canonicalization module (pure, deterministic)

- [x] Add module: `src/canonical/canonical-markdown.ts` (or similar) with:
  - [x] `canonicalizeMarkdownV1(input: string): string`
  - [x] `canonicalVersion = 1`
- [x] Implement minimum normalization rules:
  - [x] normalize line endings to `\n`
  - [x] trim trailing whitespace
  - [x] collapse multiple blank lines to a single blank line
  - [x] trim leading/trailing blank lines
- [x] Unit tests:
  - [x] determinism (same input -> same output)
  - [x] idempotence (`canonicalize(canonicalize(x)) === canonicalize(x)`)

### 24.3 HTML -> Markdown v1 converter (stable > pretty)

- [x] Pick deterministic HTML parsing strategy (in-house v1 converter)
- [x] Implement HTML -> Markdown v1 with limited, stable tag support:
  - [x] headings (`h1`-`h6`)
  - [x] paragraphs + line breaks
  - [x] lists (`ul/ol/li`)
  - [x] links (`[text](url)`; resolve relative URLs against `item.originalUrl`)
  - [x] code blocks (`pre/code` -> fenced blocks)
  - [x] blockquotes (optional)
- [x] Strip/ignore non-content tags (`script/style/noscript/svg/...`) deterministically
- [x] Add converter tests with fixtures (links, lists, code)
- [x] Refinement pass: improve paragraph/line splitting for irregular HTML structures while preserving deterministic output

### 24.4 Canonical generation service (source selection + persistence)

- [x] Implement `generateCanonicalMarkdownV1(...)` that selects the best available source:
  - [x] prefer `evidence-md` when present (pasted evidence)
  - [x] else use `snapshot-html` (HTML -> MD)
  - [x] else fall back to `extracted-text` (plain text -> MD)
- [x] Implement `ensureCanonical(itemId)` that:
  - [x] reads current artifacts
  - [x] generates canonical if missing
  - [x] persists `canonical_md`, `canonical_version=1`, `canonical_generated_at`

### 24.5 Save pipeline integration (new items)

- [x] In `SaveService.save()`: generate and persist canonical content for every newly saved item (same DB transaction)
- [x] Add tests: saving an item persists canonical content

### 24.6 Lazy backfill (existing items; no backfill on /find)

- [x] Trigger `ensureCanonical(itemId)` only when an item is:
  - [x] opened (`/open`)
  - [x] asked about (`AskService` item path)
  - [x] annotated (viewer create annotation path, as needed)
  - [x] rendered in viewer (`/viewer/items/:id/snapshot`)
- [x] Keep `/find` read-only: do not generate canonical in discovery flows

### 24.7 Hard rule: canonical-only rendering + anchoring

- [x] Update viewer snapshot route to render `canonical_md` only (escaped HTML wrapper), never `snapshot-html`/`extracted-text`
- [x] Update viewer server annotation-create fallback anchor builder to use canonical content (not extracted-text)
- [x] Introduce a new anchor kind for canonical surface (e.g., `md-quote-v1`) for newly created annotations
  - [x] keep resolving existing `html-quote-v1` anchors for legacy annotations
- [x] Add viewer regression tests for canonical snapshot rendering + overlay behavior

### 24.8 Runtime: ask context reads canonical content

- [x] Update `AskService`/`buildAskContext` to include canonical markdown instead of extracted text artifact
- [x] Add a canonical context character cap (analogous to `DEFAULT_MAX_EXTRACTED_TEXT_CHARACTERS`)
- [x] Update ask-service tests accordingly

### 24.9 Retrieval: use canonical content when available

- [x] Update `DiscoveryService` to score/snippet against canonical content when present
- [x] When canonical is missing, skip content scoring/snippets (URL/tags/annotations still apply)
- [x] Update discovery-service tests for canonical-backed content matches

### 24.10 Ops (optional)

- [ ] Optional: add a one-shot CLI/backfill command to canonicalize all items offline (not used by Telegram flows)
