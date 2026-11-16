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

The episode is made **with** the person, step by step, in the editor panel. You never decide a matter of taste for them: you offer choices, they pick.

**Ask in the panel, not in chat.** Every choice below goes to the person with the MCP tool `panel_sor`: one question, concrete options as cards (with a picture when there is one: a library drawing `/kutuphane/<karakter|mekan|nesne>/<id>.svg`, a draft `/kutuphane-taslak/…/<id>.svg`, or a concept sketch `/kutuphane-taslak/konsept/<id>.svg`), the person can always write their own. It waits for the answer. Use AskUserQuestion only when `panel_sor` is not available (no MCP server, no open panel). Never put a choice in prose and move on, and never read an answer to one question as the answer to another.

**Show, do not direct.** When the person should look at or act on something in the panel (a scene, a shot, drafts waiting to be taken in), move the panel there yourself with `panel_git` (`bolum`, `sekme`, `shot`, `kaydir: "taslaklar"`, `vurgula: "Kütüphaneye al"`) instead of telling them where to click. **Every picture is shown in the panel**: never open a drawing in a separate browser tab or by a `file://` address.

**Show longer jobs as a wizard.** For a job of several steps (a new character, place or prop; building the scenes), start a wizard in the panel with `panel_adim` (`sihirbaz: {baslik, adimlar}`) and move it on yourself as you work: `adim` + `durum` (`calisiyor` while you work, `bekliyor` when the person must act, `bitti`, `hata`), a short `aciklama`, and the drawings to look at in `gorsel`. A `panel_sor` question shows inside the wizard; a `panel_git` to a button makes the wizard small so the person sees it. Close it with `kapat` when the job is done.

**Ask few questions.** Group what belongs together, ask only what you cannot reasonably propose, and once the person accepts a plan, carry it out: apply your proposal in the panel, say in one line what you did, and let them change it there.

1. **Open the panel first**, before any question or drawing, even when the request already tells a story: `panel_ac` (MCP server `cizgi-studyo`; without it, the CLI fallback in the `cizgi-studyo` skill), then open the URL in the built-in browser.
   - **Prefer the project wizard.** For a new episode, `panel_git {sekme: "projeler", vurgula: "+ Yeni bölüm"}` and tell the person in one line to collect their wishes there (story, format, 2D/3D, characters, scenes with places and props, sound); it saves them to `bolumler/<id>/hikaye.json`. Wait for its "Oluştur" request instead of asking the same things in chat.
   - **A request "Proje sihirbazından"** (panel request after Oluştur, or after "Bölümü düzenle" for an existing episode): read `bolumler/<id>/hikaye.json` and treat every filled wish as decided; do not ask it again. Ask (panel_sor) only what is missing or unclear. Then carry it out with a `panel_adim` wizard (e.g. Karakterler → Mekânlar ve nesneler → Sahneler → Kararlar → Senaryo): characters with no `rig` and places or props written in words are new drawings (step 7); map the wishes into `bolum.json`: `istekler.format` → `format`; `boyut` → `kararlar.boyut` (+ `stil3d`); `muzik` "yok" → `kararlar.muzik: "yok"`, a track → `kararlar.muzik: "var"` + `music.track`; `efekt` true/false → `kararlar.efekt` var/yok; `altyazi` yok → `kararlar.altyazi: "yok"` + `altyazi.kapali`, var → `"var"`, renkli → `"var"` + `altyazi.konusan_rengi`; each card → one scene (`bg` from `mekan`, `isik.saat` from `saat`, its props as decor or held props), and write the scene id back into the card (`sahne`). For an existing episode change only what the wishes changed. Answer the request with `panel_yanitla`.
   - Without the wizard (the person keeps talking in chat), follow steps 2-8 below.
