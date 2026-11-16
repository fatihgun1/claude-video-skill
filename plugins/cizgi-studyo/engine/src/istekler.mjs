/**
 * The request queue between the editor panel and the Claude session it belongs to: one JSON
 * object per line, append-only.
 *
 * The panel adds a request (what the person typed, about what, where); the session's hooks
 * announce waiting requests to Claude; Claude takes them (MCP panel_istekleri) and answers
 * (panel_yanitla). Every change is a new line folded onto the request by id, so the panel,
 * the MCP server and a hook can all write without overwriting each other.
 *
 * The file lives in the user's home (~/.cizgi-studyo/istekler/<hash of the project folder>.jsonl),
 * never inside the project: a queue file shipped with a cloned or shared project must not be
 * able to speak to Claude as if the person had written it.
 *
 * A request is text: it is stored and shown, never run or used as a path. Every field that
 * reaches Claude's context is checked when read back and quoted when shown.
 *
 * Several Claude sessions may work in one project folder (and so share its queue). A request knows
 * the session whose panel it was written in (oturum); only that session's hook announces it and only
 * that session takes it. A request with no session (an older line, a panel with no session) is anyone's.
 *
 * States: bekliyor (waiting) → alindi (Claude took it) → yapildi | soru | olmadi.
 * A request taken and never answered stops counting as open after STALE_MS (the session died).
 */
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { createHash, randomBytes } from "node:crypto";

export const MAX_TEXT = 2000;
export const MAX_OPEN = 20; // waiting or taken at once
export const STALE_MS = 60 * 60 * 1000;
const MAX_FIELD = 120;
const MAX_PATH = 1000;
export const ANSWERS = ["yapildi", "soru", "olmadi"];
const STATES = new Set(["bekliyor", "alindi", ...ANSWERS]);
export const TARGETS = ["bolum", "sahne", "shot", "karakter", "nesne", "efekt", "replik"];
const TARGET_TEXT = { bolum: "bölüm", sahne: "sahne", shot: "shot", karakter: "karakter", nesne: "nesne", efekt: "efekt", replik: "replik" };
const ID = /^p[0-9a-z]{4,24}$/;
const SESSION = /^[A-Za-z0-9_-]{8,80}$/;
/** The session that owns each queue file (set by the panel that writes into it): queue file → session id. */
const owners = new Map();

/** The panel of session `session` writes into `file`: its requests are that session's. */
export function claimQueue(file, session) {
  if (typeof session === "string" && SESSION.test(session)) owners.set(file, session);
  else owners.delete(file);
}

/** Whether session `session` should see request `r` (no session on either side: yes). */
export const forSession = (r, session) => !r.oturum || !session || r.oturum === session;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]/g;

/**
 * The queue of a project folder's sessions.
 * @param {string} projectDir
 * @param {string} [base] where queues live (tests and CIZGI_ISTEK_KOK point elsewhere)
 */
export function queueOf(projectDir, base = process.env.CIZGI_ISTEK_KOK || join(homedir(), ".cizgi-studyo", "istekler")) {
  let key = resolve(projectDir);
  if (process.platform === "win32") key = key.toLowerCase(); // C:\Video and c:\video are one folder
  return join(base, `${createHash("sha256").update(key).digest("hex").slice(0, 16)}.jsonl`);
}

const oneLine = (v) => String(v).replace(CONTROL, " ");
const shortText = (v, max = MAX_FIELD) => typeof v === "string" && v.length <= max;

/** The target, checked field by field: only known kinds, short one-line strings and small numbers. */
function cleanTarget(h) {
  if (!h || typeof h !== "object" || !TARGETS.includes(h.tur)) return null;
  const out = { tur: h.tur };
  for (const k of ["shot", "sahne", "id", "etiket"]) {
    if (h[k] === undefined) continue;
    if (!shortText(h[k])) return null;
    out[k] = oneLine(h[k]);
  }
  if (h.index !== undefined) {
    if (!Number.isInteger(h.index) || h.index < 0 || h.index > 999) return null;
    out.index = h.index;
  }
  return out;
}

function cleanText(v, what) {
  const t = String(v ?? "").trim();
  if (!t) throw new Error(`${what} boş`);
  if (t.length > MAX_TEXT) throw new Error(`${what} çok uzun (en çok ${MAX_TEXT} karakter)`);
  return t;
}

/** A request line as written by addRequest; anything else is not a request. */
function validNew(rec) {
  return ID.test(rec.id) && rec.durum === "bekliyor" && typeof rec.at === "string" && !Number.isNaN(Date.parse(rec.at))
    && shortText(rec.root, MAX_PATH) && shortText(rec.b, MAX_PATH) && cleanTarget(rec.hedef) !== null
    && typeof rec.metin === "string" && rec.metin.length > 0 && rec.metin.length <= MAX_TEXT
    && (rec.zaman === undefined || (typeof rec.zaman === "number" && Number.isFinite(rec.zaman) && rec.zaman >= 0))
    && (rec.oturum === undefined || (typeof rec.oturum === "string" && SESSION.test(rec.oturum)));
}

/** What an update line may change: the state, the answer, the hook's mark and the time. */
function updateOf(rec) {
  const out = {};
  if (STATES.has(rec.durum)) out.durum = rec.durum;
  if (typeof rec.yanit === "string" && rec.yanit.length <= MAX_TEXT) out.yanit = rec.yanit;
  if (rec.duyuruldu === true) out.duyuruldu = true;
  if (typeof rec.guncel === "string" && !Number.isNaN(Date.parse(rec.guncel))) out.guncel = rec.guncel;
  return out;
}

