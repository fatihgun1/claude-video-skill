---
name: cizgi-ses
description: Generate the voice track of an approved Çizgi Stüdyo episode — free local TTS (Chatterbox), tempo from the profile, automatic listening check with retries, word timings and lip-sync shapes. Use after the senaryo gate, or when lines changed and the audio is out of date.
---

# Audio step (ses)

```bash
CLI="node ${CLAUDE_PLUGIN_ROOT}/engine/src/cli.mjs"
$CLI ses <bolum.json>          # only new or changed lines
$CLI ses <bolum.json> --hepsi  # redo every line
```

The step refuses to run until the script gate (`senaryo`) is approved for the current text.

For every line that is new or changed, the engine:
1. speaks it with Chatterbox Multilingual (local, MIT). The voice comes from `characters[].voice` or `narrator_voice`.
2. slows it to the profile tempo (`speech.tempo`, e.g. 0.85 for ages 0-3) with ffmpeg.
3. **listens to it**: Whisper transcribes the take and it is compared with the script (character error rate). Takes above `speech.max_cer` are regenerated, up to `speech.retries` times. This catches TTS hallucinations such as added sounds or mangled words.
4. aligns the words (WhisperX) and derives mouth shapes (Rhubarb).

Results go to `ses/<shot>-<n>.wav` plus `.words.json`, `.rhubarb.json` and `ses/manifest.json`.

## Reading the result
The command prints `{generated, kept, failed}` and exits with **3** when some lines stayed wrong after all retries. For each failed line, show the person what was expected and what was heard (`heard`, `cer`), then offer three options:
- try again: `ses` (new seeds)
- rephrase the line: back to **cizgi-senaryo**. Changing text needs a new script approval.
- accept it as it is. Proper names often fail only because the recogniser does not know them, so ask the person to listen first. Only after they accept it, record that with `$CLI kabul <bolum.json> <line-key>`. A regenerated line needs a new decision.

Do not hide a failed line and do not move on silently.

## Voices
- `voice.exaggeration` is 0.25–1.5 (default 0.5) and controls expressiveness.
- `voice.cfg` is 0.4–1 (default 0.5). Lower values made Chatterbox add or mangle words in testing.
- `voice.ref` is an optional ~10 s reference clip (episode-relative) for voice cloning. Only use recordings the person has the right to use.

## First-time setup (tools)
The step needs these tools. Their paths come from environment variables or from `~/.cizgi-studyo/config.json`:

| Key (config / env) | What |
|---|---|
| `python_tts` / `CIZGI_PYTHON_TTS` | python of a venv with `chatterbox-tts==0.1.7` and torch 2.6 |
| `python_align` / `CIZGI_PYTHON_ALIGN` | python of a separate venv with `whisperx==3.8.6` (it needs torch 2.8) |
| `rhubarb` / `CIZGI_RHUBARB` | Rhubarb Lip Sync 1.14 executable |
| `ffmpeg` / `CIZGI_FFMPEG` | ffmpeg (default: `ffmpeg` on PATH) |

If a tool is missing, the command names it. Help the person set it up, and ask before downloading anything large (the models are several GB).
