---
name: cizgi-proje
user-invocable: false
description: Start a new cartoon episode with the Çizgi Stüdyo engine together with the person — open the editor panel first, talk the story and characters through in the chat, let the person pick places, drawings, voices and options from cards in the panel, write bolum.json from library assets only, then hand over to cizgi-senaryo. Use when the user wants a new cartoon, animation, video, çizgi film or bölüm, or tells a story they want made.
---

# Start an episode

> **Önce oku:** eklentinin ortak kuralları `${CLAUDE_PLUGIN_ROOT}/kurallar.md`. Hangi yoldan başlanırsa başlansın sahne yazmadan, değiştirmeden ya da onaylatmadan önce oku; bu skill ayrıntıları verir.

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

**Show, do not direct.** When the person should look at or act on something in the panel (a scene, a shot, a button), move the panel there yourself with `panel_git` (`bolum`, `sekme`, `shot`, `vurgula`). If its answer says the panel did not go there, tell the person in one chat line to switch to the panel tab or reload it instead of telling them where to click. **Every picture is shown in the panel**: never open a drawing in a separate browser tab or by a `file://` address. Say what you are doing in one short chat line as you go.

**The person's words come first.** Hurda Kralı 1 went wrong at the first message and stayed wrong for two hours:
- **Read a wish exactly, negations above all, and write it down.** "bir oyun gibi davranmayalım" was read as "davranalım", and the whole episode became a game narrator ("görev", "envanter", "bölü on"). At the first message, write every wish **word for word** into `hikaye.json` `kisi: [{metin, tur: yap|yapma|sor, yorum}]` and say the story back in one chat line with every *do* and *don't* in it ("oyun dili yok, anlatıcı hikâye anlatır"), so a misreading is caught at once. Add each later wish the same way. The script approval is refused until `kisi` exists (an empty list when they wished nothing special).
- **An explicit instruction beats every default and every film rule.** "Kamera plandan çıkmadan devam etsin" means one unbroken shot, even where `cizgi-sinema` would cut on the action: give that shot `kilit: {neden: "<their words>"}`, and the film rules report on it as their decision, not as a warning. If you think a rule would serve better, say so in one line and do what they said unless they agree.
- **A missing drawing: one rule, the person's.** When a drawing is missing, ask once `kararlar.eksik_cizim`: `sor` (ask before each one) or `yer_tutucu` (a stand-in, and go on). With `sor`, each `new_assets` entry needs their answer in `cevap` before the script approval. This rule decides wherever this skill says "stand-in".
- **Every card sentence ends up on screen, or you say why.** When the scenes are built, check each `hikaye.json` card sentence and each request of the person against the episode, and list in the chat any that is not on screen (with the reason: "köpek çizimi yok, kadraj dışında"). A dropped detail you do not name is a detail the person thinks they got.

**Ask few questions: the main line only.** Köşe Başı asked nine panel questions in 19 minutes and the person said "çok soru soruyor".
- Before the scenes are built, ask at most these, each once:
  1. each character's drawing;
  2. the places, as **one** plan;
  3. the music;
  4. effects and captions.
- After the scene pass, ask one approval.
- Everything else you choose yourself: time of day, decor, actions, camera, feelings. Say it in one chat line; the person changes it by clicking on the stage.
- **One choice per question.** Never ask two things in one question ("pick one Selin and one Kerem", "effects / captions plain / captions coloured" as a multi-select). The person ticked all four concepts and a follow-up question was needed. Two characters = two questions. Options that exclude each other are single-choice cards. `coklu` is only for "which of these" lists (stand-ins to draw, scenes to change).
- **Places as one plan:** `panel_sor` "Mekân planım: …". Every card must be a complete answer:
  - first, "Planım uygun", with your place for every scene in its `aciklama` and the main picture;
  - then "Şu sahnenin mekânını değiştir" (the person writes which on the card);
  - then "Yeni mekân çiz".
  A card that only names one place ("Öğrenci odası (s4)") left the person guessing whether it meant keep or change. Never one question per scene.
- **Music with sound:** every music card carries its track as `ses: "/kutuphane/muzik/<id>.wav"`, so the person listens on the card. The person picked a track blind once ("dinleme seçeneğim yok"). Effects and captions: one single-choice question with the combinations as cards: effects yes/no × captions none / plain / in the speaker's colour. Record exactly what was picked. Never assume coloured captions.

**Write files in UTF-8.** Write JSON with the Write tool or Node's `fs`. Never use PowerShell `Set-Content`/`Out-File`/`>`: it garbled the episode's title into "KÃ¶ÅŸe BaÅŸÄ±". `dogrula` now refuses garbled Turkish.

