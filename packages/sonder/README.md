# @mariozechner/pi-sonder

Sonder is a Telegram-first conversational personal knowledge system built on pi-mono.

## MVP scope (confirmed)

- Source scope: public web URL only
- Save contract: `/save <url> [#tags...]`
- Ask contract (compatibility fallback): `/ask <itemId> <question>`
- List contract: `/list [limit]`
- Find contract: `/find <query> [limit]`
- Annotation contracts: `/annotate <itemId> <text> [#tags...]`, `/ann list <itemId>`, `/ann del <annotationId>`
- Viewer annotation actions: select text then `highlight | underline | note`, with edit/delete in sidebar
- Dialogue mode contracts: `/open [itemId]`, `/where`, `/exit`, `/sessions` (context-first), `/resume <sessionId>` (compatibility)
- Snapshot outputs: `snapshot.html + assets`, extracted text, screenshot fallback
- Annotation types: `highlight`, `underline`, `note`
- Ask behavior: inline evidence refs in responses by default
- Persistence: full dialogue turns; raw thinking disabled by default
- Model path: Codex/OpenAI only
- Storage: SQLite + local artifact files

## Status

- Milestone 1 complete: package scaffold, command parsing, baseline types
- Milestone 2 complete: SQLite storage adapter, migrations, repositories, storage smoke tests
- Milestone 3 complete: snapshot service (`snapshot.html + assets`), extracted text, text-only fallback
- Milestone 4 complete: ask-first runtime service (context builder, turn persistence, inline refs, thinking off by default)
- Milestone 5 complete: `SonderApp` command orchestration (`/save` + `/ask`) with end-to-end tests

## Testing

Run from package root:

```bash
cd packages/sonder
```

Run all Sonder tests:

```bash
npm run test
```

Run specific tests (used in current implementation):

```bash
npx tsx ../../node_modules/vitest/dist/cli.js --run test/parse-command.test.ts test/storage-smoke.test.ts test/snapshot-service.test.ts test/ask-service.test.ts test/sonder-app.test.ts test/cli-run-once.test.ts test/telegram-transport.test.ts test/cli-run-telegram.test.ts
```

## Run current version (local command runner)

Build package:

```bash
cd packages/sonder
npm run build
```

Save a page (writes data + sqlite under `--root`):

```bash
node dist/main.js --root ./.sonder-data /save https://lucumr.pocoo.org/2026/2/9/a-language-for-agents '#agents'
```

List saved items (copy an `itemId`):

```bash
node dist/main.js --root ./.sonder-data /list
```

List with explicit limit:

```bash
node dist/main.js --root ./.sonder-data /list 10
```

Find relevant items:

```bash
node dist/main.js --root ./.sonder-data /find "language design" 5
```

Ask an item (replace `ITEM_ID` with a real ID):

```bash
node dist/main.js --root ./.sonder-data /ask ITEM_ID "what is the main thesis?"
```

Add an annotation note:

```bash
node dist/main.js --root ./.sonder-data /annotate ITEM_ID "key claim in this article" "#thesis"
```

List annotations:

```bash
node dist/main.js --root ./.sonder-data /ann list ITEM_ID
```

Delete an annotation:

```bash
node dist/main.js --root ./.sonder-data /ann del ANNOTATION_ID
```

Responder modes:

- Default (stub): no extra env needed
- Codex (source run, OAuth-aware):

```bash
SONDER_RESPONDER=codex npx tsx src/main.ts --root ./.sonder-data /ask <itemId> "what is the main thesis?"
```

- Codex (built dist, explicit token):

```bash
SONDER_RESPONDER=codex SONDER_CODEX_TOKEN="<token>" node dist/main.js --root ./.sonder-data /ask ITEM_ID "what is the main thesis?"
```

Optional Codex env:

- `SONDER_CODEX_MODEL` (e.g. `gpt-5.3-codex`)
- `SONDER_CODEX_REASONING` (`minimal|low|medium|high`)

Telegram connectivity check:

```bash
SONDER_TELEGRAM_BOT_TOKEN="<bot-token>" npx tsx src/main.ts --telegram-check
```

Telegram long-polling mode (MVP skeleton):

```bash
SONDER_TELEGRAM_BOT_TOKEN="<bot-token>" SONDER_RESPONDER=codex npx tsx src/main.ts --telegram --root ./.sonder-data
```

Primary Telegram command surface (open-first):

```text
/save <url> [#tags...]
/find <query> [limit]
/list [limit]
/open [itemId]
/sessions
/history
/where
/exit
/help
```

Compatibility commands (secondary):

```text
/ask <itemId> <question>  # deprecated in Telegram UX
/resume <sessionId>
/history <sessionId>
```

Entry/discovery UX (P1.1 + P1.2/P1.3 slice currently implemented):

