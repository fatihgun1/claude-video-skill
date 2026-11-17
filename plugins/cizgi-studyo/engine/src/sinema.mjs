/**
 * Film-grammar checks (skill: cizgi-sinema). They warn; a person decides at the gates.
 *   - establishing first: the opening shot is not a close-up or an insert
 *   - motivated insert: a shot aimed at a prop follows a shot with a character in it
 *   - 30° rule: consecutive shots of the same subject change framing or view
 *   - 180° / screen direction: a person does not flip direction between consecutive shots
 *     unless a neutral (front/back) view sits between
 *   - composition: a scene not seen only from the side; a conversation with an over-the-shoulder shot
 *   - a street running into depth is walked along, not crossed sideways
 *   - a crowd moves; a back-and-forth of lines is cut as shot / reverse shot
 */

const CLOSE_FRAMINGS = new Set(["close", "detay"]);
const NEUTRAL_VIEWS = new Set(["front", "back"]);
const SIDE_ONLY_SHOTS = 3; // a scene of this many shots or more, all from the side, reads flat
const EXCHANGE_LINES = 2; // lines by two people in one static shot: a talking tableau
const CROWD = /kalabalik/; // library props that are a crowd of people

/** Whether a background is drawn in perspective (a street running into depth: data-vp). */
const deep = (lib, bg) => /<svg\b[^>]*\bdata-vp=/.test(lib.backgrounds?.get(bg) || "");

/** The person behind a character entry: rigs that are views of the same person share it. */
function identityOf(character, lib) {
  const meta = lib.characters.get(character.rig)?.meta || {};
  return meta.same_as || character.rig;
}

/** "right", "left" or null (neutral view) for a cast member. */
function directionOf(member, character, lib) {
  const view = lib.characters.get(character.rig)?.meta?.view || "front";
  if (NEUTRAL_VIEWS.has(view)) return null;
  const drawn = view.endsWith("-left") ? "left" : "right";
  if (member.facing !== "sol") return drawn;
  return drawn === "right" ? "left" : "right";
}

/**
 * @param {object} episode validated episode
 * @param {ReturnType<import("./library.mjs").loadLibrary>} lib
 * @returns {string[]} warnings prefixed with "film:"
 */
export function filmWarnings(episode, lib) {
  const chars = Object.fromEntries(episode.characters.map((c) => [c.id, c]));
  const shots = episode.scenes.flatMap((s) => s.shots);
  const sceneOf = new Map(episode.scenes.flatMap((s) => s.shots.map((sh) => [sh.shot_id, s.scene_id])));
  const warnings = [];
  const isPropShot = (shot) => (shot.props || []).some((p) => p.id === shot.camera.target);
  const subjectOf = (shot) => {
    if (isPropShot(shot)) return `prop:${shot.camera.target}`;
    const id = shot.camera.target || (shot.cast.length === 1 ? shot.cast[0].id : null);
    return id && chars[id] ? identityOf(chars[id], lib) : null;
  };
  const viewOf = (shot) => {
    const id = shot.camera.target || shot.cast[0]?.id;
    return chars[id]?.rig || null;
  };

  shots.forEach((shot, i) => {
    const where = `film: shot ${shot.shot_id}`;
    for (const m of shot.cast) {
      const view = lib.characters.get(chars[m.id]?.rig)?.meta?.view || "front";
      if (m.walk && !view.startsWith("profile")) {
        warnings.push(`${where}: "${m.id}" is seen ${view} but walks sideways (looks like side-stepping); walk sideways only in a profile view, or keep them in place and use a dolly move to walk into depth`);
      }
    }
    if (i === 0 && (CLOSE_FRAMINGS.has(shot.camera.framing) || isPropShot(shot))) {
      warnings.push(`${where}: opens on a ${isPropShot(shot) ? "prop" : shot.camera.framing} shot; establish place and character first (wide or tracking)`);
    }
    if (i > 0 && isPropShot(shot) && shots[i - 1].cast.length === 0) {
      warnings.push(`${where}: insert on "${shot.camera.target}" is not motivated; show a character looking at or reaching for it first`);
    }
    if (i === 0) return;
    const prev = shots[i - 1];
    // a cut to another scene (another place or time) is neither a jump cut nor a flip of direction
    if (sceneOf.get(prev.shot_id) !== sceneOf.get(shot.shot_id)) return;
    const subject = subjectOf(shot);
    if (subject && subject === subjectOf(prev) && shot.camera.framing === prev.camera.framing && viewOf(shot) === viewOf(prev)) {
      warnings.push(`${where}: same subject, framing and view as ${prev.shot_id} (jump cut); change the framing size or the view`);
    }
    for (const member of shot.cast) {
      const me = chars[member.id];
      const before = prev.cast.find((m) => chars[m.id] && identityOf(chars[m.id], lib) === identityOf(me, lib));
      if (!before) continue;
      const d0 = directionOf(before, chars[before.id], lib);
      const d1 = directionOf(member, me, lib);
      if (d0 && d1 && d0 !== d1) {
        warnings.push(`${where}: "${member.id}" faces ${d1} but faced ${d0} in ${prev.shot_id} (screen direction flips; put a front or back view between, or keep the direction)`);
      }
    }
  });
  warnings.push(...compositionWarnings(episode, lib, chars));
  return warnings;
}

