/**
 * Compile a validated episode into a self-contained HyperFrames project folder.
 *
 * Audio sidecars (optional, next to each .wav):
 *   <name>.words.json    [{word, start, end}]   word timings for captions
 *   <name>.rhubarb.json  Rhubarb JSON output    mouth shapes for lip sync
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { svgInner, prefixIds } from "./rigspec.mjs";
import { validateEpisode } from "./validate.mjs";
import { buildTimeline, wavDuration } from "./timing.mjs";
import { readJson, has } from "./util.mjs";

const RUNTIME_DIR = join(dirname(fileURLToPath(import.meta.url)), "runtime");
const VIEWPORTS = { "16:9": { width: 1920, height: 1080 }, "9:16": { width: 1080, height: 1920 } };

/**
 * Escape text for HTML content and attribute values.
 * @param {string} s
 * @returns {string}
 */
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function readJsonIfExists(path) {
  return existsSync(path) ? readJson(path) : null;
}

/**
 * Resolve an episode-relative path and refuse anything that escapes the episode folder.
 * @param {string} episodeDir
 * @param {string} rel
 * @returns {string}
 */
export function safeJoin(episodeDir, rel) {
  const full = resolve(episodeDir, rel);
  const back = relative(resolve(episodeDir), full);
  if (back === ".." || back.startsWith(`..${sep}`) || isAbsolute(back)) {
    throw new Error(`path escapes the episode folder: ${rel}`);
  }
  return full;
}

const timed = (x) => x != null && Number.isFinite(x.start) && Number.isFinite(x.end);

function readWords(path) {
  const words = readJsonIfExists(path);
  if (words === null) return [];
  if (!Array.isArray(words)) throw new Error(`${path}: expected an array of {word, start, end}`);
  // Untimed words keep their text (for the caption) but never get highlighted.
  return words.map((w) => ({ word: String(w.word ?? ""), start: timed(w) ? w.start : null, end: timed(w) ? w.end : null }));
}

function readCues(path) {
  const rhubarb = readJsonIfExists(path);
  if (rhubarb === null) return [];
  if (!Array.isArray(rhubarb.mouthCues) || !rhubarb.mouthCues.every(timed)) {
    throw new Error(`${path}: expected Rhubarb JSON with mouthCues [{start, end, value}]`);
  }
  return rhubarb.mouthCues.map((c) => ({ start: c.start, end: c.end, value: String(c.value) }));
}

/**
 * Read duration, word timings and mouth cues for one audio file.
 * @param {string} wavPath
 * @returns {{duration:number, words:{start:number|null,end:number|null,word:string}[], cues:{start:number,end:number,value:string}[]}}
 */
export function readAudioInfo(wavPath) {
  if (!existsSync(wavPath)) throw new Error(`audio not found: ${wavPath}`);
  const base = wavPath.replace(/\.wav$/i, "");
  return {
    duration: wavDuration(readFileSync(wavPath)),
    words: readWords(`${base}.words.json`),
    cues: readCues(`${base}.rhubarb.json`),
  };
}

function characterMarkup(ch, lib) {
  const rig = lib.characters.get(ch.rig);
  const vars = Object.entries(ch.palette || {}).map(([k, v]) => `--${k}:${v}`).join(";");
  const style = vars ? ` style="${escapeHtml(vars)}"` : "";
  return `<g id="kar-${ch.id}"${style}>${prefixIds(svgInner(rig.svg), ch.id)}</g>`;
}

function captionMarkup(shot) {
  return shot.utterances
    .map((u, i) => {
      const words = u.words.length ? u.words.map((w) => w.word) : u.text.trim().split(/\s+/);
      const spans = words.map((w) => `<span class="kelime">${escapeHtml(w)}</span>`).join(" ");
      return `<div class="altyazi" id="altyazi-${shot.shot_id}-${i}">${spans}</div>`;
    })
    .join("\n      ");
}