- `/find` returns index-based results with inline `Open` buttons.
- `/list [limit]` returns index-based rows with `Open` buttons.
- `/find` and `/list` include refinement chips: `Time | Source | Tag | Sort | Clear | Next`.
- `/find` without query falls back to browse mode (`/list`).
- Callback payload contract: `sx:v1:<action>:<menuId>:<arg>`.
- Internal IDs are hidden from `/find` and `/list` result text.
- Expired button actions return recovery guidance (`/open`, `/list`, or `/find` again).
- After `/save`, Telegram automatically enters item dialogue mode for the new item.
- Item-mode entry replies now include action buttons: `Open Viewer | Exit`.
- Session summary is shown directly in the item-mode card (active turns + recent sessions count + recent activity datetime).
- `/sessions` now returns indexed `Resume` buttons plus `New Session` for the active item.
- `/history` in item mode now includes pagination buttons (`Prev | Next | Back`).
- Contextual plain-text replies include a compact context banner (item/general).

Active dialogue mode is persisted per chat in SQLite, so mode/session can survive process restart.

Session resume flow example:

```text
/find language
# tap "1 Open"
/sessions
# tap "1 Resume" or "New Session"
/history
/where
```

If your network requires a proxy:

```bash
SONDER_TELEGRAM_BOT_TOKEN="<bot-token>" SONDER_TELEGRAM_PROXY="http://127.0.0.1:7890" SONDER_RESPONDER=codex npx tsx src/main.ts --telegram --root ./.sonder-data
```

Optional local viewer port:

```bash
SONDER_VIEWER_PORT=4321 SONDER_TELEGRAM_BOT_TOKEN="<bot-token>" SONDER_RESPONDER=codex npx tsx src/main.ts --telegram --root ./.sonder-data
```

### Minimal E2E checklist (live)

1. Connectivity check

```bash
SONDER_TELEGRAM_BOT_TOKEN="..." SONDER_TELEGRAM_PROXY="http://127.0.0.1:7890" npx tsx src/main.ts --telegram-check
```

Expected: JSON with `"ok": true`.

2. Start bot polling + local viewer

```bash
SONDER_TELEGRAM_BOT_TOKEN="..." SONDER_TELEGRAM_PROXY="http://127.0.0.1:7890" SONDER_RESPONDER=codex SONDER_VIEWER_PORT=4321 npx tsx src/main.ts --telegram --root ./.sonder-data
```

Expected in terminal:

- `[telegram] polling started`
- `[viewer] started at http://127.0.0.1:4321` (port may differ)

3. In Telegram, save and use discovery buttons (no IDs)

```text
/save https://lucumr.pocoo.org/2026/2/9/a-language-for-agents #agents
# auto-enters item mode for saved item
/exit
/find language agents
# tap "Time:*" then choose an option (e.g. "Last 7d"), or tap "Tag:*", then tap "1 Open"
/list 2
# tap "Source:*" or "Sort:*" and choose option, then tap "1 Open"
/find
# falls back to list-style browse
```

Expected:

- `/save` auto-enters item mode for the saved item
- `/find` returns index-based rows with inline `Open` buttons
- `/list` returns index-based rows with inline `Open` buttons
- `/find` + `/list` support refinement chips (`Time/Source/Tag/Sort/Clear/Next`)
- `/find` without query falls back to list-style browsing
- In Telegram UX, `/ask` is deprecated; open an item first, then ask in plain text.
- result text does not expose internal item IDs
- tapping a button opens item mode and returns a viewer URL

4. In browser, test viewer annotation flow

- Open the returned viewer URL
- In snapshot frame, select a sentence
- Click `Highlight` (or `Underline` / `Note`)
- Verify annotation appears in sidebar with clearer type/comment/tag card styling and anchor status badge (`anchor`/`fallback`/`unresolved`)
- Use sidebar filters (`All/Highlight/Underline/With note/Unresolved`) and tag-chip click filtering to narrow visible annotations
- For `fallback`/`unresolved` status cards, use `Repair anchor` to regenerate anchor from current snapshot text
- Scroll the annotation list and verify it stays below the top action bar (no overlap)
- Click `Edit` then `Delete` to confirm update and removal
- Verify snapshot refresh preserves scroll context without visible top-jump flicker

5. Back in Telegram, test multi-turn dialogue on active item

```text
what is the core thesis?
how does this relate to language design?
/where
/exit
/open
hello in general mode
/exit
```

Expected:

- non-command text while item mode is active routes to that item session
- answers are non-empty and context-aware
- `/where` shows active mode/session
- `/open` (without itemId) enters general chat mode
- `/exit` leaves active mode

6. Optional evidence check

- Create a highlight/note in viewer
- Ask a question in the item dialogue
- Confirm answer includes annotation evidence refs when available (`[ann:...]`)
