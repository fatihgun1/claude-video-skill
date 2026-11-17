// "Video çıkar": the whole production in one press, instead of the Üretim page's five steps.
// The person presses "Onayla ve videoyu çıkar" once: that approves the script, the lines are spoken,
// the storyboard is approved (after the audio, as its fingerprint needs) and the video is rendered;
// it then plays right here. The approvals are the person's own press (POST /api/onay checks the
// origin, as on the Üretim page); Claude never presses it. Open decisions (format, music…) are
// picked in the same window first.
import { el } from "./dom.js";
import { tr } from "./tr.js";
import { DECISIONS } from "./uretim.js";

const POLL_MS = 2000;
const STEPS = [["senaryo", "Senaryo onayı"], ["ses", "Sesler"], ["kareler", "Kareler onayı"], ["video", "Video"]];
const PROGRESS_TEXT = { seslendirme: "seslendiriliyor", kontrol: "dinleme kontrolü", agiz: "ağız şekilleri" };

/**
 * @param {{api:(path:string, body?:object) => Promise<any>, path:() => string, format:() => string,
 *          dirty:() => boolean, save:() => Promise<void>, outputsUrl:() => string,
 *          applyDecisions:(d:{format?:string, kararlar:object}) => Promise<void>, openProduction:() => void,
 *          after:() => void}} ctx
 */
