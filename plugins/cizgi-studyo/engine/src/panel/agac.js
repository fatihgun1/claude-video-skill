// The project tree in the left pane, like a video editor's project panel:
//   Bölümler (every bolum.json in the folder) > the open episode's scenes > their shots.
// A shot row selects the shot; dragging it onto another scene or shot moves it there
// (Alt+↑/↓ does the same from the keyboard). The selected scene can be named, moved,
// deleted, and a new scene added after it. Every change goes through the app's edit cycle.
// The tree is rebuilt on every render; the focused control is found again by its data-focus key.
import { el } from "./dom.js";
import { addSceneAfter, deleteScene, moveScene, moveShotToScene, setSceneTitle, SCENE_TITLE_MAX } from "./kurgu.js";

const DRAG_TYPE = "application/x-cizgi-shot";

/**
 * @param {HTMLElement} root
 * @param {{episode:() => object|null, path:() => string|null, selected:() => string|null,
 *          choose:(shotId:string) => void, problems:() => Map<string, {errors:number, warnings:number}>,
 *          timing:() => {shots:{shot_id:string, start:number, end:number}[]}|null,
 *          framingLabel:(id:string) => string, vocab:() => object, viewOf:(characterId:string) => string,
 *          changed:(selectShot:string|null, note?:string) => void, say:(text:string) => void,
 *          api:(path:string) => Promise<any>, openEpisode:(rel:string) => void, review:(scene:object) => void}} ctx
 *   changed(null) keeps the current selection.
 */
