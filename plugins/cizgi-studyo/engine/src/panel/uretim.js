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
  let note = ""; // what the last action did (a request left for Claude)

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
        type: "button", class: `${cls}${i === next && !cls ? " next" : ""}${job?.status === "running" && (job.kind === "ses" ? i === 1 : i >= 2) ? " busy" : ""}`,
        title: `${tip} · tıkla: üretim`, on: { click: show },
      }, text))));
  }

  /** Why the lines cannot be spoken from here now ("" when they can); approval is not asked here. */
  function audioBlocker() {
    if (ctx.dirty()) return "Önce kaydet: sesler kayıtlı dosyadan üretilir.";
    if (!ctx.status()) return "Bölümde hata var: önce düzelt.";
    if (job?.status === "running") return "Bir iş sürüyor.";
    return "";
  }

  async function startJob(kind) {
    error = "";
    note = "";
    try {
      const res = await ctx.api("/api/is", { b: ctx.path(), kind, format: ctx.format() });
      job = res.job;
      poll();
    } catch (err) {
      error = err.message;
    }
    render();
    renderSteps();
  }

  /** No approval yet: leave Claude a request to show the script, ask, then speak the lines. */
  async function askClaudeForAudio() {
    error = "";
    try {
      await ctx.api("/api/istek", {
        b: ctx.path(),
        hedef: { tur: "bolum", etiket: "sesler" },
        metin: "Sesleri üret: senaryo onaylı değil. Replikleri bana göster, onayımı al, sonra cizgi ses ile seslendir.",
      });
      note = "İstek Claude'a gitti: senaryoyu gösterip onayını soracak, sonra seslendirecek.";
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
      // new audio on disk: the preview should play it (and its mouth shapes) instead of guessing
      // (a failed one may have written some lines before it stopped)
      if (job?.kind === "ses" && job.status === "running" && res.job && res.job.status !== "running") ctx.audioReady?.();
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

  /** Speak the lines here when the script is approved; else ask Claude, who asks for the approval. */
  function audioAction(approved) {
    const why = audioBlocker();
    if (approved) {
      return el("button", { class: "btn primary", type: "button", disabled: !!why, title: why || "", on: { click: () => startJob("ses") } }, "Sesleri üret");
    }
    return el("div", {},
      el("button", { class: "btn", type: "button", disabled: !!why, title: why || "", on: { click: askClaudeForAudio } }, "Claude'dan iste"),
      el("p", { class: "muted small", text: "Senaryo onaylı değil: Claude replikleri gösterip onayını sorar, sonra seslendirir." }));
  }

  /** The last lines of a job's output that are not progress (bars, "ilerleme" lines). */
  function lastWords(log) {
    return log.split(/\r?\n|\r/).filter((l) => l.trim() && !l.startsWith("ilerleme ") && !/^[^|]*\d+%\|/.test(l)).slice(-8).join("\n");
  }

  const PROGRESS_TEXT = { seslendirme: "Seslendiriliyor", kontrol: "Dinleme kontrolü", agiz: "Ağız şekilleri" };
  const JOB_TEXT = { taslak: "Taslak video", storyboard: "Storyboard", sahne: "Sahne kareleri", ses: "Sesler" };

  /** A running audio job's step and count as a bar ("Seslendiriliyor 2/5"). */
  function progressBar(p) {
    if (!p) return el("p", { class: "muted small", text: "Hazırlanıyor (ses modeli yükleniyor)…" });
    const label = p.bitti === 0 ? `${PROGRESS_TEXT[p.adim]}: başlıyor…` : `${PROGRESS_TEXT[p.adim]} ${p.bitti}/${p.toplam}`;
    return el("div", { class: "pprog" },
      el("progress", { max: String(p.toplam || 1), value: String(p.bitti), "aria-label": label }),
      el("span", { class: "small", text: label }));
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
        el("b", { text: `${JOB_TEXT[job.kind] || job.kind}${job.kind === "ses" ? "" : ` ${job.format}`}: ${job.status === "running" ? "sürüyor…" : job.status === "done" ? "bitti" : "olmadı"}` }),
        job.error ? el("p", { class: "err small perr", text: job.error }) : null, // several lines: what failed, then why
        job.kind === "ses" && job.status === "running" ? progressBar(job.progress) : null,
        // the speech tools' own last words say why it stopped (a missing model, out of memory…)
        job.kind === "ses" && job.status === "failed" && job.log ? el("pre", { class: "plog", text: lastWords(job.log) }) : null,
        job.kind === "ses" && job.status === "done" && job.result?.failed?.length
          ? el("p", { class: "warn small", text: `${job.result.failed.length} replik dinleme kontrolünden geçmedi: replik satırlarında görebilirsin.` })
          : null,
        job.status === "running"
          ? el("button", { class: "btn small danger", type: "button", on: { click: stopJob } }, "Durdur")
          : null,
        // an audio job has its bar instead (the speech model's own output is noise for a person)
        job.status === "running" && job.log && job.kind !== "ses" ? el("pre", { class: "plog", text: job.log.split("\n").slice(-6).join("\n") }) : null)
      : null;
    // el() drops empty parts; replaceChildren alone would print them as "null"
    els.dialog.replaceChildren(el("div", {},
      el("div", { class: "phead" }, el("h2", { text: "Üretim" }),
        el("button", { class: "btn icon", type: "button", "aria-label": "Kapat", text: "✕", on: { click: () => els.dialog.close() } })),
      el("p", { class: "muted small", text: "Onaylar senin: panel hiçbir şeyi onaylamaz. Bir adımı onaylamak için Claude'a söyle." }),
      error ? el("p", { class: "err", text: error }) : null,
      note ? el("p", { class: "ok-line small", text: note }) : null,
      jobBox,
      step("1. Senaryo", { cls: g.senaryo === "onayli" ? "ok" : "stale", text: GATE_TEXT[g.senaryo] || "?" },
        g.senaryo === "onayli" ? "" : "Replikleri okuduktan sonra Claude'a “senaryoyu onaylıyorum” de."),
      step("2. Ses", { cls: a && !a.todo.length ? "ok" : "stale", text: a ? `${a.lines - a.todo.length}/${a.lines} hazır` : "?" },
        a?.todo.length ? `Seslendirilecek: ${a.todo.join(", ")}.` : a?.failed?.length ? `${a.failed.length} replik dinleme kontrolünden geçmedi: replik satırlarında görebilirsin.` : "",
        a?.todo.length ? audioAction(g.senaryo === "onayli") : null),
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