**Write long code to files.** A drawing script, a scene generator or anything over a few lines goes into a file with the Write tool, then runs with `node <file>`. Never put it in `node -e` or a shell heredoc: Turkish apostrophes (Kerem'in) break the shell quoting, and the same 9 000-character script had to be written twice.

1. **Open the panel first**, before any question or drawing, even when the request already tells a story: `panel_ac` (MCP server `cizgi-studyo`; without it, the CLI fallback in the `cizgi-studyo` skill), then open its URL in the built-in browser at once (`mcp__Claude_Browser__preview_start {url}`): the person sees nothing until you do.
   - **A new episode of a series** (the wish names a character, a place or a story of an earlier episode, or `seriler/` holds a series of it): before the first question, run `cli.mjs seri-ozet <project>/seriler/<id>.json` and read it: the series' standing wishes (`kisi_kurallari`), its characters with their drawings and voices, its objects, and how the last episode ended. Give the new episode `"seri": "<id>"`, add its id to the series' `bolumler`, use the series' drawings and voices, and start where the last episode ended (or mark the jump in time with `zaman_atlama` on the first shot). `dogrula` holds the gates when an episode leaves its series. For the first episode of what will be a series, write `seriler/<id>.json` with the characters, voices and the person's standing wishes once the voices are chosen. Hurda Kralı 2 was written without reading episode 1 and turned its backpack into a bag.
   - **Unrelated leftovers in the folder**: do not stop to ask about them for a new request. Start a new episode with its own id; the person can open an old one from the Projeler page themselves.
2. **The story, in the chat.** If the request is one line, ask in the chat, in one message: who it is about, what their problem is, what changes, how it ends, and who the characters are (name and a few words on their look and nature). Draft a story only when they ask you to, and then offer two or three different directions. Then, only for what the request leaves open (most often nothing), one `panel_sor` each:
   - **Format** (16:9, 9:16, both) with the **length**.
   - **Audience**: `"profile": "genel"`, or `"pedagoji-0-3"` for ages 0-3 (then also follow `cizgi-pedagoji-0-3`).
   - **2D or 3D**, only when the library has 3D recipes for their characters and places (`library/3d/karakterler/<rig>.json`, `library/3d/mekanlar/<bg>.json`). For 3D also ask the look, `stil3d`: toon, yumusak, pastel, golge.
   - **Characters.** The person names and describes them. **Do not suggest library characters (or any character) they did not ask for**; offer the library's list only when they ask what exists. When a library drawing could fit one, ask in `panel_sor` with its picture and a "Yeni çiz" card; otherwise it is a new drawing (step 8), with no question.
3. **The skeleton episode, at once.** As soon as the story is known (from the request or after one chat question), and **before any drawing or place question**, write `bolumler/<id>/bolum.json`. It is one scene per story beat, each with one standing shot, with library stand-ins: a library character for each person and the closest library background. Validate it and `panel_git {bolum}`, so the person watches the stage from the first minutes. In Köşe Başı the stage stayed empty for 25 minutes while characters and places were drawn ("sahneyi izlemem mümkün mü?"). Replace a stand-in the moment its drawing is in the library, then save and validate.
4. **Scenes and places.** From the story, propose the scenes yourself: what happens, who is in it, how long. Write them as story cards into `hikaye.json` (see "Story cards" in the `cizgi-studyo` skill; it is a record the **Hikâye** panel shows, not a form). Show the plan in the chat in a few lines and let the person correct it there.
   - **Check the story's logic before you show the plan.** Hurda Kralı 3's cards had a stranger follow Kadir all day with no reason, rob him only after he had spent half his money, step out at night in a moment that began in the evening, and come from behind in one card and from the front in the next. Card checks only asked "is it on screen", never "does it make sense". Go through the cards and answer each of these:
     - **Why this, why now?** Everyone who acts has a reason the viewer knows or will learn (who saw what, when). A threat that waits needs a reason to wait.
     - **What carries over?** What each person knows, holds and wants at the end of a card, and at the end of the last episode (`seri-ozet`), still holds in the next one. A question the viewer will ask ("he had money last night, why was he hungry?") gets a one-line answer.
     - **One unbroken moment, one time of day.** Cards that run straight into each other keep their light; a change of light needs a cut that shows time passing.
     - **Directions and sounds agree** across cards (a sound from behind → the person turns toward it).
     - **Real numbers are believable** (prices, amounts, distances) for the place and year, or the story gives a reason ("dünden kalan, al").
     - **A hidden identity stays hidden on screen**: back, silhouette, shadow, out of focus; never the same drawing shown plainly.
     Do not fix a gap in the person's story yourself (rule 2 of `kurallar.md`): name each gap with a one-line fix in the same chat message as the plan, and let them choose. For each scene's **place**, ask one `panel_sor` with the matching backgrounds as picture cards (library and project ones, plus "Yeni mekân çiz" when none fits). One question may cover several scenes when the place is plainly the same. The **time of day** (`scene.isik`) and **decor** (`scene.dekor`) you propose yourself.
   - **A place is one side-on picture; an angle is another picture.** The camera can only zoom inside a background, so a scene played wholly in front of one drawing is "always the middle of the street, one angle". Plan **setups**: a beat about an object or a task gets its own place where it happens (the weighing at the scale inside the shop, its dial in a close-up place; a meal at the table), and a scene with a conversation gets at least two backgrounds of the same spot (the street toward the shop, and the reverse: the shop door looking out). Draw the extra places as drafts like any place. Hurda Kralı 2 put the arrival, the weighing and the haggling all in the middle of one street drawing.
5. **Read the library** (reference below) and bring the skeleton to the agreed scenes ("Create the folder" below): one scene per card with its place and light, its people standing, no lines yet. From then on save after every piece (a scene's shots, a new character once taken into the library, a line) and validate each save. Never keep the whole episode for one write at the end.
6. **Sound and captions.** Ask each in the panel: background **music** (cards for pieces from `library/muzik`, or none), **sound effects** (yes/no; only from the library), **captions** (on/off, edged with the speaker's colour). Never pick music yourself. Record them: `kararlar.muzik`, `kararlar.efekt`, `kararlar.altyazi` (`var`/`yok`), with `music` and `altyazi` set to match. Voices are chosen in **cizgi-ses** (cards with a sample to listen to).
7. **Build all the scenes in one pass**, in card order, without stopping for the person between scenes. One scene at a time with an approval each made the person wait half an hour for a short episode. Say in one chat line which scene you are on, and save after each scene, so the person watches the episode grow in the editor. For each scene:
   - **Show what the story says happens.** A thing handed over, weighed, paid, picked up or carried is an action and a prop on screen (`egil-al` with the prop, a prop moving to the other person's hand), not a line about it over people standing still. A line that names an object ("bak ne getirdim", "al sana yirmi lira") needs that object in the shot. The engine has a tool for each move of a prop; never fake one with a copy parked off frame or a second prop:
     - **pick up**: an action with `grab` (`egil-al`), the prop lying within reach of the hand;
     - **take out of a bag or a pocket**: an action with `grab` (`cantadan-al`) and the prop `gizli: true` (it lies nowhere before);
     - **put away** (into a bag): an action with `release` (`cantaya-koy`): the prop is gone;
     - **set down** (on a scale, a table): an action with `put_down` (`egil-birak`) and the prop's `sonra: {mark, dx}`: it lies there from then on;
     - **hand over**: the giver's action with `release` (`uzat`), the prop's `to: "<taker>"`: at that moment it is in the taker's hand, never in both.
     `dogrula` warns when a prop is out of reach, appears in a hand from nowhere, multiplies at a cut, or leaves a hand with nobody doing it.
   - Plan the shots with the `cizgi-sinema` skill (load it with the Skill tool if it is not loaded yet): each character's **action** (only actions drawn for that character's view), the **camera** (framing and move), the **lines** with their **feeling** (`duygu`), the hold and any sound effect. Do not ask about each of these: propose the whole scene.
   - Write the scene into `bolum.json`, run `dogrula` and fix its `film:` warnings. Take the scene's stills (`cli.mjs storyboard <bolum.json> --sahne <id> --format <the episode's format>`) and look at every one yourself. Fix what is plainly wrong (out of frame, a prop held wrong, a frozen crowd) before showing it.
   - Then go straight on to the next scene. Do not ask about a detail (a line, an action, a camera) in between: choose it and note it.
   - **Keep to the length.** Plan the shot count from the asked length: about one shot per 3-4 seconds. Köşe Başı grew to 37 shots and 152 s for a 2-minute wish. If a scene runs long, merge shots instead of trimming lines.
   - **Fix one scene at a time.** Edit only the scene that needs it and take only its stills again. A generator that rewrites every scene made one small fix retake all six scenes.
   - **One check round.** Look at the stills once, fix what is plainly wrong, take only the changed scenes' stills again, and hand over. Polishing in loops kept the person waiting with nothing new to see.
   - **One approval at the end.** When every scene is in, `panel_git` to the first shot and ask one `panel_sor`: "Bütün sahneler kuruldu, uygun mu?". List the scenes in a few words each and what you noticed. Offer options such as "Uygun, senaryoya geç" / "Değiştireceğim (panelde)" / "Şu sahneyi değiştir…" (multi-select over the scenes). Fix what they name, then go on.
8. **Anything missing** (a character, action, place, prop or sound the library lacks, or something the engine cannot show, such as an expression other than a smile: angry, crying, surprised):
   - The **main characters and places** of the story that have no drawing: draw them before the scene pass, without asking again whether to draw them.
   - **Small things found while building the scenes** (a passer-by, a phone, an action, a sound): with `eksik_cizim: yer_tutucu`, do not stop for each one: use the closest library item as a stand-in, write it into `new_assets` with a note, and go on; at the end ask about all of them in **one** `panel_sor` (multi-select: which ones to draw or add; the rest keep their stand-in), together with or right before the scene approval. With `eksik_cizim: sor`, ask before using a stand-in, and write the answer into its `cevap`.
   - Never change the story yourself to avoid a missing item: a stand-in keeps the story, and the person decides at the end.
   - A new place or prop: a draft in the project library (see the `cizgi-studyo` skill); check it and take it in yourself with `cli.mjs taslak-al`, as for a character.
   - A new character:
     - Draw a concept sketch first (`<project>/kutuphane/taslak/konsept/<id>.svg`, plain SVG) and show it with `panel_sor`. Each sketch is the picture of an option card, with the views the shots need; several sketches = one card each, so the person picks on the card itself. To check a sketch yourself first, use a background tab, never the person's panel tab (see "Check your draft" in the `cizgi-studyo` skill).
     - On a yes, draw it as a draft in the project library ("Drawing new drawings" in the `cizgi-studyo` skill), all its views.
     - Check the drafts yourself (`cli.mjs taslaklar <project folder>`, then look at them at 9:16 size in a background tab), then **take them in yourself**: `cli.mjs taslak-al <project folder> karakter/<id> karakter/<id>-on …`. The person no longer presses "Kütüphaneye al" ("direkt alsın"). Name only what you drew for this episode; leftovers of other episodes stay drafts. Then put the drawing in the episode and say in one chat line what came in. The person asks for changes in its object window.
     - Never write into the plugin's `library/`: `dogrula` and `onayla` refuse an episode that uses a file added or changed there.
   - A fix to a drawing already in the project library (a patch that slides, a prop held wrong, a mouth that looks wrong): draft the fixed version **under the same id** in `kutuphane/taslak/`. The panel shows it as a new version next to the current one; "Yeni sürümü al" replaces it and keeps the old one aside. The episode needs no change. Never edit a taken-in drawing directly, and never make a second copy under a new name (`suluman2`) for a fix.
   - Write why and for which episode into `kutuphane/taslak/notlar.json` (`{"karakter/<id>": {"bolum": "bolumler/<episode>/bolum.json", "not": "what changed"}}`); the draft card shows it.
9. **Validate** the whole episode (`dogrula`, no errors; its `kararlar.eksik` must be empty, or ask the person what it lists) and continue with **cizgi-senaryo**.
10. **Hand the stage to the person** whenever you finish a job: `panel_git` to the first shot (never to the Üretim page). Ask one `panel_sor` "Bölüm sahnede. Ne yapmak istersin?" with two options:
   - "Sahnede bir şeye tıklayıp düzelteceğim": a character, the place, a line or the shot opens its window.
   - "Videoyu çıkar": the top bar's **🎬 Video çıkar**. Point at it with `panel_git {vurgula: "Video çıkar"}`; the person presses it.
   - Then go into studio mode: `panel_dinle`, with `bekle` 120, so the person's chat messages and other sessions' messages are not held long.
   - **The script and the voices happen in the chat.** When the person wants the video:
     - Show the script in the chat (`cizgi-senaryo`) and record it on their yes.
     - Then generate the voices **once** (`cizgi-ses`); the panel may already be doing it: `cli.mjs durum` / the voice lock tells you, so never start a second voice job.
     - Tell them in one line when the voices are ready.

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
   - A sound effect goes on the shot where it happens, **tied to what makes it**, so it stays there when a recording gets longer: `{ "sfx": "zil", "replik": 1, "kelime": 2 }` (on word 2 of line 1 of the shot), `{ "sfx": "metal", "oyuncu": "kadir", "an": "grab" }` (when Kadir's action takes its prop; also `release`, `put_down`, `baslangic`), `{ "sfx": "adim-beton", "oyuncu": "kadir", "adim": true }` (a step on every step of his `walk`). Use `"at"` (seconds from the shot's start) only for a sound tied to nothing on screen. `ofset` (seconds, ±) moves any of them; `volume` 0-1. An effect stops where its shot ends. Use one only when the picture shows its cause: a door that opens, a foot that lands. A walk on screen without steps is silent: give it `adim`.
   - If the story needs something the library lacks (a new action, background or character), **do not invent it**: follow `kararlar.eksik_cizim` (step 8).
- **Validate**: `cli.mjs dogrula bolumler/<id>/bolum.json`. Fix every error. Keep the warnings for the person to see at the script gate.

`cli.mjs durum <bolum.json>` tells you at any time which gate is open and what the next step is. When unsure, run it.
