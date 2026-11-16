// Projeler: the panel's home page (a list of the folder's episodes, not a dialog). Every
// bolum.json in the opened folder as a card (background, title, shots and length, approval
// state), a search over them, switching with a confirmation when there are unsaved edits,
// the episodes still being made (they reopen the project wizard), "+ Yeni bölüm" (the wizard)
// and "Boş bölüm", a small form that creates a new episode from the minimal template.
// The editor is hidden while this page shows; the open episode stays loaded behind it.
// Layout: page pattern "List / Index": heading + one line, one primary create action in the
// header, search above a framed list, every empty state inside that same frame.
import { el } from "./dom.js";

const GATE_TEXT = { onayli: "onaylı", eskimis: "eskidi", yok: "onaysız" };
const GATES = [["senaryo", "Senaryo"], ["storyboard", "Storyboard"]];
const TR_ASCII = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };
const SKELETON_CARDS = 3; // placeholders while the list loads: roughly one row of cards

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

const nameOf = (e) => e?.title || e?.id || e?.path || "";

/**
 * @param {HTMLElement} page the home page section
 * @param {{current:() => string|null, dirty:() => boolean, open:(rel:string) => Promise<void>,
 *          api:(path:string, body?:object) => Promise<any>, onView:(home:boolean) => void,
 *          wizard:(id?:string) => void}} ctx   wizard: the project wizard, new (no id) or an episode being made
 */
