// Drawers on a narrow window (below 1180px): the rail, the stage and the timeline stay on screen;
// the left panel and the properties open over the stage, one at a time. The properties open
// from the top bar's "Özellikler"; ✕, Esc or opening the other drawer closes one. On a wide
// window none of this shows (panel.css), and the panels sit beside the stage as before.
import { $ } from "./dom.js";

export const NARROW = "(max-width: 1180px)";

/**
 * @param {{rail:{close:() => void, isOpen:() => boolean}}} ctx
 * @returns {{leftOpened:() => void}} the rail calls it when the left panel opens
 */
export function installDrawers(ctx) {
  const narrow = window.matchMedia(NARROW);
  const toggle = $("insp-toggle");

  function setInspector(on) {
    document.body.classList.toggle("insp-open", on);
    toggle.setAttribute("aria-expanded", String(on));
    if (on && narrow.matches) ctx.rail?.close(); // one drawer at a time: the stage stays visible beside it
  }
  toggle.addEventListener("click", () => {
    const on = !document.body.classList.contains("insp-open");
    setInspector(on);
    if (on) $("insp-close").focus({ preventScroll: true });
  });
  $("insp-close").addEventListener("click", () => {
    setInspector(false);
    toggle.focus({ preventScroll: true });
  });
  // Esc closes the open drawer (not while typing, nor under a dialog, which has its own Esc)
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !narrow.matches || e.defaultPrevented || document.querySelector("dialog[open]")) return;
    if (document.body.classList.contains("at-home")) return; // the home page's own Esc
    const a = document.activeElement;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(a?.tagName || "") || a?.isContentEditable) return;
    if (document.body.classList.contains("insp-open")) {
      setInspector(false);
      toggle.focus({ preventScroll: true });
    } else if (ctx.rail?.isOpen()) ctx.rail.close();
  });
  // Crossing 1180px: the inspector is a column again (or a closed drawer); entering narrow with the
  // left panel open keeps it, alone.
  narrow.addEventListener("change", () => setInspector(false));
  setInspector(false);
  return {
    leftOpened() {
      if (narrow.matches) setInspector(false);
    },
  };
}
