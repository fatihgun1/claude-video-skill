// Scene review ("İncele" on a scene in the project tree): the rule checks of the unsaved draft
// (validator, framing, overlaps, caption length, audio), stills of the scene's shots taken from
// the saved file, and a request to Claude to look at those stills. Nothing here changes the
// episode or approves anything.
import { el } from "./dom.js";

const POLL_MS = 2000;
const LEVEL = { hata: ["err", "Hata"], uyari: ["warn", "Uyarı"], bilgi: ["muted", "Bilgi"] };
const KIND = { dogrulama: "doğrulama", kadraj: "kadraj", "ust-uste": "üst üste", altyazi: "altyazı", ses: "ses", dinleme: "dinleme" };
const FORMAT_TAG = { "16:9": "16x9", "9:16": "9x16" };

/**
 * @param {HTMLDialogElement} dialog
 * @param {{path:() => string|null, episode:() => object, format:() => string, dirty:() => boolean,
 *          outputsUrl:() => string, goTo:(shotId:string, msg?:string) => void,
 *          api:(path:string, body?:object) => Promise<any>}} ctx
 */
export function createReview(dialog, ctx) {
  let scene = null; // the scene under review
  let result = null; // reviewScene's answer
  let picture = true; // false: the draft did not compile, only the rules that need no picture ran
  let job = null;
  let sheets = [];
  let error = "";
  let sent = "";
  let timer = 0;
  let checking = false;

  const sceneName = () => scene.title || `Sahne ${scene.scene_id}`;

  let seq = 0; // bumped by open(): an answer for a scene opened earlier is dropped

  async function check() {
    const mine = seq;
    checking = true;
    error = "";
    render();
    try {
      const res = await ctx.api("/api/incele", { b: ctx.path(), episode: ctx.episode(), format: ctx.format(), sahne: scene.scene_id });
      if (mine !== seq) return;
      result = res.inceleme;
      picture = res.resim;
      if (!res.resim && res.error) error = `Önizleme derlenemedi (${res.error}): kadraj ve üst üste denetimleri yapılamadı.`;
    } catch (err) {
      if (mine === seq) error = err.message;
    } finally {
      if (mine === seq) {
        checking = false;
        render();
      }
    }
  }

  /** The production state: is a stills job running, and which sheets exist for this scene. */
  let jobCall = 0;
  async function refreshJob() {
    clearTimeout(timer);
    if (!dialog.open || !scene) return;
    const call = ++jobCall;
    try {
      const res = await ctx.api(`/api/is?${new URLSearchParams({ b: ctx.path() })}`);
      if (call !== jobCall || !dialog.open) return; // a newer look, or closed: one poll chain only
      job = res.job;
      const prefix = `inceleme/${scene.scene_id}/${FORMAT_TAG[ctx.format()]}/`;
      sheets = (res.outputs.review || []).filter((p) => p.startsWith(prefix));
    } catch (err) {
      if (call !== jobCall) return;
      error = err.message;
    }
    render();
    if (job?.status === "running") timer = setTimeout(refreshJob, POLL_MS);
  }

  async function takeStills() {
    error = "";
    try {
      job = (await ctx.api("/api/is", { b: ctx.path(), kind: "sahne", format: ctx.format(), sahne: scene.scene_id })).job;
    } catch (err) {
      error = err.message;
    }
    render();
    refreshJob();
  }

  /** Ask Claude to look at the stills; the rule findings go along so it does not repeat them. */
  async function askClaude() {
    const tag = FORMAT_TAG[ctx.format()];
    const found = (result?.sorunlar || []).map((s) => `- ${s.shot || "sahne"}: ${s.mesaj}`).join("\n");
    const metin = [
      `“${sceneName()}” sahnesini incele (${ctx.format()}).`,
      `Kareler: bölümün yanındaki inceleme/${scene.scene_id}/${tag}/ klasöründe${sheets.length ? "" : " (yoksa önce al: cizgi storyboard <bölüm> --sahne " + scene.scene_id + " --format " + ctx.format() + ")"}.`,
      "Her kareye tek tek bak: duruş ve hareket doğru okunuyor mu, bakış yönü, kadraj, kesmeler, nesne tutma, karakterlerin yeri.",
      "Bulduklarını shot shot panel_yanitla ile yaz ve nasıl düzeltileceğini öner; değiştirmeden önce bana sor.",
      found ? `Kuralların zaten bulduğu:\n${found}` : "Kurallar bir sorun bulmadı.",
    ].join("\n");
    error = "";
    sent = "";
    try {
      await ctx.api("/api/istek", { b: ctx.path(), hedef: { tur: "sahne", sahne: scene.scene_id, etiket: sceneName().slice(0, 100) }, metin });
      sent = "Claude'a gönderildi: durumunu sahnenin altındaki “Claude'a yaz” kutusunda görürsün.";
    } catch (err) {
      error = err.message;
    }
    render();
  }

  function problems() {
    if (checking && !result) return el("p", { class: "muted", text: "Denetleniyor…" });
    if (!result) return null;
    if (!result.sorunlar.length) {
      return el("p", { class: "ok-line", text: picture ? "Kuralların bulduğu bir sorun yok. Resimde görülecek şeyler için karelere bak." : "Resim gerektirmeyen kurallarda sorun yok." });
    }
    const order = { hata: 0, uyari: 1, bilgi: 2 };
    const list = [...result.sorunlar].sort((a, b) => order[a.seviye] - order[b.seviye]);
    return el("ul", { class: "rlist" }, list.map((s) => {
      const [cls, word] = LEVEL[s.seviye];
      return el("li", {},
        el("span", { class: `rlevel ${cls}`, text: word }),
        el("span", { class: "rkind muted small", text: KIND[s.tur] || s.tur }),
        s.shot ? el("button", { class: "linkish", type: "button", title: "Bu shot'ı aç", text: s.shot, on: { click: () => { dialog.close(); ctx.goTo(s.shot, s.mesaj); } } }) : null,
        el("span", { class: "rmsg", text: s.mesaj }));
    }));
  }

  function stills() {
    const why = ctx.dirty() ? "Önce kaydet: kareler kayıtlı dosyadan alınır." : job?.status === "running" ? "Bir iş sürüyor." : "";
    const running = job?.status === "running";
    const mine = job && job.kind === "sahne" && job.scene === scene.scene_id;
    const base = ctx.outputsUrl();
    return el("section", { class: "pstep" },
      el("h3", {}, `Kareler (${ctx.format()})`),
      el("p", { class: "muted small", text: "Her shot'tan iki kare, kayıtlı dosyadan (kurallar ise kaydedilmemiş taslağa bakar). Onay için değil, bakmak için: onay kapısı gerekmez." }),
      el("button", { class: "btn", type: "button", disabled: !!why, title: why, text: running && mine ? "Kareler alınıyor…" : sheets.length ? "Kareleri yeniden al" : "Kareleri al", on: { click: takeStills } }),
      why && !running ? el("p", { class: "warn small", text: why }) : null,
      mine && job.status === "failed" ? el("p", { class: "err small", text: job.error || "olmadı" }) : null,
      sheets.length ? el("div", { class: "psheets" }, sheets.map((p) => el("a", { href: base + p, target: "_blank", rel: "noopener" }, el("img", { src: `${base + p}?v=${job?.ended || ""}`, alt: p, loading: "lazy" })))) : null);
  }

  function render() {
    if (!scene) return;
    const c = result?.sayac;
    dialog.replaceChildren(el("div", {},
      el("div", { class: "phead" },
        el("div", {}, el("h2", { text: `İncele: ${sceneName()}` }),
          el("p", { class: "muted small", text: `${scene.shots.length} shot · kaydedilmemiş taslak denetlenir${c ? ` · ${c.hata} hata, ${c.uyari} uyarı, ${c.bilgi} bilgi` : ""}` })),
        el("button", { class: "btn icon", type: "button", "aria-label": "Kapat", text: "✕", on: { click: () => dialog.close() } })),
      error ? el("p", { class: "err", text: error }) : null,
      el("section", { class: "pstep" },
        el("h3", {}, "Kurallar", el("button", { class: "btn small", type: "button", disabled: checking, text: "Yeniden denetle", on: { click: check } })),
        problems()),
      stills(),
      el("section", { class: "pstep" },
        el("h3", {}, "Claude'a incelet"),
        el("p", { class: "muted small", text: "Claude kareleri tek tek açıp bakar, bulduklarını ve önerisini yazar; değiştirmeden önce sorar." }),
        el("button", { class: "btn primary", type: "button", text: "Claude'a incelet", on: { click: askClaude } }),
        sent ? el("p", { class: "small ok-line", text: sent }) : null)));
  }

  dialog.addEventListener("close", () => clearTimeout(timer));

  return {
    /** Open the review of a scene (the scene object of the draft). */
    open(s) {
      seq++;
      scene = s;
      checking = false;
      result = null;
      job = null;
      sheets = [];
      error = "";
      sent = "";
      render();
      if (!dialog.open) dialog.showModal();
      check();
      refreshJob();
    },
  };
}
