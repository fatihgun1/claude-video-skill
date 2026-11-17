// Production, as a full-screen work page (pattern: Form / wizard): where the episode stands
// (script → audio → storyboard → draft → final video) and what the person does at each stage on the
// saved file: complete the open decisions, read the script table, approve the script, speak the lines,
// take the stills, approve the storyboard, render. Stages on the left, the current stage in the centre,
// Claude's column on the right (sihirbaz.js docks its steps there, kanal.js Claude's question).
// An approval is recorded only when the person presses its button here (POST /api/onay, the same
// checks as `cizgi onayla`); Claude never presses it.
import { el, confirmInPage } from "./dom.js";
import { tr } from "./tr.js";

const POLL_MS = 2000;
const GATE_TEXT = { onayli: "onaylı", eskimis: "eskidi (içerik değişti)", yok: "onaylanmadı" };
/** The decisions the script needs, with their choices (kararlar.mjs): [value, label, hint?]. */
export const DECISIONS = [
  ["format", "Format", [["9:16", "Dikey", "9:16"], ["16:9", "Yatay", "16:9"]]],
  ["boyut", "Boyut", [["2b", "2B"], ["3b", "3B"]]],
  ["muzik", "Müzik", [["yok", "Yok"], ["var", "Var", "Bölüm ayarları → müzik seç"]]],
  ["efekt", "Ses efektleri", [["yok", "Yok"], ["var", "Var"]]],
  ["altyazi", "Altyazı", [["var", "Açık"], ["yok", "Kapalı"]]],
];
const COLUMNS = [["plan", "Plan"], ["mekan", "Mekân"], ["konusan", "Konuşan"], ["replik", "Replik"], ["hareket", "Hareket"], ["kamera", "Kamera"], ["bekleme", "Bekleme"]];
/** The stages of the page: title and one line on what the person does there. */
const STAGES = [
  ["Senaryo", "Kararları tamamla, tabloyu oku, sonra onayla. Bir satıra tıklarsan o shot düzenleyicide açılır."],
  ["Ses", "Replikler seslendirilir; her biri bir dinleme kontrolünden geçer."],
  ["Storyboard", "Her shot'tan iki kare. Kareleri incele, hareketi görmek için taslak videoya bak, sonra onayla."],
  ["Taslak video", "Hızlı bakış için düşük kalite; onay gerekmez. Asıl render storyboard onaylanınca yapılır."],
  ["Son video", "Storyboard onaylandıktan sonra tam kalitede çıkar."],
];
/** Which stage shows a job of each kind (its progress and output live there). */
const JOB_STAGE = { ses: 1, storyboard: 2, sahne: 2, taslak: 3, taslak3b: 3, render: 4 };
const PROGRESS_TEXT = { seslendirme: "Seslendiriliyor", kontrol: "Dinleme kontrolü", agiz: "Ağız şekilleri" };
const JOB_TEXT = { taslak: "Taslak video", taslak3b: "Taslak 3B video", storyboard: "Storyboard", sahne: "Sahne kareleri", ses: "Sesler", render: "Son video" };

/** Final videos and drafts apart: only a final one is a finished render. */
const isDraft = (p) => /-taslak\.mp4$/.test(p);
/** An empty area keeps its frame and says what to do next. */
const emptyState = (title, next) => el("div", { class: "pbos" }, el("p", { class: "uretim-bos-baslik", text: title }), el("p", { text: next }));

/**
 * @param {{dialog:HTMLDialogElement, steps:HTMLElement}} els
 * @param {{path:() => string|null, dirty:() => boolean, format:() => string, status:() => object|null,
 *          setStatus:(s:object|null) => void, api:(path:string, body?:object) => Promise<any>,
 *          audioReady?:() => void, applyDecisions:(d:{format?:string, kararlar:object}) => Promise<void>,
 *          goShot:(id:string) => void}} ctx
 */
