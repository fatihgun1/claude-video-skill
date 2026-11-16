// The left rail: one icon per panel (Sahneler, then the library's kinds). A click opens that
// panel in the single left pane; a click on the open one closes the pane and the stage grows.
// Which panel is open (or none) is remembered in the browser; it never changes the episode.
import { $, el, svg } from "./dom.js";
import { stop as stopSound } from "./dinle.js";
import { NARROW } from "./cekmece.js";

const KEY = "cizgi.sol";
/** Stroke paths on a 24×24 grid (round caps), drawn in the button's text colour. */
const PANELS = [
  ["sahneler", "Sahneler", ["M3 7h13v12H3z", "M7 3h14v12h-5"]],
  ["karakter", "Karakter", ["M12 3.5a3.5 3.5 0 1 1 0 7a3.5 3.5 0 1 1 0-7z", "M5 21c0-4 3.1-7 7-7s7 3 7 7"]],
  ["hareket", "Hareket", ["M14.5 3.5a2 2 0 1 1 0 4a2 2 0 1 1 0-4z", "M8 21l3-6 3 2.5V21", "M11 15l1.2-5.5 3.8 2 3-1", "M3 11h4", "M2 15h4"]],
  ["mekan", "Mekân", ["M3 5h18v14H3z", "M3 16l5-5.5 4.5 4.5 3-3L21 17", "M16.5 7.5a1.5 1.5 0 1 1 0 3a1.5 1.5 0 1 1 0-3z"]],
  ["nesne", "Nesne", ["M12 3l8 4.5v9L12 21l-8-4.5v-9z", "M4 7.5l8 4.5 8-4.5", "M12 12v9"]],
  ["ses", "Ses", ["M4 9h4l5-4v14l-5-4H4z", "M16 9.5a3.5 3.5 0 0 1 0 5", "M18.5 7a7 7 0 0 1 0 10"]],
  ["muzik", "Müzik", ["M9 18V5l11-2v13", "M6 15a3 3 0 1 1 0 6a3 3 0 1 1 0-6z", "M17 13a3 3 0 1 1 0 6a3 3 0 1 1 0-6z"]],
  ["kamera", "Kamera", ["M3 7h12v10H3z", "M15 10.5l6-3.5v10l-6-3.5"]],
];
const IDS = new Set(PANELS.map(([id]) => id));
/** The left pane of earlier versions: "Proje" was the tree, "Kütüphane" the library. */
const OLD = { proje: "sahneler", kutuphane: "karakter" };

const icon = (paths) => svg("svg", { class: "ricon", viewBox: "0 0 24 24", width: 22, height: 22, "aria-hidden": "true" },
  paths.map((d) => svg("path", { d, fill: "none", stroke: "currentColor", "stroke-width": 1.7, "stroke-linecap": "round", "stroke-linejoin": "round" })));

/** The panel to open at start from what was stored ("" = the pane was closed). */
export function storedPanel(value) {
  if (value === "") return null;
  const id = OLD[value] || value;
  return IDS.has(id) ? id : "karakter";
}

/**
 * @param {{library:{show:(kind:string) => void}, tree:{render:() => void},
 *          onOpen?:(id:string) => void, startClosed?:boolean}} ctx
 *   startClosed: begin with the pane closed without forgetting the stored choice (a narrow window,
 *   where the pane would cover the stage).
 */
export function installRail(ctx) {
  let open = null;
  /** A drawer opened or closed on a narrow window is not remembered as the wide layout's choice. */
  const remember = () => !window.matchMedia(NARROW).matches;
  const buttons = new Map(PANELS.map(([id, label, paths]) => [id, el("button", {
    class: "rbtn", type: "button", "aria-controls": "left", title: label,
    on: { click: () => set(open === id ? null : id, remember()) },
  }, icon(paths), el("span", { text: label }))]));
  $("rail").replaceChildren(...buttons.values());
  $("left-close").addEventListener("click", () => {
    const was = open;
    set(null, remember());
    buttons.get(was)?.focus(); // the ✕ is hidden with the pane: the keyboard stays on the rail
  });

  function set(id, remember = true) {
    open = id;
    for (const [key, b] of buttons) b.setAttribute("aria-pressed", String(key === id));
    document.querySelector(".editor").classList.toggle("left-closed", !id);
    $("left").hidden = !id;
    if (remember) {
      try {
        localStorage.setItem(KEY, id || "");
      } catch {
        /* storage off: the choice lasts until reload */
      }
    }
    if (!id || id === "sahneler") stopSound(); // a sound from Ses or Müzik does not play on with no stop button
    if (!id) return;
    $("left-title").textContent = PANELS.find(([key]) => key === id)[1];
    $("proje-pane").hidden = id !== "sahneler";
    $("lib-pane").hidden = id === "sahneler";
    if (id === "sahneler") ctx.tree.render();
    else ctx.library.show(id);
    ctx.onOpen?.(id);
  }

  let stored = "karakter";
  try {
    stored = localStorage.getItem(KEY) ?? "karakter";
  } catch {
    /* storage off */
  }
  if (ctx.startClosed) set(null, false);
  else set(storedPanel(stored));
  return {
    /** Close the pane (Esc on a narrow window, or the other drawer opening). */
    close: () => {
      if (!open) return;
      const inside = $("left").contains(document.activeElement);
      const was = open;
      set(null, false); // a drawer closing: the wide layout keeps its choice
      if (inside) buttons.get(was)?.focus({ preventScroll: true }); // the keyboard stays on the rail
    },
    isOpen: () => !!open,
  };
}
