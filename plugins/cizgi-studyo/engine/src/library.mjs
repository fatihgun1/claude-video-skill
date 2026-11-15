/**
 * Asset library loader. The library is the closed vocabulary an episode may use:
 * character rigs, actions, backgrounds, camera presets and the world layout.
 * Everything is checked on load so mistakes surface here, not as a blank render.
 */
import { readdirSync, existsSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { checkRig, checkSvgSafety, ROTATABLE_PARTS, OPTIONAL_ROTATABLE } from "./rigspec.mjs";
import { readJson, readText, ID_PATTERN, has } from "./util.mjs";
import "./runtime/core.js";

const { EASES } = globalThis.CizgiCore;
const POSE_CHANNELS = new Set([...ROTATABLE_PARTS, ...OPTIONAL_ROTATABLE, "root_y", "root_sx", "root_sy"]);
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
  if (!cameras.framings || !Object.keys(cameras.framings).length) errors.push("cameras.json: needs framings");
  if (!has(cameras.moves, "static")) errors.push('cameras.json: moves must include "static"');
  for (const [id, f] of Object.entries(cameras.framings || {})) {
    if (!ID_PATTERN.test(id)) errors.push(`cameras.json: bad framing id "${id}"`);
    if (!isNum(f.zoom) || f.zoom < 1) errors.push(`cameras.json: framing ${id} needs zoom >= 1`);
  }
  for (const [id, m] of Object.entries(cameras.moves || {})) {
    if (!ID_PATTERN.test(id)) errors.push(`cameras.json: bad move id "${id}"`);
    for (const f of ["zoom_from", "zoom_to", "pan_from", "pan_to"]) {
      if (m[f] !== undefined && !isNum(m[f])) errors.push(`cameras.json: move ${id}.${f} must be a number`);
    }
    if (m.ease !== undefined && !has(EASES, m.ease)) errors.push(`cameras.json: move ${id} has unknown ease "${m.ease}"`);
  }
  return errors;
}

function checkId(kind, id, errors) {
  if (!ID_PATTERN.test(id)) errors.push(`${kind} "${id}": name must be lowercase letters, digits, - or _`);
}

/**
 * Load and verify a library folder.
 * @param {string} dir
 * @returns {{dir:string, world:object, cameras:object, characters:Map<string,{meta:object,svg:string}>, actions:Map<string,object>, backgrounds:Map<string,string>}}
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

  if (errors.length) throw new Error(`library is invalid:\n- ${errors.join("\n- ")}`);
  return { dir, world, cameras, characters, actions, backgrounds };
}
