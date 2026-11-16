// Library cards dragged onto the timeline or the stage. A drop does what a click on the card
// does (app.js pick), at the place it lands: the shot under it, the moment under it, the
// character whose track or frame it is on. The rules are plain functions (tested in Node);
// installDrops wires the browser's drag events and shows where a card would land.
import { STEP } from "./kurgu.js";

const PREFIX = "application/x-cizgi-";
export const KINDS = new Set(["karakter", "hareket", "mekan", "nesne", "ses", "muzik", "kamera-plan", "kamera-hareket"]);

/** The drag type that carries a card's kind: types can be read while dragging, data only on drop. */
export const typeOf = (kind) => `${PREFIX}${kind}`;
/** The library kind a drag carries, or null for anything else (a file, text…). */
export function kindOfTypes(types) {
  for (const t of types) {
    const kind = t.startsWith(PREFIX) ? t.slice(PREFIX.length) : null;
    if (kind && KINDS.has(kind)) return kind;
  }
  return null;
}

/**
 * What a card of this kind does at this place, or null when it cannot land there.
 * @param {string} kind
 * @param {{area:"timeline"|"stage", shotId:string|null, local?:number, castIndex?:number|null, worldX?:number}} at
 *   local: seconds into the shot under the pointer (timeline); castIndex: the character whose
 *   track or frame it is over; worldX: where on the stage, in world units
 * @returns {{pick:string, seek?:number, castIndex?:number, seg?:number, worldX?:number}|null}
 *   seek: move the playhead to this time in the shot first (the click acts at the playhead)
 */
export function dropAction(kind, at) {
  if (!KINDS.has(kind)) return null;
  if (kind === "muzik") return { pick: "muzik" }; // the whole film's
  if (!at.shotId) return null;
  const onTimeline = at.area === "timeline";
  if (kind === "hareket") {
    if (at.castIndex === null || at.castIndex === undefined) return null;
    if (!onTimeline) return { pick: "hareket-ekle", castIndex: at.castIndex }; // from the playhead
    // at the very start there is no room before it: it takes the first action's place
    if (at.local < STEP) return { pick: "hareket", seek: 0, castIndex: at.castIndex, seg: 0 };
    return { pick: "hareket-ekle", seek: at.local, castIndex: at.castIndex };
  }
  if (kind === "ses") return onTimeline ? { pick: "ses", seek: at.local } : { pick: "ses" };
  if (kind === "karakter" && !onTimeline && at.worldX !== undefined) return { pick: "karakter", worldX: at.worldX };
  return { pick: kind };
}

/**
 * @param {{timeline:HTMLElement, stage:HTMLElement,
 *          timelineAt:(x:number, y:number) => {shotId:string|null, local:number, castIndex:number|null}|null,
 *          showTimelineDrop:(x:number|null, text?:string) => void,
 *          stageAt:(x:number, y:number) => {shotId:string|null, castIndex:number|null, worldX?:number},
 *          apply:(kind:string, id:string, action:object, shotId:string) => void}} ctx
 */
export function installDrops(ctx) {
  const place = (area, e) => {
    const hit = area === "timeline" ? ctx.timelineAt(e.clientX, e.clientY) : ctx.stageAt(e.clientX, e.clientY);
    return hit ? { area, ...hit } : null;
  };
  const clear = () => {
    ctx.showTimelineDrop(null);
    ctx.stage.classList.remove("drop-ok");
  };
  const end = () => {
    document.body.removeAttribute("data-drag");
    clear();
  };

  for (const [area, box] of [["timeline", ctx.timeline], ["stage", ctx.stage]]) {
    box.addEventListener("dragover", (e) => {
      const kind = kindOfTypes(e.dataTransfer.types);
      const at = kind && place(area, e);
      const action = at && dropAction(kind, at);
      if (!action) return clear(); // not a place for it: the browser shows "no drop"
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      if (area === "timeline") ctx.showTimelineDrop(e.clientX, action.seek !== undefined ? `${action.seek.toFixed(2)} s` : "");
      else ctx.stage.classList.add("drop-ok");
    });
    box.addEventListener("dragleave", (e) => {
      if (!box.contains(e.relatedTarget)) clear();
    });
    box.addEventListener("drop", (e) => {
      const kind = kindOfTypes(e.dataTransfer.types);
      const id = kind && e.dataTransfer.getData(typeOf(kind));
      const at = id && place(area, e);
      const action = at && dropAction(kind, at);
      end(); // the library redraws after a drop: the card that would get dragend may be gone
      if (!action) return;
      e.preventDefault();
      ctx.apply(kind, id, action, at.shotId);
    });
  }
  document.addEventListener("dragend", end);
  document.addEventListener("drop", end); // a drop anywhere ends it, wherever its card went
  return {
    /** Make a library card draggable as this kind and id. */
    source(node, kind, id) {
      node.draggable = true;
      node.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData(typeOf(kind), id);
        e.dataTransfer.setData("text/plain", id);
        e.dataTransfer.effectAllowed = "copy";
        document.body.dataset.drag = kind; // the places it can land light up (panel.css)
      });
    },
  };
}