export function createTree(root, ctx) {
  let episodes = null; // the folder's episodes, from /api/bolumler
  let error = "";
  let renaming = null; // scene_id whose name is being typed
  let dragging = false; // a shot row is being dragged: a redraw now would drop the drag
  let redrawLater = false;
  let pointerDown = false;
  const collapsed = new Set(); // scene ids folded away (view only)
  window.addEventListener("pointerdown", () => { pointerDown = true; }, true);
  window.addEventListener("pointerup", () => { pointerDown = false; }, true);

  const sceneOf = (shotId) => ctx.episode()?.scenes.find((s) => s.shots.some((x) => x.shot_id === shotId)) || null;
  const lengths = () => new Map((ctx.timing()?.shots || []).map((t) => [t.shot_id, t.end - t.start]));
  const sceneName = (s) => s.title || `Sahne ${s.scene_id}`;

  async function refresh() {
    try {
      episodes = (await ctx.api("/api/bolumler")).episodes;
      error = "";
    } catch (err) {
      error = `Bölümler alınamadı: ${err.message}`;
    }
    render();
  }

  /* ---------- scene operations ---------- */
  function addScene() {
    const ep = ctx.episode();
    const after = sceneOf(ctx.selected()) || ep.scenes.at(-1);
    const scene = addSceneAfter(ep, after, ctx.vocab(), ctx.viewOf);
    collapsed.delete(scene.scene_id);
    ctx.changed(scene.shots[0].shot_id, `${sceneName(scene)} eklendi`);
  }
  function removeScene(scene) {
    const next = deleteScene(ctx.episode(), scene);
    if (!next) return ctx.say("Bölümün tek sahnesi silinemez.");
    return ctx.changed(next, `${sceneName(scene)} ve ${scene.shots.length} shot'ı silindi · geri almak için Ctrl+Z`);
  }
  function shiftScene(scene, dir) {
    const ep = ctx.episode();
    if (moveScene(ep, scene.scene_id, ep.scenes.indexOf(scene) + dir)) ctx.changed(null);
  }
  function rename(scene, text) {
    renaming = null;
    const before = scene.title;
    setSceneTitle(scene, text);
    if (scene.title !== before) ctx.changed(null);
    else render();
  }
  /** Move a shot to `index` in `scene`; the scene it lands in opens so the shot stays in sight. */
  function moveShot(shotId, scene, index) {
    const from = sceneOf(shotId);
    if (!from) return;
    if (from !== scene && from.shots.length <= 1) return ctx.say("Sahnenin tek shot'ı başka sahneye taşınamaz.");
    if (moveShotToScene(ctx.episode(), shotId, scene, index)) {
      collapsed.delete(scene.scene_id);
      ctx.changed(shotId, from === scene ? "" : `${shotId} → ${sceneName(scene)} (mekânı: ${scene.bg})`);
    }
  }
  /** Alt+↑/↓: one place up or down; past a scene's edge, into the next scene. */
  function moveShotBy(shotId, dir) {
    const ep = ctx.episode();
    const scene = sceneOf(shotId);
    const i = scene.shots.findIndex((x) => x.shot_id === shotId);
    const j = i + dir;
    if (j >= 0 && j < scene.shots.length) return moveShot(shotId, scene, j);
    const next = ep.scenes[ep.scenes.indexOf(scene) + dir];
    if (next) moveShot(shotId, next, dir < 0 ? next.shots.length : 0);
    return undefined;
  }

  /* ---------- drag a shot row onto a scene or a shot ---------- */
  function dropTarget(node, scene, index) {
    node.addEventListener("dragover", (e) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      node.classList.add("drop");
    });
    node.addEventListener("dragleave", () => node.classList.remove("drop"));
    node.addEventListener("drop", (e) => {
      node.classList.remove("drop");
      const id = e.dataTransfer.getData(DRAG_TYPE);
      if (!id) return;
      e.preventDefault();
      dragging = false;
      // dropping on a shot puts the dragged one in its place; on the scene, at the scene's end
      const from = sceneOf(id);
      const at = index === null ? scene.shots.length - (from === scene ? 1 : 0) : index;
      moveShot(id, scene, at);
    });
  }

  /* ---------- rows ---------- */
  function shotRow(shot, scene, i, len, problem) {
    const id = shot.shot_id;
    const on = id === ctx.selected();
    const badge = problem?.errors ? el("span", { class: "bad", title: `${problem.errors} hata`, text: `${problem.errors}!` })
      : problem?.warnings ? el("span", { class: "warnb", title: `${problem.warnings} uyarı`, text: `${problem.warnings}` }) : null;
    // a div, not a <button>: Firefox does not start a drag from a button
    const row = el("div", {
      role: "button", tabindex: "0", class: `trow shot-row${on ? " sel" : ""}`, draggable: "true",
      "aria-current": on ? "true" : null, "data-shot": id, "data-focus": `shot:${id}`,
      title: `${id}${shot.notes ? ` — ${shot.notes}` : ""}\nSürükle ya da Alt+↑/↓: başka yere, başka sahneye taşı`,
      on: {
        click: () => ctx.choose(id),
        dragstart: (e) => {
          e.dataTransfer.setData(DRAG_TYPE, id);
          e.dataTransfer.effectAllowed = "move";
          row.classList.add("dragging");
          dragging = true;
        },
        dragend: () => {
          row.classList.remove("dragging");
          dragging = false;
          if (redrawLater) render();
        },
        keydown: (e) => {
          if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
            e.preventDefault();
            e.stopPropagation();
            if (!e.repeat) moveShotBy(id, e.key === "ArrowUp" ? -1 : 1);
          } else if (e.key === "Enter" || (e.key === " " && !e.repeat)) {
            e.preventDefault();
            e.stopPropagation(); // Space selects here; it must not also play the preview
            ctx.choose(id);
          }
        },
      },
    },
    el("b", { text: id }),
    el("span", { class: "grow muted", text: ctx.framingLabel(shot.camera.framing) }),
    badge,
    el("span", { class: "len", text: len === undefined ? "?" : `${len.toFixed(1)} s` }));
    dropTarget(row, scene, i);
    return row;
  }

  function sceneTools(scene, index, count) {
    const key = (k) => `${k}:${scene.scene_id}`;
    return el("div", { class: "scene-tools" },
      el("button", { class: "btn small primary", type: "button", "data-focus": key("incele"), title: "Sahneyi denetle: kurallar, kareler, Claude'a incelet", text: "İncele", on: { click: () => ctx.review(scene) } }),
      el("button", { class: "btn small", type: "button", "data-focus": key("ad"), title: "Sahneye ad ver (filmde görünmez)", text: "Adlandır", on: { click: () => { renaming = scene.scene_id; render(); } } }),
      el("button", { class: "btn small icon-s", type: "button", "data-focus": key("yukari"), title: "Sahneyi yukarı taşı", "aria-label": "Sahneyi yukarı taşı", disabled: index === 0, text: "↑", on: { click: () => shiftScene(scene, -1) } }),
      el("button", { class: "btn small icon-s", type: "button", "data-focus": key("asagi"), title: "Sahneyi aşağı taşı", "aria-label": "Sahneyi aşağı taşı", disabled: index === count - 1, text: "↓", on: { click: () => shiftScene(scene, 1) } }),
      el("button", {
        class: "btn small danger", type: "button", disabled: count <= 1, text: "Sil",
        title: count <= 1 ? "Bölümün tek sahnesi silinemez" : "Sahneyi bütün shot'larıyla sil", on: { click: () => removeScene(scene) },
      }));
  }

  function nameBox(scene) {
    const box = el("input", { type: "text", class: "scene-name", value: scene.title || "", maxlength: String(SCENE_TITLE_MAX), placeholder: `Sahne ${scene.scene_id}`, "aria-label": "Sahne adı" });
    let done = false;
    const commit = (keep) => {
      if (done) return;
      done = true;
      if (keep) rename(scene, box.value);
      else { renaming = null; render(); }
    };
    box.addEventListener("keydown", (e) => {
      if (e.key === "Enter") commit(true);
      else if (e.key === "Escape") commit(false);
      // typing here must not play the preview or delete a shot; Ctrl/⌘ keys (save, undo) still reach the app
      if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
    });
    box.addEventListener("blur", () => {
      if (done) return undefined;
      if (!pointerDown) return commit(true);
      // A click elsewhere blurs the box on pointerdown; redrawing the tree then would remove the
      // button under the pointer and swallow its click. So the name is kept now and saved once the
      // click has landed, and the box is closed at once: a redraw caused by that click must not
      // open a fresh box over the old name (whose blur would save the old name back).
      const value = box.value;
      renaming = null;
      const finish = () => {
        if (done) return;
        done = true;
        rename(scene, value);
      };
      window.addEventListener("pointerup", () => setTimeout(finish, 0), { once: true });
      setTimeout(finish, 1500); // released outside the window: the name is still kept
      return undefined;
    });
    queueMicrotask(() => { box.focus(); box.select(); });
    return box;
  }

  function sceneBlock(scene, index, count, lens, problems) {
    const open = !collapsed.has(scene.scene_id);
    const here = scene.shots.some((x) => x.shot_id === ctx.selected());
    const known = scene.shots.map((x) => lens.get(x.shot_id));
    // summed in hundredths, as the timeline does, so both say the same length
    const total = known.every((x) => x !== undefined) ? `${(Math.round(known.reduce((a, b) => a + b, 0) * 100) / 100).toFixed(1)} s` : "≈";
    const errs = scene.shots.reduce((n, x) => n + (problems.get(x.shot_id)?.errors || 0), 0);
    const head = el("div", { class: `scene-head${here ? " here" : ""}` },
      el("button", {
        type: "button", class: "fold", "data-focus": `fold:${scene.scene_id}`, "aria-expanded": String(open), "aria-label": open ? "Sahneyi kapat" : "Sahneyi aç", text: open ? "▾" : "▸",
        on: { click: () => { if (open) collapsed.add(scene.scene_id); else collapsed.delete(scene.scene_id); render(); } },
      }),
      el("img", { class: "sthumb", src: `/kutuphane/mekan/${scene.bg}.svg`, alt: "", loading: "lazy" }),
      renaming === scene.scene_id ? nameBox(scene)
        : el("button", {
          type: "button", class: "scene-title", "data-focus": `scene:${scene.scene_id}`, title: `${sceneName(scene)} · mekân: ${scene.bg} · tıkla: ilk shot'ı seç`,
          on: { click: () => ctx.choose(scene.shots[0].shot_id), dblclick: () => { renaming = scene.scene_id; render(); } },
        }, el("b", { text: sceneName(scene) }), el("span", { class: "muted small", text: `${scene.shots.length} shot · ${total}` })),
      errs ? el("span", { class: "bad", title: `${errs} hata`, text: `${errs}!` }) : null);
    dropTarget(head, scene, null);
    return el("li", { class: "scene" },
      head,
      here ? sceneTools(scene, index, count) : null,
      open ? el("ol", { class: "shots" }, scene.shots.map((x, i) => el("li", {}, shotRow(x, scene, i, lens.get(x.shot_id), problems.get(x.shot_id))))) : null);
  }

  function episodeRow(e) {
    const here = e.path === ctx.path();
    return el("li", { class: `ep${here ? " here" : ""}` },
      el("button", {
        type: "button", class: "trow ep-row", "data-focus": `ep:${e.path}`, "aria-current": here ? "true" : null, title: e.path,
        on: { click: () => { if (!here) ctx.openEpisode(e.path); } },
      },
      el("span", { class: "fold-mark", "aria-hidden": "true", text: here ? "▾" : "▸" }),
      el("span", { class: "grow", text: e.title || e.id || e.path }),
      e.ok && !e.valid ? el("span", { class: "bad", title: `${e.errors} hata`, text: `${e.errors}!` }) : null,
      e.ok ? el("span", { class: "len", text: `${e.shots} shot` }) : el("span", { class: "warnb", title: e.error, text: "!" })),
      here ? scenesOf() : null);
  }

  function scenesOf() {
    const ep = ctx.episode();
    if (!ep) return null;
    const lens = lengths();
    const problems = ctx.problems();
    return el("div", { class: "ep-body" },
      el("ol", { class: "scenes" }, ep.scenes.map((s, i) => sceneBlock(s, i, ep.scenes.length, lens, problems))),
      el("button", { class: "btn small add-scene", type: "button", "data-focus": "add", title: "Seçili sahneden sonra yeni bir sahne: aynı mekân, aynı oyuncular ayakta", text: "+ Sahne", on: { click: addScene } }));
  }

  function render() {
    if (dragging) {
      redrawLater = true; // a preview arriving mid-drag must not remove the row being dragged
      return;
    }
    redrawLater = false;
    const active = root.contains(document.activeElement) ? document.activeElement : null;
    if (renaming && active?.classList.contains("scene-name")) return; // keep typing (a commit clears `renaming` first)
    const focusKey = active?.dataset.focus || null;
    const list = episodes || (ctx.path() ? [{ path: ctx.path(), ok: true, title: ctx.episode()?.title, shots: 0 }] : []);
    // el() drops empty parts; replaceChildren alone would print them as "null"
    root.replaceChildren(el("div", {},
      error ? el("p", { class: "err small", text: error }) : null,
      el("ol", { class: "tree" }, list.map(episodeRow)),
      el("p", { class: "muted small tree-hint", text: "Yeni bölüm ve bütün bölümler: üstteki “← Projeler”." })));
    if (!active) return;
    // The keyboard stays where it was; if that control is gone (a deleted scene), on the selected shot.
    const all = [...root.querySelectorAll("[data-focus]")];
    const again = all.find((n) => n.dataset.focus === focusKey) || all.find((n) => n.dataset.focus === `shot:${ctx.selected()}`);
    again?.focus();
  }

  return { render, refresh };
}
