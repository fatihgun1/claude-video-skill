/**
 * Lines against what is on screen (plan v3, Faz 2.4). A small Turkish reading, on purpose narrow so
 * it does not cry wolf:
 *   - a time of day the narrator says (sabah, öğle, akşam, gece) the scene's light contradicts; not after "her",
 *     "dün", "yarın", "geçen", "önceki" (a habit or another day)
 *   - a number said with a thing ("on şişe") while another number of that thing is on screen; only
 *     when at least one is on screen (with none it is talk, not a count)
 *   - "ver" said by someone already holding a prop from the start of the shot
 * Hurda Kralı 2 had each: "Ertesi sabah" over an evening light, "on şişe" with six on the scale,
 * "Ver bakalım" with the money in hand.
 */

const VIEW_SUFFIX = /-(on|arka)$/;
const NARRATOR = "anlatici";
const TIMES = [["sabah", "sabah"], ["ogle", "ogle"], ["aksam", "aksam"], ["gece", "gece"]];
const OTHER_DAY = new Set(["her", "dun", "yarin", "gecen", "onceki", "sonraki"]);
const UNITS = { bir: 1, iki: 2, uc: 3, dort: 4, bes: 5, alti: 6, yedi: 7, sekiz: 8, dokuz: 9 };
const TENS = { on: 10, yirmi: 20, otuz: 30, kirk: 40, elli: 50, altmis: 60, yetmis: 70, seksen: 80, doksan: 90 };

const fold = (s) => String(s).toLocaleLowerCase("tr").replace(/ş/g, "s").replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ü/g, "u").replace(/â/g, "a").replace(/î/g, "i").replace(/û/g, "u");
/** A line's words as written, and the same words folded for matching (one to one). */
const tokens = (text) => {
  const orig = text.match(/[\p{L}\p{N}]+/gu) || [];
  return { orig, ws: orig.map(fold) };
};

/** A number at words[i] ("on", "on iki", "6"): {value, next index} or null. */
function numberAt(ws, i) {
  if (/^\d+$/.test(ws[i])) return { value: Number(ws[i]), next: i + 1 };
  if (Object.hasOwn(TENS, ws[i])) {
    const unit = Object.hasOwn(UNITS, ws[i + 1] || "") ? UNITS[ws[i + 1]] : 0;
    return { value: TENS[ws[i]] + unit, next: i + (unit ? 2 : 1) };
  }
  if (Object.hasOwn(UNITS, ws[i])) return { value: UNITS[ws[i]], next: i + 1 };
  return null;
}

/** Whether a word names a library prop id ("sise" → "plastik-sise"); a suffix is allowed ("siseyi"). */
const names = (word, propId) => fold(propId).split(/[-_]/).some((part) => part.length >= 3 && (word === part || word.startsWith(part)));

/**
 * @param {object} episode
 * @param {{characters?: Map, actions?: Map}} lib
 * @returns {string[]}
 */
export function lineWarnings(episode, lib) {
  const rigs = new Map(episode.characters.map((c) => [c.id, c.rig]));
  const person = (id) => {
    const rig = rigs.get(id) || id;
    return lib.characters?.get(rig)?.meta?.same_as || String(rig).replace(VIEW_SUFFIX, "");
  };
  const grabs = (m) => [m?.action, ...(m?.actions || []).map((a) => a.action)].some((a) => lib.actions?.get(a)?.grab);
  const out = [];
  for (const scene of episode.scenes) {
    const light = scene.isik?.saat;
    for (const shot of scene.shots) {
      const where = `lines: shot ${shot.shot_id}`;
      const things = [...(scene.dekor || []).map((d) => d.prop), ...(shot.props || []).map((p) => p.prop)];
      for (const u of shot.utterances || []) {
        const { orig, ws } = tokens(u.text);
        // the time of day
        // only the narrator tells when we are; a character speaks of plans and other times (kpss-ajani)
        if (light && u.speaker === NARRATOR) {
          ws.forEach((w, i) => {
            const said = TIMES.find(([stem]) => w.startsWith(stem))?.[1];
            if (said && said !== light && !OTHER_DAY.has(ws[i - 1])) out.push(`${where}: "${orig[i]}" is said, but scene ${scene.scene_id}'s light is ${light}; change the line or the scene's isik`);
          });
        }
        // a count of things on screen
        for (let i = 0; i < ws.length; i++) {
          const n = numberAt(ws, i);
          if (!n || !ws[n.next]) continue;
          const noun = ws[n.next];
          // a number that is part of the thing's name ("yirmi-lira": one note) is not a count
          const counted = things.filter((p) => names(noun, p) && !fold(p).split(/[-_]/).includes(ws[i]));
          const shown = counted.length;
          if (shown && shown !== n.value) out.push(`${where}: "${orig.slice(i, n.next + 1).join(" ")}" is said, but ${shown} are on screen; make the line and the props agree`);
          i = n.next - 1;
        }
        // asking for what one holds
        if (ws.includes("ver") || ws.some((w) => /^ver(sene|in|ir misin)$/.test(w))) {
          const me = person(u.speaker);
          const member = shot.cast.find((m) => person(m.id) === me);
          const held = (shot.props || []).find((p) => p.holder && person(p.holder) === me && !grabs(shot.cast.find((m) => m.id === p.holder)));
          if (member && held) out.push(`${where}: "${u.speaker}" says "ver" but already holds "${held.id}" from the start of the shot; hand it over after the line, or change the line`);
        }
      }
    }
  }
  return out;
}
