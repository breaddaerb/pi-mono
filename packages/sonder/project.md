# Sonder project walkthrough (maintainer ramp-up)

This file is the fast ramp-up brief for future work on `packages/sonder`.

## 1) What Sonder is

Sonder is a Telegram-first, item-anchored PKM system.

Core loop:
1. capture evidence (`/save`)
2. enter item context (`Open` / `/open`)
3. annotate in viewer
4. continue multi-turn dialogue in Telegram
5. resume sessions later (`/sessions`, `/history`)

Design principles:
- evidence is durable local artifact data
- annotations are DB records (no snapshot mutation)
- dialogue trajectory is first-class memory
- no-ID UX for discovery in Telegram (button-first)

---

## 2) Current implementation status

MVP is implemented.

Implemented capabilities:
- URL capture pipeline (`snapshot.html + assets`, extracted text, fallback artifact)
- SQLite repositories + migrations (items/artifacts/annotations/dialogues/chat-mode-state)
- Telegram transport with callback menus (`sx:v1:<action>:<menuId>:<arg>`)
- item/general dialogue modes with restart-safe state restore
- viewer-first annotation flow (highlight/underline/note, edit/delete, status, repair)
- `/find` + `/list` button discovery with refinement filters and pagination
- `/sessions` + `/history` no-ID flows
- weighted keyword retrieval + reasons + snippets

---

## 3) Interaction model (as implemented)

### Discovery and open
- `/find <query>` returns indexed rows + `Open` buttons
- `/list [limit]` returns indexed rows + `Open` buttons
- refinement buttons: `Time | Source | Tag | Sort | Clear | Prev | Next`
- `Tag` uses a paged selector panel

### Entering item dialogue
- `Open` button or `/open <itemId>` enters item mode
- default behavior when opening an item:
  - resume latest existing session if present
  - otherwise create a new session
- explicit session control: `/sessions` -> `Resume` / `New Session`

### Item dialogue and history
- plain non-command text in item mode is routed to active item session
- `/history` in item mode opens paged turn history (`Prev | Next | Back`)
- `/where` shows active mode/session
- `/exit` exits active mode

### General chat
- `/open` (no argument) starts a general-chat session
- plain text then routes to that general session
- general-mode history is bounded in `src/transport/telegram-mode-store.ts`:
  - `MAX_GENERAL_HISTORY_ENTRIES = 24`
  - `MAX_GENERAL_HISTORY_CHARACTERS = 12_000`
- these bounds are for Telegram general mode persistence only (chat-mode-state)
- item-mode dialogue remains persisted in `dialogue_turns` and is not limited by these constants

---

## 4) Key files and responsibilities

- `src/app/sonder-app.ts`
  - command orchestration
  - retrieval scoring/snippets
  - annotation CRUD wiring
- `src/runtime/ask-service.ts`
  - session resolution
  - context build + responder call + turn persistence
- `src/transport/telegram.ts`
  - polling loop
  - mode routing
  - callback menu state machine
- `src/viewer/server.ts`
  - local snapshot viewer
  - annotation overlay/actions/filter/repair
- `src/storage/*`
  - repos and migrations

---

## 5) Code review summary (2026-02)

Review scope: app/runtime/transport/storage paths plus tests/docs alignment.

### Strengths
- Clear separation: transport vs app vs runtime vs storage
- Good coverage on Telegram flows and app behavior
- Callback payload contract is stable and explicit
- Session persistence behavior is deterministic and test-backed

### Non-blocking issues to track
1. History menu uses monotonic page growth on repeated `Next` at end (clamped when rendered). Low risk, can be bounded for cleaner menu-state behavior.
2. `/find` reason labels are internal-style (`annotation-tags`, `item-note`). Could be normalized to user-facing labels in Telegram text.
3. Discovery and history menu maps are memory-resident with TTL cleanup-on-access only. Fine for MVP; periodic cleanup could be added in ops pass.
4. Retry/backpressure/telemetry are still pending (tracked in Milestone 17).

No blocking correctness issues found for current MVP behavior.

---

## 6) Documentation map (source of truth)

- user/developer usage: `packages/sonder/README.md`
- delivery tracker: `packages/sonder/TODO.md`
- implementation checklist: `docs/sonder-implementation-checklist.md`
- this ramp-up brief: `packages/sonder/project.md`

Keep these aligned whenever behavior changes.

---

## 7) Next phase candidates

1. Reliability/ops pass
   - retry policy
   - per-chat queue/backpressure
   - structured logs + export/retention controls
2. Retrieval UX polish
   - friendlier reason labels
   - snippet prioritization tuning
3. Viewer test hardening
   - more anchor-repair scenario coverage

---

## 8) Fast local sanity run

From `packages/sonder`:

```bash
SONDER_TELEGRAM_BOT_TOKEN="..." SONDER_RESPONDER=codex npx tsx src/main.ts --telegram --root ./.sonder-data
```

In Telegram:
1. `/save <url> #tag`
2. `/exit`
3. `/find <term>` -> tap `Open`
4. ask plain text
5. `/sessions`
6. `/history`

This validates the primary MVP interaction path end-to-end.
