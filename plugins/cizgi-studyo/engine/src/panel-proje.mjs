/**
 * The panel's project folder: every bolum.json under the folder the panel was opened on,
 * a short summary of each for the episode picker, and new episodes from a minimal template.
 * Episodes are named by their path relative to that folder ("ornekler/sokak/bolum.json");
 * a name is only accepted when it stays inside the folder and points at a bolum.json.
 */
import { readdirSync, existsSync, statSync, mkdirSync, writeFileSync, realpathSync, rmSync } from "node:fs";
import { join, relative, sep, basename, dirname, isAbsolute } from "node:path";
import { readText } from "./util.mjs";
import { validateEpisode, profileOf } from "./validate.mjs";
import { safeJoin, audioPathFor, readAudioInfo } from "./compile.mjs";
import { buildTimeline } from "./timing.mjs";

export const EPISODE_FILE = "bolum.json";
export const NEW_EPISODE_DIR = "bolumler";
const MAX_DEPTH = 5;
export const MAX_EPISODES = 200;
const MAX_TITLE = 120;
/** Folders never searched: tools, outputs and hidden folders (.git, .cizgi). */
const SKIP_DIRS = new Set(["node_modules", "renders", "cikti", "storyboard"]);
export const EPISODE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export class HttpError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const skipped = (name) => name.startsWith(".") || SKIP_DIRS.has(name);
const toRel = (root, abs) => relative(root, abs).split(sep).join("/");

/**
 * Every bolum.json under root (a few levels deep), as sorted relative paths.
 * @param {string} root absolute folder
 * @returns {string[]}
 */
export function findEpisodes(root) {
  const found = [];
  const walk = (dir, depth) => {
    if (found.length >= MAX_EPISODES) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable folder: not an episode
    }
    if (entries.some((e) => e.isFile() && e.name === EPISODE_FILE)) found.push(toRel(root, join(dir, EPISODE_FILE)));
    if (depth >= MAX_DEPTH) return;
    for (const e of entries) if (e.isDirectory() && !skipped(e.name)) walk(join(dir, e.name), depth + 1);
  };
  walk(root, 0);
  return found.sort((a, b) => a.localeCompare(b, "tr"));
}

/**
 * The absolute path of an episode named relative to root. Refuses names that leave the
 * folder, go through hidden or output folders, or are not a bolum.json that exists.
 * @param {string} root
 * @param {unknown} rel
 * @returns {string}
 */
export function episodePathOf(root, rel) {
  if (typeof rel !== "string" || !rel) throw new HttpError(400, "which episode? (b)");
  // One spelling only: forward slashes, no drive letters, no backslashes (Windows reads them as separators).
  if (/[\\:]/.test(rel)) throw new HttpError(400, `not an episode path: ${rel}`);
  const parts = rel.split("/");
  if (parts.at(-1) !== EPISODE_FILE || parts.slice(0, -1).some((p) => !p || skipped(p) || p === "..")) {
    throw new HttpError(400, `not an episode path: ${rel}`);
  }
  const full = inside(root, rel);
  if (!existsSync(full) || !statSync(full).isFile()) throw new HttpError(404, `no episode at ${rel}`);
  insideReally(root, dirname(full));
  return full;
}

/** safeJoin as an HTTP error. */
function inside(root, rel) {
  try {
    return safeJoin(root, rel);
  } catch (err) {
    throw new HttpError(403, err.message);
  }
}

/** A link or junction inside the folder must not lead out of it. */
export function insideReally(root, dir) {
  const real = realpathSync(dir);
  const base = realpathSync(root);
  const norm = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
  const back = relative(norm(base), norm(real));
  if (back === ".." || back.startsWith(`..${sep}`) || isAbsolute(back)) throw new HttpError(403, "path leaves the project folder through a link");
}

/** Total length from the real audio files; null while a line has no audio yet. */
function durationOf(episode, episodePath, lib) {
  const dir = join(episodePath, "..");
  try {
    const info = (u, shot, i) => readAudioInfo(safeJoin(dir, audioPathFor(u, shot, i)));
    return buildTimeline(episode, info, profileOf(episode, lib).timing).duration;
  } catch {
    return null;
  }
}

/**
 * What the episode picker shows for one episode.
 * @param {string} root
 * @param {string} rel
 * @param {object} lib
 * @param {((path:string, lib:object) => object) | undefined} status
 */
export function summarize(root, rel, lib, status) {
  const path = join(root, ...rel.split("/"));
  let episode;
  try {
    episode = JSON.parse(readText(path));
  } catch (err) {
    return { path: rel, ok: false, error: `okunamadı: ${err.message}` };
  }
  const scenes = Array.isArray(episode?.scenes) ? episode.scenes : [];
  const shots = scenes.reduce((n, s) => n + (Array.isArray(s?.shots) ? s.shots.length : 0), 0);
  const validation = validateEpisode(episode, lib);
  let gates = null;
  let next = null;
  if (validation.ok && status) {
    try {
      ({ gates, next } = status(path, lib));
    } catch {
      /* the picker still lists it; the editor will show the problem */
    }
  }
  return {
    path: rel,
    ok: true,
    id: typeof episode?.episode === "string" ? episode.episode : null,
    title: typeof episode?.title === "string" ? episode.title : null,
    bg: typeof scenes[0]?.bg === "string" && lib.backgrounds.has(scenes[0].bg) ? scenes[0].bg : null,
    shots,
    duration: validation.ok ? durationOf(episode, path, lib) : null,
    valid: validation.ok,
    errors: validation.errors.length,
    gates,
    next,
  };
}

