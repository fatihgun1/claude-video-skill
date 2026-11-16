/**
 * The channel from Claude to the open panel (MCP tools panel_git and panel_sor):
 *
 *   yonlendir  move the panel: open an episode, a left panel, select a shot, scroll, highlight a button
 *   sor        show a question with option cards (and pictures) in the panel; the answer comes back
 *              to the waiting tool call, or, after it gave up waiting, to the late-answer handler
 *              (the MCP server puts it in the request queue, so the hooks hand it to Claude)
 *
 *   iste       the person asks Claude about a field of the project wizard ("Claude'a sor"): it goes to
 *              Claude's waiting panel_dinle call, or, when Claude is not listening, to the idle-ask handler
 *              (the MCP server puts it in the request queue)
 *
 *   GET  /api/kanal         {yon, soru, sihirbaz, dusunuyor, dinliyor}
 *   POST /api/kanal/cevap   {id, secim, metin}: the person's answer
 *   POST /api/kanal/iste    {proje, adim, alan?, etiket?}: "Claude'a sor" → {dinliyor}
 *
 * Only one question is open at a time. Everything shown is text from Claude's tool call, checked
 * here and drawn as text by the panel; pictures can only be the panel's own drawings.
 */
import { randomBytes } from "node:crypto";
import { HttpError } from "./panel-proje.mjs";

export const PANELS = Object.freeze(["projeler", "uretim", "sahneler", "karakter", "hareket", "mekan", "nesne", "ses", "muzik", "kamera", "hikaye"]);
const SCROLL = Object.freeze(["taslaklar"]);
/** The project wizard's steps (panel/proje-sihirbaz.js) and the ids of episodes it makes. */
export const PROJECT_STEPS = Object.freeze(["hikaye", "kararlar", "karakterler", "sahneler", "ses", "ozet"]);
const PROJECT_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SHOT = /^[a-z0-9_-]{1,40}$/;
// a library drawing or a draft (incl. concept sketches), as the panel serves them
const PICTURE = /^\/(kutuphane|kutuphane-taslak)\/(karakter|mekan|nesne|konsept)\/[a-z0-9_-]{1,60}\.svg$/;
const MAX_OPTIONS = 8;
const FIELD = /^[a-z0-9_.-]{1,60}$/; // a wizard field: baslik, istekler.sure, kartlar.k2.mekan…
const MAX_ASKS = 10;
/** sor: a field question ("Claude'a sor"); olustur: the person pressed Oluştur (build the episode from the story). */
const ASK_KINDS = Object.freeze(["sor", "olustur"]);
const THINKING_MAX_MS = 120_000;
export const WATCHED_MS = 6000;
// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp("[\\u0000-\\u001f\\u007f\\u2028\\u2029]");

