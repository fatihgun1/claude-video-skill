/**
 * Storyboard and render steps (they drive the HyperFrames CLI through npx).
 *   storyboard  compile, run `hyperframes check`, take stills of every shot → human review
 *   render      final MP4s (2D, or 3D with d3: the same episode drawn by compile3d.mjs); refused until the storyboard of the current content is approved
 *               (draft renders are always allowed, for a quick look: no approval needed,
 *               lines not spoken yet play silent with a guessed length)
 */
import { mkdirSync, existsSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { readJson } from "./util.mjs";
import { compileEpisode, VIEWPORTS, facesOf, propLayer } from "./compile.mjs";
import { compileEpisode3d } from "./compile3d.mjs";
import "./runtime/core.js";
import { validateEpisode } from "./validate.mjs";
import { readApprovals, requireGate, scriptFingerprint, storyboardFingerprint, libraryFingerprint } from "./onay.mjs";
import { readManifest, failedLines, requireFreshAudio, staleLines } from "./ses.mjs";
import { HYPERFRAMES } from "./tools.mjs";
import { withVoiceLock } from "./ses-kilit.mjs";

/**
 * One build of an episode at a time: a storyboard and a render (or the panel's scene stills) both
 * write .cizgi/proje-* and the stills, and ran together they mixed each other's files (Faz 5.9).
 * The lock is the episode's own (.cizgi/uretim.lock); other episodes build alongside.
 */
function withBuildLock(episodePath, deps, fn) {
  const lockPath = join(dirname(resolve(episodePath)), ".cizgi", "uretim.lock");
  return withVoiceLock(resolve(episodePath), fn, { lockPath, waitMs: deps?.lockWaitMs, log: deps?.log, what: "derleme (storyboard ya da render)" });
}

export const FORMATS = Object.freeze({ "16:9": "16x9", "9:16": "9x16" });

/**
 * Two stills per shot: one while the line is spoken, one in the imitation pause.
 * @param {{start:number, end:number}[]} shots
 * @returns {number[]}
 */
export function stillTimes(shots) {
  return shots.flatMap((s) => [0.4, 0.8].map((k) => Math.round((s.start + (s.end - s.start) * k) * 100) / 100));
}

/** The episode, valid; the script approved unless it is only a draft (gate: false). */
function prepare(episodePath, lib, { gate = true } = {}) {
  const episode = readJson(episodePath);
  const { ok, errors, warnings } = validateEpisode(episode, lib);
  if (!ok) throw new Error(`episode is invalid:\n- ${errors.join("\n- ")}`);
  if (gate) requireGate(readApprovals(episodePath), "senaryo", scriptFingerprint(episode));
  const dir = dirname(resolve(episodePath));
  return { episode, warnings, dir, manifest: readManifest(episodePath) };
}

/**
 * Shots where a cast member is not fully inside the frame (checked at start, middle, end).
 * @param {{shot_id:string, cast:object[], camera:object}[]} shots
 * @param {ReturnType<import("./library.mjs").loadLibrary>} lib
 * @param {string} format
 * @returns {string[]}
 */
export function framingWarnings(shots, lib, format, faces) {
  const { outOfFrame } = globalThis.CizgiCore;
  return shots.flatMap((shot) =>
    outOfFrame(shot, lib.world, lib.cameras, VIEWPORTS[format], faces).map((id) => `shot ${shot.shot_id} (${format}): "${id}" is not fully in frame`),
  );
}

/**
 * Compile and photograph every shot for human review.
 * @param {string} episodePath
 * @param {ReturnType<import("./library.mjs").loadLibrary>} lib
 * @param {{run: (cmd:string, args:string[], opts?:object) => string, formats?: string[]}} deps
 * @returns {{fingerprint:string, warnings:string[], failedAudio:object[], formats: Record<string, {project:string, check:string, sheets:string[]}>}}
 */
export function storyboard(episodePath, lib, deps) {
  return withBuildLock(episodePath, deps, () => storyboardNow(episodePath, lib, deps));
}

function storyboardNow(episodePath, lib, deps) {
  const { episode, warnings, dir, manifest } = prepare(episodePath, lib);
  requireFreshAudio(episodePath, episode, lib);
  const out = {};
  for (const format of deps.formats || Object.keys(FORMATS)) {
    const tag = FORMATS[format];
    if (!tag) throw new Error(`unknown format "${format}"`);
    const project = join(dir, ".cizgi", `proje-${tag}`);
    compileEpisode(episodePath, lib, project, { format });
    const timing = readJson(join(project, "timing.json"));
    let check;
    try {
      check = deps.run("npx", ["--yes", HYPERFRAMES, "check"], { cwd: project });
    } catch (err) {
      throw new Error(`hyperframes check failed for ${format}:\n${err.message}`);
    }
    // stills of a project the check did not pass are not shown for approval (Faz 0.5)
    if (!/Check passed/.test(check || "")) throw new Error(`hyperframes check did not pass for ${format}:\n${String(check || "").slice(0, 2000)}`);
    const stills = join(dir, "storyboard", tag);
    mkdirSync(stills, { recursive: true });
    deps.run("npx", ["--yes", HYPERFRAMES, "snapshot", "--at", stillTimes(timing.shots).join(","), "--no-end", "-o", stills], { cwd: project });
    const sheets = existsSync(stills) ? readdirSync(stills).filter((f) => f.startsWith("contact-sheet")).sort().map((f) => join(stills, f)) : [];
    const { anchors } = propLayer(timing, episode, lib, VIEWPORTS[format]);
    const shots = timing.shots.map((s, i) => ({ ...s, anchors: anchors[i] }));
    const framing = framingWarnings(shots, lib, format, facesOf(episode, lib));
    warnings.push(...framing);
    out[format] = { project, check: "passed", sheets, framing };
  }
  const fingerprint = storyboardFingerprint(episode, manifest, libraryFingerprint(episode, lib));
  // what these stills show: the storyboard gate approves only this (a change after them needs new stills)
  writeFileSync(join(dir, STILLS_FINGERPRINT), `${JSON.stringify({ fingerprint, formats: Object.keys(out), at: new Date().toISOString() }, null, 2)}\n`);
  return { fingerprint, warnings, failedAudio: failedLines(manifest), formats: out };
}

/** Next to the episode: the fingerprint of the episode the last storyboard stills were taken of. */
export const STILLS_FINGERPRINT = join("storyboard", "parmak-izi.json");

/** Scene ids, as in the episode schema. */
const SCENE_ID = /^[a-z0-9]+([_-][a-z0-9]+)*$/;

/**
 * Stills of one scene for the panel's scene review (İncele): two per shot, like the storyboard,
 * into inceleme/<scene>/<format>/. A look, not an approval: no gate is needed, and a line not
 * spoken yet plays silent with a guessed length (as in the panel's preview).
 * @param {string} episodePath
 * @param {ReturnType<import("./library.mjs").loadLibrary>} lib
 * @param {string} sceneId
 * @param {{run: (cmd:string, args:string[], opts?:object) => string, formats?: string[]}} deps
 * @returns {{scene:string, formats: Record<string, {sheets:string[]}>}}
 */
export function sceneStills(episodePath, lib, sceneId, deps) {
  return withBuildLock(episodePath, deps, () => sceneStillsNow(episodePath, lib, sceneId, deps));
}

function sceneStillsNow(episodePath, lib, sceneId, deps) {
  if (!SCENE_ID.test(sceneId || "")) throw new Error(`bad scene id "${sceneId}"`);
  const episode = readJson(episodePath);
  const { ok, errors } = validateEpisode(episode, lib);
  if (!ok) throw new Error(`episode is invalid:\n- ${errors.join("\n- ")}`);
  const scene = episode.scenes.find((s) => s.scene_id === sceneId);
  if (!scene) throw new Error(`no scene "${sceneId}" in the episode`);
  const mine = new Set(scene.shots.map((s) => s.shot_id));
  const dir = dirname(resolve(episodePath));
  const out = {};
  for (const format of deps.formats || ["16:9"]) {
    const tag = FORMATS[format];
    if (!tag) throw new Error(`unknown format "${format}"`);
    const project = join(dir, ".cizgi", `sahne-${tag}`);
    compileEpisode(episodePath, lib, project, { format, missingAudio: "estimate", stale: staleLines(episodePath, episode, lib) });
    const timing = readJson(join(project, "timing.json"));
    const stills = join(dir, "inceleme", sceneId, tag);
    rmSync(stills, { recursive: true, force: true }); // the sheets of an earlier look would mix in
    mkdirSync(stills, { recursive: true });
    deps.run("npx", ["--yes", HYPERFRAMES, "snapshot", "--at", stillTimes(timing.shots.filter((s) => mine.has(s.shot_id))).join(","), "--no-end", "-o", stills], { cwd: project });
    out[format] = { sheets: readdirSync(stills).filter((f) => f.startsWith("contact-sheet")).sort().map((f) => join(stills, f)) };
  }
  return { scene: sceneId, formats: out };
}

/** Frames per second sampled for review: enough to see a step, a grab or a cut. */
export const QA_FPS = 4;

/**
 * Pull review pages out of a RENDERED video (not the composition): QA_FPS frames per
 * second, tiled 6×4 per page. A person or agent must look at every page before the
 * video is shown to anyone — stills of the composition miss motion and cut problems.
 * @param {string} video path of an MP4
 * @param {{run: (cmd:string, args:string[]) => string, ffmpeg?: string}} deps
 * @returns {{pages: string[], frames: number, dir: string}}
 */
export function qaPages(video, deps) {
  const ffmpeg = deps.ffmpeg || "ffmpeg";
  const dir = join(dirname(resolve(video)), `${basename(video, ".mp4")}-qa`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  deps.run(ffmpeg, ["-v", "error", "-i", video, "-vf", `fps=${QA_FPS},scale=480:-1`, join(dir, "k%03d.png")]);
  const frames = readdirSync(dir).filter((f) => /^k\d+\.png$/.test(f)).length;
  deps.run(ffmpeg, ["-v", "error", "-i", join(dir, "k%03d.png"), "-vf", "tile=6x4:padding=4", join(dir, "sayfa%d.png"), "-y"]);
  const pages = readdirSync(dir).filter((f) => f.startsWith("sayfa")).sort().map((f) => join(dir, f));
  return { pages, frames, dir };
}

const LENGTH_TOLERANCE_S = 0.15; // a frame or two of encoder padding
const CLOCK_SLACK_MS = 2000; // file times on some disks round to seconds

/**
 * A final render is checked, not assumed: the file was written by this render, it is as long as
 * the timeline and it has a sound track (Hurda Kralı 1: an old video of the wrong format and length
 * was shown as the result).
 */
function verifyVideo(video, startedMs, expectedS, project, deps) {
  if (!existsSync(video) || statSync(video).mtimeMs < startedMs - CLOCK_SLACK_MS) {
    throw new Error(`render bitti ama ${video} yazılmadı (ya da eski bir dosya duruyor); render çıktısına bak`);
  }
  let probe;
  try {
    probe = JSON.parse(deps.run(deps.ffprobe || "ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", video], { cwd: project }));
  } catch (err) {
    throw new Error(`render ${video} okunamadı (ffprobe): ${err.message}`);
  }
  const length = Number(probe?.format?.duration);
  if (!Number.isFinite(length) || Math.abs(length - expectedS) > LENGTH_TOLERANCE_S) {
    throw new Error(`render ${video} süresi ${Number.isFinite(length) ? length.toFixed(2) : "?"} sn, zaman çizelgesi ${expectedS.toFixed(2)} sn`);
  }
  if (!(probe.streams || []).some((s) => s.codec_type === "audio")) throw new Error(`render ${video} içinde ses yok`);
}

/**
 * Render MP4s. A final one is checked after it is written (verifyVideo).
 * @param {string} episodePath
 * @param {ReturnType<import("./library.mjs").loadLibrary>} lib
 * @param {{run: (cmd:string, args:string[], opts?:object) => string, draft?: boolean, formats?: string[], ffprobe?: string}} deps
 * @returns {string[]} written video paths
 */
export function render(episodePath, lib, deps) {
  return withBuildLock(episodePath, deps, () => renderNow(episodePath, lib, deps));
}

function renderNow(episodePath, lib, deps) {
  const { episode, dir, manifest } = prepare(episodePath, lib, { gate: !deps.draft });
  if (!deps.draft) requireFreshAudio(episodePath, episode, lib);
  if (!deps.draft) requireGate(readApprovals(episodePath), "storyboard", storyboardFingerprint(episode, manifest, libraryFingerprint(episode, lib)));
  const videos = [];
  for (const format of deps.formats || Object.keys(FORMATS)) {
    const tag = FORMATS[format];
    if (!tag) throw new Error(`unknown format "${format}"`);
    const look = deps.d3 ? "-3b" : "";
    const project = join(dir, ".cizgi", `proje-${tag}${look}`);
    const opts = deps.draft ? { format, missingAudio: "estimate", stale: staleLines(episodePath, episode, lib) } : { format };
    (deps.d3 ? compileEpisode3d : compileEpisode)(episodePath, lib, project, opts);
    mkdirSync(join(dir, "cikti"), { recursive: true });
    // the 3D one sits beside the 2D one; a draft keeps "-taslak" last (the panel tells drafts by it)
    const video = join(dir, "cikti", `${episode.episode}-${tag}${look}${deps.draft ? "-taslak" : ""}.mp4`);
    const started = Date.now();
    deps.run("npx", ["--yes", HYPERFRAMES, "render", "-o", video, "--fps", "30", "-q", deps.draft ? "draft" : "looks"], { cwd: project });
    if (!deps.draft) verifyVideo(video, started, readJson(join(project, "timing.json")).duration, project, deps);
    videos.push(video);
  }
  return videos;
}
