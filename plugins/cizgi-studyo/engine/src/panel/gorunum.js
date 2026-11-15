// View choices that never change the episode: the left pane (Proje | Kütüphane, remembered in
// the browser), the timeline (Sahne | Bölüm), the stage's frame (16:9 | 9:16), safe areas and
// the layers hidden in the preview.
import { $, el } from "./dom.js";
import { LAYERS } from "./duzen.js";

const LEFT_KEY = "cizgi.sol";

/**
 * @param {{timeline:{setView:(v:string) => void}, editor:{setSafe:(on:boolean) => void, setLayer:(key:string, on:boolean) => void},
 *          format:() => string, setFormat:(format:string) => void}} ctx
 */
export function installViews(ctx) {
  function showLeft(which) {
    const lib = which === "kutuphane";
    $("lt-proje").setAttribute("aria-selected", String(!lib));
    $("lt-kutuphane").setAttribute("aria-selected", String(lib));
    $("proje-pane").hidden = lib;
    $("lib-pane").hidden = !lib;
    try {
      localStorage.setItem(LEFT_KEY, which);
    } catch {
      /* storage off: the choice lasts until reload */
    }
  }
  $("lt-proje").addEventListener("click", () => showLeft("proje"));
  $("lt-kutuphane").addEventListener("click", () => showLeft("kutuphane"));
  try {
    if (localStorage.getItem(LEFT_KEY) === "kutuphane") showLeft("kutuphane");
  } catch {
    /* storage off */
  }

  function setTimelineView(v) {
    $("tl-sahne").setAttribute("aria-pressed", String(v === "sahne"));
    $("tl-bolum").setAttribute("aria-pressed", String(v === "bolum"));
    ctx.timeline.setView(v);
  }
  $("tl-sahne").addEventListener("click", () => setTimelineView("sahne"));
  $("tl-bolum").addEventListener("click", () => setTimelineView("bolum"));

  function setFormat(format) {
    if (format === ctx.format()) return;
    $("fmt-16x9").setAttribute("aria-pressed", String(format === "16:9"));
    $("fmt-9x16").setAttribute("aria-pressed", String(format === "9:16"));
    ctx.setFormat(format);
  }
  $("fmt-16x9").addEventListener("click", () => setFormat("16:9"));
  $("fmt-9x16").addEventListener("click", () => setFormat("9:16"));
  $("safe").addEventListener("click", () => {
    const on = $("safe").getAttribute("aria-pressed") !== "true";
    $("safe").setAttribute("aria-pressed", String(on));
    ctx.editor.setSafe(on);
  });
  $("layers-menu").replaceChildren(...LAYERS.map(([key, text]) => {
    const box = el("input", { type: "checkbox", checked: true });
    box.addEventListener("change", () => ctx.editor.setLayer(key, box.checked));
    return el("label", {}, box, text);
  }));
}
