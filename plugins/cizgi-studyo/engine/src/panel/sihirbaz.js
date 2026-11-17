// The wizard Claude moves on (MCP panel_adim, see panel-kanal.mjs): a slide-over on the right edge
// with the steps of a multi-step job, the current step's note and pictures, and a slot where Claude's
// open question (panel_sor) shows. It can be made small (a chip stays at the bottom) and closed once done.
// While the Üretim page is open (a modal: nothing behind it can be seen), the drawer docks into that
// page's Claude column instead, so it never hides behind it or covers the page.
// All text comes from Claude's tool call and is drawn as text; pictures are the panel's own drawings.
import { el } from "./dom.js";

// a finished or failed step shows its mark; the others their number (the colour says the state)
const MARK = { bitti: "✓", hata: "!" };
const STATE_TEXT = { sirada: "sırada", calisiyor: "Claude çalışıyor", bekliyor: "senden bekleniyor", bitti: "bitti", hata: "olmadı" };
// the Üretim page's Claude column (uretim.js keeps these elements across its redraws)
const DOCK = "#uretim[open] .uretim-sihirbaz";
const QUESTION_DOCK = "#uretim[open] .uretim-soru";
// a picture that is a draft of the project library (see panel-taslak.mjs): it can be taken in right here
const DRAFT_SRC = /^\/kutuphane-taslak\/(karakter|mekan|nesne)\/([a-z0-9_-]+)\.svg$/;

/**
 * @param {{takeDraft?:(tur:string, id:string) => Promise<string>}} [opts]
 * @returns {{set:(w:object|null) => void, slot:() => HTMLElement|null, shrink:() => void, grow:() => void}}
 */
