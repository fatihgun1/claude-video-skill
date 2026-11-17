"""Check what the voice actually said, then time every word.

1. Transcribe each clip with Whisper and compare it with the script (character error rate).
   This catches TTS hallucinations: added sounds, swapped or dropped words.
2. Force-align the script text to the audio (wav2vec2) to get word timings.

Usage: python check_align.py jobs.json results.json
jobs.json:    [{"id", "text", "lang", "audio", "words_out"}]
results.json: [{"id", "heard", "cer"}]; each "words_out" gets [{"word", "start", "end"}]
Needs: whisperx (BSD-2), faster-whisper (MIT).
"""
import json
import re
import sys

import torch
import whisperx

SAMPLE_RATE = 16000
ASR_MODEL = "large-v3-turbo"


ONES = ["", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"]
TENS = ["", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan"]


def number_words(n: int) -> str:
    """A whole number as Turkish words, joined ("2" -> "iki", "1923" -> "bindokuzyüzyirmiüç")."""
    if n == 0:
        return "sıfır"
    out = ""
    for value, name in ((1_000_000_000, "milyar"), (1_000_000, "milyon"), (1000, "bin")):
        if n >= value:
            head, n = divmod(n, value)
            out += ("" if head == 1 and value == 1000 else number_words(head)) + name
    if n >= 100:
        head, n = divmod(n, 100)
        out += ("" if head == 1 else ONES[head]) + "yüz"
    return out + TENS[n // 10] + ONES[n % 10]


def normalise(text: str) -> str:
    """Lower-case (Turkish-aware), drop punctuation, and write digits as words: the listener writes
    "iki" as "2", which must not count as a wrong take (KPSS: a line spoken three times for it)."""
    text = text.replace("I", "ı").replace("İ", "i").lower()
    text = re.sub(r"[0-9]+", lambda m: number_words(int(m.group())) if len(m.group()) < 13 else m.group(), text)
    return " ".join(re.sub(r"[^\w ]+", " ", text).split())


def cer(expected: str, heard: str) -> float:
    # spaces do not count: "bin dokuz yüz" and "bindokuzyüz" are the same words heard
    a, b = normalise(expected).replace(" ", ""), normalise(heard).replace(" ", "")
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ca != cb)))
        previous = current
    return round(previous[-1] / max(len(a), 1), 3)


def main(jobs_path: str, results_path: str) -> None:
    with open(jobs_path, encoding="utf-8") as f:
        jobs = json.load(f)
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    compute = "float16" if dev == "cuda" else "int8"
    lang = jobs[0]["lang"] if jobs else "tr"
    asr = whisperx.load_model(ASR_MODEL, dev, compute_type=compute, language=lang)
    aligner, meta = whisperx.load_align_model(language_code=lang, device=dev)

    results = []
    for job in jobs:
        audio = whisperx.load_audio(job["audio"])
        heard = " ".join(s["text"].strip() for s in asr.transcribe(audio, batch_size=4)["segments"])
        segment = [{"text": job["text"], "start": 0.0, "end": len(audio) / SAMPLE_RATE}]
        aligned = whisperx.align(segment, aligner, meta, audio, dev, return_char_alignments=False)
        words = [{"word": w["word"], "start": w.get("start"), "end": w.get("end")} for w in aligned["word_segments"]]
        with open(job["words_out"], "w", encoding="utf-8") as f:
            json.dump(words, f, ensure_ascii=False, indent=2)
        results.append({"id": job["id"], "heard": heard, "cer": cer(job["text"], heard)})
        print(json.dumps(results[-1], ensure_ascii=False), flush=True)
        # a progress line on stderr for the panel (see panel-is.mjs)
        step = {"adim": "kontrol", "bitti": len(results), "toplam": len(jobs)}
        print("ilerleme " + json.dumps(step), file=sys.stderr, flush=True)

    with open(results_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