export function createProduction(els, ctx) {
  let job = null;
  let outputs = { sheets: [], videos: [] };
  let base = "";
  let timer = 0;
  let error = "";
  let note = ""; // what the last action did (a request left for Claude)
  let script = null; // GET /api/senaryo of the saved file: {baslik, satirlar, kararlar, new_assets}
  let scriptError = "";
  let stage = null; // the stage on screen; null: the first one not done yet
  let pending = ""; // the action waiting for the server: its button shows it
  let tried = {}; // action → the person pressed it while it could not start: say why under it
  const picks = {}; // open decisions the person chose here, before saving them

  els.dialog.classList.add("uretim-sayfa");
  // The frame is built once and only its parts are redrawn: the job poll redraws every 2 s, the
  // centre keeps its scroll, and Claude's column (where sihirbaz.js and kanal.js move their boxes,
  // a half-typed answer among them) is never taken out of the page.
  const header = el("header", { class: "psih-bas" });
  const nav = el("nav", { class: "psih-adimlar", "aria-label": "Üretim adımları" });
  const main = el("main", { class: "psih-form" });
  const claudeCol = el("aside", { class: "psih-claude uretim-claude", "aria-label": "Claude" },
    el("h3", { text: "Claude" }),
    el("div", { class: "uretim-sihirbaz" }), // the steps Claude moves on (sihirbaz.js)
    el("div", { class: "uretim-soru" }), // Claude's question when no steps hold it (sihirbaz.js → kanal.js)
    el("p", { class: "uretim-claude-bos muted small", text: "Claude bir işi adım adım yürütürken ya da sana bir şey sorduğunda burada görünür. Onay düğmelerine yalnız sen basarsın; Claude onay vermez." }));

  /**
   * Why a step cannot start now, or "" when it can. A draft video is only a preview: it needs
   * neither the script's approval nor the lines spoken (they play silent with a guessed length).
   */
  function blocker(kind) {
    const s = ctx.status();
    if (ctx.dirty()) return "Önce kaydet: üretim kayıtlı dosyadan yapılır.";
    if (!s) return "Bölümde hata var: önce düzelt.";
    if (job?.status === "running") return "Bir iş sürüyor.";
    if (kind === "taslak" || kind === "taslak3b") return "";
    if (s.gates?.senaryo !== "onayli") return "Senaryo onayı gerekli.";
    if (s.audio?.todo?.length) return `${s.audio.todo.length} replik seslendirilmeli.`;
    if (kind === "render" && s.gates?.storyboard !== "onayli") return "Storyboard onayı gerekli.";
    return "";
  }

  /** Why the lines cannot be spoken from here now ("" when they can); approval is not asked here. */
  function audioBlocker() {
    if (ctx.dirty()) return "Önce kaydet: sesler kayıtlı dosyadan üretilir.";
    if (!ctx.status()) return "Bölümde hata var: önce düzelt.";
    if (job?.status === "running") return "Bir iş sürüyor.";
    return "";
  }

  /** One request for an action: its button shows the wait; the outcome shows as a note or an error. */
  async function request(key, work, { translate = false } = {}) {
    error = "";
    pending = key;
    render();
    try {
      note = (await work()) || "";
    } catch (err) {
      error = translate ? tr(err.message) : err.message;
    }
    pending = "";
  }

  /** The person pressed an approval button: record it (the server runs the same checks as cizgi onayla). */
  async function approve(kapi, what, name) {
    if (!(await confirmInPage(`${what} onaylıyor musun?`, { detail: "Bu onayı sen veriyorsun; içerik sonra değişirse onay düşer.", yes: "Onayla", danger: false }))) return;
    await request(kapi, async () => {
      const res = await ctx.api("/api/onay", { b: ctx.path(), kapi });
      if (res.status) ctx.setStatus(res.status);
      return `${name} onaylandı.`;
    }, { translate: true });
    await refresh();
  }

  async function loadScript() {
    scriptError = "";
    if (!ctx.path() || ctx.dirty()) return;
    try {
      script = await ctx.api(`/api/senaryo?${new URLSearchParams({ b: ctx.path() })}`);
    } catch (err) {
      script = null;
      scriptError = err.message;
    }
  }

  /** Save the decisions the person picked for the open ones (into the draft, then the usual save). */
  async function saveDecisions() {
    const { format, ...kararlar } = picks;
    await request("kararlar", async () => {
      await ctx.applyDecisions({ format, kararlar });
      for (const k of Object.keys(picks)) delete picks[k];
      await loadScript();
      return "Kararlar kaydedildi.";
    });
    await refresh();
  }

  async function startJob(kind) {
    await request(kind, async () => {
      job = (await ctx.api("/api/is", { b: ctx.path(), kind, format: ctx.format() })).job;
      poll();
    });
    render();
    renderSteps();
  }

  /** No approval yet: leave Claude a request to show the script, ask, then speak the lines. */
  async function askClaudeForAudio() {
    await request("istek", async () => {
      await ctx.api("/api/istek", {
        b: ctx.path(),
        hedef: { tur: "bolum", etiket: "sesler" },
        metin: "Sesleri üret: senaryo onaylı değil. Replikleri bana göster, onayımı al, sonra cizgi ses ile seslendir.",
      });
      return "İstek Claude'a gitti: senaryoyu gösterip onayını soracak, sonra seslendirecek.";
    });
    render();
  }

  async function stopJob() {
    if (!(await confirmInPage(`${JOB_TEXT[job.kind] || job.kind} işi durdurulsun mu?`, { detail: "Sonra yeniden başlatabilirsin.", yes: "Durdur" }))) return;
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
      if (els.dialog.open && !script && !scriptError) await loadScript(); // the senaryo stage's table, once per opening
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

  /** The chips in the top bar: each step with how far it is. */
  function renderSteps() {
    const s = ctx.status();
    const g = s?.gates || {};
    const a = s?.audio;
    const audioDone = a ? a.lines - a.todo.length : 0;
    const drafts = outputs.videos.filter(isDraft).length;
    const finals = outputs.videos.length - drafts;
    const steps = [
      ["Senaryo", g.senaryo === "onayli" ? "ok" : g.senaryo === "eskimis" ? "stale" : "", GATE_TEXT[g.senaryo] || "durum bilinmiyor", 0],
      [a ? `Ses ${audioDone}/${a.lines}` : "Ses", a && !a.todo.length ? (a.failed?.length ? "stale" : "ok") : "", a ? `${a.todo.length} replik bekliyor${a.failed?.length ? `, ${a.failed.length} dinleme kontrolünden geçmedi` : ""}` : "", 1],
      ["Storyboard", g.storyboard === "onayli" ? "ok" : g.storyboard === "eskimis" ? "stale" : "", GATE_TEXT[g.storyboard] || "", 2],
      finals ? ["Render ✓", "ok", `${finals} video${drafts ? `, ${drafts} taslak` : ""}`, 4]
        : drafts ? [`Taslak ${drafts}`, "", `${drafts} taslak video; asıl render storyboard onaylanınca Claude'la`, 3]
          : ["Render", "", "henüz video yok", 3],
    ];
    const next = steps.findIndex(([, cls]) => cls !== "ok");
    els.steps.replaceChildren(...steps.map(([text, cls, tip, at], i) => el("li", {},
      el("button", {
        type: "button", class: `${cls}${i === next && !cls ? " next" : ""}${job?.status === "running" && (job.kind === "ses" ? i === 1 : i >= 2) ? " busy" : ""}`,
        title: `${tip} · tıkla: üretim`,
        // the person's click opens that stage; Claude's (kanal.js clicks the first chip) opens the next open stage
        on: { click: (e) => show(e.isTrusted ? at : null) },
      }, text))));
  }

  /** Is each stage done (index as STAGES)? */
  function stageDone(s = ctx.status()) {
    const g = s?.gates || {};
    const a = s?.audio;
    return [g.senaryo === "onayli", !!a && !a.todo.length, g.storyboard === "onayli", outputs.videos.length > 0, outputs.videos.some((p) => !isDraft(p))];
  }

  /** A stage's short state for the step list and its title: {cls, text}. */
  function stageState(i) {
    const s = ctx.status();
    const g = s?.gates || {};
    const a = s?.audio;
    const done = stageDone(s)[i];
    const gate = (v) => ({ cls: v === "onayli" ? "ok" : v === "eskimis" ? "stale" : "", text: GATE_TEXT[v] || "durum bilinmiyor" });
    if (i === 0) return gate(g.senaryo);
    if (i === 1) return { cls: done ? "ok" : "", text: a ? `${a.lines - a.todo.length}/${a.lines} hazır` : "durum bilinmiyor" };
    if (i === 2) return gate(g.storyboard);
    if (i === 3) return { cls: done ? "ok" : "", text: done ? `${outputs.videos.length} video` : "yok" };
    return { cls: done ? "ok" : "", text: done ? "hazır" : "yok" };
  }

  const current = () => {
    const open = stageDone().indexOf(false);
    return stage ?? (open < 0 ? STAGES.length - 1 : open);
  };
  const go = (i) => {
    stage = Math.min(STAGES.length - 1, Math.max(0, i));
    tried = {};
    render();
    main.scrollTop = 0; // a new stage starts at its top
  };

  /**
   * A main action button. It is never greyed out to say "not yet": a click on a blocked one says why
   * under it (the reason shows as a hint before, as an error after a click, and goes when it is fixed).
   * Only its own request in flight locks it, with the wait shown on the button.
   */
  function action(key, text, why, run, { primary = true } = {}) {
    const busy = pending === key;
    const no = why();
    return el("div", { class: "uretim-eylem" },
      el("button", {
        class: `btn${primary ? " primary" : ""}`, type: "button", disabled: busy, "aria-busy": busy ? "true" : null,
        on: { click: () => { if (why()) { tried = { ...tried, [key]: true }; render(); } else run(); } },
      }, busy ? `${text}…` : text),
      no ? el("p", { class: tried[key] ? "pfield-hata" : "pfield-ipucu", role: tried[key] ? "alert" : null, text: no }) : null);
  }
  const runBtn = (kind, text, opts) => action(kind, `${text} (${ctx.format()})`, () => blocker(kind), () => startJob(kind), opts);

  /** The approval of a gate: what it records, then the person's button (or that it is given). */
  function approval({ gate, kapi, label, what, name, why, records, okText }) {
    if (gate === "onayli") return el("p", { class: "uretim-onay ok-line", text: okText });
    return el("section", { class: "uretim-onay", "aria-label": `${name} onayı` },
      el("h4", { text: `${name} onayı` }),
      el("p", { class: "uretim-not", text: records }),
      gate === "eskimis" ? el("p", { class: "warn small", text: "Önceki onay düştü: içerik onaydan sonra değişti." }) : null,
      action(kapi, label, why, () => approve(kapi, what, name)));
  }

  /** Stage 1: decisions, the script table, what the library lacks, and the approval. */
  function scriptStage(g) {
    if (ctx.dirty()) return emptyState("Kaydedilmemiş değişiklikler var", "Üretim kayıtlı dosyadan yapılır: önce kaydet, sonra senaryoya bak.");
    if (scriptError) return el("p", { class: "pfield-hata", role: "alert", text: scriptError });
    if (!script) return el("p", { class: "muted", "aria-busy": "true", text: "Senaryo yükleniyor…" });
    const missing = script.kararlar.eksik;
    // not chosen yet: picked here; anything else (a choice the episode contradicts) is fixed where it lives
    const notChosen = (m) => m.includes("not chosen");
    const openKeys = DECISIONS.filter(([key]) => missing.some((m) => m.startsWith(`${key}:`) && notChosen(m)));
    const contradictions = missing.filter((m) => !notChosen(m));
    const decisionField = ([key, label, options]) => el("div", { class: "pfield" },
      el("span", { class: "pfield-ad", id: `uretim-karar-${key}`, text: label }),
      el("div", { class: "psegment", role: "radiogroup", "aria-labelledby": `uretim-karar-${key}` }, options.map(([v, t, sub]) => el("button", {
        type: "button", role: "radio", "aria-checked": String(picks[key] === v), class: picks[key] === v ? "secili" : "",
        on: { click: () => { if (picks[key] === v) delete picks[key]; else picks[key] = v; render(); } },
      }, el("span", { text: t }), sub ? el("small", { text: sub }) : null))));
    const table = el("div", { class: "ptablo-kap" }, el("table", { class: "ptablo" },
      el("thead", {}, el("tr", {}, COLUMNS.map(([, t]) => el("th", { scope: "col", text: t })))),
      el("tbody", {}, script.satirlar.map((r) => el("tr", { tabindex: "0", title: "Tıkla: bu shot'ı düzenleyicide aç", on: { click: () => ctx.goShot(r.plan), keydown: (e) => { if (e.key === "Enter") ctx.goShot(r.plan); } } },
        COLUMNS.map(([key]) => el("td", { text: Array.isArray(r[key]) ? r[key].join(" / ") || "—" : r[key] || "—" })))))));
    return [
      openKeys.length
        ? el("section", { class: "uretim-blok uretim-kararlar", "aria-label": "Açık kararlar" },
          el("h4", { text: "Önce bu kararlar" }),
          el("p", { class: "uretim-not", text: "Hepsi gerekli: senaryo bunlar seçilmeden onaylanamaz. Seçtiklerin bölüme kaydedilir." }),
          openKeys.map(decisionField),
          action("kararlar", "Kararları kaydet", () => (Object.keys(picks).length ? "" : "Kaydetmek için yukarıdan en az bir seçim yap."), saveDecisions, { primary: false }))
        : null,
      contradictions.length ? el("ul", { class: "warn uretim-liste" }, contradictions.map((m) => el("li", { text: tr(m) }))) : null,
      el("section", { class: "uretim-blok", "aria-label": "Senaryo tablosu" },
        el("h4", { text: script.baslik || "Senaryo" }),
        el("p", { class: "uretim-not", text: "Satıra tıkla ya da Enter'a bas: o shot düzenleyicide açılır." }),
        table),
      script.new_assets.length ? el("p", { class: "warn", text: `Kütüphanede olmayanlar: ${script.new_assets.map((n) => `${n.name} (${n.type})`).join(", ")}` }) : null,
      approval({
        gate: g.senaryo, kapi: "senaryo", label: "Senaryoyu onayla", what: "Senaryoyu", name: "Senaryo",
        why: () => (missing.length ? `Önce ${missing.length} eksik kararı tamamla (yukarıda).` : ""),
        records: "Onay, senaryonun şu anki hâlini kayda geçirir (cizgi onayla ile aynı denetimler); sesler bundan sonra üretilir. Metin, hareket ya da kamera sonra değişirse onay düşer. Bu düğmeye yalnız sen basarsın.",
        okText: "Senaryo onaylı. Metin değişirse onay düşer.",
      }),
    ];
  }

  /** Stage 2: how many lines are spoken; speak them here once approved, else ask Claude. */
  function audioStage(g, a) {
    if (!a) return emptyState("Ses durumu bilinmiyor", "Bölümde hata olabilir: düzenleyicideki sorunları düzelt, sonra buraya dön.");
    return [
      a.todo.length ? el("p", { class: "uretim-not", text: `Seslendirilecek: ${a.todo.join(", ")}.` }) : el("p", { class: "ok-line", text: "Bütün replikler seslendirildi." }),
      a.failed?.length ? el("p", { class: "warn", text: `${a.failed.length} replik dinleme kontrolünden geçmedi: replik satırlarında görebilirsin.` }) : null,
      !a.todo.length ? null
        : g.senaryo === "onayli" ? action("ses", "Sesleri üret", audioBlocker, () => startJob("ses"))
          : [action("istek", "Claude'dan iste", audioBlocker, askClaudeForAudio, { primary: false }),
            el("p", { class: "uretim-not", text: "Senaryo onaylı değil: Claude replikleri gösterip onayını sorar, sonra seslendirir. Ya da önce Senaryo adımında kendin onayla." })],
    ];
  }

  /** A grid of stills or a list of videos, or what to press to get them. */
  const sheets = () => (outputs.sheets.length
    ? el("div", { class: "psheets" }, outputs.sheets.map((p) => el("a", { href: base + p, target: "_blank", rel: "noopener" }, el("img", { src: base + p, alt: p, loading: "lazy" }))))
    : emptyState("Henüz kare yok", "“Storyboard karelerini al” her shot'tan iki kare çıkarır; kareler burada görünür."));
  const videos = (list, empty) => (list.length
    ? list.map((p) => el("figure", { class: "pvideo" }, el("video", { src: base + p, controls: true, preload: "metadata" }), el("figcaption", { text: p })))
    : empty);

  function storyboardStage(g, a) {
    const has = outputs.sheets.length > 0;
    return [
      runBtn("storyboard", has ? "Kareleri yeniden al" : "Storyboard karelerini al", { primary: !has }),
      sheets(),
      has ? el("p", { class: "uretim-not", text: "Bir karede sorun varsa düzenleyicide “Claude'a yaz” ile söyle." }) : null,
      approval({
        gate: g.storyboard, kapi: "storyboard", label: "Storyboard'u onayla", what: "Storyboard'u", name: "Storyboard",
        why: () => (ctx.dirty() ? "Önce kaydet." : g.senaryo !== "onayli" ? "Önce senaryo onayı." : a?.todo.length ? "Önce bütün replikler seslendirilmeli." : !has ? "Önce storyboard karelerini al." : ""),
        records: "Onay, karelerin şu anki hâlini kayda geçirir; son video ancak bundan sonra çıkar. Sonraki her değişiklik onayı düşürür. Bu düğmeye yalnız sen basarsın.",
        okText: "Storyboard onaylı. Sonraki her değişiklik onayı düşürür.",
      }),
    ];
  }

  function draftStage(a) {
    return [
      a?.todo.length ? el("p", { class: "warn", text: `Dikkat: ${a.todo.length} replik seslendirilmedi ya da metni sonradan değişti; taslakta sessiz ya da eski sesiyle geçer.` }) : null,
      el("div", { class: "uretim-satir" }, runBtn("taslak", "Taslak video çıkar"), runBtn("taslak3b", "Taslak 3B video", { primary: false })),
      videos(outputs.videos.filter(isDraft), emptyState("Henüz taslak yok", "“Taslak video çıkar” birkaç dakikada düşük kaliteli bir önizleme yapar.")),
    ];
  }

  function finalStage() {
    return [
      runBtn("render", "Son videoyu çıkar"),
      videos(outputs.videos.filter((p) => !isDraft(p)), emptyState("Henüz son video yok", "Storyboard onaylanınca “Son videoyu çıkar” ile tam kalitede çıkar.")),
    ];
  }

  /** The last lines of a job's output that are not progress (bars, "ilerleme" lines). */
  function lastWords(log) {
    return log.split(/\r?\n|\r/).filter((l) => l.trim() && !l.startsWith("ilerleme ") && !/^[^|]*\d+%\|/.test(l)).slice(-8).join("\n");
  }

  /** A running audio job's step and count as a bar ("Seslendiriliyor 2/5"). */
  function progressBar(p) {
    if (!p) return el("p", { class: "muted small", text: "Hazırlanıyor (ses modeli yükleniyor)…" });
    const label = p.bitti === 0 ? `${PROGRESS_TEXT[p.adim]}: başlıyor…` : `${PROGRESS_TEXT[p.adim]} ${p.bitti}/${p.toplam}`;
    return el("div", { class: "pprog" },
      el("progress", { max: String(p.toplam || 1), value: String(p.bitti), "aria-label": label }),
      el("span", { class: "small", text: label }));
  }

  /** The job, where its stage is: state, progress, why it failed, a stop button while it runs. */
  function jobBox() {
    const ses = job.kind === "ses";
    return el("div", { class: `pjob ${job.status}`, role: "status" },
      el("b", { text: `${JOB_TEXT[job.kind] || job.kind}${ses ? "" : ` ${job.format}`}: ${job.status === "running" ? "sürüyor…" : job.status === "done" ? "bitti" : "olmadı"}` }),
      job.error ? el("p", { class: "err small perr", text: tr(job.error) }) : null, // several lines: what failed, then why
      ses && job.status === "running" ? progressBar(job.progress) : null,
      // the speech tools' own last words say why it stopped (a missing model, out of memory…)
      ses && job.status === "failed" && job.log ? el("pre", { class: "plog", text: lastWords(job.log) }) : null,
      ses && job.status === "done" && job.result?.failed?.length
        ? el("p", { class: "warn small", text: `${job.result.failed.length} replik dinleme kontrolünden geçmedi: replik satırlarında görebilirsin.` })
        : null,
      job.status === "running" ? el("button", { class: "btn small danger", type: "button", on: { click: stopJob } }, "Durdur") : null,
      // an audio job has its bar instead (the speech model's own output is noise for a person)
      job.status === "running" && job.log && !ses ? el("pre", { class: "plog", text: job.log.split("\n").slice(-6).join("\n") }) : null);
  }

  function render() {
    const s = ctx.status();
    const g = s?.gates || {};
    const a = s?.audio;
    const cur = current();
    const st = stageState(cur);
    const jobAt = job ? JOB_STAGE[job.kind] ?? cur : -1;
    const body = [() => scriptStage(g), () => audioStage(g, a), () => storyboardStage(g, a), () => draftStage(a), finalStage][cur]();
    nav.replaceChildren(el("ol", {}, STAGES.map(([t], i) => {
      const si = stageState(i);
      const running = job?.status === "running" && jobAt === i;
      return el("li", {}, el("button", {
        type: "button", class: `${i === cur ? "simdi" : ""}${si.cls === "ok" ? " tamam" : ""}${si.cls === "stale" ? " eski" : ""}${running ? " suruyor" : ""}`,
        "aria-current": i === cur ? "step" : null, on: { click: () => go(i) },
      }, el("span", { class: "padim-no", "aria-hidden": "true", text: si.cls === "ok" && i !== cur ? "✓" : String(i + 1) }),
      el("span", { class: "uretim-adim" }, el("span", { text: t }), el("small", { text: running ? "sürüyor…" : si.text }))));
    })));
    const last = cur === STAGES.length - 1;
    header.replaceChildren(
      el("div", { class: "psih-baslik" }, el("h2", { text: "Üretim" }), script?.baslik ? el("span", { class: "muted", text: script.baslik }) : null),
      el("button", { class: "btn", type: "button", text: "Kapat", on: { click: () => els.dialog.close() } }));
    main.replaceChildren(
      el("div", { class: "psih-sutun uretim-sutun" },
        el("h3", {}, STAGES[cur][0], el("span", { class: `pstate ${st.cls}`, text: st.text })),
        el("p", { class: "psih-aciklama", text: STAGES[cur][1] }),
        error ? el("p", { class: "pfield-hata uretim-mesaj", role: "alert", text: error }) : null,
        note && !error ? el("p", { class: "psih-bilgi", role: "status", text: note }) : null,
        job && jobAt === cur ? jobBox() : null,
        job?.status === "running" && jobAt !== cur
          ? el("p", { class: "psih-bilgi" }, `${JOB_TEXT[job.kind] || job.kind} sürüyor. `,
            el("button", { class: "btn small ghost", type: "button", text: "Göster", on: { click: () => go(jobAt) } }))
          : null,
        el("div", { class: "pgovde" }, body)),
      el("footer", { class: "psih-alt" },
        el("div", { class: "psih-sutun row" },
          el("button", { class: "btn", type: "button", disabled: cur === 0, text: "← Geri", on: { click: () => go(cur - 1) } }),
          el("span", { class: "bosluk" }),
          last
            ? el("button", { class: "btn", type: "button", text: "Düzenleyiciye dön", on: { click: () => els.dialog.close() } })
            : el("button", { class: "btn", type: "button", text: `İleri: ${STAGES[cur + 1][0]} →`, on: { click: () => go(cur + 1) } }))));
    if (header.parentElement !== els.dialog) els.dialog.replaceChildren(header, el("div", { class: "psih-alan" }, nav, main, claudeCol));
  }

  /** Open the page, at a stage (index as STAGES) or, without one, at the first stage not done. */
  function show(at) {
    if (!ctx.path()) return;
    script = null; // read the saved script again: it may have changed since
    scriptError = "";
    stage = Number.isInteger(at) ? at : null;
    tried = {};
    render();
    main.scrollTop = 0;
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
