// The object window: the person clicks a character or a prop on the stage and works on just that
// thing with Claude, right next to the stage (which stays in view): its drawing, a new version
// Claude drew (taken in with one click), quick actions, and a short chat (panel-sohbet.mjs).
// Everything from Claude is drawn as text; pictures are only the panel's own drawings.
import { el } from "./dom.js";

const KIND_TEXT = { karakter: "Karakter", nesne: "Nesne" };
// One click fills the message box with a start; the person finishes it or sends it as it is.
const QUICK = {
  karakter: ["Çizimi düzelt: ", "Kıyafetini değiştir: ", "Rengini değiştir: ", "Önden görünüşünü çiz", "Yüz ifadesini değiştir: "],
  nesne: ["Çizimi düzelt: ", "Daha büyük çiz", "Rengini değiştir: ", "Başka bir çizim öner"],
};
const WIDTH = 380;
const GAP = 12;
const MAX_HEIGHT = 640; // the stage under it stays mostly in view; the window scrolls inside

/**
 * @param {{api:(path:string, body?:object) => Promise<any>, draftOf:(tur:string, id:string) => object|null,
 *          takeDraft:(tur:string, id:string) => Promise<string>, rejectDraft:(tur:string, id:string) => Promise<string>,
 *          stageBox:() => DOMRect|null, after:() => void}} ctx
 */
