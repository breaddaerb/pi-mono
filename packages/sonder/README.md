# @mariozechner/pi-sonder

Sonder is a Telegram-first conversational personal knowledge system built on pi-mono.

## MVP scope (confirmed)

- Source scope: public web URL only
- Save contract: `/save <url> [#tags...]`
- Ask contract: `/ask <itemId> <question>`
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
npx tsx ../../node_modules/vitest/dist/cli.js --run test/parse-command.test.ts test/storage-smoke.test.ts test/snapshot-service.test.ts test/ask-service.test.ts
```

## Run current version (foundation build)

Build package:

```bash
cd packages/sonder
npm run build
```

Run built CLI entrypoint:

```bash
node dist/main.js
```

Expected output at current stage:

```text
sonder: foundation scaffold ready
```
