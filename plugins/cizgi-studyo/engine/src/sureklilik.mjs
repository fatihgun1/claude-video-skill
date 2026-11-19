/**
 * Continuity checks a script supervisor would make (Hurda Kralı 1 shipped with each of these).
 * They warn; a person decides at the gates.
 *   - the light: the same place goes on in the next scene, but only one of the two has a light
 *     (isik), so the cut dips to black and the colour jumps
 *   - the voices: two people (or a person and the narrator) speak with the very same voice
 *   - a jump in place: someone ends a shot in one spot and starts the next shot of the same
 *     scene far from it (a dog that had run to the bottle stood back where it started)
 *   - new_assets: a drawing listed as missing that the library has by now
 */

import { lineWarnings } from "./repliklar.mjs";

const NARRATOR = "anlatici";
const VIEW_SUFFIX = /-(on|arka)$/; // the front and back views of a person (ses.mjs speaks them with its voice)
const JUMP_MIN = 300; // world units: a smaller move between two shots reads as the same spot

const keyOf = (v) => JSON.stringify([v?.hazir || "", v?.perde || 0, v?.hiz || 0]);

/**
 * The person behind a character id: the rig its views name with same_as (sinema.mjs reads it the same
 * way), else the rig without a -on / -arka suffix. The narrator is a person of its own.
 */
function personOf(episode, lib) {
  const rigs = new Map(episode.characters.map((c) => [c.id, c.rig]));
  return (id) => {
    if (id === NARRATOR) return NARRATOR;
    const rig = rigs.get(id) || id;
    return lib.characters?.get(rig)?.meta?.same_as || rig.replace(VIEW_SUFFIX, "");
  };
}

/**
 * The voice each speaking person is heard with (a view without a voice speaks with its person's),
 * and the views of one person that carry different voices.
 */
function voicesByPerson(episode, lib) {
  const person = personOf(episode, lib);
  const spoken = new Set(episode.scenes.flatMap((s) => s.shots.flatMap((sh) => (sh.utterances || []).map((u) => u.speaker))));
  const voiced = new Map(); // person → [{id, key}] of the views that carry a voice
  for (const c of episode.characters) if (c.voice) voiced.set(person(c.id), [...(voiced.get(person(c.id)) || []), { id: c.id, key: keyOf(c.voice) }]);
  const heard = new Map(); // person → key
  for (const id of spoken) {
    const who = person(id);
    if (heard.has(who)) continue;
    heard.set(who, who === NARRATOR ? keyOf(episode.narrator_voice) : (voiced.get(who)?.[0]?.key ?? keyOf(undefined)));
  }
  const split = [...voiced.entries()].filter(([who, list]) => heard.has(who) && new Set(list.map((v) => v.key)).size > 1);
  return { heard, split };
}

/** Two different people heard with one voice; one person heard with two. */
function sameVoiceWarnings(episode, lib) {
  const { heard, split } = voicesByPerson(episode, lib);
  const byKey = new Map();
  for (const [who, key] of heard) byKey.set(key, [...(byKey.get(key) || []), who]);
  const none = keyOf(undefined);
  return [
    // no voice chosen: it speaks with whatever voice the library lists first (Köşe Başı: Kerem and Selin)
    ...[...heard].filter(([, key]) => key === none).map(([who]) =>
      `voices: "${who}" has no voice of its own and would speak with the library's first voice; choose one (characters[].voice or narrator_voice; in a series, the one in seri.json)`),
    ...[...byKey.entries()].filter(([key, group]) => key !== none && group.length > 1).map(([, group]) =>
      `voices: ${group.map((w) => `"${w}"`).join(" and ")} speak with the same voice; the viewer cannot tell who talks (give each its own ready voice, or a perde of its own)`),
    ...split.map(([who, list]) =>
      `voices: views of one person speak with different voices: ${list.map((v) => `"${v.id}"`).join(", ")} (${who}); set the voice once on the person and remove it from the views`),
  ];
}

