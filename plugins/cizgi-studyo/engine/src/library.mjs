/**
 * Asset library loader. The library is the closed vocabulary an episode may use:
 * character rigs, actions, backgrounds, camera presets and the world layout.
 * Everything is checked on load so mistakes surface here, not as a blank render.
 */
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { checkRig, checkSvgSafety, POSE_CHANNELS as CHANNEL_LIST } from "./rigspec.mjs";
import { readJson, readText, ID_PATTERN, has } from "./util.mjs";
import { wavDuration } from "./timing.mjs";
import "./runtime/core.js";

const { EASES } = globalThis.CizgiCore;
const POSE_CHANNELS = new Set(CHANNEL_LIST);
const MARKS = ["sol", "orta", "sag"];

function entries(dir, ext) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => (ext ? e.isFile() && extname(e.name) === ext : e.isDirectory()))
    .map((e) => e.name)
    .sort();
}

const isNum = (x) => typeof x === "number" && Number.isFinite(x);

/**
 * Check an action definition; returns errors.
 * @param {object} action
 * @param {string} name file name used in messages
 * @returns {string[]}
 */
export function checkAction(action, name) {
  const errors = [];
  if (!(action.duration > 0)) errors.push(`${name}: duration must be > 0`);
  if (!Array.isArray(action.keys) || action.keys.length < 1) {
    errors.push(`${name}: needs at least one key`);
    return errors;
  }
  let last = -1;
  for (const key of action.keys) {
    if (typeof key !== "object" || key === null) {
      errors.push(`${name}: every key must be an object`);
      continue;
    }
    if (!isNum(key.t) || key.t < 0 || key.t > action.duration) {
      errors.push(`${name}: key t=${key.t} outside 0..${action.duration}`);
    }
    if (key.t <= last) errors.push(`${name}: key times must increase`);
    last = key.t;
    if (key.ease !== undefined && !has(EASES, key.ease)) {
      errors.push(`${name}: unknown ease "${key.ease}" (${Object.keys(EASES).join(", ")})`);
    }
    if (typeof key.pose !== "object" || key.pose === null) {
      errors.push(`${name}: key t=${key.t} has no pose`);
      continue;
    }
    for (const [ch, v] of Object.entries(key.pose)) {
      if (!POSE_CHANNELS.has(ch)) errors.push(`${name}: unknown pose channel "${ch}"`);
      else if (!isNum(v)) errors.push(`${name}: ${ch} must be a number`);
    }
  }
  if (action.keys[0]?.t !== 0) errors.push(`${name}: first key must be at t=0`);
  if (action.grab !== undefined && !(isNum(action.grab?.t) && action.grab.t >= 0 && action.grab.t <= action.duration)) {
    errors.push(`${name}: grab.t must be a time within the action`);
  }
  if (action.loop && action.keys.at(-1)?.t !== action.duration) {
    errors.push(`${name}: a looping action needs its last key at t=duration`);
  }
  return errors;
}

/**
 * Check world.json and cameras.json; returns errors.
 * @param {object} world
 * @param {object} cameras
 * @returns {string[]}
 */
export function checkSettings(world, cameras) {
  const errors = [];
  for (const f of ["width", "height", "ground_y", "character_height"]) {
    if (!isNum(world[f]) || world[f] <= 0) errors.push(`world.json: ${f} must be a positive number`);
  }
  for (const m of MARKS) if (!isNum(world.marks?.[m])) errors.push(`world.json: marks.${m} must be a number`);
  if (world.portrait !== undefined) {
    for (const m of MARKS) if (!isNum(world.portrait.marks?.[m])) errors.push(`world.json: portrait.marks.${m} must be a number`);
    const s = world.portrait.character_scale;
    if (!isNum(s) || s < 0.3 || s > 1.5) errors.push("world.json: portrait.character_scale must be 0.3..1.5");
  }
  if (!cameras.framings || !Object.keys(cameras.framings).length) errors.push("cameras.json: needs framings");
  if (!has(cameras.moves, "static")) errors.push('cameras.json: moves must include "static"');
  for (const [id, f] of Object.entries(cameras.framings || {})) {
    if (!ID_PATTERN.test(id)) errors.push(`cameras.json: bad framing id "${id}"`);
    if (!isNum(f.zoom) || f.zoom < 1) errors.push(`cameras.json: framing ${id} needs zoom >= 1`);
    if (f.anchor !== undefined && !["face", "body", "chest"].includes(f.anchor)) errors.push(`cameras.json: framing ${id} anchor must be "face", "body" or "chest"`);
    if (f.blur !== undefined && !(isNum(f.blur) && f.blur >= 0 && f.blur <= 20)) errors.push(`cameras.json: framing ${id} blur must be 0..20`);
  }
  for (const [id, m] of Object.entries(cameras.moves || {})) {
    if (!ID_PATTERN.test(id)) errors.push(`cameras.json: bad move id "${id}"`);
    for (const f of ["zoom_from", "zoom_to", "pan_from", "pan_to", "dolly_to"]) {
      if (m[f] !== undefined && !isNum(m[f])) errors.push(`cameras.json: move ${id}.${f} must be a number`);
    }
    if (m.ease !== undefined && !has(EASES, m.ease)) errors.push(`cameras.json: move ${id} has unknown ease "${m.ease}"`);
  }
  return errors;
}

const TIMING_FIELDS = ["lead", "gap", "default_hold", "tail", "min_shot"];
const INT_RULES = ["max_cast", "max_words_per_sentence", "max_count"];

