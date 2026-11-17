// The object window: the person clicks a character or a prop on the stage and works on just that
// thing with Claude, right next to the stage (which stays in view): its drawing, a new version
// Claude drew (taken in with one click), quick actions, and a short chat (panel-sohbet.mjs).
// Everything from Claude is drawn as text; pictures are only the panel's own drawings.
import { el, svg } from "./dom.js";
import { valueSlider } from "./denetleyici-alan.js";

// a line's feelings (ses.mjs MOODS); "" = none, the character's own flat voice
const MOODS = [["", "Normal"], ["sakin", "Sakin"], ["neseli", "Neşeli"], ["heyecanli", "Heyecanlı"], ["uzgun", "Üzgün"], ["kizgin", "Kızgın"], ["korkmus", "Korkmuş"]];
const VOLUME_STEP = 0.25;
const VOLUME_MAX = 2;
const KIND_TEXT = { karakter: "Karakter", nesne: "Nesne", mekan: "Mekân", replik: "Replik", efekt: "Efekt", cekim: "Çekim" };
const DRAWN = new Set(["karakter", "nesne", "mekan"]); // things with a drawing (a new version is a draft under its id)
const FRAMING_TEXT = { wide: "Geniş", medium: "Orta", close: "Yakın", detay: "Detay", gogus: "Göğüs planı" };
const MOVE_TEXT = { static: "sabit", push_in: "yaklaşıyor", pull_out: "uzaklaşıyor", pan_left: "sola kayıyor", pan_right: "sağa kayıyor", follow: "takip ediyor", dolly_ileri: "derinliğe ilerliyor", acilis: "detaydan açılıyor" };
// One click fills the message box with a start; the person finishes it or sends it as it is.
const QUICK = {
  karakter: ["Çizimi düzelt: ", "Kıyafetini değiştir: ", "Rengini değiştir: ", "Önden görünüşünü çiz", "Yüz ifadesini değiştir: "],
  nesne: ["Çizimi düzelt: ", "Daha büyük çiz", "Rengini değiştir: ", "Başka bir çizim öner"],
  mekan: ["Mekânı değiştir: ", "Daha sade çiz", "Gece yap", "Hikâyeye uyan bir mekân öner"],
  replik: ["Daha duygulu söylesin", "Daha yavaş söylesin", "Metni değiştir: "],
  efekt: ["Başka bir efekt öner", "Daha erken çalsın", "Sesini kıs", "Bu efekti kaldır"],
  cekim: ["Kompozisyonu düzelt", "Kamera yavaşça yaklaşsın", "Bu çekimi daha heyecanlı yap"],
};
const VIEW_TEXT = { yan: "Yandan", on: "Önden", arka: "Arkadan" };
// A small sketch of each shot recipe, so the person sees the composition before choosing it
const SKETCH = {
  omuz: [["ellipse", { cx: 14, cy: 40, rx: 16, ry: 22, class: "koyu" }], ["circle", { cx: 40, cy: 17, r: 6 }], ["rect", { x: 34, y: 24, width: 12, height: 16, rx: 3 }]],
  derin: [["circle", { cx: 16, cy: 14, r: 7 }], ["rect", { x: 9, y: 22, width: 14, height: 22, rx: 3 }], ["circle", { cx: 42, cy: 16, r: 4 }], ["rect", { x: 38, y: 21, width: 8, height: 12, rx: 2 }]],
  takip: [["circle", { cx: 30, cy: 20, r: 6, class: "koyu" }], ["rect", { x: 24, y: 27, width: 12, height: 17, rx: 3, class: "koyu" }], ["path", { d: "M30 12 L30 2 M26 6 L30 2 L34 6", class: "cizgi" }]],
  yakin: [["circle", { cx: 30, cy: 24, r: 15 }], ["circle", { cx: 25, cy: 22, r: 2, class: "koyu" }], ["circle", { cx: 35, cy: 22, r: 2, class: "koyu" }]],
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
  let voice = { phase: "idle" }; // the character's voice: idle | busy, and what to show
  let line = { busy: false, msg: "", take: 0 }; // a line spoken again from its window
  let drawn = 0;
  let shotNote = null; // what the last recipe did, or why it could not // bumped when a drawing changes under the same address, so the browser does not show the old one
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

  /**
   * At the window's right edge, over the properties pane (it shows the same thing), beside the
   * stage: over the stage it hid the very thing that was clicked (usability test 1). When the
   * clicked thing would still be under it, the window goes to the other side.
   */
  function place() {
    const s = ctx.stageBox();
    const width = Math.min(WIDTH, window.innerWidth - 2 * GAP);
    let left = window.innerWidth - width - GAP;
    const sel = document.querySelector("#edit .ebox.sel")?.getBoundingClientRect();
    if (sel && left < sel.right + GAP && left + width > sel.left - GAP) left = Math.max(GAP, Math.min(sel.left - width - GAP, (s?.left ?? GAP)));
    const top = s ? Math.max(GAP, s.top) : 80;
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

  /** The thing itself: its drawing (and a new version), or a line's words and voice, an effect, a shot's camera. */
  function body() {
    if (DRAWN.has(topic.tur)) return drawings(); // the views, the voice, the transition: folded under the chat (extras)
    const g = topic.goster || {};
    if (topic.tur === "replik") {
      return el("div", { class: "npencere-kart" },
        el("p", { class: "npencere-konusan", text: g.konusan || "" }),
        el("blockquote", { text: g.metin || "" }),
        audio(g.ses, "Repliği dinle", line.take),
        el("div", { class: "row" },
          el("button", { class: "btn small", type: "button", "aria-busy": line.busy ? "true" : null, text: line.busy ? "Seslendiriliyor…" : "↻ Yeniden seslendir", title: "Bu repliği yeni bir çekimle yeniden seslendir (ses modeli yüklenirken 1-2 dakika)", on: { click: redoLine } })),
        moodRow(g.duygu || ""),
        volumeRow(Number(g.duzey ?? 1)),
        line.busy ? el("p", { class: "npencere-durum", role: "status" }, el("span", { class: "cark", "aria-hidden": "true" }), "Ses modeli yükleniyor ve replik seslendiriliyor (1-2 dakika)…") : null,
        line.msg ? el("p", { class: "muted small", role: "status", text: line.msg }) : null,
        g.dinleme && !g.dinleme.ok && !g.dinleme.accepted ? el("p", { class: "npencere-hata", text: `Ses kontrolünde farklı duyuldu: “${g.dinleme.heard || ""}”` }) : null);
    }
    if (topic.tur === "efekt") {
      return el("div", { class: "npencere-kart" },
        el("p", { text: `${g.efekt} · ${Number(g.at || 0).toFixed(1)} sn'de çalıyor` }),
        el("audio", { class: "kanal-ses", controls: "", preload: "none", src: `/kutuphane/ses/${encodeURIComponent(g.efekt)}.wav`, "aria-label": "Efekti dinle" }));
    }
    return el("div", { class: "npencere-govde" }, // cekim
      el("div", { class: "npencere-kart" },
        el("p", { text: `${FRAMING_TEXT[g.plan] || g.plan || "?"} plan, kamera ${MOVE_TEXT[g.hareket] || g.hareket}${g.hedef ? `, odak: ${g.hedef}` : ""}` })),
      problems(g.sorunlar || []),
      recipes(g.tarifler || [], g.kisi || 0),
      shotNote ? el("p", { class: shotNote.error ? "npencere-hata" : "muted small", role: "status", text: shotNote.text }) : null);
  }

  /**
   * What is not the main thing, folded below the chat: the chat and its box come first and stay in
   * view (usability test 1: the box sat 776 px down a 640 px window). A fold remembers whether the
   * person opened it; its title says what is set now.
   */
  function extras() {
    if (topic.tur === "karakter") {
      const info = ctx.voiceInfo?.(topic.oyuncu);
      const views = { yan: "yandan", on: "önden", arka: "arkadan" }[topic.goster?.simdi] || "";
      return [
        fold("gorunus", `Görünüş ve yer${views ? ` · ${views}` : ""}`, viewRow()),
        info ? fold("ses", `Ses · ${info.now}`, voiceSection()) : null,
      ];
    }
    if (topic.tur === "mekan") return [transitionRow()];
    return [];
  }

  const openFolds = new Set(); // which folds the person opened (kept across redraws and windows)
  function fold(key, title, content) {
    if (!content) return null;
    const node = el("details", { class: "npencere-katlanir", open: openFolds.has(key) ? "" : null },
      el("summary", { text: title }), content);
    node.addEventListener("toggle", () => (node.open ? openFolds.add(key) : openFolds.delete(key)));
    return node;
  }

  /** How this scene begins after the previous one: a short dip to black, or a hard cut. */
  function transitionRow() {
    const g = topic.goster || {};
    if (g.ilk || !ctx.setTransition) return null; // the first scene has nothing before it
    const options = [["kararma", "Kararma", "Önceki sahneden kısa bir kararmayla geçer"], ["kesme", "Kesme", "Doğrudan kesilir"]];
    return el("div", { class: "npencere-gorunus", role: "radiogroup", "aria-label": "Sahneye geçiş" },
      el("span", { class: "small", text: "Sahneye geçiş:" }),
      ...options.map(([k, t, tip]) => el("button", {
        class: `btn small${g.gecis === k ? " primary" : ""}`, type: "button", role: "radio", "aria-checked": String(g.gecis === k), title: tip, text: t,
        on: { click: () => { if (g.gecis !== k) ctx.setTransition(k); } },
      })));
  }

  /** The person in another view, in this shot: one click, no waiting. */
  function viewRow() {
    const g = topic.goster || {};
    if (!g.gorunusler) return null;
    return el("div", { class: "npencere-gorunus", role: "group", "aria-label": "Görünüş" },
      ctx.recenter ? el("button", { class: "btn small", type: "button", text: "Kadraja al", title: "Kişiyi işaretine, öne geri getir (kadrajın dışına kaydıysa)", on: { click: () => ctx.recenter(topic.oyuncu) } }) : null,
      el("span", { class: "small", text: "Görünüş:" }),
      ...Object.keys(VIEW_TEXT).map((k) => {
        const drawn = !!g.gorunusler[k];
        const on = g.simdi === k;
        return el("button", {
          class: `btn small${on ? " primary" : ""}`, type: "button", "aria-pressed": String(on), disabled: drawn ? null : "",
          title: drawn ? `Bu çekimde ${VIEW_TEXT[k].toLowerCase()} göster` : "Bu görünüş çizilmemiş: Claude'dan çizmesini iste",
          text: VIEW_TEXT[k], on: { click: () => { if (!on) setView(k); } },
        });
      }));
  }

  function setView(kind) {
    const why = ctx.setView?.(topic.oyuncu, kind);
    if (why) {
      error = why;
      render();
    }
  }

  /** What the film rules say about this shot (or its scene), each with a way to have Claude fix it. */
  function problems(list) {
    if (!list.length) return el("p", { class: "muted small", text: "Çekim kurallarına göre bir sorun yok." });
    return el("section", { class: "npencere-sorunlar", "aria-label": "Çekim sorunları" },
      el("h3", { text: `Sorunlar (${list.length})` }),
      el("ul", {}, list.map((p) => el("li", {},
        el("p", { text: p.metin }),
        el("button", { class: "btn small ghost", type: "button", text: "Claude düzeltsin", on: { click: () => send(`Bu sorunu düzelt: ${p.metin}`) } })))));
  }

  /** Ready compositions, applied at once (undo takes them back). */
  function recipes(list, people) {
    if (!list.length) return null;
    return el("section", { class: "npencere-tarifler", "aria-label": "Kompozisyon" },
      el("h3", { text: "Kompozisyon" }),
      el("div", { class: "tarif-kartlar" }, list.map((t) => {
        const fits = people >= t.kisi;
        return el("button", {
          class: "tarif-kart", type: "button", disabled: fits ? null : "", title: fits ? `${t.not}. Hemen uygulanır; beğenmezsen geri al.` : "Bu tarif için çekimde iki kişi olmalı",
          on: { click: () => recipe(t.id) },
        }, svg("svg", { viewBox: "0 0 60 48", "aria-hidden": "true", class: "tarif-cizim" }, ...SKETCH[t.id].map(([tag, a]) => svg(tag, a))),
        el("strong", { text: t.ad }), el("small", { text: t.not }));
      })));
  }

  function recipe(id) {
    const why = ctx.applyRecipe?.(id);
    shotNote = why ? { error: true, text: why } : { text: "Uygulandı: sahnede gör. Beğenmezsen geri al (Ctrl+Z)." };
    render();
  }

  /** A spoken line to play, if its file is there (no audio yet: no player). */
  function audio(path, label, take = 0) {
    if (!path) return null;
    const node = el("audio", { class: "kanal-ses", controls: "", preload: "metadata", src: `/satir-ses/${path.split("/").map(encodeURIComponent).join("/")}?v=${chats.seq}-${take}`, "aria-label": label });
    node.addEventListener("error", () => node.replaceWith(el("p", { class: "muted small", text: "Bu replik henüz seslendirilmedi." })));
    return node;
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

  /** The character's voice, right here: a ready voice, its pitch and speed, a sample. Nothing waits for Claude. */
  function voiceSection() {
    const info = ctx.voiceInfo?.(topic.oyuncu);
    if (!info) return null;
    const shared = info.owner !== topic.oyuncu ? el("p", { class: "muted small", text: `Bu görünüş ${info.ad} ile aynı sesi kullanır.` }) : null;
    const signed = (unit) => (x) => `${x > 0 ? "+" : ""}${Math.round(x)} ${unit}`;
    const parts = [shared, readyVoices(info), // the fold's title says the voice now
      el("div", { class: "npencere-ayar" },
        el("span", { class: "muted small", text: "Perde (kalın – ince)" }),
        valueSlider(info.perde, { min: -30, max: 30, step: 1, label: "Ses perdesi (Hz)", show: signed("Hz"), onSet: (x) => tune("perde", x) })),
      el("div", { class: "npencere-ayar" },
        el("span", { class: "muted small", text: "Hız (yavaş – hızlı)" }),
        valueSlider(info.hiz, { min: -30, max: 30, step: 1, label: "Konuşma hızı (%)", show: signed("%"), onSet: (x) => tune("hiz", x) })),
      el("div", { class: "row" },
        el("button", { class: "btn small", type: "button", "aria-busy": voice.phase === "busy" ? "true" : null, text: voice.phase === "busy" ? "Hazırlanıyor…" : "▶ Örnek dinle", title: "Bu sesle bir cümle (birkaç saniye; internet gerekir)", on: { click: sample } }))];
    if (voice.phase === "busy") parts.push(el("p", { class: "npencere-durum", role: "status" }, el("span", { class: "cark", "aria-hidden": "true" }), voice.msg || "Hazırlanıyor…"));
    else if (voice.msg) parts.push(el("p", { class: voice.error ? "npencere-hata" : "muted small", role: "status", text: voice.msg }));
    if (voice.sampleUrl && voice.phase === "idle") parts.push(el("audio", { class: "kanal-ses", controls: "", autoplay: "", src: voice.sampleUrl, "aria-label": "Ses örneği" }));
    parts.push(el("p", { class: "muted small", text: "Sesler Microsoft Edge'in çevrimiçi sesleriyle yapılır: yalnız replik metni gönderilir." }));
    return el("section", { class: "npencere-ses", "aria-label": "Ses" }, ...parts.filter(Boolean));
  }

  /** The library's ready voices: hear each one, pick one with a click. */
  function readyVoices(info) {
    if (!info.voices.length) return null;
    return el("ul", { class: "hazir-sesler", "aria-label": "Hazır sesler" }, info.voices.map((v) => {
      const on = info.hazir === v.id;
      return el("li", { class: on ? "secili" : "" },
        el("button", { class: "btn icon small", type: "button", "aria-label": `${v.label} sesini dinle`, title: "Dinle (ilk seferde birkaç saniye)", text: "▶", on: { click: () => preview(v.id) } }),
        el("span", {}, el("strong", { text: v.label }), v.note ? el("small", { class: "muted", text: v.note }) : null),
        on ? el("span", { class: "small", text: "✓ seçili" })
          : el("button", { class: "btn small", type: "button", disabled: voice.phase === "busy" ? "" : null, text: "Seç", on: { click: () => pickReady(v.id) } }));
    }));
  }

  let player = null;
  function preview(id) {
    player?.pause();
    player = new Audio(`/kutuphane/sesler/${encodeURIComponent(id)}.wav`);
    player.play().catch(() => {
      voice = { phase: "idle", error: true, msg: "Örnek çalınamadı: internet bağlantısını denetle." };
      render();
    });
  }

  async function pickReady(id) {
    player?.pause();
    voice = { phase: "busy", msg: "Ses seçiliyor…" };
    render();
    try {
      voice = { phase: "idle", msg: await ctx.useReady(topic.oyuncu, id) };
    } catch (err) {
      voice = { phase: "idle", error: true, msg: `Olmadı: ${err.message}` };
    }
    render();
  }

  /** The pitch (perde, Hz) or speed (hiz, %) of this character's voice, on top of its ready voice. */
  async function tune(key, value) {
    try {
      voice = { phase: "idle", msg: await ctx.tuneVoice(topic.oyuncu, key, value) };
    } catch (err) {
      voice = { phase: "idle", error: true, msg: `Olmadı: ${err.message}` };
    }
    render();
  }

  async function sample() {
    if (voice.phase === "busy") return;
    voice = { phase: "busy", msg: "Ses örneği hazırlanıyor…" };
    render();
    try {
      voice = { phase: "idle", sampleUrl: await ctx.sample(topic.oyuncu) };
    } catch (err) {
      voice = { phase: "idle", error: true, msg: `Örnek olmadı: ${err.message}` };
    }
    render();
  }

  /** How the line is said: one press sets the feeling and speaks the line again with it. */
  function moodRow(now) {
    return el("div", { class: "npencere-duygu", role: "group", "aria-label": "Duygu" },
      el("span", { class: "muted small", text: "Duygu" }),
      el("div", { class: "row" }, MOODS.map(([id, label]) => el("button", {
        type: "button", class: "ncip", "aria-pressed": String(now === id), disabled: line.busy,
        title: id ? `“${label}” söylesin: bu replik yeniden seslendirilir` : "Duygusuz, karakterin kendi sesi",
        on: { click: () => setMood(id) },
      }, label))));
  }

  /** The line's loudness: − / + by 25%, 0-200% (100% = every line's common level). */
  function volumeRow(now) {
    const step = (d) => {
      const v = Math.min(VOLUME_MAX, Math.max(0, Math.round((now + d) * 100) / 100));
      ctx.setLineVolume(topic.id, v);
      topic = { ...topic, goster: { ...topic.goster, duzey: v } };
      render();
    };
    return el("div", { class: "npencere-duzey", role: "group", "aria-label": "Ses düzeyi" },
      el("span", { class: "muted small", text: "Ses düzeyi" }),
      el("button", { type: "button", class: "btn small", "aria-label": "Sesi kıs", disabled: now <= 0, on: { click: () => step(-VOLUME_STEP) } }, "−"),
      el("output", { class: "npencere-duzey-v", text: `%${Math.round(now * 100)}` }),
      el("button", { type: "button", class: "btn small", "aria-label": "Sesi aç", disabled: now >= VOLUME_MAX, on: { click: () => step(VOLUME_STEP) } }, "+"));
  }

  async function setMood(duygu) {
    if (line.busy || topic?.tur !== "replik") return;
    const key = topic.id;
    line = { ...line, busy: true, msg: "" };
    topic = { ...topic, goster: { ...topic.goster, duygu } }; // the chip shows the choice at once
    render();
    try {
      await ctx.setLineMood(key, duygu || undefined);
      const msg = await ctx.redoLine(key);
      line = { busy: false, msg, take: line.take + 1 };
    } catch (err) {
      line = { ...line, busy: false, msg: `Olmadı: ${err.message}` };
    }
    if (topic?.id === key) render();
  }

  async function redoLine() {
    if (line.busy || topic?.tur !== "replik") return;
    const key = topic.id;
    line = { ...line, busy: true, msg: "" };
    render();
    try {
      const msg = await ctx.redoLine(key);
      line = { busy: false, msg, take: line.take + 1 };
    } catch (err) {
      line = { ...line, busy: false, msg: `Olmadı: ${err.message}` };
    }
    if (topic?.id === key) render();
  }

  function message(m) {
    const mine = m.kim === "kisi";
    return el("li", { class: `nmesaj ${mine ? "kisi" : "claude"}` },
      el("span", { class: "nmesaj-kim", text: mine ? "Sen" : "Claude" }),
      m.metin ? el("p", { text: m.metin }) : null,
      m.ses ? audio(m.ses, "Claude'un seslendirdiği replik") : null,
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
        el("div", { class: "row" },
          topic.tur === "mekan" && ctx.openShot ? el("button", { class: "btn small", type: "button", text: "Bu çekimin kamerası", title: "Kamera ve kompozisyon", on: { click: () => ctx.openShot() } }) : null,
          el("button", { class: "btn icon", type: "button", "aria-label": "Pencereyi kapat", title: "Kapat (Esc)", text: "✕", on: { click: close } }))),
      body(),
      error ? el("p", { class: "npencere-hata", role: "alert", text: error }) : null,
      list,
      working,
      offline,
      el("div", { class: "npencere-yaz" },
        input,
        el("button", { class: "btn primary", type: "button", "aria-busy": sending ? "true" : null, text: sending ? "Gönderiliyor…" : "Gönder", on: { click: () => send() } })),
      el("div", { class: "npencere-hizli", role: "group", "aria-label": "Hızlı istekler" },
        QUICK[topic.tur].map((q) => el("button", { class: "btn small", type: "button", text: q.replace(/: $/, ""), on: { click: () => quick(q) } }))),
      ...extras(),
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
    voice = { phase: "idle" };
    topic = null;
    error = "";
    render();
  }

  window.addEventListener("resize", () => topic && place());

  return {
    /** Open (or move) the window on what the person clicked. */
    open(t) {
      document.getElementById("studyo-ipucu")?.setAttribute("hidden", ""); // the window says the rest: the hint goes at once
      const same = topic && t && t.tur === topic.tur && t.id === topic.id;
      topic = t;
      if (!same) {
        error = "";
        shotNote = null;
        input.value = "";
        voice = { phase: "idle" };
        line = { busy: false, msg: "", take: 0 };
      }
      render();
    },
    close,
    isOpen: () => !!topic,
    current: () => topic,
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
