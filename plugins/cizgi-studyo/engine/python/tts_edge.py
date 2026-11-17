"""Speak every job with Microsoft Edge's online neural voices (edge-tts, LGPL-3.0, installed separately). Needs internet.

Only the line text and the voice settings go to Microsoft's service.

Usage: python tts_edge.py jobs.json [--ffmpeg PATH]
jobs.json: [{"id", "text", "voice", "rate", "pitch", "volume", "out"}]
  voice  an Edge voice name, e.g. "tr-TR-EmelNeural"
  rate   "+0%"   pitch "+0Hz"   volume "+0%"
  out    the WAV to write (16-bit mono); its word timings go next to it as <out>.words.json,
         [{"word", "start", "end"}] in seconds, one entry per word of the text as written.
Prints one JSON line per finished job, and progress lines on stderr (see panel-is.mjs).
Exit 2 when the service cannot be reached.
"""
import asyncio
import json
import os
import re
import sys

import aiohttp
import edge_tts

CONCURRENCY = 4
ATTEMPTS = 3
SAMPLE_RATE = 24000
TICKS_PER_SECOND = 10_000_000  # Edge reports offsets in 100 ns ticks
TAIL_SECONDS = 0.15  # kept after the last word: Edge pads about a second of silence at the end
NETWORK_ERRORS = (aiohttp.ClientError, asyncio.TimeoutError, OSError, edge_tts.exceptions.WebSocketError)
UNREACHABLE = "internet yok / Edge servisine ulaşılamadı (seslendirme için internet gerekir)"


class Unreachable(Exception):
    """The Edge service could not be reached after every attempt."""


def core(text: str) -> str:
    """Letters and digits only, lower-case: what Edge's word events and the script share."""
    return "".join(ch for ch in text.lower() if ch.isalnum())


def script_words(text: str, events: list) -> list:
    """The script's own words (with their punctuation) timed by Edge's word events.

    Edge drops punctuation ("Kerem?!" -> "Kerem") and may split a word in two; a word made only of
    punctuation ("...") gets no timing.
    """
    out = []
    j = 0
    for token in text.split():
        want = core(token)
        if not want or j >= len(events):
            out.append({"word": token, "start": None, "end": None})
            continue
        first = j
        got = core(events[j][0])
        j += 1
        while got != want and j < len(events) and want.startswith(got + core(events[j][0])):
            got += core(events[j][0])
            j += 1
        out.append({"word": token, "start": round(events[first][1], 3), "end": round(events[j - 1][2], 3)})
    return out


async def synthesise(job: dict) -> tuple:
    audio = bytearray()
    events = []
    comm = edge_tts.Communicate(
        job["text"], job["voice"], rate=job.get("rate", "+0%"), pitch=job.get("pitch", "+0Hz"),
        volume=job.get("volume", "+0%"), boundary="WordBoundary",
    )
    async for chunk in comm.stream():
        if chunk["type"] == "audio":
            audio += chunk["data"]
        elif chunk["type"] == "WordBoundary":
            start = chunk["offset"] / TICKS_PER_SECOND
            events.append((chunk["text"], start, start + chunk["duration"] / TICKS_PER_SECOND))
    if not audio:
        raise edge_tts.exceptions.NoAudioReceived("no audio")
    return bytes(audio), events


async def to_wav(ffmpeg: str, mp3: str, wav: str, seconds: float) -> None:
    """16-bit mono WAV, cut a little after the last word (no long silent tail)."""
    cut = ["-t", f"{seconds + TAIL_SECONDS:.3f}"] if seconds > 0 else []
    proc = await asyncio.create_subprocess_exec(
        ffmpeg, "-y", "-v", "error", "-i", mp3, *cut, "-ac", "1", "-ar", str(SAMPLE_RATE), "-c:a", "pcm_s16le", wav,
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
    )
    _, err = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg could not convert {mp3}: {err.decode(errors='replace').strip()}")


async def run_job(job: dict, ffmpeg: str, gate: asyncio.Semaphore) -> dict:
    async with gate:
        last = None
        for attempt in range(ATTEMPTS):
            try:
                audio, events = await synthesise(job)
                break
            except edge_tts.exceptions.NoAudioReceived as err:
                last = err  # a hiccup of the service: try again
            except NETWORK_ERRORS as err:
                last = Unreachable(f"{UNREACHABLE} ({type(err).__name__})")
            await asyncio.sleep(1 + attempt)
        else:
            raise last if isinstance(last, Unreachable) else RuntimeError(f"Edge gave no audio for line {job['id']}: {last}")
        mp3 = re.sub(r"\.wav$", "", job["out"], flags=re.I) + ".mp3"
        with open(mp3, "wb") as f:
            f.write(audio)
        seconds = events[-1][2] if events else 0
        await to_wav(ffmpeg, mp3, job["out"], seconds)
        os.remove(mp3)
        words_out = re.sub(r"\.wav$", "", job["out"], flags=re.I) + ".words.json"
        with open(words_out, "w", encoding="utf-8") as f:
            json.dump(script_words(job["text"], events), f, ensure_ascii=False, indent=2)
        return {"id": job["id"], "seconds": round(seconds, 3)}


def progress(done: int, total: int) -> None:
    print("ilerleme " + json.dumps({"adim": "seslendirme", "bitti": done, "toplam": total}), file=sys.stderr, flush=True)


async def main(jobs: list, ffmpeg: str) -> None:
    gate = asyncio.Semaphore(CONCURRENCY)
    done = 0
    progress(0, len(jobs))

    async def one(job: dict) -> None:
        nonlocal done
        print(json.dumps(await run_job(job, ffmpeg, gate)), flush=True)
        done += 1
        progress(done, len(jobs))

    results = await asyncio.gather(*[one(j) for j in jobs], return_exceptions=True)
    errors = [r for r in results if isinstance(r, BaseException)]
    if errors:
        # no internet is the one thing to say first: every line failed for it
        raise next((e for e in errors if isinstance(e, Unreachable)), errors[0])


def cli(argv: list) -> int:
    ffmpeg = "ffmpeg"
    if "--ffmpeg" in argv:
        at = argv.index("--ffmpeg")
        ffmpeg = argv[at + 1]
        argv = argv[:at] + argv[at + 2:]
    with open(argv[0], encoding="utf-8") as f:
        jobs = json.load(f)
    try:
        asyncio.run(main(jobs, ffmpeg))
    except Unreachable as err:
        print(f"error: {err}", file=sys.stderr, flush=True)
        return 2
    except Exception as err:  # one clear line for the engine; the job list is not half-trusted
        print(f"error: {err}", file=sys.stderr, flush=True)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(cli(sys.argv[1:]))
