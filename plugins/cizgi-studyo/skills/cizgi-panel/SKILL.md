---
name: cizgi-panel
description: Open the Çizgi Stüdyo editor panel — a local web page laid out like a video editor (library on the left, stage in the middle, properties on the right, shot strip at the bottom) where the person picks characters, actions, places, props, sounds and camera shots from visual cards, sees the change in a live preview and saves it to bolum.json. Use when the person wants to adjust shots themselves, says the panel / editör / kontrol paneli, or asks for a change that is easier to try by eye than to describe.
---

# Editor panel

In a Claude session, open it with the `panel_ac` tool of the plugin's `cizgi-studyo` MCP server (see the `cizgi-studyo` skill): that panel lives as long as the session. The CLI below starts one that lives until it is stopped.

```bash
CLI="node ${CLAUDE_PLUGIN_ROOT}/engine/src/cli.mjs"
$CLI panel <klasör>                  # every bolum.json under the folder; http://127.0.0.1:4810/
$CLI panel <bolum.json>              # that episode's folder, with that episode open
$CLI panel <klasör> --port 4900
```

Open the project root (the folder holding `ornekler/` and `bolumler/`) when the person works on several episodes: the panel then lists them all and switches between them without a restart. Run it in the background (it keeps serving until stopped) and give the person the printed URL. In the Claude desktop app, open it in the built-in browser. The layout needs a window at least 1180 px wide; narrower windows stack the panes.

## What the person can do there
- **Left pane: Proje | Kütüphane** (the choice is remembered in the browser).
  - **Proje** is the project tree: every episode in the folder; the open one lists its scenes (background thumbnail, name, shot count, length, error count) and their shots.
    - A shot row selects the shot.
    - Drag a shot row onto another shot or onto a scene's header to move it there; Alt+↑/↓ does the same from the keyboard and crosses into the next scene at the edge. A scene keeps at least one shot. A shot that moves to another scene plays in that scene's place (background).
    - The selected scene has **Adlandır** (a working name, `scene.title`, not in the film; double-click the name too), **↑ / ↓** (scene order) and **Sil** (the scene with its shots; an episode keeps one scene). **+ Sahne** adds a scene after the selected one: same place, the people of its last shot standing, no lines.
    - Another episode opens with a click (unsaved edits are asked about first).
  - **Kütüphane** holds the library cards described below.
