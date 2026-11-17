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
import { readWav, writeWav, mixMusic } from "./muzik.mjs";
import { gateCues, silencesOfFile } from "./dudak.mjs";
import { levelledWav } from "./ses-duzey.mjs";
import { captionPlace, captionShown, speakerColor } from "./altyazi.mjs";

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
    // the mouth closes where the line is quiet (Rhubarb alone kept it moving through pauses)
    cues: gateCues(readCues(`${base}.rhubarb.json`), silencesOfFile(wavPath)),
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
const RIG_FEET_Y = 950; // where a rig's feet stand, in rig units (core.js RIG_HEIGHT notes)

/**
 * Seconds a line takes to say, guessed from its text: the spoken lines of the examples run
 * about 0.07–0.15 s per character (slow, clear speech for small children).
 */
const SECONDS_PER_CHAR = 0.1;
const SPEECH_MIN_S = 1;
export const estimateSpeech = (text) => Math.round(Math.max(SPEECH_MIN_S, text.length * SECONDS_PER_CHAR) * 1000) / 1000;

/**
 * When a holder takes its prop, in seconds into the shot: the grab of the first action of its
 * sequence that has one and gets there before the next action starts; null when none does
 * (then it holds the prop from the start).
 */
export function grabTime(member, lib) {
  const segs = globalThis.CizgiCore.segmentsOf(member);
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const g = lib.actions.get(s.action)?.grab?.t;
    if (g == null) continue;
    // started part-way (from), an action reaches its grab that much earlier; a later action
    // started past its grab holds the prop from its own start
    const t = i === 0 ? g - s.from : s.at + Math.max(0, g - s.from);
    if (t < (segs[i + 1]?.at ?? Infinity)) return t; // the next action may cut it off first
  }
  return null;
}

/**
 * Refuse actions listed to start after their shot ends: the shot's length is only known
 * here (it comes from the speech), so the validator cannot see it.
 * @param {{shots: object[]}} timeline
 */
export function checkActionTimes(timeline) {
  for (const shot of timeline.shots) {
    const length = shot.end - shot.start;
    for (const m of shot.cast) {
      for (const a of m.actions || []) {
        if (a.at >= length) {
          throw new Error(`shot ${shot.shot_id}: "${m.id}" starts "${a.action}" at ${a.at}s, which starts after the shot ends (${length.toFixed(2)}s)`);
        }
      }
    }
  }
}

/**
 * Markup for every prop: a ground copy in the world, and a copy inside the holder's hand.
 * The player shows one of the two, switching at the holder's grab time (grabTime).
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
      // A prop someone standing back (cast.back) will pick up lies at their depth, so it does not
      // jump up and shrink when it goes into their hand.
      const holderMember = pr.holder ? shot.cast.find((m) => m.id === pr.holder) : null;
      const depth = holderMember ? globalThis.CizgiCore.depthOf(holderMember, layout) : { rise: 0, shrink: 1 };
      const floorY = lib.world.ground_y - depth.rise;
      const lieScale = ratio * depth.shrink;
      // where the camera looks when it targets this prop: its grip point as it lies on the ground
      anchors[si][pr.id] = [x, floorY - (by - (prop.grip || prop.base)[1]) * lieScale]; // a prop no one holds: its base
      const groundInner = prefixIds(svgInner(prop.svg), `prop-${key}-yer`);
      ground.push(
        `<g id="prop-${key}-yer" display="none" transform="translate(${x.toFixed(1)} ${floorY}) scale(${lieScale.toFixed(4)}) translate(${-bx} ${-by})">${groundInner}</g>`,
      );
      if (!pr.holder) return { key, holder: null, grab: null };
      const hand = pr.hand || "L";
      const handGroup = parseGroups(lib.characters.get(rigOf[pr.holder]).svg).get(`hand_${hand}`);
      const [gx, gy] = (handGroup.attrs["data-grip"] || handGroup.attrs["data-pivot"]).split(",").map(Number);
      // A held prop is in the hand for the shot: the camera looks at the holder's hand height, over
      // the holder (its mid-shot place), not at the spot on the floor it was picked up from.
      const dur = shot.end != null && shot.start != null ? shot.end - shot.start : 1;
      anchors[si][pr.id] = [
        globalThis.CizgiCore.memberX(holderMember, layout, dur / 2, dur),
        lib.world.ground_y - depth.rise - (RIG_FEET_Y - gy) * layout.scale * depth.shrink,
      ];
      // A hand holds a bottle or handle across the palm, perpendicular to the forearm:
      // data-grip-angle turns the prop in the hand (90 = across a hand that hangs down).
      const gripAngle = Number(handGroup.attrs["data-grip-angle"] || 0);
      const [px, py] = prop.grip;
      const heldInner = prefixIds(svgInner(prop.svg), `prop-${key}-el`);
      const markup = `<g id="prop-${key}-el" display="none" transform="translate(${gx} ${gy}) rotate(${gripAngle}) scale(${rigUnitsPerWorld(lib).toFixed(4)}) translate(${-px} ${-py})">${heldInner}</g>`;
      held.set(pr.holder, [...(held.get(pr.holder) || []), { hand, markup }]);
      const member = shot.cast.find((m) => m.id === pr.holder);
      return { key, holder: pr.holder, grab: grabTime(member, lib) };
    }),
  );
  return { ground, held, data, anchors, inBackground };
}

/**
 * Scene decor (scene.dekor): library props standing in a scene for all its shots, one group per
 * scene (the player shows the current scene's), drawn after the background and before the
 * characters. Placed like a character: x in world units (pulled toward the middle in 9:16 exactly
 * as the marks are: CizgiCore.decorX), standing on the ground, higher and smaller when further
 * back, mirrored by ters.
 * @returns {{markup: string[], scenes: string[]}}
 */
