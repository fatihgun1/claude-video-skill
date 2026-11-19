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
import { gateCues, silencesOfFile, decodeWav } from "./dudak.mjs";
import { levelledWav, levelGain, moodGain, SFX_TARGET_DB, MUSIC_TARGET_DB } from "./ses-duzey.mjs";
import { captionPlace, captionShown, speakerColor, captionMax, captionChunks } from "./altyazi.mjs";
import { placeEffects } from "./efekt.mjs";

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
 * The shots as the player frames them, for the checks (Faz 4.1): timed (lines by their guessed
 * length, the moments that must be seen), the cast settled (sitting, bending: kok_y, kok_x, kok_yol)
 * and the prop anchors in this format. The film checks framed raw, untimed shots with a default
 * face height and could pass a frame the player then cut. Lines take their guessed length here, so
 * nothing is read from disk.
 * @param {{width:number, height:number}} viewport
 * @returns {object[]} timeline shots with settled cast and anchors, in order
 */
export function readyShots(episode, lib, viewport) {
  const timeline = buildTimeline(episode, (u) => ({ duration: estimateSpeech(u.text || "") }), profileOf(episode, lib).timing, momentsOf(lib));
  const props = propLayer(timeline, episode, lib, viewport);
  const rigOf = (id) => lib.characters.get(episode.characters.find((c) => c.id === id)?.rig);
  return timeline.shots.map((s, i) => ({ ...s, cast: s.cast.map((m) => settled(m, s, lib, rigOf(m.id))), anchors: props.anchors[i] }));
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
const CLOSE_INSERT = new Set(["detay", "close"]);
const SET_DOWN_REACH = 250; // rig units in front of the feet where a bent person's hand sets a thing down // framings tight enough to lose a prop that is not where the camera looks

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
 * When a member's actions put the held prop away (release.t of an action: into a bag, a pocket),
 * in shot seconds, or null. From then on the prop is gone from the hand and the floor.
 */
export function releaseTime(member, lib) {
  return momentOf(member, lib, "release");
}

/** The moments of a cast member that must be on screen before the cut: its grab and its put-away. */
export const momentsOf = (lib) => (member) => [grabTime(member, lib), releaseTime(member, lib), momentOf(member, lib, "put_down")].filter((t) => t != null);

/** When the first action with this moment (release, put_down) reaches it, in shot seconds, or null. */
function momentOf(member, lib, field) {
  const segs = globalThis.CizgiCore.segmentsOf(member);
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const r = lib.actions.get(s.action)?.[field]?.t;
    if (r == null || r < s.from) continue; // started past that moment: it has nothing left to put away
    const t = (i === 0 ? 0 : s.at) + (r - s.from);
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
        // a camera aimed at it looks where it is drawn, its grip point (it showed the middle of the world; Faz 4.12)
        anchors[si][pr.id] = [dx, dy - (by - (prop.grip || prop.base)[1]) * scale];
        return { key, holder: null, grab: null, release: null };
      }
      // a place beside a mark shrinks like a person's (layout.spread): a prop given its holder's dx lies at the holder in 9:16 too
      const spread = layout.spread ?? layout.ratio;
      const x = layout.marks[pr.mark] + (pr.dx || 0) * spread;
      // A prop someone standing back (cast.back) will pick up lies at their depth, so it does not
      // jump up and shrink when it goes into their hand.
      const holderMember = pr.holder ? shot.cast.find((m) => m.id === pr.holder) : null;
      const depth = holderMember ? globalThis.CizgiCore.depthOf(holderMember, layout) : { rise: 0, shrink: 1 };
      const floorY = lib.world.ground_y - depth.rise;
      const lieScale = ratio * depth.shrink;
      // where the camera looks when it targets this prop: its grip point as it lies on the ground
      anchors[si][pr.id] = [x, floorY - (by - (prop.grip || prop.base)[1]) * lieScale]; // a prop no one holds: its base
      // taken out of a bag or a pocket (gizli): it lies nowhere before the grab
      if (!pr.gizli) {
        const groundInner = prefixIds(svgInner(prop.svg), `prop-${key}-yer`);
        ground.push(
          `<g id="prop-${key}-yer" display="none" transform="translate(${x.toFixed(1)} ${floorY}) scale(${lieScale.toFixed(4)}) translate(${-bx} ${-by})">${groundInner}</g>`,
        );
      }
      if (!pr.holder) return { key, holder: null, grab: null, release: null };
      const member = shot.cast.find((m) => m.id === pr.holder);
      const grab = grabTime(member, lib);
      // A close insert of the pick-up itself keeps its eye on the floor spot, where the hand closes
      // on the prop: the holder's body is bent away from it (Hurda Kralı 1: the bottle was off frame)
      const pickUpInsert = shot.camera.target === pr.id && CLOSE_INSERT.has(shot.camera.framing) && grab != null && grab > 0;
      /** A copy of the prop in someone's hand (`suffix`: el for the holder, al for whom it is handed to). */
      const inHand = (who, hand, suffix) => {
        const handGroup = parseGroups(lib.characters.get(rigOf[who]).svg).get(`hand_${hand}`);
        const [gx, gy] = (handGroup.attrs["data-grip"] || handGroup.attrs["data-pivot"]).split(",").map(Number);
        // A hand holds a bottle or handle across the palm, perpendicular to the forearm:
        // data-grip-angle turns the prop in the hand (90 = across a hand that hangs down).
        const gripAngle = Number(handGroup.attrs["data-grip-angle"] || 0);
        const [px, py] = prop.grip;
        const inner = prefixIds(svgInner(prop.svg), `prop-${key}-${suffix}`);
        const markup = `<g id="prop-${key}-${suffix}" display="none" transform="translate(${gx} ${gy}) rotate(${gripAngle}) scale(${rigUnitsPerWorld(lib).toFixed(4)}) translate(${-px} ${-py})">${inner}</g>`;
        held.set(who, [...(held.get(who) || []), { hand, markup }]);
        return gy;
      };
      const gy = inHand(pr.holder, pr.hand || "L", "el");
      // A held prop is in the hand for the shot: the camera looks at the holder's hand height, over
      // the holder (its mid-shot place), not at the spot on the floor it was picked up from.
      const dur = shot.end != null && shot.start != null ? shot.end - shot.start : 1;
      if (!pickUpInsert) {
        const handY = lib.world.ground_y - depth.rise - (RIG_FEET_Y - gy) * layout.scale * depth.shrink;
        const atX = (p) => globalThis.CizgiCore.memberX(holderMember, layout, p * dur, dur);
        // carried by someone walking: the anchor walks with them (Faz 4.7), sampled over the shot
        const path = holderMember.walk ? Array.from({ length: FOLLOW_SAMPLES + 1 }, (_, i) => [i / FOLLOW_SAMPLES, Math.round(atX(i / FOLLOW_SAMPLES) * 10) / 10]) : null;
        anchors[si][pr.id] = [atX(0.5), handY, ...(path ? [path] : [])];
      }
      const release = releaseTime(member, lib);
      // handed over (to): at the giver's release it is in the taker's hand, never in both
      // (Hurda Kralı 2: one note in two hands at once)
      if (pr.to) inHand(pr.to, pr.to_hand || "L", "al");
      // set down (an action with put_down): from then on it lies where it was put (sonra), or at the
      // holder's feet (Hurda Kralı 2: the bottle put on the scale vanished)
      const put = momentOf(member, lib, "put_down");
      if (put != null) {
        // without sonra: in front of the holder, where the hand reaches down at that moment (not where they first stood)
        const ahead = (holderMember.facing === "sol" ? -1 : 1) * SET_DOWN_REACH * layout.scale * depth.shrink;
        const sx = pr.sonra
          ? layout.marks[pr.sonra.mark] + (pr.sonra.dx || 0) * spread
          : globalThis.CizgiCore.memberX(holderMember, layout, put, shot.end != null ? shot.end - shot.start : put) + ahead;
        const afterInner = prefixIds(svgInner(prop.svg), `prop-${key}-sonra`);
        ground.push(`<g id="prop-${key}-sonra" display="none" transform="translate(${sx.toFixed(1)} ${floorY}) scale(${lieScale.toFixed(4)}) translate(${-bx} ${-by})">${afterInner}</g>`);
      }
      return { key, holder: pr.holder, grab, release, ...(put != null ? { put } : {}), ...(pr.to ? { to: pr.to } : {}) };
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
/**
 * How a scene begins: its own gecis, else a hard cut when it goes on in the same place at the same
 * time of day as the scene before (the same moment, split in two), else a dip to black. A dip in
 * the middle of one moment read as a long, wrong break (Köşe Başı: "geçişler çok uzun").
 * @returns {"kararma"|"kesme"}
 */
export function sceneTransition(episode, sceneId) {
  const i = episode.scenes.findIndex((s) => s.scene_id === sceneId);
  const scene = episode.scenes[i];
  if (scene?.gecis) return scene.gecis;
  const prev = episode.scenes[i - 1];
  const same = prev && prev.bg === scene.bg && (prev.isik?.saat || "") === (scene.isik?.saat || "");
  return same ? "kesme" : "kararma";
}

/**
 * A cast member with kok_y: how far its body has dropped (rig units, + down) once its actions have
 * played out in this shot. The camera looks there: a close-up of someone sitting on the ground
 * framed the empty air where a standing face would be (Köşe Başı: a caption, nobody on screen).
 */
function settled(member, shot, lib, rig) {
  const C = globalThis.CizgiCore;
  const dur = Math.max(0, shot.end - shot.start);
  const poseAt = (t) => {
    const seg = C.segmentAt(member, t);
    const action = lib.actions.get(seg.action);
    return action ? C.sampleAction(action, seg.time) : {};
  };
  const drop = poseAt(dur).root_y || 0;
  const out = Math.abs(drop) < 1 ? member : { ...member, kok_y: Math.round(drop) };
  if (shot.camera?.target !== member.id || !dur) return out;
  // Where the face is, against standing: the hips drop (root) and the body turns about them, so a
  // bend takes the face down and forward (Hurda Kralı 1 s2_sh2: framed for the hips alone, the head
  // went out at the top, then at the side)
  const torso = torsoOf(rig);
  const face = (pose) => {
    const a = ((pose.body || 0) * Math.PI) / 180;
    return [Math.round((pose.root_y || 0) + torso * (1 - Math.cos(a))), Math.round((pose.root_x || 0) + torso * Math.sin(a))];
  };
  const path = Array.from({ length: FOLLOW_SAMPLES + 1 }, (_, i) => [i / FOLLOW_SAMPLES, ...face(poseAt((dur * i) / FOLLOW_SAMPLES))]);
  const ys = path.map(([, y]) => y);
  const xs = path.map(([, , x]) => x);
  const range = (v) => Math.max(...v) - Math.min(...v);
  if (range(ys) < 1 && range(xs) < 1 && !xs[0]) return out;
  // A follow shot rises and leans with them (s1_sh1: one unbroken shot from the cardboard to standing)
  if (shot.camera.move === "follow") return { ...out, kok_yol: path };
  // A framing wide enough to hold the whole movement centres on it; a close one keeps the end
  if (TIGHT_FRAMINGS.has(shot.camera.framing)) return out;
  const mid = (v) => Math.round((Math.max(...v) + Math.min(...v)) / 2);
  return { ...out, kok_y: mid(ys), kok_x: mid(xs) };
}
const FOLLOW_SAMPLES = 24; // pose samples over a shot: smooth enough for a rise of a second or two
const TIGHT_FRAMINGS = new Set(["close", "gogus", "detay"]); // these frame the face as the shot ends

/** Rig units from the hips (the body's pivot) up to the face: how far a bend swings the face. */
function torsoOf(rig) {
  if (!rig?.svg) return 0;
  const pivot = parseGroups(rig.svg).get("body")?.attrs["data-pivot"];
  const hipY = pivot ? Number(pivot.split(",")[1]) : NaN;
  const faceY = rig.meta?.face_y;
  return Number.isFinite(hipY) && Number.isFinite(faceY) && hipY > faceY ? hipY - faceY : 0;
}

/** Decor this far back (0-1) is part of the background: soft in a close framing, like it. */
const DECOR_FAR = 0.3;

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
      // far pieces go soft with the background in a close framing (data-uzak: the player blurs them)
      const far = (d.back || 0) >= DECOR_FAR || d.akis?.back ? ' data-uzak="1"' : "";
      // a moving piece (a crowd walking by): the player places it every frame from these
      const flow = d.akis && (d.akis.dx || d.akis.back)
        ? ` data-akis="${escapeHtml(JSON.stringify({ x: d.x, back: d.back || 0, olcek: d.olcek ?? 1, ters: !!d.ters, bx, by, ratio, dx: d.akis.dx || 0, db: d.akis.back || 0 }))}"`
        : "";
      return `<g id="${id}"${far}${flow} transform="translate(${num(x)} ${num(y)}) scale(${(d.ters ? -s : s).toFixed(4)} ${s.toFixed(4)}) translate(${-bx} ${-by})">${prefixIds(svgInner(prop.svg), id)}</g>`;
    });
    // further back first, so a nearer piece is drawn over a farther one
    const order = sc.dekor.map((d, i) => ({ i, back: d.back || 0 })).sort((a, b) => b.back - a.back || a.i - b.i);
    return `<g id="dekor-${sc.scene_id}" display="none">${order.map((o) => items[o.i]).join("")}</g>`;
  });
  return { markup, scenes: scenes.map((sc) => sc.scene_id) };
}

