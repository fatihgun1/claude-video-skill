// Production: where the episode stands (script → audio → storyboard → render), and the two
// steps the panel can start itself on the saved file: storyboard stills and a draft video.
// Approvals are never given here; the panel says what to ask for and from whom.
import { el } from "./dom.js";

const POLL_MS = 2000;
const GATE_TEXT = { onayli: "onaylı", eskimis: "eskidi (içerik değişti)", yok: "onaylanmadı" };

/**
 * @param {{dialog:HTMLDialogElement, steps:HTMLElement}} els
 * @param {{path:() => string|null, dirty:() => boolean, format:() => string, status:() => object|null,
 *          setStatus:(s:object|null) => void, api:(path:string, body?:object) => Promise<any>}} ctx
 */
export function createProduction(els, ctx) {
  let job = null;
  let outputs = { sheets: [], videos: [] };
  let base = "";
  let timer = 0;
  let error = "";

  /** Why a step cannot start now, or "" when it can. */
  function blocker() {
    const s = ctx.status();
    if (ctx.dirty()) return "Önce kaydet: üretim kayıtlı dosyadan yapılır.";
    if (!s) return "Bölümde hata var: önce düzelt.";
    if (s.gates?.senaryo !== "onayli") return "Senaryo onayı gerekli.";
    if (s.audio?.todo?.length) return `${s.audio.todo.length} replik seslendirilmeli.`;
    if (job?.status === "running") return "Bir iş sürüyor.";
    return "";
  }

  /** The chips in the top bar: each step with how far it is. */
  function renderSteps() {
    const s = ctx.status();
    const g = s?.gates || {};
    const a = s?.audio;
    const audioDone = a ? a.lines - a.todo.length : 0;
    const steps = [
      ["Senaryo", g.senaryo === "onayli" ? "ok" : g.senaryo === "eskimis" ? "stale" : "", GATE_TEXT[g.senaryo] || "durum bilinmiyor"],
      [a ? `Ses ${audioDone}/${a.lines}` : "Ses", a && !a.todo.length ? (a.failed?.length ? "stale" : "ok") : "", a ? `${a.todo.length} replik bekliyor${a.failed?.length ? `, ${a.failed.length} dinleme kontrolünden geçmedi` : ""}` : ""],
      ["Storyboard", g.storyboard === "onayli" ? "ok" : g.storyboard === "eskimis" ? "stale" : "", GATE_TEXT[g.storyboard] || ""],
      [outputs.videos.length ? "Render ✓" : "Render", outputs.videos.length ? "ok" : "", outputs.videos.length ? `${outputs.videos.length} video` : "henüz video yok"],
    ];
    const next = steps.findIndex(([, cls]) => cls !== "ok");
    els.steps.replaceChildren(...steps.map(([text, cls, tip], i) => el("li", {},
      el("button", {
        type: "button", class: `${cls}${i === next && !cls ? " next" : ""}${job?.status === "running" && i >= 2 ? " busy" : ""}`,
        title: `${tip} · tıkla: üretim`, on: { click: show },
      }, text))));
  }

  async function startJob(kind) {
    error = "";
    try {
      const res = await ctx.api("/api/is", { b: ctx.path(), kind, format: ctx.format() });
      job = res.job;
      poll();
    } catch (err) {
      error = err.message;
    }
    render();
  }

  async function stopJob() {
    try {
      const res = await ctx.api("/api/is/durdur", { b: ctx.path() });
      job = res.job;
    } catch (err) {
      error = err.message;
    }
    render();
    renderSteps();
  }

  async function refresh() {
    if (!ctx.path()) return;
    try {
      const res = await ctx.api(`/api/is?${new URLSearchParams({ b: ctx.path() })}`);
      job = res.job;
      outputs = res.outputs;
      if (res.status) ctx.setStatus(res.status);
    } catch (err) {
      error = err.message;
    }
    renderSteps();
    if (els.dialog.open) render();
    if (job?.status === "running") poll();
  }

  function poll() {
    clearTimeout(timer);
    timer = setTimeout(refresh, POLL_MS);
  }

  function step(title, state, explain, action) {
    return el("section", { class: "pstep" },
      el("h3", {}, title, el("span", { class: `pstate ${state.cls}`, text: state.text })),
      explain ? el("p", { class: "muted small", text: explain }) : null,
      action);
  }

  function render() {
    const s = ctx.status();
    const g = s?.gates || {};
    const a = s?.audio;
    const why = blocker();
    const runBtn = (kind, text) => el("button", {
      class: "btn primary", type: "button", disabled: !!why, title: why || "", on: { click: () => startJob(kind) },
    }, `${text} (${ctx.format()})`);
    const jobBox = job
      ? el("div", { class: `pjob ${job.status}` },
        el("b", { text: `${job.kind === "taslak" ? "Taslak video" : "Storyboard"} ${job.format}: ${job.status === "running" ? "sürüyor…" : job.status === "done" ? "bitti" : "olmadı"}` }),
        job.error ? el("p", { class: "err small", text: job.error }) : null,
        job.status === "running"
          ? el("button", { class: "btn small danger", type: "button", on: { click: stopJob } }, "Durdur")
          : null,
        job.status === "running" && job.log ? el("pre", { class: "plog", text: job.log.split("\n").slice(-6).join("\n") }) : null)
      : null;
    // el() drops empty parts; replaceChildren alone would print them as "null"
    els.dialog.replaceChildren(el("div", {},
      el("div", { class: "phead" }, el("h2", { text: "Üretim" }),
        el("button", { class: "btn icon", type: "button", "aria-label": "Kapat", text: "✕", on: { click: () => els.dialog.close() } })),
      el("p", { class: "muted small", text: "Onaylar senin: panel hiçbir şeyi onaylamaz. Bir adımı onaylamak için Claude'a söyle." }),
      error ? el("p", { class: "err", text: error }) : null,
      jobBox,
      step("1. Senaryo", { cls: g.senaryo === "onayli" ? "ok" : "stale", text: GATE_TEXT[g.senaryo] || "?" },
        g.senaryo === "onayli" ? "" : "Replikleri okuduktan sonra Claude'a “senaryoyu onaylıyorum” de."),
      step("2. Ses", { cls: a && !a.todo.length ? "ok" : "stale", text: a ? `${a.lines - a.todo.length}/${a.lines} hazır` : "?" },
        a?.todo.length ? `Seslendirilecek: ${a.todo.join(", ")}. Claude'a “sesleri üret” de (cizgi ses).` : a?.failed?.length ? `${a.failed.length} replik dinleme kontrolünden geçmedi: replik satırlarında görebilirsin.` : ""),
      step("3. Storyboard", { cls: g.storyboard === "onayli" ? "ok" : "stale", text: GATE_TEXT[g.storyboard] || "?" },
        "Her shot'tan iki kare. İnceledikten sonra Claude'a “storyboard'u onaylıyorum” de.",
        [runBtn("storyboard", "Storyboard karelerini al"),
          outputs.sheets.length ? el("div", { class: "psheets" }, outputs.sheets.map((p) => el("a", { href: base + p, target: "_blank", rel: "noopener" }, el("img", { src: base + p, alt: p, loading: "lazy" })))) : null]),
      step("4. Taslak video", { cls: outputs.videos.length ? "ok" : "stale", text: outputs.videos.length ? `${outputs.videos.length} video` : "yok" },
        "Hızlı bakış için düşük kalite. Asıl render storyboard onaylanınca Claude'la yapılır.",
        [runBtn("taslak", "Taslak video çıkar"),
          outputs.videos.map((p) => el("figure", { class: "pvideo" }, el("video", { src: base + p, controls: true, preload: "metadata" }), el("figcaption", { text: p })))]),
      why ? el("p", { class: "warn small", text: `Şu an başlatılamaz: ${why}` }) : null));
  }

  function show() {
    if (!ctx.path()) return;
    render();
    if (!els.dialog.open) els.dialog.showModal();
    refresh();
  }

  return {
    set({ job: j, outputs: o, outputsUrl }) {
      job = j || null;
      outputs = o || { sheets: [], videos: [] };
      base = outputsUrl || "";
      error = "";
      renderSteps();
      if (job?.status === "running") poll();
    },
    refresh,
    renderSteps,
    show,
  };
}
