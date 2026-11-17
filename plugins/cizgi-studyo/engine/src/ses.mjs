/**
 * Audio step: speak every line, slow it to the profile tempo, check it, time the words,
 * derive mouth shapes. Only lines whose text or voice changed are redone.
 *
 * Per line, next to the episode:  ses/<shot>-<n>.wav  .words.json  .rhubarb.json
 * Bookkeeping:                    ses/manifest.json   {lines: {<shot>-<n>: {fingerprint, cer, heard, ok, attempts}}}
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readJson } from "./util.mjs";
import { audioPathFor, safeJoin } from "./compile.mjs";
import { validateEpisode, profileOf, NARRATOR } from "./validate.mjs";
import { readApprovals, requireGate, scriptFingerprint } from "./onay.mjs";
import { requireTools } from "./tools.mjs";

const PYTHON_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "python");
const TTS_ENGINE = "chatterbox-mtl/1";
const MANIFEST = join("ses", "manifest.json");

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
 * How a feeling is spoken: Chatterbox's exaggeration (more = livelier, more expressive) and cfg
 * (less = slower, more drawn out). Without a feeling every line came out the same flat way (Test 16:
 * "duygu aktarımı yok").
 */
export const MOODS = {
  sakin: { exaggeration: 0.35, cfg: 0.5 },
  neseli: { exaggeration: 0.75, cfg: 0.4 },
  heyecanli: { exaggeration: 0.95, cfg: 0.3 },
  uzgun: { exaggeration: 0.5, cfg: 0.3 },
  kizgin: { exaggeration: 1.05, cfg: 0.35 },
  korkmus: { exaggeration: 0.8, cfg: 0.3 },
};

/**
 * Every spoken line of an episode with its voice settings.
 * @param {object} episode
 * @returns {{key:string, shot_id:string, index:number, speaker:string, text:string, path:string, voice:object}[]}
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
        voice: u.duygu && MOODS[u.duygu] ? { ...(voices[u.speaker] || {}), ...MOODS[u.duygu] } : voices[u.speaker] || {},
      })),
    ),
  );
}

/**
 * What a line sounds like; any change means it must be spoken again.
 * @param {{text:string, voice:object}} line
 * @param {string} language
 * @param {number} tempo
 * @returns {string}
 */
