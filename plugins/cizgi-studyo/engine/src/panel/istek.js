// "Claude'a yaz": the person picks something (a character on the stage, a prop, a line, a
// shot, a scene) and writes what they want; the request goes to the Claude session's queue
// and its state and Claude's answer show here. The same poll notices when bolum.json
// changed on disk (Claude edited it) and reloads it, or asks first when there are unsaved edits.
//
// A short task, so it stays inline in the inspector's drawer: what it is about as chips (the
// picked thing first), the text box with its label, and the requests as status lines. The form
// is built once and only its changing parts are redrawn, so the 2-second poll never takes the
// focus from the box the person is typing in.
import { el } from "./dom.js";

const POLL_MS = 2000;
const MAX_TEXT = 2000;
const LABEL_MAX = 100;
const STATE_TEXT = {
  bekliyor: "Sırada",
  iletildi: "Claude'a iletildi",
  alindi: "Claude çalışıyor",
  yapildi: "Yapıldı",
  soru: "Claude soruyor",
  olmadi: "Olmadı",
  bayat: "Yanıtsız kaldı",
};
const SEND_TEXT = "✦ Claude'a gönder";
const HINT = "Seçtiğin şeyle ilgili ne istediğini yaz · Ctrl+Enter ile gönder";
const EMPTY_TEXT = "Önce Claude'a ne yapmasını istediğini yaz; örneğin “el sallasın, sonra banka yürüsün”.";
const OFF_TEXT = "Bu panel bir Claude oturumuna bağlı değil. İstek göndermek için paneli Claude'da /cizgi-studyo ile aç.";
const cut = (s) => (s.length > LABEL_MAX ? `${s.slice(0, LABEL_MAX - 1)}…` : s);

/**
 * The "Claude'a yaz" drawer and the poll behind it.
 * @param {HTMLElement} box the <details> drawer it fills
 * @param {{path:() => string|null, episode:() => object|null, current:() => {shot:object, scene:object}|null,
 *          sel:() => {kind:string|null, index:number}, labelOf:(id:string) => string, now:() => number|null,
 *          version:() => string, dirty:() => boolean, saving:() => boolean, reload:() => Promise<void>, note:(text:string) => void,
 *          api:(path:string, body?:object) => Promise<any>, storyVersion?:(v:any) => void, draftsVersion?:(v:any) => void}} ctx
 * @returns {{renderTarget:() => void, start:() => void}}
 */