2. **Decide the basics with the person.** Ask one `panel_sor` per topic:
   - **The story in their words**: who it is about, what their problem is, what changes, how it ends. If the request is one line, ask for these before drafting anything. Draft a story only when they ask you to, and then offer two or three different directions.
   - **Format** (16:9, 9:16, both), **length**, **audience** (`"profile": "genel"`, or `"pedagoji-0-3"` for ages 0-3, then also follow `cizgi-pedagoji-0-3`).
   - **2D or 3D.** 3D draws the same episode from recipes in `library/3d/karakterler/<rig>.json` and `library/3d/mekanlar/<bg>.json`; say which of their characters and places have none (3D is then not possible for them yet). For 3D also ask the look, `stil3d`: toon, yumusak, pastel, golge.
   - Record each answer in `bolum.json` as soon as it exists (step 4): `format`, `kararlar.boyut` (`2b`/`3b`) and, for 3D, `stil3d`.
   - **Characters.** The person names and describes them. **Do not suggest library characters (or any character) they did not ask for**; offer the library's list only when they ask what exists. For each character ask: an existing library drawing, or a new one to draw (step 7).
3. **Story cards and places.** Write `hikaye.json` (see "Story cards" in the `cizgi-studyo` skill): the idea, the audience, the characters, one card per scene. For **each card** ask what happens, who is in it, the feeling and about how long, and the **place**: name the library and project backgrounds (`library/backgrounds`, `<project>/kutuphane/backgrounds`) and ask them to look at the **Mekân** panel; then the **time of day** (`scene.isik`) and any **decor** (`scene.dekor`). A place the library lacks goes to step 7.
4. **Read the library** (reference below) and **create the episode** ("Create the folder" below): one scene per card with its place and light, one shot per scene with its people standing, no lines yet. Validate, then `panel_ac` with `bolum` set to the new file and open that URL. Ask the person to check the scenes and the **Hikâye** window in the panel.
5. **Sound and captions.** Ask: background **music** (a piece from `library/muzik`, which they can play in the **Müzik** panel, or none), **sound effects** (yes/no; only from the library), **captions** (on/off, edged with the speaker's colour). Record them: `kararlar.muzik`, `kararlar.efekt`, `kararlar.altyazi` (`var`/`yok`), with `music` and `altyazi` set to match. Voices are chosen in **cizgi-ses**.
6. **Build it scene by scene**, in card order. For each scene:
   - Plan the shots with the `cizgi-sinema` skill: each character's **action** (only actions drawn for that character's view), the **camera** (framing and move), the **lines**, the hold and any sound effect. Do not ask about each of these: propose the whole scene.
   - Write the scene into `bolum.json`, run `dogrula`, take its stills (`cli.mjs storyboard <bolum.json> --sahne <id> --format <the episode's format>`) and look at every still yourself. Fix what is plainly wrong (out of frame, a prop held wrong) before showing it.
   - `panel_git` to the scene's first shot, say in a few lines what you put there (shots, lines, camera) and what you noticed, then one `panel_sor`: "Sahne uygun mu?" with options such as "Uygun, sıradaki sahne" / "Değiştireceğim (panelde)" / a concrete alternative you would suggest. Ask about a single detail (a line, an action) only when you truly cannot choose. Move on only on their answer.
7. **Anything missing** (a character, action, place, prop or sound the library lacks, or something the engine cannot show, such as an expression other than a smile: angry, crying, surprised): ask about **each one separately** with these options: draw or add it / use the closest library item (name it) / change the story. Never change the story yourself to avoid a missing item. Write every open item into `new_assets` with a note.
   - A new place or prop: a draft in the project library (see the `cizgi-studyo` skill); the person takes it in from the panel.
   - A new character: `panel_adim` wizard with the steps Bilgiler → Konsept → Görünüşler → Kütüphaneye al → Bölüme ekle. Draw a concept sketch first (`<project>/kutuphane/taslak/konsept/<id>.svg`, plain SVG) and show it with `panel_sor` (the sketch as the picture of an option card, with the views the shots need). On a yes, draw it as a draft in the project library ("Drawing new drawings" in the `cizgi-studyo` skill), then `panel_git` to the drafts (`sekme: "karakter"` or `"hareket"`, `kaydir: "taslaklar"`, `vurgula: "Kütüphaneye al"`) so the person takes them in there. Check that they did (`cli.mjs taslaklar <project folder>`) instead of asking in chat. Never write into the plugin's `library/`: `dogrula` and `onayla` refuse an episode that uses a file added or changed there.
   - A fix to a drawing already in the project library (a patch that slides, a prop held wrong, a mouth that looks wrong): draft the fixed version **under the same id** in `kutuphane/taslak/`. The panel shows it as a new version next to the current one; "Yeni sürümü al" replaces it and keeps the old one aside. The episode needs no change. Never edit a taken-in drawing directly, and never make a second copy under a new name (`suluman2`) for a fix.
   - Write why and for which episode into `kutuphane/taslak/notlar.json` (`{"karakter/<id>": {"bolum": "bolumler/<episode>/bolum.json", "not": "what changed"}}`); the draft card shows it.
   - Several drafts at once (the views of one character): `panel_git` with `vurgula: "Hepsini kütüphaneye al"`; the person takes them all with one click.
