---

# Sonder – Project Context (Living Brief)

---

This file is for two readers:
1) you (current maintainer)
2) future coding agents (future me)

Goal: make ramp-up fast, with clear current state + next direction.

---

## 1) Product Definition

Sonder is a **Telegram-first personal knowledge system** built in `pi-mono/packages/sonder`.

Core identity:
- preserve durable evidence (snapshots, not just links)
- discuss saved items in multi-turn dialogue
- keep dialogue trajectory as first-class memory
- support retrieval over saved knowledge

Sonder is not a generic note app. It is an **item-anchored thinking space**.

## 1.1) North-star (high-level intent)

Sonder exists to create:

> A space where fragments can be unfolded, questioned, linked to past thoughts, reframed, and explored without friction.

Implications:
- evidence-first, not bookmark-first
- conversation-first, not static summary-first
- re-entry into prior dialogue must be effortless
- retrieval should support re-contextualization, not only lookup

---

## 2) Current MVP Status (What Already Works)

### Capture
- `/save <url> [#tags...]`
- public web URL scope only (MVP)
- artifacts persisted locally:
  - `snapshot.html + assets`
  - extracted text
  - fallback text artifact when needed

### Retrieval (keyword MVP)
- `/find <query> [limit]`
- keyword ranking over:
  - URL
  - tags
  - annotations (text/comment)
  - extracted text

### Item dialogue
- `/open <itemId>` enters item dialogue mode
- `/open` enters general chat mode
- non-command text in active mode becomes dialogue turns
- `/exit`, `/where`, `/sessions <itemId>`, `/resume <sessionId>`, `/history [sessionId]`
- active mode/session is persisted per chat (restart-safe)

### Annotation viewer (Zotero-inspired MVP)
- `/open <itemId>` response includes local viewer URL
- viewer allows selection-based:
  - highlight
  - underline
  - note (comment on selected highlight/underline)
- annotation list supports edit/delete
- overlay re-renders on reopen (basic robust matching)
- sidebar click jumps to/focuses highlight target

### Ask/runtime
- `/ask <itemId> <question>` works as stateless fallback
- context priority:
  1. annotations
  2. prior dialogue
  3. extracted text
- inline evidence refs supported
- full turns persisted

---

## 3) MVP Interaction Model (Current)

Typical flow:
1. `/save <url> #tags`
2. `/find <query>` (optional discovery)
3. `/open <itemId>` (enter item dialogue + open viewer)
4. annotate in viewer (highlight/underline/note)
5. ask in Telegram via normal messages (or `/ask`)
6. `/history` / `/sessions` / `/resume` to continue threads later

---

## 4) Architecture Snapshot

### Package
- `packages/sonder`

### Key modules
- `src/app/sonder-app.ts` – orchestration + domain operations
- `src/commands/parse-command.ts` – command parsing
- `src/transport/telegram.ts` – Telegram mode/state routing
- `src/viewer/server.ts` – local snapshot/annotation viewer server
- `src/runtime/*` – ask context + responder logic
- `src/storage/*` – sqlite repos + migrations

### Storage
- SQLite + local artifact files
- per-chat active mode stored in DB (`chat_mode_states`)

---

## 5) Constraints and Principles

- Telegram is the primary interface for MVP
- Command + viewer hybrid interaction (not viewer-only)
- Annotations are DB entities (do not mutate snapshot artifact files)
- Keep architecture chunk-ready and embedding-ready
- Optimize for maintainability over speed

---

## 6) What Is Still Not Done (Optimization Chapter)

This is the next chapter after MVP realization.

### A) Viewer polish
- richer visual polish and interaction quality
- stronger anchor repair/validation for difficult HTML drift
- better annotation UX details (selection affordances, cards, discoverability)

### B) Retrieval quality
- improve `/find` relevance with better ranking strategy
- add metadata filter syntax (beyond simple query)
- later hybrid retrieval (keyword + vector)

### C) Entry/discovery UX
- easier entry into desired item/session
- better open/find handoff ergonomics in Telegram

### D) Reliability/ops
- queue/backpressure hardening
- structured telemetry
- export/retention controls

---

## 7) Working Rules (Operational)

Authoritative project tracking files:
- `packages/sonder/TODO.md`
- `docs/sonder-implementation-checklist.md`

Authoritative usage docs:
- `packages/sonder/README.md`

When feature behavior changes, update all three in the same cycle.

---

## 8) Definition of Success (Current Phase)

For the optimization phase, success means:
- smoother item entry + continuation
- better find quality
- cleaner annotation/viewer UX
- same stability guarantees as current MVP

---

Sonder is now in a strong MVP-complete baseline.
Next chapter is **quality, retrieval precision, and interaction refinement**.

---

**Sonder is not a tool for storing ideas.
It is a space for entering into them.**