/** The same place in the next scene with a light on one side only: a dip to black and a colour jump. */
function lightWarnings(episode) {
  const out = [];
  episode.scenes.forEach((scene, i) => {
    const prev = episode.scenes[i - 1];
    if (!prev || scene.gecis || prev.bg !== scene.bg) return;
    const a = prev.isik?.saat || "";
    const b = scene.isik?.saat || "";
    if (a !== b && (!a || !b)) {
      out.push(`scene ${scene.scene_id}: same place as ${prev.scene_id}, but only ${a ? prev.scene_id : scene.scene_id} has a light (isik); the cut dips to black and the colour jumps. Give both the same isik, or set gecis`);
    }
  });
  return out;
}

/** Where a cast member stands at the start and at the end of a shot (world x, ignoring depth). */
function placeOf(member, marks) {
  const start = (marks[member.mark] ?? marks.orta ?? 960) + (member.dx || 0);
  return { start, end: start + (member.walk?.dx || 0) };
}

/** Someone who ends one shot in one spot and starts the next shot of the scene far from it. */
function jumpWarnings(episode, lib) {
  const marks = lib.world?.marks || {};
  const out = [];
  for (const scene of episode.scenes) {
    scene.shots.forEach((shot, i) => {
      const prev = scene.shots[i - 1];
      if (!prev || shot.zaman_atlama) return; // after a jump in time, nothing carries over the cut
      for (const m of shot.cast) {
        const before = prev.cast.find((p) => p.id === m.id);
        if (!before) continue;
        const was = placeOf(before, marks).end;
        const now = placeOf(m, marks).start;
        if (Math.abs(now - was) >= JUMP_MIN) {
          out.push(`film: shot ${shot.shot_id}: "${m.id}" ended ${prev.shot_id} at x ${Math.round(was)} but starts here at x ${Math.round(now)} (jumps across the place at the cut); start them where they stopped (mark/dx)`);
        }
      }
    });
  }
  return out;
}

/** Whether any action of a cast member has this field (grab: picks up, release: puts away). */
const doesIt = (member, lib, field) => [member?.action, ...(member?.actions || []).map((a) => a.action)].some((a) => lib.actions?.get(a)?.[field]);

/**
 * A prop that changes hands or floor at a cut with nobody doing it on screen: from the floor into a
 * hand (no pick-up), from a hand onto the floor (no setting down), or out of a hand and gone (not put
 * away). Within one scene, by prop id.
 */
function propWarnings(episode, lib) {
  // the person behind a character: its front and back views are the same person
  const rigOf = new Map(episode.characters.map((c) => [c.id, c.rig]));
  const person = (id) => (rigOf.get(id) || id).replace(VIEW_SUFFIX, "");
  const out = [];
  for (const scene of episode.scenes) {
    scene.shots.forEach((shot, i) => {
      const prev = scene.shots[i - 1];
      if (!prev || shot.zaman_atlama) return; // after a jump in time, nothing carries over the cut
      const memberOf = (s, id) => s.cast.find((m) => m.id === id);
      for (const before of prev.props || []) {
        const now = (shot.props || []).find((p) => p.id === before.id);
        const where = `film: shot ${shot.shot_id}: "${before.id}"`;
        // gone: only when its holder is still in the shot (a shot of someone else simply leaves it out)
        const holderStays = before.holder && shot.cast.some((m) => person(m.id) === person(before.holder));
        if (holderStays && !now) {
          if (!doesIt(memberOf(prev, before.holder), lib, "release")) out.push(`${where} was in "${before.holder}"'s hand in ${prev.shot_id} but is gone here; show it put away (an action with release) or keep it in the shot`);
        } else if (now && !before.holder && now.holder) {
          if (!doesIt(memberOf(shot, now.holder), lib, "grab")) out.push(`${where} lay on the ground in ${prev.shot_id} but is in "${now.holder}"'s hand here; let them pick it up on screen (an action with grab)`);
        } else if (now && before.holder && !now.holder) {
          out.push(`${where} was in "${before.holder}"'s hand in ${prev.shot_id} but lies on the ground here; show it set down, or keep it in the hand`);
        }
      }
    });
  }
  return out;
}

/** Drawings still listed as missing that the library has by now. */
function staleAssetWarnings(episode, lib) {
  const has = (name) => [lib.characters, lib.props, lib.backgrounds].some((m) => m?.has?.(name));
  return (episode.new_assets || []).filter((a) => has(a.name)).map((a) =>
    `new_assets: "${a.name}" is in the library now; take it off the list`);
}

