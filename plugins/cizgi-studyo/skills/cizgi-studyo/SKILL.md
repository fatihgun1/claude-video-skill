---
name: cizgi-studyo
description: Start Çizgi Stüdyo — open the editor panel and list the cartoon projects (episodes) so the person can pick one to work on. Use when the person types /cizgi-studyo, says "stüdyoyu aç", "projeleri göster", "çizgi stüdyo", or wants to start or continue a cartoon and see their episodes.
---

# Start the studio

The plugin's MCP server (`cizgi-studyo`) starts with the session and hosts the editor panel. Its tools:

- `panel_ac {klasor?, bolum?}`: opens the panel on a folder (default: the project folder) and returns `url`, `klasor` and `bolumler` (one entry per `bolum.json`: `path`, `title`, `shots`, `duration`, `valid`, `errors`, `gates`, `next`). Calling it again on the same folder returns the same panel; another folder moves it there. With `bolum` (a listed `path`), the URL opens that episode. A wrong folder or episode is an error and leaves the open panel as it was.
- `panel_kapat`: stops the panel and any storyboard/render job it started.

## Steps

1. Call `panel_ac`. If the person named a folder or an episode, pass it. Otherwise use the default; if the project folder has no episodes and the person keeps their cartoons elsewhere, ask which folder.
2. Open the returned `url` for them: in the Claude desktop app, in the built-in browser. Elsewhere, give the URL.
3. List the episodes in chat as a short table: title, shots, length (`duration` in seconds), state. State comes from `gates` (`senaryo`, `storyboard`: `onayli` / `eskimis` / `yok`), from `valid: false` ("hatalı, N hata"; `gates` and `next` are then null), and from `next`. An entry with `ok: false` could not be read: show its `path` and `error`. Then ask which one to work on, or whether to start a new one (`cizgi-proje`).
4. When they pick one, call `panel_ac` again with `bolum` set to its `path` and open that URL.

## If the tool is not there
- `panel_ac` returns an error that names `npm install`: run `npm install --prefix "${CLAUDE_PLUGIN_ROOT}/engine"` and call it again.
- If the MCP server is not connected (no `panel_ac` tool), start the panel from the CLI in the background instead: `node "${CLAUDE_PLUGIN_ROOT}/engine/src/cli.mjs" panel <folder>`. It prints the URL. That panel lives until it is stopped, not with the session.

## Rules
- The panel only edits; it never approves. Gate approvals (`cizgi onayla …`) come from the person in chat, as in the other skills.
- Panel details (what each part does) are in the `cizgi-panel` skill.