export function createWizard({ takeDraft } = {}) {
  let current = null; // the wizard as the server sent it
  const taking = new Map(); // draft picture → "alınıyor" | "alındı" | why it failed
  let small = false;
  let thinking = false; // the person answered: Claude works on it (the channel's "düşünüyor")
  let dismissed = null; // id of a finished wizard the person closed
  const slot = el("div", { class: "sihirbaz-soru" }); // Claude's question goes here while the wizard is open
  const box = el("aside", { class: "sihirbaz", role: "dialog", "aria-modal": "false", "aria-labelledby": "sihirbaz-baslik", hidden: true });
  const chip = el("button", { class: "sihirbaz-cip", type: "button", hidden: true, on: { click: () => { small = false; render(); } } });
  document.body.append(box, chip);

  const open = () => (current && current.id !== dismissed ? current : null);
  const position = (w) => {
    const at = w.adimlar.findIndex((a) => a.id === w.aktif);
    return at < 0 ? 0 : at + 1;
  };

  /** Drawer over the editor, or docked in the Üretim page while it is open. */
  function place() {
    const dock = document.querySelector(DOCK);
    const home = dock || document.body;
    if (box.parentElement !== home) home.append(box, chip);
    box.classList.toggle("docked", !!dock);
    chip.classList.toggle("docked", !!dock);
    box.setAttribute("role", dock ? "region" : "dialog");
  }

  function step(a, active, i) {
    return el("li", { class: `sadim ${a.durum}${active ? " aktif" : ""}`, "aria-current": active ? "step" : null },
      el("span", { class: "sisaret", "aria-hidden": "true", text: MARK[a.durum] || String(i + 1) }),
      el("div", { class: "sgovde" },
        el("span", { class: "sbaslik", text: a.baslik }),
        el("span", { class: "sdurum", text: STATE_TEXT[a.durum] || a.durum }),
        active && a.aciklama ? el("p", { class: "saciklama", text: a.aciklama }) : null,
        active && a.gorsel.length
          ? el("div", { class: "sgorseller" }, a.gorsel.map((src, n) => el("img", { src, alt: `${a.baslik}: görsel ${n + 1}`, loading: "lazy" })))
          : null));
  }

  const closeButton = (w) => (w.bitti
    ? el("button", { class: "btn", type: "button", text: "Kapat", on: { click: () => { dismissed = w.id; render(); } } })
    : el("button", { class: "btn", type: "button", text: "Küçült", title: "Panelde çalışmaya devam et; alttaki düğmeyle geri gelir", on: { click: () => { small = true; render(); } } }));

  /**
   * Over the editor the wizard is a full work page, like the project wizard: the steps on the left,
   * the current step with its pictures large in the middle, Claude's question on the right (where
   * the person picks). A narrow drawer over the page hid the list and cramped the pictures.
   */
  function page(w, active) {
    const pos = position(w);
    return [
      el("header", { class: "psih-bas" },
        el("div", { class: "psih-baslik" },
          el("h2", { id: "sihirbaz-baslik", text: w.baslik }),
          el("span", { class: "muted small", text: w.bitti ? "Bütün adımlar bitti" : `Claude ile birlikte · Adım ${pos} / ${w.adimlar.length}` })),
        closeButton(w)),
      el("div", { class: "psih-alan" },
        el("nav", { class: "psih-adimlar", "aria-label": "Adımlar" }, el("ol", {}, w.adimlar.map((a, i) => el("li", {},
          el("div", { class: `sadim-satir ${a.durum}${a.id === w.aktif ? " simdi" : ""}`, "aria-current": a.id === w.aktif ? "step" : null },
            el("span", { class: "padim-no", "aria-hidden": "true", text: MARK[a.durum] || String(i + 1) }),
            el("span", {}, el("span", { class: "sadim-ad", text: a.baslik }), el("small", { text: STATE_TEXT[a.durum] || a.durum }))))))),
        el("main", { class: "psih-form" },
          el("div", { class: "psih-sutun" },
            active
              ? [el("h3", { text: active.baslik }),
                el("p", { class: `sihirbaz-durum ${active.durum}`, text: STATE_TEXT[active.durum] || active.durum }),
                active.aciklama ? el("p", { class: "psih-aciklama", text: active.aciklama }) : null,
                takeAllButton(active.gorsel),
                active.gorsel.length
                  ? el("div", { class: "sihirbaz-resimler" }, active.gorsel.map((src, n) => el("figure", {},
                    // a draft taken in left taslak/: show it from the library
                    el("img", { src: taking.get(src) === "alındı" ? src.replace("/kutuphane-taslak/", "/kutuphane/") : src, alt: `${active.baslik}: görsel ${n + 1}`, loading: "lazy" }),
                    el("figcaption", { text: String(n + 1) }),
                    takeButton(src))))
                  : null]
              : el("p", { class: "psih-aciklama", text: "Claude adımları sırayla yürütüyor." }))),
        el("aside", { class: "psih-claude", "aria-label": "Claude" },
          el("h3", { text: "Claude" }),
          claudeState(w, active),
          slot)), // Claude's question: the person picks here
    ];
  }

  /**
   * Claude asks the person to take its drawings into the library, and this page covers the panel
   * where the drafts are: so each draft picture has its own "Kütüphaneye al" here.
   */
  async function take(src) {
    const m = DRAFT_SRC.exec(src);
    if (!m || !takeDraft || taking.get(src) === "alınıyor" || taking.get(src) === "alındı") return;
    taking.set(src, "alınıyor");
    render();
    const why = await takeDraft(m[1], m[2]);
    taking.set(src, why || "alındı");
    render();
  }
  const waitingDrafts = (list) => list.filter((src) => DRAFT_SRC.test(src) && taking.get(src) !== "alındı");

  function takeButton(src) {
    if (!takeDraft || !DRAFT_SRC.test(src)) return null;
    const s = taking.get(src);
    if (s === "alındı") return el("p", { class: "sresim-alindi", role: "status", text: "✓ Kütüphanede" });
    return el("div", { class: "sresim-al" },
      el("button", { class: "btn small", type: "button", "aria-busy": s === "alınıyor" ? "true" : null, text: s === "alınıyor" ? "Alınıyor…" : "Kütüphaneye al", on: { click: () => take(src) } }),
      s && s !== "alınıyor" ? el("p", { class: "sresim-hata", role: "alert", text: s }) : null);
  }

  function takeAllButton(list) {
    if (!takeDraft) return null;
    const left = waitingDrafts(list);
    if (left.length < 2) return null;
    return el("button", { class: "btn primary", type: "button", text: `${left.length} taslağın hepsini kütüphaneye al`,
      on: { click: async () => { for (const src of left) await take(src); } } });
  }

  /**
   * What Claude is doing now, always visible in its column: working (a spinner), or waiting for the
   * person (with a way to the panel, which this page covers), or done. An empty column read as "stuck".
   */
  function claudeState(w, active) {
    const asking = !!slot.querySelector(".kanal-soru:not([hidden])");
    if (w.bitti) return el("p", { class: "psih-durum" }, el("span", { class: "nokta acik", "aria-hidden": "true" }), "Bütün adımlar bitti.");
    if (asking) return el("p", { class: "psih-durum" }, el("span", { class: "nokta acik", "aria-hidden": "true" }), "Claude cevabını bekliyor: aşağıdan seç.");
    if (thinking || active?.durum === "calisiyor" || !active) {
      return el("p", { class: "psih-durum dusunuyor", role: "status" }, el("span", { class: "cark", "aria-hidden": "true" }),
        thinking ? "Claude cevabını işliyor…" : `Claude çalışıyor${active ? `: ${active.baslik}` : ""}…`);
    }
    if (active.durum === "bekliyor") {
      return el("div", { class: "sihirbaz-bekliyor" },
        el("p", { class: "psih-durum bekliyor" }, el("span", { class: "nokta bekliyor", "aria-hidden": "true" }), "Senden bekleniyor"),
        el("p", { class: "muted small", text: "Ne yapacağın ortada yazıyor. Panelde yapman gerekiyorsa bu sayfayı küçült; alttaki düğmeyle geri gelir." }),
        el("button", { class: "btn primary", type: "button", text: "Küçült ve panelde yap", on: { click: () => { small = true; render(); } } }));
    }
    if (active.durum === "hata") return el("p", { class: "psih-durum hata" }, el("span", { class: "nokta hata", "aria-hidden": "true" }), "Bu adım olmadı: açıklamaya bak.");
    return el("p", { class: "psih-durum" }, el("span", { class: "nokta", "aria-hidden": "true" }), "Sıradaki adıma geçiliyor.");
  }

  function render() {
    place();
    const w = open();
    box.hidden = !w || small;
    chip.hidden = !w || !small;
    if (!w) return;
    const active = w.adimlar.find((a) => a.id === w.aktif);
    chip.textContent = w.bitti ? `${w.baslik}: bitti` : `${w.baslik} · ${position(w)}/${w.adimlar.length}${active ? ` · ${active.baslik}` : ""}`;
    chip.classList.toggle("bekliyor", active?.durum === "bekliyor");
    if (small) return;
    const docked = box.classList.contains("docked");
    box.classList.toggle("sayfa", !docked);
    if (!docked) {
      box.replaceChildren(...page(w, active));
      return;
    }
    box.replaceChildren(...[
      el("div", { class: "sust" },
        el("span", { class: "skim", text: "Claude ile birlikte" }),
        w.bitti
          ? el("button", { class: "btn small ghost", type: "button", text: "Kapat", on: { click: () => { dismissed = w.id; render(); } } })
          : el("button", { class: "btn small ghost", type: "button", text: "Küçült", title: "Panelde çalışmaya devam et; alttaki düğmeyle geri gelir", on: { click: () => { small = true; render(); } } })),
      el("div", { class: "sihirbaz-bas" },
        el("h3", { id: "sihirbaz-baslik", text: w.baslik }),
        el("p", { class: "sihirbaz-sayac", text: w.bitti ? "Bütün adımlar bitti." : `Adım ${position(w)} / ${w.adimlar.length}` })),
      el("ol", { class: "sadimlar" }, w.adimlar.map((a, i) => step(a, a.id === w.aktif, i))),
      slot,
    ]);
  }

  return {
    /** The wizard from the last poll (null: none). A new wizard opens big. */
    set(w) {
      place(); // the Üretim page may have opened or closed since the last poll
      if ((w?.id ?? null) === (current?.id ?? null) && (w?.seq ?? null) === (current?.seq ?? null)) return; // nothing new: no redraw
      if (w && current?.id !== w.id) small = false;
      current = w;
      render();
    },
    /**
     * Where a question goes, or null when it floats over the editor: the open wizard's slot, else the
     * Üretim page's Claude column while that page is open (a floating box would hide behind it).
     */
    slot: () => (open() && !small ? slot : document.querySelector(QUESTION_DOCK)),
    /** Claude is (no longer) working on the person's answer: the page shows it. */
    setThinking(on) {
      if (on === thinking) return;
      thinking = on;
      if (open() && !small) render();
    },
    /** Redraw Claude's state (a question came or went). */
    refresh() {
      if (open() && !small && !box.classList.contains("docked")) render();
    },
    /** Make room so the person sees what Claude pointed at. */
    shrink() {
      if (!current || small) return;
      small = true;
      render();
    },
    /** A question came while the wizard was small: bring it back. */
    grow() {
      if (!current || !small) return;
      small = false;
      render();
    },
  };
}
