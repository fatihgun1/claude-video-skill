/**
 * The project library: <project>/kutuphane, assets drawn for a project (by Claude, in talk with the
 * person), loaded next to the plugin's own library (loadLibrary opts.project). It lives with the
 * project, so plugin updates never touch it and sharing the project shares the drawings.
 *
 *   kutuphane/backgrounds/<id>.svg | <id>/mekan.json + layers     usable mekânlar
 *   kutuphane/props/<id>.svg                                        usable nesneler
 *   kutuphane/characters/<id>/rig.svg + character.json              usable karakterler
 *   kutuphane/actions/<id>.json                                     usable hareketler
 *   kutuphane/taslak/<backgrounds|props|characters|actions>/…       drafts: not usable yet
 *   kutuphane/taslak/_reddedilen/                                   rejected drafts, kept aside
 *
 * A draft becomes usable only when the person takes it in ("Kütüphaneye al" in the panel):
 * approveDraft checks it as the library would and moves it out of taslak/.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { checkProp, readCharacter, readAction } from "./library.mjs";
import { loadLayered } from "./mekan.mjs";
import { checkSvgSafety } from "./rigspec.mjs";
import { ID_PATTERN } from "./util.mjs";

export const PROJECT_LIBRARY = "kutuphane";
const KIND = Object.freeze({ mekan: "backgrounds", nesne: "props", karakter: "characters", hareket: "actions" });
// a draft is a folder (layered background, character) and/or one file with this extension
const FOLDER = new Set(["mekan", "karakter"]);
const EXT = Object.freeze({ mekan: ".svg", nesne: ".svg", karakter: null, hareket: ".json" });
const existing = (lib, tur) => ({ mekan: lib.backgrounds, nesne: lib.props, karakter: lib.characters, hareket: lib.actions })[tur];
const ASIDE = "_reddedilen";

/**
 * The nearest <dir>/kutuphane at or above `start`, or null. The search stops below the user's home
 * folder: a stray ~/kutuphane or C:\kutuphane is not a project's library.
 */
