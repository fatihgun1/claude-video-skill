---
name: cizgi-proje
description: Start a new cartoon episode with the Çizgi Stüdyo engine together with the person — open the editor panel first, talk the story and characters through in the chat, let the person pick places, drawings, voices and options from cards in the panel, write bolum.json from library assets only, then hand over to cizgi-senaryo. Use when the user wants a new cartoon, animation, video, çizgi film or bölüm, or tells a story they want made.
---

# Start an episode

Çizgi Stüdyo makes 2D (and, where the library has recipes, 3D) cartoons in which **the person stays in control**. You propose, they choose and approve. The engine refuses anything that is not in the asset library and refuses each stage until the previous one is approved.

Engine CLI (Node ≥ 20). Every command prints JSON:

```bash
node "${CLAUDE_PLUGIN_ROOT}/engine/src/cli.mjs" <command> ...
```

The first time, if `${CLAUDE_PLUGIN_ROOT}/engine/node_modules` is missing, run `npm install --prefix "${CLAUDE_PLUGIN_ROOT}/engine"`.

## Steps

The episode is made **with** the person. You never decide a matter of taste for them: you offer choices, they pick. There is **no setup wizard**: it made starting far too long. The story is talked through **in the chat**; the panel is where the person **picks** (pictures, voices, options) and watches the episode grow.

**Where each question goes.**
- **In the chat** (plain text, a few short questions at once, never a form): the story in their words, who the characters are and what they are like, what happens in each scene. Free answers, so the person just types.
- **In the panel** (`panel_sor`, cards they click): every choice between options, above all the ones with a picture or a sound. These are the format and length, 2D or 3D, a place (`/kutuphane/mekan/<id>.svg`), a character drawing or concept sketch (`/kutuphane/karakter/<id>.svg`, `/kutuphane-taslak/konsept/<id>.svg`), a voice (`ses`: a line or `cikti/ses-ornegi-<id>.wav`), music, effects and captions, and approvals. The person can always write their own answer on the card. It waits for the answer. Use AskUserQuestion only when `panel_sor` is not available (no MCP server, no open panel).
- Never put a choice in prose and move on, and never read an answer to one question as the answer to another.

**Show, do not direct.** When the person should look at or act on something in the panel (a scene, a shot, drafts waiting to be taken in), move the panel there yourself with `panel_git` (`bolum`, `sekme`, `shot`, `kaydir: "taslaklar"`, `vurgula: "Kütüphaneye al"`) instead of telling them where to click. **Every picture is shown in the panel**: never open a drawing in a separate browser tab or by a `file://` address. Say what you are doing in one short chat line as you go.

**Ask few questions.** Group what belongs together, ask only what you cannot reasonably propose, and once the person accepts a plan, carry it out: apply your proposal in the panel, say in one line what you did, and let them change it there.

1. **Open the panel first**, before any question or drawing, even when the request already tells a story: `panel_ac` (MCP server `cizgi-studyo`; without it, the CLI fallback in the `cizgi-studyo` skill), then open its URL in the built-in browser at once (`mcp__Claude_Browser__preview_start {url}`): the person sees nothing until you do.
   - **Leftovers in the folder** (episodes with a similar title): do not stop to ask about them for a new request. Start a new episode with its own id; the person can open an old one from the Projeler page themselves.
2. **The story, in the chat.** If the request is one line, ask in the chat, in one message: who it is about, what their problem is, what changes, how it ends, and who the characters are (name and a few words on their look and nature). Draft a story only when they ask you to, and then offer two or three different directions. Then ask each of these with one `panel_sor`:
   - **Format** (16:9, 9:16, both) with the **length**.
   - **Audience**: `"profile": "genel"`, or `"pedagoji-0-3"` for ages 0-3 (then also follow `cizgi-pedagoji-0-3`).
   - **2D or 3D**, only when the library has 3D recipes for their characters and places (`library/3d/karakterler/<rig>.json`, `library/3d/mekanlar/<bg>.json`). For 3D also ask the look, `stil3d`: toon, yumusak, pastel, golge.
   - **Characters.** The person names and describes them. **Do not suggest library characters (or any character) they did not ask for**; offer the library's list only when they ask what exists. When a library drawing could fit one, ask in `panel_sor` with its picture and a "Yeni çiz" card; otherwise it is a new drawing (step 7), with no question.
