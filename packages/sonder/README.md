# @mariozechner/pi-sonder

Telegram-first conversational PKM for item-anchored thinking.

## What Sonder does

- Saves public web pages as durable local evidence (`snapshot.html + assets`, extracted text, fallback artifact)
- Supports URL + pasted-text fallback evidence when source fetch is blocked/login-required
- Generates deterministic canonical markdown per item as the stable read model for rendering/anchoring
- Lets you annotate canonical markdown content in a local viewer (highlight / underline / note)
- Runs multi-turn dialogue anchored to an item (citations are optional, not forced)
- Persists dialogue sessions and active chat mode in SQLite (restart-safe)
- Supports discovery via `/list` and `/find` with Telegram buttons (no ID-centric UX)

> **Sonder is not a tool for storing ideas. It is a space for entering into them.**

## Scope (current MVP)

- Source: public web URLs only
- Interface: Telegram-first + local viewer
- Model path: Codex/OpenAI responder path
- Storage: SQLite + local artifact files
- Retrieval: keyword-first (non-embedding)

## Source support matrix (current)

| Source | Direct capture quality | Typical status | Notes |
| --- | --- | --- | --- |
| arXiv | High | `ok` | HTML pages usually capture cleanly |
| Generic web | Medium | `ok` / `blocked` | Varies by site structure and anti-bot policy |
| Xiaohongshu | Medium | `ok` / `login_required` / `blocked` | Uses retrieval-time boilerplate cleanup (incl. common filing/license noise); when blocked but extractable, Sonder may auto-derive cleaned evidence via pasted-evidence path |
| WeChat article | Low-Medium | `risk_control` / `login_required` (common) | Verification walls are common; Sonder uses browser-like request fingerprints + redirect tracing, but risk-control pages still occur; prefer pasted evidence when blocked |
| X/Twitter | Low-Medium | `login_required` / `unsupported` / `error` (common) | Login-gated pages are common; low-signal direct captures are treated as unusable and trigger `reader_proxy` fallback. Pasted evidence path is supported. Text-bridge URLs returning `text/plain` (e.g. `r.jina.ai/...`) are accepted as direct text evidence when content is usable. |

When status indicates the link is not usable, Sonder asks for pasted evidence unless it can auto-derive usable cleaned evidence (currently for some Xiaohongshu pages).

### Acquisition policy (important)

- Sonder always tries `direct_fetch` first.
- For WeChat only, if direct fetch is non-OK, Sonder automatically tries `browser_fetch` (Playwright-backed, auto-detects local Chrome/Chromium; configurable via env) before proxy fallback.
- If direct fetch (or optional browser fetch) is non-OK (for example `risk_control`, `login_required`, `forbidden`, `unsupported`), Sonder automatically tries `reader_proxy` via `https://r.jina.ai/<url>`.
- If all attempts fail, Sonder falls back to pasted-evidence flow (`/save <url> <pasted text>`).

URL/provenance behavior:
- `item.originalUrl` remains the original URL you sent.
- Proxy URLs are not stored as the canonical item URL.
- Acquisition attempts/winner are recorded in `acquisition-report.json` artifact for audit/debug.

Source-specific summary:
- Generic web / Substack-like pages:
  - `direct_fetch` first
  - then `reader_proxy` fallback on non-OK outcomes
- X/Twitter:
  - `direct_fetch` first (login-wall heuristics applied)
  - then `reader_proxy` fallback when direct is non-OK
- WeChat:
  - `direct_fetch` first with WeChat-specific browser-like profile, redirect tracing, cookie carry-over, and one profile retry
  - automatic `browser_fetch` fallback (Playwright-backed browser render)
  - if still non-OK (for example `risk_control`), then `reader_proxy` fallback
