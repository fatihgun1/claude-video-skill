// "Claude'a yaz": the person picks something (a character on the stage, a prop, a line, a
// shot, a scene) and writes what they want; the request goes to the Claude session's queue
// and its state and Claude's answer show here. The same poll notices when bolum.json
// changed on disk (Claude edited it) and reloads it, or asks first when there are unsaved edits.
import { el } from "./dom.js";

const POLL_MS = 2000;
const MAX_TEXT = 2000;
const LABEL_MAX = 100;
const STATE_TEXT = {
  bekliyor: "sırada",
  iletildi: "Claude'a iletildi",
  alindi: "Claude üzerinde çalışıyor",
  yapildi: "yapıldı",
  soru: "Claude soruyor",
  olmadi: "olmadı",
  bayat: "yanıtsız kaldı",
};
const cut = (s) => (s.length > LABEL_MAX ? `${s.slice(0, LABEL_MAX - 1)}…` : s);

/**
 * @param {HTMLElement} box
 * @param {{path:() => string|null, episode:() => object|null, current:() => {shot:object, scene:object}|null,
 *          sel:() => {kind:string|null, index:number}, labelOf:(id:string) => string, now:() => number|null,
 *          version:() => string, dirty:() => boolean, saving:() => boolean, reload:() => Promise<void>, note:(text:string) => void,
 *          api:(path:string, body?:object) => Promise<any>}} ctx
 */
export function createRequests(box, ctx) {
  let session = null; // null: not asked yet · true/false: a Claude session listens
  let list = [];
  let error = "";
  let changedOnDisk = null; // the version on disk when it differs and the person has unsaved edits
  let timer = 0;
  let busy = false;
  let shownWaiting = "|"; // what last opened the drawer, so closing it sticks
  const text = el("textarea", { rows: "2", maxlength: String(MAX_TEXT), placeholder: "Örnek: el sallasın, sonra banka yürüsün", "aria-label": "Claude'a istek" });
  const target = el("select", { "aria-label": "İstek neyle ilgili" });
  const send = el("button", { class: "btn primary small", type: "button", text: "Gönder", title: "Gönder (Ctrl+Enter)" });

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
  let options = [];

  function renderTarget() {
    options = targets();
    target.replaceChildren(...options.map((o, i) => el("option", { value: String(i), text: o.label })));
    target.value = "0";
  }

  async function submit() {
    const metin = text.value.trim();
    const chosen = options[Number(target.value)];
    if (!metin || !chosen || busy || !session) return;
    busy = true;
    error = "";
    render();
    try {
      const now = ctx.now();
      await ctx.api("/api/istek", { b: ctx.path(), hedef: chosen.hedef, metin, ...(now !== null ? { zaman: now } : {}) });
      text.value = "";
      await poll(true);
    } catch (err) {
      error = err.message;
    } finally {
      busy = false;
      render();
    }
  }
  send.addEventListener("click", submit);
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
          error = "";
          // while a save is on its way the file changes under us: that is not someone else's edit
          if (res.surum && ctx.version() === asked && res.surum !== asked && !ctx.saving()) await onDisk(res.surum);
          else if (res.surum === ctx.version()) changedOnDisk = null;
        }
      } catch (err) {
        error = `istekler alınamadı: ${err.message}`;
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
      error = `yeniden yüklenemedi: ${err.message}`;
    }
  }

  function stateOf(r) {
    const key = r.bayat ? "bayat" : r.durum === "bekliyor" && r.duyuruldu ? "iletildi" : r.durum;
    return el("span", { class: `rstate ${key}`, text: STATE_TEXT[key] || r.durum });
  }

  function item(r) {
    const when = new Date(r.at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
    return el("li", { class: "req" },
      el("div", { class: "rhead" }, stateOf(r),
        el("span", { class: "muted small", text: `${r.hedef?.etiket || r.hedef?.tur || ""}${r.hedef?.shot ? ` · ${r.hedef.shot}` : ""} · ${when}` })),
      el("p", { class: "rtext", text: r.metin }),
      r.yanit ? el("p", { class: `rans ${r.durum}`, text: r.yanit }) : null);
  }

  function render() {
    const off = session === false;
    const waiting = list.some((r) => r.durum === "bekliyor" && !r.duyuruldu);
    text.disabled = off || busy;
    target.disabled = off || busy;
    send.disabled = off || busy;
    // a drawer (<details>) in the inspector: closed it is one line, so it takes no room from the stage
    const asked = list.some((r) => r.durum === "soru" && !r.bayat);
    box.replaceChildren(
      el("summary", { class: "chead" },
        el("h2", { text: "Claude'a yaz" }),
        el("span", { class: `pill ${session ? "on" : ""}`, text: session === null ? "…" : session ? "oturuma bağlı" : "oturum yok" }),
        asked ? el("span", { class: "rstate soru", text: STATE_TEXT.soru }) : null),
      el("div", {},
      off ? el("p", { class: "muted small", text: "Bu panel bir Claude oturumuna bağlı değil. İstek göndermek için paneli Claude'da /cizgi-studyo ile aç." }) : null,
      changedOnDisk ? el("div", { class: "confirm", role: "alert" },
        el("span", { text: "bolum.json diskte değişti (Claude düzenlemiş olabilir). Kaydedilmemiş değişikliklerin var." }),
        el("button", { class: "btn danger small", type: "button", text: "Değişikliklerimi at, yeniden yükle", on: { click: () => { changedOnDisk = null; ctx.reload().catch((err) => { error = err.message; render(); }); } } })) : null,
      el("div", { class: "cform" }, el("label", { class: "ctarget" }, el("span", { class: "muted small", text: "Hedef" }), target), text, send),
      waiting ? el("p", { class: "muted small", text: "İstek sırada: Claude bir işi bitirince ya da sen sohbete bir şey yazınca (örneğin “panel”) ona iletilir." }) : null,
      error ? el("p", { class: "err small", text: error }) : null,
      list.length ? el("ol", { class: "reqs" }, list.slice(0, 5).map(item)) : null));
    // something new waits on the person (a question, the file changed under unsaved edits): open the drawer once
    const waitingOn = `${list.filter((r) => r.durum === "soru" && !r.bayat).map((r) => r.id).join()}|${changedOnDisk || ""}`;
    if (waitingOn !== shownWaiting && (asked || changedOnDisk)) box.open = true;
    shownWaiting = waitingOn;
  }

  document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
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
