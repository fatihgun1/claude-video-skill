// Timeline: a time ruler and three tracks under the stage.
//   Shot:   one block per shot, as wide as it lasts. Drag the right edge to change hold
//           (never shorter than its lines); drag the block to reorder it within its scene.
//   Replik: the lines where they are spoken (read-only: they come from the script).
//   Altyazı: each line's caption; a click turns it on or off.
//   Efekt:  the sound effects; drag one sideways to change its time in the shot.
// The draft's order lays the blocks out; the last compiled preview gives the lengths.
import { el, svg } from "./dom.js";
import { musicGain } from "./muzik.mjs";
import { speakerColor, captionShown } from "./altyazi.mjs";
import { MAX_HOLD, shotLength, minShotLength, holdForLength, sfxAtAfterDrag, reorderAt, segmentSpans } from "./kurgu.js";

const PX = 80; // pixels per second
const DRAG_START_PX = 5;
const EDGE_PX = 48; // a drag this close to the timeline's left or right edge scrolls it
const EDGE_STEP_PX = 14; // how far each frame of that scrolls
const FX_MIN_PX = 64;
const ROW = { ruler: 30, shots: 64, actor: 26, lines: 30, captions: 26, fx: 50, music: 34 }; // track heights (px)
const MAX_DELAY = 5; // schema limit of utterance.delay
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/**
 * @param {{ruler:HTMLElement, tracks:HTMLElement, scroll:HTMLElement, info:HTMLElement}} els
 * @param {{shots:() => {shot:object, scene:object}[], selected:() => string|null, sel:() => {kind:string|null, index:number},
 *          choose:(id:string) => void, select:(kind:string|null, index?:number) => void,
 *          problems:() => Map<string, {errors:number, warnings:number}>, framingLabel:(id:string) => string,
 *          labelOf:(id:string) => string, sfxInfo:(id:string) => {label:string, duration:number}|null,
 *          timing:() => {shots:object[], rules:object, duration:number}|null, now:() => number, seek:(t:number) => void,
 *          setHold:(shot:object, hold:number) => void, setSfxAt:(shot:object, index:number, at:number) => void,
 *          moveShot:(id:string, index:number) => void}} ctx
 */
