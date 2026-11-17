// The object window: the person clicks a character or a prop on the stage and works on just that
// thing with Claude, right next to the stage (which stays in view): its drawing, a new version
// Claude drew (taken in with one click), quick actions, and a short chat (panel-sohbet.mjs).
// Everything from Claude is drawn as text; pictures are only the panel's own drawings.
import { el } from "./dom.js";
import { startRecording, fileToWav, MAX_RECORD_S } from "./kayit.js";

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
  cekim: ["Omuz üstü çek", "İki kişiyi derinlikli göster", "Yakın çekim yap", "Kamera yavaşça yaklaşsın", "Kompozisyonu düzelt"],
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
  let voice = { phase: "idle" }; // the character's voice: idle | recording | recorded | busy, and what to show
  let recorder = null;
  let line = { busy: false, msg: "", take: 0 }; // a line spoken again from its window
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

  /** The thing itself: its drawing (and a new version), or a line's words and voice, an effect, a shot's camera. */
  function body() {
    if (topic.tur === "karakter") return el("div", { class: "npencere-govde" }, drawings(), voiceSection());
    if (DRAWN.has(topic.tur)) return drawings();
    const g = topic.goster || {};
    if (topic.tur === "replik") {
      return el("div", { class: "npencere-kart" },
        el("p", { class: "npencere-konusan", text: g.konusan || "" }),
        el("blockquote", { text: g.metin || "" }),
        audio(g.ses, "Repliği dinle", line.take),
        el("div", { class: "row" },
          el("button", { class: "btn small", type: "button", "aria-busy": line.busy ? "true" : null, text: line.busy ? "Seslendiriliyor…" : "↻ Yeniden seslendir", title: "Bu repliği yeni bir çekimle yeniden seslendir (ses modeli yüklenirken 1-2 dakika)", on: { click: redoLine } })),
        line.busy ? el("p", { class: "npencere-durum", role: "status" }, el("span", { class: "cark", "aria-hidden": "true" }), "Ses modeli yükleniyor ve replik seslendiriliyor (1-2 dakika)…") : null,
        line.msg ? el("p", { class: "muted small", role: "status", text: line.msg }) : null,
        g.dinleme && !g.dinleme.ok && !g.dinleme.accepted ? el("p", { class: "npencere-hata", text: `Ses kontrolünde farklı duyuldu: “${g.dinleme.heard || ""}”` }) : null);
    }
    if (topic.tur === "efekt") {
      return el("div", { class: "npencere-kart" },
        el("p", { text: `${g.efekt} · ${Number(g.at || 0).toFixed(1)} sn'de çalıyor` }),
        el("audio", { class: "kanal-ses", controls: "", preload: "none", src: `/kutuphane/ses/${encodeURIComponent(g.efekt)}.wav`, "aria-label": "Efekti dinle" }));
    }
    return el("div", { class: "npencere-kart" }, // cekim
      el("p", { text: `${FRAMING_TEXT[g.plan] || g.plan || "?"} plan, kamera ${MOVE_TEXT[g.hareket] || g.hareket}${g.hedef ? `, odak: ${g.hedef}` : ""}` }));
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

  /** The character's voice, right here: record your own, hear a sample. Nothing waits for Claude. */
  function voiceSection() {
    const info = ctx.voiceInfo?.(topic.oyuncu);
    if (!info) return null;
    const shared = info.owner !== topic.oyuncu ? el("p", { class: "muted small", text: `Bu görünüş ${info.ad} ile aynı sesi kullanır.` }) : null;
    const parts = [el("h3", { text: "Ses" }), el("p", { class: "small", text: `Şimdi: ${info.now}` }), shared];
    if (voice.phase === "recording") {
      parts.push(
        el("div", { class: "kayit-olcer", "aria-hidden": "true" }, el("span", { style: { width: "0%" } })),
        el("p", { class: "small kayit-sure", role: "status", text: `Kaydediliyor: 0 / ${MAX_RECORD_S} sn. Bir iki cümle oku, sonra durdur.` }),
        el("button", { class: "btn primary small", type: "button", text: "■ Durdur", on: { click: stopRecording } }));
    } else if (voice.phase === "recorded") {
      parts.push(
        el("audio", { class: "kanal-ses", controls: "", src: voice.url, "aria-label": "Kaydını dinle" }),
        el("div", { class: "row" },
          el("button", { class: "btn primary small", type: "button", text: "Bu sesi kullan", on: { click: useRecording } }),
          el("button", { class: "btn small", type: "button", text: "Yeniden kaydet", on: { click: record } })));
    } else {
      parts.push(el("div", { class: "row" },
        el("button", { class: "btn small", type: "button", text: "🎙 Sesimi kaydet", title: `${MAX_RECORD_S} saniyeye kadar: bu karakter senin sesinle konuşur`, on: { click: record } }),
        el("label", { class: "btn small", title: "Telefonda kaydettiğin bir ses dosyası (m4a, mp3, wav): ilk 20 saniyesi alınır" }, "📁 Dosyadan seç",
          el("input", { type: "file", accept: "audio/*", class: "gizli", on: { change: (e) => fromFile(e.target.files?.[0]) } })),
        el("button", { class: "btn small", type: "button", "aria-busy": voice.phase === "busy" ? "true" : null, text: voice.phase === "busy" ? "Hazırlanıyor…" : "▶ Örnek dinle", title: "Bu sesle bir cümle (ses modeli yüklenirken 1-2 dakika)", on: { click: sample } })));
    }
    if (voice.phase === "busy") parts.push(el("p", { class: "npencere-durum", role: "status" }, el("span", { class: "cark", "aria-hidden": "true" }), voice.msg || "Hazırlanıyor…"));
    else if (voice.msg) parts.push(el("p", { class: voice.error ? "npencere-hata" : "muted small", role: "status", text: voice.msg }));
    if (voice.sampleUrl && voice.phase === "idle") parts.push(el("audio", { class: "kanal-ses", controls: "", autoplay: "", src: voice.sampleUrl, "aria-label": "Ses örneği" }));
    parts.push(el("p", { class: "muted small", text: "Yalnız kendi sesini ya da kullanma hakkın olan bir sesi kaydet." }));
    return el("section", { class: "npencere-ses", "aria-label": "Ses" }, ...parts.filter(Boolean));
  }

  async function record() {
    if (recorder || voice.phase === "busy") return;
    voice = { phase: "recording" };
    render();
    try {
      const rec = await startRecording({ onLevel: (level, secs) => {
        // update in place: a redraw every few milliseconds would drop the person's clicks
        const meter = box.querySelector(".kayit-olcer span");
        if (meter) meter.style.width = `${Math.round(Math.min(1, level * 2) * 100)}%`;
        const note = box.querySelector(".kayit-sure");
        if (note) note.textContent = `Kaydediliyor: ${secs.toFixed(0)} / ${MAX_RECORD_S} sn. Bir iki cümle oku, sonra durdur.`;
      } });
      if (voice.phase !== "recording") return rec.cancel(); // the window moved on meanwhile
      recorder = rec;
      recorder.onLimit = () => stopRecording();
    } catch (err) {
      // the app's built-in browser blocks the microphone: say how to record anyway
      const blocked = err?.name === "NotAllowedError" || /denied|permission/i.test(err?.message || "");
      voice = { phase: "idle", error: true, msg: blocked
        ? `Bu pencerede mikrofon kapalı. Kaydı telefonunla yapıp “Dosyadan seç” ile ekle, ya da paneli Chrome'da aç: ${location.origin}`
        : `Mikrofon açılamadı: ${err.message}` };
      render();
    }
  }

  async function fromFile(file) {
    if (!file) return;
    voice = { phase: "busy", msg: "Dosya okunuyor…" };
    render();
    try {
      const out = await fileToWav(file);
      voice = { phase: "recorded", url: URL.createObjectURL(out.blob), base64: out.base64 };
    } catch (err) {
      voice = { phase: "idle", error: true, msg: err.message };
    }
    render();
  }

  async function stopRecording() {
    if (!recorder) return;
    const rec = recorder;
    recorder = null;
    const out = await rec.stop();
    voice = { phase: "recorded", url: URL.createObjectURL(out.blob), base64: out.base64 };
    render();
  }

  async function useRecording() {
    const base64 = voice.base64;
    voice = { phase: "busy", msg: "Kayıt karakterin sesi yapılıyor…" };
    render();
    try {
      voice = { phase: "idle", msg: await ctx.useRecording(topic.oyuncu, base64) };
    } catch (err) {
      voice = { phase: "idle", error: true, msg: `Olmadı: ${err.message}` };
    }
    render();
  }

  async function sample() {
    if (voice.phase === "busy") return;
    voice = { phase: "busy", msg: "Ses örneği hazırlanıyor (ses modeli yüklenirken 1-2 dakika)…" };
    render();
    try {
      voice = { phase: "idle", sampleUrl: await ctx.sample(topic.oyuncu) };
    } catch (err) {
      voice = { phase: "idle", error: true, msg: `Örnek olmadı: ${err.message}` };
    }
    render();
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
    recorder?.cancel();
    recorder = null;
    voice = { phase: "idle" };
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
        recorder?.cancel();
        recorder = null;
        voice = { phase: "idle" };
        line = { busy: false, msg: "", take: 0 };
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
