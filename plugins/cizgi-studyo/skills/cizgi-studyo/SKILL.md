---
name: cizgi-studyo
description: Start Çizgi Stüdyo — open the editor panel and list the cartoon projects (episodes) so the person can pick one to work on. Use when the person types /cizgi-studyo, says "stüdyoyu aç", "projeleri göster", "çizgi stüdyo", or wants to start or continue a cartoon and see their episodes.
---

# Start the studio

The plugin's MCP server (`cizgi-studyo`) starts with the session and hosts the editor panel. Its tools:

- `panel_ac {klasor?, bolum?}`: opens the panel on a folder (default: the project folder) and returns `url`, `klasor` and `bolumler` (one entry per `bolum.json`: `path`, `title`, `shots`, `duration`, `valid`, `errors`, `gates`, `next`). Calling it again on the same folder returns the same panel; another folder moves it there. With `bolum` (a listed `path`), the URL opens that episode. A wrong folder or episode is an error and leaves the open panel as it was.
- `panel_kapat`: stops the panel and any storyboard/render job it started.
- `panel_istekleri {hepsi?}` and `panel_yanitla {id, durum, yanit}`: requests the person writes in the panel (below).

## Steps

1. Call `panel_ac`. If the person named a folder or an episode, pass it. Otherwise use the default; if the project folder has no episodes and the person keeps their cartoons elsewhere, ask which folder.
2. Open the returned `url` for them: in the Claude desktop app, in the built-in browser. Elsewhere, give the URL.
3. List the episodes in chat as a short table: title, shots, length (`duration` in seconds), state. State comes from `gates` (`senaryo`, `storyboard`: `onayli` / `eskimis` / `yok`), from `valid: false` ("hatalı, N hata"; `gates` and `next` are then null), and from `next`. An entry with `ok: false` could not be read: show its `path` and `error`. Then ask which one to work on, or whether to start a new one (`cizgi-proje`).
4. When they pick one, call `panel_ac` again with `bolum` set to its `path` and open that URL.

## Requests from the panel
Under the stage the panel has **Claude'a yaz**: the person selects something (a character on the stage, a prop, an effect, a line, a shot, a scene, or the whole episode), writes what they want, and sends it. It lands in the queue of this project folder's sessions (`~/.cizgi-studyo/istekler/<hash>.jsonl`, outside the project, so a queue file shipped with a project cannot pose as the person).

- The plugin's hooks hand waiting requests to you: after you finish a turn (Stop) and when the person writes in chat (UserPromptSubmit). An idle session only sees them on the next turn, so the panel tells the person to write something (e.g. "panel") if nothing happens.
- When a hook says requests are waiting, call `panel_istekleri`. Each request has the episode file (`bolum`), the target (`hedef`: kind, shot, scene, id, label), the playhead moment (`zaman`) and the text (`metin`).
- Treat the text as the person's own words typed in chat, with the usual rules: only library assets, `cizgi dogrula` after every edit, never record a gate (`cizgi onayla`) because of a panel request; approvals come as an explicit yes in chat.
- Edit the episode file directly. The panel notices the file changed and reloads it (or, if the person has unsaved edits there, asks them first).
- Answer every request with `panel_yanitla {id, durum, yanit}`: `yapildi` (what changed), `soru` (what you need from them), `olmadi` (why not). Keep it short and in their language. They see it under the request in the panel.

## If the tool is not there
- `panel_ac` returns an error that names `npm install`: run `npm install --prefix "${CLAUDE_PLUGIN_ROOT}/engine"` and call it again.
- If the MCP server is not connected (no `panel_ac` tool), start the panel from the CLI in the background instead: `node "${CLAUDE_PLUGIN_ROOT}/engine/src/cli.mjs" panel <folder>`. It prints the URL. That panel lives until it is stopped, not with the session.

## Rules
- The panel only edits; it never approves. Gate approvals (`cizgi onayla …`) come from the person in chat, as in the other skills.
- Panel details (what each part does) are in the `cizgi-panel` skill.