/**
 * Scene-wide composition (told on the scene's first shot): a scene seen only from the side, and a
 * conversation without an over-the-shoulder shot. Both made Test 11's film look flat.
 */
function compositionWarnings(episode, lib, chars) {
  const out = [];
  const viewOf = (m) => lib.characters.get(chars[m.id]?.rig)?.meta?.view || "front";
  for (const scene of episode.scenes) {
    const where = `film: shot ${scene.shots[0].shot_id}`;
    // Köşe Başı: people crossed a deep street sideways, past a crowd that stood frozen in a row
    if (deep(lib, scene.bg)) {
      for (const shot of scene.shots) {
        const across = shot.cast.filter((m) => m.walk && viewOf(m).startsWith("profile"));
        if (across.length) {
          out.push(`film: shot ${shot.shot_id}: ${across.map((m) => `"${m.id}"`).join(", ")} walks sideways across "${scene.bg}", a street that runs into depth (it looks like crossing the pavement, not walking down the street); walk along it in a front or back view with a dolly or follow move, or use a flat street`);
        }
      }
    }
    const still = (scene.dekor || []).filter((d) => CROWD.test(d.prop) && !(d.akis?.dx || d.akis?.back));
    if (still.length) {
      out.push(`${where}: the crowd ${still.map((d) => `"${d.id}"`).join(", ")} in scene ${scene.scene_id} stands frozen; give it akis (dekor[].akis: dx sideways, back + going away / - coming closer) so it walks by, or leave it out`);
    }
    for (const shot of scene.shots) {
      const said = new Set((shot.utterances || []).map((u) => chars[u.speaker] && identityOf(chars[u.speaker], lib)).filter(Boolean));
      if (said.size >= EXCHANGE_LINES && (shot.camera.move || "static") === "static") {
        out.push(`film: shot ${shot.shot_id}: ${said.size} people talk in one static shot; cut it into shot / reverse shot (each line on its speaker, or over the listener's shoulder)`);
      }
    }
    const peopled = scene.shots.filter((s) => s.cast.length);
    if (peopled.length >= SIDE_ONLY_SHOTS && peopled.every((s) => s.cast.every((m) => viewOf(m).startsWith("profile")))) {
      out.push(`${where}: every shot of scene ${scene.scene_id} shows people from the side (profile); add a front 3/4 close-up, an over-the-shoulder shot or a tracking shot from behind`);
    }
    const speakers = new Set(scene.shots.flatMap((s) => (s.utterances || []).map((u) => chars[u.speaker] && identityOf(chars[u.speaker], lib))).filter(Boolean));
    const overShoulder = scene.shots.some((s) => s.cast.some((m) => viewOf(m).startsWith("back")) && s.cast.some((m) => !viewOf(m).startsWith("back")));
    if (speakers.size >= 2 && !overShoulder) {
      out.push(`${where}: the conversation in scene ${scene.scene_id} has no over-the-shoulder shot; show the speaker over the listener's shoulder (the listener's back 3/4 in front, the speaker's front 3/4 behind)`);
    }
  }
  return out;
}
