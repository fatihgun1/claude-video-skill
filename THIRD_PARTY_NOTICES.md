# Third-party notices

Çizgi Stüdyo bundles two npm packages and a set of CC0 sound effects. Everything else
is an external tool that you install yourself; it is listed here so you know its license.

## Bundled
| Component | License | Use |
|---|---|---|
| [Ajv](https://github.com/ajv-validator/ajv) 8.18.0 | MIT | Episode schema validation (npm dependency of the engine) |
| [three.js](https://github.com/mrdoob/three.js) 0.187.0 | MIT | 3D rendering for `render --3b` (npm dependency of the engine) |
| [Kenney](https://www.kenney.nl) Impact Sounds, RPG Audio, Interface Sounds | CC0 1.0 | 20 sound effects in `library/sfx/` |

## Used, not bundled
| Tool | License | Use |
|---|---|---|
| [HyperFrames](https://github.com/heygen-com/hyperframes) 0.8.229 | Apache-2.0 | HTML to MP4 rendering, run through `npx` |
| [Chatterbox](https://github.com/resemble-ai/chatterbox) (`chatterbox-tts`) | MIT (code and weights) | Text to speech. The model embeds an inaudible watermark in its output. |
| [WhisperX](https://github.com/m-bain/whisperX) | BSD-2-Clause | Listening check and word timings |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) | MIT | Speech recognition used by WhisperX |
| [Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync) 1.14 | MIT | Mouth shapes |
| [FFmpeg](https://ffmpeg.org) | LGPL-2.1+ (GPL in some builds) | Audio conversion and review pages |
| Turkish alignment model `mpoyraz/wav2vec2-xls-r-300m-cv7-turkish` | See its model card | Downloaded by WhisperX on first use |

GSAP is deliberately not used: its license forbids visual, no-code animation tools,
which the control panel is.