export function projectLibraryOf(start) {
  let dir = resolve(start);
  const norm = (p) => (process.platform === "win32" ? p.toLowerCase() : p).replace(/[\\/]+$/, "");
  const home = norm(resolve(homedir()));
  const above = (d) => norm(d) === home || home.startsWith(norm(d) + sep); // the home folder or one that holds it
  for (;;) {
    if (above(dir)) return null;
    const candidate = join(dir, PROJECT_LIBRARY);
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

const folderOf = (tur) => {
  if (!Object.hasOwn(KIND, tur)) throw new Error(`tür mekan, nesne, karakter ya da hareket olmalı: ${tur}`);
  return KIND[tur];
};
const draftsDir = (proj, tur) => join(proj, "taslak", folderOf(tur));

/** Where a draft is: a folder (layered background, character) or one file; null when there is none. */
function draftPath(proj, tur, id) {
  if (!ID_PATTERN.test(id || "")) return null;
  const base = draftsDir(proj, tur);
  if (FOLDER.has(tur) && existsSync(join(base, id)) && statSync(join(base, id)).isDirectory()) return { path: join(base, id), folder: true, ext: "" };
  const ext = EXT[tur];
  if (ext && existsSync(join(base, `${id}${ext}`))) return { path: join(base, `${id}${ext}`), folder: false, ext };
  return null;
}

/** The project library's own drawing with this id (folder or file), or null: a draft by its id is an update. */
function inProject(proj, tur, id) {
  const base = join(proj, folderOf(tur));
  if (FOLDER.has(tur) && existsSync(join(base, id)) && statSync(join(base, id)).isDirectory()) return { path: join(base, id), ext: "" };
  const ext = EXT[tur];
  if (ext && existsSync(join(base, `${id}${ext}`))) return { path: join(base, `${id}${ext}`), ext };
  return null;
}

/* Which episode a draft was drawn for, and a note: kutuphane/taslak/notlar.json, written by Claude.
   {"karakter/suluman": {"bolum": "bolumler/suluman/bolum.json", "not": "…"}}. A broken file is ignored. */
const NOTES = "notlar.json";
function readNotes(proj) {
  try {
    const data = JSON.parse(readFileSync(join(proj, "taslak", NOTES), "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}
function noteOf(notes, tur, id) {
  const n = notes[`${tur}/${id}`];
  const str = (v, max) => (typeof v === "string" && v.length <= max ? v : null);
  return { bolum: str(n?.bolum, 300), not: str(n?.not, 500) };
}
function dropNote(proj, tur, id) {
  const file = join(proj, "taslak", NOTES);
  if (!existsSync(file)) return;
  const notes = readNotes(proj);
  if (!Object.hasOwn(notes, `${tur}/${id}`)) return;
  const { [`${tur}/${id}`]: _gone, ...rest } = notes;
  writeFileSync(file, `${JSON.stringify(rest, null, 2)}\n`);
}

/** A draft checked as the library would check it. */
function inspect(proj, tur, id, lib) {
  const where = draftPath(proj, tur, id);
  if (!where) return null;
  const update = !!inProject(proj, tur, id);
  const out = { tur, id, ok: false, errors: [], name: null, layers: [], svg: null, taken: existing(lib, tur).has(id) && !update, guncelleme: update };
  if (tur === "karakter") {
    const c = readCharacter(where.path);
    out.errors.push(...c.errors);
    out.name = c.meta?.name?.tr ?? null;
    out.svg = c.errors.length ? null : c.svg;
  } else if (tur === "hareket") {
    const a = readAction(where.path);
    out.errors.push(...a.errors);
    out.name = a.action?.label?.tr ?? null;
  } else if (tur === "mekan" && where.folder) {
    if (!existsSync(join(where.path, "mekan.json"))) out.errors.push("mekan.json yok");
    else {
      const bg = loadLayered(where.path, id, lib.world);
      out.errors.push(...bg.errors);
      out.name = bg.name;
      out.layers = bg.layers.map((l) => ({ id: l.id, derinlik: l.derinlik }));
      out.svg = bg.errors.length ? null : bg.svg;
    }
  } else {
    const svg = readFileSync(where.path, "utf8");
    const problems = tur === "nesne" ? checkProp(svg).errors : checkSvgSafety(svg);
    out.errors.push(...problems);
    if (tur === "mekan") out.layers = [{ id: "tum", derinlik: 1 }];
    out.svg = problems.length ? null : svg;
  }
  if (out.taken) out.errors.push(`"${id}" adında bir ${tur} eklentide var: taslağa başka bir ad verilmeli`);
  out.ok = out.errors.length === 0;
  return out;
}

/**
 * Every draft with what is wrong with it (nothing, when ok).
 * guncelleme: the project library has a drawing with this id, and taking the draft in replaces it.
 * bolum, not: which episode it was drawn for and why (taslak/notlar.json), or null.
 * @returns {{tur:"mekan"|"nesne"|"karakter"|"hareket", id:string, ok:boolean, errors:string[], name:string|null, layers:{id:string, derinlik:number}[], taken:boolean, guncelleme:boolean, bolum:string|null, not:string|null}[]}
 */
export function listDrafts(proj, lib) {
  if (!proj) return [];
  const out = [];
  const notes = readNotes(proj);
  for (const tur of Object.keys(KIND)) {
    const base = draftsDir(proj, tur);
    if (!existsSync(base)) continue;
    const ids = new Set();
    for (const e of readdirSync(base, { withFileTypes: true })) {
      if (e.name === ASIDE) continue;
      const ext = EXT[tur];
      if (e.isFile() && ext && e.name.endsWith(ext)) ids.add(e.name.slice(0, -ext.length));
      else if (e.isDirectory() && FOLDER.has(tur)) ids.add(e.name);
    }
    for (const id of [...ids].sort()) {
      if (!ID_PATTERN.test(id)) {
        out.push({ tur, id, ok: false, errors: ["ad küçük harf, rakam, - ya da _ olmalı"], name: null, layers: [], taken: false, guncelleme: false, bolum: null, not: null });
        continue;
      }
      const d = inspect(proj, tur, id, lib);
      if (d) out.push({ tur: d.tur, id: d.id, ok: d.ok, errors: d.errors, name: d.name, layers: d.layers, taken: d.taken, guncelleme: d.guncelleme, ...noteOf(notes, tur, id) });
    }
  }
  return out;
}

/** The drawing of a good draft (all layers together), to look at; null otherwise. */
export function draftSvg(proj, tur, id, lib) {
  if (!proj || !Object.hasOwn(KIND, tur)) return null;
  const d = inspect(proj, tur, id, lib);
  return d && d.ok ? d.svg : null;
}

const stampNow = () => new Date().toISOString().replace(/[:.]/g, "-");

/**
 * Take a draft into the project library: it is checked again, then moved out of taslak/. An update
 * (the project already has a drawing with this id) puts the old drawing aside first, kept in
 * taslak/_reddedilen/<tur>-<id>-eski-<time>, so nothing is lost.
 */
export function approveDraft(proj, tur, id, lib) {
  folderOf(tur);
  if (!ID_PATTERN.test(id || "")) throw new Error(`taslak adı geçersiz: ${id}`);
  const d = inspect(proj, tur, id, lib);
  if (!d) throw new Error(`taslak yok: ${tur} ${id}`);
  if (!d.ok) throw new Error(d.errors.join("; "));
  const from = draftPath(proj, tur, id);
  const target = join(proj, folderOf(tur), `${id}${from.ext}`);
  const old = inProject(proj, tur, id);
  let oldAside = null;
  if (old) {
    const aside = join(proj, "taslak", ASIDE);
    mkdirSync(aside, { recursive: true });
    oldAside = join(aside, `${tur}-${id}-eski-${stampNow()}${old.ext}`);
    move(old.path, oldAside);
  } else if (existsSync(target)) throw new Error(`"${id}" adında bir ${tur} zaten var`);
  mkdirSync(dirname(target), { recursive: true });
  try {
    move(from.path, target);
  } catch (err) {
    if (oldAside) move(oldAside, old.path); // put the old drawing back: the library is as it was
    throw err;
  }
  dropNote(proj, tur, id);
  return { tur, id, guncelleme: !!old };
}

/**
 * Take every good draft in at once (of one kind, or all). Broken ones stay, each with its reason.
 * @returns {{alinan:{tur:string, id:string, guncelleme:boolean}[], hatalar:{tur:string, id:string, hata:string}[]}}
 */
export function approveAll(proj, lib, tur = null) {
  const alinan = [];
  const hatalar = [];
  for (const d of listDrafts(proj, lib)) {
    if (tur && d.tur !== tur) continue;
    if (!d.ok) {
      hatalar.push({ tur: d.tur, id: d.id, hata: d.errors.join("; ") });
      continue;
    }
    try {
      alinan.push(approveDraft(proj, d.tur, d.id, lib));
    } catch (err) {
      hatalar.push({ tur: d.tur, id: d.id, hata: err.message });
    }
  }
  return { alinan, hatalar };
}

/** Rename, with a plain reason when Windows holds the folder (open in Explorer, scanned by antivirus). */
function move(from, to) {
  try {
    renameSync(from, to);
  } catch (err) {
    if (err.code === "EPERM" || err.code === "EBUSY" || err.code === "EACCES") {
      throw new Error("taslak taşınamadı: klasörü açık tutan bir program var (Dosya Gezgini, antivirüs); kapatıp yeniden dene");
    }
    throw err;
  }
}

/** Put a draft aside (kept, not deleted): taslak/_reddedilen/<tur>-<id>-<time>. */
export function rejectDraft(proj, tur, id) {
  folderOf(tur);
  const from = draftPath(proj, tur, id);
  if (!from) throw new Error(`taslak yok: ${tur} ${id}`);
  const aside = join(proj, "taslak", ASIDE);
  mkdirSync(aside, { recursive: true });
  move(from.path, join(aside, `${tur}-${id}-${stampNow()}${from.ext}`));
  dropNote(proj, tur, id);
  return { tur, id };
}

/**
 * Changes when a draft is added, changed, taken in or put aside, or the project's sound effects
 * or their KAYNAKLAR.md change (for the panel's poll: the Ses tab lists effects left out).
 */
export function draftsSignature(proj) {
  const bases = proj ? [join(proj, "taslak"), join(proj, "sfx")].filter((d) => existsSync(d)) : [];
  if (!bases.length) return "0";
  // paths too: putting a draft aside moves it without changing a file's time
  const hash = createHash("sha256");
  const walk = (d) => {
    let found;
    try {
      found = readdirSync(d, { withFileTypes: true });
    } catch {
      return; // moved away meanwhile (taken in, put aside)
    }
    for (const e of found) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        try {
          hash.update(`${p}\0${statSync(p).mtimeMs}\n`);
        } catch {
          /* gone meanwhile */
        }
      }
    }
  };
  for (const base of bases) walk(base);
  return hash.digest("hex").slice(0, 16);
}
