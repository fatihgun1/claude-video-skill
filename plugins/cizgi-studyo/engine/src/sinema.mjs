/**
 * Film-grammar checks (skill: cizgi-sinema). They warn; a person decides at the gates.
 *   - establishing first: the opening shot is not a close-up or an insert
 *   - motivated insert: a shot aimed at a prop follows a shot with a character in it
 *   - 30° rule: consecutive shots of the same subject change framing or view
 *   - 180° / screen direction: a person does not flip direction between consecutive shots
 *     unless a neutral (front/back) view sits between
 */

const CLOSE_FRAMINGS = new Set(["close", "detay"]);
const NEUTRAL_VIEWS = new Set(["front", "back"]);

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
  return warnings;
}
