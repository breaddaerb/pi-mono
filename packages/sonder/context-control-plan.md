# Context Control (Telegram) — Implementation Plan (Draft)

## 0) Scope alignment (from discussion)

- Primary conversation path is **`/open` item mode + plain text**.
- `/ask` is compatibility-only in Telegram and remains deprecated UX.
- For MVP, the detach unit is a **semantic turn pair** built from existing persisted dialogue rows:
  - one `role=user` row + its corresponding `role=assistant` row.
- User-visible chat/history remains unchanged.
- Agent context becomes a compiled projection controlled by ctx marks.

---

## 1) MVP goals

1. User can open a context panel from Telegram and detach/reattach older turns.
2. Detached turns are excluded from next-round model context.
3. `/history` and chat log remain complete and unmodified.
4. User can request a context dump showing included/excluded reasons.

---

## 2) Explicit MVP decisions

### 2.1 Semantic turn identity

Use existing item-session rows in `dialogue_turns` and derive semantic turns deterministically.

- `semanticTurnId = userTurn.id` (stable, persisted UUID)
- semantic turn payload:
  - `sessionId`
  - `semanticTurnId`
  - `userTurn` (required)
  - `assistantTurn` (optional while pending/failed flow)
  - `createdAt` (user turn timestamp)
  - `summary` (short preview from user content + assistant status)

### 2.2 No raw Telegram event turn-builder in MVP

Do **not** add burst-window grouping from Telegram message IDs in phase 1.
Rationale:
- existing `/open` ask pipeline already persists deterministic user/assistant rows
- lower risk and no new latency/buffering behavior

### 2.3 Mark scope

Use **session-scoped** marks in MVP (not chat-scoped).
- Key: `(session_id, semantic_turn_id)`
- This matches `/open` session semantics and avoids plumbing `chat_id` into runtime compiler path.

### 2.4 Panel update strategy

MVP uses `sendMessage` for each panel refresh (current API shape).
- Optional phase 2: single-message panel with `editMessageText` + stored `message_id`.

### 2.5 State model for MVP

Only two states in MVP:
- `ACTIVE`
- `DETACHED`

Keep interfaces extensible so `PINNED` can be added later without redesign.

---

## 3) Data model changes

## 3.1 New table: `ctx_marks`

Migration `version: 5` in `src/storage/migrations.ts`:

- `session_id TEXT NOT NULL`
- `semantic_turn_id TEXT NOT NULL`
- `state TEXT NOT NULL` (`ACTIVE | DETACHED` in MVP)
- `updated_at TEXT NOT NULL`
- `updated_by TEXT NULL` (optional, nullable)
- `PRIMARY KEY (session_id, semantic_turn_id)`
- `FOREIGN KEY(session_id) REFERENCES dialogue_sessions(id) ON DELETE CASCADE`
- index on `(session_id, updated_at)`

Default behavior: turns without mark are treated as `ACTIVE`.

## 3.2 New storage repo

`src/storage/context-mark-repo.ts`

Methods:
- `getState(sessionId, semanticTurnId): CtxState | null`
- `upsertState(sessionId, semanticTurnId, state, updatedAt, updatedBy?)`
- `listBySessionId(sessionId): CtxMark[]`
- `deleteBySessionId(sessionId)` (optional convenience)

Export in `src/storage/index.ts`.

---

## 4) Domain services

## 4.1 SemanticTurnService (derived turns)

New module (suggested): `src/runtime/semantic-turn-service.ts`

Responsibilities:
- build semantic turns from `dialogueRepo.listTurnsBySessionId(sessionId)`
- deterministic pairing rules:
  - each user row opens one semantic turn
  - first subsequent assistant row closes that semantic turn
  - if missing assistant, keep `assistantTurn = null`
- provide paging-friendly list sorted by `createdAt DESC` for panel
- lookup helpers for “last turn” actions

## 4.2 CtxMarkService

New module (suggested): `src/runtime/ctx-mark-service.ts`

Responsibilities:
- set state (`ACTIVE` / `DETACHED`)
- convenience operations:
  - `detach(sessionId, semanticTurnId)`
  - `attach(sessionId, semanticTurnId)`

## 4.3 ContextCompiler (authoritative projection)

New module (suggested): `src/runtime/context-compiler.ts`

Input:
- semantic turns
- marks
- token budget (approx)
- compile mode (`default` for MVP)

Policy (MVP):
1. Include `ACTIVE` turns (chronological asc)
2. Exclude `DETACHED` turns
3. If over budget, prune oldest `ACTIVE` first until under budget