8. **Validate** the whole episode (`dogrula`, no errors; its `kararlar.eksik` must be empty, or ask the person what it lists) and continue with **cizgi-senaryo**.

## Library reference and episode format

Read these while working through the steps above.

- **Read the library** before writing anything. Everything an episode may use is a file:
   - characters: `${CLAUDE_PLUGIN_ROOT}/library/characters/<id>/`. `character.json` lists the recolourable `palette_vars`.
   - actions: `library/actions/<id>.json`. Each lists the `views` it is made for. Give a cast member only actions whose `views` include its rig's `view` (`character.json`); `dogrula` warns otherwise. Walk and run actions name the `cast.walk` speed in their notes (e.g. `yuru-cocuk` 144, `kos-cocuk` 230 world units per second). Use it so the feet do not slide. Sitting (profile views): `otur` (sits down, 1.4 s) → `oturuyor` (seated, loops) → `kalk` (stands up, 1.3 s), e.g. `action: "otur", actions: [{"action": "oturuyor", "at": 1.4}]`; a shot that starts seated begins with `oturuyor`. The feet stay where the character stands and the hips go back about 120 world units, so put a bench (`scene.dekor`, prop `bank`) about 100 units behind the mark (toward where the character turns its back).
   - backgrounds: `library/backgrounds/<id>.svg`, or a layered one: `library/backgrounds/<id>/mekan.json` (`{"ad", "katmanlar": [{"id", "dosya", "derinlik"}], "kaybolma"?}`) with one full-frame SVG per layer (viewBox `0 0 1920 1080`, back to front). `derinlik` 0 is the farthest (sky: always seen as drawn), 1 the characters' plane; in between, the layer follows the camera that much (parallax when the camera follows, pans or zooms). A wide, still shot shows every layer as drawn; parts that must meet (a horizon strip and the ground) belong in one layer or at the same depth. A scene can hide, move, scale or tint each layer for itself: `scene.katmanlar = {"<layer>": {"gizli", "dx", "dy", "olcek", "ton"}}` (a one-file background has one layer, `tum`); moving or shrinking a layer can show past its edge, so give such layers a margin outside the frame. Limits: a prop placed in depth (`props[].depth`) stays in the characters' plane (no parallax, drawn over every layer); a dolly scales all layers alike.
   - scene light: `scene.isik = {"saat": "sabah"|"ogle"|"aksam"|"gece", "guc"?: 0..1}`: one colour grade over the scene's whole world (backgrounds, decor, props, characters; captions stay as they are). `ogle` is the drawing as it is; `sabah` a little golden, `aksam` warm orange, `gece` dark blue and greyish; `guc` (default 1) how strongly. It does not change the drawings themselves: lit windows, a lamp's glow, a sun or moon, and shadows are drawn (or a layer is hidden or tinted with `scene.katmanlar`), so a night scene looks best on a background drawn with a night sky or with its sky layer tinted.
   - a costume: `cast[].varyant` picks a costume variant the drawing declares (`character.json` `varyantlar`): the same person in other clothes or colours for that shot. For a costume change in the story, add a variant to the drawing (an update draft) rather than drawing a new character.
   - the face: `cast[].ifade` is `"gulumse"` (smile) or `"notr"` for the whole shot, or a list of moments `[{"ifade": "gulumse", "at": 1.5}]` (seconds from the shot start, neutral before the first). Outside speech, and in its pauses, the mouth shows it (the rig's `mouth_smile`); while the character speaks, the mouth follows the speech. Use it for a reaction ("ilk kez gülümser") instead of a line. Other expressions are not in the engine yet.
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
