// "Altyazı" in the inspector: where and how big the selected shot's scene shows its captions
// (scene.altyazi), and two settings of the whole episode: captions off (episode.altyazi.kapali)
// and edging each caption with its speaker's colour (konusan_rengi, characters[].renk).
// A line's own on/off is in its details (and a click on its block in the Altyazı track).
import { el, select } from "./dom.js";
import { captionPlace, speakerColor } from "./altyazi.mjs";

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
 * @param {object} episode the draft (changed in place)
 * @param {object} scene the selected shot's scene
 * @param {string} format "16:9" | "9:16" (the defaults differ)
 * @param {(id:string) => string} labelOfCharacter
 * @param {() => void} changed
 */
export function captionSettings(episode, scene, format, labelOfCharacter, changed) {
  const def = captionPlace({}, format);
  const off = !!episode.altyazi?.kapali;
  const place = select(scene.altyazi?.konum, PLACES, (v) => { setIn(scene, "altyazi", "konum", v); changed(); },
    { empty: `${labelOf(PLACES, def.konum)} (${format} için)` });
  place.setAttribute("aria-label", "Altyazının yeri");
  const size = select(scene.altyazi?.boyut, SIZES, (v) => { setIn(scene, "altyazi", "boyut", v); changed(); },
    { empty: `${labelOf(SIZES, def.boyut)} (varsayılan)` });
  size.setAttribute("aria-label", "Altyazının boyutu");
  const check = (text, on, set) => {
    const box = el("input", { type: "checkbox", checked: on });
    box.addEventListener("change", () => { set(box.checked); changed(); });
    return el("label", { class: "row-inline small" }, box, el("span", { text }));
  };
  const coloured = !!episode.altyazi?.konusan_rengi;
  const colours = coloured && !off
    ? el("div", { class: "kfields" }, episode.characters.map((c) => {
      const pick = el("input", { type: "color", value: speakerColor(episode, c.id), "aria-label": `${labelOfCharacter(c.id)} rengi` });
      pick.addEventListener("change", () => { c.renk = pick.value; changed(); });
      return el("label", {}, el("span", { class: "muted small", text: labelOfCharacter(c.id) }), pick);
    }))
    : null;
  return el("div", {},
    el("div", { class: "kfields" },
      el("label", {}, el("span", { class: "muted small", text: "Yer" }), place),
      el("label", {}, el("span", { class: "muted small", text: "Boyut" }), size)),
    el("p", { class: "muted small", text: "Bütün bölüm:" }),
    check("Altyazı yok", off, (v) => setIn(episode, "altyazi", "kapali", v)),
    off ? null : check("Konuşanın rengiyle çerçevele", coloured, (v) => setIn(episode, "altyazi", "konusan_rengi", v)),
    colours);
}

/** A line's own caption switch (its text is always the line). */
export function lineCaption(episode, u, changed) {
  const off = !!episode.altyazi?.kapali;
  const box = el("input", { type: "checkbox", checked: u.altyazi !== false, disabled: off, "aria-label": "Altyazıda göster" });
  box.addEventListener("change", () => {
    if (box.checked) delete u.altyazi;
    else u.altyazi = false;
    changed();
  });
  return el("label", { class: "row-inline small", title: off ? "Bölümün altyazıları kapalı" : "" }, box,
    el("span", { text: off ? "Altyazı (bölümde kapalı)" : "Altyazıda göster" }));
}
