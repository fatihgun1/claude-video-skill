/**
 * Episode validation: JSON schema + references into the library.
 * An episode may only name things that exist; anything new goes to `new_assets`
 * and needs a human decision before it can be used.
 */
import { readFileSync } from "node:fs";
import { voicesOf, edgeSettings, SLOWEST_RATE } from "./ses-ayar.mjs";
import { placeWarnings } from "./mekan-denetim.mjs";
import { poseWarnings } from "./poz-denetim.mjs";
import Ajv from "ajv";
import { has } from "./util.mjs";
import { filmWarnings } from "./sinema.mjs";
import { continuityWarnings } from "./sureklilik.mjs";
import { slidingDetails, parseGroups } from "./rigspec.mjs";
import "./runtime/core.js"; // CizgiCore.segmentsOf: the same reading of cast actions as the player
import "./runtime/yuz.js"; // CizgiYuz: which parts each facial expression needs

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
function anatomyErrors(action, actionId, rigId, lib, where) {
  const limits = lib.characters.get(rigId)?.meta?.limits;
  if (!action || !limits) return [];
  const errors = [];
  for (const key of action.keys) {
    for (const [ch, v] of Object.entries(key.pose)) {
      const range = limits[ch];
      if (range && (v < range[0] || v > range[1])) {
        errors.push(`${where}: "${actionId}" bends ${ch} to ${v}° at t=${key.t} but rig ${rigId} allows ${range[0]}..${range[1]}° (it would look broken)`);
      }
    }
  }
  return errors;
}

/** Every action a member plays in the shot, in order (its `action`, then `actions`). */
const segmentsOf = (member) => globalThis.CizgiCore.segmentsOf(member);

/** Where a walk should stop: when the first non-looping action after a walking start begins. */
const TIME_EPS = 0.05;
function walkStopWarning(m, lib, where) {
  if (!m.walk || !m.actions) return null;
  const segs = segmentsOf(m);
  if (!lib.actions.get(segs[0].action)?.loop) return null; // not a walk cycle at the start
  const stop = segs.find((s, i) => i > 0 && !lib.actions.get(s.action)?.loop);
  if (!stop) return null;
  if (m.walk.time === undefined) {
    return `${where}: "${m.id}" stops walking at ${stop.at}s but walks the whole shot (the feet will slide); set walk.time to ${stop.at}`;
  }
  if (Math.abs(m.walk.time - stop.at) > TIME_EPS) {
    return `${where}: "${m.id}" stops walking at ${stop.at}s but walk.time is ${m.walk.time}s (the feet will slide); set walk.time to ${stop.at}`;
  }
  return null;
}

