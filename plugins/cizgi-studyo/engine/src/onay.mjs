/**
 * Approval gates. A human approves a stage; the approval stores a fingerprint of what
 * was approved. Any later change to that content makes the approval stale, and the
 * engine refuses the next stage until the human approves again.
 *
 *   senaryo     who says what, in which shot and order (the words)
 *   storyboard  everything that shapes picture and sound, incl. the generated audio
 */
import { createHash } from "node:crypto";
import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { readJson } from "./util.mjs";
import { episodeBgs } from "./arka-plan.mjs";

export const GATES = Object.freeze(["senaryo", "storyboard"]);

function sha(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

/**
 * A fingerprint may carry earlier versions after "|": the first is recorded at an approval, any of
 * them matches. Approvals given before a fingerprint grew (plan v3) stay valid until the content
 * changes, and new ones are recorded with the wider one.
 */
const ALT = "|";
const alternatives = (fingerprint) => String(fingerprint).split(ALT);

/**
 * Fingerprint of the words of an episode: who says what, in order. Shots without lines, shot ids
 * and how lines are split over shots are not words (Hurda Kralı 1: the script was approved again
 * after every shot edit).
 * @param {object} episode
 * @returns {string}
 */
export function scriptFingerprint(episode) {
  const current = sha({
    language: episode.language,
    profile: episode.profile || "genel",
    lines: episode.scenes.flatMap((scene) => scene.shots.flatMap((s) => (s.utterances || []).map((u) => [u.speaker, u.text]))),
  });
  const before = sha({
    language: episode.language,
    profile: episode.profile || "genel",
    characters: episode.characters.map((c) => c.id),
    shots: episode.scenes.flatMap((scene) =>
      scene.shots.map((s) => ({ id: s.shot_id, lines: (s.utterances || []).map((u) => [u.speaker, u.text]) })),
    ),
  });
  return `${current}${ALT}${before}`;
}

/**
 * Fingerprint of the library assets an episode uses: world layout, cameras, its profile,
 * and the actions, rigs and backgrounds it names. A library edit after approval
 * must not reach the render unseen.
 * @param {object} episode
 * @param {ReturnType<import("./library.mjs").loadLibrary>} lib
 * @returns {string}
 */
export function libraryFingerprint(episode, lib) {
  const shots = episode.scenes.flatMap((s) => s.shots);
  const actions = [...new Set(shots.flatMap((s) => s.cast.flatMap((m) => [m.action, ...(m.actions || []).map((a) => a.action)])))].sort();
  const rigs = [...new Set(episode.characters.map((c) => c.rig))].sort();
  const bgs = episodeBgs(episode).sort();
  const props = [...new Set(shots.flatMap((s) => (s.props || []).map((p) => p.prop)))].sort();
  const sounds = [...new Set(shots.flatMap((s) => (s.sfx || []).map((x) => x.sfx)))].sort();
  const before = sha({
    world: lib.world,
    cameras: lib.cameras,
    profile: lib.profiles.get(episode.profile || "genel") ?? null,
    actions: actions.map((a) => lib.actions.get(a) ?? null),
    rigs: rigs.map((r) => lib.characters.get(r)?.svg ?? null),
    backgrounds: bgs.map((b) => lib.backgrounds.get(b) ?? null),
    props: props.map((p) => lib.props?.get(p)?.svg ?? null),
    // Hash the sound itself, not its path, so replacing a WAV makes the approval stale.
    ...(sounds.length ? { sfx: sounds.map((x) => (lib.sfx?.get(x) ? sha(readFileSync(lib.sfx.get(x).path).toString("base64")) : null)) } : {}),
    // music files are large: hash the bytes directly, without a base64 copy
    ...(episode.music ? { music: lib.music?.get(episode.music.track) ? createHash("sha256").update(readFileSync(lib.music.get(episode.music.track).path)).digest("hex") : null } : {}),
  });
  // and what that left out: the character data (face_y frames the shots, limits, views), the decor
  // of the scenes, and the ready voices the speakers use (a voice without hazir speaks with the first)
  const decor = [...new Set(episode.scenes.flatMap((s) => (s.dekor || []).map((d) => d.prop)))].sort();
  const voiceIds = [...new Set([...episode.characters.map((c) => c.voice?.hazir), episode.narrator_voice?.hazir].filter(Boolean))].sort();
  const current = sha({
    before,
    characters: rigs.map((r) => lib.characters.get(r)?.meta ?? null),
    decor: decor.map((p) => lib.props?.get(p)?.svg ?? null),
    voices: voiceIds.map((v) => lib.voices?.get(v) ?? null),
    firstVoice: lib.voices?.values().next().value ?? null,
  });
  return `${current}${ALT}${before}`;
}

/**
 * Fingerprint of everything that changes the rendered film.
 * Bookkeeping fields (status, notes, revision, content_locked) are ignored.
 * @param {object} episode
 * @param {object|null} audioManifest ses/manifest.json content
 * @param {string} [libFingerprint] libraryFingerprint(episode, lib)
 * @returns {string}
 */
export function storyboardFingerprint(episode, audioManifest, libFingerprint = "") {
  // stil3d: only how a 3D render looks; the storyboard is reviewed in 2D, so choosing it changes no approval.
  // kararlar: a record of the person's choices; what they change in the film is in the episode itself.
  const { revision, content_locked, stil3d, kararlar, ...rest } = episode;
  // A scene's title is a working label (like a shot's notes): naming a scene does not change the film.
  const scenes = rest.scenes.map(({ title, ...scene }) => ({
    ...scene,
    shots: scene.shots.map(({ status, notes, ...shot }) => shot),
  }));
  const audio = audioManifest ? Object.fromEntries(Object.entries(audioManifest.lines || {}).map(([k, v]) => [k, v.fingerprint])) : null;
  // the person's accepted warnings are bookkeeping too: accepting one does not change the film
  const { kabul_uyarilar, ...film } = { ...rest, scenes };
  return alternatives(libFingerprint).map((library) => sha({ episode: film, audio, library })).join(ALT);
}

/**
 * @param {string} episodePath
 * @returns {string} path of onay.json next to the episode
 */
export function approvalsPath(episodePath) {
  return join(dirname(episodePath), "onay.json");
}

/**
 * @param {string} episodePath
 * @returns {Record<string, {fingerprint: string, at: string}>}
 */
export function readApprovals(episodePath) {
  const path = approvalsPath(episodePath);
  return existsSync(path) ? readJson(path) : {};
}

/**
 * Record a human approval. Only call this after the person said yes.
 * @param {string} episodePath
 * @param {string} gate one of GATES
 * @param {string} fingerprint
 * @param {Date} [now]
 * @returns {Record<string, {fingerprint: string, at: string}>} the new approvals
 */
export function approve(episodePath, gate, fingerprint, now = new Date()) {
  if (!GATES.includes(gate)) throw new Error(`unknown gate "${gate}" (${GATES.join(", ")})`);
  const next = { ...readApprovals(episodePath), [gate]: { fingerprint: alternatives(fingerprint)[0], at: now.toISOString() } };
  writeFileSync(approvalsPath(episodePath), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/**
 * @param {Record<string, {fingerprint: string}>} approvals
 * @param {string} gate
 * @param {string} fingerprint current fingerprint
 * @returns {"onayli"|"eskimis"|"yok"} approved, stale (content changed since), or never approved
 */
export function gateStatus(approvals, gate, fingerprint) {
  const a = approvals[gate];
  if (!a) return "yok";
  return alternatives(fingerprint).includes(a.fingerprint) ? "onayli" : "eskimis";
}

/**
 * Throw unless the gate is approved for the current content.
 * @param {Record<string, {fingerprint: string}>} approvals
 * @param {string} gate
 * @param {string} fingerprint
 */
export function requireGate(approvals, gate, fingerprint) {
  const status = gateStatus(approvals, gate, fingerprint);
  if (status === "onayli") return;
  const why = status === "yok" ? "has not been approved" : "was approved, but the content changed since";
  throw new Error(`gate "${gate}" ${why}. Show it to the person and run: cizgi onayla ${gate} <bolum.json> only after they say yes.`);
}
