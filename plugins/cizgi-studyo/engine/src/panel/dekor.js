// "Dekor" in the inspector: the props standing in the selected shot's scene (scene.dekor), for
// every shot of it. Each row selects the piece (its frame on the stage can then be dragged:
// sideways its place, up and down its depth) and opens its details: place, depth, size, mirrored.
import { el, number } from "./dom.js";

export const DECOR_X = { min: -600, max: 2520 }; // schema limits of dekor[].x
export const DECOR_SIZE = { min: 0.3, max: 3 };

/** A decor id not used in the scene: the prop's name, then name_2, name_3… */
export function decorId(scene, prop) {
  const taken = new Set((scene.dekor || []).map((d) => d.id));
  if (!taken.has(prop)) return prop;
  let n = 2;
  while (taken.has(`${prop}_${n}`)) n++;
  return `${prop}_${n}`;
}

/**
 * @param {object} scene the draft's scene (changed in place)
 * @param {{selected:number, select:(index:number) => void, changed:() => void}} ctx selected: the selected piece, or -1
 */
export function sceneDecor(scene, ctx) {
  const list = scene.dekor || [];
  if (!list.length) return el("p", { class: "muted small", text: "Bu sahnede dekor yok. Eklemek: Nesne sekmesinde + Dekor." });
  const set = (d, key, value, empty) => {
    if (value === undefined || value === empty) delete d[key];
    else d[key] = value;
    ctx.changed();
  };
  const remove = (i) => {
    const next = list.filter((_, j) => j !== i);
    if (next.length) scene.dekor = next;
    else delete scene.dekor;
    ctx.select(-1);
    ctx.changed();
  };
  return el("div", { class: "klayers" }, list.map((d, i) => {
    const on = ctx.selected === i;
    const flip = el("input", { type: "checkbox", checked: !!d.ters, "aria-label": `${d.id} aynalı` });
    flip.addEventListener("change", () => set(d, "ters", flip.checked || undefined));
    return el("div", { class: `klayer dekor${on ? " sel" : ""}` },
      el("div", { class: "khead" },
        el("button", { class: "linkish", type: "button", title: "Seç: sahnede sürükleyebilirsin", text: d.id, on: { click: () => ctx.select(on ? -1 : i) } }),
        el("img", { class: "dthumb", alt: "", src: `/kutuphane/nesne/${d.prop}.svg` }),
        el("span", { class: "muted small", text: d.prop }),
        el("button", { class: "btn icon small danger", type: "button", "aria-label": `${d.id} dekorunu sil`, text: "✕", on: { click: () => remove(i) } })),
      on ? el("div", { class: "kfields" },
        el("label", {}, el("span", { class: "muted small", text: "Yer x" }), number(d.x, (v) => set(d, "x", v ?? 960), { ...DECOR_X, step: 10 })),
        el("label", {}, el("span", { class: "muted small", text: "Derinlik" }), number(d.back ?? 0, (v) => set(d, "back", v ?? 0, 0), { min: 0, max: 1, step: 0.05 })),
        el("label", {}, el("span", { class: "muted small", text: "Boyut" }), number(d.olcek ?? 1, (v) => set(d, "olcek", v ?? 1, 1), { ...DECOR_SIZE, step: 0.05 })),
        el("label", {}, flip, el("span", { class: "muted small", text: "Aynalı" }))) : null);
  }));
}
