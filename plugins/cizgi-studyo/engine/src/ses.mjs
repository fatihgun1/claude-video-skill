/**
 * Audio step: speak every line with Microsoft Edge's online neural voices (edge-tts, needs
 * internet; only the line text goes to the service), time its words, derive mouth shapes. Edge
 * reads the text as written and reports exact word timings, so there is no listening check.
 * Only lines whose text, voice or feeling changed are redone. One voice job at a time (ses-kilit.mjs).
 *
 * Per line, next to the episode:  ses/<shot>-<n>.wav  .words.json  .rhubarb.json
 * Bookkeeping:                    ses/manifest.json   {lines: {<shot>-<n>: {fingerprint, text, ok, attempts}}}
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { readJson } from "./util.mjs";
import { audioPathFor, safeJoin } from "./compile.mjs";
import { validateEpisode, profileOf, NARRATOR } from "./validate.mjs";
import { readApprovals, requireGate, scriptFingerprint } from "./onay.mjs";
import { requireTools } from "./tools.mjs";
import { withVoiceLock } from "./ses-kilit.mjs";

const PYTHON_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "python");
const TTS_SCRIPT = join(PYTHON_DIR, "tts_edge.py");
const TTS_ENGINE = "edge-tts/1";
const MANIFEST = join("ses", "manifest.json");
/** The voice when a character has no ready voice and the library names none. */
export const DEFAULT_EDGE_VOICE = "tr-TR-EmelNeural";

