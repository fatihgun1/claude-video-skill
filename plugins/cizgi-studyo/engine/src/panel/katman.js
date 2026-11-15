// "Mekân katmanları" in the inspector: the selected shot's scene background, layer by layer
// (back to front), with that scene's settings (scene.katmanlar): shown or hidden, moved
// (dx/dy, world units), scaled around the bottom middle of the frame, tinted. They hold for
// every shot of the scene. A one-file background has a single layer, "tum".
import { el, number } from "./dom.js";

const KEYS = ["gizli", "dx", "dy", "olcek", "ton"];
const DEPTH_TEXT = (d) => (d === 0 ? "en uzak" : d === 1 ? "karakterlerin düzlemi" : `derinlik ${d}`);

/**
 * @param {object} scene the scene of the draft (changed in place)
 * @param {{id:string, derinlik:number}[]} layers its background's layers
 * @param {() => void} changed
 */
export function sceneLayers(scene, layers, changed) {
  if (!layers?.length) return el("p", { class: "muted small", text: "Bu mekânın katman bilgisi yok." });
  const settings = (id) => scene.katmanlar?.[id] || {};
  /** Set one value of one layer; empty values and empty layers are dropped. */
  function set(id, key, value) {
    const next = { ...settings(id) };
    if (value === undefined || value === false || value === "" || (key === "olcek" && value === 1) || ((key === "dx" || key === "dy") && value === 0)) delete next[key];
    else next[key] = value;
    const all = { ...(scene.katmanlar || {}) };
    if (KEYS.some((k) => k in next)) all[id] = next;
    else delete all[id];
    if (Object.keys(all).length) scene.katmanlar = all;
    else delete scene.katmanlar;
    changed();
  }
  return el("div", { class: "klayers" }, layers.map((l) => {
    const s = settings(l.id);
    const shown = el("input", { type: "checkbox", checked: !s.gizli, "aria-label": `${l.id} görünsün` });
    shown.addEventListener("change", () => set(l.id, "gizli", !shown.checked));
    const tint = el("input", { type: "color", value: s.ton || "#ffffff", "aria-label": `${l.id} rengi` });
    tint.addEventListener("change", () => set(l.id, "ton", tint.value));
    return el("div", { class: `klayer${s.gizli ? " off" : ""}` },
      el("label", { class: "khead" }, shown, el("b", { text: l.id }), el("span", { class: "muted small", text: DEPTH_TEXT(l.derinlik) })),
      el("div", { class: "kfields" },
        el("label", {}, el("span", { class: "muted small", text: "Kaydır x" }), number(s.dx ?? 0, (v) => set(l.id, "dx", v ?? 0), { min: -960, max: 960, step: 10 })),
        el("label", {}, el("span", { class: "muted small", text: "y" }), number(s.dy ?? 0, (v) => set(l.id, "dy", v ?? 0), { min: -540, max: 540, step: 10 })),
        el("label", {}, el("span", { class: "muted small", text: "Ölçek" }), number(s.olcek ?? 1, (v) => set(l.id, "olcek", v ?? 1), { min: 0.5, max: 2, step: 0.05 })),
        el("label", {}, el("span", { class: "muted small", text: "Ton" }), tint,
          s.ton ? el("button", { class: "btn icon small", type: "button", "aria-label": `${l.id} rengini kaldır`, text: "✕", on: { click: () => set(l.id, "ton", undefined) } }) : null)));
  }));
}