function checkShot(shot, where, ctx) {
  const errors = [];
  const { lib, characterIds } = ctx;
  const castIds = shot.cast.map((c) => c.id);

  for (const member of shot.cast) {
    if (!characterIds.has(member.id)) errors.push(`${where}: cast "${member.id}" is not in characters`);
    for (const s of segmentsOf(member)) {
      if (!lib.actions.has(s.action)) {
        errors.push(`${where}: action "${s.action}" is not in the library (${list(lib.actions.keys())})`);
      }
    }
    const ats = (member.actions || []).map((a) => a.at);
    if (ats.some((at, i) => i > 0 && at <= ats[i - 1])) {
      errors.push(`${where}: the actions of "${member.id}" must come in time order (at ${ats.join(", ")})`);
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
    for (const s of segmentsOf(m)) {
      const action = lib.actions.get(s.action);
      errors.push(...anatomyErrors(action, s.action, ctx.rigOf(m.id), lib, where));
      if (action && s.from > 0 && s.from >= action.duration) {
        errors.push(`${where}: "${m.id}" starts "${s.action}" at ${s.from}s but it lasts ${action.duration}s`);
      }
    }
  }

  const propIds = new Set();
  for (const pr of shot.props || []) {
    if (propIds.has(pr.id)) errors.push(`${where}: prop id "${pr.id}" is used twice`);
    propIds.add(pr.id);
    if (!lib.props.has(pr.prop)) errors.push(`${where}: prop "${pr.prop}" is not in the library (${list(lib.props.keys())})`);
    if (pr.holder && !castIds.includes(pr.holder)) errors.push(`${where}: prop holder "${pr.holder}" is not in this shot's cast`);
    if (pr.holder && lib.props.has(pr.prop) && !lib.props.get(pr.prop).grip) {
      errors.push(`${where}: prop "${pr.prop}" cannot be held (no data-grip in its drawing)`);
    }
    if (pr.hand && !pr.holder) errors.push(`${where}: prop "${pr.id}" has a hand but no holder`);
    if (pr.to && !castIds.includes(pr.to)) errors.push(`${where}: prop "${pr.id}" is handed to "${pr.to}", who is not in this shot's cast`);
    if (pr.to && (!pr.holder || pr.to === pr.holder)) errors.push(`${where}: prop "${pr.id}" is handed over (to) but has no other holder to give it`);
    if ((pr.to_hand && !pr.to) || ((pr.sonra || pr.gizli) && !pr.holder)) errors.push(`${where}: prop "${pr.id}": to_hand needs to; sonra and gizli need a holder`);
    if (!pr.mark && !pr.depth) errors.push(`${where}: prop "${pr.id}" needs a mark or a depth placement`);
    if (pr.depth && pr.holder) errors.push(`${where}: prop "${pr.id}" lies in the background (depth) and cannot be held in the same shot`);
  }

  for (const s of shot.sfx || []) {
    if (!lib.sfx?.has(s.sfx)) errors.push(`${where}: sound effect "${s.sfx}" is not in the library (${list((lib.sfx || new Map()).keys())})`);
    // tied to exactly one thing: a time, a line, or someone (efekt.mjs)
    const ties = ["at", "replik", "oyuncu"].filter((k) => s[k] != null);
    if (ties.length !== 1) errors.push(`${where}: sound effect "${s.sfx}" needs exactly one of at (seconds), replik (a line) or oyuncu (someone)${ties.length ? ` (has ${ties.join(", ")})` : ""}`);
    if (s.replik != null && !(shot.utterances || [])[s.replik]) errors.push(`${where}: sound effect "${s.sfx}" is tied to line ${s.replik}, but the shot has ${(shot.utterances || []).length} line(s)`);
    if (s.kelime != null && s.replik == null) errors.push(`${where}: sound effect "${s.sfx}": kelime needs replik`);
    if (s.replik != null && s.kelime != null && (shot.utterances || [])[s.replik] && s.kelime >= shot.utterances[s.replik].text.split(/s+/).filter(Boolean).length) {
      errors.push(`${where}: sound effect "${s.sfx}" is tied to word ${s.kelime} of line ${s.replik}, which has fewer words`);
    }
    if ((s.an || s.adim) && s.oyuncu == null) errors.push(`${where}: sound effect "${s.sfx}": an and adim need oyuncu`);
    if (s.an && s.adim) errors.push(`${where}: sound effect "${s.sfx}": an or adim, not both`);
    if (s.oyuncu != null) {
      const m = shot.cast.find((c) => c.id === s.oyuncu);
      if (!m) errors.push(`${where}: sound effect "${s.sfx}" is tied to "${s.oyuncu}", who is not in this shot's cast`);
      else if (s.adim && !m.walk) errors.push(`${where}: sound effect "${s.sfx}" steps with "${s.oyuncu}", who does not walk in this shot (cast.walk)`);
      else if (s.an && s.an !== "baslangic" && ![m.action, ...(m.actions || []).map((x) => x.action)].some((id) => lib.actions.get(id)?.[s.an]?.t != null)) {
        errors.push(`${where}: sound effect "${s.sfx}" is tied to "${s.oyuncu}"'s ${s.an}, but none of their actions has one`);
      }
    }
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
 * An action drawn for one view (a profile walk, a front wave) reads wrong on a rig seen
 * from another side. Actions without "views" are treated as fitting every view.
 * @param {object} episode
 * @param {ReturnType<import("./library.mjs").loadLibrary>} lib
 * @returns {string[]}
 */
export function viewWarnings(episode, lib) {
  const warnings = [];
  // details drawn on a bending limb slide when it bends (a patch on a knee): the drawing needs a fix
  for (const rig of new Set(episode.characters.map((c) => c.rig))) {
    const svg = lib.characters.get(rig)?.svg;
    for (const msg of svg ? slidingDetails(svg) : []) warnings.push(`character ${rig}: ${msg}`);
  }
  const rigOf = (id) => episode.characters.find((c) => c.id === id)?.rig;
  for (const scene of episode.scenes) {
    for (const shot of scene.shots) {
      for (const m of shot.cast) {
        const view = lib.characters.get(rigOf(m.id))?.meta.view || "front";
        for (const s of segmentsOf(m)) {
          const views = lib.actions.get(s.action)?.views;
          if (views && !views.includes(view)) {
            warnings.push(`shot ${shot.shot_id}: "${s.action}" is made for ${views.join("/")} views, but ${m.id} (${rigOf(m.id)}) is drawn ${view}`);
          }
        }
        const stop = walkStopWarning(m, lib, `shot ${shot.shot_id}`);
        if (stop) warnings.push(stop);
      }
    }
  }
  return warnings;
}

const FACE_NAMES = { gulumse: "smiling", kizgin: "angry", uzgun: "sad", sasirmis: "surprised", korkmus: "scared" };

/**
 * A face a shot asks for (cast[].ifade, or the duygu of a line the member speaks there) that the
 * drawing has no parts for: the player shows a neutral face, so it is a warning, once per drawing
 * and face. A back view shows no face and is skipped.
 * @param {object} episode
 * @param {ReturnType<import("./library.mjs").loadLibrary>} lib
 * @returns {string[]}
 */
export function expressionWarnings(episode, lib) {
  const Y = globalThis.CizgiYuz;
  const warned = new Map(); // "rig face" → message
  const rigOf = (id) => episode.characters.find((c) => c.id === id)?.rig;
  for (const scene of episode.scenes) {
    for (const shot of scene.shots) {
      for (const m of shot.cast) {
        const rig = rigOf(m.id);
        const ch = lib.characters.get(rig);
        if (!ch?.svg || String(ch.meta?.view || "").startsWith("back")) continue;
        const faces = !m.ifade ? (shot.utterances || []).filter((u) => u.speaker === m.id).map((u) => Y.DUYGU_IFADE[u.duygu])
          : typeof m.ifade === "string" ? [m.ifade] : m.ifade.map((f) => f.ifade);
        const groups = parseGroups(ch.svg);
        for (const face of new Set(faces.filter(Boolean))) {
          const missing = Y.missingFor(face, (id) => groups.has(id));
          if (!missing.length || warned.has(`${rig} ${face}`)) continue;
          warned.set(`${rig} ${face}`, `shot ${shot.shot_id}: this drawing (${rig}) has no ${FACE_NAMES[face] || face} face (no ${missing.join(", ")}); ${m.id} shows a neutral one there instead`);
        }
      }
    }
  }
  return [...warned.values()];
}

/**
 * Turkish written as UTF-8 and read back as Windows-1252 ("Köşe" → "KÃ¶ÅŸe"): a file written by a
 * tool that does not keep UTF-8 (PowerShell Set-Content). Köşe Başı's title came out so in the panel.
 * @returns {string[]} one error per text that looks garbled
 */
const GARBLED = /[ÃÄÅ][\u0080-¿ŒœŠšŸŽžƒˆ˜–-›€™]/;
function garbledText(episode) {
  const out = [];
  const walk = (v, path) => {
    if (typeof v === "string") {
      if (GARBLED.test(v)) out.push(`${path}: the text looks garbled ("${v.slice(0, 40)}"): the file was not written as UTF-8; write it again in UTF-8 (the Write tool or Node fs, never PowerShell Set-Content)`);
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}/${i}`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}/${k}`);
  };
  walk(episode, "");
  return out;
}

// voice settings of the old engine (Chatterbox): no longer read, dropped with a warning
const OLD_VOICE_FIELDS = ["ref", "exaggeration", "cfg"];
function withoutOldVoiceFields(episode) {
  const notes = [];
  const clean = (v, who) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return v;
    const old = OLD_VOICE_FIELDS.filter((k) => Object.hasOwn(v, k));
    if (!old.length) return v;
    notes.push(`${who}: voice ${old.join(", ")} no longer used (Edge TTS), ignored; remove it`);
    return Object.fromEntries(Object.entries(v).filter(([k]) => !old.includes(k)));
  };
  if (!episode || typeof episode !== "object" || !Array.isArray(episode.characters)) return { episode, notes };
  const next = { ...episode, characters: episode.characters.map((c) => (c && c.voice ? { ...c, voice: clean(c.voice, `character "${c.id}"`) } : c)) };
  if (episode.narrator_voice) next.narrator_voice = clean(episode.narrator_voice, "narrator");
  return { episode: next, notes };
}

/**
 * Validate an episode against the schema and the library.
 * @param {unknown} episode parsed episode JSON
 * @param {ReturnType<import("./library.mjs").loadLibrary>} lib
 * @returns {{ok: boolean, errors: string[], warnings: string[]}}
 */
export function validateEpisode(input, lib) {
  const { episode, notes } = withoutOldVoiceFields(input);
  if (!checkSchema(episode)) {
    const errors = checkSchema.errors.map((e) => `schema ${e.instancePath || "/"}: ${e.message}`);
    return { ok: false, errors, warnings: [] };
  }
  const errors = [...garbledText(episode)];
  const profileId = episode.profile || "genel";
  const profile = lib.profiles.get(profileId);
  if (!profile) errors.push(`profile "${profileId}" is not in the library (${list(lib.profiles.keys())})`);
  const characterIds = new Set();
  for (const c of episode.characters) {
    if (characterIds.has(c.id)) errors.push(`character id "${c.id}" is used twice`);
    characterIds.add(c.id);
    if (c.voice?.hazir && !lib.voices?.has(c.voice.hazir)) {
      errors.push(`character "${c.id}": ready voice "${c.voice.hazir}" is not in the library (${list((lib.voices || new Map()).keys())})`);
    }
    const rig = lib.characters.get(c.rig);
    if (!rig) {
      errors.push(`character "${c.id}": rig "${c.rig}" is not in the library (${list(lib.characters.keys())})`);
      continue;
    }
    const allowed = rig.meta.palette_vars || [];
    // costume variants picked by the shots must be the drawing's own
    const variants = Object.keys(rig.meta.varyantlar || {});
    for (const scene of episode.scenes) {
      for (const shot of scene.shots) {
        for (const m of shot.cast) {
          if (m.id !== c.id || m.varyant === undefined || variants.includes(m.varyant)) continue;
          errors.push(`shot ${shot.shot_id}: "${c.id}" has no costume variant "${m.varyant}" (rig ${c.rig}: ${variants.length ? list(variants) : "none"})`);
        }
      }
    }
    for (const key of Object.keys(c.palette || {})) {
      if (!allowed.includes(key)) {
        errors.push(`character "${c.id}": palette "${key}" is not a colour of rig ${c.rig} (${list(allowed)})`);
      }
    }
  }
  if (characterIds.has(NARRATOR)) errors.push(`"${NARRATOR}" is reserved for the narrator`);
  if (episode.music && !lib.music?.has(episode.music.track)) {
    errors.push(`music "${episode.music.track}" is not in the library (${list((lib.music || new Map()).keys()) || "library/muzik is empty"})`);
  }

  const shotIds = new Set();
  const sceneIds = new Set();
  for (const scene of episode.scenes) {
    if (sceneIds.has(scene.scene_id)) errors.push(`scene id "${scene.scene_id}" is used twice`);
    sceneIds.add(scene.scene_id);
    if (!lib.backgrounds.has(scene.bg)) {
      errors.push(`scene ${scene.scene_id}: background "${scene.bg}" is not in the library (${list(lib.backgrounds.keys())})`);
    } else if (scene.katmanlar) {
      // layer settings name layers of this scene's background (a one-file background has one: tum)
      const ids = (lib.layers?.get(scene.bg) || []).map((l) => l.id);
      for (const k of Object.keys(scene.katmanlar)) {
        if (!ids.includes(k)) errors.push(`scene ${scene.scene_id}: background "${scene.bg}" has no layer "${k}" (${ids.join(", ")})`);
      }
    }
    for (const shot of scene.shots || []) {
      if (shot.bg && !lib.backgrounds.has(shot.bg)) errors.push(`shot ${shot.shot_id}: background "${shot.bg}" is not in the library (${list(lib.backgrounds.keys())})`);
    }
    // decor: library props, one id each in the scene
    const decorIds = new Set();
    for (const d of scene.dekor || []) {
      if (decorIds.has(d.id)) errors.push(`scene ${scene.scene_id}: decor id "${d.id}" is used twice`);
      decorIds.add(d.id);
      if (!lib.props.has(d.prop)) errors.push(`scene ${scene.scene_id}: decor "${d.id}": prop "${d.prop}" is not in the library (${list(lib.props.keys())})`);
    }
    for (const shot of scene.shots) {
      if (shotIds.has(shot.shot_id)) errors.push(`shot id "${shot.shot_id}" is used twice`);
      shotIds.add(shot.shot_id);
      const rigOf = (id) => episode.characters.find((c) => c.id === id)?.rig;
      errors.push(...checkShot(shot, `shot ${shot.shot_id}`, { lib, characterIds, rigOf }));
    }
  }
  const warnings = [...notes, ...(profile ? ruleWarnings(episode, profile.rules || {}) : [])];
  if (errors.length === 0) warnings.push(...viewWarnings(episode, lib), ...expressionWarnings(episode, lib), ...filmWarnings(episode, lib), ...continuityWarnings(episode, lib), ...speedWarnings(episode, lib, profile), ...placeWarnings(episode, lib), ...poseWarnings(episode, lib));
  // a shot the person locked (shot.kilit): the film rules give way to their choice (Hurda Kralı 1:
  // an unbroken shot they asked for was cut on action); shown as their decision, it holds no gate
  const locks = new Map(episode.scenes.flatMap((s) => s.shots).filter((s) => s.kilit).map((s) => [s.shot_id, s.kilit.neden]));
  const lockedBy = (w) => {
    const id = /^film: shot ([A-Za-z0-9_-]+)\b/.exec(w)?.[1];
    return id && locks.has(id) ? locks.get(id) : null;
  };
  const decided = warnings.filter(lockedBy).map((w) => `${w} — kişinin kararı: ${lockedBy(w)}`);
  if (decided.length) return { ok: errors.length === 0, errors, warnings: warnings.filter((w) => !lockedBy(w)), kisi_kararlari: decided };
  return { ok: errors.length === 0, errors, warnings };
}

/**
 * The profile an episode uses (default "genel").
 * @param {object} episode
 * @param {ReturnType<import("./library.mjs").loadLibrary>} lib
 * @returns {object}
 */
/**
 * Lines whose final speed drags: the ready voice's speed, the character's own, the feeling and the
 * profile tempo add up (Faz 5.6: down to -45%). One warning per speaker and feeling.
 */
export function speedWarnings(episode, lib, profile) {
  const voices = { ...voicesOf(episode), [NARRATOR]: episode.narrator_voice || {} };
  const tempo = profile?.speech?.tempo ?? 1;
  const seen = new Map();
  for (const shot of episode.scenes.flatMap((sc) => sc.shots)) {
    for (const u of shot.utterances || []) {
      const key = `${u.speaker}|${u.duygu || ""}`;
      if (seen.has(key)) continue;
      const rate = parseInt(edgeSettings(voices[u.speaker], u.duygu, lib, tempo).rate, 10);
      seen.set(key, rate < SLOWEST_RATE ? `shot ${shot.shot_id}: "${u.speaker}"${u.duygu ? ` (${u.duygu})` : ""} speaks at ${rate}% speed (voice, character, feeling and profile tempo together); under ${SLOWEST_RATE}% a line drags: raise the character's hiz or pick a faster voice` : null);
    }
  }
  return [...seen.values()].filter(Boolean);
}

export function profileOf(episode, lib) {
  return lib.profiles.get(episode.profile || "genel");
}

export { NARRATOR };
