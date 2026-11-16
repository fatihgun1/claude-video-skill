// Captions in the inspector: where and how big the selected shot's scene shows them
// (scene.altyazi, in the Sahne section), and two settings of the whole episode (Bölüm ayarları):
// captions off (episode.altyazi.kapali) and edging each caption with its speaker's colour
// (konusan_rengi, characters[].renk).
// A line's own on/off is in its details (and a click on its block in the Altyazı track).
import { el } from "./dom.js";
import { captionPlace, speakerColor } from "./altyazi.mjs";
import { labelled, segment, check } from "./denetleyici-alan.js";

const PLACES = [{ id: "alt", label: "Alt" }, { id: "ust", label: "Üst" }, { id: "orta", label: "Orta" }];
const SIZES = [{ id: "kucuk", label: "Küçük" }, { id: "orta", label: "Orta" }, { id: "buyuk", label: "Büyük" }];
const labelOf = (list, id) => list.find((o) => o.id === id)?.label || id;

/** Set one key of an optional settings object; drop the object when it is empty. */
function setIn(owner, key, field, value) {
  const next = { ...(owner[key] || {}) };
  if (value === undefined || value === false) delete next[field];
  else next[field] = value;
  if (Object.keys(next).length) owner[key] = next;
  else delete owner[key];
}

/**
 * Where and how big a scene shows its captions.
 * @param {object} scene the selected shot's scene (changed in place)
 * @param {string} format "16:9" | "9:16" (the defaults differ)
 * @param {() => void} changed
 * @returns {HTMLElement}
 */
export function sceneCaption(scene, format, changed) {
  const def = captionPlace({}, format);
  // "Varsayılan" follows the format, so it is a choice of its own; the hint says what it gives
  const place = segment(scene.altyazi?.konum, PLACES, (v) => { setIn(scene, "altyazi", "konum", v); changed(); },
    { empty: "Varsayılan", label: "Altyazının yeri" });
  const size = segment(scene.altyazi?.boyut, SIZES, (v) => { setIn(scene, "altyazi", "boyut", v); changed(); },
    { empty: "Varsayılan", label: "Altyazının boyutu" });
  return el("div", { class: "ifields" },
    labelled("Yer", place, `Varsayılan: ${format} için ${labelOf(PLACES, def.konum).toLocaleLowerCase("tr")}.`),
    labelled("Boyut", size, `Varsayılan: ${labelOf(SIZES, def.boyut).toLocaleLowerCase("tr")}.`));
}

/**
 * The whole episode's captions: off, or edged with the speaker's colour (one per character).
 * @param {object} episode the draft (changed in place)
 * @param {(id:string) => string} labelOfCharacter
 * @param {() => void} changed
 * @returns {HTMLElement}
 */
export function episodeCaption(episode, labelOfCharacter, changed) {
  const off = !!episode.altyazi?.kapali;
  const coloured = !!episode.altyazi?.konusan_rengi;
  const colours = coloured && !off
    ? el("div", { class: "colours" }, episode.characters.map((c) => {
      const pick = el("input", { type: "color", value: speakerColor(episode, c.id), "aria-label": `${labelOfCharacter(c.id)} rengi` });
      pick.addEventListener("change", () => { c.renk = pick.value; changed(); });
      return el("label", { class: "colour" }, pick, el("span", { text: labelOfCharacter(c.id) }));
    }))
    : null;
  return el("div", { class: "ifields" },
    check("Altyazı yok", off, (v) => { setIn(episode, "altyazi", "kapali", v); changed(); }),
    off ? null : check("Konuşanın rengiyle çerçevele", coloured, (v) => { setIn(episode, "altyazi", "konusan_rengi", v); changed(); }),
    colours);
}

/**
 * A line's own caption switch (its text is always the line).
 * @param {object} episode the draft (read: are captions off for the whole episode?)
 * @param {object} u the line (changed in place)
 * @param {() => void} changed
 * @returns {HTMLLabelElement}
 */
export function lineCaption(episode, u, changed) {
  const off = !!episode.altyazi?.kapali;
  return check(off ? "Altyazı (bölümde kapalı)" : "Altyazıda göster", u.altyazi !== false, (on) => {
    if (on) delete u.altyazi;
    else u.altyazi = false;
    changed();
  }, { disabled: off, title: off ? "Bölümün altyazıları kapalı" : undefined });
}
