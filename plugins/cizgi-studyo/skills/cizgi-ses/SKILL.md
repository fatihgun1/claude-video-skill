---
name: cizgi-ses
description: Generate the voice track of an approved Çizgi Stüdyo episode with Edge TTS (Microsoft's free online neural voices, needs internet) — ready voices with pitch and rate, feelings, tempo from the profile, exact word timings and lip-sync shapes, one voice job at a time. Use after the senaryo gate, or when lines changed and the audio is out of date.
---

# Audio step (ses)

```bash
CLI="node ${CLAUDE_PLUGIN_ROOT}/engine/src/cli.mjs"
$CLI ses <bolum.json>          # only new or changed lines
$CLI ses <bolum.json> --hepsi  # redo every line
$CLI ses <bolum.json> s1_sh3-0 # speak that one line again; the others stay
```

The step refuses to run until the script gate (`senaryo`) is approved for the current text.

For every line that is new or changed, the engine:
1. speaks it with **Edge TTS** (`edge-tts`, LGPL-3.0, installed separately): Microsoft Edge's online neural voices, no API key. All lines go out together, four at a time; 20 lines take well under a minute. The voice comes from `characters[].voice` or `narrator_voice`, the feeling from `utterance.duygu`, the speed from the profile (`speech.tempo`, e.g. 0.85 for ages 0-3, sent as Edge's rate).
2. writes the word timings Edge reports (exact: Edge reads the text as written, so there is **no listening check** and no retries).
3. derives mouth shapes (Rhubarb).

Results go to `ses/<shot>-<n>.wav` plus `.words.json`, `.rhubarb.json` and `ses/manifest.json`. Lines spoken by the old engine (Chatterbox) count as changed and are spoken again on the next run. The command prints `{generated, kept, failed}`; `failed` is always empty and it exits 0 when every line was made.

**Internet and privacy.** The step needs internet. Only the line text and the voice settings go to Microsoft's service; nothing about the person. When it cannot reach the service it stops with "internet yok / Edge servisine ulaşılamadı": tell the person, and try again once they are online. Edge cannot clone a voice: there is no recording of one's own voice.

**One voice job at a time.** A lock file `~/.cizgi-studyo/ses.lock` holds the running job's process and episode. The panel's voice job and a `cizgi ses` you start never run together: the second waits for the first (up to 10 minutes), then stops with "başka bir seslendirme sürüyor (bölüm …, süreç …)". A lock whose process is gone is ignored. Before starting `cizgi ses`, check `cli.mjs durum`: if the panel is already speaking the lines, wait for it instead.

Lip sync: Rhubarb does not know Turkish and kept the mouth moving through pauses. The engine therefore closes the mouth wherever the line's audio is quiet for 80 ms or more (`dudak.mjs`, at compile time). Nothing to do on your side.

To let the person hear a line, ask in the panel with `panel_sor` and put the line's audio in the question: `ses: "<episode folder>/ses/<line-key>.wav"` (relative to the panel folder, e.g. `bolumler/kus/ses/s1_sh4-0.wav`). The question then plays it. Do not send the panel to the shot for this: the page moves away and there is nothing to play there.

## Voices
- **Every character needs a voice of its own.** Without one, every character speaks with the library's first voice (Kadın). Before the audio step, make sure each speaking person has a `voice`; ask the person in the panel if none is set.
- `voice.hazir`: a **ready voice** from `library/sesler/sesler.json`. Each is an Edge voice with pitch and rate presets:

  | id | name | Edge voice | preset |
  |---|---|---|---|
  | `kadin` | Kadın | tr-TR-EmelNeural | – |
  | `kadin-2` | Kadın 2 (younger, brighter) | tr-TR-EmelNeural | +10 Hz, +5 % |
  | `erkek` | Erkek | tr-TR-AhmetNeural | – |
  | `erkek-kalin` | Kalın erkek | tr-TR-AhmetNeural | -12 Hz |
  | `yasli` | Yaşlı erkek | tr-TR-AhmetNeural | -8 Hz, -12 % |
  | `cocuk` | Çocuk (a raised woman's voice, not a real child) | tr-TR-EmelNeural | +25 Hz, +8 % |

  Turkish has two Edge voices (Ahmet, Emel). The multilingual voices are not used: they read whole Turkish sentences well but say short lines and names ("Kerem?!") in English.
- `voice.perde`: pitch in Hz on top of the ready voice, -40..+40 (about -20..+30 sounds natural; minus is deeper).
- `voice.hiz`: speaking rate in % on top of the ready voice and the tempo, -40..+40.
- The person sets all three in the karakter window's **Ses** section (voice cards with ▶ to hear and **Seç**, a Perde slider, a Hız slider, **▶ Örnek dinle**) or in **Bölüm ayarları → Sesler**.
- A person's front and back views (rig `<rig>-on`, `<rig>-arka` of a character with rig `<rig>`) speak with that character's voice unless they have their own: set the voice once, on the profile character.
- **Let the person hear a voice before the lines are spoken.** `$CLI ses-ornek <bolum.json> <character id or anlatici> [--metin "…"]` speaks one sentence (its first line, else a sample sentence) in that voice into `cikti/ses-ornegi-<id>.wav`: no script approval, the episode's audio untouched, a few seconds. Offer this when choosing voices instead of guessing settings.
- Old episodes may still carry `voice.ref`, `voice.exaggeration` or `voice.cfg` (Chatterbox). They are ignored with a warning from `dogrula`; remove them when you next edit the file.

## Feelings
`utterance.duygu` changes how one line is said. Edge has no speaking styles, so a feeling shifts the speaker's rate, pitch and loudness (`ses.mjs` `MOODS`):

| duygu | rate | pitch | volume |
|---|---|---|---|
| `sakin` | -10 % | -3 Hz | -5 % |
| `neseli` | +8 % | +8 Hz | +5 % |
| `heyecanli` | +18 % | +12 Hz | +10 % |
| `uzgun` | -18 % | -10 Hz | -12 % |
| `kizgin` | +10 % | -6 Hz | +15 % |
| `korkmus` | +12 % | +10 Hz | -5 % |

When the person wants a line said differently ("daha heyecanlı"), set its `duygu` (or the character's `perde`/`hiz`), save, and speak that line again (`$CLI ses <bolum.json> <shot>-<n>`). A feeling or voice change makes only the lines it touches be spoken again.

## First-time setup (tools)
Paths come from environment variables or from `~/.cizgi-studyo/config.json`:

| Key (config / env) | What |
|---|---|
| `python_tts` / `CIZGI_PYTHON_TTS` | python of a venv with `edge-tts` (`pip install edge-tts`) |
| `rhubarb` / `CIZGI_RHUBARB` | Rhubarb Lip Sync 1.14 executable |
| `ffmpeg` / `CIZGI_FFMPEG` | ffmpeg (default: `ffmpeg` on PATH); turns Edge's MP3 into 16-bit mono WAV |

If a tool is missing, the command names it. Help the person set it up.

## Loudness
The engine brings every line to the same level where it goes into the film and where the panel plays one line (`ses-duzey.mjs`: speech about -20 dB, peaks under -1 dB). If the person still finds the voices quiet or loud next to music and effects, the levels are in the panel's **🔊 Ses düzeyleri** (`mix.lines`, `mix.sfx`, `music.level`).
