/**
 * Background music: one library track under the whole film, faded in and out and ducked
 * under the lines, mixed here into a single WAV so the render and the panel's preview play
 * exactly the same thing (a renderer only knows one volume per sound).
 */

/** Defaults for episode.music fields left out. */
export const MUSIC_DEFAULTS = Object.freeze({ volume: 0.35, fade_in: 1, fade_out: 1.5, duck: 0.4, loop: true });
/** Seconds the music takes to dip before a line and to come back after it. */
const DUCK_RAMP = 0.3;
/** How often the mix works out the gain (seconds); in between it interpolates. */
const GAIN_STEP_S = 0.01;

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/**
 * Read a PCM 16-bit WAV.
 * @param {Buffer} buf
 * @returns {{rate:number, channels:number, samples:Int16Array}} samples interleaved
 */
export function readWav(buf) {
  const info = readWavInfo(buf);
  const samples = new Int16Array(info.bytes / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = buf.readInt16LE(info.offset + i * 2);
  return { rate: info.rate, channels: info.channels, samples };
}

const WAVE_FORMAT_PCM = 1;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

/**
 * The header of a PCM 16-bit WAV, without decoding the samples (plain or "extensible" PCM).
 * @param {Buffer} buf
 * @returns {{rate:number, channels:number, offset:number, bytes:number, duration:number}}
 */
export function readWavInfo(buf) {
  const tag = (o) => buf.toString("latin1", o, o + 4);
  if (buf.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");
  let fmt = null;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = tag(offset);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      if (size < 16 || body + 16 > buf.length) throw new Error("WAV fmt chunk is too short");
      let format = buf.readUInt16LE(body);
      // extensible: the real format is the first two bytes of the subformat GUID
      if (format === WAVE_FORMAT_EXTENSIBLE && size >= 40 && body + 26 <= buf.length) format = buf.readUInt16LE(body + 24);
      fmt = { format, channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
      if (fmt.format !== WAVE_FORMAT_PCM || fmt.bits !== 16) throw new Error("WAV must be 16-bit PCM");
      if (fmt.channels < 1) throw new Error("WAV has no channels");
      if (fmt.rate < 1) throw new Error("WAV sample rate is 0");
    } else if (id === "data") {
      if (!fmt) throw new Error("WAV data chunk before fmt chunk");
      const bytes = Math.min(size, buf.length - body) & ~1;
      return { rate: fmt.rate, channels: fmt.channels, offset: body, bytes, duration: bytes / 2 / fmt.channels / fmt.rate };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
}

/**
 * Write a PCM 16-bit WAV.
 * @param {{rate:number, channels:number, samples:Int16Array}} wav
 * @returns {Buffer}
 */
export function writeWav({ rate, channels, samples }) {
  const data = samples.length * 2;
  const buf = Buffer.alloc(44 + data);
  buf.write("RIFF", 0, "latin1");
  buf.writeUInt32LE(36 + data, 4);
  buf.write("WAVEfmt ", 8, "latin1");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * channels * 2, 28);
  buf.writeUInt16LE(channels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "latin1");
  buf.writeUInt32LE(data, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i], 44 + i * 2);
  return buf;
}

/**
 * Music gain at time t (s) of a film `duration` long: the track volume, the fades at both
 * ends, and the dip (to volume × duck) while a line is spoken, eased over DUCK_RAMP.
 * @param {number} t
 * @param {number} duration
 * @param {{volume?:number, fade_in?:number, fade_out?:number, duck?:number}} music
 * @param {{start:number, end:number}[]} speech
 */
export function musicGain(t, duration, music, speech) {
  return gainOf(t, duration, { ...MUSIC_DEFAULTS, ...music }, speech);
}

/** musicGain with the defaults already filled in (no object per call). */
function gainOf(t, duration, m, speech) {
  const fadeIn = m.fade_in > 0 ? clamp01(t / m.fade_in) : 1;
  const fadeOut = m.fade_out > 0 ? clamp01((duration - t) / m.fade_out) : 1;
  let under = 0; // 1 while a line is spoken, easing to 0 around it
  for (const s of speech) {
    const w = t >= s.start && t <= s.end ? 1 : t < s.start ? 1 - (s.start - t) / DUCK_RAMP : 1 - (t - s.end) / DUCK_RAMP;
    under = Math.max(under, clamp01(w));
  }
  return m.volume * fadeIn * fadeOut * (1 - (1 - m.duck) * under);
}

/**
 * The music for a whole film: the track looped (or played once), shaped by musicGain.
 * @param {{rate:number, channels:number, samples:Int16Array}} track
 * @param {number} duration seconds
 * @param {object} music episode.music
 * @param {{start:number, end:number}[]} speech
 */
export function mixMusic(track, duration, music, speech) {
  const { rate, channels } = track;
  const frames = Math.round(duration * rate);
  const trackFrames = Math.floor(track.samples.length / channels);
  const m = { ...MUSIC_DEFAULTS, ...music };
  const samples = new Int16Array(frames * channels);
  if (!trackFrames) return { rate, channels, samples };
  // The gain changes slowly (ramps of 0.3 s and more): work it out every GAIN_STEP_S and
  // interpolate in between, instead of for every sample.
  const block = Math.max(1, Math.round(rate * GAIN_STEP_S));
  const spans = speech.filter((s) => s.end + DUCK_RAMP >= 0 && s.start - DUCK_RAMP <= duration);
  let g0 = gainOf(0, duration, m, spans);
  for (let b = 0; b < frames; b += block) {
    const end = Math.min(frames, b + block);
    const g1 = gainOf(end / rate, duration, m, spans);
    for (let i = b; i < end; i++) {
      if (!m.loop && i >= trackFrames) return { rate, channels, samples };
      const g = g0 + ((g1 - g0) * (i - b)) / (end - b);
      const src = (i % trackFrames) * channels;
      for (let c = 0; c < channels; c++) samples[i * channels + c] = Math.round(track.samples[src + c] * g);
    }
    g0 = g1;
  }
  return { rate, channels, samples };
}