export function lineFingerprint(line, language, tempo) {
  return sha({ engine: TTS_ENGINE, text: line.text, language, tempo, voice: line.voice }).slice(0, 16);
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

/**
 * The voice as the TTS reads it: the clip to clone is the person's recording (voice.ref, next to
 * the episode) or else a ready voice from the library (voice.hazir).
 */
export function ttsVoice(voice, abs, lib) {
  const { hazir, ...rest } = voice || {};
  if (rest.ref) return { ...rest, ref: abs(rest.ref) };
  const ready = hazir && lib?.voices?.get(hazir);
  return ready ? { ...rest, ref: ready.path } : rest;
}

/** Stable integer seed per line and attempt, so a rerun reproduces the same take; take > 0 is another one. */
function seedFor(key, attempt, take = 0) {
  return parseInt(sha(key).slice(0, 7), 16) + attempt * 7919 + take * 104729;
}

/**
 * Run the audio step for an episode.
 * @param {string} episodePath
 * @param {ReturnType<import("./library.mjs").loadLibrary>} lib
 * @param {ReturnType<import("./tools.mjs").loadTools>} tools
 * @param {{run: (cmd:string, args:string[]) => string, force?: boolean, log?: (msg:string) => void}} deps
 * @returns {{generated: string[], kept: string[], failed: {key:string, cer:number, heard:string}[]}}
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
  const manifest = existsSync(manifestPath) ? readJson(manifestPath) : { lines: {} };
  const lines = linesOf(episode);
  const fp = (line) => lineFingerprint(line, episode.language, speech.tempo);
  const abs = (rel) => safeJoin(dir, rel);
  const { todo, keep } = planAudio(lines, manifest, fp, (p) => existsSync(abs(p)), deps);
  if (!todo.length) return { generated: [], kept: keep.map((l) => l.key), failed: [] };
  // Tools are only needed when there is something to speak (a silent episode needs none).
  requireTools(tools, ["pythonTts", "pythonAlign", "rhubarb"]);

  const work = join(dir, ".cizgi", "ses");
  mkdirSync(work, { recursive: true });
  for (const line of todo) mkdirSync(dirname(abs(line.path)), { recursive: true });

  const results = {};
  let pending = todo;
  for (let attempt = 0; attempt <= speech.retries && pending.length; attempt++) {
    log(`attempt ${attempt + 1}: speaking ${pending.length} line(s)`);
    const raw = (line) => join(work, `${line.key}.raw.wav`);
    const jobs = pending.map((line) => ({
      id: line.key,
      text: line.text,
      lang: episode.language,
      out: raw(line),
      seed: seedFor(line.key, attempt, deps.take || 0),
      voice: ttsVoice(line.voice, abs, lib),
    }));
    writeFileSync(join(work, "tts.json"), JSON.stringify(jobs, null, 2));
    progress("seslendirme", 0, pending.length); // the model loads first: the step has begun
    deps.run(tools.pythonTts, [join(PYTHON_DIR, "tts_batch.py"), join(work, "tts.json")], { liveStderr: true });

    for (const line of pending) {
      if (speech.tempo === 1) copyFileSync(raw(line), abs(line.path));
      else deps.run(tools.ffmpeg, ["-y", "-v", "error", "-i", raw(line), "-filter:a", `atempo=${speech.tempo}`, abs(line.path)]);
    }

    const checks = pending.map((line) => ({
      id: line.key,
      text: line.text,
      lang: episode.language,
      audio: abs(line.path),
      words_out: abs(line.path).replace(/\.wav$/i, ".words.json"),
    }));
    writeFileSync(join(work, "check.json"), JSON.stringify(checks, null, 2));
    progress("kontrol", 0, pending.length);
    deps.run(tools.pythonAlign, [join(PYTHON_DIR, "check_align.py"), join(work, "check.json"), join(work, "check-results.json")], { liveStderr: true });
    for (const r of readJson(join(work, "check-results.json"))) results[r.id] = { ...r, attempts: attempt + 1 };

    pending = pending.filter((line) => !(results[line.key]?.cer <= speech.max_cer));
  }

  progress("agiz", 0, todo.length);
  todo.forEach((line, i) => {
    const wav = abs(line.path);
    deps.run(tools.rhubarb, ["-r", "phonetic", "-f", "json", "--extendedShapes", "GHX", "-q", "-o", wav.replace(/\.wav$/i, ".rhubarb.json"), wav]);
    progress("agiz", i + 1, todo.length);
  });

  const nextLines = { ...manifest.lines };
  for (const line of todo) {
    const r = results[line.key] || { cer: 1, heard: "", attempts: speech.retries + 1 };
    nextLines[line.key] = { fingerprint: fp(line), text: line.text, heard: r.heard, cer: r.cer, ok: r.cer <= speech.max_cer, attempts: r.attempts };
  }
  const known = new Set(lines.map((l) => l.key));
  const next = { lines: Object.fromEntries(Object.entries(nextLines).filter(([k]) => known.has(k))) };
  writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`);

  const failed = failedLines({ lines: Object.fromEntries(todo.map((l) => [l.key, next.lines[l.key]])) });
  return { generated: todo.map((l) => l.key), kept: keep.map((l) => l.key), failed };
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
 * Lines that failed the listening check and were not accepted by the person.
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
 * narrator's), slowed to the profile tempo, written to cikti/ses-ornegi-<id>.wav. It is for choosing
 * a voice before the lines are spoken: no script approval, no listening check, no mouth shapes, and
 * the episode's own audio (ses/) is left alone.
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
  const raw = join(work, `${karakter}.raw.wav`);
  const voice = voices[karakter];
  writeFileSync(join(work, "tts.json"), JSON.stringify([{
    id: `ornek-${karakter}`, text, lang: episode.language, out: raw, seed: seedFor(`ornek-${karakter}`, 0),
    voice: ttsVoice(voice, (rel) => safeJoin(dir, rel), lib),
  }], null, 2));
  (deps.log || (() => {}))(`ilerleme ${JSON.stringify({ adim: "seslendirme", bitti: 0, toplam: 1 })}`);
  deps.run(tools.pythonTts, [join(PYTHON_DIR, "tts_batch.py"), join(work, "tts.json")], { liveStderr: true });
  const dosya = `cikti/ses-ornegi-${karakter}.wav`;
  mkdirSync(join(dir, "cikti"), { recursive: true });
  const tempo = profileOf(episode, lib).speech.tempo;
  if (tempo === 1) copyFileSync(raw, join(dir, dosya));
  else deps.run(tools.ffmpeg || "ffmpeg", ["-y", "-v", "error", "-i", raw, "-filter:a", `atempo=${tempo}`, join(dir, dosya)]);
  return { karakter, metin: text, dosya };
}
