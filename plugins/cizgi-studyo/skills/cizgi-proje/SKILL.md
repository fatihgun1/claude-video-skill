---
name: cizgi-proje
description: Start a new cartoon episode with the Çizgi Stüdyo engine together with the person — open the editor panel first, decide the story, format, 2D/3D, characters, places, sound and every scene with them one question at a time, write bolum.json from library assets only, then hand over to cizgi-senaryo. Use when the user wants a new cartoon, animation, video, çizgi film or bölüm, or tells a story they want made.
---

# Start an episode

Çizgi Stüdyo makes 2D (and, where the library has recipes, 3D) cartoons in which **the person stays in control**. You propose, they choose and approve. The engine refuses anything that is not in the asset library and refuses each stage until the previous one is approved.

Engine CLI (Node ≥ 20). Every command prints JSON:

```bash
node "${CLAUDE_PLUGIN_ROOT}/engine/src/cli.mjs" <command> ...
```

The first time, if `${CLAUDE_PLUGIN_ROOT}/engine/node_modules` is missing, run `npm install --prefix "${CLAUDE_PLUGIN_ROOT}/engine"`.

## Steps

The episode is made **with** the person, step by step, in the editor panel. You never decide a matter of taste for them: you offer choices, they pick. Every question below goes through **AskUserQuestion** with concrete options (the person can always write their own); never put a choice in prose and move on, and never read an answer to one question as the answer to another. Stop after each step and show where it stands in the panel.

1. **Open the panel first**, before any question or drawing, even when the request already tells a story: `panel_ac` (MCP server `cizgi-studyo`; without it, the CLI fallback in the `cizgi-studyo` skill), then open the URL in the built-in browser. Tell the person they will follow and change everything there.
2. **Decide the basics with the person.** Ask, grouped (at most four questions per AskUserQuestion):
   - **The story in their words**: who it is about, what their problem is, what changes, how it ends. If the request is one line, ask for these before drafting anything. Draft a story only when they ask you to, and then offer two or three different directions.
   - **Format** (16:9, 9:16, both), **length**, **audience** (`"profile": "genel"`, or `"pedagoji-0-3"` for ages 0-3, then also follow `cizgi-pedagoji-0-3`).
   - **2D or 3D.** 3D draws the same episode from recipes in `library/3d/karakterler/<rig>.json` and `library/3d/mekanlar/<bg>.json`; say which of their characters and places have none (3D is then not possible for them yet). For 3D also ask the look, `stil3d`: toon, yumusak, pastel, golge.
   - **Characters.** The person names and describes them. **Do not suggest library characters (or any character) they did not ask for**; offer the library's list only when they ask what exists. For each character ask: an existing library drawing, or a new one to draw (step 7).
