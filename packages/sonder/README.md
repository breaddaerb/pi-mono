# @mariozechner/pi-sonder

Telegram-first conversational PKM for item-anchored thinking.

## What Sonder does

- Saves public web pages as durable local evidence (`snapshot.html + assets`, extracted text, fallback artifact)
- Lets you annotate saved snapshots in a local viewer (highlight / underline / note)
- Runs multi-turn dialogue anchored to an item
- Persists dialogue sessions and active chat mode in SQLite (restart-safe)
- Supports discovery via `/list` and `/find` with Telegram buttons (no ID-centric UX)

> **Sonder is not a tool for storing ideas. It is a space for entering into them.**

## Scope (current MVP)

- Source: public web URLs only
- Interface: Telegram-first + local viewer
- Model path: Codex/OpenAI responder path
- Storage: SQLite + local artifact files
- Retrieval: keyword-first (non-embedding)

## Quick start

From repo root:

```bash
cd packages/sonder
```

### 1) Telegram connectivity check

```bash
SONDER_TELEGRAM_BOT_TOKEN="<bot-token>" npx tsx src/main.ts --telegram-check
```

### 2) Run Telegram + viewer

```bash
SONDER_TELEGRAM_BOT_TOKEN="<bot-token>" \
SONDER_RESPONDER=codex \
SONDER_VIEWER_PORT=4321 \
npx tsx src/main.ts --telegram --root ./.sonder-data
```

If needed (proxy):

```bash
SONDER_TELEGRAM_PROXY="http://127.0.0.1:7890"
```

## Telegram command surface

### Primary flow

```text
/save <url> [#tags...]
/find <query> [limit]
/list [limit]
/open [itemId]
/sessions
/history
/where
/exit
```

### Compatibility commands

```text
/ask <itemId> <question>   # compatibility fallback; deprecated in Telegram UX
/resume <sessionId>
/history <sessionId>
/annotate <itemId> <text> [#tags...]
/ann list <itemId>
/ann del <annotationId>
```

## Interaction map (recommended)

### A) Save and continue immediately

1. `/save <url> #tags`
2. Sonder auto-enters item mode for the new item
3. Send plain text questions directly
4. `/exit` when done

### B) Discover first, then open

1. `/find <query>` or `/list`
2. Use buttons (`Time`, `Source`, `Tag`, `Sort`, `Clear`, `Prev`, `Next`)
3. Tap `N Open` on a result row
4. You enter item mode

### C) Session behavior and defaults (important)

- Opening an item (`/open <itemId>` or button `Open`) uses this default:
  - **resume latest existing session** for that item if one exists
  - otherwise **create a new session**
- To override this behavior explicitly:
  - run `/sessions` in item mode
  - choose `Resume` for a listed session, or `New Session`

### D) General chat mode

- `/open` (without itemId) starts general chat mode
- each `/open` call creates a new general session

### E) Viewer loop

1. In item mode, tap `Open Viewer`
2. Select text in snapshot
3. Create highlight / underline / note
4. Ask follow-up questions in Telegram plain text

## Discovery UX details

- `/find` and `/list` are rendered as index-based rows with inline `Open` buttons
- Internal item IDs are hidden in Telegram discovery output
- `/find` in Telegram without a query falls back to browse mode (`/list` behavior)
- `/find` result rows include weighted `reasons` + short `match` snippets
- Stale callback actions show recovery guidance

## Testing

From `packages/sonder`:

```bash
npm run test
```

Focused suites commonly used in development:

```bash
npx tsx ../../node_modules/vitest/dist/cli.js --run \
  test/parse-command.test.ts \
  test/storage-smoke.test.ts \
  test/snapshot-service.test.ts \
  test/ask-service.test.ts \
  test/sonder-app.test.ts \
  test/telegram-transport.test.ts \
  test/viewer-server.test.ts
```

## Build and local one-shot CLI

```bash
npm run build
node dist/main.js --root ./.sonder-data /save https://example.com '#tag'
node dist/main.js --root ./.sonder-data /list
node dist/main.js --root ./.sonder-data /find "keyword" 5
node dist/main.js --root ./.sonder-data /ask ITEM_ID "question"
```

## Environment variables

- `SONDER_TELEGRAM_BOT_TOKEN`
- `SONDER_TELEGRAM_PROXY` (optional)
- `SONDER_VIEWER_PORT` (optional)
- `SONDER_RESPONDER` (`stub` or `codex`)
- `SONDER_CODEX_TOKEN` (optional when OAuth/session path is not available)
- `SONDER_CODEX_MODEL` (optional)
- `SONDER_CODEX_REASONING` (optional: `minimal|low|medium|high`)
