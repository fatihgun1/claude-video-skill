---
name: cizgi-render
description: Render the final MP4s (16:9 YouTube, 9:16 Reels/Shorts) of a Çizgi Stüdyo episode whose storyboard is approved, verify the files and deliver them. Use when the person wants the finished video, or a draft render to preview motion.
---

# Render

```bash
CLI="node ${CLAUDE_PLUGIN_ROOT}/engine/src/cli.mjs"
$CLI render <bolum.json>                    # final, both formats (needs storyboard approval)
$CLI render <bolum.json> --format 9:16      # final, one format
$CLI render <bolum.json> --taslak           # draft quality, always allowed
```

Output files: `cikti/<episode>-16x9.mp4` and `cikti/<episode>-9x16.mp4`. Drafts get a `-taslak` suffix.

A final render is refused when the storyboard is not approved or the episode changed since the approval. In that case go back to **cizgi-storyboard**. Never run `onayla` yourself to get past the gate.

Rendering takes about a minute per format for a one-minute episode. Run it in the background when it is longer.

## Watch the rendered video before anyone else does (mandatory)
Stills of the composition do not show motion, cuts or contact. They have let through:
- side-stepping walks
- hands passing through objects
- objects shaking in a hand
- faces cut off at the edge of the frame

For **every** video you are about to show, draft or final:

```bash
$CLI qa cikti/<episode>-16x9.mp4      # 4 frames per second, pages of 24
```

Open every page and check each item. Write down what you see for each shot.

| Check | Fails when |
|---|---|
| Walks | Legs cross or scissor, feet slide, a back or front view moves sideways, nobody steps |
| Contact | A hand is in front of or inside an object before it closes; a held object floats away from the fingers |
| Hands | The wrist is bent more than about 50°; the fingers do not wrap the object; an object turns or shakes without a reason in the script |
| Joints | An elbow or knee bends the wrong way, or looks broken |
| Cuts | Action jumps between shots (walking, then suddenly standing); the screen direction flips |
| Framing | The subject or the thing they look at is cut by the frame; large dead space around a close-up |
| Faces | Eyes look away from what the character attends to; features overlap oddly (an eye merging into the nose) |
| Timing | A shot holds with nothing happening; an insert ends after its object has left the frame |

Fix the cause in the library or episode, render again and run `qa` again. Show the video only when every page passes, and tell the person which checks you ran.

## Verify before delivering
For each file, check duration, resolution and that an audio stream exists:

```bash
ffprobe -v error -show_entries format=duration:stream=codec_type,width,height -of compact <file>
```

The duration should match `durum`/`timing.json`.

## Deliver
- the file paths
- duration and resolution
- the profile used, plus any lines that were accepted despite a failed listening check
- for ages 0-3 (`pedagoji-0-3`), remind the person to add the screen-time note to the video description; it is in the **cizgi-pedagoji-0-3** skill
