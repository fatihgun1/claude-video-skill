// "Işık" in the inspector: the selected shot's scene light and time of day (scene.isik), a colour
// grade over the world of every shot of the scene (captions stay as they are).
import { el } from "./dom.js";
import { labelled, segment, valueSlider } from "./denetleyici-alan.js";

const TIMES = [
  { id: "sabah", label: "Sabah" },
  { id: "ogle", label: "Öğle" },
  { id: "aksam", label: "Akşam" },
  { id: "gece", label: "Gece" },
];

/**
 * @param {object} scene the scene of the draft (changed in place)
 * @param {() => void} changed
 * @returns {HTMLElement}
 */
export function sceneLight(scene, changed) {
  const light = scene.isik;
  // five choices: segment() turns this into a dropdown, which fits the narrow panel better
  const time = segment(light?.saat, TIMES, (saat) => {
    if (saat) scene.isik = { ...(scene.isik || {}), saat };
    else delete scene.isik;
    changed();
  }, { empty: "Yok", label: "Gün saati" });
  const kids = [labelled("Gün saati", time)];
  // noon is the light as drawn: there is nothing to make stronger
  if (light && light.saat !== "ogle") {
    kids.push(labelled("Güç", valueSlider(light.guc ?? 1, {
      label: "Işığın gücü",
      onSet: (v) => {
        const next = { saat: scene.isik.saat };
        if (v !== 1) next.guc = v;
        scene.isik = next;
        changed();
      },
    })));
  }
  return el("div", { class: "ifields" }, kids);
}