Token estimate (MVP): deterministic char-based estimate (e.g. `Math.ceil(chars / 4)`).

Output:
- `includedTurns: DialogueTurn[]` (rows used by prompt)
- `compiledItems: [{ semanticTurnId, reason: active, approxTokens }]`
- `excludedItems: [{ semanticTurnId, reason: detached|pruned_active }]`
- `compiledTextPreview` (for ctx dump)

---

## 5) Ask pipeline integration

Modify `src/runtime/ask-service.ts`:

Current:
- uses full `priorTurns` from repo directly.

Target:
1. load prior rows
2. build semantic turns
3. load marks
4. compile included context rows
5. pass included rows into `buildAskContext(...)`

Notes:
- persistence of new user/assistant rows stays unchanged
- only context projection changes
- user history remains intact

---

## 6) App facade additions

Expose minimal APIs from `SonderApp` for transport wiring:

- `listContextTurns(sessionId, page, pageSize)`
- `setContextTurnState(sessionId, semanticTurnId, state)`
- `detachLastContextTurn(sessionId)`
- `compileContextDump(sessionId, tokenBudget)`

This keeps Telegram layer thin and avoids business logic in transport.

---

## 7) Telegram UX plan

## 7.1 Quick actions on item-mode answers

Attach inline keyboard on normal item replies:
- `Open Context Panel`
- `Detach last turn`

Implementation touchpoints:
- `src/transport/telegram-active-mode-message-handler.ts`
- `src/transport/telegram-runner-coordinator.ts`

## 7.2 Context panel

Add panel callbacks and renderer:
- New callback actions in `src/transport/telegram-callback.ts`:
  - `ctx_panel`
  - `ctx_detach_last`
  - `ctxp_prev`, `ctxp_next`
  - `ctxp_detach`, `ctxp_attach`
  - `ctxp_dump`
- Route via `telegram-callback-router.ts` and new handler module
  (`src/transport/callback-handlers/context-panel.ts` suggested)

Panel content (paged, default page size 10):
- section A: included (`ACTIVE`)
- section B: detached (`DETACHED`)
- row actions depend on state:
  - `ACTIVE` -> `Detach`
  - `DETACHED` -> `Re-attach`

For callback payload size limits, use menu-index addressing:
- menu store holds page rows + semantic turn ids
- callback argument is row index, not raw UUID

## 7.3 Optional command

Add `/context` mode command as explicit entry to panel.
- Update `parse-mode-command.ts`
- Update mode handler and command suggestions if adopted.

---

## 8) Menu store additions

Extend `src/transport/menu-store.ts` with context panel state:
- `createContextPanelMenu(chatId, sessionId, rows, page, pageSize)`
- `getContextPanelMenu(chatId, menuId)`

State includes:
- `sessionId`
- `page`, `pageSize`
- row mapping (`index -> semanticTurnId`)
- expiry metadata (reuse TTL behavior)

---

## 9) Context dump UX

`Show ctx dump` should return:
- Included list with reasons and token estimates
- Excluded list with reasons
- Compiled text preview (possibly truncated)

Implementation can reuse `splitForTelegram` and cap preview length.

---

## 10) Testing plan

## 10.1 New unit tests

1. `semantic-turn-service.test.ts`
- pairing correctness
- missing assistant behavior
- stable semantic IDs

2. `context-compiler.test.ts`
- active/detached inclusion logic
- deterministic order
- budget pruning order

3. `context-panel-renderer.test.ts`
- deterministic text and keyboard snapshot-style assertions

4. `context-mark-repo.test.ts`
- upsert/get/list semantics and defaults

## 10.2 Integration tests

Update Telegram transport tests:
- quick action keyboard exists on item replies
- detach last turn changes subsequent answer context
- panel pagination and state toggles
- ctx dump output contains expected included/excluded reasons

Update ask-service tests:
- detached turn excluded from prompt
- active turns are pruned oldest-first under tight budget

---

## 11) Phasing

### Phase 1 (MVP)
- DB migration + repo
- semantic-turn derivation
- compiler integration in ask pipeline
- quick actions: open panel + detach last
- panel pagination + detach/attach
- ctx dump

### Phase 2
- single editable panel message (`editMessageText`)
- search inside panel
- add `PINNED` state and related compiler policy
- VIEW scope and compile modes
- reply-to-old-message fallback controls

---

## 12) Open alignment questions

1. Keep panel in MVP as `sendMessage` refreshes, then do `editMessageText` in phase 2?
2. Add `/context` command now, or quick-action-only entry first?
3. Token budgeting: acceptable to start with char-based approximation?