/** Shot seconds of an action moment of a cast member (efekt.mjs: an effect tied to it), or null. */
const momentAtOf = (lib) => (member, an) => (an === "grab" ? grabTime(member, lib) : momentOf(member, lib, an));

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
      const pieces = captionChunks(words, captionMax(scene, format)); // at most two lines on screen at a time
      const spans = words.map((w, k) => `<span class="kelime" data-parca="${pieces[k]}">${escapeHtml(w)}</span>`).join(" ");
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
          <g id="yerdekiler">${props.ground.join("\n          ")}</g>
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
    <script src="runtime/yuz.js"></script>
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
    // a recording made for other words or another voice is not played either (opts.stale: the
    // keys staleLines gives): after a line was put in between, the old takes slid onto the wrong lines
    if (opts.missingAudio === "estimate" && (!existsSync(file) || opts.stale?.includes(`${shot.shot_id}-${i}`))) {
      estimated.push(`${shot.shot_id}-${i}`);
      return { duration: estimateSpeech(u.text), words: [], cues: [] };
    }
    return readAudioInfo(file);
  };
  const laidOut = buildTimeline(episode, audioInfo, profileOf(episode, lib).timing, momentsOf(lib));
  const estimatedKeys = new Set(estimated);
  const isEstimated = (shot, i) => estimatedKeys.has(`${shot.shot_id}-${i}`);

  checkActionTimes(laidOut);
  const effects = placeEffects(episode, laidOut, lib, momentAtOf(lib));
  // each shot's effects where they play (shot seconds, a list per effect: steps play many times),
  // for the panel's timeline: an effect tied to a line or a moment has no "at" of its own
  const timeline = {
    ...laidOut,
    shots: laidOut.shots.map((s) => (s.sfx?.length ? { ...s, efekt_at: s.sfx.map((_, i) => effects.filter((e) => e.shot_id === s.shot_id && e.index === i).map((e) => e.at)) } : s)),
  };

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
      const loud = (u.volume ?? 1) * mix.lines * moodGain(u.duygu); // the feeling after the levelling, which would undo it
      writeFileSync(join(outDir, "assets", "audio", `${id}.wav`), levelledWav(audioFile(u, shot, i), loud));
      const dur = (u.end - u.start).toFixed(3);
      audioTags.push(`<audio id="${id}" src="assets/audio/${id}.wav" data-start="${u.start}" data-duration="${dur}" data-track-index="1" data-volume="${vol(Math.min(1, loud))}"></audio>`);
    });
  }

  for (const e of effects) {
    writeFileSync(join(outDir, "assets", "audio", `${e.id}.wav`), levelledWav(e.path, 1, SFX_TARGET_DB)); // every effect at one level
    audioTags.push(`<audio id="${e.id}" src="assets/audio/${e.id}.wav" data-start="${e.start}" data-duration="${e.duration.toFixed(3)}" data-track-index="${e.track}" data-volume="${vol(e.volume * mix.sfx)}"></audio>`);
  }

  if (episode.music) {
    // One file with the fades and the dips under the lines already in it, on a track of its own
    // after the effects (lines use 1, effects 2 and up).
    const speech = timeline.shots.flatMap((s) => s.utterances.map((u) => ({ start: u.start, end: u.end })));
    const raw = readFileSync(lib.music.get(episode.music.track).path);
    const track = readWav(raw);
    let level = 1;
    try {
      level = levelGain(decodeWav(raw), MUSIC_TARGET_DB);
    } catch {
      level = 1; // a WAV the level reader cannot read plays at its own level
    }
    writeFileSync(join(outDir, "assets", "audio", "muzik.wav"), writeWav(mixMusic(track, timeline.duration, episode.music, speech, level)));
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
  for (const f of ["core.js", "yuz.js", "player.js"]) copyFileSync(join(RUNTIME_DIR, f), join(outDir, "runtime", f));

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
      shot_id: s.shot_id, scene_id: s.scene_id, bg: s.bg, start: s.start, end: s.end, cast: s.cast.map((m) => settled(m, s, lib, lib.characters.get(episode.characters.find((c) => c.id === m.id)?.rig))), camera: s.camera,
      ...(sceneOf.get(s.scene_id)?.katmanlar && s.bg === sceneOf.get(s.scene_id).bg ? { katmanlar: sceneOf.get(s.scene_id).katmanlar } : {}),
      ...(s.bg !== sceneOf.get(s.scene_id)?.bg ? { aci: true } : {}), // another angle: the scene's decor stands on its own picture
      ...(sceneOf.get(s.scene_id)?.isik ? { isik: sceneOf.get(s.scene_id).isik } : {}),
      ...(s.zaman_atlama ? { zaman_atlama: true } : {}),
      gecis: sceneTransition(episode, s.scene_id),
      utterances: s.utterances.map((u) => ({ speaker: u.speaker, start: u.start, end: u.end, words: u.words, cues: u.cues, ...(u.duygu ? { duygu: u.duygu } : {}) })),
      props: props.data[i],
      anchors: props.anchors[i],
    })),
  };

  writeFileSync(join(outDir, "index.html"), pageHtml({ episode, timeline, viewport, lib, audioTags, data, props, decor }));
  writeFileSync(join(outDir, "timing.json"), JSON.stringify(timeline, null, 2));
  return { duration: timeline.duration, shots: timeline.shots.length, outDir, ...(opts.missingAudio === "estimate" ? { estimated } : {}) };
}