function append(file, record) {
  mkdirSync(dirname(file), { recursive: true });
  let lead = "";
  if (existsSync(file)) {
    // a write cut short by a crash leaves a line without its end: start on a fresh line
    const size = statSync(file).size;
    if (size > 0) {
      const fd = openSync(file, "r");
      const last = Buffer.alloc(1);
      readSync(fd, last, 0, 1, size - 1);
      closeSync(fd);
      if (last[0] !== 0x0a) lead = "\n";
    }
  }
  appendFileSync(file, `${lead}${JSON.stringify(record)}\n`);
}

/** Every request with its latest state, oldest first. Lines that are not well-formed are skipped. */
export function readRequests(file) {
  if (!existsSync(file)) return [];
  const byId = new Map();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (!rec || typeof rec !== "object" || typeof rec.id !== "string") continue;
    const was = byId.get(rec.id);
    if (!was) {
      if (validNew(rec)) byId.set(rec.id, { ...rec, hedef: cleanTarget(rec.hedef) });
    } else {
      byId.set(rec.id, { ...was, ...updateOf(rec) }); // a later line never rewrites what was asked
    }
  }
  return [...byId.values()];
}

/** Taken long ago and never answered: the session that took it is gone. */
export const isStale = (r, now = Date.now()) => r.durum === "alindi" && now - Date.parse(r.guncel || r.at) > STALE_MS;
const isOpen = (r, now) => r.durum === "bekliyor" || (r.durum === "alindi" && !isStale(r, now));

/**
 * Add what the person wrote in the panel.
 * @param {{root:string, b:string, hedef:object, metin:string, zaman?:number}} req
 */
export function addRequest(file, req) {
  const metin = cleanText(req?.metin, "istek");
  const hedef = cleanTarget(req?.hedef);
  if (!hedef) throw new Error("hedef geçersiz");
  if (req.zaman !== undefined && !(typeof req.zaman === "number" && Number.isFinite(req.zaman) && req.zaman >= 0)) throw new Error("zaman geçersiz");
  if (!shortText(req.root, MAX_PATH) || !shortText(req.b, MAX_PATH)) throw new Error("bölüm geçersiz");
  const now = Date.now();
  if (readRequests(file).filter((r) => isOpen(r, now)).length >= MAX_OPEN) {
    throw new Error(`açık istek çok fazla (${MAX_OPEN}): Claude'un yanıtlamasını bekle`);
  }
  const record = {
    id: `p${now.toString(36)}${randomBytes(3).toString("hex")}`,
    at: new Date(now).toISOString(),
    durum: "bekliyor",
    root: req.root,
    b: req.b,
    hedef,
    metin,
    ...(req.zaman !== undefined ? { zaman: Math.round(req.zaman * 100) / 100 } : {}),
    ...(owners.has(file) ? { oturum: owners.get(file) } : {}),
  };
  append(file, record);
  return record;
}

/** Change a request's state and/or answer. */
export function updateRequest(file, id, patch) {
  if (!readRequests(file).some((r) => r.id === id)) throw new Error(`istek yok: ${id}`);
  const rec = { id, guncel: new Date().toISOString() };
  if (patch.durum !== undefined) {
    if (!STATES.has(patch.durum)) throw new Error(`durum geçersiz: ${patch.durum}`);
    rec.durum = patch.durum;
  }
  if (patch.yanit !== undefined) rec.yanit = cleanText(patch.yanit, "yanıt");
  if (patch.duyuruldu) rec.duyuruldu = true;
  append(file, rec);
  return readRequests(file).find((r) => r.id === id);
}

/**
 * Claude takes the waiting requests: they turn "alindi". With all, the ones taken before and
 * not answered yet come too (to see them again).
 */
export function takeRequests(file, { all = false, session } = {}) {
  const list = readRequests(file).filter((r) => forSession(r, session) && (r.durum === "bekliyor" || (all && r.durum === "alindi")));
  for (const r of list) if (r.durum === "bekliyor") updateRequest(file, r.id, { durum: "alindi" });
  return list.map((r) => ({ ...r, durum: "alindi" }));
}

/** Waiting requests no hook has told Claude about yet. */
export const unannounced = (file, session) => readRequests(file).filter((r) => r.durum === "bekliyor" && !r.duyuruldu && forSession(r, session));

export function announce(file, ids) {
  for (const id of ids) updateRequest(file, id, { duyuruldu: true });
}

/** The episode file a request is about, written with the root's own separator (C:\…\bolum.json on Windows). */
export function episodeFile(r) {
  const sep = r.root.includes("\\") ? "\\" : "/";
  return `${r.root.replace(/[\\/]+$/, "")}${sep}${r.b.split("/").join(sep)}`;
}

/** One request as Claude reads it: every value quoted, so none can pose as a line of its own. */
export function describe(r) {
  const h = r.hedef || {};
  const q = (v) => JSON.stringify(String(v));
  const what = [
    `${TARGET_TEXT[h.tur] || "?"}${h.id ? ` ${q(h.id)}` : ""}${h.etiket ? ` (${q(h.etiket)})` : ""}`,
    h.shot ? `shot ${q(h.shot)}` : null,
    h.sahne ? `sahne ${q(h.sahne)}` : null,
    typeof r.zaman === "number" ? `an ${r.zaman.toFixed(2)} s` : null,
  ].filter(Boolean).join(" · ");
  return [
    `Panel isteği #${r.id} (${q(r.at)})`,
    `Bölüm: ${q(episodeFile(r))}`,
    `Hedef: ${what}`,
    `İstek: ${q(r.metin)}`,
  ].join("\n");
}
