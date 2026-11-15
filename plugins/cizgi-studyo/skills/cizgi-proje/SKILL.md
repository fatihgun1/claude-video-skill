---
name: cizgi-proje
description: Start a new cartoon episode with the Çizgi Stüdyo engine — create the episode folder and a draft bolum.json that only uses library assets, then hand over to cizgi-senaryo. Use when the user wants a new cartoon, animation, çizgi film or bölüm.
---

# Start an episode

Çizgi Stüdyo makes 2D cartoons in which **the person stays in control**. You draft, they approve. The engine refuses anything that is not in the asset library and refuses each stage until the previous one is approved.

Engine CLI (Node ≥ 20). Every command prints JSON:

```bash
node "${CLAUDE_PLUGIN_ROOT}/engine/src/cli.mjs" <command> ...
```

The first time, if `${CLAUDE_PLUGIN_ROOT}/engine/node_modules` is missing, run `npm install --prefix "${CLAUDE_PLUGIN_ROOT}/engine"`.

## Steps

1. **Ask only what you cannot infer**: the topic or story, and the audience. For ages 0-3 use `"profile": "pedagoji-0-3"` and also follow the `cizgi-pedagoji-0-3` skill. Otherwise use `"genel"`.
2. **Read the library** before writing anything. Everything an episode may use is a file:
   - characters: `${CLAUDE_PLUGIN_ROOT}/library/characters/<id>/`. `character.json` lists the recolourable `palette_vars`.
   - actions: `library/actions/<id>.json`
   - backgrounds: `library/backgrounds/<id>.svg`
   - camera framings and moves: `library/cameras.json`
   - marks (`sol`, `orta`, `sag`): `library/world.json`
   - profiles: `library/profiles/<id>.json`
3. **Create the folder** `bolumler/<episode-id>/` in the user's project (kebab-case, ASCII). Write `bolum.json` following `${CLAUDE_PLUGIN_ROOT}/engine/src/schema/episode.schema.json`. Shape:

   ```json
   {
     "episode": "minik-ayi-alkis", "title": "…", "language": "tr", "profile": "pedagoji-0-3",
     "characters": [{ "id": "pamuk", "name": "Pamuk", "rig": "test-ayi", "palette": { "accent": "#7fb3e6" } }],
     "scenes": [{ "scene_id": "s1", "bg": "cayir", "shots": [{
       "shot_id": "s1_sh1",
       "utterances": [{ "speaker": "pamuk", "text": "Merhaba!" }],
       "cast": [{ "id": "pamuk", "action": "selam", "mark": "orta" }],
       "camera": { "framing": "wide", "move": "push_in", "target": "pamuk" },
       "hold": 3 }] }]
   }
   ```

   - Never write times, coordinates or audio paths. Timing comes from the audio and the profile. Audio lands in `ses/<shot_id>-<n>.wav`.
   - `speaker` is a cast member of that shot or `anlatici` (the narrator).
   - If the story needs something the library lacks (a new action, background or character), **do not invent it**. Use the closest existing asset and add an entry to `new_assets` with a note, then tell the person what is missing.
4. **Validate**: `cli.mjs dogrula bolumler/<id>/bolum.json`. Fix every error. Keep the warnings for the person to see at the script gate.
5. Continue with **cizgi-senaryo** to show the script and get the first approval.

`cli.mjs durum <bolum.json>` tells you at any time which gate is open and what the next step is. When unsure, run it.
