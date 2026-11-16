// Projeler: the panel's home page (a list of the folder's episodes, not a dialog). Every
// bolum.json in the opened folder as a card (background, title, shots and length, approval
// state), a search over them, switching with a confirmation when there are unsaved edits,
// and "+ Yeni bölüm", a small form that creates a new episode from the minimal template.
// The editor is hidden while this page shows; the open episode stays loaded behind it.
import { el } from "./dom.js";

const GATE_TEXT = { onayli: "onaylı", eskimis: "eskidi", yok: "onaysız" };
const GATES = [["senaryo", "Senaryo"], ["storyboard", "Storyboard"]];
const TR_ASCII = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };

/** "Park Günü!" → "park-gunu": a suggestion for the episode id, which the person can still change. */
export function slug(text) {
  return text.toLocaleLowerCase("tr").replace(/[çğıöşüâîû]/g, (c) => TR_ASCII[c])
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

/** The last part of a folder path, Windows or POSIX ("C:\a\Video" → "Video"); the full path is the tooltip. */
export const folderName = (root) => root.split(/[\\/]+/).filter(Boolean).at(-1) || root;

/** Whether an episode matches the search text (title, id or path; Turkish case rules). */
export function matches(e, query) {
  const q = query.trim().toLocaleLowerCase("tr");
  if (!q) return true;
  return [e.title, e.id, e.path].some((s) => (s || "").toLocaleLowerCase("tr").includes(q));
}

/**
 * @param {HTMLElement} page the home page section
 * @param {{current:() => string|null, dirty:() => boolean, open:(rel:string) => Promise<void>,
 *          api:(path:string, body?:object) => Promise<any>, onView:(home:boolean) => void}} ctx
 */
export function createProjects(page, ctx) {
  let list = null;
  let pending = null; // an episode waiting for "discard my edits?"
  let error = "";
  let busy = false;
  let creating = false; // the "Yeni bölüm" form is open
  const search = el("input", { type: "search", class: "hsearch", placeholder: "Bölüm adı ya da klasör", "aria-label": "Bölümlerde ara" });
  search.addEventListener("input", () => renderGrid());

  page.tabIndex = -1; // focus lands on the page itself, so its keys work from the first moment
  function show() {
    page.hidden = false;
    document.body.classList.add("at-home");
    ctx.onView(true);
    // the button that brought us here is hidden now: keep the focus on screen
    if (!page.contains(document.activeElement)) page.focus({ preventScroll: true });
  }
  function hide() {
    if (!ctx.current() || page.hidden) return; // nothing open yet: there is nowhere to go back to
    page.hidden = true;
    document.body.classList.remove("at-home");
    ctx.onView(false);
  }
  document.addEventListener("keydown", (e) => {
    if (page.hidden || e.defaultPrevented || document.querySelector("dialog[open]")) return;
    const a = document.activeElement;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(a?.tagName || "") || a?.isContentEditable;
    if (e.key === "Escape") {
      if (!typing) hide(); // back to the open episode; in a box (search, new episode) Esc is the box's own
    } else if (e.key === "/" && !typing) { // "/" searches, as in most lists
      e.preventDefault();
      search.focus();
    }
  });

  async function refresh() {
    list = null;
    error = "";
    render();
    try {
      list = await ctx.api("/api/bolumler");
    } catch (err) {
      error = `Liste alınamadı: ${err.message}`;
    }
    render();
  }

  async function choose(rel) {
    if (rel === ctx.current()) return hide();
    if (ctx.dirty() && pending !== rel) {
      pending = rel;
      return render();
    }
    pending = null;
    busy = true;
    render();
    try {
      await ctx.open(rel);
      hide();
    } catch (err) {
      error = `Açılamadı: ${err.message}`;
    } finally {
      busy = false;
      render();
    }
  }

  function duration(e) {
    if (!e.valid) return null;
    return e.duration == null ? "süre: ses bekleniyor" : `${e.duration.toFixed(1)} s`;
  }

  function card(e) {
    const here = e.path === ctx.current();
    const thumb = el("div", { class: "pthumb" }, e.bg ? el("img", { src: `/kutuphane/mekan/${e.bg}.svg`, alt: "", loading: "lazy" }) : null,
      here ? el("span", { class: "badge", text: "açık" }) : null);
    const facts = e.ok ? [`${e.shots} shot`, duration(e)].filter(Boolean).join(" · ") : null;
    const gates = e.ok && e.gates
      ? el("div", { class: "gates" }, GATES.map(([k, name]) => el("span", { class: `gate ${e.gates[k]}`, title: `${name}: ${GATE_TEXT[e.gates[k]] || e.gates[k]}` }, `${name} ${GATE_TEXT[e.gates[k]] || e.gates[k]}`)))
      : null;
    const problem = !e.ok ? e.error : !e.valid ? `${e.errors} hata: panelde düzelt` : null;
    return el("button", {
      class: `pcard${here ? " current" : ""}`, type: "button", disabled: busy,
      "aria-current": here ? "true" : null,
      on: { click: () => choose(e.path) },
    },
    thumb,
    el("span", { class: "ptitle", text: e.title || e.id || e.path }),
    el("span", { class: "ppath", text: e.path }),
    facts ? el("span", { class: "meta", text: facts }) : null,
    gates,
    problem ? el("span", { class: "why", text: problem }) : null,
    el("span", { class: "popen", "aria-hidden": "true", text: here ? "Düzenlemeye dön →" : "Aç →" }));
  }

  function confirmBar() {
    if (!pending) return null;
    const target = list?.episodes.find((e) => e.path === pending);
    return el("div", { class: "confirm", role: "alert" },
      el("span", { text: `Açık bölümde kaydedilmemiş değişiklikler var. “${target?.title || pending}” bölümüne geçersen kaybolacak.` }),
      el("button", { class: "btn", type: "button", text: "Vazgeç", on: { click: () => { pending = null; render(); } } }),
      el("button", { class: "btn danger", type: "button", text: "Değişiklikleri at ve geç", on: { click: () => choose(pending) } }));
  }

  function newForm() {
    const title = el("input", { type: "text", maxlength: "120", placeholder: "Örnek: Park günü", required: true, "aria-label": "Başlık" });
    const id = el("input", { type: "text", maxlength: "60", placeholder: "park-gunu", required: true, pattern: "[a-z0-9]+(-[a-z0-9]+)*", "aria-label": "Kimlik" });
    let idTouched = false;
    title.addEventListener("input", () => { if (!idTouched) id.value = slug(title.value); });
    id.addEventListener("input", () => { idTouched = true; });
    const msg = el("span", { class: "why" });
    const f = el("form", { class: "newep", on: { submit: async (ev) => {
      ev.preventDefault();
      msg.textContent = "";
      try {
        const res = await ctx.api("/api/yeni", { id: id.value.trim(), title: title.value.trim() });
        f.reset();
        idTouched = false;
        creating = false;
        await refresh();
        await choose(res.path);
      } catch (err) {
        msg.textContent = err.message;
      }
    } } },
    el("h3", { text: "Yeni bölüm" }),
    el("label", { class: "field" }, el("span", { text: "Başlık" }), title),
    el("label", { class: "field" }, el("span", { text: "Kimlik" }), id),
    el("p", { class: "muted small", text: "bolumler/<kimlik>/bolum.json olarak yazılır: bir sahne, bir shot, ortada duran bir karakter. Sonra panelde düzenlersin." }),
    el("div", { class: "row" },
      el("button", { class: "btn primary", type: "submit", text: "Oluştur ve aç" }),
      el("button", { class: "btn", type: "button", text: "Vazgeç", on: { click: () => { creating = false; render(); } } }),
      msg));
    return { form: f, focus: () => title.focus() };
  }

  const grid = el("div", { class: "hframe" });
  /** The cards that match the search, inside the list's frame (an empty list keeps the frame). */
  function renderGrid() {
    const shown = list ? list.episodes.filter((e) => matches(e, search.value)) : [];
    const empty = (text) => el("p", { class: "empty", text });
    grid.replaceChildren(
      !list ? (error ? empty("Liste alınamadı.") : empty("Bölümler aranıyor…"))
        : !list.episodes.length ? empty("Bu klasörde henüz bölüm yok. “+ Yeni bölüm” ile ilkini oluştur.")
          : !shown.length ? empty(`“${search.value.trim()}” ile eşleşen bölüm yok.`)
            : el("div", { class: "pgrid" }, shown.map(card)));
  }

  function render() {
    const back = ctx.current()
      ? el("button", { class: "btn", type: "button", text: "Açık bölüme dön", title: "Düzenlediğin bölüme dön (Esc)", on: { click: hide } })
      : null;
    const head = el("header", { class: "hhead" },
      el("div", { class: "htitle" },
        el("h2", { text: "Projeler" }),
        el("p", { class: "muted", title: list?.root, text: list ? `“${folderName(list.root)}” klasöründeki bölümler. Birini aç ya da yeni bir bölüm başlat.` : "Bu klasördeki bölümler." })),
      back,
      el("button", { class: "btn primary", type: "button", text: "+ Yeni bölüm", "aria-expanded": String(creating), on: { click: () => { creating = !creating; render(); if (creating) newEp.focus(); } } }));
    const tools = el("div", { class: "htools" },
      el("label", { class: "hsearch-wrap" }, el("span", { class: "hsearch-lab", text: "Ara" }), search),
      el("span", { class: "muted small", text: list ? `${list.episodes.length} bölüm` : "" }));
    const more = list?.truncated
      ? el("p", { class: "warn small", text: `İlk ${list.episodes.length} bölüm gösteriliyor; daha fazlası için paneli daha dar bir klasörle aç.` })
      : null;
    renderGrid();
    const parts = [head, creating ? newEp.form : null, confirmBar(), error ? el("p", { class: "err", text: error }) : null, tools, grid, more];
    page.replaceChildren(el("div", { class: "hpage" }, parts.filter(Boolean)));
  }
  const newEp = newForm(); // made once, so a half-typed title survives the list refreshing

  return {
    /** Show the home page (the editor keeps the open episode). */
    async show() {
      pending = null;
      show();
      await refresh();
    },
    /** Switch to an episode through the home page, which asks first when there are unsaved edits. */
    async pick(rel) {
      pending = null;
      show();
      await refresh();
      await choose(rel);
    },
    /** Whether the home page is on screen (the editor's keys are off then). */
    shown: () => !page.hidden,
  };
}