export function createTimeline(els, ctx) {
  let places = []; // the shots on show: {shot, scene, start (from the view's origin), len, t (compiled timing or null)}
  let all = []; // every shot of the episode, start from the film's start
  let filmLen = 0;
  let origin = 0; // film time at the left edge: the scene's start in scene view, else 0
  let view = "sahne"; // "sahne": only the selected shot's scene · "bolum": the whole episode
  let playhead = null;
  let dragging = false;
  let redrawLater = false;
  // the same colour the captions use (characters[].renk, else by place in the cast)
  const colorOf = (id) => speakerColor(ctx.episode(), id);

  /**
   * Lay the draft's shots end to end. A compiled shot's length follows its current hold at
   * once (so a second drag starts from the first one's result); a shot not compiled yet
   * gets a rough length.
   */
  function layout() {
    const timing = ctx.timing();
    const byId = new Map((timing?.shots || []).map((t) => [t.shot_id, t]));
    let clock = 0;
    all = ctx.shots().map(({ shot, scene }) => {
      const t = byId.get(shot.shot_id) || null;
      const len = t ? shotLength(t, shot, timing.rules) : 0.8 + (shot.hold ?? 1.5) + 2 * (shot.utterances?.length || 0);
      const p = { shot, scene, start: clock, len, t };
      clock += len;
      return p;
    });
    filmLen = clock;
    const scene = view === "sahne" ? all.find((p) => p.shot.shot_id === ctx.selected())?.scene : null;
    if (!scene) {
      origin = 0;
      places = all;
      return clock;
    }
    const mine = all.filter((p) => p.scene === scene);
    origin = mine[0].start;
    places = mine.map((p) => ({ ...p, start: p.start - origin }));
    return mine.reduce((n, p) => n + p.len, 0);
  }

  /** The scene on show in scene view, or null for the whole episode. */
  const shownScene = () => (places !== all ? places[0]?.scene || null : null);

  /**
   * Follow the pointer from a pointerdown until release; onMove gets the x distance in timeline
   * pixels. Near the timeline's edge it scrolls on its own, and the distance counts the scroll.
   */
  function follow(down, { onMove, onEnd, onClick }) {
    const target = down.currentTarget;
    const x0 = down.clientX;
    const scroll0 = els.scroll.scrollLeft;
    const dxOf = (clientX) => clientX - x0 + els.scroll.scrollLeft - scroll0;
    let moved = false;
    let last = null; // the latest move, for the edge scroll
    let frame = 0;
    const edgeScroll = () => {
      frame = 0;
      if (!last) return;
      const box = els.scroll.getBoundingClientRect();
      const step = last.clientX < box.left + EDGE_PX ? -EDGE_STEP_PX : last.clientX > box.right - EDGE_PX ? EDGE_STEP_PX : 0;
      const before = els.scroll.scrollLeft;
      els.scroll.scrollLeft += step;
      if (els.scroll.scrollLeft === before) return; // not near an edge, or at the end already
      onMove(dxOf(last.clientX), last);
      frame = requestAnimationFrame(edgeScroll);
    };
    try {
      target.setPointerCapture(down.pointerId);
    } catch {
      /* the pointer is already gone; the events below still end the drag */
    }
    dragging = true; // a preview arriving now must not redraw the block being dragged
    const move = (e) => {
      if (!moved && Math.abs(e.clientX - x0) < DRAG_START_PX) return;
      moved = true;
      last = e;
      onMove(dxOf(e.clientX), e);
      if (!frame) frame = requestAnimationFrame(edgeScroll);
    };
    const up = (e) => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      target.removeEventListener("lostpointercapture", up);
      cancelAnimationFrame(frame);
      last = null;
      dragging = false;
      if (moved && e.type === "pointerup") onEnd(dxOf(e.clientX), e);
      else if (moved) onEnd(null, e);
      else if (e.type === "pointerup") onClick?.(e);
      if (redrawLater) render();
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
    target.addEventListener("lostpointercapture", up);
  }

  function holdGrip(p, block, label) {
    const grip = el("span", { class: "grip", title: "Sürükle: bekleme süresi", "aria-hidden": "true" });
    if (!p.t) return grip; // not compiled yet: the speech length is unknown
    const rules = ctx.timing().rules;
    const speech = p.t.speech_end - p.t.start;
    // never so short that an effect or a listed action would start after the end
    const starts = [...(p.shot.sfx || []), ...p.shot.cast.flatMap((m) => m.actions || [])];
    const minLen = minShotLength(speech, rules, starts);
    const maxLen = speech + MAX_HOLD + rules.tail;
    const holdFor = (len) => holdForLength(len, speech, rules);
    grip.addEventListener("pointerdown", (down) => {
      down.stopPropagation();
      down.preventDefault();
      follow(down, {
        onMove: (dx) => {
          const len = clamp(p.len + dx / PX, minLen, maxLen);
          block.style.width = `${len * PX - 2}px`;
          block.classList.add("resizing");
          label.textContent = `bekleme ${holdFor(len).toFixed(2)} s`;
        },
        onEnd: (dx) => {
          block.classList.remove("resizing");
          if (dx === null) return render();
          return ctx.setHold(p.shot, holdFor(clamp(p.len + dx / PX, minLen, maxLen)));
        },
      });
    });
    return grip;
  }

  /**
   * Drag a shot block sideways to a new place among the shots of its own scene: it goes where
   * the pointer is, and a line between two shots shows where before the button is let go.
   */
  function reorder(down, p, block) {
    const siblings = places.filter((q) => q.scene === p.scene);
    const from = siblings.indexOf(p);
    const mark = el("div", { class: "drop-mark", hidden: true, "aria-hidden": "true" });
    const target = (e) => reorderAt(siblings, from, (e.clientX - els.tracks.getBoundingClientRect().left) / PX);
    follow(down, {
      onMove: (dx, e) => {
        block.classList.add("dragging");
        block.style.transform = `translateX(${dx}px)`;
        const to = target(e);
        if (!mark.isConnected) block.parentElement.append(mark);
        mark.hidden = to.index === from;
        mark.style.left = `${to.at * PX}px`;
      },
      onEnd: (dx, e) => {
        block.classList.remove("dragging");
        block.style.transform = "";
        mark.remove();
        if (dx === null) return;
        const to = target(e);
        if (to.index !== from) ctx.moveShot(p.shot.shot_id, to.index);
      },
      onClick: () => ctx.choose(p.shot.shot_id),
    });
  }

  function shotBlock(p, problems) {
    const id = p.shot.shot_id;
    const pr = problems.get(id);
    const selected = id === ctx.selected();
    const sub = el("span", { text: `${ctx.framingLabel(p.shot.camera.framing)} · ${p.t ? `${p.len.toFixed(1)} s` : "?"}` });
    const block = el("div", {
      class: `shot${selected ? " sel" : ""}${p.t ? "" : " stale"}`,
      role: "button", tabindex: "0", "aria-pressed": String(selected),
      title: `${id}${p.shot.notes ? ` — ${p.shot.notes}` : ""}\nSürükle: sırasını değiştir · sağ kenarı sürükle: bekleme`,
      style: { left: `${p.start * PX}px`, width: `${p.len * PX - 2}px`, backgroundImage: `url("/kutuphane/mekan/${p.scene.bg}.svg")` },
      on: {
        pointerdown: (e) => { if (e.button === 0) reorder(e, p, block); },
        keydown: (e) => { if (e.key === "Enter") ctx.choose(id); },
      },
    },
    el("span", { class: "lab" }, el("b", { text: id }), sub),
    pr?.errors ? el("span", { class: "bad", title: `${pr.errors} hata`, text: `${pr.errors}!` })
      : pr?.warnings ? el("span", { class: "warnb", title: `${pr.warnings} uyarı`, text: `${pr.warnings}` }) : null);
    block.append(holdGrip(p, block, sub));
    return block;
  }

  /**
   * Each line's caption under it: its text is the line itself. A click turns that caption on or
   * off (utterance.altyazi); with the episode's captions off every block is off and says so.
   */
  function captionBlocks(p) {
    if (!p.t) return [];
    const ep = ctx.episode();
    const allOff = !!ep.altyazi?.kapali;
    return p.t.utterances.map((u, i) => {
      const line = p.shot.utterances?.[i];
      const shown = captionShown(ep, line);
      const left = (p.start + u.start - p.t.start) * PX;
      return el("button", {
        type: "button",
        class: `clip caption-clip${shown ? "" : " off"}`,
        style: { left: `${left}px`, width: `${Math.max(6, (u.end - u.start) * PX - 2)}px`, "--c": colorOf(u.speaker) },
        title: allOff ? "Bölümün altyazıları kapalı (denetleyicide Altyazı)" : `Altyazı ${shown ? "açık" : "kapalı"}: “${u.text}” · tıkla: ${shown ? "kapat" : "aç"}`,
        "aria-pressed": String(shown),
        disabled: allOff,
        on: { click: () => ctx.setCaption(p.shot, i, !shown) },
      }, el("span", { text: shown ? u.text : "altyazı yok" }));
    });
  }

  /**
   * The lines where they are spoken. Their words come from the script; dragging one sideways
   * only changes the pause before it (utterance.delay), never earlier than without a pause.
   */
  function lineBlocks(p) {
    if (!p.t) return [];
    const sel = ctx.sel();
    return p.t.utterances.map((u, i) => {
      const line = p.shot.utterances?.[i];
      const delay = line?.delay || 0;
      const on = ctx.selected() === p.shot.shot_id && sel.kind === "line" && sel.index === i;
      const left = (p.start + u.start - p.t.start) * PX;
      const label = el("span", { text: `${ctx.labelOf(u.speaker)}: ${u.text}` });
      const clip = el("div", {
        class: `clip line-clip${on ? " sel" : ""}${ctx.lineFailed(p.shot.shot_id, i) ? " failed" : ""}`,
        title: `${ctx.labelOf(u.speaker)}: “${u.text}” · sürükle: önündeki bekleme (${delay.toFixed(2)} s) · sözler senaryodan gelir`,
        style: { left: `${left}px`, width: `${Math.max(6, (u.end - u.start) * PX - 2)}px`, "--c": colorOf(u.speaker) },
      }, label);
      const delayFor = (dx) => Math.min(MAX_DELAY, Math.max(0, Math.round((delay + dx / PX) / 0.05) * 0.05));
      clip.addEventListener("pointerdown", (down) => {
        if (down.button !== 0) return;
        follow(down, {
          onMove: (dx) => {
            const d = delayFor(dx);
            clip.style.left = `${left + (d - delay) * PX}px`;
            clip.classList.add("dragging");
            label.textContent = `bekleme ${d.toFixed(2)} s`;
          },
          onEnd: (dx) => (dx === null ? render() : ctx.setDelay(p.shot, i, Math.round(delayFor(dx) * 100) / 100)),
          onClick: () => ctx.selectLine(p.shot.shot_id, i),
        });
      });
      return clip;
    });
  }

  /** The music under the whole film, drawn as its loudness: fades, and the dips under the lines. */
  function musicRow(total) {
    const music = ctx.music();
    if (!music) {
      return [el("div", { class: "music-none", text: "Müzik yok · Ses sekmesinden bir parça seç" })];
    }
    // the curve is the whole film's (fades at its ends, dips under every line); a scene shows its stretch of it
    const speech = all.flatMap((p) => (p.t ? p.t.utterances.map((u) => ({ start: p.start + u.start - p.t.start, end: p.start + u.end - p.t.start })) : []));
    const w = Math.max(1, total * PX);
    const h = ROW.music - 6;
    const steps = Math.max(2, Math.ceil(total * 10));
    const pts = [];
    for (let k = 0; k <= steps; k++) {
      const t = (k / steps) * total;
      pts.push(`${(t * PX).toFixed(1)},${(h - musicGain(origin + t, filmLen, music, speech) * h).toFixed(1)}`);
    }
    const sel = ctx.sel().kind === "mix";
    return [el("div", {
      class: `clip music-clip${sel ? " sel" : ""}`, style: { left: "0px", width: `${w - 2}px` },
      title: `${music.track} · ses düzeyi, giriş/çıkış ve konuşmada kısılma · tıkla: mikser`,
      on: { click: () => ctx.select("mix") },
    },
    svg("svg", { class: "env", width: w, height: h, viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: "none", "aria-hidden": "true" },
      svg("polygon", { points: `0,${h} ${pts.join(" ")} ${w},${h}`, fill: "rgba(201,161,79,.35)", stroke: "#c9a14f", "stroke-width": 1.5 })),
    el("span", { text: music.track }))];
  }

  /** A track name with mute (M) and solo (S) for listening. */
  function trackLabel(text, track) {
    const st = ctx.trackState(track);
    const btn = (key, on, title) => el("button", {
      class: `ms${on ? " on" : ""}`, type: "button", title, "aria-pressed": String(on), text: key,
      on: { click: () => { ctx.setTrack(track, key === "M" ? { mute: !on } : { solo: !on }); render(); } },
    });
    return el("span", { class: "track-lab" }, el("span", { text }), btn("M", st.mute, `${text}: sessize al`), btn("S", st.solo, `${text}: yalnız bunu dinle`));
  }

  function sfxBlocks(p) {
    const sel = ctx.sel();
    const lanes = [];
    return (p.shot.sfx || []).map((s, i) => {
      const info = ctx.sfxInfo(s.sfx);
      const len = info?.duration || 0.3;
      const shown = Math.max(len, FX_MIN_PX / PX); // wide enough for its name; the real length is the dark bar
      const start = p.start + s.at;
      let lane = lanes.findIndex((end) => end <= start);
      if (lane === -1) lane = lanes.length;
      lanes[lane] = start + shown;
      const on = ctx.selected() === p.shot.shot_id && sel.kind === "sfx" && sel.index === i;
      const label = el("span", { text: `${info?.label || s.sfx} · ${s.at.toFixed(2)} s` });
      const clip = el("div", {
        class: `clip fx-clip${on ? " sel" : ""}`,
        title: `${info?.label || s.sfx} — sürükle: zamanı`,
        style: { left: `${start * PX}px`, width: `${shown * PX - 2}px`, top: `${4 + (lane % 2) * 22}px` },
      }, el("i", { class: "dur", style: { width: `${len * PX}px` } }), label);
      clip.addEventListener("pointerdown", (down) => {
        if (down.button !== 0) return;
        const atFor = (dx) => sfxAtAfterDrag(s.at, dx / PX, p.len);
        if (!p.t) { // not compiled yet: the shot's real length, and so the limit, is unknown
          ctx.choose(p.shot.shot_id);
          ctx.select("sfx", i);
          return;
        }
        follow(down, {
          onMove: (dx) => {
            clip.classList.add("dragging");
            clip.style.left = `${(p.start + atFor(dx)) * PX}px`;
            label.textContent = `${info?.label || s.sfx} · ${atFor(dx).toFixed(2)} s`;
          },
          onEnd: (dx) => (dx === null ? render() : ctx.setSfxAt(p.shot, i, atFor(dx))),
          onClick: () => {
            ctx.choose(p.shot.shot_id);
            ctx.select("sfx", i);
          },
        });
      });
      return clip;
    });
  }

  /**
   * One character's actions in one shot: a clip per action from its start to the next one.
   * A one-off action shorter than its clip holds its last pose: the dark bar is the action.
   * Drag a clip's left edge to change when it starts; the first one's too (a standing action
 * then fills the time before it). A walk starts with the shot, so its first clip has no edge.
   */
  function actionClips(p, characterId) {
    const ci = p.shot.cast.findIndex((m) => m.id === characterId);
    if (ci === -1) return [];
    const m = p.shot.cast[ci];
    const sel = ctx.sel();
    return segmentSpans(m, p.len).map((s) => {
      const info = ctx.actionInfo(s.action);
      const span = Math.max(0, s.end - s.start);
      const plays = info && !info.loop ? Math.min(span, Math.max(0, info.duration - s.from)) : span;
      const on = ctx.selected() === p.shot.shot_id && sel.kind === "cast" && sel.index === ci && (sel.seg ?? 0) === s.index;
      const label = el("span", { text: `${info?.label || s.action}${info?.loop ? " ↻" : ""}` });
      const clip = el("div", {
        class: `clip act-clip${on ? " sel" : ""}`,
        title: `${ctx.labelOf(m.id)}: ${info?.label || s.action} · ${s.start.toFixed(2)}–${s.end.toFixed(2)} s${s.index || !m.walk ? " · sol kenarı sürükle: başlangıcı" : ""}`,
        style: { left: `${(p.start + s.start) * PX}px`, width: `${Math.max(6, span * PX - 2)}px` },
        on: { click: () => ctx.selectSegment(p.shot.shot_id, ci, s.index) },
      }, el("i", { class: "dur", style: { width: `${plays * PX}px` } }), label);
      if (p.t && (s.index > 0 || !m.walk)) {
        const grip = el("span", { class: "lgrip", title: "Sürükle: bu hareketin başladığı an" });
        grip.addEventListener("pointerdown", (down) => {
          if (down.button !== 0) return;
          down.stopPropagation();
          down.preventDefault();
          follow(down, {
            onMove: (dx) => {
              const at = Math.max(0, s.start + dx / PX);
              clip.style.left = `${(p.start + at) * PX}px`;
              clip.style.width = `${Math.max(6, (s.end - at) * PX - 2)}px`;
              label.textContent = `${info?.label || s.action} · ${at.toFixed(2)} s`;
            },
            onEnd: (dx) => {
              if (dx === null) return render();
              if (s.index > 0) return ctx.moveSegment(p.shot, ci, s.index, s.start + dx / PX, p.len);
              if (!ctx.delayFirst(p.shot, ci, dx / PX, p.len)) render(); // refused: draw it back where it was
            },
          });
        });
        clip.append(grip);
      }
      return clip;
    });
  }

  function ruler(total) {
    const ticks = [];
    // film seconds, so a scene's ruler reads the same times as the stage clock
    for (let s = Math.ceil(origin - 1e-9); s <= origin + total; s++) {
      ticks.push(el("span", { class: s % 5 === 0 ? "tick major" : "tick", style: { left: `${(s - origin) * PX}px` } }, `${s}`));
    }
    // Where each scene starts: shots move only within their scene, and a scene keeps one shot.
    const scenes = places.filter((p, i) => i === 0 || places[i - 1].scene !== p.scene);
    const marks = scenes.map((p) => el("span", {
      class: "scene-mark", style: { left: `${p.start * PX}px` }, title: `sahne ${p.scene.scene_id} · ${p.scene.bg}`,
    }, `sahne ${p.scene.scene_id}`));
    return [...ticks, ...marks];
  }

  function seekAt(e) {
    const box = els.tracks.getBoundingClientRect();
    ctx.seek(Math.max(0, origin + (e.clientX - box.left) / PX));
  }

  function render() {
    if (dragging) {
      redrawLater = true;
      return;
    }
    redrawLater = false;
    const total = layout();
    const problems = ctx.problems();
    const width = `${Math.max(total * PX + 120, els.scroll.clientWidth)}px`;
    els.ruler.style.width = width;
    els.tracks.style.width = width;
    els.ruler.replaceChildren(...ruler(total));
    const row = (cls, kids) => el("div", { class: `track ${cls}` }, kids);
    playhead = el("div", { class: "playhead" });
    // One track per character who acts anywhere in the episode.
    const actors = ctx.characters().filter((c) => places.some((p) => p.shot.cast.some((m) => m.id === c.id)));
    const rows = [ROW.shots, ...actors.map(() => ROW.actor), ROW.lines, ROW.captions, ROW.fx, ROW.music];
    els.tracks.style.gridTemplateRows = rows.map((h) => `${h}px`).join(" ");
    els.labels.style.gridTemplateRows = [ROW.ruler, ...rows].map((h) => `${h}px`).join(" ");
    els.labels.replaceChildren(
      el("span"), el("span", { text: "Shot" }),
      ...actors.map((c) => el("span", { class: "actor-lab", title: c.label, text: c.label })),
      trackLabel("Replik", "lines"), el("span", { text: "Altyazı" }), trackLabel("Efekt", "sfx"), trackLabel("Müzik", "music"),
    );
    els.tracks.replaceChildren(
      row("t-shots", places.map((p) => shotBlock(p, problems))),
      ...actors.map((c) => row("t-actor", places.flatMap((p) => actionClips(p, c.id)))),
      row("t-lines", places.flatMap(lineBlocks)),
      row("t-captions", places.flatMap(captionBlocks)),
      row("t-fx", places.flatMap(sfxBlocks)),
      row("t-music", musicRow(total)),
      playhead,
    );
    const rough = places.some((p) => !p.t); // a shot not compiled yet: its length is a guess
    const scene = shownScene();
    els.info.textContent = `${scene ? `${scene.title || `sahne ${scene.scene_id}`} · ` : ""}${places.length} shot · ${rough ? "≈" : ""}${(Math.round(total * 100) / 100).toFixed(1)} s`;
    els.labels.scrollTop = els.scroll.scrollTop; // a redraw may change how far the tracks can scroll
    place(ctx.now());
  }

  /** Move the playhead; while playing, keep it in view. In scene view it hides outside the scene. */
  function place(t, follow = false) {
    if (!playhead) return;
    const x = (t - origin) * PX;
    const total = places.reduce((n, p) => n + p.len, 0);
    playhead.style.display = x < 0 || x > total * PX + 1 ? "none" : ""; // (a CSS display would beat [hidden])
    playhead.style.left = `${x}px`;
    if (follow) {
      const { scrollLeft, clientWidth } = els.scroll;
      if (x < scrollLeft || x > scrollLeft + clientWidth - 40) els.scroll.scrollLeft = Math.max(0, x - 80);
    }
  }

  // Click or drag on the ruler (or empty track space) to move the playhead.
  els.ruler.addEventListener("pointerdown", (down) => {
    if (down.button !== 0) return;
    seekAt(down);
    try {
      els.ruler.setPointerCapture(down.pointerId);
    } catch {
      /* pointer already gone */
    }
    const move = (e) => seekAt(e);
    const end = () => {
      els.ruler.removeEventListener("pointermove", move);
      for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) els.ruler.removeEventListener(ev, end);
    };
    els.ruler.addEventListener("pointermove", move);
    for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) els.ruler.addEventListener(ev, end);
  });
  els.tracks.addEventListener("click", (e) => { if (e.target.classList.contains("track")) seekAt(e); });
  // the names column scrolls up and down with the tracks
  els.scroll.addEventListener("scroll", () => { els.labels.scrollTop = els.scroll.scrollTop; });

  return {
    render,
    place,
    view: () => view,
    setView(v) {
      view = v;
      els.scroll.scrollLeft = 0;
      render();
    },
  };
}