function pageHtml({ episode, timeline, viewport, lib, audioTags, data }) {
  const usedBgs = [...new Set(timeline.shots.map((s) => s.bg))];
  const bgs = usedBgs.map((bg) => `<g id="bg-${bg}">${prefixIds(svgInner(lib.backgrounds.get(bg)), `bg-${bg}`)}</g>`);
  const chars = episode.characters.map((ch) => characterMarkup(ch, lib));
  const portrait = viewport.height > viewport.width;
  return `<!doctype html>
<html lang="${escapeHtml(episode.language)}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${viewport.width}, height=${viewport.height}" />
    <title>${escapeHtml(episode.title || episode.episode)}</title>
    <style>
      body { margin: 0; background: #eaf6fb; }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; }
      #sahne { position: absolute; inset: 0; width: 100%; height: 100%; }
      #altyazilar { position: absolute; left: 6%; right: 6%; ${portrait ? "top: 12%" : "bottom: 3%"}; display: flex; justify-content: center; }
      .altyazi { display: none; padding: 14px 28px; border-radius: 28px; background: rgba(255, 255, 255, 0.88);
        color: #3a2a20; font-family: sans-serif; font-weight: 700; font-size: ${portrait ? 58 : 54}px; line-height: 1.25; text-align: center; }
      .kelime.soylenen { color: #c2453d; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-no-timeline data-start="0" data-width="${viewport.width}" data-height="${viewport.height}" data-duration="${timeline.duration}">
      <svg id="sahne" viewBox="0 0 ${viewport.width} ${viewport.height}" xmlns="http://www.w3.org/2000/svg">
        <g id="kamera" data-layout-allow-overflow>
          ${bgs.join("\n          ")}
          ${chars.join("\n          ")}
        </g>
      </svg>
      <div id="altyazilar">
      ${timeline.shots.map(captionMarkup).join("\n      ")}
      </div>
      ${audioTags.join("\n      ")}
    </div>
    <script src="runtime/core.js"></script>
    <script>window.__CIZGI__ = ${JSON.stringify(data).replace(/</g, "\\u003c")};</script>
    <script src="runtime/player.js"></script>
  </body>
</html>
`;
}

/**
 * Compile an episode file into a HyperFrames project.
 * @param {string} episodePath path to episode.json
 * @param {ReturnType<import("./library.mjs").loadLibrary>} lib
 * @param {string} outDir project folder to (over)write
 * @param {{format?: "16:9"|"9:16"}} [opts]
 * @returns {{duration:number, shots:number, outDir:string}}
 */
export function compileEpisode(episodePath, lib, outDir, opts = {}) {
  const episode = readJson(episodePath);
  const { ok, errors } = validateEpisode(episode, lib);
  if (!ok) throw new Error(`episode is invalid:\n- ${errors.join("\n- ")}`);

  const episodeDir = dirname(resolve(episodePath));
  const format = opts.format || episode.format || "16:9";
  if (!has(VIEWPORTS, format)) throw new Error(`unknown format "${format}" (${Object.keys(VIEWPORTS).join(", ")})`);
  const viewport = VIEWPORTS[format];
  const timeline = buildTimeline(episode, (rel) => readAudioInfo(safeJoin(episodeDir, rel)));

  mkdirSync(join(outDir, "assets", "audio"), { recursive: true });
  mkdirSync(join(outDir, "runtime"), { recursive: true });
  for (const f of ["core.js", "player.js"]) copyFileSync(join(RUNTIME_DIR, f), join(outDir, "runtime", f));

  const audioTags = [];
  for (const shot of timeline.shots) {
    shot.utterances.forEach((u, i) => {
      const id = `ses-${shot.shot_id}-${i}`;
      copyFileSync(safeJoin(episodeDir, u.audio), join(outDir, "assets", "audio", `${id}.wav`));
      const dur = (u.end - u.start).toFixed(3);
      audioTags.push(`<audio id="${id}" src="assets/audio/${id}.wav" data-start="${u.start}" data-duration="${dur}" data-track-index="1" data-volume="1"></audio>`);
    });
  }

  const data = {
    viewport,
    world: lib.world,
    cameras: lib.cameras,
    actions: Object.fromEntries([...lib.actions]),
    characters: episode.characters.map((c) => ({ id: c.id })),
    backgrounds: [...new Set(timeline.shots.map((s) => s.bg))],
    shots: timeline.shots.map((s) => ({
      shot_id: s.shot_id, bg: s.bg, start: s.start, end: s.end, cast: s.cast, camera: s.camera,
      utterances: s.utterances.map((u) => ({ speaker: u.speaker, start: u.start, end: u.end, words: u.words, cues: u.cues })),
    })),
  };

  writeFileSync(join(outDir, "index.html"), pageHtml({ episode, timeline, viewport, lib, audioTags, data }));
  writeFileSync(join(outDir, "timing.json"), JSON.stringify(timeline, null, 2));
  return { duration: timeline.duration, shots: timeline.shots.length, outDir };
}