export function decorLayer(episode, lib, viewport) {
  const C = globalThis.CizgiCore;
  const layout = C.layoutFor(lib.world, viewport);
  const ratio = layout.scale * rigUnitsPerWorld(lib); // 1 in 16:9, the portrait shrink in 9:16
  const num = (v) => String(Math.round(v * 10) / 10);
  const scenes = episode.scenes.filter((sc) => sc.dekor?.length);
  const markup = scenes.map((sc) => {
    const items = sc.dekor.map((d) => {
      const prop = lib.props.get(d.prop);
      const [bx, by] = prop.base;
      const depth = C.depthOf(d, layout);
      const x = C.decorX(d.x, lib.world, viewport); // by its mark in 9:16 too
      const y = lib.world.ground_y - depth.rise;
      const s = ratio * depth.shrink * (d.olcek ?? 1);
      const id = `dekor-${sc.scene_id}--${d.id}`;
      return `<g id="${id}" transform="translate(${num(x)} ${num(y)}) scale(${(d.ters ? -s : s).toFixed(4)} ${s.toFixed(4)}) translate(${-bx} ${-by})">${prefixIds(svgInner(prop.svg), id)}</g>`;
    });
    // further back first, so a nearer piece is drawn over a farther one
    const order = sc.dekor.map((d, i) => ({ i, back: d.back || 0 })).sort((a, b) => b.back - a.back || a.i - b.i);
    return `<g id="dekor-${sc.scene_id}" display="none">${order.map((o) => items[o.i]).join("")}</g>`;
  });
  return { markup, scenes: scenes.map((sc) => sc.scene_id) };
}

/**
 * Place every sound effect on the episode clock, before anything is written to disk.
 * Each occurrence gets its own track (utterances use track 1) so overlapping effects never
 * cut each other off; an effect is cut where the film ends.
 * @throws when an effect starts after its shot ends
 */
function soundEffects(episode, timeline, lib) {
  const sfxOf = new Map(episode.scenes.flatMap((sc) => sc.shots).map((s) => [s.shot_id, s.sfx || []]));
  const out = [];
  for (const shot of timeline.shots) {
    sfxOf.get(shot.shot_id).forEach((s, i) => {
      const length = shot.end - shot.start;
      if (s.at >= length) throw new Error(`shot ${shot.shot_id}: sound effect "${s.sfx}" at ${s.at}s starts after the shot ends (${length.toFixed(2)}s)`);
      const { path, duration } = lib.sfx.get(s.sfx);
      const start = Math.round((shot.start + s.at) * 1000) / 1000;
      out.push({
        id: `efekt-${shot.shot_id}-${i}`, path, start, track: 2 + out.length, volume: s.volume ?? 1,
        duration: Math.min(duration, timeline.duration - start),
      });
    });
  }
  return out;
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
  // costume variants: each variant's colours and the episode's own, for the player to switch per shot
  const variantColours = Object.fromEntries(Object.entries(rig.meta.varyantlar || {}).filter(([, d]) => d.palette).map(([k, d]) => [k, d.palette]));
  const colours = Object.keys(variantColours).length
    ? ` data-varyant-renk="${escapeHtml(JSON.stringify(variantColours))}" data-renk="${escapeHtml(JSON.stringify(ch.palette || {}))}"`
    : "";
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
  return `<g id="kar-${ch.id}"${style}${colours}>${markup}</g>`;
}

