/**
 * The channel from Claude to the open panel (MCP tools panel_git and panel_sor):
 *
 *   yonlendir  move the panel: open an episode, a left panel, select a shot, scroll, highlight a button
 *   sor        show a question with option cards (and pictures) in the panel; the answer comes back
 *              to the waiting tool call, or, after it gave up waiting, to the late-answer handler
 *              (the MCP server puts it in the request queue, so the hooks hand it to Claude)
 *
 *   GET  /api/kanal         {yon, soru}: the last navigation (by seq) and the open question
 *   POST /api/kanal/cevap   {id, secim, metin}: the person's answer
 *
 * Only one question is open at a time. Everything shown is text from Claude's tool call, checked
 * here and drawn as text by the panel; pictures can only be the panel's own drawings.
 */
import { randomBytes } from "node:crypto";
import { HttpError } from "./panel-proje.mjs";

export const PANELS = Object.freeze(["projeler", "sahneler", "karakter", "hareket", "mekan", "nesne", "ses", "muzik", "kamera", "hikaye"]);
const SCROLL = Object.freeze(["taslaklar"]);
const SHOT = /^[a-z0-9_-]{1,40}$/;
// a library drawing or a draft (incl. concept sketches), as the panel serves them
const PICTURE = /^\/(kutuphane|kutuphane-taslak)\/(karakter|mekan|nesne|konsept)\/[a-z0-9_-]{1,60}\.svg$/;
const MAX_OPTIONS = 8;
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
export function createChannel({ onLateAnswer } = {}) {
  let seq = 0;
  let nav = null;
  let question = null; // {id, soru, secenekler, coklu, serbest, seq}
  let waiter = null; // {id, done}

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
      return nav;
    },
    sor(q) {
      const clean = cleanQuestion(q);
      release(null); // the open question is dropped: whoever waited for it learns that
      question = { id: `s${Date.now().toString(36)}${randomBytes(3).toString("hex")}`, ...clean, seq: ++seq };
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
      question = null;
      if (!release(answer)) onLateAnswer?.(answer, about);
      return answer;
    },
    durum() {
      return { yon: nav, soru: question ? { ...question } : null };
    },
  };
}

/** The panel's routes of the channel. */
export function channelRoutes(channel) {
  return {
    "GET /api/kanal": () => channel.durum(),
    "POST /api/kanal/cevap": (body) => {
      try {
        channel.cevapla(String(body?.id ?? ""), { secim: body?.secim, metin: body?.metin });
      } catch (err) {
        throw new HttpError(400, err.message);
      }
      return { ok: true };
    },
  };
}
