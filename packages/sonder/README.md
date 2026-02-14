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

Foundation in progress.