const SIZE = { detay: 0, close: 1, gogus: 2, medium: 3, wide: 4 }; // framing sizes, close to wide
const REACH = 300; // world units: farther from the hand that grabs it than this, a prop is out of reach

/**
 * The prop ledger, by library prop (renaming a copy does not hide it): a thing in a hand that was
 * nowhere in the shot before, more of a thing at a cut that is not wider, and a thing out of reach of
 * the hand that picks it up (Hurda Kralı 2: the note suddenly in Necmi's hand, one bottle become six,
 * a copy parked off frame to be "picked up").
 */
function ledgerWarnings(episode, lib) {
  const marks = lib.world?.marks || {};
  const grabs = (m) => [m?.action, ...(m?.actions || []).map((a) => a.action)].some((a) => lib.actions?.get(a)?.grab);
  const countOf = (shot) => {
    const n = new Map();
    for (const p of shot.props || []) n.set(p.prop, (n.get(p.prop) || 0) + 1);
    return n;
  };
  const out = [];
  for (const scene of episode.scenes) {
    scene.shots.forEach((shot, i) => {
      // out of reach: where the prop lies against where its holder stands when grabbing it
      for (const p of shot.props || []) {
        const holder = p.holder && shot.cast.find((m) => m.id === p.holder);
        if (!holder || !grabs(holder) || p.depth || p.gizli || !p.mark) continue;
        const at = (marks[p.mark] ?? 960) + (p.dx || 0);
        const stand = placeOf(holder, marks).end;
        if (Math.abs(at - stand) > REACH) out.push(`film: shot ${shot.shot_id}: "${p.id}" lies ${Math.round(Math.abs(at - stand))} from "${p.holder}", out of reach of the hand that picks it up; put it where the hand closes, or hand it over (props[].to)`);
      }
      const prev = scene.shots[i - 1];
      if (!prev || shot.zaman_atlama) return;
      // only when this shot is not wider than the one before: a wider one may show what was off frame
      if ((SIZE[shot.camera?.framing] ?? 4) > (SIZE[prev.camera?.framing] ?? 4)) return;
      const before = countOf(prev);
      const now = countOf(shot);
      for (const p of shot.props || []) {
        if (!p.holder || before.has(p.prop) || grabs(shot.cast.find((m) => m.id === p.holder))) continue;
        if (prev.cast.some((m) => m.id === p.holder || placeOf(m, marks) && personKey(episode, lib, m.id) === personKey(episode, lib, p.holder))) {
          out.push(`film: shot ${shot.shot_id}: "${p.id}" (${p.prop}) is in "${p.holder}"'s hand, but was nowhere in ${prev.shot_id}; show where it comes from (an action with grab, or hand it over)`);
        }
      }
      for (const [prop, n] of now) {
        const was = before.get(prop) || 0;
        const takes = (shot.props || []).some((p) => p.prop === prop && p.holder && grabs(shot.cast.find((m) => m.id === p.holder)));
        if (was > 0 && n > was && !takes) out.push(`film: shot ${shot.shot_id}: ${prop}: ${was} on screen in ${prev.shot_id}, ${n} here; things do not multiply at a cut (show them added, or mark zaman_atlama)`);
      }
    });
  }
  return out;
}

/** The person behind a character id (its views share it). */
function personKey(episode, lib, id) {
  const rig = episode.characters.find((c) => c.id === id)?.rig || id;
  return lib.characters?.get(rig)?.meta?.same_as || String(rig).replace(VIEW_SUFFIX, "");
}

/**
 * @param {object} episode validated episode
 * @param {{world?:{marks?:Record<string, number>}, characters?:Map, props?:Map, backgrounds?:Map}} lib
 * @returns {string[]}
 */
export function continuityWarnings(episode, lib) {
  return [...lightWarnings(episode), ...sameVoiceWarnings(episode, lib), ...jumpWarnings(episode, lib), ...propWarnings(episode, lib), ...ledgerWarnings(episode, lib), ...lineWarnings(episode, lib), ...staleAssetWarnings(episode, lib)];
}
