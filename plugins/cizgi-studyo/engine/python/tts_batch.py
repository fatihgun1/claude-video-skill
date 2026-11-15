"""Speak every job in one process (the model loads once).

Usage: python tts_batch.py jobs.json
jobs.json: [{"id", "text", "lang", "out", "seed", "voice": {"ref"?, "exaggeration"?, "cfg"?}}]
Writes each "out" WAV. Prints one JSON line per finished job.
Needs: chatterbox-tts (MIT), torch with CUDA if available.
"""
import json
import sys

import torch
import torchaudio as ta
from chatterbox.mtl_tts import ChatterboxMultilingualTTS

DEFAULT_EXAGGERATION = 0.5
DEFAULT_CFG = 0.5


def device() -> str:
    return "cuda" if torch.cuda.is_available() else "cpu"


def main(jobs_path: str) -> None:
    with open(jobs_path, encoding="utf-8") as f:
        jobs = json.load(f)
    model = ChatterboxMultilingualTTS.from_pretrained(device=device())
    for job in jobs:
        voice = job.get("voice") or {}
        torch.manual_seed(int(job["seed"]))
        wav = model.generate(
            job["text"],
            language_id=job["lang"],
            audio_prompt_path=voice.get("ref"),
            exaggeration=voice.get("exaggeration", DEFAULT_EXAGGERATION),
            cfg_weight=voice.get("cfg", DEFAULT_CFG),
        )
        ta.save(job["out"], wav, model.sr)
        print(json.dumps({"id": job["id"], "seconds": round(wav.shape[-1] / model.sr, 3)}), flush=True)


if __name__ == "__main__":
    main(sys.argv[1])
