/**
 * The channel from Claude to the open panel (MCP tools panel_git and panel_sor):
 *
 *   yonlendir  move the panel: open an episode, a left panel, select a shot, scroll, highlight a button
 *   sor        show a question with option cards (and pictures) in the panel; the answer comes back
 *              to the waiting tool call, or, after it gave up waiting, to the late-answer handler
 *              (the MCP server puts it in the request queue, so the hooks hand it to Claude)
 *
 *   sohbet     the person talks to Claude about one thing on the stage (the object window, see
 *              panel-sohbet.mjs): it goes to Claude's waiting panel_dinle call, or, when Claude is not
 *              listening, to the idle-chat handler (the MCP server puts it in the request queue);
 *              Claude answers with panel_sohbet
 *
 *   taslak     the person took drafts into the library (or put one aside): panel_dinle hears it
 *
 *   GET  /api/kanal         {yon, soru, dusunuyor, dinliyor, sohbet}
 *   POST /api/kanal/cevap   {id, secim, metin}: the person's answer
 *   POST /api/kanal/sohbet  {konu: {tur, id, ad?, bolum?, shot?, oyuncu?}, metin}: a message in an object window → {dinliyor}
 *
 * Only one question is open at a time. Everything shown is text from Claude's tool call, checked
 * here and drawn as text by the panel; pictures can only be the panel's own drawings.
 */
import { randomBytes } from "node:crypto";
import { HttpError } from "./panel-proje.mjs";
import { createChats } from "./panel-sohbet.mjs";

export const PANELS = Object.freeze(["projeler", "uretim", "sahneler", "karakter", "hareket", "mekan", "nesne", "ses", "muzik", "kamera", "hikaye"]);
const SCROLL = Object.freeze(["taslaklar"]);
const SHOT = /^[a-z0-9_-]{1,40}$/;
// a library drawing or a draft (incl. concept sketches), as the panel serves them
// a spoken line of an episode, relative to the panel folder: <episode folder>/ses/<shot>-<n>.wav
// a spoken line (<episode>/ses/<shot>-<n>.wav) or a voice sample (<episode>/cikti/ses-ornegi-<id>.wav)
export const LINE_AUDIO = /^(?:[A-Za-z0-9_-]+\/){1,6}(?:ses\/[A-Za-z0-9_-]{1,80}|cikti\/ses-ornegi-[a-z0-9_-]{1,80})\.wav$/;
const PICTURE = /^\/(kutuphane|kutuphane-taslak)\/(karakter|mekan|nesne|konsept)\/[a-z0-9_-]{1,60}\.svg$/;
const MAX_OPTIONS = 8;
const QUESTION_MAX = 1500;
// a sound an option card plays, so the person picks by ear: a library track or effect, or a spoken line
const OPTION_SOUND = /^\/kutuphane\/(muzik|ses)\/[a-z0-9_-]{1,80}\.wav$/;
const MAX_ASKS = 10;
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
  const known = new Set(["bolum", "sekme", "shot", "kaydir", "vurgula"]);
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
  if (!Object.keys(out).length) throw new Error("yönlendirme boş: bolum, sekme, shot, kaydir ya da vurgula ver");
  return out;
}

function cleanQuestion(q) {
  if (!q || typeof q !== "object") throw new Error("soru bir nesne olmalı");
  const soru = text(q.soru, "soru", QUESTION_MAX, { multiline: true });
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
    if (o.ses !== undefined) {
      if (typeof o.ses !== "string" || !(OPTION_SOUND.test(o.ses) || LINE_AUDIO.test(o.ses))) {
        throw new Error("seçeneğin sesi bir kütüphane sesi (/kutuphane/muzik/<id>.wav, /kutuphane/ses/<id>.wav) ya da bir replik sesi olmalı");
      }
      out.ses = o.ses;
    }
    return out;
  });
  if (new Set(secenekler.map((o) => o.etiket)).size !== secenekler.length) throw new Error("seçeneklerin etiketleri farklı olmalı");
  const bolum = text(q.bolum, "bolum", 300, { optional: true }); // the episode it is about (a late answer names it)
  if (q.ses !== undefined && (typeof q.ses !== "string" || !LINE_AUDIO.test(q.ses))) throw new Error("ses bir replik sesi ya da ses örneği olmalı: <bölüm klasörü>/ses/<shot>-<n>.wav ya da <bölüm klasörü>/cikti/ses-ornegi-<id>.wav");
  return { soru, secenekler, coklu: q.coklu === true, serbest: q.serbest !== false, ...(bolum ? { bolum } : {}), ...(q.ses ? { ses: q.ses } : {}) };
}

