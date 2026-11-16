// View choices that never change the episode: the left rail and its panel (serit.js), the sizes
// of the side panels and the timeline (ayirici.js, remembered in the browser), the timeline
// (Sahne | Bölüm), the stage's frame (16:9 | 9:16), safe areas and the layers hidden in the preview.
import { $, el } from "./dom.js";
import { LAYERS } from "./duzen.js";
import { installRail } from "./serit.js";
import { installDivider } from "./ayirici.js";

const STAGE_MIN_H = 220; // what the timeline always leaves above it for the stage
const STAGE_MIN_W = 420; // what the side panels always leave between them for the stage
const RAIL_W = 64;
const BAR_H = 52;

const width = (id) => $(id).getBoundingClientRect().width;

/** The timeline's top edge and the side panels' inner edges: drag, arrow keys, double-click resets. */
function installDividers() {
  installDivider($("tl-resize"), {
    axis: "y", sign: -1, cssVar: "--tl-h", key: "cizgi.cizelge", min: 150, // the shot row and one track
    size: () => $("tl-resize").parentElement.getBoundingClientRect().height,
    max: () => Math.max(150, window.innerHeight - BAR_H - STAGE_MIN_H),
  });
  installDivider($("left-resize"), {
    axis: "x", sign: 1, cssVar: "--left-w", key: "cizgi.sol-gen", min: 220,
    size: () => width("left"),
    max: () => Math.min(480, window.innerWidth - RAIL_W - width("inspector-pane") - STAGE_MIN_W),
  });
  installDivider($("right-resize"), {
    axis: "x", sign: -1, cssVar: "--right-w", key: "cizgi.sag-gen", min: 280,
    size: () => width("inspector-pane"),
    max: () => Math.min(560, window.innerWidth - RAIL_W - ($("left").hidden ? 0 : width("left")) - STAGE_MIN_W),
  });
}

/**
 * @param {{timeline:{setView:(v:string) => void}, editor:{setSafe:(on:boolean) => void, setLayer:(key:string, on:boolean) => void},
 *          format:() => string, setFormat:(format:string) => void, library:{show:(kind:string) => void}, tree:{render:() => void}}} ctx
 */
export function installViews(ctx) {
  installDividers();
  installRail({ library: ctx.library, tree: ctx.tree });
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
