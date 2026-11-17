/**
 * Every spoken line at the same, clear loudness. The voice cloner keeps the level of its reference
 * clip: in the KPSS episode half the lines came out at about -42 dB (one ready voice), the rest at
 * -26 dB, both far under the sound effects (-21 dB); the person said "ses çok az". The level is
 * set where the lines are copied into the film (compile) and where the panel plays one line, so
 * nothing needs to be spoken again.
 */
import { readFileSync, statSync } from "node:fs";
import { decodeWav } from "./dudak.mjs";

export const TARGET_DB = -20; // speech level (RMS of the voiced parts), full scale 0 dB
export const PEAK_DB = -1; // the loudest sample may not pass this
const MAX_GAIN_DB = 24; // a nearly silent take is not blown up into noise
const VOICED = 0.1; // a 20 ms frame counts as speech above this share of the line's loudest frame

const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));
const fromDb = (d) => 10 ** (d / 20);

/**
 * The gain (linear) that brings a line's speech to TARGET_DB without its peak passing PEAK_DB.
 * @param {{rate:number, samples:Float32Array}} audio
 */
export function levelGain({ rate, samples }) {
  const n = Math.max(1, Math.round(0.02 * rate));
  const frames = [];
  let peak = 0;
  for (let i = 0; i + n <= samples.length; i += n) {
    let s = 0;
    for (let j = i; j < i + n; j++) {
      s += samples[j] * samples[j];
      peak = Math.max(peak, Math.abs(samples[j]));
    }
    frames.push(Math.sqrt(s / n));
  }
  if (!frames.length || peak === 0) return 1;
  const loudest = Math.max(...frames);
  const voiced = frames.filter((f) => f >= VOICED * loudest);
  const rms = Math.sqrt(voiced.reduce((t, f) => t + f * f, 0) / voiced.length);
  const want = TARGET_DB - db(rms);
  const room = PEAK_DB - db(peak);
  return fromDb(Math.min(want, room, MAX_GAIN_DB));
}

/** A 16-bit PCM WAV of the samples (mono). */
function encode(samples, rate) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write("RIFF", 0, "latin1");
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write("WAVEfmt ", 8, "latin1");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "latin1");
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return buf;
}

const cache = new Map(); // path → {key, buf}: the preview recompiles often; a line's audio rarely changes

/**
 * A line's audio at the common level, as WAV bytes. A file this cannot read comes back unchanged.
 * @param {string} path
 * @returns {Buffer}
 */
export function levelledWav(path) {
  const st = statSync(path);
  const key = `${st.size}:${st.mtimeMs}`;
  const hit = cache.get(path);
  if (hit?.key === key) return hit.buf;
  const raw = readFileSync(path);
  let buf = raw;
  try {
    const audio = decodeWav(raw);
    const gain = levelGain(audio);
    buf = encode(audio.samples.map((v) => v * gain), audio.rate);
  } catch {
    buf = raw; // not a WAV this reads: played as it is
  }
  cache.set(path, { key, buf });
  return buf;
}