export function createProjects(page, ctx) {
  let list = null;
  let making = []; // episodes being made: a story, no bolum.json yet (the project wizard)
  let pending = null; // an episode waiting for "discard my edits?"
  let error = "";
  let busy = false;
  let creating = false; // the "Boş bölüm" form is open
  const search = el("input", { type: "search", id: "hsearch", class: "hsearch", placeholder: "park-gunu", autocomplete: "off", "aria-keyshortcuts": "/" });
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
      if (pending) cancelSwitch(); // Esc answers the open question first ("Vazgeç"), never the risky choice
      else if (!typing) hide(); // back to the open episode; in a box (search, new episode) Esc is the box's own
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
      making = (await ctx.api("/api/yapim").catch(() => ({ yapimlar: [] }))).yapimlar;
    } catch (err) {
      error = `Liste alınamadı: ${err.message}`;
    }
    render();
  }

  async function choose(rel) {
    if (rel === ctx.current()) return hide();
    if (ctx.dirty() && pending !== rel) {
      pending = rel;
      render();
      page.querySelector(".hconfirm .btn")?.focus(); // "Vazgeç" holds the focus: Enter never discards by accident
      return;
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
  function cancelSwitch() {
    pending = null;
    render();
  }

  function duration(e) {
    if (!e.valid) return null;
    return e.duration == null ? "süre: ses bekleniyor" : `${e.duration.toFixed(1)} sn`;
  }

  function card(e) {
    const here = e.path === ctx.current();
    const thumb = el("div", { class: "pthumb" }, e.bg ? el("img", { src: `/kutuphane/mekan/${e.bg}.svg`, alt: "", loading: "lazy" }) : null,
      here ? el("span", { class: "badge", text: "Açık" }) : null);
    const facts = e.ok ? [`${e.shots} shot`, duration(e)].filter(Boolean).join(" · ") : null;
    const gates = e.ok && e.gates
      ? el("span", { class: "gates" }, GATES.map(([k, name]) => {
        const state = GATE_TEXT[e.gates[k]] || e.gates[k];
        return el("span", { class: `gate ${e.gates[k]}`, title: `${name} onayı: ${state}` }, `${name} ${state}`);
      }))
      : null;
    const problem = !e.ok ? e.error : !e.valid ? `${e.errors} hata: panelde düzelt` : null;
    return el("button", {
      class: `pcard${here ? " current" : ""}`, type: "button", disabled: busy,
      "aria-current": here ? "true" : null,
      on: { click: () => choose(e.path) },
    },
    thumb,
    el("span", { class: "ptitle", text: nameOf(e) }),
    el("span", { class: "ppath", text: e.path }),
    facts ? el("span", { class: "meta", text: facts }) : null,
    gates,
    problem ? el("span", { class: "why", text: problem }) : null,
    el("span", { class: "popen", "aria-hidden": "true", text: here ? "Düzenlemeye dön →" : "Aç →" }));
  }

  /** Switching away from unsaved edits: names both episodes, "Vazgeç" first and focused. */
  function confirmBar() {
    if (!pending) return null;
    const target = list?.episodes.find((e) => e.path === pending);
    const open = list?.episodes.find((e) => e.path === ctx.current());
    return el("div", { class: "confirm hconfirm", role: "alertdialog", "aria-labelledby": "hconfirm-q", "aria-describedby": "hconfirm-d" },
      el("div", { class: "hconfirm-text" },
        el("strong", { id: "hconfirm-q", text: `“${nameOf(target) || pending}” bölümüne geçilsin mi?` }),
        el("span", { id: "hconfirm-d", text: `“${nameOf(open) || "Açık bölüm"}” bölümünde kaydedilmemiş değişiklikler var; geçersen kaybolur.` })),
      el("div", { class: "hconfirm-actions" },
        el("button", { class: "btn", type: "button", text: "Vazgeç", on: { click: cancelSwitch } }),
        el("button", { class: "btn danger", type: "button", text: "Değişiklikleri at ve geç", on: { click: () => choose(pending) } })));
  }

  /** One labelled field: the label above its control, as in the project wizard. */
  const field = (id, label, control, hint) => {
    control.id = id;
    return el("div", { class: "pfield" },
      el("label", { class: "pfield-ad", for: id, text: label }), control,
      hint ? el("p", { class: "pfield-ipucu", text: hint }) : null);
  };

  function newForm() {
    const title = el("input", { type: "text", maxlength: "120", placeholder: "Park günü", required: true });
    const id = el("input", { type: "text", maxlength: "60", placeholder: "park-gunu", required: true, pattern: "[a-z0-9]+(-[a-z0-9]+)*" });
    // who and where: the person picks them; nothing is chosen for them. The options come with the list.
    const rig = el("select", { required: true });
    const bg = el("select", { required: true });
    let filledFrom = null;
    const fill = (select, items, none) => {
      const keep = select.value;
      select.replaceChildren(el("option", { value: "", text: none }),
        ...(items || []).map((o) => el("option", { value: o.id, text: o.label === o.id ? o.id : `${o.label} (${o.id})` })));
      select.value = (items || []).some((o) => o.id === keep) ? keep : "";
    };
    const setChoices = (choices) => {
      if (!choices || choices === filledFrom) return;
      filledFrom = choices;
      fill(rig, choices.rigs, "Karakter seç…");
      fill(bg, choices.backgrounds, "Mekân seç…");
    };
    let idTouched = false;
    title.addEventListener("input", () => { if (!idTouched) id.value = slug(title.value); });
    id.addEventListener("input", () => { idTouched = true; });
    const msg = el("p", { class: "pfield-hata", role: "alert" });
    const submit = el("button", { class: "btn primary", type: "submit", text: "Oluştur ve aç" });
    const close = () => { creating = false; render(); };
    const f = el("form", { class: "newep hnew", "aria-labelledby": "hnew-title", on: {
      keydown: (ev) => { if (ev.key === "Escape") { ev.preventDefault(); close(); } },
      submit: async (ev) => {
        ev.preventDefault();
        msg.textContent = "";
        submit.disabled = true;
        submit.setAttribute("aria-busy", "true");
        submit.textContent = "Oluşturuluyor…";
        try {
          const res = await ctx.api("/api/yeni", { id: id.value.trim(), title: title.value.trim(), rig: rig.value, bg: bg.value });
          f.reset();
          idTouched = false;
          creating = false;
          await refresh();
          await choose(res.path);
        } catch (err) {
          msg.textContent = `Oluşturulamadı: ${err.message}`;
        } finally {
          submit.disabled = false;
          submit.removeAttribute("aria-busy");
          submit.textContent = "Oluştur ve aç";
        }
      },
    } },
    el("div", { class: "hnew-head" },
      el("h3", { id: "hnew-title", text: "Boş bölüm" }),
      el("p", { class: "muted", text: "Sihirbazsız başlangıç: seçtiğin mekânda bir sahne, bir shot, ortada duran seçtiğin karakter. Gerisini panelde düzenlersin." })),
    el("div", { class: "pikili" },
      field("hnew-baslik", "Başlık", title),
      field("hnew-kimlik", "Kimlik", id, "Klasör adı: bolumler/<kimlik>/bolum.json. Küçük harf, rakam ve tire.")),
    el("div", { class: "pikili" },
      field("hnew-karakter", "İlk karakter", rig),
      field("hnew-mekan", "İlk mekân", bg)),
    msg,
    el("div", { class: "hnew-actions" },
      el("button", { class: "btn", type: "button", text: "Vazgeç", on: { click: close } }),
      submit));
    return { form: f, focus: () => title.focus(), setChoices };
  }

  /** Episodes being made: their own labelled group above the finished ones, each a row that reopens the wizard. */
  function makingSection() {
    if (!making.length) return null;
    return el("section", { class: "hgroup pyapim", "aria-labelledby": "hyapim-title" },
      el("div", { class: "hgroup-head" },
        el("h3", { id: "hyapim-title" }, "Yapım aşamasında ", el("span", { class: "hcount", text: String(making.length) })),
        el("p", { class: "muted", text: "Hikâyesi yazılmış, bölüm dosyası henüz oluşmamış bölümler. Sihirbazda kaldığın yerden sürdür." })),
      el("ul", { class: "hmaking" }, making.map((m) => el("li", {},
        el("button", { class: "hmaking-row", type: "button", title: `bolumler/${m.id}/hikaye.json`, on: { click: () => ctx.wizard(m.id) } },
          el("span", { class: "hmaking-name", text: m.baslik || m.id }),
          el("span", { class: "ppath", text: `bolumler/${m.id}` }),
          el("span", { class: "popen", "aria-hidden": "true", text: "Sihirbazda sürdür →" }))))));
  }

  /** An empty state inside the list frame: what belongs here, why, and one way forward. */
  const empty = (title, text, ...actions) => el("div", { class: "hempty", role: "status" },
    el("p", { class: "hempty-title", text: title }),
    el("p", { class: "muted", text }),
    actions.length ? el("div", { class: "hempty-actions" }, actions) : null);
  const createBtn = () => el("button", { class: "btn primary", type: "button", text: "Yeni bölüm oluştur", on: { click: () => ctx.wizard() } });

  /** Card-shaped placeholders while the list loads; they fade in late, so a fast answer never flashes them. */
  const skeleton = () => el("div", { class: "pgrid hskeleton", "aria-hidden": "true" },
    Array.from({ length: SKELETON_CARDS }, () => el("div", { class: "hskel-card" },
      el("div", { class: "hskel-thumb" }), el("div", { class: "hskel-line" }), el("div", { class: "hskel-line short" }))));

  const grid = el("div", { class: "hframe", id: "hframe" });
  const count = el("span", { class: "muted small hcount-all", "aria-live": "polite" });
  /** The cards that match the search, inside the list's frame (an empty list keeps the frame). */
  function renderGrid() {
    const shown = list ? list.episodes.filter((e) => matches(e, search.value)) : [];
    const q = search.value.trim();
    count.textContent = !list ? "" : q ? `${shown.length} / ${list.episodes.length} bölüm` : `${list.episodes.length} bölüm`;
    grid.setAttribute("aria-busy", String(!list && !error));
    grid.replaceChildren(
      !list ? (error
        ? empty("Liste alınamadı", "Klasördeki bölümler okunamadı. Sunucu çalışıyorsa yeniden dene.",
          el("button", { class: "btn", type: "button", text: "Yeniden dene", on: { click: refresh } }))
        : el("div", { role: "status" }, el("span", { class: "hsr", text: "Bölümler yükleniyor…" }), skeleton()))
        : !list.episodes.length
          ? empty("Henüz bitmiş bölüm yok", "Bir bölüm oluşturduğunda burada resmi, süresi ve onay durumuyla görünür.", createBtn())
          : !shown.length
            ? empty(`“${q}” ile eşleşen bölüm yok`, "Başlık, kimlik ya da klasör adının bir parçasını dene.",
              el("button", { class: "btn", type: "button", text: "Aramayı temizle", on: { click: () => { search.value = ""; renderGrid(); search.focus(); } } }))
            : el("div", { class: "pgrid" }, shown.map(card)));
  }

  function header() {
    const back = ctx.current()
      ? el("button", { class: "btn ghost", type: "button", text: "← Açık bölüme dön", title: "Düzenlediğin bölüme dön (Esc)", on: { click: hide } })
      : null;
    const toggleNew = () => {
      creating = !creating;
      render();
      if (creating) newEp.focus();
    };
    return el("header", { class: "hhead" },
      el("div", { class: "htitle" },
        el("h2", { text: "Projeler" }),
        el("p", { class: "muted", title: list?.root, text: list ? `“${folderName(list.root)}” klasöründeki bölümler. Birini aç ya da yeni bir bölüm başlat.` : "Bu klasördeki bölümler. Birini aç ya da yeni bir bölüm başlat." })),
      el("div", { class: "hactions" },
        back,
        el("button", { class: "btn", type: "button", text: "Boş bölüm", title: "Sihirbazsız: tek sahne, tek shot", "aria-expanded": String(creating), "aria-controls": "hnew", on: { click: toggleNew } }),
        el("button", { class: "btn primary", type: "button", text: "+ Yeni bölüm", title: "Proje sihirbazı: hikâye, kararlar, karakterler, sahneler, ses", on: { click: () => ctx.wizard() } })));
  }

  function render() {
    const tools = el("div", { class: "htools" },
      el("label", { class: "hsearch-wrap", for: "hsearch" },
        el("span", { class: "hsearch-lab", text: "Ara" }), search,
        el("kbd", { class: "hkbd", title: "Kısayol: /", text: "/" })),
      count);
    const more = list?.truncated
      ? el("p", { class: "warn small", text: `İlk ${list.episodes.length} bölüm gösteriliyor; daha fazlası için paneli daha dar bir klasörle aç.` })
      : null;
    renderGrid();
    newEp.setChoices(list?.secenekler);
    newEp.form.id = "hnew";
    const episodes = el("section", { class: "hgroup", "aria-labelledby": "hbolum-title" },
      el("div", { class: "hgroup-head" },
        el("h3", { id: "hbolum-title", text: "Bölümler" })),
      tools, grid, more);
    const parts = [header(), confirmBar(), creating ? newEp.form : null,
      error && list ? el("p", { class: "err herr", role: "alert", text: error }) : null,
      makingSection(), episodes];
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
    /** Open an episode as a click on its card would (asks first about unsaved edits). */
    go: (rel) => choose(rel),
    /** Whether the home page is on screen (the editor's keys are off then). */
    shown: () => !page.hidden,
  };
}