function sha(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

// a character's other views: the same person, drawn from the front or the back (rig "kiz-on" of "kiz")
const VIEW_SUFFIX = /-(on|arka)$/;

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
 * The character whose voice a character speaks with: itself, or the person it is a view of.
 * @returns {string} character id
 */
export function voiceOwner(episode, id) {
  const c = episode.characters.find((x) => x.id === id);
  if (!c || c.voice || !VIEW_SUFFIX.test(c.rig)) return id;
  return episode.characters.find((x) => x.rig === c.rig.replace(VIEW_SUFFIX, ""))?.id || id;
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

/**
 * Every spoken line of an episode with its voice settings.
 * @param {object} episode
 * @returns {{key:string, shot_id:string, index:number, speaker:string, text:string, path:string, voice:object, duygu?:string}[]}
 */
export function linesOf(episode) {
  const voices = voicesOf(episode);
  voices[NARRATOR] = episode.narrator_voice || {};
  return episode.scenes.flatMap((scene) =>
    scene.shots.flatMap((shot) =>
      (shot.utterances || []).map((u, index) => ({
        key: `${shot.shot_id}-${index}`,
        shot_id: shot.shot_id,
        index,
        speaker: u.speaker,
        text: u.text,
        path: audioPathFor(u, shot, index),
        voice: voices[u.speaker] || {},
        ...(u.duygu && MOODS[u.duygu] ? { duygu: u.duygu } : {}),
      })),
    ),
  );
}

/**
 * What a line sounds like; any change means it must be spoken again.
 * @param {{text:string, voice:object, duygu?:string}} line
 * @param {string} language
 * @param {number} tempo
 * @returns {string}
 */
export function lineFingerprint(line, language, tempo) {
  // the feeling by what it does, not only its name: retuning MOODS speaks those lines again
  return sha({ engine: TTS_ENGINE, text: line.text, language, tempo, voice: line.voice, duygu: line.duygu || null, mood: MOODS[line.duygu] || null }).slice(0, 16);
}

/**
 * Split lines into those to (re)generate and those already up to date.
 * @param {ReturnType<typeof linesOf>} lines
 * @param {{lines?: Record<string, {fingerprint: string, ok: boolean}>}|null} manifest
 * @param {(line) => string} fingerprintOf
 * @param {(path: string) => boolean} fileExists
 * @param {{force?: boolean}} [opts]
 * @returns {{todo: object[], keep: object[]}}
 */
export function planAudio(lines, manifest, fingerprintOf, fileExists, opts = {}) {
  if (opts.only) {
    // one line spoken again (a new take), the others left as they are
    if (!lines.some((l) => l.key === opts.only)) throw new Error(`no line "${opts.only}" in this episode`);
    return { todo: lines.filter((l) => l.key === opts.only), keep: lines.filter((l) => l.key !== opts.only) };
  }
  const known = manifest?.lines || {};
  const todo = [];
  const keep = [];
  for (const line of lines) {
    const prev = known[line.key];
    const fresh = prev && prev.fingerprint === fingerprintOf(line) && fileExists(line.path);
    (fresh && !opts.force ? keep : todo).push(line);
  }
  return { todo, keep };
}

/** Speak jobs [{id, text, voice, rate, pitch, volume, out}] with tts_edge.py (wav + words.json each). */
function speak(jobs, workFile, tools, deps) {
  writeFileSync(workFile, JSON.stringify(jobs, null, 2));
  deps.run(tools.pythonTts, [TTS_SCRIPT, workFile, "--ffmpeg", tools.ffmpeg || "ffmpeg"], { liveStderr: true });
}

const lockOpts = (deps, log) => ({ lockPath: deps.lockPath, waitMs: deps.lockWaitMs, log });

/**
 * Run the audio step for an episode.
 * @param {string} episodePath
 * @param {ReturnType<import("./library.mjs").loadLibrary>} lib
 * @param {ReturnType<import("./tools.mjs").loadTools>} tools
 * @param {{run: (cmd:string, args:string[]) => string, force?: boolean, only?: string, log?: (msg:string) => void,
 *          lockPath?: string, lockWaitMs?: number}} deps
 * @returns {{generated: string[], kept: string[], failed: {key:string}[]}}
 */
export function runAudio(episodePath, lib, tools, deps) {
  const log = deps.log || (() => {});
  // "ilerleme {json}": how far a step is, read by the panel's audio job (panel-is.mjs)
  const progress = (adim, bitti, toplam) => log(`ilerleme ${JSON.stringify({ adim, bitti, toplam })}`);
  const episode = readJson(episodePath);
  const { ok, errors } = validateEpisode(episode, lib);
  if (!ok) throw new Error(`episode is invalid:\n- ${errors.join("\n- ")}`);
  requireGate(readApprovals(episodePath), "senaryo", scriptFingerprint(episode));
  const dir = dirname(resolve(episodePath));
  const speech = profileOf(episode, lib).speech;
  const manifestPath = join(dir, MANIFEST);
  const lines = linesOf(episode);
  const fp = (line) => lineFingerprint(line, episode.language, speech.tempo);
  const abs = (rel) => safeJoin(dir, rel);
  const plan = (manifest) => planAudio(lines, manifest, fp, (p) => existsSync(abs(p)), deps);
  const readNow = () => (existsSync(manifestPath) ? readJson(manifestPath) : { lines: {} });
  if (!plan(readNow()).todo.length) return { generated: [], kept: lines.map((l) => l.key), failed: [] };
  // Tools are only needed when there is something to speak (a silent episode needs none).
  requireTools(tools, ["pythonTts", "rhubarb"]);

  return withVoiceLock(resolve(episodePath), () => {
    // read again under the lock: a job that ran meanwhile may have spoken these lines already
    const manifest = readNow();
    const { todo, keep } = plan(manifest);
    if (!todo.length) return { generated: [], kept: keep.map((l) => l.key), failed: [] };
    const work = join(dir, ".cizgi", "ses");
    mkdirSync(work, { recursive: true });
    for (const line of todo) mkdirSync(dirname(abs(line.path)), { recursive: true });

    log(`speaking ${todo.length} line(s) with Edge TTS`);
    const jobs = todo.map((line) => ({ id: line.key, text: line.text, ...edgeSettings(line.voice, line.duygu, lib, speech.tempo), out: abs(line.path) }));
    speak(jobs, join(work, "tts.json"), tools, deps);

    progress("agiz", 0, todo.length);
    todo.forEach((line, i) => {
      const wav = abs(line.path);
      deps.run(tools.rhubarb, ["-r", "phonetic", "-f", "json", "--extendedShapes", "GHX", "-q", "-o", wav.replace(/\.wav$/i, ".rhubarb.json"), wav]);
      progress("agiz", i + 1, todo.length);
    });

    const nextLines = { ...manifest.lines };
    for (const line of todo) nextLines[line.key] = { fingerprint: fp(line), text: line.text, ok: true, attempts: 1 };
    const known = new Set(lines.map((l) => l.key));
    const next = { lines: Object.fromEntries(Object.entries(nextLines).filter(([k]) => known.has(k))) };
    writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`);
    return { generated: todo.map((l) => l.key), kept: keep.map((l) => l.key), failed: [] };
  }, lockOpts(deps, log));
}

/**
 * @param {string} episodePath
 * @returns {object|null} ses/manifest.json or null
 */
export function readManifest(episodePath) {
  const path = join(dirname(resolve(episodePath)), MANIFEST);
  return existsSync(path) ? readJson(path) : null;
}

/**
 * Lines that failed a listening check and were not accepted by the person (Edge lines never do;
 * a manifest left by the old engine may still list some until they are spoken again).
 * @param {object|null} manifest
 * @returns {{key:string, cer:number, heard:string}[]}
 */
export function failedLines(manifest) {
  return Object.entries(manifest?.lines || {})
    .filter(([, v]) => !v.ok && !v.accepted)
    .map(([key, v]) => ({ key, cer: v.cer, heard: v.heard }));
}

/**
 * Record that the person listened to a failed take and accepts it as it is.
 * Only call this after they said so. Regenerating the line clears the acceptance.
 * @param {string} episodePath
 * @param {string} key line key, e.g. "s1_sh1-1"
 * @returns {object} the updated manifest entry
 */
export function acceptLine(episodePath, key) {
  const manifest = readManifest(episodePath);
  const entry = manifest?.lines?.[key];
  if (!entry) throw new Error(`no generated line "${key}" (run the audio step first)`);
  const next = { ...manifest, lines: { ...manifest.lines, [key]: { ...entry, accepted: true } } };
  writeFileSync(join(dirname(resolve(episodePath)), MANIFEST), `${JSON.stringify(next, null, 2)}\n`);
  return next.lines[key];
}

/** What a character says in a sample when it has no line yet. */
export const SAMPLE_TEXT = Object.freeze({
  tr: "Merhaba. Bugün hava çok güzel, biraz yürüyelim mi?",
  en: "Hello. It is a lovely day, shall we take a walk?",
});

/**
 * A voice sample: one sentence in a character's voice settings (characters[].voice, or the
 * narrator's), at the profile tempo, written to cikti/ses-ornegi-<id>.wav. It is for choosing a
 * voice before the lines are spoken: no script approval, no mouth shapes, and the episode's own
 * audio (ses/) is left alone.
 * @param {{karakter: string, metin?: string}} what  metin: the sentence (default: its first line, else SAMPLE_TEXT)
 * @returns {{karakter: string, metin: string, dosya: string}}
 */
export function voiceSample(episodePath, lib, tools, deps, { karakter, metin } = {}) {
  const episode = readJson(episodePath);
  const { ok, errors } = validateEpisode(episode, lib);
  if (!ok) throw new Error(`episode is invalid:\n- ${errors.join("\n- ")}`);
  const voices = voicesOf(episode); // a view speaks with its person's voice
  voices[NARRATOR] = episode.narrator_voice || {};
  if (!Object.hasOwn(voices, karakter)) throw new Error(`no character "${karakter}" in this episode (${Object.keys(voices).join(", ")})`);
  const first = linesOf(episode).find((l) => l.speaker === karakter);
  const text = (typeof metin === "string" && metin.trim()) || first?.text || SAMPLE_TEXT[episode.language] || SAMPLE_TEXT.en;
  requireTools(tools, ["pythonTts"]);
  const dir = dirname(resolve(episodePath));
  const work = join(dir, ".cizgi", "ses-ornek");
  mkdirSync(work, { recursive: true });
  const raw = join(work, `${karakter}.wav`);
  const tempo = profileOf(episode, lib).speech.tempo;
  const log = deps.log || (() => {});
  withVoiceLock(resolve(episodePath), () => {
    log(`ilerleme ${JSON.stringify({ adim: "seslendirme", bitti: 0, toplam: 1 })}`);
    speak([{ id: `ornek-${karakter}`, text, ...edgeSettings(voices[karakter], undefined, lib, tempo), out: raw }], join(work, "tts.json"), tools, deps);
  }, lockOpts(deps, log));
  const dosya = `cikti/ses-ornegi-${karakter}.wav`;
  mkdirSync(join(dir, "cikti"), { recursive: true });
  copyFileSync(raw, join(dir, dosya));
  return { karakter, metin: text, dosya };
}

/** The sentence a ready voice says when the person listens to it in the panel. */
export const PREVIEW_TEXT = "Merhaba! Ben bu sesle konuşurum. Nasıl, beğendin mi?";

/**
 * A ready voice heard before it is chosen (the panel's ▶ on a voice card): one sentence, cached in
 * ~/.cizgi-studyo/ses-onizleme so each preset is fetched from Edge once.
 * @param {string} hazir a ready voice id
 * @returns {string|null} the WAV's path, or null when there is no such voice
 */
export function readyVoicePreview(lib, tools, deps, hazir, cacheDir = join(homedir(), ".cizgi-studyo", "ses-onizleme")) {
  if (!lib.voices?.has(hazir)) return null;
  const settings = edgeSettings({ hazir }, undefined, lib);
  const out = join(cacheDir, `${hazir}-${sha({ engine: TTS_ENGINE, settings, text: PREVIEW_TEXT }).slice(0, 12)}.wav`);
  if (existsSync(out)) return out;
  requireTools(tools, ["pythonTts"]);
  mkdirSync(cacheDir, { recursive: true });
  speak([{ id: `onizleme-${hazir}`, text: PREVIEW_TEXT, ...settings, out }], join(cacheDir, "tts.json"), tools, deps);
  return out;
}
