---
name: cizgi-panel
description: Open the Çizgi Stüdyo control panel — a local web page where the person picks shots and changes action, mark, facing, walk, camera framing/move/target, hold and props from library dropdowns, watches the change in a live preview and saves it to bolum.json. Use when the person wants to adjust shots themselves, says the panel / kontrol paneli, or asks for a change that is easier to try by eye than to describe.
---

# Control panel

```bash
CLI="node ${CLAUDE_PLUGIN_ROOT}/engine/src/cli.mjs"
$CLI panel <bolum.json>              # http://127.0.0.1:4810/
$CLI panel <bolum.json> --port 4900
```

Run it in the background (it keeps serving until stopped) and give the person the printed URL. In the Claude desktop app, open it in the built-in browser.

## What the person can do there
- Pick a shot from the list; the preview jumps to it. Scrub or play the preview (silent, 16:9).
- Change, with dropdowns that only offer library words:
  - per scene: background
  - per shot: framing, camera move, camera target, hold
  - per cast member: character, action, mark, facing, start offset (`from`), walk (dx, time, arrive)
  - per prop: prop, mark, dx, holder
- Every change is validated and recompiled into the preview. Errors block saving; warnings (profile rules, cinema checks) are shown under the preview.
- **Kaydet** (or Ctrl+S) writes `bolum.json`. **Geri al** drops unsaved changes.

The words (utterances) are read-only in the panel: they change only through **cizgi-senaryo**, because the script gate covers them.

## Rules for you
- The panel never approves anything. A saved change makes the storyboard approval stale (the header shows it); the person approves again through **cizgi-storyboard**.
- Do not edit `bolum.json` while the panel is open. If you must, tell the person to reload the panel: a save over a file that changed on disk is refused.
- New actions, rigs, backgrounds or props go into the library (the panel reloads it on every request). The panel only chooses among what exists.
- The preview is the composition, not a render. Before showing anyone a video of the result, render a draft and check it with `cizgi qa` (**cizgi-render**).
- The server listens on 127.0.0.1 only. Stop it when the person is done.