3. **Story cards and places.** Write `hikaye.json` (see "Story cards" in the `cizgi-studyo` skill): the idea, the audience, the characters, one card per scene. For **each card** ask what happens, who is in it, the feeling and about how long, and the **place**: name the library and project backgrounds (`library/backgrounds`, `<project>/kutuphane/backgrounds`) and ask them to look at the **Mekân** panel; then the **time of day** (`scene.isik`) and any **decor** (`scene.dekor`). A place the library lacks goes to step 7.
4. **Read the library** (reference below) and **create the episode** ("Create the folder" below): one scene per card with its place and light, one shot per scene with its people standing, no lines yet. Validate, then `panel_ac` with `bolum` set to the new file and open that URL. Ask the person to check the scenes and the **Hikâye** window in the panel.
5. **Sound and captions.** Ask: background **music** (a piece from `library/muzik`, which they can play in the **Müzik** panel, or none), **sound effects** (yes/no; only from the library), **captions** (on/off, edged with the speaker's colour). Voices are chosen in **cizgi-ses**.
6. **Build it scene by scene**, in card order. For each scene:
   - Plan the shots with the `cizgi-sinema` skill and show them as a small table (shot, who, action, camera, line).
   - Ask what you cannot know: each character's **action**, from the actions drawn for that character's view (name them; they can hover them in the **Hareket** panel); the **camera** of each shot, framing and move (the **Kamera** panel shows them); the **lines** and who says them; how long each shot holds; any sound effect.
   - Write the scene into `bolum.json`, run `dogrula`, then review it: take its stills (`cli.mjs storyboard <bolum.json> --sahne <id> --format <the episode's format>`), look at every still yourself, and ask the person to look at the scene in the panel (preview, **İncele → Kurallar / Kareler**). Report what you saw and every warning.
   - Ask: next scene, or change something. Move on only on their answer.
7. **Anything missing** (a character, action, place, prop or sound the library lacks, or something the engine cannot show, such as a facial expression outside speech): ask about **each one separately** with these options: draw or add it / use the closest library item (name it) / change the story. Never change the story yourself to avoid a missing item. Write every open item into `new_assets` with a note.
   - A new place or prop: a draft in the project library (see the `cizgi-studyo` skill); the person takes it in from the panel.
   - A new character or action: follow `docs/RIG-SPEC.md` of the repository. Show a concept image first and ask. The project library does not hold characters or actions yet, so adding one writes into the plugin's `library/`, which a plugin update replaces: say so and add it only on an explicit yes.
8. **Validate** the whole episode (`dogrula`, no errors) and continue with **cizgi-senaryo**.

## Library reference and episode format

Read these while working through the steps above.

- **Read the library** before writing anything. Everything an episode may use is a file:
   - characters: `${CLAUDE_PLUGIN_ROOT}/library/characters/<id>/`. `character.json` lists the recolourable `palette_vars`.
   - actions: `library/actions/<id>.json`. Each lists the `views` it is made for. Give a cast member only actions whose `views` include its rig's `view` (`character.json`); `dogrula` warns otherwise. Walk and run actions name the `cast.walk` speed in their notes (e.g. `yuru-cocuk` 144, `kos-cocuk` 230 world units per second). Use it so the feet do not slide.
   - backgrounds: `library/backgrounds/<id>.svg`, or a layered one: `library/backgrounds/<id>/mekan.json` (`{"ad", "katmanlar": [{"id", "dosya", "derinlik"}], "kaybolma"?}`) with one full-frame SVG per layer (viewBox `0 0 1920 1080`, back to front). `derinlik` 0 is the farthest (sky: always seen as drawn), 1 the characters' plane; in between, the layer follows the camera that much (parallax when the camera follows, pans or zooms). A wide, still shot shows every layer as drawn; parts that must meet (a horizon strip and the ground) belong in one layer or at the same depth. A scene can hide, move, scale or tint each layer for itself: `scene.katmanlar = {"<layer>": {"gizli", "dx", "dy", "olcek", "ton"}}` (a one-file background has one layer, `tum`); moving or shrinking a layer can show past its edge, so give such layers a margin outside the frame. Limits: a prop placed in depth (`props[].depth`) stays in the characters' plane (no parallax, drawn over every layer); a dolly scales all layers alike.
   - scene light: `scene.isik = {"saat": "sabah"|"ogle"|"aksam"|"gece", "guc"?: 0..1}`: one colour grade over the scene's whole world (backgrounds, decor, props, characters; captions stay as they are). `ogle` is the drawing as it is; `sabah` a little golden, `aksam` warm orange, `gece` dark blue and greyish; `guc` (default 1) how strongly. It does not change the drawings themselves: lit windows, a lamp's glow, a sun or moon, and shadows are drawn (or a layer is hidden or tinted with `scene.katmanlar`), so a night scene looks best on a background drawn with a night sky or with its sky layer tinted.
   - captions: a line's caption is the line itself, word by word as it is spoken. `utterance.altyazi: false` drops one line's caption; `scene.altyazi = {"konum": "alt"|"ust"|"orta", "boyut": "kucuk"|"orta"|"buyuk"}` places a scene's captions (default: alt in 16:9, ust in 9:16, where a phone's buttons do not cover them; orta size); the episode's `altyazi = {"kapali"?: true, "konusan_rengi"?: true}` turns every caption off, or edges each with its speaker's colour (`characters[].renk`, else a colour by its place in the cast). A bigger caption fits fewer letters in two lines: the panel's review warns.
   - scene decor: `scene.dekor = [{"id", "prop", "x", "back"?, "olcek"?, "ters"?}]`: library props standing in the scene for all its shots (a tree, a bench, a lamp), behind the characters. `x` is the world position (-600..2520; 9:16 pulls it toward the middle as it does the marks), `back` 0..1 puts it further back like `cast.back` (higher, smaller), `olcek` 0.3..3 its size, `ters` mirrors it. Decor stands on the characters' plane: it moves with the ground, not with a far layer. Props for decor need `data-base` only; `data-grip` only on props someone holds (a prop with no grip cannot have a holder).
   - props: `library/props/<id>.svg`
   - sound effects: `library/sfx/<id>.wav` (sources in `KAYNAKLAR.md`), and the project's own `<project>/kutuphane/sfx/<id>.wav`, each written in that folder's `KAYNAKLAR.md` (a missing effect: see "New sound effects" in the `cizgi-studyo` skill; never make one up)
   - camera framings and moves: `library/cameras.json`
   - marks (`sol`, `orta`, `sag`): `library/world.json`
   - profiles: `library/profiles/<id>.json`
- **Create the folder** `bolumler/<episode-id>/` in the user's project (kebab-case, ASCII). Write `bolum.json` following `${CLAUDE_PLUGIN_ROOT}/engine/src/schema/episode.schema.json`. Shape:

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
   - If the story needs something the library lacks (a new action, background or character), **do not invent it**: ask the person about it (step 7).
- **Validate**: `cli.mjs dogrula bolumler/<id>/bolum.json`. Fix every error. Keep the warnings for the person to see at the script gate.

`cli.mjs durum <bolum.json>` tells you at any time which gate is open and what the next step is. When unsure, run it.