export function createObjectWindow(ctx) {
  let topic = null; // {tur, id, ad, bolum, shot, oyuncu}
  let chats = { seq: -1, sohbetler: [] };
  let listening = false;
  let sending = false;
  let error = "";
  let taking = ""; // "al" | "reddet" while a draft action runs
  let shownSeq = -1;
  let drawn = 0; // bumped when a drawing changes under the same address, so the browser does not show the old one
  const box = el("section", { class: "npencere", role: "dialog", "aria-modal": "false", "aria-labelledby": "npencere-ad", hidden: true });
  document.body.append(box);
  const input = el("textarea", { rows: "2", maxlength: "2000", placeholder: "Bu şey için Claude'a yaz", "aria-label": "Claude'a mesaj" });
  input.addEventListener("keydown", (e) => {
    e.stopPropagation(); // the editor's shortcuts stay out of the box
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
    if (e.key === "Escape") close();
  });
  box.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  const key = () => (topic ? `${topic.tur}:${topic.id}` : "");
  const chat = () => chats.sohbetler.find((c) => `${c.konu.tur}:${c.konu.id}` === key()) || null;

  function place() {
    const s = ctx.stageBox();
    const width = Math.min(WIDTH, window.innerWidth - 2 * GAP);
    const left = s ? Math.max(GAP, Math.min(s.right - width - GAP, window.innerWidth - width - GAP)) : window.innerWidth - width - GAP;
    const top = s ? Math.max(GAP, s.top + GAP) : 80;
    Object.assign(box.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, maxHeight: `${Math.max(320, Math.min(MAX_HEIGHT, window.innerHeight - top - GAP))}px` });
  }

  async function send(text = input.value) {
    const metin = text.trim();
    if (!metin) {
      error = "Ne istediğini yaz ya da yukarıdan bir düğme seç.";
      render();
      input.focus();
      return;
    }
    if (sending || !topic) return;
    sending = true;
    error = "";
    render();
    try {
      const res = await ctx.api("/api/kanal/sohbet", { konu: topic, metin });
      listening = res.dinliyor;
      input.value = "";
    } catch (err) {
      error = `Gönderilemedi: ${err.message}`;
    } finally {
      sending = false;
    }
    render();
    input.focus();
  }

  async function draftAction(islem) {
    if (taking || !topic) return;
    taking = islem;
    error = "";
    render();
    const why = islem === "al" ? await ctx.takeDraft(topic.tur, topic.id) : await ctx.rejectDraft(topic.tur, topic.id);
    taking = "";
    if (why) error = why;
    else {
      drawn += 1;
      ctx.after(); // the stage shows the new drawing
    }
    render();
  }

  // A new version Claude drew under the same id: side by side with the current drawing.
  function drawings() {
    const now = el("figure", { class: "npencere-cizim" },
      el("img", { src: `/kutuphane/${topic.tur}/${topic.id}.svg?v=${chats.seq}-${drawn}`, alt: `${topic.ad || topic.id}: şimdiki çizim` }),
      el("figcaption", { text: "Şimdiki" }));
    const draft = ctx.draftOf(topic.tur, topic.id);
    if (!draft) return el("div", { class: "npencere-cizimler" }, now);
    const ok = draft.ok !== false;
    return el("div", { class: "npencere-cizimler iki" },
      now,
      el("figure", { class: "npencere-cizim yeni" },
        el("img", { src: `/kutuphane-taslak/${topic.tur}/${topic.id}.svg?v=${chats.seq}-${drawn}`, alt: `${topic.ad || topic.id}: Claude'un yeni çizimi` }),
        el("figcaption", { text: ok ? "Claude'un yeni çizimi" : "Yeni çizimde hata var" }),
        ok ? el("div", { class: "row" },
          el("button", { class: "btn primary small", type: "button", "aria-busy": taking === "al" ? "true" : null, text: taking === "al" ? "Alınıyor…" : "Al", on: { click: () => draftAction("al") } }),
          el("button", { class: "btn small", type: "button", text: taking === "reddet" ? "…" : "İstemiyorum", on: { click: () => draftAction("reddet") } }))
          : el("p", { class: "npencere-hata", text: (draft.errors || []).join("; ").slice(0, 300) })));
  }

  function message(m) {
    const mine = m.kim === "kisi";
    return el("li", { class: `nmesaj ${mine ? "kisi" : "claude"}` },
      el("span", { class: "nmesaj-kim", text: mine ? "Sen" : "Claude" }),
      m.metin ? el("p", { text: m.metin }) : null,
      m.gorsel?.length ? el("div", { class: "nmesaj-resimler" }, m.gorsel.map((src) => el("img", { src: `${src}?v=${chats.seq}`, alt: "Claude'un gösterdiği çizim", loading: "lazy" }))) : null,
      m.oneriler?.length ? el("div", { class: "nmesaj-oneriler" }, m.oneriler.map((o) => el("button", { class: "btn small ghost", type: "button", text: o, on: { click: () => send(o) } }))) : null);
  }

  function render() {
    box.hidden = !topic;
    if (!topic) return;
    place();
    const c = chat();
    const list = el("ol", { class: "nmesajlar", "aria-live": "polite" }, (c?.mesajlar || []).map(message));
    const working = c?.durum
      ? el("p", { class: "npencere-durum", role: "status" }, el("span", { class: "cark", "aria-hidden": "true" }), c.durum)
      : null;
    const offline = !listening && !c?.durum
      ? el("p", { class: "muted small", text: "Claude şu an dinlemiyor olabilir: yazdığın sıraya girer, işi bitince görür." })
      : null;
    const typed = input.value;
    const typing = document.activeElement === input ? [input.selectionStart, input.selectionEnd] : null;
    box.replaceChildren(...[
      el("header", { class: "npencere-bas" },
        el("div", {},
          el("h2", { id: "npencere-ad", text: topic.ad || topic.id }),
          el("span", { class: "muted small", text: `${KIND_TEXT[topic.tur]} · ${topic.id}` })),
        el("button", { class: "btn icon", type: "button", "aria-label": "Pencereyi kapat", title: "Kapat (Esc)", text: "✕", on: { click: close } })),
      drawings(),
      el("div", { class: "npencere-hizli", role: "group", "aria-label": "Hızlı istekler" },
        QUICK[topic.tur].map((q) => el("button", { class: "btn small", type: "button", text: q.replace(/: $/, ""), on: { click: () => quick(q) } }))),
      list,
      working,
      offline,
      error ? el("p", { class: "npencere-hata", role: "alert", text: error }) : null,
      el("div", { class: "npencere-yaz" },
        input,
        el("button", { class: "btn primary", type: "button", "aria-busy": sending ? "true" : null, text: sending ? "Gönderiliyor…" : "Gönder", on: { click: () => send() } })),
    ].filter(Boolean)); // replaceChildren would write "null" for a part left out
    input.value = typed;
    if (typing) {
      input.focus(); // a redraw while the person types (Claude answered) must not take the cursor away
      input.setSelectionRange(...typing);
    }
    list.scrollTop = list.scrollHeight;
  }

  function quick(start) {
    if (!/: $/.test(start)) return send(start); // a whole request: send it now
    input.value = start;
    input.focus();
    input.setSelectionRange(start.length, start.length);
  }

  function close() {
    topic = null;
    error = "";
    render();
  }

  window.addEventListener("resize", () => topic && place());

  return {
    /** Open (or move) the window on what the person clicked. */
    open(t) {
      const same = topic && t && t.tur === topic.tur && t.id === topic.id;
      topic = t;
      if (!same) {
        error = "";
        input.value = "";
      }
      render();
    },
    close,
    isOpen: () => !!topic,
    /** The poll's conversations (GET /api/kanal → sohbet) and whether Claude listens. */
    update(state, dinliyor) {
      listening = !!dinliyor;
      if (!state || state.seq === shownSeq) return;
      chats = state;
      shownSeq = state.seq;
      if (topic) render();
    },
    /** The drafts changed (a new version came, or was taken): redraw the pictures. */
    refresh() {
      if (topic) render();
    },
  };
}
