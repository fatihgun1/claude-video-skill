// The wizard Claude moves on (MCP panel_adim, see panel-kanal.mjs): a drawer on the right with the
// steps of a multi-step job, the current step's note and pictures, and a slot where Claude's open
// question (panel_sor) shows. It can be made small (a chip stays at the bottom) and closed once done.
// All text comes from Claude's tool call and is drawn as text; pictures are the panel's own drawings.
import { el } from "./dom.js";

const MARK = { sirada: "○", calisiyor: "◐", bekliyor: "●", bitti: "✓", hata: "!" };
const STATE_TEXT = { sirada: "sırada", calisiyor: "Claude çalışıyor", bekliyor: "senden bekleniyor", bitti: "bitti", hata: "olmadı" };

export function createWizard() {
  let current = null; // the wizard as the server sent it
  let small = false;
  let dismissed = null; // id of a finished wizard the person closed
  const slot = el("div", { class: "sihirbaz-soru" }); // Claude's question goes here while the wizard is open
  const box = el("aside", { class: "sihirbaz", role: "dialog", "aria-modal": "false", "aria-labelledby": "sihirbaz-baslik", hidden: true });
  const chip = el("button", { class: "sihirbaz-cip", type: "button", hidden: true, on: { click: () => { small = false; render(); } } });
  document.body.append(box, chip);

  const position = (w) => {
    const at = w.adimlar.findIndex((a) => a.id === w.aktif);
    return at < 0 ? 0 : at + 1;
  };

  function step(a, active) {
    return el("li", { class: `sadim ${a.durum}${active ? " aktif" : ""}`, "aria-current": active ? "step" : null },
      el("span", { class: "sisaret", "aria-hidden": "true", text: MARK[a.durum] || "○" }),
      el("div", { class: "sgovde" },
        el("span", { class: "sbaslik", text: a.baslik }),
        el("span", { class: "sdurum", text: STATE_TEXT[a.durum] || a.durum }),
        active && a.aciklama ? el("p", { class: "saciklama", text: a.aciklama }) : null,
        active && a.gorsel.length ? el("div", { class: "sgorseller" }, a.gorsel.map((src) => el("img", { src, alt: "", loading: "lazy" }))) : null));
  }

  function render() {
    const w = current && current.id !== dismissed ? current : null;
    box.hidden = !w || small;
    chip.hidden = !w || !small;
    if (!w) return;
    const active = w.adimlar.find((a) => a.id === w.aktif);
    chip.textContent = w.bitti ? `${w.baslik}: bitti` : `${w.baslik} · ${position(w)}/${w.adimlar.length}${active ? ` · ${active.baslik}` : ""}`;
    chip.classList.toggle("bekliyor", active?.durum === "bekliyor");
    if (small) return;
    box.replaceChildren(...[
      el("div", { class: "sust" },
        el("span", { class: "skim", text: "Claude ile birlikte" }),
        w.bitti
          ? el("button", { class: "btn small", type: "button", text: "Kapat", on: { click: () => { dismissed = w.id; render(); } } })
          : el("button", { class: "btn small", type: "button", text: "Küçült", title: "Panelde çalışmaya devam et; alttaki düğmeyle geri gelir", on: { click: () => { small = true; render(); } } })),
      el("h3", { id: "sihirbaz-baslik", text: w.baslik }),
      el("ol", { class: "sadimlar" }, w.adimlar.map((a) => step(a, a.id === w.aktif))),
      slot,
    ]);
  }

  return {
    /** The wizard from the last poll (null: none). A new wizard opens big. */
    set(w) {
      if ((w?.id ?? null) === (current?.id ?? null) && (w?.seq ?? null) === (current?.seq ?? null)) return; // nothing new: no redraw
      if (w && current?.id !== w.id) small = false;
      current = w;
      render();
    },
    /** Where a question goes, or null when no open wizard can hold it. */
    slot: () => (current && current.id !== dismissed && !small ? slot : null),
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