- Xiaohongshu:
  - `direct_fetch` first with boilerplate quality checks
  - optional auto-derived cleaned evidence path
  - `reader_proxy` fallback for non-OK direct outcomes

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
SONDER_AUTH_ENCRYPTION_KEY="<stable-secret>" \
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
/save <url> [#tags...] [pasted evidence text]
/find <query> [limit]
/list [limit]
/auth login <domain>
/auth done <domain>
/auth logout <domain>
/open [itemId]
/sessions
/history
/context
/where
/models
/exit
```

Tip: if Telegram sends `/save` immediately from command suggestions, Sonder will keep a pending save input state and prompt for the next message. Send the URL (and optional tags/text) in that next message.

### Compatibility commands

```text
/ask <itemId> <question>   # compatibility fallback; deprecated in Telegram UX
/resume <sessionId>
/history <sessionId>
/annotate <itemId> <text> [#tags...]
/ann list <itemId>
/ann del <annotationId>
```

Telegram startup behavior:
- Sonder registers slash-command suggestions via Telegram `setMyCommands` (`/save`, `/auth`, `/find`, `/list`, `/open`, `/sessions`, `/history`, `/context`, `/where`, `/models`, `/exit`).

### Auth commands (login-gated sources)

```text
/auth login <domain>      # opens headed browser locally for manual login
/auth done <domain>       # capture storage state and persist encrypted auth session
/auth cancel <domain>     # abort pending login flow
/auth status <domain>
/auth list [limit]
/auth logout <domain>
/auth login-file <domain> <storageStatePath>   # headless/server fallback
```

Notes:
- `/auth login ...` opens a browser on the machine running Sonder (Telegram bot host).
- After manual login in that browser, run `/auth done ...`.
- `/save <login-gated-url>` then automatically tries `auth_browser_fetch` when needed.

## Interaction map (recommended)

### A) Save and continue immediately

1. `/save <url> #tags`
2. If capture succeeds, Sonder auto-enters item mode for the new item
3. Send plain text questions directly
4. `/exit` when done

### B) Save blocked sources with pasted evidence (Telegram)

If a source blocks server fetch (for example login/verification walls), send either:

```text
/save <url> <pasted text evidence>
```

or a plain message:

```text
<url> <pasted text evidence>
```

(URL and pasted text can also be split by newline).

Behavior:
- Sonder stores pasted text as evidence (`evidence.md` + extracted text)
- Viewer prefers pasted evidence content when available
- Opens item mode immediately when pasted evidence is present
- For non-OK direct acquisition outcomes (for WeChat, after automatic browser fallback), Sonder tries a `reader_proxy` fallback (`https://r.jina.ai/<url>`) before requiring pasted evidence
- For some XHS pages classified as noisy/blocked, Sonder can auto-derive cleaned evidence text and route it through the same evidence path
- If no usable evidence is available after fallback attempts, Sonder saves fallback metadata and asks you to re-send with pasted text

### C) Discover first, then open

1. `/find <query>` or `/list`
2. Use buttons (`Time`, `Source`, `Tag`, `Sort`, `Clear`, `Prev`, `Next`)
3. Tap `N Open` on a result row (or `N Delete` to remove it)
4. You enter item mode

### D) Session behavior and defaults (important)

- Opening an item (`/open <itemId>` or button `Open`) uses this default:
  - **resume latest existing session** for that item if one exists
  - otherwise **create a new session**
- To override this behavior explicitly:
  - run `/sessions` in item mode
  - choose `Resume` for a listed session, or `New Session`

### E) Model selection (Codex mode)

- `/models` shows available Codex models and current active model
- use inline `N Use` buttons to switch model
- selection applies to subsequent dialogue turns in current runtime
- default selection prefers `gpt-5.2` when available (fallback: first available Codex model)
- override default with `SONDER_CODEX_MODEL`

### F) General chat mode

- `/open` (without itemId) starts general chat mode
- each `/open` call creates a new general session
- general-mode history is intentionally bounded in `TelegramChatModeStore`:
  - `MAX_GENERAL_HISTORY_ENTRIES = 24`
  - `MAX_GENERAL_HISTORY_CHARACTERS = 12_000`
- these limits apply only to Telegram general mode (`/open` without itemId)
- item dialogue turns are persisted separately in `dialogue_turns` and are not capped by these general-mode limits

In item mode, action panel supports: `Open Viewer | Delete Item | Exit`.

### H) Context control (detach-first MVP)

- Use `/context` (in item mode) or reply quick actions on assistant answers:
  - `Open Context Panel`
  - `Detach last turn`
- Context panel allows per-turn state toggles:
  - `Detach` (exclude from next-round model context)
  - `Re-attach` (include again)
- Context state is session-scoped and restart-safe.
- User-visible history stays complete; context control only changes what is projected into the next model call.
- Panel tool `Show ctx dump` prints included/excluded turn reasons and compiled preview text.

### Context budget defaults (item dialogue)

- Canonical-markdown context included in ask prompts is bounded by:
  - `DEFAULT_MAX_EXTRACTED_TEXT_CHARACTERS = 50_000`
- This is configurable at runtime in code via `AskServiceOptions.maxExtractedTextCharacters`
  (or direct `buildAskContext(..., maxExtractedTextCharacters)` usage).

### G) Viewer loop

1. In item mode, tap `Open Viewer`
2. Select text in canonical markdown content
3. Create highlight / underline; use each annotation card's inline note editor (`Add note` / `Edit note`)
4. Ask follow-up questions in Telegram plain text

Viewer note: viewer rendering uses stored canonical markdown (`item_contents.canonical_md`) as the single read surface for annotation and display.

Time display note:
- Telegram and viewer UI timestamps are formatted in `Asia/Shanghai` (`UTC+8`) for consistent daily usage.
- Persisted storage timestamps remain UTC ISO strings.

## Additional technical docs

- Maintainer walkthrough: `packages/sonder/project.md`
- Runtime/persistence data flow: `packages/sonder/data-flow.md`

## Discovery UX details

- `/find` and `/list` are rendered as index-based rows with inline `Open` buttons
- `/history` includes per-turn `Full` buttons to view untruncated turn content
- Internal item IDs are hidden in Telegram discovery output
- `/find` in Telegram without a query falls back to browse mode (`/list` behavior)
- `/find` result rows include weighted `reasons` + short `match` snippets
- Stale callback actions show recovery guidance
- Save responses include source diagnostics (`platform + status + reason`)

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
- `SONDER_WECHAT_BROWSER_EXECUTABLE_PATH` (optional: override auto-detected Chromium/Chrome executable path for WeChat browser fallback)
- `SONDER_WECHAT_BROWSER_TIMEOUT_MS` (optional: navigation timeout for WeChat browser fallback; default `12000`)
- `SONDER_AUTH_ENCRYPTION_KEY` (optional but required to enable auth sessions)
- `SONDER_AUTH_STATE_DIR` (optional: encrypted auth-state file directory)
- `SONDER_AUTH_BROWSER_EXECUTABLE_PATH` (optional: executable path for `/auth login` browser)
