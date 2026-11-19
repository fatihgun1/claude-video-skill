# Çizgi Stüdyo

*Türkçe: [README.md](README.md)*

A free, open-source **2D cartoon studio for Claude Code** that keeps you in control. Claude drafts the script, the voices and the storyboard, but no stage moves on without your approval. A scene can use only the characters, actions, cameras and places in the library, so the AI cannot invent scenes.

> Status: **v0.1.0, early release.** The engine, approval gates and control panel work. The starter pack is small and will grow.

## What it does
- **Episode files bound to the library.** An episode is one `bolum.json` file. An action, camera or character that is not in the library is refused.
- **Approval gates.** Script, audio, storyboard and render run in order. Each approval is tied to a fingerprint of what you approved. When the content changes, the approval goes stale and the render is refused.
- **Film grammar.** `dogrula` checks the rules automatically:
  - an opening that does not establish the place
  - an unmotivated insert
  - a jump cut
  - a flipped screen direction
  - a front or back view that walks sideways
- **Anatomy checks.** Every character declares joint limits. A pose that would break an arm or a knee is an error before anything is rendered.
- **Turkish voices** (Edge TTS: Microsoft's free online neural voices; needs internet, only the line text is sent):
  - ready voices (woman, man, deep man, old man, child), pitch and rate, feelings
  - word timings and mouth shapes come out automatically (Edge, Rhubarb)
- **Control panel** (`cizgi panel`). A local web page where you pick shots, change them from library dropdowns, watch a live preview and save.
- **Video review** (`cizgi qa`). Pulls 4 frames per second out of a rendered video. No video is shown to anyone before it is watched frame by frame.
- **Two formats:** 16:9 for YouTube, 9:16 for Reels and Shorts. Rendering uses [HyperFrames](https://github.com/heygen-com/hyperframes).
- **Ages 0-3 profile.** Tempo, repetition and content rules based on child-development research.

## Starter pack (CC0)
| Kind | Contents |
|---|---|
| Characters | **Ela** (a girl of about six; front and profile), **Pamuk** (a teddy bear), **Genç** (a young man; profile, front 3/4, back 3/4) |
| Actions | wait, wave, clap, jump, walk, child walk, walk away, notice, walk in and notice, crouch and pick up, look, look at what you hold |
| Places | meadow, street (+ street in depth), child's room, park |
| Props | plastic bottle |
| Sound effects | 20 short sounds: footsteps (grass, concrete, wood, carpet), door, book, click, pop and more ([sources](plugins/cizgi-studyo/library/sfx/KAYNAKLAR.md)) |
| Cameras | wide, medium, close-up, medium close-up, insert; static, push in, pull out, pan, follow, dolly forward, open from an insert |

To draw a new character, follow the [rig specification](docs/RIG-SPEC.md).

## Install
Requirements:
- [Claude Code](https://docs.claude.com/claude-code)
- Node.js 20 or later
- ffmpeg on the PATH

In Claude Code:

```
/plugin marketplace add fatihgun1/claude-video-skill
/plugin install cizgi-studyo@cizgi-studyo
```

Or, from a downloaded copy:

```
/plugin marketplace add /path/to/cizgi-studyo
```

On first use the engine's single dependency is installed (Claude does this itself):

```bash
npm install --prefix plugins/cizgi-studyo/engine
```

### For voices (optional)
Silent episodes work without these. Speaking needs internet; no GPU is needed.

1. **Voice environment:** a Python environment with `pip install edge-tts`.
2. **Mouth shapes:** [Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync) 1.14.
3. **ffmpeg** (on PATH, or its path below).
4. Put the paths in `~/.cizgi-studyo/config.json`:

```json
{
  "python_tts": "/envs/tts/bin/python",
  "rhubarb": "/tools/rhubarb/rhubarb",
  "ffmpeg": "ffmpeg"
}
```

Environment variables work too: `CIZGI_PYTHON_TTS`, `CIZGI_RHUBARB`, `CIZGI_FFMPEG`.

## Use
Tell Claude what you want, for example: *"Let's make a short cartoon where Ela meets Pamuk in the park."* The skills take turns:

| Step | Skill | What you do |
|---|---|---|
| 1. Project | `cizgi-proje` | Give the topic and the audience age |
| 2. Script | `cizgi-senaryo` | Approve the script |
| 3. Audio | `cizgi-ses` | Decide on lines that failed the listening check |
| 4. Storyboard | `cizgi-storyboard` | Approve the stills and a draft video |
| 5. Adjust | `cizgi-panel` | Optionally fine-tune shots yourself in the panel |
| 6. Render | `cizgi-render` | Get the final videos |

The engine also runs on its own:

```bash
node plugins/cizgi-studyo/engine/src/cli.mjs durum ornekler/sokak/bolum.json
```

Commands:
- `dogrula`: validate the schema, library and rules
- `durum`: gate status and the next step
- `onayla`: record an approval, only after your yes
- `ses`: generate the voices
- `kabul`: keep a take that failed the listening check, with your approval
- `storyboard`: take stills of every shot
- `render`: render the video
- `qa`: review pages from a rendered video
- `panel`: open the control panel
- `derle`: compile an episode into a HyperFrames project

Example episodes are in [ornekler/](ornekler/).

## Licenses
- **Code:** [Apache-2.0](LICENSE)
- **Characters, places, props and sound effects** (`plugins/cizgi-studyo/library/`): [CC0 1.0](LICENSE-ASSETS), public domain, free for commercial work too.
- For the licenses of external tools, see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The videos you make are yours.
