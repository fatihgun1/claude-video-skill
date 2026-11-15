---
name: cizgi-storyboard
description: Build the storyboard of a Çizgi Stüdyo episode — compile, run the HyperFrames checks, photograph every shot in 16:9 and 9:16 — show the stills to the person and record the storyboard approval gate. Use after the audio step, or after any change to actions, camera, characters or audio.
---

# Storyboard gate

```bash
CLI="node ${CLAUDE_PLUGIN_ROOT}/engine/src/cli.mjs"
$CLI storyboard <bolum.json>              # both formats
$CLI storyboard <bolum.json> --format 16:9
```

The command compiles the episode, runs `hyperframes check` (it must pass) and takes two stills per shot: one while the line is spoken and one in the hold. It prints the contact sheet paths, the profile warnings, and any audio lines that failed their listening check.

## Steps
1. Run `storyboard`. If the check fails, fix the cause in `bolum.json` or the library and run it again. Never edit the generated project in `.cizgi/`; it is rebuilt every time.
2. **Look at every contact sheet yourself** (Read the image) before showing it. Check that:
   - each character is in frame and does the action the script says
   - captions do not cover a face
   - nothing is cut off
   - the 9:16 frame works too
3. **Show the person the contact sheets.** Send the image files so they can see them, list what is in each shot, and repeat any failed audio lines.
4. Ask with **AskUserQuestion**: approve / change something. Changes to action, camera, mark or palette go into `bolum.json`; run `storyboard` again afterwards. A change to the words needs the script gate again (**cizgi-senaryo**), then **cizgi-ses**.
5. Render a draft so the motion can be judged: `$CLI render <bolum.json> --taslak --format 16:9`. Then run `$CLI qa <the draft>` and go through **every** page with the checklist in **cizgi-render** before showing it. Stills alone miss walks, contact and cut problems.
6. **Only after an explicit yes from the person in this conversation**:

   ```bash
   $CLI onayla storyboard <bolum.json>
   ```

   The approval covers the whole episode **and** its audio. Any later change makes it stale and the final render is refused until the person approves again.
7. Continue with **cizgi-render**.
