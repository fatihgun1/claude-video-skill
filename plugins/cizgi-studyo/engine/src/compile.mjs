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
import { svgInner, prefixIds, parseGroups } from "./rigspec.mjs";
import "./runtime/core.js";
import { validateEpisode, profileOf } from "./validate.mjs";
import { buildTimeline, wavDuration } from "./timing.mjs";
import { readJson, has } from "./util.mjs";

const RUNTIME_DIR = join(dirname(fileURLToPath(import.meta.url)), "runtime");
export const VIEWPORTS = { "16:9": { width: 1920, height: 1080 }, "9:16": { width: 1080, height: 1920 } };

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
 * Episode-relative audio path of a line: its own `audio` field, or the path the audio step writes.
 * @param {{audio?: string}} utterance
 * @param {{shot_id: string}} shot
 * @param {number} index line index within the shot
 * @returns {string}
 */
export function audioPathFor(utterance, shot, index) {
  return utterance.audio || `ses/${shot.shot_id}-${index}.wav`;
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

/**
 * Face height of each character's rig (character.json face_y, rig units), for face-anchored framing.
 * @returns {Record<string, number>}
 */
export function facesOf(episode, lib) {
  return Object.fromEntries(episode.characters.map((c) => [c.id, lib.characters.get(c.rig).meta.face_y ?? 400]));
}

/** Rig units per world unit at the landscape base scale (rigs are 900 units tall). */
const rigUnitsPerWorld = (lib) => 900 / lib.world.character_height;

/**
 * Markup for every prop: a ground copy in the world, and a copy inside the holder's hand.
 * The player shows one of the two, switching at the holder action's grab time.
 * @returns {{ground: string[], held: Map<string, {hand: string, markup: string}[]>, data: object[][], anchors: Record<string, number[]>[]}}
 */
export function propLayer(timeline, episode, lib, viewport) {
  const layout = globalThis.CizgiCore.layoutFor(lib.world, viewport);
  const ratio = layout.scale * rigUnitsPerWorld(lib); // portrait shrink factor (1 in landscape)
  const rigOf = Object.fromEntries(episode.characters.map((c) => [c.id, c.rig]));
  const ground = [];
  const inBackground = []; // {bg, markup}: props placed in depth, moved by the background's dolly
  const held = new Map();
  const anchors = timeline.shots.map(() => ({}));
  const data = timeline.shots.map((shot, si) =>
    (shot.props || []).map((pr) => {
      const key = `${shot.shot_id}-${pr.id}`;
      const prop = lib.props.get(pr.prop);
      const [bx, by] = prop.base;
      if (pr.depth) {
        const inner = prefixIds(svgInner(prop.svg), `prop-${key}-yer`);
        const { x: dx, y: dy, scale } = pr.depth;
        inBackground.push({
          bg: shot.bg,
          markup: `<g id="prop-${key}-yer" display="none" transform="translate(${dx} ${dy}) scale(${scale}) translate(${-bx} ${-by})">${inner}</g>`,
        });
        return { key, holder: null, grab: null };
      }
      const x = layout.marks[pr.mark] + (pr.dx || 0) * ratio;
      // where the camera looks when it targets this prop: its grip point as it lies on the ground
      anchors[si][pr.id] = [x, lib.world.ground_y - (by - prop.grip[1]) * ratio];
      const groundInner = prefixIds(svgInner(prop.svg), `prop-${key}-yer`);
      ground.push(
        `<g id="prop-${key}-yer" display="none" transform="translate(${x.toFixed(1)} ${lib.world.ground_y}) scale(${ratio.toFixed(4)}) translate(${-bx} ${-by})">${groundInner}</g>`,
      );
      if (!pr.holder) return { key, holder: null, grab: null };
      const hand = pr.hand || "L";
      const handGroup = parseGroups(lib.characters.get(rigOf[pr.holder]).svg).get(`hand_${hand}`);
      const [gx, gy] = (handGroup.attrs["data-grip"] || handGroup.attrs["data-pivot"]).split(",").map(Number);
      // A hand holds a bottle or handle across the palm, perpendicular to the forearm:
      // data-grip-angle turns the prop in the hand (90 = across a hand that hangs down).
      const gripAngle = Number(handGroup.attrs["data-grip-angle"] || 0);
      const [px, py] = prop.grip;
      const heldInner = prefixIds(svgInner(prop.svg), `prop-${key}-el`);
      const markup = `<g id="prop-${key}-el" display="none" transform="translate(${gx} ${gy}) rotate(${gripAngle}) scale(${rigUnitsPerWorld(lib).toFixed(4)}) translate(${-px} ${-py})">${heldInner}</g>`;
      held.set(pr.holder, [...(held.get(pr.holder) || []), { hand, markup }]);
      const member = shot.cast.find((m) => m.id === pr.holder);
      const grab = lib.actions.get(member.action).grab?.t;
      // an action started part-way (cast.from) reaches its grab that much earlier in the shot
      return { key, holder: pr.holder, grab: grab == null ? null : grab - (member.from || 0) };
    }),
  );
  return { ground, held, data, anchors, inBackground };
}

/**
 * Vanishing point of a perspective background (data-vp on its <svg>), or null.
 * @param {string} svg
 * @returns {number[]|null}
 */
export function vanishingPoint(svg) {
  const m = /<svg\b[^>]*\bdata-vp=["'](-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)["']/.exec(svg);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function characterMarkup(ch, lib, heldProps = []) {
  const rig = lib.characters.get(ch.rig);
  const vars = Object.entries(ch.palette || {}).map(([k, v]) => `--${k}:${v}`).join(";");
  const style = vars ? ` style="${escapeHtml(vars)}"` : "";
  let markup = prefixIds(svgInner(rig.svg), ch.id);
  for (const { hand, markup: prop } of heldProps) {
    // In the hand's slot if it has one (palm behind, fingers in front), else as its first child.
    const slot = new RegExp(`<g\\b[^>]*\\bid="${ch.id}--hand_${hand}_slot"[^>]*?(?:/>|>\\s*</g>)`);
    if (slot.test(markup)) {
      markup = markup.replace(slot, (tag) => tag + prop);
      continue;
    }
    const open = new RegExp(`<g\\b[^>]*\\bid="${ch.id}--hand_${hand}"[^>]*>`);
    markup = markup.replace(open, (tag) => tag + prop);
  }
  return `<g id="kar-${ch.id}"${style}>${markup}</g>`;
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

function pageHtml({ episode, timeline, viewport, lib, audioTags, data, props }) {
  const usedBgs = [...new Set(timeline.shots.map((s) => s.bg))];
  const bgs = usedBgs.map((bg) => {
    const depthProps = props.inBackground.filter((p) => p.bg === bg).map((p) => p.markup).join("");
    return `<g id="bg-${bg}">${prefixIds(svgInner(lib.backgrounds.get(bg)), `bg-${bg}`)}${depthProps}</g>`;
  });
  const chars = episode.characters.map((ch) => characterMarkup(ch, lib, props.held.get(ch.id)));
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
      #altyazilar { position: absolute; left: 6%; right: 6%; ${portrait ? "top: 9%" : "bottom: 3%"}; display: flex; justify-content: center; }
      .altyazi { display: none; padding: 14px 28px; border-radius: 28px; background: rgba(255, 255, 255, 0.88);
        color: #3a2a20; font-family: sans-serif; font-weight: 700; font-size: ${portrait ? 58 : 54}px; line-height: 1.25; text-align: center; }
      .kelime.soylenen { color: #c2453d; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-no-timeline data-start="0" data-width="${viewport.width}" data-height="${viewport.height}" data-duration="${timeline.duration}">
      <svg id="sahne" viewBox="0 0 ${viewport.width} ${viewport.height}" xmlns="http://www.w3.org/2000/svg">
        <defs><filter id="dof" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur id="dof-blur" stdDeviation="0"/></filter></defs>
        <g id="kamera" data-layout-allow-overflow>
          ${bgs.join("\n          ")}
          ${props.ground.join("\n          ")}
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
 * @param {{format?: "16:9"|"9:16", episode?: object}} [opts]
 * @returns {{duration:number, shots:number, outDir:string}}
 */
export function compileEpisode(episodePath, lib, outDir, opts = {}) {
  // opts.episode: compile an unsaved edit (the control panel); paths still resolve next to episodePath.
  const episode = opts.episode ?? readJson(episodePath);
  const { ok, errors } = validateEpisode(episode, lib);
  if (!ok) throw new Error(`episode is invalid:\n- ${errors.join("\n- ")}`);

  const episodeDir = dirname(resolve(episodePath));
  const format = opts.format || episode.format || "16:9";
  if (!has(VIEWPORTS, format)) throw new Error(`unknown format "${format}" (${Object.keys(VIEWPORTS).join(", ")})`);
  const viewport = VIEWPORTS[format];
  const audioFile = (u, shot, i) => safeJoin(episodeDir, audioPathFor(u, shot, i));
  const timeline = buildTimeline(episode, (u, shot, i) => readAudioInfo(audioFile(u, shot, i)), profileOf(episode, lib).timing);

  mkdirSync(join(outDir, "assets", "audio"), { recursive: true });
  mkdirSync(join(outDir, "runtime"), { recursive: true });
  for (const f of ["core.js", "player.js"]) copyFileSync(join(RUNTIME_DIR, f), join(outDir, "runtime", f));

  const audioTags = [];
  for (const shot of timeline.shots) {
    shot.utterances.forEach((u, i) => {
      const id = `ses-${shot.shot_id}-${i}`;
      copyFileSync(audioFile(u, shot, i), join(outDir, "assets", "audio", `${id}.wav`));
      const dur = (u.end - u.start).toFixed(3);
      audioTags.push(`<audio id="${id}" src="assets/audio/${id}.wav" data-start="${u.start}" data-duration="${dur}" data-track-index="1" data-volume="1"></audio>`);
    });
  }

  const props = propLayer(timeline, episode, lib, viewport);
  const data = {
    viewport,
    world: lib.world,
    cameras: lib.cameras,
    actions: Object.fromEntries([...lib.actions]),
    characters: episode.characters.map((c) => ({ id: c.id })),
    faces: facesOf(episode, lib),
    backgrounds: [...new Set(timeline.shots.map((s) => s.bg))],
    vanishing: Object.fromEntries([...new Set(timeline.shots.map((s) => s.bg))].map((bg) => [bg, vanishingPoint(lib.backgrounds.get(bg))])),
    shots: timeline.shots.map((s, i) => ({
      shot_id: s.shot_id, bg: s.bg, start: s.start, end: s.end, cast: s.cast, camera: s.camera,
      utterances: s.utterances.map((u) => ({ speaker: u.speaker, start: u.start, end: u.end, words: u.words, cues: u.cues })),
      props: props.data[i],
      anchors: props.anchors[i],
    })),
  };

  writeFileSync(join(outDir, "index.html"), pageHtml({ episode, timeline, viewport, lib, audioTags, data, props }));
  writeFileSync(join(outDir, "timing.json"), JSON.stringify(timeline, null, 2));
  return { duration: timeline.duration, shots: timeline.shots.length, outDir };
}
