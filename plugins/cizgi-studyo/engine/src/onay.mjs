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

export const GATES = Object.freeze(["senaryo", "storyboard"]);

function sha(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

/**
 * Fingerprint of the words of an episode.
 * @param {object} episode
 * @returns {string}
 */
export function scriptFingerprint(episode) {
  return sha({
    language: episode.language,
    profile: episode.profile || "genel",
    characters: episode.characters.map((c) => c.id),
    shots: episode.scenes.flatMap((scene) =>
      scene.shots.map((s) => ({ id: s.shot_id, lines: (s.utterances || []).map((u) => [u.speaker, u.text]) })),
    ),
  });
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
  const bgs = [...new Set(episode.scenes.map((s) => s.bg))].sort();
  const props = [...new Set(shots.flatMap((s) => (s.props || []).map((p) => p.prop)))].sort();
  const sounds = [...new Set(shots.flatMap((s) => (s.sfx || []).map((x) => x.sfx)))].sort();
  return sha({
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
  const { revision, content_locked, ...rest } = episode;
  const scenes = rest.scenes.map((scene) => ({
    ...scene,
    shots: scene.shots.map(({ status, notes, ...shot }) => shot),
  }));
  const audio = audioManifest ? Object.fromEntries(Object.entries(audioManifest.lines || {}).map(([k, v]) => [k, v.fingerprint])) : null;
  return sha({ episode: { ...rest, scenes }, audio, library: libFingerprint });
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
  const next = { ...readApprovals(episodePath), [gate]: { fingerprint, at: now.toISOString() } };
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
  return a.fingerprint === fingerprint ? "onayli" : "eskimis";
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
