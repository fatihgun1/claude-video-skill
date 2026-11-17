/**
 * Lip sync from the sound itself. Rhubarb's phonetic recogniser does not know Turkish: measured on
 * the KPSS episode, the mouth stayed open through 77% of the pauses and at the ends of lines (the
 * mouth "talked" in silence). So the cues are gated by the line's audio: wherever the sound is quiet
 * for a while, the mouth is closed (X); where it speaks, Rhubarb's shapes stay.
 */
import { readFileSync, statSync } from "node:fs";

const STEP_S = 0.01; // loudness every 10 ms
export const MIN_GAP_S = 0.08; // a quiet stretch at least this long closes the mouth
const FLOOR = 0.015; // never call louder than this silence (full scale 1)
const RELATIVE = 0.25; // … nor louder than this share of the line's loud parts (90th percentile)
const CLOSED = "X";
const ALL_QUIET = 0.95; // a "line" this quiet has no speech to gate by

/**
 * The samples of a WAV, mixed to mono, as floats in -1..1. 16-bit PCM and 32-bit float (what the
 * audio step writes) are read; anything else throws.
 * @param {Buffer} buf
 * @returns {{rate:number, samples:Float32Array}}
 */
export function decodeWav(buf) {
  const tag = (o) => buf.toString("latin1", o, o + 4);
  if (buf.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");
  let fmt = null;
  for (let at = 12; at + 8 <= buf.length;) {
    const id = tag(at);
    const size = buf.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === "fmt ") {
      let format = buf.readUInt16LE(body);
      if (format === 0xfffe && size >= 26) format = buf.readUInt16LE(body + 24); // extensible
      fmt = { format, channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    } else if (id === "data") {
      if (!fmt) throw new Error("WAV data before fmt");
      const pcm16 = fmt.format === 1 && fmt.bits === 16;
      const float32 = fmt.format === 3 && fmt.bits === 32;
      if (!pcm16 && !float32) throw new Error("WAV must be 16-bit PCM or 32-bit float");
      const width = fmt.bits / 8;
      const frames = Math.floor(Math.min(size, buf.length - body) / (width * fmt.channels));
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < fmt.channels; c++) {
          const o = body + (i * fmt.channels + c) * width;
          sum += pcm16 ? buf.readInt16LE(o) / 32768 : buf.readFloatLE(o);
        }
        samples[i] = sum / fmt.channels;
      }
      return { rate: fmt.rate, samples };
    }
    at = body + size + (size % 2);
  }
  throw new Error("WAV has no data");
}

/**
 * The quiet stretches of a line (seconds), each at least MIN_GAP_S long.
 * @param {{rate:number, samples:Float32Array}} audio
 * @returns {{start:number, end:number}[]}
 */
export function silences({ rate, samples }) {
  const n = Math.max(1, Math.round(STEP_S * rate));
  const rms = [];
  for (let i = 0; i + n <= samples.length; i += n) {
    let s = 0;
    for (let j = i; j < i + n; j++) s += samples[j] * samples[j];
    rms.push(Math.sqrt(s / n));
  }
  if (!rms.length) return [];
  const sorted = [...rms].sort((a, b) => a - b);
  const loud = sorted[Math.floor(0.9 * (sorted.length - 1))];
  const threshold = Math.max(FLOOR, RELATIVE * loud);
  const out = [];
  let from = -1;
  rms.forEach((v, i) => {
    if (v < threshold && from < 0) from = i;
    if ((v >= threshold || i === rms.length - 1) && from >= 0) {
      const to = v >= threshold ? i : i + 1;
      if ((to - from) * STEP_S >= MIN_GAP_S) out.push({ start: from * STEP_S, end: to * STEP_S });
      from = -1;
    }
  });
  // no speech found at all (a silent stand-in file): nothing to judge the mouth by
  const quietTime = out.reduce((t, q) => t + q.end - q.start, 0);
  return quietTime >= ALL_QUIET * rms.length * STEP_S ? [] : out;
}

/**
 * Close the mouth over the quiet stretches: cues are cut where they overlap one, and an X cue
 * covers it. The result is sorted and has no overlaps.
 * @param {{start:number, end:number, value:string}[]} cues
 * @param {{start:number, end:number}[]} quiet
 */
export function gateCues(cues, quiet) {
  if (!quiet.length) return cues;
  const pieces = [];
  for (const c of cues) {
    let parts = [{ ...c }];
    for (const q of quiet) {
      parts = parts.flatMap((p) => {
        if (q.end <= p.start || q.start >= p.end) return [p];
        return [
          ...(q.start > p.start ? [{ ...p, end: q.start }] : []),
          ...(q.end < p.end ? [{ ...p, start: q.end }] : []),
        ];
      });
    }
    pieces.push(...parts);
  }
  const closed = quiet.map((q) => ({ start: q.start, end: q.end, value: CLOSED }));
  return [...pieces, ...closed]
    .filter((c) => c.end - c.start > 1e-6)
    .sort((a, b) => a.start - b.start)
    .map((c) => ({ ...c, start: Math.round(c.start * 1000) / 1000, end: Math.round(c.end * 1000) / 1000 }));
}

const cache = new Map(); // wav path → {key, quiet}: the preview recompiles often; a line's audio rarely changes

/** The quiet stretches of a line's audio file, cached by size and time of change. */
export function silencesOfFile(wavPath) {
  const st = statSync(wavPath);
  const key = `${st.size}:${st.mtimeMs}`;
  const hit = cache.get(wavPath);
  if (hit?.key === key) return hit.quiet;
  let quiet;
  try {
    quiet = silences(decodeWav(readFileSync(wavPath)));
  } catch {
    quiet = []; // a WAV this module cannot read (8-bit, …): Rhubarb's cues as they are
  }
  cache.set(wavPath, { key, quiet });
  return quiet;
}