/**
 * Check a profile (timing, speech and content rules); returns errors.
 * @param {object} profile
 * @param {string} name
 * @returns {string[]}
 */
export function checkProfile(profile, name) {
  const errors = [];
  for (const f of TIMING_FIELDS) {
    if (!isNum(profile.timing?.[f]) || profile.timing[f] < 0) errors.push(`${name}: timing.${f} must be a number >= 0`);
  }
  const sp = profile.speech || {};
  if (!isNum(sp.tempo) || sp.tempo < 0.5 || sp.tempo > 1.5) errors.push(`${name}: speech.tempo must be 0.5..1.5`);
  if (!isNum(sp.max_cer) || sp.max_cer < 0 || sp.max_cer > 1) errors.push(`${name}: speech.max_cer must be 0..1`);
  if (!Number.isInteger(sp.retries) || sp.retries < 0 || sp.retries > 5) errors.push(`${name}: speech.retries must be 0..5`);
  const rules = profile.rules || {};
  for (const r of INT_RULES) {
    if (rules[r] !== undefined && !(Number.isInteger(rules[r]) && rules[r] > 0)) errors.push(`${name}: rules.${r} must be a positive integer`);
  }
  if (rules.min_hold !== undefined && !isNum(rules.min_hold)) errors.push(`${name}: rules.min_hold must be a number`);
  if (rules.allowed_moves !== undefined && !Array.isArray(rules.allowed_moves)) errors.push(`${name}: rules.allowed_moves must be a list`);
  return errors;
}

/**
 * A prop is an SVG drawn in world units with two anchors on its <svg> element:
 *   data-base="x,y"  the point that rests on the ground
 *   data-grip="x,y"  the point that sits in a character's hand
 * @param {string} svg
 * @returns {{errors: string[], grip: number[]|null, base: number[]|null}}
 */
export function checkProp(svg) {
  const errors = checkSvgSafety(svg);
  const tag = /<svg\b[^>]*>/.exec(svg)?.[0] || "";
  const point = (name) => {
    const m = new RegExp(`${name}=["'](-?\\d+(?:\\.\\d+)?),(-?\\d+(?:\\.\\d+)?)["']`).exec(tag);
    if (!m) errors.push(`<svg> needs ${name}="x,y"`);
    return m ? [Number(m[1]), Number(m[2])] : null;
  };
  return { errors, grip: point("data-grip"), base: point("data-base") };
}

function checkId(kind, id, errors) {
  if (!ID_PATTERN.test(id)) errors.push(`${kind} "${id}": name must be lowercase letters, digits, - or _`);
}

/**
 * Load and verify a library folder.
 * @param {string} dir
 * @returns {{dir:string, world:object, cameras:object, characters:Map<string,{meta:object,svg:string}>, actions:Map<string,object>, backgrounds:Map<string,string>, profiles:Map<string,object>}}
 * @throws when any asset breaks the specification
 */
export function loadLibrary(dir) {
  const world = readJson(join(dir, "world.json"));
  const cameras = readJson(join(dir, "cameras.json"));
  const errors = checkSettings(world, cameras);

  const characters = new Map();
  for (const id of entries(join(dir, "characters"))) {
    checkId("character", id, errors);
    const svg = readText(join(dir, "characters", id, "rig.svg"));
    const meta = readJson(join(dir, "characters", id, "character.json"));
    for (const e of checkRig(svg)) errors.push(`character ${id}: ${e}`);
    characters.set(id, { meta, svg });
  }

  const actions = new Map();
  for (const file of entries(join(dir, "actions"), ".json")) {
    const id = basename(file, ".json");
    checkId("action", id, errors);
    const action = readJson(join(dir, "actions", file));
    errors.push(...checkAction(action, `action ${file}`));
    actions.set(id, action);
  }

  const backgrounds = new Map();
  for (const file of entries(join(dir, "backgrounds"), ".svg")) {
    const id = basename(file, ".svg");
    checkId("background", id, errors);
    const svg = readText(join(dir, "backgrounds", file));
    for (const e of checkSvgSafety(svg)) errors.push(`background ${id}: ${e}`);
    backgrounds.set(id, svg);
  }

  const props = new Map();
  for (const file of entries(join(dir, "props"), ".svg")) {
    const id = basename(file, ".svg");
    checkId("prop", id, errors);
    const svg = readText(join(dir, "props", file));
    const { errors: propErrors, grip, base } = checkProp(svg);
    for (const e of propErrors) errors.push(`prop ${id}: ${e}`);
    props.set(id, { svg, grip, base });
  }

  // Sound effects: short WAVs played at a time inside a shot (shot.sfx).
  const sfx = new Map();
  for (const file of entries(join(dir, "sfx"), ".wav")) {
    const id = basename(file, ".wav");
    checkId("sound effect", id, errors);
    const path = join(dir, "sfx", file);
    try {
      sfx.set(id, { path, duration: wavDuration(readFileSync(path)) });
    } catch (err) {
      errors.push(`sound effect ${id}: ${err.message}`);
    }
  }

  const profiles = new Map();
  for (const file of entries(join(dir, "profiles"), ".json")) {
    const id = basename(file, ".json");
    checkId("profile", id, errors);
    const profile = readJson(join(dir, "profiles", file));
    errors.push(...checkProfile(profile, `profile ${file}`));
    profiles.set(id, profile);
  }
  if (!profiles.has("genel")) errors.push('profiles/genel.json is required (the default profile)');

  if (errors.length) throw new Error(`library is invalid:\n- ${errors.join("\n- ")}`);
  return { dir, world, cameras, characters, actions, backgrounds, profiles, props, sfx };
}
