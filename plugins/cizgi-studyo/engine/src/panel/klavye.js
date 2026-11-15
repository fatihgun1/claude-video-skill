// The panel's keyboard shortcuts. Controls keep their own keys: text boxes and lists all of
// them, buttons and checkboxes Space, sliders their arrows (only the time slider hands its
// arrows to the transport). Dialogs handle their own keys.
//
//   Ctrl+S save · Ctrl+Z undo · Ctrl+Y / Ctrl+Shift+Z redo · Ctrl+D duplicate the shot
//   Alt+←/→ move the shot within its scene · Space play/pause · ←/→ a frame (Shift: a second)
//   Delete the selected row, action or shot

/**
 * @param {{blocked:() => boolean, save:() => void, canSave:() => boolean, travel:(dir:number) => void,
 *          duplicate:() => void, nudge:(dir:number) => void, toggle:() => void, step:(frames:number) => void,
 *          remove:() => void}} ctx
 */
export function installKeys(ctx) {
  document.addEventListener("keydown", (e) => {
    if (ctx.blocked()) return;
    const a = document.activeElement;
    const typing = /^(TEXTAREA|SELECT)$/.test(a?.tagName || "") || (a?.tagName === "INPUT" && !["range", "checkbox"].includes(a.type));
    const ownsSpace = /^(BUTTON|A)$/.test(a?.tagName || "") || a?.type === "checkbox" || a?.getAttribute?.("role") === "button";
    const ownsArrows = a?.type === "range" && a.id !== "time";
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (ctrl && key === "s") {
      e.preventDefault();
      document.activeElement?.blur(); // commit a value still being typed (inputs commit on change)
      if (ctx.canSave()) ctx.save();
      return;
    }
    if (typing) return; // in a box, keys belong to the box (its own undo, arrows, Delete)
    if (ctrl && (key === "y" || (key === "z" && e.shiftKey))) {
      e.preventDefault();
      ctx.travel(1);
    } else if (ctrl && key === "z") {
      e.preventDefault();
      ctx.travel(-1);
    } else if (ctrl && key === "d") {
      e.preventDefault();
      if (!e.repeat) ctx.duplicate(); // holding the keys must not make a row of copies
    } else if (ctrl) {
      // other Ctrl combinations belong to the browser
    } else if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      if (!e.repeat) ctx.nudge(e.key === "ArrowLeft" ? -1 : 1);
    } else if (e.altKey) {
      // Alt combinations belong to the browser
    } else if (e.key === " " && !ownsSpace) {
      e.preventDefault();
      if (!e.repeat) ctx.toggle();
    } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !ownsArrows) {
      e.preventDefault();
      ctx.step((e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 30 : 1));
    } else if (e.key === "Delete") {
      e.preventDefault();
      if (!e.repeat) ctx.remove();
    }
  });
}
