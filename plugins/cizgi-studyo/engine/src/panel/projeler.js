// The episode picker: every bolum.json in the opened folder as a card (background, title,
// shots and length, approval state), switching with a confirmation when there are unsaved
// edits, and a small form that creates a new episode from the minimal template.
import { el } from "./dom.js";

const GATE_TEXT = { onayli: "onaylı", eskimis: "eskidi", yok: "onaysız" };
const GATES = [["senaryo", "Senaryo"], ["storyboard", "Storyboard"]];
const TR_ASCII = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };

/** "Park Günü!" → "park-gunu": a suggestion for the episode id, which the person can still change. */
export function slug(text) {
  return text.toLocaleLowerCase("tr").replace(/[çğıöşüâîû]/g, (c) => TR_ASCII[c])
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

/**
 * @param {HTMLDialogElement} dialog
 * @param {{current:() => string|null, dirty:() => boolean, open:(rel:string) => Promise<void>,
 *          api:(path:string, body?:object) => Promise<any>}} ctx
 */
export function createProjects(dialog, ctx) {
  let list = null;
  let pending = null; // an episode waiting for "discard my edits?"
  let error = "";
  let busy = false;

  const close = () => {
    if (ctx.current()) dialog.close();
  };
  dialog.addEventListener("cancel", (e) => {
    if (!ctx.current()) e.preventDefault(); // nothing open yet: there is nowhere to go back to
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
    if (rel === ctx.current()) return close();
    if (ctx.dirty() && pending !== rel) {
      pending = rel;
      return render();
    }
    pending = null;
    busy = true;
    render();
    try {
      await ctx.open(rel);
      dialog.close();
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
    problem ? el("span", { class: "why", text: problem }) : null);
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
    const form = el("form", { class: "newep", on: { submit: async (ev) => {
      ev.preventDefault();
      msg.textContent = "";
      try {
        const res = await ctx.api("/api/yeni", { id: id.value.trim(), title: title.value.trim() });
        form.reset();
        idTouched = false;
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
    el("div", { class: "row" }, el("button", { class: "btn primary", type: "submit", text: "Oluştur ve aç" }), msg));
    return form;
  }

  function render() {
    const head = el("div", { class: "phead" },
      el("div", {}, el("h2", { text: "Bölümler" }), list ? el("p", { class: "muted small", text: list.root }) : null),
      el("button", { class: "btn icon", type: "button", "aria-label": "Kapat", disabled: !ctx.current(), text: "✕", on: { click: close } }));
    const body = list
      ? list.episodes.length
        ? el("div", { class: "pgrid" }, list.episodes.map(card))
        : el("p", { class: "empty", text: "Bu klasörde bolum.json yok. Aşağıdan yeni bir bölüm oluştur." })
      : error ? null : el("p", { class: "empty", text: "Bölümler aranıyor…" });
    const more = list?.truncated
      ? el("p", { class: "warn small", text: `İlk ${list.episodes.length} bölüm gösteriliyor; daha fazlası için paneli daha dar bir klasörle aç.` })
      : null;
    const parts = [head, confirmBar(), error ? el("p", { class: "err", text: error }) : null, body, more, form];
    dialog.replaceChildren(...parts.filter(Boolean));
  }
  const form = newForm(); // made once, so a half-typed title survives the list refreshing

  return {
    async show() {
      pending = null;
      if (!dialog.open) dialog.showModal();
      await refresh();
    },
  };
}