/**
 * @param {{onLateAnswer?:(answer:{id:string, soru:string, secim:string[], metin:string}) => void}} [opts]
 */
export function createChannel({ onLateAnswer, onIdleChat, now = () => Date.now() } = {}) {
  const chats = createChats({ now }); // the object windows' conversations
  let seq = 0;
  let nav = null;
  let question = null; // {id, soru, secenekler, coklu, serbest, seq}
  let waiter = null; // {id, done}
  let thinkingSince = 0; // the person answered: Claude works until its next move in the panel
  let asks = []; // object-window messages and draft news not handed to Claude yet
  let listener = null; // Claude's panel_dinle call: {done, timer}
  let applied = 0; // the last move (yon.seq) a panel tab reported as carried out
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
    /** The panel carried out move `seq` (POST /api/kanal/gitti). */
    gitti(n) {
      if (Number.isInteger(n) && n > applied && n <= seq) applied = n;
    },
    /** The last move a panel tab carried out. */
    uygulanan: () => applied,
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
    /**
     * The person's message in an object window. Claude gets it now if it listens (panel_dinle), else
     * later: through onIdleChat (the request queue) or the next panel_dinle.
     */
    sohbet(topic, metin) {
      const msg = chats.kisi(topic, metin);
      const item = { tur: "sohbet", konu: msg.konu, metin: msg.metin, at: now() };
      if (hear([item])) {
        chats.bekliyor(msg.key, "Claude okuyor…");
        return { dinliyor: true };
      }
      chats.bekliyor(msg.key, "Claude şu an başka bir işte: mesajın sırada, işi bitince görecek.");
      if (onIdleChat) onIdleChat(item);
      else asks = [...asks, item].slice(-MAX_ASKS);
      return { dinliyor: false };
    },
    /**
     * A request was written in the panel's "Claude'a yaz" box (the request queue): wake a listening
     * Claude, which then takes it from the queue. Before, it waited for the end of a turn that never
     * came while Claude listened (Test 16: "üretimler hiç bitmiyor").
     * @returns {boolean} whether someone was listening
     */
    uyandir() {
      return hear([{ tur: "kuyruk", at: now() }]);
    },
    /**
     * The person took drafts into the library (or put one aside) in the panel: a listening Claude
     * hears it at once, a busy one at its next panel_dinle, and carries on with what waited for the drawings.
     * @param {{islem:string, cizimler:{tur:string, id:string}[]}} what
     */
    taslak({ islem, cizimler }) {
      const item = { tur: "taslak", islem, cizimler, at: now() };
      if (hear([item])) return true;
      asks = [...asks, item].slice(-MAX_ASKS);
      return false;
    },
    /** Claude's reply in an object window (panel_sohbet). */
    sohbetCevap(args) {
      return chats.claude(args);
    },
    /** Claude listens (panel_dinle): the asks waiting, or the next one within `ms`, or [] then. */
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
    durum() {
      // the panel locks its buttons and shows Claude thinking; it lets go if Claude stays silent too long
      const dusunuyor = !!thinkingSince && now() - thinkingSince < THINKING_MAX_MS;
      return { yon: nav, soru: question ? { ...question } : null, dusunuyor, dinliyor: !!listener, sohbet: chats.durum() };
    },
  };
}

/** The panel's routes of the channel. */
export function channelRoutes(channel) {
  return {
    "GET /api/kanal": () => {
      channel.gorundu();
      return channel.durum();
    },
    "POST /api/kanal/gitti": (body) => {
      channel.gitti(Number(body?.seq));
      return { ok: true };
    },
    "POST /api/kanal/cevap": (body) => {
      try {
        channel.cevapla(String(body?.id ?? ""), { secim: body?.secim, metin: body?.metin });
      } catch (err) {
        throw new HttpError(400, err.message);
      }
      return { ok: true };
    },
    "POST /api/kanal/sohbet": (body) => {
      try {
        return channel.sohbet(body?.konu, body?.metin);
      } catch (err) {
        throw new HttpError(400, err.message);
      }
    },
  };
}
