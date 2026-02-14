# @mariozechner/pi-sonder

Sonder is a Telegram-first conversational personal knowledge system built on pi-mono.

## MVP scope (confirmed)

- Source scope: public web URL only
- Save contract: `/save <url> [#tags...]`
- Ask contract: `/ask <itemId> <question>`
- List contract: `/list`
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

Ask an item (replace `ITEM_ID` with a real ID):

```bash
node dist/main.js --root ./.sonder-data /ask ITEM_ID "what is the main thesis?"
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

If your network requires a proxy:

```bash
SONDER_TELEGRAM_BOT_TOKEN="<bot-token>" SONDER_TELEGRAM_PROXY="http://127.0.0.1:7890" SONDER_RESPONDER=codex npx tsx src/main.ts --telegram --root ./.sonder-data
```