export function createRequests(box, ctx) {
  let session = null; // null: not asked yet · true/false: a Claude session listens
  let list = [];
  let error = "";
  let changedOnDisk = null; // the version on disk when it differs and the person has unsaved edits
  let timer = 0;
  let busy = false;
  let shownWaiting = "|"; // what last opened the drawer, so closing it sticks
  let options = [];
  let chosen = 0;

  const text = el("textarea", { id: "ist-metin", rows: "3", maxlength: String(MAX_TEXT), placeholder: "Örnek: el sallasın, sonra banka yürüsün", "aria-describedby": "ist-ipucu" });
  const hint = el("p", { id: "ist-ipucu", class: "pfield-ipucu", text: HINT });
  const field = el("div", { class: "pfield" }, el("label", { class: "pfield-ad", for: "ist-metin", text: "Ne istiyorsun?" }), text, hint);
  const chips = el("div", { class: "ist-hedefler", role: "group", "aria-labelledby": "ist-hedef-ad" });
  const send = el("button", { class: "btn primary small", type: "button", text: SEND_TEXT, title: "Gönder (Ctrl+Enter)" });
  const summary = el("summary", { class: "chead" });
  const offSlot = el("div", { class: "ist-yuva" });
  const diskSlot = el("div", { class: "ist-yuva" });
  const waitSlot = el("div", { class: "ist-yuva" });
  const errSlot = el("div", { class: "ist-yuva" });
  const listSlot = el("div", { class: "ist-yuva ist-istekler" });
  box.replaceChildren(summary, el("div", { class: "ist" },
    offSlot, diskSlot,
    el("div", { class: "ist-form" },
      el("div", { class: "ist-konu" }, el("span", { id: "ist-hedef-ad", class: "pfield-ad", text: "Konu" }), chips),
      field,
      el("div", { class: "ist-alt" }, send)),
    waitSlot, errSlot, listSlot));

  /** The hint slot under the box shows the error instead while there is one. */
  function fieldError(message) {
    hint.className = message ? "pfield-hata" : "pfield-ipucu";
    hint.textContent = message || HINT;
    field.classList.toggle("hatali", !!message);
    if (message) text.setAttribute("aria-invalid", "true");
    else text.removeAttribute("aria-invalid");
  }

  /** What a request can be about, most specific first: the selected thing, its shot, scene, the episode. */
  function targets() {
    const ep = ctx.episode();
    if (!ep) return [];
    const f = ctx.current();
    const out = [];
    if (f) {
      const { kind, index } = ctx.sel();
      const base = { shot: f.shot.shot_id, sahne: f.scene.scene_id };
      const m = kind === "cast" ? f.shot.cast[index] : null;
      const p = kind === "prop" ? f.shot.props?.[index] : null;
      const s = kind === "sfx" ? f.shot.sfx?.[index] : null;
      const u = kind === "line" ? f.shot.utterances?.[index] : null;
      if (m) out.push({ label: `${ctx.labelOf(m.id)} (karakter, ${base.shot})`, hedef: { tur: "karakter", ...base, id: m.id, etiket: cut(ctx.labelOf(m.id)) } });
      if (p) out.push({ label: `${p.prop} (nesne, ${base.shot})`, hedef: { tur: "nesne", ...base, id: p.id, etiket: cut(p.prop) } });
      if (s) out.push({ label: `${s.sfx} (efekt, ${base.shot})`, hedef: { tur: "efekt", ...base, index, etiket: cut(s.sfx) } });
      if (u) out.push({ label: cut(`${ctx.labelOf(u.speaker)}: “${u.text}”`), hedef: { tur: "replik", ...base, index, etiket: cut(`${ctx.labelOf(u.speaker)}: ${u.text}`) } });
      out.push({ label: `Shot ${base.shot}`, hedef: { tur: "shot", ...base, etiket: base.shot } });
      const sceneName = f.scene.title || `Sahne ${f.scene.scene_id}`;
      out.push({ label: `Sahne: ${sceneName}`, hedef: { tur: "sahne", sahne: f.scene.scene_id, etiket: cut(sceneName) } });
    }
    out.push({ label: "Bütün bölüm", hedef: { tur: "bolum", etiket: cut(ep.title || ep.episode) } });
    return out;
  }

  function drawChips() {
    chips.replaceChildren(...(options.length
      ? options.map((o, i) => el("button", {
        class: `ist-cip${i === chosen ? " secili" : ""}`, type: "button", "aria-pressed": String(i === chosen), title: o.label, text: o.label,
        on: { click: () => { chosen = i; drawChips(); chips.children[i]?.focus(); } },
      }))
      : [el("span", { class: "muted small", text: "Önce bir bölüm aç." })]));
  }

  function renderTarget() {
    options = targets();
    chosen = 0; // the thing just picked is the most likely subject
    drawChips();
  }

  async function submit() {
    if (busy) return;
    const metin = text.value.trim();
    const target = options[chosen];
    // the button is never dead: each reason it cannot send is said under the box
    if (!metin) {
      fieldError(EMPTY_TEXT);
      text.focus();
      return;
    }
    if (session === false) return fieldError(OFF_TEXT);
    if (session === null) return fieldError("Claude oturumu henüz denetleniyor; birkaç saniye sonra yeniden gönder.");
    if (!target) return fieldError("Önce bir bölüm aç.");
    busy = true;
    error = "";
    render();
    try {
      const now = ctx.now();
      await ctx.api("/api/istek", { b: ctx.path(), hedef: target.hedef, metin, ...(now !== null ? { zaman: now } : {}) });
      text.value = "";
      await poll(true);
    } catch (err) {
      error = `Gönderilemedi: ${err.message}`;
    } finally {
      busy = false;
      render();
    }
  }
  send.addEventListener("click", submit);
  text.addEventListener("input", () => { if (field.classList.contains("hatali")) fieldError(""); });
  text.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation(); // not the app's Ctrl shortcuts
      submit();
    }
  });

  /** One poll: requests and the file's version. A save or open meanwhile makes the answer stale. */
  async function poll(once = false) {
    if (!once) clearTimeout(timer); // a one-off look (after sending) leaves the regular poll running
    const path = ctx.path();
    if (path && !document.hidden) {
      const asked = ctx.version();
      try {
        const res = await ctx.api(`/api/istekler?${new URLSearchParams({ b: path })}`);
        if (ctx.path() === path) {
          session = res.oturum;
          list = res.istekler;
          ctx.storyVersion?.(res.hikaye);
          ctx.draftsVersion?.(res.taslak);
          ctx.audioVersion?.(res.ses);
          error = "";
          // while a save is on its way the file changes under us: that is not someone else's edit
          if (res.surum && ctx.version() === asked && res.surum !== asked && !ctx.saving()) await onDisk(res.surum);
          else if (res.surum === ctx.version()) changedOnDisk = null;
        }
      } catch (err) {
        error = `İstekler alınamadı: ${err.message}`;
      }
      render();
    }
    if (!once) {
      clearTimeout(timer); // a reload during this poll may have started its own
      timer = setTimeout(() => poll(), POLL_MS);
    }
  }

  /** bolum.json changed on disk: reload it, unless that would throw away unsaved edits. */
  async function onDisk(version) {
    if (ctx.dirty()) {
      changedOnDisk = version;
      return;
    }
    changedOnDisk = null;
    try {
      await ctx.reload();
      ctx.note("Bölüm diskte değişti (Claude düzenledi): yeniden yüklendi.");
    } catch (err) {
      error = `Yeniden yüklenemedi: ${err.message}`;
    }
  }

  const stateKey = (r) => (r.bayat ? "bayat" : r.durum === "bekliyor" && r.duyuruldu ? "iletildi" : r.durum);

  function item(r) {
    const key = stateKey(r);
    const when = new Date(r.at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
    const about = `${r.hedef?.etiket || r.hedef?.tur || ""}${r.hedef?.shot ? ` · ${r.hedef.shot}` : ""}`;
    return el("li", { class: "ist-istek" },
      el("p", { class: `ist-durum ${key}` },
        el("span", { class: key === "alindi" ? "cark" : "nokta", "aria-hidden": "true" }),
        el("b", { text: STATE_TEXT[key] || r.durum }),
        el("span", { class: "ist-zaman", text: `${about} · ${when}` })),
      el("p", { class: "ist-metin", text: r.metin }),
      r.yanit ? el("div", { class: `ist-yanit ${r.durum}` }, el("span", { class: "ist-kim", text: "✦ Claude" }), el("p", { text: r.yanit })) : null);
  }

  /** Redraw a slot only when what it shows changed, so a focused button in it keeps the focus. */
  function fill(slot, key, build) {
    if (slot.dataset.k === key) return;
    slot.dataset.k = key;
    slot.replaceChildren(...[build()].flat().filter(Boolean));
  }

  function reloadFromDisk() {
    changedOnDisk = null;
    render();
    ctx.reload().catch((err) => { error = err.message; render(); });
  }

  function render() {
    const off = session === false;
    send.disabled = busy; // only while sending: the inline wait, never "not filled in"
    if (busy) send.setAttribute("aria-busy", "true");
    else send.removeAttribute("aria-busy");
    send.textContent = busy ? "Gönderiliyor…" : SEND_TEXT;
    if (!off && field.classList.contains("hatali") && hint.textContent === OFF_TEXT) fieldError("");
    // a drawer (<details>) in the inspector: closed it is one line, so it takes no room from the stage
    const asked = list.some((r) => r.durum === "soru" && !r.bayat);
    summary.replaceChildren(...[ // replaceChildren would write "null" for a part left out
      el("h2", { text: "Claude'a yaz" }),
      el("span", { class: `pill ${session ? "on" : ""}`, text: session === null ? "…" : session ? "oturuma bağlı" : "oturum yok" }),
      asked ? el("span", { class: "rstate soru", text: STATE_TEXT.soru }) : null].filter(Boolean));
    fill(offSlot, String(off), () => (off ? el("p", { class: "ist-not", text: OFF_TEXT }) : null));
    fill(diskSlot, changedOnDisk || "", () => (changedOnDisk ? el("div", { class: "confirm", role: "alert" },
      el("span", { text: "bolum.json diskte değişti (Claude düzenlemiş olabilir). Kaydedilmemiş değişikliklerin var." }),
      el("button", { class: "btn danger small", type: "button", text: "Değişikliklerimi at, yeniden yükle", on: { click: reloadFromDisk } })) : null));
    const waiting = list.some((r) => r.durum === "bekliyor" && !r.duyuruldu);
    waitSlot.replaceChildren(...(waiting ? [el("p", { class: "ist-not", text: "İstek sırada: Claude bir işi bitirince ya da sen sohbete bir şey yazınca (örneğin “panel”) ona iletilir." })] : []));
    errSlot.replaceChildren(...(error ? [el("p", { class: "err small", role: "alert", text: error })] : []));
    listSlot.replaceChildren(...(list.length
      ? [el("h3", { class: "ist-liste-bas", text: "Son istekler" }), el("ol", { class: "ist-liste" }, list.slice(0, 5).map(item))]
      : off ? [] : [el("p", { class: "ist-bos", text: "Henüz istek yok. Sahnede bir karakter, nesne ya da replik seç ve ne istediğini yaz; durumu ve Claude'un yanıtı burada görünür." })]));
    // something new waits on the person (a question, the file changed under unsaved edits): open the drawer once
    const waitingOn = `${list.filter((r) => r.durum === "soru" && !r.bayat).map((r) => r.id).join()}|${changedOnDisk || ""}`;
    if (waitingOn !== shownWaiting && (asked || changedOnDisk)) box.open = true;
    shownWaiting = waitingOn;
  }

  document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
  drawChips();
  render();

  return {
    /** The selection changed: offer its targets. */
    renderTarget,
    /** An episode was opened: start (or restart) polling for it. */
    start() {
      list = [];
      changedOnDisk = null;
      renderTarget();
      render();
      poll();
    },
  };
}