/**
 * A shot's captions (see altyazi.mjs): none for a line or an episode that turns them off; the
 * scene's place and size as classes; the speaker's colour as a CSS variable when the episode asks.
 */
function captionMarkup(shot, episode, format) {
  const scene = episode.scenes.find((sc) => sc.scene_id === shot.scene_id);
  const lines = scene?.shots.find((s) => s.shot_id === shot.shot_id)?.utterances || [];
  const { konum, boyut } = captionPlace(scene, format);
  const coloured = !!episode.altyazi?.konusan_rengi;
  return shot.utterances
    .map((u, i) => {
      if (!captionShown(episode, lines[i])) return "";
      const words = u.words.length ? u.words.map((w) => w.word) : u.text.trim().split(/\s+/);
      const spans = words.map((w) => `<span class="kelime">${escapeHtml(w)}</span>`).join(" ");
      const colour = coloured ? ` style="--konusan: ${escapeHtml(speakerColor(episode, u.speaker))}"` : "";
      return `<div class="altyazi konum-${konum} boyut-${boyut}${coloured ? " konusan" : ""}" id="altyazi-${shot.shot_id}-${i}"${colour}>${spans}</div>`;
    })
    .filter(Boolean)
    .join("\n      ");
}

/** The tints scenes give their background layers (scene.katmanlar[*].ton), each once. */
function layerTints(episode) {
  // lowercased before counting: #AABBCC and #aabbcc are one filter (the player asks for lowercase)
  return [...new Set(episode.scenes.flatMap((sc) => Object.values(sc.katmanlar || {}).map((k) => k.ton).filter(Boolean).map((c) => c.toLowerCase())))];
}

/**
 * The scene light (scene.isik): one colour matrix over the world group, its values set per frame
 * by the player. The region is the viewport (the group around the camera has no transform).
 */
const lightFilter = (viewport) =>
  `<filter id="isik" filterUnits="userSpaceOnUse" x="0" y="0" width="${viewport.width}" height="${viewport.height}" color-interpolation-filters="sRGB"><feColorMatrix id="isik-m" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"/></filter>`;
/** A filter that tints a layer: the colour multiplied over it, the layer's own shape kept. */
const tintFilter = (c) => `<filter id="ton-${c.slice(1)}" color-interpolation-filters="sRGB"><feFlood flood-color="${c}" flood-opacity="0.55"/><feComposite in2="SourceGraphic" operator="in"/><feBlend in2="SourceGraphic" mode="multiply"/></filter>`;

