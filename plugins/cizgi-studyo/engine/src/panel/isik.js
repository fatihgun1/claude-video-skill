// "Işık" in the inspector: the selected shot's scene light and time of day (scene.isik), a colour
// grade over the world of every shot of the scene (captions stay as they are).
import { el, select } from "./dom.js";

const TIMES = [
  { id: "sabah", label: "Sabah" },
  { id: "ogle", label: "Öğle" },
  { id: "aksam", label: "Akşam" },
  { id: "gece", label: "Gece" },
];

/**
 * @param {object} scene the scene of the draft (changed in place)
 * @param {() => void} changed
 */
export function sceneLight(scene, changed) {
  const light = scene.isik;
  const time = select(light?.saat, TIMES, (saat) => {
    if (saat) scene.isik = { ...(scene.isik || {}), saat };
    else delete scene.isik;
    changed();
  }, { empty: "yok" });
  time.setAttribute("aria-label", "Gün saati");
  const kids = [el("label", {}, el("span", { class: "muted small", text: "Gün saati" }), time)];
  if (light && light.saat !== "ogle") {
    const guc = light.guc ?? 1;
    const range = el("input", { type: "range", min: 0, max: 1, step: 0.05, value: guc, "aria-label": "Işığın gücü" });
    const out = el("span", { class: "muted small", text: `%${Math.round(guc * 100)}` });
    range.addEventListener("input", () => { out.textContent = `%${Math.round(Number(range.value) * 100)}`; });
    range.addEventListener("change", () => {
      const v = Number(range.value);
      const next = { saat: scene.isik.saat };
      if (v !== 1) next.guc = v;
      scene.isik = next;
      changed();
    });
    kids.push(el("label", {}, el("span", { class: "muted small", text: "Güç" }), range, out));
  }
  return el("div", { class: "kfields" }, kids);
}
