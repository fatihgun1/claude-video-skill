/**
 * Episode validation: JSON schema + references into the library.
 * An episode may only name things that exist; anything new goes to `new_assets`
 * and needs a human decision before it can be used.
 */
import { readFileSync } from "node:fs";
import Ajv from "ajv";
import { has } from "./util.mjs";

const schema = JSON.parse(readFileSync(new URL("./schema/episode.schema.json", import.meta.url), "utf8"));
const ajv = new Ajv({ allErrors: true });
const checkSchema = ajv.compile(schema);

const NARRATOR = "anlatici";

function list(names) {
  return [...names].sort().join(", ");
}

function checkShot(shot, where, ctx) {
  const errors = [];
  const { lib, characterIds } = ctx;
  const castIds = shot.cast.map((c) => c.id);

  for (const member of shot.cast) {
    if (!characterIds.has(member.id)) errors.push(`${where}: cast "${member.id}" is not in characters`);
    if (!lib.actions.has(member.action)) {
      errors.push(`${where}: action "${member.action}" is not in the library (${list(lib.actions.keys())})`);
    }
  }
  if (new Set(castIds).size !== castIds.length) errors.push(`${where}: a character appears twice in cast`);
  const marks = shot.cast.map((c) => c.mark);
  if (new Set(marks).size !== marks.length) errors.push(`${where}: two characters share a mark`);

  const cam = shot.camera;
  if (!has(lib.cameras.framings, cam.framing)) {
    errors.push(`${where}: camera framing "${cam.framing}" is not in the library (${list(Object.keys(lib.cameras.framings))})`);
  }
  if (cam.move && !has(lib.cameras.moves, cam.move)) {
    errors.push(`${where}: camera move "${cam.move}" is not in the library (${list(Object.keys(lib.cameras.moves))})`);
  }
  if (cam.target && !castIds.includes(cam.target)) errors.push(`${where}: camera target "${cam.target}" is not in this shot's cast`);

  for (const u of shot.utterances || []) {
    if (u.speaker !== NARRATOR && !castIds.includes(u.speaker)) {
      errors.push(`${where}: speaker "${u.speaker}" must be "${NARRATOR}" or in this shot's cast`);
    }
  }
  return errors;
}

/**
 * Validate an episode against the schema and the library.
 * @param {unknown} episode parsed episode JSON
 * @param {ReturnType<import("./library.mjs").loadLibrary>} lib
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateEpisode(episode, lib) {
  if (!checkSchema(episode)) {
    const errors = checkSchema.errors.map((e) => `schema ${e.instancePath || "/"}: ${e.message}`);
    return { ok: false, errors };
  }
  const errors = [];
  const characterIds = new Set();
  for (const c of episode.characters) {
    if (characterIds.has(c.id)) errors.push(`character id "${c.id}" is used twice`);
    characterIds.add(c.id);
    const rig = lib.characters.get(c.rig);
    if (!rig) {
      errors.push(`character "${c.id}": rig "${c.rig}" is not in the library (${list(lib.characters.keys())})`);
      continue;
    }
    const allowed = rig.meta.palette_vars || [];
    for (const key of Object.keys(c.palette || {})) {
      if (!allowed.includes(key)) {
        errors.push(`character "${c.id}": palette "${key}" is not a colour of rig ${c.rig} (${list(allowed)})`);
      }
    }
  }
  if (characterIds.has(NARRATOR)) errors.push(`"${NARRATOR}" is reserved for the narrator`);

  const shotIds = new Set();
  const sceneIds = new Set();
  for (const scene of episode.scenes) {
    if (sceneIds.has(scene.scene_id)) errors.push(`scene id "${scene.scene_id}" is used twice`);
    sceneIds.add(scene.scene_id);
    if (!lib.backgrounds.has(scene.bg)) {
      errors.push(`scene ${scene.scene_id}: background "${scene.bg}" is not in the library (${list(lib.backgrounds.keys())})`);
    }
    for (const shot of scene.shots) {
      if (shotIds.has(shot.shot_id)) errors.push(`shot id "${shot.shot_id}" is used twice`);
      shotIds.add(shot.shot_id);
      errors.push(...checkShot(shot, `shot ${shot.shot_id}`, { lib, characterIds }));
    }
  }
  return { ok: errors.length === 0, errors };
}

export { NARRATOR };