3. **Scenes and places.** From the story, propose the scenes yourself: what happens, who is in it, how long. Write them as story cards into `hikaye.json` (see "Story cards" in the `cizgi-studyo` skill; it is a record the **Hikâye** panel shows, not a form). Show the plan in the chat in a few lines and let the person correct it there. For each scene's **place**, ask one `panel_sor` with the matching backgrounds as picture cards (library and project ones, plus "Yeni mekân çiz" when none fits). One question may cover several scenes when the place is plainly the same. The **time of day** (`scene.isik`) and **decor** (`scene.dekor`) you propose yourself.
4. **Read the library** (reference below) and **create the episode** ("Create the folder" below) at once: one scene per card with its place and light, one shot per scene with its people standing (library stand-ins for characters not drawn yet), no lines yet. Validate, then `panel_git {bolum: "bolumler/<id>/bolum.json"}`: the person watches the episode grow from the first minute. From then on save after every piece (a scene's shots, a new character once taken into the library, a line) and validate each save. Never keep the whole episode for one write at the end.
5. **Sound and captions.** Ask each in the panel: background **music** (cards for pieces from `library/muzik`, or none), **sound effects** (yes/no; only from the library), **captions** (on/off, edged with the speaker's colour). Never pick music yourself. Record them: `kararlar.muzik`, `kararlar.efekt`, `kararlar.altyazi` (`var`/`yok`), with `music` and `altyazi` set to match. Voices are chosen in **cizgi-ses** (cards with a sample to listen to).
6. **Build all the scenes in one pass**, in card order, without stopping for the person between scenes. One scene at a time with an approval each made the person wait half an hour for a short episode. Say in one chat line which scene you are on, and save after each scene, so the person watches the episode grow in the editor. For each scene:
   - Plan the shots with the `cizgi-sinema` skill: each character's **action** (only actions drawn for that character's view), the **camera** (framing and move), the **lines** with their **feeling** (`duygu`), the hold and any sound effect. Do not ask about each of these: propose the whole scene.
   - Write the scene into `bolum.json`, run `dogrula` and fix its `film:` warnings. Take the scene's stills (`cli.mjs storyboard <bolum.json> --sahne <id> --format <the episode's format>`) and look at every one yourself. Fix what is plainly wrong (out of frame, a prop held wrong, a frozen crowd) before showing it.
   - Then go straight on to the next scene. Do not ask about a detail (a line, an action, a camera) in between: choose it and note it.
   - **One approval at the end.** When every scene is in, `panel_git` to the first shot and ask one `panel_sor`: "Bütün sahneler kuruldu, uygun mu?". List the scenes in a few words each and what you noticed. Offer options such as "Uygun, senaryoya geç" / "Değiştireceğim (panelde)" / "Şu sahneyi değiştir…" (multi-select over the scenes). Fix what they name, then go on.
7. **Anything missing** (a character, action, place, prop or sound the library lacks, or something the engine cannot show, such as an expression other than a smile: angry, crying, surprised):
   - The **main characters and places** of the story that have no drawing: draw them before the scene pass, without asking again whether to draw them.
   - **Small things found while building the scenes** (a passer-by, a phone, an action, a sound): do not stop for each one. Use the closest library item as a stand-in, write it into `new_assets` with a note, and go on. At the end ask about all of them in **one** `panel_sor` (multi-select: which ones to draw or add; the rest keep their stand-in), together with or right before the scene approval.
   - Never change the story yourself to avoid a missing item: a stand-in keeps the story, and the person decides at the end.
   - A new place or prop: a draft in the project library (see the `cizgi-studyo` skill); the person takes it in from the panel.
   - A new character:
     - Draw a concept sketch first (`<project>/kutuphane/taslak/konsept/<id>.svg`, plain SVG) and show it with `panel_sor`. Each sketch is the picture of an option card, with the views the shots need; several sketches = one card each, so the person picks on the card itself. To check a sketch yourself first, use a background tab, never the person's panel tab (see "Check your draft" in the `cizgi-studyo` skill).
     - On a yes, draw it as a draft in the project library ("Drawing new drawings" in the `cizgi-studyo` skill), all its views.
     - Then `panel_git` to the drafts (`sekme: "karakter"`, `kaydir: "taslaklar"`, `vurgula: "Kütüphaneye al"`) and say so in one chat line. When the person takes them in (or puts one aside), `panel_dinle` returns `{tur: "taslak", islem, cizimler}`: carry on at once. If you were busy, it waits for your next `panel_dinle`; `cli.mjs taslaklar <project folder>` also shows what is left.
     - Never write into the plugin's `library/`: `dogrula` and `onayla` refuse an episode that uses a file added or changed there.
   - A fix to a drawing already in the project library (a patch that slides, a prop held wrong, a mouth that looks wrong): draft the fixed version **under the same id** in `kutuphane/taslak/`. The panel shows it as a new version next to the current one; "Yeni sürümü al" replaces it and keeps the old one aside. The episode needs no change. Never edit a taken-in drawing directly, and never make a second copy under a new name (`suluman2`) for a fix.
   - Write why and for which episode into `kutuphane/taslak/notlar.json` (`{"karakter/<id>": {"bolum": "bolumler/<episode>/bolum.json", "not": "what changed"}}`); the draft card shows it.
8. **Validate** the whole episode (`dogrula`, no errors; its `kararlar.eksik` must be empty, or ask the person what it lists) and continue with **cizgi-senaryo**.
9. **Hand the stage to the person** whenever you finish a job: `panel_git` to the first shot (never to the Üretim page). Ask one `panel_sor` "Bölüm sahnede. Ne yapmak istersin?" with two options:
   - "Sahnede bir şeye tıklayıp düzelteceğim": a character, the place, a line or the shot opens its window.
   - "Videoyu çıkar": the top bar's **🎬 Video çıkar**. Point at it with `panel_git {vurgula: "Video çıkar"}`; the person presses it.
   - Then go into studio mode: `panel_dinle`, with `bekle` 600 at most, so messages from other sessions are not held for long.

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
   - scene decor: `scene.dekor = [{"id", "prop", "x", "back"?, "olcek"?, "ters"?, "akis"?}]`: library props standing in the scene for all its shots (a tree, a bench, a lamp), behind the characters. `x` is the world position (-600..2520; 9:16 pulls it toward the middle as it does the marks), `back` 0..1 puts it further back like `cast.back` (higher, smaller), `olcek` 0.3..3 its size, `ters` mirrors it, `akis` `{"dx"?, "back"?}` (per second) makes it walk all through the scene and come round again (a crowd must have it, see cizgi-sinema). Decor stands on the characters' plane: it moves with the ground, not with a far layer. Props for decor need `data-base` only; `data-grip` only on props someone holds (a prop with no grip cannot have a holder).
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
       "utterances": [{ "speaker": "pamuk", "text": "Merhaba!", "duygu": "neseli" }],
       "cast": [{ "id": "pamuk", "action": "selam", "mark": "orta" }],
       "camera": { "framing": "wide", "move": "push_in", "target": "pamuk" },
       "hold": 3 }] }]
   }
   ```

   - Never write times, coordinates or audio paths. Timing comes from the audio and the profile. Audio lands in `ses/<shot_id>-<n>.wav`.
   - `speaker` is a cast member of that shot or `anlatici` (the narrator).
   - Give every line its feeling, `utterance.duygu`: `sakin`, `neseli`, `heyecanli`, `uzgun`, `kizgin` or `korkmus`, as the story asks. A line without one is spoken flat (Test 16: "duygu aktarımı yok"). The person changes it in the line's window (click the line), which speaks just that line again; `volume` (0-2, 1 = the common level) is its loudness.
   - A sound effect goes on the shot where it happens: `"sfx": [{ "sfx": "kapi-ac", "at": 0.5, "volume": 0.8 }]`, where `at` is seconds from the start of that shot. Use one only when the picture shows its cause: a door that opens, a foot that lands. Footsteps follow the walk cycle (every half cycle, for example every 0.4 s with `yuru-cocuk`).
   - If the story needs something the library lacks (a new action, background or character), **do not invent it**: ask the person about it (step 7).
- **Validate**: `cli.mjs dogrula bolumler/<id>/bolum.json`. Fix every error. Keep the warnings for the person to see at the script gate.

`cli.mjs durum <bolum.json>` tells you at any time which gate is open and what the next step is. When unsure, run it.
