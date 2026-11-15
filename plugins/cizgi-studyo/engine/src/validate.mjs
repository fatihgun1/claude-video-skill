/**
 * Episode validation: JSON schema + references into the library.
 * An episode may only name things that exist; anything new goes to `new_assets`
 * and needs a human decision before it can be used.
 */
import { readFileSync } from "node:fs";
import Ajv from "ajv";
import { has } from "./util.mjs";
import { filmWarnings } from "./sinema.mjs";

const schema = JSON.parse(readFileSync(new URL("./schema/episode.schema.json", import.meta.url), "utf8"));
const ajv = new Ajv({ allErrors: true });
const checkSchema = ajv.compile(schema);

const NARRATOR = "anlatici";

function list(names) {
  return [...names].sort().join(", ");
}

/**
 * A pose that bends a joint beyond what the rig declares (character.json "limits") would
 * look broken, so it is an error, not a warning.
 */
function anatomyErrors(action, member, rigId, lib, where) {
  const limits = lib.characters.get(rigId)?.meta?.limits;
  if (!action || !limits) return [];
  const errors = [];
  for (const key of action.keys) {
    for (const [ch, v] of Object.entries(key.pose)) {
      const range = limits[ch];
      if (range && (v < range[0] || v > range[1])) {
        errors.push(`${where}: "${member.action}" bends ${ch} to ${v}° at t=${key.t} but rig ${rigId} allows ${range[0]}..${range[1]}° (it would look broken)`);
      }
    }
  }
  return errors;
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
  const shotPropIds = (shot.props || []).map((p) => p.id);
  if (cam.target && !castIds.includes(cam.target) && !shotPropIds.includes(cam.target)) {
    errors.push(`${where}: camera target "${cam.target}" is not in this shot's cast or props`);
  }
  for (const m of shot.cast) {
    const action = lib.actions.get(m.action);
    errors.push(...anatomyErrors(action, m, ctx.rigOf(m.id), lib, where));
    if (action && m.from !== undefined && m.from >= action.duration) {
      errors.push(`${where}: "${m.id}" starts "${m.action}" at ${m.from}s but it lasts ${action.duration}s`);
    }
  }

  const propIds = new Set();
  for (const pr of shot.props || []) {
    if (propIds.has(pr.id)) errors.push(`${where}: prop id "${pr.id}" is used twice`);
    propIds.add(pr.id);
    if (!lib.props.has(pr.prop)) errors.push(`${where}: prop "${pr.prop}" is not in the library (${list(lib.props.keys())})`);
    if (pr.holder && !castIds.includes(pr.holder)) errors.push(`${where}: prop holder "${pr.holder}" is not in this shot's cast`);
    if (pr.hand && !pr.holder) errors.push(`${where}: prop "${pr.id}" has a hand but no holder`);
    if (!pr.mark && !pr.depth) errors.push(`${where}: prop "${pr.id}" needs a mark or a depth placement`);
    if (pr.depth && pr.holder) errors.push(`${where}: prop "${pr.id}" lies in the background (depth) and cannot be held in the same shot`);
  }

  for (const u of shot.utterances || []) {
    if (u.speaker !== NARRATOR && !castIds.includes(u.speaker)) {
      errors.push(`${where}: speaker "${u.speaker}" must be "${NARRATOR}" or in this shot's cast`);
    }
  }
  return errors;
}

const COUNT_WORDS_TR = /\b(dört|beş|altı|yedi|sekiz|dokuz|on)\b/i;

/**
 * Profile rules a human should look at; they never block the pipeline.
 * @param {object} episode
 * @param {object} rules profile.rules
 * @returns {string[]}
 */
export function ruleWarnings(episode, rules) {
  const warnings = [];
  for (const scene of episode.scenes) {
    for (const shot of scene.shots) {
      const where = `shot ${shot.shot_id}`;
      if (rules.max_cast && shot.cast.length > rules.max_cast) warnings.push(`${where}: ${shot.cast.length} characters (profile allows ${rules.max_cast})`);
      if (rules.allowed_moves && shot.camera.move && !rules.allowed_moves.includes(shot.camera.move)) {
        warnings.push(`${where}: camera move "${shot.camera.move}" is not recommended by the profile (${rules.allowed_moves.join(", ")})`);
      }
      if (rules.min_hold !== undefined && shot.hold !== undefined && shot.hold < rules.min_hold) {
        warnings.push(`${where}: hold ${shot.hold}s is shorter than ${rules.min_hold}s (time to imitate)`);
      }
      for (const u of shot.utterances || []) {
        for (const sentence of u.text.split(/[.!?]+/)) {
          const n = sentence.trim().split(/\s+/).filter(Boolean).length;
          if (rules.max_words_per_sentence && n > rules.max_words_per_sentence) {
            warnings.push(`${where}: "${sentence.trim()}" has ${n} words (profile: at most ${rules.max_words_per_sentence})`);
          }
        }
        if (rules.max_count && (/\d/.test(u.text) || (episode.language === "tr" && COUNT_WORDS_TR.test(u.text)))) {
          warnings.push(`${where}: counting beyond ${rules.max_count} or digits in "${u.text}" (write numbers as words, up to ${rules.max_count})`);
        }
      }
    }
  }
  return warnings;
}

/**
 * Validate an episode against the schema and the library.
 * @param {unknown} episode parsed episode JSON
 * @param {ReturnType<import("./library.mjs").loadLibrary>} lib
 * @returns {{ok: boolean, errors: string[], warnings: string[]}}
 */
export function validateEpisode(episode, lib) {
  if (!checkSchema(episode)) {
    const errors = checkSchema.errors.map((e) => `schema ${e.instancePath || "/"}: ${e.message}`);
    return { ok: false, errors, warnings: [] };
  }
  const errors = [];
  const profileId = episode.profile || "genel";
  const profile = lib.profiles.get(profileId);
  if (!profile) errors.push(`profile "${profileId}" is not in the library (${list(lib.profiles.keys())})`);
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
      const rigOf = (id) => episode.characters.find((c) => c.id === id)?.rig;
      errors.push(...checkShot(shot, `shot ${shot.shot_id}`, { lib, characterIds, rigOf }));
    }
  }
  const warnings = profile ? ruleWarnings(episode, profile.rules || {}) : [];
  if (errors.length === 0) warnings.push(...filmWarnings(episode, lib));
  return { ok: errors.length === 0, errors, warnings };
}

/**
 * The profile an episode uses (default "genel").
 * @param {object} episode
 * @param {ReturnType<import("./library.mjs").loadLibrary>} lib
 * @returns {object}
 */
export function profileOf(episode, lib) {
  return lib.profiles.get(episode.profile || "genel");
}

export { NARRATOR };