function pageHtml({ episode, timeline, viewport, lib, audioTags, data, props, decor }) {
  const usedBgs = [...new Set(timeline.shots.map((s) => s.bg))];
  const bgs = usedBgs.map((bg) => {
    const depthProps = props.inBackground.filter((p) => p.bg === bg).map((p) => p.markup).join("");
    // one group per layer, back to front, so the player can move, hide and tint each
    const layers = lib.layers.get(bg).map((l) => {
      const id = `bg-${bg}--k-${l.id}`;
      return `<g id="${id}" data-derinlik="${l.derinlik}">${prefixIds(svgInner(l.svg), id)}</g>`;
    });
    return `<g id="bg-${bg}">${layers.join("")}${depthProps}</g>`;
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
      #altyazilar { position: absolute; inset: 0; pointer-events: none; }
      .altyazi { display: none; position: absolute; left: 50%; transform: translateX(-50%); box-sizing: border-box;
        width: max-content; max-width: 88%; padding: 0.26em 0.52em; border-radius: 0.52em; background: rgba(255, 255, 255, 0.88);
        color: #3a2a20; font-family: sans-serif; font-weight: 700; font-size: ${portrait ? 58 : 54}px; line-height: 1.25; text-align: center; }
      .altyazi.konum-alt { bottom: ${portrait ? "22%" : "3%"}; }
      .altyazi.konum-ust { top: ${portrait ? "9%" : "4%"}; }
      .altyazi.konum-orta { top: 50%; transform: translate(-50%, -50%); }
      .altyazi.boyut-kucuk { font-size: ${portrait ? 46 : 42}px; }
      .altyazi.boyut-buyuk { font-size: ${portrait ? 72 : 68}px; }
      .altyazi.konusan { border: 0.11em solid var(--konusan); }
      .kelime.soylenen { color: #c2453d; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-no-timeline data-start="0" data-width="${viewport.width}" data-height="${viewport.height}" data-duration="${timeline.duration}">
      <svg id="sahne" viewBox="0 0 ${viewport.width} ${viewport.height}" xmlns="http://www.w3.org/2000/svg">
        <defs><filter id="dof" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur id="dof-blur" stdDeviation="0"/></filter>${layerTints(episode).map(tintFilter).join("")}${lightFilter(viewport)}</defs>
        <g id="isik-g">
        <g id="kamera" data-layout-allow-overflow>
          ${bgs.join("\n          ")}
          ${decor.markup.join("\n          ")}
          ${props.ground.join("\n          ")}
          ${chars.join("\n          ")}
        </g>
        </g>
        <rect id="gecis" x="0" y="0" width="${viewport.width}" height="${viewport.height}" fill="#000" opacity="0" pointer-events="none"/>
      </svg>
      <div id="altyazilar">
      ${timeline.shots.map((s) => captionMarkup(s, episode, portrait ? "9:16" : "16:9")).join("\n      ")}
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

const SILENT_RATE = 8000; // enough for silence, and small: 16 kB a second

/** A silent mono 16-bit PCM WAV this many seconds long. */
export function silentWav(seconds, rate = SILENT_RATE) {
  return writeWav({ rate, channels: 1, samples: new Int16Array(Math.ceil(seconds * rate)) });
}

/**
 * What both renders (2D and 3D) need first: the episode checked, its timeline from the real audio,
 * and every line, effect and the music copied into outDir/assets/audio with their <audio> tags.
 * @returns {{episode:object, timeline:object, viewport:{width:number,height:number}, format:string, audioTags:string[], estimated:string[]}}
 */
export function prepareMedia(episodePath, lib, outDir, opts = {}) {
  // opts.episode: compile an unsaved edit (the control panel); paths still resolve next to episodePath.
  const episode = opts.episode ?? readJson(episodePath);
  const { ok, errors } = validateEpisode(episode, lib);
  if (!ok) throw new Error(`episode is invalid:\n- ${errors.join("\n- ")}`);

  const episodeDir = dirname(resolve(episodePath));
  const format = opts.format || episode.format || "16:9";
  if (!has(VIEWPORTS, format)) throw new Error(`unknown format "${format}" (${Object.keys(VIEWPORTS).join(", ")})`);
  const viewport = VIEWPORTS[format];
  const audioFile = (u, shot, i) => safeJoin(episodeDir, audioPathFor(u, shot, i));
  // opts.missingAudio = "estimate" (the panel's preview only): a line not spoken yet gets a
  // length guessed from its text and plays silent, so a new line can be placed and saved
  // before the audio step. A final render never uses this (it needs every line's real audio);
  // a draft render does, it is only a preview.
  const estimated = [];
  const audioInfo = (u, shot, i) => {
    const file = audioFile(u, shot, i);
    if (opts.missingAudio === "estimate" && !existsSync(file)) {
      estimated.push(`${shot.shot_id}-${i}`);
      return { duration: estimateSpeech(u.text), words: [], cues: [] };
    }
    return readAudioInfo(file);
  };
  const timeline = buildTimeline(episode, audioInfo, profileOf(episode, lib).timing);
  const estimatedKeys = new Set(estimated);
  const isEstimated = (shot, i) => estimatedKeys.has(`${shot.shot_id}-${i}`);

  checkActionTimes(timeline);
  const effects = soundEffects(episode, timeline, lib);

  mkdirSync(join(outDir, "assets", "audio"), { recursive: true });

  const audioTags = [];
  const mix = { lines: 1, sfx: 1, ...episode.mix };
  const vol = (x) => String(Math.round(x * 1000) / 1000);
  for (const shot of timeline.shots) {
    shot.utterances.forEach((u, i) => {
      if (isEstimated(shot, i)) return; // no audio yet: nothing to play
      const id = `ses-${shot.shot_id}-${i}`;
      // every line at the same clear level (the cloned voices came out far too quiet)
      // a volume over 1 (the panel goes to 200%) is baked into the file: an audio tag stops at 1
      const loud = (u.volume ?? 1) * mix.lines;
      writeFileSync(join(outDir, "assets", "audio", `${id}.wav`), levelledWav(audioFile(u, shot, i), loud));
      const dur = (u.end - u.start).toFixed(3);
      audioTags.push(`<audio id="${id}" src="assets/audio/${id}.wav" data-start="${u.start}" data-duration="${dur}" data-track-index="1" data-volume="${vol(Math.min(1, loud))}"></audio>`);
    });
  }

  for (const e of effects) {
    copyFileSync(e.path, join(outDir, "assets", "audio", `${e.id}.wav`));
    audioTags.push(`<audio id="${e.id}" src="assets/audio/${e.id}.wav" data-start="${e.start}" data-duration="${e.duration.toFixed(3)}" data-track-index="${e.track}" data-volume="${vol(e.volume * mix.sfx)}"></audio>`);
  }

  if (episode.music) {
    // One file with the fades and the dips under the lines already in it, on a track of its own
    // after the effects (lines use 1, effects 2 and up).
    const speech = timeline.shots.flatMap((s) => s.utterances.map((u) => ({ start: u.start, end: u.end })));
    const track = readWav(readFileSync(lib.music.get(episode.music.track).path));
    writeFileSync(join(outDir, "assets", "audio", "muzik.wav"), writeWav(mixMusic(track, timeline.duration, episode.music, speech)));
    audioTags.push(`<audio id="muzik" src="assets/audio/muzik.wav" data-start="0" data-duration="${timeline.duration.toFixed(3)}" data-track-index="${2 + effects.length}" data-volume="1"></audio>`);
  }
  if (!audioTags.length && opts.silentTrack !== false) {
    // nothing to hear: a silent track anyway, so the video has an audio stream (platforms expect one)
    writeFileSync(join(outDir, "assets", "audio", "sessiz.wav"), silentWav(timeline.duration));
    audioTags.push(`<audio id="sessiz" src="assets/audio/sessiz.wav" data-start="0" data-duration="${timeline.duration.toFixed(3)}" data-track-index="1" data-volume="1"></audio>`);
  }
  return { episode, timeline, viewport, format, audioTags, estimated };
}

/**
 * Compile an episode file into a HyperFrames project.
 * @param {string} episodePath path to episode.json
 * @param {ReturnType<import("./library.mjs").loadLibrary>} lib
 * @param {string} outDir project folder to (over)write
 * @param {{format?: "16:9"|"9:16", episode?: object}} [opts]
 * @returns {{duration:number, shots:number, outDir:string, estimated?:string[]}} estimated: with
 *   opts.missingAudio "estimate", the keys of lines played silent with a guessed length
 */
export function compileEpisode(episodePath, lib, outDir, opts = {}) {
  const { episode, timeline, viewport, audioTags, estimated } = prepareMedia(episodePath, lib, outDir, opts);
  mkdirSync(join(outDir, "runtime"), { recursive: true });
  for (const f of ["core.js", "player.js"]) copyFileSync(join(RUNTIME_DIR, f), join(outDir, "runtime", f));

  const props = propLayer(timeline, episode, lib, viewport);
  const decor = decorLayer(episode, lib, viewport);
  const sceneOf = new Map(episode.scenes.map((sc) => [sc.scene_id, sc]));
  const usedBgs = [...new Set(timeline.shots.map((s) => s.bg))];
  const data = {
    viewport,
    world: lib.world,
    cameras: lib.cameras,
    actions: Object.fromEntries([...lib.actions]),
    characters: episode.characters.map((c) => ({ id: c.id })),
    faces: facesOf(episode, lib),
    backgrounds: usedBgs,
    vanishing: Object.fromEntries(usedBgs.map((bg) => [bg, vanishingPoint(lib.backgrounds.get(bg))])),
    layers: Object.fromEntries(usedBgs.map((bg) => [bg, lib.layers.get(bg).map((l) => ({ id: l.id, derinlik: l.derinlik }))])),
    decor: decor.scenes, // scenes with a decor group (dekor-<scene>)
    shots: timeline.shots.map((s, i) => ({
      shot_id: s.shot_id, scene_id: s.scene_id, bg: s.bg, start: s.start, end: s.end, cast: s.cast, camera: s.camera,
      ...(sceneOf.get(s.scene_id)?.katmanlar ? { katmanlar: sceneOf.get(s.scene_id).katmanlar } : {}),
      ...(sceneOf.get(s.scene_id)?.isik ? { isik: sceneOf.get(s.scene_id).isik } : {}),
      ...(sceneOf.get(s.scene_id)?.gecis ? { gecis: sceneOf.get(s.scene_id).gecis } : {}),
      utterances: s.utterances.map((u) => ({ speaker: u.speaker, start: u.start, end: u.end, words: u.words, cues: u.cues })),
      props: props.data[i],
      anchors: props.anchors[i],
    })),
  };

  writeFileSync(join(outDir, "index.html"), pageHtml({ episode, timeline, viewport, lib, audioTags, data, props, decor }));
  writeFileSync(join(outDir, "timing.json"), JSON.stringify(timeline, null, 2));
  return { duration: timeline.duration, shots: timeline.shots.length, outDir, ...(opts.missingAudio === "estimate" ? { estimated } : {}) };
}
