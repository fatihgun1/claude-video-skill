/**
 * Voice settings, shared by the audio step (ses.mjs) and the validator: who speaks with which
 * voice, and what Edge is asked for one line. No imports from the rest of the engine.
 */

/** The voice when a character has no ready voice and the library names none. */
export const DEFAULT_EDGE_VOICE = "tr-TR-EmelNeural";

// a character's other views: the same person, drawn from the front or the back (rig "kiz-on" of "kiz")
export const VIEW_SUFFIX = /-(on|arka)$/;

/**
 * Each character's voice. A view of a person (its rig is "<rig>-on" or "<rig>-arka" of another
 * character's rig) that has no voice of its own speaks with that person's voice, so one voice
 * choice covers every view.
 * @param {object} episode
 * @returns {Record<string, object>}
 */
export function voicesOf(episode) {
  const byRig = new Map(episode.characters.map((c) => [c.rig, c]));
  const out = {};
  for (const c of episode.characters) {
    const person = !c.voice && VIEW_SUFFIX.test(c.rig) ? byRig.get(c.rig.replace(VIEW_SUFFIX, "")) : null;
    out[c.id] = c.voice || person?.voice || {};
  }
  return out;
}

/**
 * How a feeling is spoken. Edge has no speaking styles, so a feeling shifts the speed (rate, %),
 * the pitch (Hz) and the loudness (volume, %) of the speaker's own voice. Without a feeling every
 * line came out the same flat way (Test 16: "duygu aktarımı yok").
 */
// A feeling never moves the pitch: the pitch is who is speaking. Moving it per line made one
// character sound like five different people (Köşe Başı 2.16.0: "aynı karakter 5 farklı sesle
// konuşuyor"). Only the pace and the loudness change, a little.
export const MOODS = Object.freeze({
  sakin: { rate: -6, pitch: 0, volume: -4 },
  neseli: { rate: 4, pitch: 0, volume: 3 },
  heyecanli: { rate: 10, pitch: 0, volume: 6 },
  uzgun: { rate: -10, pitch: 0, volume: -8 },
  kizgin: { rate: 6, pitch: 0, volume: 10 },
  korkmus: { rate: 8, pitch: 0, volume: -3 },
});
const NO_MOOD = { rate: 0, pitch: 0, volume: 0 };
const RATE_RANGE = [-50, 100];
const PITCH_RANGE = [-80, 80];
const VOLUME_RANGE = [-50, 50];

const clamp = (x, [lo, hi]) => Math.min(hi, Math.max(lo, Math.round(x)));
const signed = (n) => (n < 0 ? String(n) : `+${n}`);

/**
 * What Edge is asked for one line: the ready voice's Edge voice and presets, the character's own
 * perde (Hz) and hiz (%), the feeling, and the profile tempo as a rate (0.85 → -15%).
 * @param {{hazir?:string, perde?:number, hiz?:number}} voice
 * @param {string|undefined} duygu
 * @param {{voices?: Map<string, {edge:string, perde?:number, hiz?:number}>}} lib
 * @param {number} [tempo]
 * @returns {{voice:string, rate:string, pitch:string, volume:string}}
 */
export function edgeSettings(voice, duygu, lib, tempo = 1) {
  const v = voice || {};
  const preset = (v.hazir && lib?.voices?.get(v.hazir)) || lib?.voices?.values().next().value || { edge: DEFAULT_EDGE_VOICE };
  const mood = MOODS[duygu] || NO_MOOD;
  const rate = clamp((preset.hiz || 0) + (v.hiz || 0) + mood.rate + (tempo - 1) * 100, RATE_RANGE);
  const pitch = clamp((preset.perde || 0) + (v.perde || 0) + mood.pitch, PITCH_RANGE);
  const volume = clamp(mood.volume, VOLUME_RANGE);
  return { voice: preset.edge || DEFAULT_EDGE_VOICE, rate: `${signed(rate)}%`, pitch: `${signed(pitch)}Hz`, volume: `${signed(volume)}%` };
}

/** Below this final speed (%) a line drags: preset, character, feeling and profile tempo add up (Faz 5.6 found -45%). */
export const SLOWEST_RATE = -30;