function text(value, name, max, { optional = false, multiline = false } = {}) {
  if (value === undefined && optional) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${name}: 1-${max} karakterlik bir metin olmalı`);
  if (!multiline && CONTROL.test(value)) throw new Error(`${name}: tek satır olmalı`);
  return value.trim();
}

function cleanNav(cmd) {
  if (!cmd || typeof cmd !== "object") throw new Error("yönlendirme bir nesne olmalı");
  const known = new Set(["bolum", "sekme", "shot", "kaydir", "vurgula", "proje", "proje_adim"]);
  const extra = Object.keys(cmd).filter((k) => !known.has(k));
  if (extra.length) throw new Error(`bilinmeyen alan: ${extra.join(", ")}`);
  const out = {};
  if (cmd.bolum !== undefined) out.bolum = text(cmd.bolum, "bolum", 300);
  if (cmd.sekme !== undefined) {
    if (!PANELS.includes(cmd.sekme)) throw new Error(`sekme şunlardan biri olmalı: ${PANELS.join(", ")}`);
    out.sekme = cmd.sekme;
  }
  if (cmd.shot !== undefined) {
    if (typeof cmd.shot !== "string" || !SHOT.test(cmd.shot)) throw new Error("shot bir shot kimliği olmalı");
    out.shot = cmd.shot;
  }
  if (cmd.kaydir !== undefined) {
    if (!SCROLL.includes(cmd.kaydir)) throw new Error(`kaydir şunlardan biri olmalı: ${SCROLL.join(", ")}`);
    out.kaydir = cmd.kaydir;
  }
  if (cmd.vurgula !== undefined) out.vurgula = text(cmd.vurgula, "vurgula", 80);
  // the project wizard on an episode being made (bolumler/<proje>/hikaye.json), at one of its steps
  if (cmd.proje !== undefined) {
    if (typeof cmd.proje !== "string" || !PROJECT_ID.test(cmd.proje)) throw new Error("proje bir bölüm kimliği olmalı (bolumler/<kimlik>)");
    out.proje = cmd.proje;
  }
  if (cmd.proje_adim !== undefined) {
    if (out.proje === undefined) throw new Error("proje_adim yalnız proje ile verilir");
    if (!PROJECT_STEPS.includes(cmd.proje_adim)) throw new Error(`proje_adim şunlardan biri olmalı: ${PROJECT_STEPS.join(", ")}`);
    out.proje_adim = cmd.proje_adim;
  }
  if (!Object.keys(out).length) throw new Error("yönlendirme boş: bolum, sekme, shot, kaydir, vurgula ya da proje ver");
  return out;
}

/** A "Claude'a sor" from the project wizard: which episode, step and field (none: the whole step). */
function cleanAsk(a) {
  if (!a || typeof a !== "object") throw new Error("istek bir nesne olmalı");
  if (typeof a.proje !== "string" || !PROJECT_ID.test(a.proje)) throw new Error("proje bir bölüm kimliği olmalı");
  if (!PROJECT_STEPS.includes(a.adim)) throw new Error(`adim şunlardan biri olmalı: ${PROJECT_STEPS.join(", ")}`);
  const out = { proje: a.proje, adim: a.adim };
  if (a.tur !== undefined) {
    if (!ASK_KINDS.includes(a.tur)) throw new Error(`tur şunlardan biri olmalı: ${ASK_KINDS.join(", ")}`);
    if (a.tur !== "sor") out.tur = a.tur;
  }
  if (a.alan !== undefined) {
    if (typeof a.alan !== "string" || !FIELD.test(a.alan)) throw new Error("alan bir alan adı olmalı");
    out.alan = a.alan;
  }
  const etiket = text(a.etiket, "etiket", 120, { optional: true });
  if (etiket) out.etiket = etiket;
  return out;
}

function cleanQuestion(q) {
  if (!q || typeof q !== "object") throw new Error("soru bir nesne olmalı");
  const soru = text(q.soru, "soru", 500, { multiline: true });
  if (!Array.isArray(q.secenekler) || !q.secenekler.length || q.secenekler.length > MAX_OPTIONS) {
    throw new Error(`secenekler 1-${MAX_OPTIONS} seçenek olmalı`);
  }
  const secenekler = q.secenekler.map((o, i) => {
    if (!o || typeof o !== "object") throw new Error(`seçenek ${i + 1} bir nesne olmalı`);
    const out = { etiket: text(o.etiket, "etiket", 80) };
    const aciklama = text(o.aciklama, "aciklama", 300, { optional: true, multiline: true });
    if (aciklama) out.aciklama = aciklama;
    if (o.gorsel !== undefined) {
      if (typeof o.gorsel !== "string" || !PICTURE.test(o.gorsel)) throw new Error("gorsel panelin bir çizimi olmalı (/kutuphane/… ya da /kutuphane-taslak/….svg)");
      out.gorsel = o.gorsel;
    }
    return out;
  });
  if (new Set(secenekler.map((o) => o.etiket)).size !== secenekler.length) throw new Error("seçeneklerin etiketleri farklı olmalı");
  const bolum = text(q.bolum, "bolum", 300, { optional: true }); // the episode it is about (a late answer names it)
  return { soru, secenekler, coklu: q.coklu === true, serbest: q.serbest !== false, ...(bolum ? { bolum } : {}) };
}

/**
 * @param {{onLateAnswer?:(answer:{id:string, soru:string, secim:string[], metin:string}) => void}} [opts]
 */
export function createChannel({ onLateAnswer, onIdleAsk, now = () => Date.now() } = {}) {
  let seq = 0;
  let nav = null;
  let question = null; // {id, soru, secenekler, coklu, serbest, seq}
  let waiter = null; // {id, done}
  let wizard = null; // {id, baslik, adimlar, aktif, bitti, seq}
  let thinkingSince = 0; // the person answered: Claude works until its next move in the panel
  let asks = []; // "Claude'a sor" requests not handed to Claude yet
  let listener = null; // Claude's panel_dinle call: {done, timer}
  let seenAt = 0; // when a browser tab last polled the channel: is anyone looking at the panel?

  function hear(list) {
    if (!listener) return false;
    const l = listener;
    listener = null;
    clearTimeout(l.timer);
    l.done(list);
    return true;
  }

  function release(value) {
    if (!waiter) return false;
    const w = waiter;
    waiter = null;
    clearTimeout(w.timer);
    w.done(value);
    return true;
  }

  return {
    yonlendir(cmd) {
      nav = { ...cleanNav(cmd), seq: ++seq, at: Date.now() };
      thinkingSince = 0;
      return nav;
    },
    sor(q) {
      const clean = cleanQuestion(q);
      release(null); // the open question is dropped: whoever waited for it learns that
      question = { id: `s${Date.now().toString(36)}${randomBytes(3).toString("hex")}`, ...clean, seq: ++seq };
      thinkingSince = 0;
      return { id: question.id };
    },
    /** The answer to question `id`, or null when it does not come within `ms` (or the question was replaced). */
    bekle(id, ms) {
      if (!question || question.id !== id) return Promise.resolve(null);
      release(null);
      return new Promise((done) => {
        waiter = { id, done, timer: setTimeout(() => release(null), ms) };
      });
    },
    cevapla(id, { secim = [], metin = "" } = {}) {
      if (!question || question.id !== id) throw new Error("bu soru artık açık değil");
      if (!Array.isArray(secim) || secim.some((s) => typeof s !== "string")) throw new Error("secim bir liste olmalı");
      const labels = new Set(question.secenekler.map((o) => o.etiket));
      if (secim.some((s) => !labels.has(s))) throw new Error("seçim seçeneklerden biri olmalı");
      if (!question.coklu && secim.length > 1) throw new Error("bu soruda tek seçim yapılır");
      const note = typeof metin === "string" ? metin.trim().slice(0, 1000) : "";
      if (note && !question.serbest) throw new Error("bu soru yazılı cevap almıyor");
      if (!secim.length && !note) throw new Error("bir seçenek seç ya da cevabını yaz");
      const answer = { id, soru: question.soru, secim: [...new Set(secim)], metin: note };
      const about = question.bolum;
      thinkingSince = now();
      question = null;
      if (!release(answer)) onLateAnswer?.(answer, about);
      return answer;
    },
    /** The person asks Claude about a wizard field. Claude gets it now if it listens, else later through onIdleAsk. */
    iste(a) {
      const ask = { ...cleanAsk(a), at: now() };
      if (hear([ask])) {
        thinkingSince = now(); // Claude has it: the wizard waits for its question
        return { dinliyor: true };
      }
      if (onIdleAsk) {
        onIdleAsk(ask);
        return { dinliyor: false };
      }
      asks = [...asks.filter((x) => x.proje !== ask.proje || x.adim !== ask.adim || x.alan !== ask.alan), ask].slice(-MAX_ASKS);
      return { dinliyor: false };
    },
    /** Claude listens for "Claude'a sor" (panel_dinle): the asks waiting, or the next one within `ms`, or [] then. */
    dinle(ms) {
      hear([]); // one listener: an older call gives up
      if (asks.length) {
        const list = asks;
        asks = [];
        thinkingSince = now();
        return Promise.resolve(list);
      }
      thinkingSince = 0; // listening: Claude is not working on anything
      return new Promise((done) => {
        listener = { done, timer: setTimeout(() => hear([]), ms) };
      });
    },
    /** A browser tab polled the channel (GET /api/kanal). */
    gorundu() {
      seenAt = now();
    },
    /** Whether a browser tab has the panel open: it polls every 1.5 s, so a few seconds of silence means none. */
    izleniyor(ms = WATCHED_MS) {
      return !!seenAt && now() - seenAt < ms;
    },
    /** Start, move on or close the wizard (panel_adim). */
    sihirbaz(cmd) {
      wizard = applyWizard(wizard, cmd, ++seq);
      thinkingSince = 0;
      return copyWizard(wizard);
    },
    durum() {
      // the panel locks its buttons and shows Claude thinking; it lets go if Claude stays silent too long
      const dusunuyor = !!thinkingSince && now() - thinkingSince < THINKING_MAX_MS;
      return { yon: nav, soru: question ? { ...question } : null, sihirbaz: copyWizard(wizard), dusunuyor, dinliyor: !!listener };
    },
  };
}

/* ---------- the wizard: a modal in the panel whose steps Claude moves on (panel_adim) ---------- */

export const STEP_STATES = Object.freeze(["sirada", "calisiyor", "bekliyor", "bitti", "hata"]);
const STEP_ID = /^[a-z0-9_-]{1,40}$/;
const MAX_STEPS = 12;
const MAX_PICTURES = 6;

const copyWizard = (w) => (w ? { ...w, adimlar: w.adimlar.map((a) => ({ ...a, gorsel: [...a.gorsel] })) } : null);

function newWizard(def, seq) {
  if (!def || typeof def !== "object") throw new Error("sihirbaz bir nesne olmalı");
  const baslik = text(def.baslik, "baslik", 120);
  if (!Array.isArray(def.adimlar) || !def.adimlar.length || def.adimlar.length > MAX_STEPS) throw new Error(`adimlar 1-${MAX_STEPS} adım olmalı`);
  const adimlar = def.adimlar.map((a, i) => {
    if (!a || typeof a !== "object" || typeof a.id !== "string" || !STEP_ID.test(a.id)) throw new Error(`adım ${i + 1}: id küçük harf, rakam, - ya da _ olmalı`);
    return { id: a.id, baslik: text(a.baslik, "adım başlığı", 80), durum: "sirada", aciklama: "", gorsel: [] };
  });
  if (new Set(adimlar.map((a) => a.id)).size !== adimlar.length) throw new Error("adım kimlikleri farklı olmalı");
  return { id: `w${Date.now().toString(36)}${randomBytes(3).toString("hex")}`, baslik, adimlar, aktif: null, bitti: false, seq };
}

function applyWizard(wizard, cmd, seq) {
  if (!cmd || typeof cmd !== "object") throw new Error("komut bir nesne olmalı");
  if (cmd.kapat === true) return null;
  if (cmd.sihirbaz !== undefined) return newWizard(cmd.sihirbaz, seq);
  if (cmd.adim === undefined) throw new Error("sihirbaz, adim ya da kapat ver");
  if (!wizard) throw new Error("açık sihirbaz yok: önce sihirbaz ile başlat");
  const at = wizard.adimlar.findIndex((a) => a.id === cmd.adim);
  if (at < 0) throw new Error(`adım yok: ${cmd.adim} (var olanlar: ${wizard.adimlar.map((a) => a.id).join(", ")})`);
  const durum = cmd.durum ?? "calisiyor";
  if (!STEP_STATES.includes(durum)) throw new Error(`durum ${STEP_STATES.join(", ")} olmalı`);
  const aciklama = cmd.aciklama === undefined ? undefined : text(cmd.aciklama, "aciklama", 500, { multiline: true });
  let gorsel;
  if (cmd.gorsel !== undefined) {
    if (!Array.isArray(cmd.gorsel) || cmd.gorsel.length > MAX_PICTURES || cmd.gorsel.some((g) => typeof g !== "string" || !PICTURE.test(g))) {
      throw new Error(`gorsel en çok ${MAX_PICTURES} panel çizimi olmalı (/kutuphane/… ya da /kutuphane-taslak/….svg)`);
    }
    gorsel = cmd.gorsel;
  }
  const adimlar = wizard.adimlar.map((a, i) => {
    if (i < at && a.durum !== "hata") return { ...a, durum: "bitti" }; // moving on means the steps before are done
    if (i !== at) return a;
    return { ...a, durum, ...(aciklama !== undefined ? { aciklama } : {}), ...(gorsel ? { gorsel } : {}) };
  });
  const bitti = at === adimlar.length - 1 && durum === "bitti";
  return { ...wizard, adimlar, aktif: cmd.adim, bitti, seq };
}

/** The panel's routes of the channel. */
export function channelRoutes(channel) {
  return {
    "GET /api/kanal": () => {
      channel.gorundu();
      return channel.durum();
    },
    "POST /api/kanal/cevap": (body) => {
      try {
        channel.cevapla(String(body?.id ?? ""), { secim: body?.secim, metin: body?.metin });
      } catch (err) {
        throw new HttpError(400, err.message);
      }
      return { ok: true };
    },
    "POST /api/kanal/iste": (body) => {
      try {
        return channel.iste(body);
      } catch (err) {
        throw new HttpError(400, err.message);
      }
    },
  };
}