export function createVideoButton(ctx) {
  const box = el("dialog", { class: "vcikar", "aria-labelledby": "vcikar-baslik" });
  document.body.append(box);
  let state = { phase: "start" }; // start | running | done | failed
  let steps = {}; // step → "sirada" | "calisiyor" | "bitti" | "atlandi" | "hata"
  let status = null;
  let note = "";
  let video = "";
  let progress = "";

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const getIs = () => ctx.api(`/api/is?${new URLSearchParams({ b: ctx.path() })}`);

  async function open() {
    state = { phase: "start" };
    steps = {};
    note = "";
    video = "";
    status = null;
    if (!box.open) box.showModal();
    render();
    try {
      if (ctx.dirty()) await ctx.save();
      status = (await getIs()).status;
    } catch (err) {
      state = { phase: "failed", why: err.message };
    }
    render();
  }

  /** Wait for the episode's job to end: its result, or throws why it failed. */
  async function job(kind, body = {}) {
    await ctx.api("/api/is", { b: ctx.path(), kind, format: ctx.format(), ...body });
    for (;;) {
      await wait(POLL_MS);
      const res = await getIs();
      const j = res.job;
      if (j?.status === "running") {
        const p = j.progress;
        progress = p ? `${PROGRESS_TEXT[p.adim] || p.adim}${p.toplam ? ` ${p.bitti}/${p.toplam}` : ""}` : "";
        render();
        continue;
      }
      progress = "";
      if (j?.status !== "done") throw new Error(tr(j?.error || "iş durdu"));
      return { result: j.result, outputs: res.outputs, status: res.status };
    }
  }

  async function run() {
    state = { phase: "running" };
    steps = Object.fromEntries(STEPS.map(([k]) => [k, "sirada"]));
    note = "";
    render();
    const step = async (key, fn) => {
      steps[key] = "calisiyor";
      render();
      try {
        const skipped = await fn();
        steps[key] = skipped ? "atlandi" : "bitti";
      } catch (err) {
        steps[key] = "hata";
        throw err;
      }
      render();
    };
    try {
      if (ctx.dirty()) await ctx.save();
      status = (await getIs()).status;
      await step("senaryo", async () => {
        if (status.gates.senaryo === "onayli") return true;
        await ctx.api("/api/onay", { b: ctx.path(), kapi: "senaryo" });
        return false;
      });
      await step("ses", async () => {
        status = (await getIs()).status;
        if (!status.audio.todo.length) return true;
        const res = await job("ses");
        const failed = res.result?.failed?.length || 0;
        if (failed) note = `${failed} replik dinleme kontrolünden geçmedi; video yine çıkıyor. Sahnede o repliğin altyazısına tıklayıp dinle, gerekirse “Yeniden seslendir” de.`;
        return false;
      });
      await step("kareler", async () => {
        status = (await getIs()).status;
        if (status.gates.storyboard === "onayli") return true;
        await ctx.api("/api/onay", { b: ctx.path(), kapi: "storyboard" });
        return false;
      });
      await step("video", async () => {
        const res = await job("render");
        const tag = ctx.format().replace(":", "x");
        const finals = res.outputs.videos.filter((p) => !/-taslak\.mp4$/.test(p));
        const path = finals.find((p) => p.includes(tag)) || finals[0];
        if (!path) throw new Error("video çıktı ama dosyası bulunamadı");
        video = `${ctx.outputsUrl()}${path}?v=${Date.now()}`;
        return false;
      });
      state = { phase: "done" };
      ctx.after();
    } catch (err) {
      state = { phase: "failed", why: err.message };
    }
    render();
  }

  async function decide(key, value) {
    const kararlar = key === "format" ? {} : { [key]: value };
    await ctx.applyDecisions({ format: key === "format" ? value : undefined, kararlar });
    status = (await getIs()).status;
    render();
  }

  /** The decisions still open (not chosen yet): picked here with one click each. */
  function decisions() {
    const missing = status?.kararlar?.eksik || [];
    const open = DECISIONS.filter(([key]) => missing.some((m) => m.startsWith(`${key}:`) && m.includes("not chosen")));
    const other = missing.filter((m) => !m.includes("not chosen"));
    if (!open.length && !other.length) return null;
    return el("section", { class: "vcikar-kararlar" },
      el("h3", { text: "Önce bunları seç" }),
      ...open.map(([key, label, options]) => el("div", { class: "pfield" },
        el("span", { class: "pfield-ad", text: label }),
        el("div", { class: "psegment", role: "group", "aria-label": label }, options.map(([v, t]) =>
          el("button", { class: "btn small", type: "button", text: t, on: { click: () => decide(key, v) } }))))),
      other.length ? el("p", { class: "npencere-hata", text: `Bölüm bir kararla çelişiyor: ${other.join("; ")}. Üretim sayfasında düzelt.` }) : null,
      other.length ? el("button", { class: "btn small", type: "button", text: "Üretim sayfasını aç", on: { click: () => { box.close(); ctx.openProduction(); } } }) : null);
  }

  function stepList() {
    const MARK = { bitti: "✓", atlandi: "✓", hata: "!", calisiyor: "", sirada: "" };
    const TEXT = { bitti: "tamam", atlandi: "zaten hazırdı", hata: "olmadı", calisiyor: progress || "çalışıyor…", sirada: "sırada" };
    return el("ol", { class: "vcikar-adimlar" }, STEPS.map(([k, label]) => {
      const s = steps[k] || "sirada";
      return el("li", { class: s },
        s === "calisiyor" ? el("span", { class: "cark", "aria-hidden": "true" }) : el("span", { class: "vcikar-isaret", "aria-hidden": "true", text: MARK[s] }),
        el("span", { text: label }), el("small", { class: "muted", text: TEXT[s] }));
    }));
  }

  function render() {
    const lines = status?.audio?.lines ?? 0;
    const parts = [el("header", { class: "vcikar-bas" },
      el("h2", { id: "vcikar-baslik", text: "Video çıkar" }),
      el("button", { class: "btn icon", type: "button", "aria-label": "Kapat", text: "✕", disabled: state.phase === "running" ? "" : null, on: { click: () => box.close() } }))];
    if (state.phase === "start") {
      if (!status) parts.push(el("p", { class: "muted", "aria-busy": "true", text: "Bölüm hazırlanıyor…" }));
      else if (!status.valid) parts.push(el("p", { class: "npencere-hata", text: "Bölümde hata var: önce düzelt (mesajlara bak)." }));
      else {
        const open = decisions();
        parts.push(
          el("p", { text: `Bu düğmeyle senaryoyu (${lines} replik) ve kareleri onaylamış olursun. Sonra sesler üretilir ve video çıkar: birkaç dakika sürer, bu pencerede izlersin.` }),
          el("p", { class: "muted small", text: "Sonra istediğin şeyi yine değiştirebilirsin; değişince video yeniden çıkarılır." }),
          open,
          el("button", { class: "btn primary", type: "button", disabled: open ? "" : null, title: open ? "Önce yukarıdaki kararları seç" : null, text: "Onayla ve videoyu çıkar", on: { click: run } }));
      }
    } else {
      parts.push(stepList());
      if (note) parts.push(el("p", { class: "muted small", role: "status", text: note }));
      if (state.phase === "failed") parts.push(el("p", { class: "npencere-hata", role: "alert", text: `Durdu: ${state.why}` }), el("button", { class: "btn", type: "button", text: "Yeniden dene", on: { click: run } }));
      if (state.phase === "done" && video) parts.push(el("video", { class: "vcikar-video", src: video, controls: "", autoplay: "", playsinline: "" }));
    }
    box.replaceChildren(...parts.filter(Boolean));
  }

  box.addEventListener("cancel", (e) => {
    if (state.phase === "running") e.preventDefault(); // it keeps running; closing would hide it
  });

  return { open };
}
