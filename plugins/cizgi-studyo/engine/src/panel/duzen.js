// Editing on the stage: a layer over the preview that knows where everyone is drawn.
//   - a frame around each cast member and prop of the selected shot; click to select
//   - drag someone sideways: they land on the nearest free mark, or off it by dx
//   - the selected walker's path as an arrow; drag its free end to change walk.dx
//   - ⇆ turns the selected cast member around (facing)
//   - safe areas and the caption zone, and hiding layers of the preview (view only)
// Positions come from the preview itself: the camera group's transform maps world units
// to preview pixels, and the stage scales preview pixels to page pixels.
import { el, svg } from "./dom.js";
import { placeAt, walkDxAfterDrag } from "./kurgu.js";

const DRAG_START_PX = 4;
const PROP_MAX_DX = 600; // schema limit of props[].dx
const CAST_MAX_DX = 900; // schema limit of cast[].dx
const NUDGE = 10; // world units per arrow key
const NUDGE_BIG = 50; // with Shift
const BACK_STEP = 0.05; // depth per ↑/↓
const BACK_STEP_BIG = 0.2; // with Shift
const DEPTH_START_PX = 10; // a mostly sideways drag leaves the depth alone
const snapBack = (b) => Math.min(1, Math.max(0, Math.round(b / BACK_STEP) / Math.round(1 / BACK_STEP)));
const ACTION_SAFE = 0.05;
const TITLE_SAFE = 0.1;
export const LAYERS = [["bg", "Arka plan"], ["cast", "Karakterler"], ["props", "Nesneler"], ["captions", "Altyazı"]];
const LAYER_SELECTORS = { bg: '[id^="bg-"]', cast: '[id^="kar-"]', props: '[id^="prop-"]', captions: "#altyazilar" };

/**
 * @param {{stage:HTMLElement, layer:HTMLElement}} els
 * @param {{doc:() => Document|null, scale:() => number, playing:() => boolean, viewport:() => {width:number, height:number},
 *          current:() => {shot:object, scene:object}|null, inShot:() => boolean,
 *          sel:() => {kind:string|null, index:number}, select:(kind:string|null, index?:number) => void,
 *          layout:() => {marks:Record<string, number>, ratio:number, ground:number},
 *          labelOf:(id:string) => string,
 *          place:(kind:"cast"|"prop", index:number, at:{mark:string, dx:number}) => void,
 *          setWalk:(index:number, dx:number) => void, flip:(index:number) => void, say:(text:string) => void}} ctx
 */
