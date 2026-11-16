// Dividers: drag the edge between two areas (or use the arrow keys on it) to give one of them
// more room; a double-click puts it back. Each size is a CSS variable on .editor and is
// remembered in the browser. The timeline's top edge and both side panels use this.

/**
 * The size after an arrow key on a divider, or null for another key.
 * @param {string} key the KeyboardEvent key
 * @param {"x"|"y"} axis x: the divider moves left/right, y: up/down
 * @param {1|-1} sign 1: moving right/down grows the area, -1: moving left/up grows it
 */
export function sizeAfterKey(key, axis, sign, size, step) {
  const keys = axis === "x" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
  const dir = key === keys[1] ? 1 : key === keys[0] ? -1 : 0;
  return dir ? size + dir * sign * step : null;
}

/** min ≤ px ≤ max (max wins when they cross: a small window gives the area its least). */
export const clampSize = (px, min, max) => Math.round(Math.max(Math.min(min, max), Math.min(max, px)));

const store = {
  get(key) {
    try {
      return Number(localStorage.getItem(key)) || 0;
    } catch {
      return 0; // storage off
    }
  },
  set(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(value));
    } catch {
      /* storage off: the size lasts until reload */
    }
  },
};

/**
 * @param {HTMLElement} sep the divider (role="separator")
 * @param {{axis:"x"|"y", sign:1|-1, cssVar:string, key:string, size:() => number,
 *          min:number, max:() => number, step?:number}} o size(): the area's current size in px
 */
export function installDivider(sep, o) {
  const editor = document.querySelector(".editor");
  const step = o.step ?? 20;
  /** Give the area this size (within limits); returns what it got. */
  function apply(px) {
    const v = clampSize(px, o.min, o.max());
    editor.style.setProperty(o.cssVar, `${v}px`);
    sep.setAttribute("aria-valuenow", String(v));
    return v;
  }
  sep.setAttribute("aria-valuemin", String(o.min));
  sep.addEventListener("pointerdown", (down) => {
    if (down.button !== 0) return;
    down.preventDefault();
    const at = (e) => (o.axis === "x" ? e.clientX : e.clientY);
    const p0 = at(down);
    const s0 = o.size();
    let got = null; // unchanged until the pointer moves
    try {
      sep.setPointerCapture(down.pointerId);
    } catch {
      /* the pointer is already gone; the events below still end the drag */
    }
    sep.classList.add("active");
    const move = (e) => { got = apply(s0 + o.sign * (at(e) - p0)); };
    const end = () => {
      sep.classList.remove("active");
      sep.removeEventListener("pointermove", move);
      for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) sep.removeEventListener(ev, end);
      if (got !== null) store.set(o.key, got);
    };
    sep.addEventListener("pointermove", move);
    for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) sep.addEventListener(ev, end);
  });
  sep.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return; // Alt+←/→ and the like stay the editor's shortcuts
    const next = sizeAfterKey(e.key, o.axis, o.sign, o.size(), step);
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation(); // not the stage's frame steps
    store.set(o.key, apply(next));
  });
  sep.addEventListener("dblclick", () => {
    editor.style.removeProperty(o.cssVar); // back to the stylesheet's size
    store.set(o.key, null);
    sep.setAttribute("aria-valuenow", String(Math.round(o.size())));
  });
  /** What a screen reader hears: the size on screen (the stylesheet may hold it smaller) and the most it can get. */
  const announce = () => {
    sep.setAttribute("aria-valuenow", String(Math.round(o.size())));
    sep.setAttribute("aria-valuemax", String(Math.max(o.min, Math.round(o.max()))));
  };
  window.addEventListener("resize", announce);
  sep.addEventListener("focus", announce);
  const saved = store.get(o.key);
  if (saved > 0) apply(saved);
  announce();
}
