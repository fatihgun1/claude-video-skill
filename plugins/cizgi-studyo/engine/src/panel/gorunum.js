// View choices that never change the episode: the left pane (Proje | Kütüphane, remembered in
// the browser), the timeline (Sahne | Bölüm), the stage's frame (16:9 | 9:16), safe areas and
// the layers hidden in the preview, the timeline's height (remembered in the browser).
import { $, el } from "./dom.js";
import { LAYERS } from "./duzen.js";

const LEFT_KEY = "cizgi.sol";
const TL_KEY = "cizgi.cizelge";
const TL_MIN = 150; // the shot row and one track
const STAGE_MIN = 220; // what the timeline always leaves above it for the stage
const TL_KEY_STEP = 20;

/** Make the timeline this tall (within limits); returns the height it got. */
function setTimelineHeight(px) {
  const max = Math.max(TL_MIN, window.innerHeight - 52 - STAGE_MIN);
  const h = Math.round(Math.min(max, Math.max(TL_MIN, px)));
  document.querySelector(".editor").style.setProperty("--tl-h", `${h}px`);
  $("tl-resize").setAttribute("aria-valuenow", String(h));
  return h;
}

function saveTimelineHeight(h) {
  try {
    localStorage.setItem(TL_KEY, String(h));
  } catch {
    /* storage off: the height lasts until reload */
  }
}

/** Drag (or ↑/↓ on) the timeline's top edge to change its height. */
function installTimelineResize() {
  const sep = $("tl-resize");
  const height = () => sep.parentElement.getBoundingClientRect().height;
  sep.setAttribute("aria-valuemin", String(TL_MIN));
  sep.addEventListener("pointerdown", (down) => {
    if (down.button !== 0) return;
    down.preventDefault();
    const y0 = down.clientY;
    const h0 = height();
    let h = null; // unchanged until the pointer moves
    try {
      sep.setPointerCapture(down.pointerId);
    } catch {
      /* the pointer is already gone; the events below still end the drag */
    }
    sep.classList.add("active");
    const move = (e) => { h = setTimelineHeight(h0 - (e.clientY - y0)); };
    const end = () => {
      sep.classList.remove("active");
      sep.removeEventListener("pointermove", move);
      for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) sep.removeEventListener(ev, end);
      if (h !== null) saveTimelineHeight(h);
    };
    sep.addEventListener("pointermove", move);
    for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) sep.addEventListener(ev, end);
  });
  sep.addEventListener("keydown", (e) => {
    const step = e.key === "ArrowUp" ? TL_KEY_STEP : e.key === "ArrowDown" ? -TL_KEY_STEP : 0;
    if (!step) return;
    e.preventDefault();
    e.stopPropagation(); // not the stage's frame steps
    saveTimelineHeight(setTimelineHeight(height() + step));
  });
  let saved = NaN;
  try {
    saved = Number(localStorage.getItem(TL_KEY));
  } catch {
    /* storage off */
  }
  if (saved > 0) setTimelineHeight(saved);
  else sep.setAttribute("aria-valuenow", String(Math.round(height())));
}

/**
 * @param {{timeline:{setView:(v:string) => void}, editor:{setSafe:(on:boolean) => void, setLayer:(key:string, on:boolean) => void},
 *          format:() => string, setFormat:(format:string) => void}} ctx
 */
export function installViews(ctx) {
  installTimelineResize();
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