export function createStageEditor(els, ctx) {
  const view = { safe: false, hidden: new Set() };
  let busy = false; // a drag is running: do not redraw under it
  let playingDrawn = false;
  let focusKey = null; // the frame that had keyboard focus, given it back after a redraw

  /** World → page pixels at the current frame. */
  function mapper(doc) {
    const ctm = doc.getElementById("kamera")?.getScreenCTM();
    if (!ctm) return null;
    const k = ctx.scale();
    return {
      k,
      perWorld: ctm.a * k, // page pixels per world unit along x
      at: (x, y) => [(ctm.a * x + ctm.c * y + ctm.e) * k, (ctm.b * x + ctm.d * y + ctm.f) * k],
    };
  }

  /** The drawn box of an element of the preview in page pixels, or null when it is not shown. */
  function boxOf(node, k) {
    if (!node) return null;
    const r = node.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { left: r.left * k, top: r.top * k, width: r.width * k, height: r.height * k };
  }

  function follow(down, { onMove, onEnd, onClick }) {
    const target = down.currentTarget;
    const x0 = down.clientX;
    const y0 = down.clientY;
    let moved = false;
    try {
      target.setPointerCapture(down.pointerId);
    } catch {
      /* pointer already gone */
    }
    busy = true;
    const move = (e) => {
      const dx = e.clientX - x0;
      const dy = e.clientY - y0;
      if (!moved && Math.hypot(dx, dy) < DRAG_START_PX) return;
      moved = true;
      onMove(dx, dy);
    };
    const up = (e) => {
      for (const [ev, fn] of [["pointermove", move], ["pointerup", up], ["pointercancel", up], ["lostpointercapture", up]]) target.removeEventListener(ev, fn);
      busy = false;
      if (moved && e.type === "pointerup") onEnd(e.clientX - x0, e.clientY - y0);
      else if (moved) draw();
      else if (e.type === "pointerup") onClick?.();
    };
    target.addEventListener("pointermove", move);
    for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) target.addEventListener(ev, up);
  }

  /** Dashed lines on the marks while dragging; the one it would land on is lit. */
  function markGuides(map, layout, lit) {
    return Object.entries(layout.marks).map(([id, x]) => {
      const [px] = map.at(x, layout.ground);
      return el("div", { class: `guide${id === lit ? " lit" : ""}`, style: { left: `${px}px` } }, el("span", { text: id }));
    });
  }

  /** A movable frame for one cast member or prop. */
  function frame({ box, label, selected, kind, index, baseX, here, taken, movable, extra = [] }) {
    const maxDx = kind === "prop" ? PROP_MAX_DX : CAST_MAX_DX;
    const node = el("div", {
      class: `ebox${selected ? " sel" : ""}${movable ? " movable" : ""}`,
      style: { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` },
      title: movable ? `${label} · sürükle ya da ←/→: yerini değiştir` : label,
      role: "button", tabindex: "0", "aria-pressed": String(selected),
      "aria-label": movable
        ? `${label}; ←/→ ile kaydır${kind === "cast" ? ", ↑/↓ ile arkaya ya da öne al" : ""} (Shift: daha çok)`
        : label,
      "data-key": `${kind}:${index}`,
    }, el("span", { class: "etag", text: label }), extra);
    const pick = () => ctx.select(kind, index);
    // Keyboard: Enter/Space selects, ←/→ nudges off the mark (no snapping, so small steps stay).
    node.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        pick();
      } else if (movable && !e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        e.stopPropagation(); // not a frame step of the transport
        const step = (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? NUDGE_BIG : NUDGE);
        focusKey = `${kind}:${index}`;
        ctx.place(kind, index, { mark: here.mark, dx: Math.max(-maxDx, Math.min(maxDx, (here.dx || 0) + step)) });
      } else if (kind === "cast" && !e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        // ↑ further back, ↓ to the front
        e.preventDefault();
        e.stopPropagation();
        const step = (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? BACK_STEP_BIG : BACK_STEP);
        focusKey = `${kind}:${index}`;
        ctx.place(kind, index, { mark: here.mark, dx: here.dx || 0, back: snapBack((here.back || 0) + step) });
      }
    });
    node.addEventListener("focus", () => { focusKey = `${kind}:${index}`; });
    node.addEventListener("pointerdown", (down) => {
      if (down.button !== 0) return;
      down.stopPropagation();
      const doc = ctx.doc();
      const map = doc && mapper(doc);
      const layout = ctx.layout();
      if (!movable || !map) return follow(down, { onMove: () => {}, onEnd: () => pick(), onClick: pick });
      let guides = null; // made on the first move, so a click leaves nothing behind
      const landing = (dx) => {
        const x = baseX + dx / map.perWorld;
        const at = placeAt(x, layout.marks, taken, layout.ratio);
        if (at) at.dx = Math.max(-maxDx, Math.min(maxDx, at.dx));
        // Dropped on someone else's mark: say so, they land beside it.
        const nearest = Object.keys(layout.marks).reduce((a, b) => (Math.abs(layout.marks[a] - x) <= Math.abs(layout.marks[b] - x) ? a : b));
        return at && { ...at, full: taken.has(nearest) && nearest !== at.mark ? nearest : null };
      };
      // Characters also move in depth: dragged up they go back (higher, smaller), down to the front.
      const deep = kind === "cast" && layout.backRise > 0;
      const backFor = (dy) => (deep && Math.abs(dy) >= DEPTH_START_PX
        ? snapBack((here.back || 0) - dy / (map.perWorld * layout.backRise))
        : here.back || 0);
      return follow(down, {
        onMove: (dx, dy) => {
          node.style.transform = `translate(${dx}px, ${deep ? dy : 0}px)`;
          node.classList.add("dragging");
          const at = landing(dx);
          const back = backFor(dy);
          const where = at ? `${at.mark}${at.dx ? ` ${at.dx > 0 ? "+" : ""}${at.dx}` : ""}${at.full ? ` (${at.full} dolu)` : ""}` : "boş yer yok";
          node.querySelector(".etag").textContent = `${label} · ${where}${back ? ` · derinlik ${back.toFixed(2)}` : ""}`;
          node.classList.toggle("full", !at || !!at.full);
          if (!guides) {
            guides = el("div", { class: "guides" });
            els.layer.append(guides);
          }
          guides.replaceChildren(...markGuides(map, layout, at?.mark));
        },
        onEnd: (dx, dy) => {
          guides?.remove();
          const at = landing(dx);
          if (!at) {
            ctx.say("Bu shot'ta boş işaret kalmadı: önce birini çıkar.");
            return draw();
          }
          return ctx.place(kind, index, { mark: at.mark, dx: at.dx, ...(deep ? { back: backFor(dy) } : {}) });
        },
        onClick: pick,
      });
    });
    return node;
  }

  /** The selected walker's path: an arrow on the ground, its free end draggable. */
  function walkArrow(map, layout, m, index, baseX) {
    const w = m.walk;
    const start = w.arrive ? baseX - w.dx * layout.ratio : baseX;
    const end = w.arrive ? baseX : baseX + w.dx * layout.ratio;
    const ground = layout.ground - (m.back || 0) * layout.backRise; // where this walker's feet are
    const [x1, y1] = map.at(start, ground);
    const [x2, y2] = map.at(end, ground);
    const freeX = w.arrive ? x1 : x2;
    const freeY = w.arrive ? y1 : y2;
    const vw = els.layer.clientWidth;
    const vh = els.layer.clientHeight;
    const art = svg("svg", { class: "walk", viewBox: `0 0 ${vw} ${vh}`, width: vw, height: vh, "aria-hidden": "true" },
      svg("defs", {}, svg("marker", { id: "ucok", viewBox: "0 0 10 10", refX: 7, refY: 5, markerWidth: 5, markerHeight: 5, orient: "auto" },
        svg("path", { d: "M0 0 L10 5 L0 10 Z", fill: "#f2a541" }))),
      svg("line", { x1, y1, x2, y2, stroke: "#f2a541", "stroke-width": 4, "stroke-dasharray": "10 7", "marker-end": "url(#ucok)" }));
    const handle = el("div", {
      class: "whandle", style: { left: `${freeX}px`, top: `${freeY}px` },
      title: w.arrive ? "Sürükle: nereden yürüyerek geleceği" : "Sürükle: nereye yürüyeceği",
    });
    handle.addEventListener("pointerdown", (down) => {
      if (down.button !== 0) return;
      down.stopPropagation();
      const dxFor = (dx) => {
        const x = (w.arrive ? start : end) + dx / map.perWorld;
        const d = walkDxAfterDrag(x, baseX, layout.ratio);
        return w.arrive ? -d : d;
      };
      follow(down, {
        onMove: (dx) => {
          handle.style.transform = `translate(${dx}px, 0)`;
          handle.dataset.dx = String(dxFor(dx));
          handle.textContent = `${dxFor(dx)}`;
        },
        onEnd: (dx) => ctx.setWalk(index, dxFor(dx)),
      });
    });
    return [art, handle];
  }

  function safeAreas(doc, k) {
    const vp = ctx.viewport();
    const rect = (inset, cls, text) => el("div", {
      class: `safe ${cls}`,
      style: { left: `${vp.width * inset * k}px`, top: `${vp.height * inset * k}px`, width: `${vp.width * (1 - 2 * inset) * k}px`, height: `${vp.height * (1 - 2 * inset) * k}px` },
    }, el("span", { text }));
    const out = [rect(ACTION_SAFE, "action", "hareket güvenli alanı"), rect(TITLE_SAFE, "title", "yazı güvenli alanı")];
    // The caption zone as the preview draws it: the caption on screen now, else where they sit.
    const shown = [...doc.querySelectorAll("#altyazilar .altyazi")].map((n) => boxOf(n, k)).find(Boolean);
    // With no caption on screen the container is a flat line: show where it sits.
    const line = doc.getElementById("altyazilar")?.getBoundingClientRect();
    const zone = shown || (line?.width ? { left: line.left * k, top: line.top * k - 2, width: line.width * k, height: 4 } : null);
    if (zone) out.push(el("div", { class: "safe caption", style: { left: `${zone.left}px`, top: `${zone.top}px`, width: `${zone.width}px`, height: `${Math.max(zone.height, 4)}px` } }, el("span", { text: "altyazı" })));
    return out;
  }

  function draw() {
    if (busy) return;
    // During playback nothing moves on this layer (no frames, the safe areas stay put):
    // draw once when playback starts, not on every frame.
    if (ctx.playing()) {
      if (playingDrawn) return;
      playingDrawn = true;
    } else playingDrawn = false;
    const doc = ctx.doc();
    const found = ctx.current();
    const parts = [];
    const map = doc && mapper(doc);
    if (doc && map && view.safe) parts.push(...safeAreas(doc, map.k));
    // Frames only on a still picture of the selected shot: during playback they would lag.
    if (doc && map && found && !ctx.playing() && ctx.inShot()) {
      const { shot } = found;
      const layout = ctx.layout();
      const sel = ctx.sel();
      shot.cast.forEach((m, i) => {
        if (view.hidden.has("cast")) return;
        const box = boxOf(doc.getElementById(`kar-${m.id}`), map.k);
        if (!box) return;
        const selected = sel.kind === "cast" && sel.index === i;
        const baseX = layout.marks[m.mark] + (m.dx || 0) * layout.ratio;
        const taken = new Set(shot.cast.filter((o) => o !== m).map((o) => o.mark));
        const flip = selected
          ? el("button", {
            class: "eflip", type: "button", title: "Yönünü çevir", "aria-label": "Yönünü çevir", text: "⇆",
            on: { pointerdown: (e) => e.stopPropagation(), click: (e) => { e.stopPropagation(); ctx.flip(i); } },
          })
          : null;
        parts.push(frame({ box, label: ctx.labelOf(m.id), selected, kind: "cast", index: i, baseX, here: m, taken, movable: true, extra: [flip] }));
        if (selected && m.walk) parts.push(...walkArrow(map, layout, m, i, baseX));
      });
      (shot.props || []).forEach((p, i) => {
        if (view.hidden.has("props")) return;
        const node = doc.getElementById(`prop-${shot.shot_id}-${p.id}-yer`);
        const held = doc.getElementById(`prop-${shot.shot_id}-${p.id}-el`);
        const box = boxOf(node, map.k) || boxOf(held, map.k);
        if (!box) return;
        const movable = !!p.mark && !p.depth && !boxOf(held, map.k);
        const baseX = p.mark ? layout.marks[p.mark] + (p.dx || 0) * layout.ratio : 0;
        parts.push(frame({
          box, label: p.id, selected: sel.kind === "prop" && sel.index === i, kind: "prop", index: i, baseX, here: p,
          taken: new Set(), movable,
        }));
      });
    }
    // Keep keyboard focus on the frame being nudged, also across the redraws of a reloading preview.
    const keep = focusKey && (els.layer.contains(document.activeElement) || document.activeElement === document.body);
    els.layer.replaceChildren(...parts);
    if (keep) els.layer.querySelector(`[data-key="${focusKey}"]`)?.focus();
  }

  /** Show or hide layers of the preview (the episode does not change). */
  function applyLayers(doc = ctx.doc()) {
    if (!doc) return;
    // A stylesheet, not inline styles: the player sets the elements' own display every frame.
    let sheet = doc.getElementById("panel-katmanlar");
    if (!sheet) {
      sheet = doc.createElement("style");
      sheet.id = "panel-katmanlar";
      doc.head.append(sheet);
    }
    sheet.textContent = [...view.hidden].map((key) => `${LAYER_SELECTORS[key]} { visibility: hidden !important; }`).join("\n");
  }

  // A click on the empty stage clears the row selection (the shot stays selected).
  els.layer.addEventListener("pointerdown", (e) => {
    if (e.target !== els.layer) return;
    focusKey = null;
    if (ctx.sel().kind) ctx.select(null);
  });
  // Focus moved somewhere else on purpose: stop handing it back to a frame.
  document.addEventListener("focusin", (e) => { if (!els.layer.contains(e.target)) focusKey = null; });

  return {
    draw,
    applyLayers,
    setSafe(on) {
      view.safe = on;
      playingDrawn = false;
      draw();
    },
    setLayer(key, shown) {
      if (shown) view.hidden.delete(key);
      else view.hidden.add(key);
      applyLayers();
      playingDrawn = false;
      draw();
    },
  };
}
