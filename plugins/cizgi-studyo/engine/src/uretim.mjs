/**
 * Storyboard and render steps (they drive the HyperFrames CLI through npx).
 *   storyboard  compile, run `hyperframes check`, take stills of every shot → human review
 *   render      final MP4s; refused until the storyboard of the current content is approved
 *               (draft renders are always allowed, for a quick look)
 */
import { mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { readJson } from "./util.mjs";
import { compileEpisode, VIEWPORTS, facesOf, propLayer } from "./compile.mjs";
import "./runtime/core.js";
import { validateEpisode } from "./validate.mjs";
import { readApprovals, requireGate, scriptFingerprint, storyboardFingerprint, libraryFingerprint } from "./onay.mjs";
import { readManifest, failedLines } from "./ses.mjs";
import { HYPERFRAMES } from "./tools.mjs";

export const FORMATS = Object.freeze({ "16:9": "16x9", "9:16": "9x16" });

/**
 * Two stills per shot: one while the line is spoken, one in the imitation pause.
 * @param {{start:number, end:number}[]} shots
 * @returns {number[]}
 */
export function stillTimes(shots) {
  return shots.flatMap((s) => [0.4, 0.8].map((k) => Math.round((s.start + (s.end - s.start) * k) * 100) / 100));
}

function prepare(episodePath, lib) {
  const episode = readJson(episodePath);
  const { ok, errors, warnings } = validateEpisode(episode, lib);
  if (!ok) throw new Error(`episode is invalid:\n- ${errors.join("\n- ")}`);
  requireGate(readApprovals(episodePath), "senaryo", scriptFingerprint(episode));
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
  const { episode, warnings, dir, manifest } = prepare(episodePath, lib);
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
    const stills = join(dir, "storyboard", tag);
    mkdirSync(stills, { recursive: true });
    deps.run("npx", ["--yes", HYPERFRAMES, "snapshot", "--at", stillTimes(timing.shots).join(","), "--no-end", "-o", stills], { cwd: project });
    const sheets = existsSync(stills) ? readdirSync(stills).filter((f) => f.startsWith("contact-sheet")).sort().map((f) => join(stills, f)) : [];
    const { anchors } = propLayer(timing, episode, lib, VIEWPORTS[format]);
    const shots = timing.shots.map((s, i) => ({ ...s, anchors: anchors[i] }));
    const framing = framingWarnings(shots, lib, format, facesOf(episode, lib));
    warnings.push(...framing);
    out[format] = { project, check: /Check passed/.test(check) ? "passed" : "see output", sheets, framing };
  }
  return { fingerprint: storyboardFingerprint(episode, manifest, libraryFingerprint(episode, lib)), warnings, failedAudio: failedLines(manifest), formats: out };
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

/**
 * Render MP4s.
 * @param {string} episodePath
 * @param {ReturnType<import("./library.mjs").loadLibrary>} lib
 * @param {{run: (cmd:string, args:string[], opts?:object) => string, draft?: boolean, formats?: string[]}} deps
 * @returns {string[]} written video paths
 */
export function render(episodePath, lib, deps) {
  const { episode, dir, manifest } = prepare(episodePath, lib);
  if (!deps.draft) requireGate(readApprovals(episodePath), "storyboard", storyboardFingerprint(episode, manifest, libraryFingerprint(episode, lib)));
  const videos = [];
  for (const format of deps.formats || Object.keys(FORMATS)) {
    const tag = FORMATS[format];
    if (!tag) throw new Error(`unknown format "${format}"`);
    const project = join(dir, ".cizgi", `proje-${tag}`);
    compileEpisode(episodePath, lib, project, { format });
    mkdirSync(join(dir, "cikti"), { recursive: true });
    const video = join(dir, "cikti", `${episode.episode}-${tag}${deps.draft ? "-taslak" : ""}.mp4`);
    deps.run("npx", ["--yes", HYPERFRAMES, "render", "-o", video, "--fps", "30", "-q", deps.draft ? "draft" : "looks"], { cwd: project });
    videos.push(video);
  }
  return videos;
}
