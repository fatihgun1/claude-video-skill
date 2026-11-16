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

/** @returns {{set:(w:object|null) => void, slot:() => HTMLElement|null, shrink:() => void, grow:() => void}} */
export function createWizard() {
  let current = null; // the wizard as the server sent it
  let small = false;
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
                active.gorsel.length
                  ? el("div", { class: "sihirbaz-resimler" }, active.gorsel.map((src, n) => el("figure", {},
                    el("img", { src, alt: `${active.baslik}: görsel ${n + 1}`, loading: "lazy" }),
                    el("figcaption", { text: String(n + 1) }))))
                  : null]
              : el("p", { class: "psih-aciklama", text: "Claude adımları sırayla yürütüyor." }))),
        el("aside", { class: "psih-claude", "aria-label": "Claude" },
          el("h3", { text: "Claude" }),
          slot, // Claude's question: the person picks here
          el("p", { class: "muted small sihirbaz-bos", text: active?.durum === "bekliyor" ? "Claude senden bir şey bekliyor; soru gelince burada görünür." : "Claude bir şey sorarsa burada görünür." }))),
    ];
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