/** A standing action drawn for the rig's view: "bekle", else another "bekle…", else any loop that fits. */
function standingFor(lib, rig) {
  const view = lib.characters.get(rig).meta.view || "front";
  const fits = [...lib.actions].filter(([, a]) => !a.views || a.views.includes(view));
  return (fits.find(([id]) => id === "bekle") || fits.find(([id]) => id.startsWith("bekle")) || fits.find(([, a]) => a.loop))?.[0];
}

/** What a new episode may start with: the person picks one character and one place. */
export function newEpisodeChoices(lib) {
  return {
    rigs: [...lib.characters].map(([id, c]) => ({ id, label: c.meta?.name?.tr || id })),
    backgrounds: [...lib.backgrounds.keys()].map((id) => ({ id, label: lib.backgroundNames?.get(id) || id })),
    muzik: [...(lib.music?.keys() ?? [])].map((id) => ({ id, label: id })),
    props: [...(lib.props?.keys() ?? [])].map((id) => ({ id, label: id })),
  };
}

/**
 * A minimal valid episode: one scene in the chosen place, one shot, the chosen character standing
 * in the middle. Every word comes from the library; nothing is picked for the person.
 * @param {object} lib
 * @param {{id:string, title:string, rig:string, bg:string}} q
 */
export function episodeTemplate(lib, { id, title, rig, bg }) {
  const standing = standingFor(lib, rig);
  if (!standing) throw new HttpError(422, "bu karakterin görünüşü için kütüphanede duran bir hareket yok");
  const meta = lib.characters.get(rig)?.meta;
  const who = meta?.same_as || rig;
  const name = (meta?.name?.tr || meta?.label?.tr || who).replace(/\s*\(.*\)$/, "");
  return {
    episode: id,
    title,
    language: "tr",
    revision: 1,
    characters: [{ id: who, name, rig }],
    scenes: [{
      scene_id: "s1",
      bg,
      shots: [{
        shot_id: "s1_sh1",
        cast: [{ id: who, action: standing, mark: "orta" }],
        camera: { framing: "wide", move: "static", target: who },
        hold: 2,
      }],
    }],
  };
}

/**
 * Check a new-episode request and write <root>/bolumler/<id>/bolum.json (never over an existing one).
 * @returns {string} the new episode's relative path
 */
export function createEpisode(root, lib, body, serialize) {
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!EPISODE_ID.test(id)) throw new HttpError(400, "kimlik yalnızca küçük harf, rakam ve tire olabilir (örnek: park-gunu)");
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title || title.length > MAX_TITLE) throw new HttpError(400, `başlık 1-${MAX_TITLE} karakter olmalı`);
  const rig = typeof body?.rig === "string" ? body.rig : "";
  if (!lib.characters.has(rig)) throw new HttpError(400, "bir karakter seç (kütüphanedeki karakterlerden)");
  const bg = typeof body?.bg === "string" ? body.bg : "";
  if (!lib.backgrounds.has(bg)) throw new HttpError(400, "bir mekân seç (kütüphanedeki mekânlardan)");
  const rel = `${NEW_EPISODE_DIR}/${id}/${EPISODE_FILE}`;
  const file = inside(root, rel);
  const dir = dirname(file);
  if (existsSync(dir)) throw new HttpError(409, `${NEW_EPISODE_DIR}/${id} zaten var`);
  const episode = episodeTemplate(lib, { id, title, rig, bg });
  const validation = validateEpisode(episode, lib);
  if (!validation.ok) throw new HttpError(500, `şablon geçersiz: ${validation.errors.join("; ")}`);
  mkdirSync(dirname(dir), { recursive: true });
  insideReally(root, dirname(dir)); // bolumler/ itself may not be a link out of the folder
  try {
    mkdirSync(dir); // not recursive: a folder made meanwhile by someone else is a conflict
  } catch (err) {
    if (err.code === "EEXIST") throw new HttpError(409, `${NEW_EPISODE_DIR}/${id} zaten var`);
    throw err;
  }
  try {
    writeFileSync(file, serialize(episode), { flag: "wx" });
  } catch (err) {
    rmSync(dir, { recursive: true, force: true }); // no empty folder left to block the next try
    throw err;
  }
  return rel;
}

/** The folder a panel serves and the episode it opens first, from a folder or a bolum.json. */
export function workspaceOf(target) {
  if (!existsSync(target)) throw new Error(`not found: ${target}`);
  if (statSync(target).isDirectory()) return { root: target, initial: null };
  if (basename(target) !== EPISODE_FILE) throw new Error(`open a folder or a ${EPISODE_FILE}`);
  return { root: join(target, ".."), initial: EPISODE_FILE };
}
