/**
 * Object chats (the panel's object window): the person clicks one thing on the stage, a character
 * or a prop, and talks to Claude about just that thing. Each thing has its own short conversation,
 * keyed by its kind and drawing id ("karakter:kiz", "nesne:telefon").
 *
 *   kisi    the person's message (POST /api/kanal/sohbet); the channel hands it to Claude
 *   claude  Claude's reply or working note (MCP panel_sohbet): text, pictures, suggestion chips
 *   durum   every conversation, for the panel's poll (GET /api/kanal → sohbet)
 *
 * Everything is checked here and drawn as text by the panel; pictures can only be the panel's own drawings.
 */

export const CHAT_KINDS = Object.freeze(["karakter", "nesne"]);
const ID = /^[a-z0-9_-]{1,60}$/;
const SHOT = /^[a-z0-9_-]{1,40}$/;
const PICTURE = /^\/(kutuphane|kutuphane-taslak)\/(karakter|mekan|nesne|konsept)\/[a-z0-9_-]{1,60}\.svg$/;
const MAX_MESSAGES = 40; // per conversation: older ones drop off
const MAX_CHATS = 30;
const MAX_TEXT = 2000;
const MAX_PICTURES = 4;
const MAX_SUGGESTIONS = 6;
// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp("[\\u0000-\\u001f\\u007f\\u2028\\u2029]");

function words(value, name, max, { optional = false, multiline = false } = {}) {
  if (value === undefined && optional) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${name}: 1-${max} karakterlik bir metin olmalı`);
  if (!multiline && CONTROL.test(value)) throw new Error(`${name}: tek satır olmalı`);
  return value.trim();
}

/** "karakter:kiz" → {tur, id}; the key every reply names. */
export function parseKey(key) {
  const m = typeof key === "string" ? /^([a-z]+):(.+)$/.exec(key) : null;
  if (!m || !CHAT_KINDS.includes(m[1]) || !ID.test(m[2])) throw new Error(`konu "<${CHAT_KINDS.join("|")}>:<çizim kimliği>" olmalı (örnek: karakter:kiz)`);
  return { tur: m[1], id: m[2] };
}

/** What the person clicked: its kind and drawing id, and where (episode, shot, cast id) for Claude. */
export function cleanTopic(t) {
  if (!t || typeof t !== "object") throw new Error("konu bir nesne olmalı");
  const { tur, id } = parseKey(`${t.tur}:${t.id}`);
  const out = { tur, id };
  const ad = words(t.ad, "ad", 80, { optional: true });
  if (ad) out.ad = ad;
  const bolum = words(t.bolum, "bolum", 300, { optional: true });
  if (bolum) out.bolum = bolum;
  if (t.shot !== undefined) {
    if (typeof t.shot !== "string" || !SHOT.test(t.shot)) throw new Error("shot bir shot kimliği olmalı");
    out.shot = t.shot;
  }
  if (t.oyuncu !== undefined) {
    if (typeof t.oyuncu !== "string" || !ID.test(t.oyuncu)) throw new Error("oyuncu bir karakter kimliği olmalı");
    out.oyuncu = t.oyuncu;
  }
  return out;
}

function cleanPictures(list) {
  if (list === undefined) return undefined;
  if (!Array.isArray(list) || list.length > MAX_PICTURES || list.some((g) => typeof g !== "string" || !PICTURE.test(g))) {
    throw new Error(`gorsel en çok ${MAX_PICTURES} panel çizimi olmalı (/kutuphane/… ya da /kutuphane-taslak/….svg)`);
  }
  return [...list];
}

function cleanSuggestions(list) {
  if (list === undefined) return undefined;
  if (!Array.isArray(list) || list.length > MAX_SUGGESTIONS) throw new Error(`oneriler en çok ${MAX_SUGGESTIONS} kısa metin olmalı`);
  return list.map((s, i) => words(s, `öneri ${i + 1}`, 80));
}

/** @param {{now?:() => number}} [opts] */
export function createChats({ now = () => Date.now() } = {}) {
  let chats = new Map(); // key → {konu, mesajlar, durum, seq}
  let seq = 0;

  function touch(key, konu, change) {
    const old = chats.get(key) || { konu, mesajlar: [], durum: null };
    const next = change({ ...old, konu: { ...old.konu, ...konu } });
    const rest = [...chats].filter(([k]) => k !== key).slice(-(MAX_CHATS - 1)); // the newest stay
    chats = new Map([...rest, [key, { ...next, seq: ++seq }]]);
    return chats.get(key);
  }
  const add = (list, m) => [...list, { ...m, at: now() }].slice(-MAX_MESSAGES);

  return {
    /** The person's message about the thing they clicked. @returns {{key:string, konu:object, metin:string}} */
    kisi(topic, metin) {
      const konu = cleanTopic(topic);
      const text = words(metin, "metin", MAX_TEXT, { multiline: true });
      const key = `${konu.tur}:${konu.id}`;
      touch(key, konu, (c) => ({ ...c, mesajlar: add(c.mesajlar, { kim: "kisi", metin: text }), durum: "Claude'a iletildi" }));
      return { key, konu, metin: text };
    },
    /** Claude's reply (metin, gorsel, oneriler) and/or what it is doing now (durum; a reply clears it). */
    claude({ konu: key, metin, durum, gorsel, oneriler } = {}) {
      const { tur, id } = parseKey(key);
      const text = words(metin, "metin", MAX_TEXT, { optional: true, multiline: true });
      const pictures = cleanPictures(gorsel);
      const chips = cleanSuggestions(oneriler);
      const working = durum === undefined || durum === null ? undefined : words(durum, "durum", 160);
      if (!text && !pictures && !chips && working === undefined) throw new Error("metin, durum, gorsel ya da oneriler ver");
      const c = touch(`${tur}:${id}`, { tur, id }, (old) => ({
        ...old,
        mesajlar: text || pictures || chips
          ? add(old.mesajlar, { kim: "claude", ...(text ? { metin: text } : {}), ...(pictures ? { gorsel: pictures } : {}), ...(chips ? { oneriler: chips } : {}) })
          : old.mesajlar,
        durum: working ?? null, // a reply without a note means Claude is done with it
      }));
      return { konu: `${tur}:${id}`, mesajlar: c.mesajlar.length, durum: c.durum };
    },
    /** Claude stopped listening with a message still unanswered: say so in that window. */
    bekliyor(key, note) {
      if (!chats.has(key)) return;
      touch(key, {}, (c) => ({ ...c, durum: note }));
    },
    durum() {
      return { seq, sohbetler: [...chats.values()].map((c) => ({ ...c, konu: { ...c.konu }, mesajlar: c.mesajlar.map((m) => ({ ...m })) })) };
    },
  };
}
