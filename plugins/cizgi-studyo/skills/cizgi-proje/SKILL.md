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

1. **Ask only what you cannot infer**: the topic or story, and the audience. For ages 0-3 use `"profile": "pedagoji-0-3"` and also follow the `cizgi-pedagoji-0-3` skill. Otherwise use `"genel"`. When the story is still taking shape, shape it scene by scene as story cards first (`hikaye.json` next to the episode, a draft: see "Story cards" in the `cizgi-studyo` skill); the person sees and edits them in the panel's **Hikâye** window.
2. **Read the library** before writing anything. Everything an episode may use is a file:
   - characters: `${CLAUDE_PLUGIN_ROOT}/library/characters/<id>/`. `character.json` lists the recolourable `palette_vars`.
   - actions: `library/actions/<id>.json`. Each lists the `views` it is made for. Give a cast member only actions whose `views` include its rig's `view` (`character.json`); `dogrula` warns otherwise. Walk and run actions name the `cast.walk` speed in their notes (e.g. `yuru-cocuk` 144, `kos-cocuk` 230 world units per second). Use it so the feet do not slide.
   - backgrounds: `library/backgrounds/<id>.svg`
   - props: `library/props/<id>.svg`
   - sound effects: `library/sfx/<id>.wav` (sources in `KAYNAKLAR.md`)
   - camera framings and moves: `library/cameras.json`
   - marks (`sol`, `orta`, `sag`): `library/world.json`
   - profiles: `library/profiles/<id>.json`
3. **Create the folder** `bolumler/<episode-id>/` in the user's project (kebab-case, ASCII). Write `bolum.json` following `${CLAUDE_PLUGIN_ROOT}/engine/src/schema/episode.schema.json`. Shape:

   ```json
   {
     "episode": "minik-ayi-alkis", "title": "…", "language": "tr", "profile": "pedagoji-0-3",
     "characters": [{ "id": "pamuk", "name": "Pamuk", "rig": "pamuk", "palette": { "accent": "#7fb3e6" } }],
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
   - A sound effect goes on the shot where it happens: `"sfx": [{ "sfx": "kapi-ac", "at": 0.5, "volume": 0.8 }]`, where `at` is seconds from the start of that shot. Use one only when the picture shows its cause: a door that opens, a foot that lands. Footsteps follow the walk cycle (every half cycle, for example every 0.4 s with `yuru-cocuk`).
   - If the story needs something the library lacks (a new action, background or character), **do not invent it**. Use the closest existing asset and add an entry to `new_assets` with a note, then tell the person what is missing.
4. **Validate**: `cli.mjs dogrula bolumler/<id>/bolum.json`. Fix every error. Keep the warnings for the person to see at the script gate.
5. Continue with **cizgi-senaryo** to show the script and get the first approval.

`cli.mjs durum <bolum.json>` tells you at any time which gate is open and what the next step is. When unsure, run it.