- **Claude'a yaz** (under the stage): pick the target (the selected character, prop, effect or line; its shot; its scene; the whole episode), write a request, send (Ctrl+Enter). It goes to the Claude session that opened the panel (see the `cizgi-studyo` skill); its state (sırada, Claude'a iletildi, Claude üzerinde çalışıyor, yapıldı, Claude soruyor, olmadı) and Claude's answer show below it. A panel started from the command line has no session and says so. When bolum.json changes on disk, the panel reloads it; with unsaved edits it asks first.
- **Timeline: Sahne | Bölüm**. Sahne shows only the selected shot's scene (the ruler still reads film seconds); Bölüm shows the whole episode.
- Script approval: moving or reordering shots or scenes changes the shot order, so the senaryo approval goes stale after saving (as with adding or deleting shots). A scene name does not.
- **Bölümler** (the episode name in the top bar): a card per `bolum.json` in the folder with its background, title, shot count, length and approval state. A click opens it; with unsaved changes the panel asks first. **Yeni bölüm** asks for a title and an id and writes `bolumler/<id>/bolum.json` from a minimal valid template (one scene, one shot, Ela standing in the park); it never overwrites. The open episode stays in the address (`#b=…`), so a reload keeps it.
- **Timeline** (bottom): a ruler with scene marks and these tracks.
  - **Shot:** one block per shot, as wide as it lasts, with its background as the picture and a red badge when it has errors. Click to select; drag the block to reorder it within its scene; drag its right edge to change `hold` (it stops where the lines end). **+ Shot** adds a shot after the selected one with the same people standing; **Çoğalt** (Ctrl+D) copies it without its lines; **Sil** (Delete) removes it (a scene keeps at least one shot).
  - **One track per character:** their actions in each shot as clips (a one-off action shorter than its clip holds its last pose; the dark bar is the action itself). Click a clip to select it; drag its left edge to change when it starts. If that is where a walk stops, the walk stops there too at the same speed (`walk.time` and `walk.dx` follow), so the feet do not slide. In the Hareket tab, a card click replaces the selected action; **+ Ekle** starts that action at the playhead (stored as `cast[].actions: [{action, at}]` after the member's own `action`). Delete removes the selected action.
  - **Replik:** the lines where they are spoken, coloured by speaker. The words are read-only; drag a line later to add a pause before it (`utterance.delay`). A line that failed its listening check and was not accepted has a red dashed outline. Select one to set its loudness (`utterance.volume`), listen to it, and read its listening check.
  - **Efekt:** the sound effects; drag one sideways to change its `at` (within its shot). The dark bar is the sound's real length.
  - **Müzik:** the background music as its loudness curve (fades, and the dips under the lines). Click it, or **Mikser**, for track levels (`mix.lines`, `mix.sfx`) and the music (`music`: track, level, fade in/out, level while speaking, loop). Music is chosen in the Ses tab (**Kullan**) from `library/muzik`.
  - **M / S** next to Replik, Efekt and Müzik mute a track or play it alone in the preview (listening only, not saved).
  - Click or drag the ruler to move the playhead.
- **Stage** (middle): the compiled preview with sound: lines and effects play in step with the picture (🔊 mutes). Space plays/pauses; ←/→ step one frame, Shift+←/→ one second.
  - When paused inside the selected shot, every cast member and prop has a frame. Click selects it. Drag sideways to move it: it lands on the nearest free mark (sol / orta / sağ) when close, otherwise off it by `dx` (stored as `cast[].dx` / `props[].dx`). Drag a character up to put it further back (higher and smaller, behind the others; `cast[].back` 0..1), down to bring it to the front; with the frame focused, ←/→ and ↑/↓ do the same in small steps. ⇆ turns the selected character around. A walking character shows its path as an arrow; drag the free end to change `walk.dx`.
  - **16:9 / 9:16** compiles the preview for that frame (the episode does not change). **Güvenli alan** shows the action and title safe areas and the caption zone. **Katmanlar** hides background, characters, props or captions in the preview only.
- **Undo** ↶ / **redo** ↷ (Ctrl+Z, Ctrl+Y or Ctrl+Shift+Z) step through every change since the episode was opened.
- **Library** (left), one tab per kind. A click applies to the selection:
  - **Karakter:** cards with the drawing; the views of one person sit together. With a cast member selected, a click swaps them; with nothing selected, it adds the character to the shot.
  - **Hareket:** only the actions drawn for the selected (or the only) cast member's view; hovering plays the action with that character. Actions that break that character's joint limits are dimmed and say why.
  - **Mekân:** background pictures; a click changes the scene's background (every shot of that scene).
  - **Nesne:** a click swaps the selected prop or adds a new one.
  - **Ses:** ▶ plays the effect; **+ Ekle** adds it to the shot at the playhead.
  - **Kamera:** framing diagrams and move diagrams; a click sets the shot's camera.
- **Properties** (right): camera, hold, and one row per cast member, prop and sound effect. Clicking a row opens its details (mark, facing, walk, time, volume…); **Sil** removes it.
- Every change is validated and recompiled into the preview. Errors block saving; messages that name a shot are links to it.
- **Kaydet** (or Ctrl+S) writes `bolum.json`. **Hepsini at** drops all unsaved changes (itself undoable).
- **Production** (the step chips in the top bar: Senaryo, Ses n/m, Storyboard, Render; click one): the state of each step and what to ask for. On the saved file, when the script is approved and every line has audio, the person can start **Storyboard karelerini al** and **Taslak video çıkar** (they run `cizgi storyboard` / `cizgi render --taslak` in the background) and see the contact sheets and draft videos there. Approvals are never given in the panel.
- **Problems:** a shot with warnings has a yellow count on the timeline, with errors a red one. Its messages are listed at the top of the properties, and the row they are about (cast member, prop, effect, line) has a "!"; clicking a message opens that row.
- **Colours:** a cast member's details have a colour picker for every colour its rig lets an episode change (`characters[].palette`); they apply in every shot.

Lines can be edited, added and deleted in the panel (a line's details and the form under the lines). When the script is approved, the person must first tick that they know the approval will drop: the script then has to be approved again (**cizgi-senaryo**) and the changed lines spoken again (**cizgi-ses**). Until then the preview plays a new line silent with a guessed length and a changed line with its old recording; a render always needs the real audio. The script approval also covers the shot list too, so adding, copying, deleting or reordering shots makes it stale after saving; the person approves the script again through **cizgi-senaryo**.

## Rules for you
- The panel never approves anything. A saved change makes the storyboard approval stale (the top bar shows it); the person approves again through **cizgi-storyboard**.
- Do not edit `bolum.json` while the panel is open. If you must, tell the person to reload the panel: a save over a file that changed on disk is refused.
- New actions, rigs, backgrounds, props or sounds go into the library (the panel reloads it on every request). The panel only chooses among what exists.
- The preview is the composition, not a render. Before showing anyone a video of the result, render a draft and check it with `cizgi qa` (**cizgi-render**).
- The server listens on 127.0.0.1 only. Stop it when the person is done.
