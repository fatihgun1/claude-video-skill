/**
 * The project library: <project>/kutuphane, assets drawn for a project (by Claude, in talk with the
 * person), loaded next to the plugin's own library (loadLibrary opts.project). It lives with the
 * project, so plugin updates never touch it and sharing the project shares the drawings.
 *
 *   kutuphane/backgrounds/<id>.svg | <id>/mekan.json + layers     usable mekânlar
 *   kutuphane/props/<id>.svg                                        usable nesneler
 *   kutuphane/taslak/backgrounds/…, kutuphane/taslak/props/…        drafts: not usable yet
 *   kutuphane/taslak/_reddedilen/                                   rejected drafts, kept aside
 *
 * A draft becomes usable only when the person takes it in ("Kütüphaneye al" in the panel):
 * approveDraft checks it as the library would and moves it out of taslak/.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { checkProp } from "./library.mjs";
import { loadLayered } from "./mekan.mjs";
import { checkSvgSafety } from "./rigspec.mjs";
import { ID_PATTERN } from "./util.mjs";

export const PROJECT_LIBRARY = "kutuphane";
const KIND = Object.freeze({ mekan: "backgrounds", nesne: "props" });
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
  if (!Object.hasOwn(KIND, tur)) throw new Error(`tür mekan ya da nesne olmalı: ${tur}`);
  return KIND[tur];
};
const draftsDir = (proj, tur) => join(proj, "taslak", folderOf(tur));

/** Where a draft is: a layered background folder or one SVG file; null when there is none. */
function draftPath(proj, tur, id) {
  if (!ID_PATTERN.test(id || "")) return null;
  const base = draftsDir(proj, tur);
  if (tur === "mekan" && existsSync(join(base, id)) && statSync(join(base, id)).isDirectory()) return { path: join(base, id), folder: true };
  if (existsSync(join(base, `${id}.svg`))) return { path: join(base, `${id}.svg`), folder: false };
  return null;
}

/** A draft checked as the library would check it. */
function inspect(proj, tur, id, lib) {
  const where = draftPath(proj, tur, id);
  if (!where) return null;
  const out = { tur, id, ok: false, errors: [], name: null, layers: [], svg: null, taken: tur === "mekan" ? lib.backgrounds.has(id) : lib.props.has(id) };
  if (tur === "mekan" && where.folder) {
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
  if (out.taken) out.errors.push(`"${id}" adında bir ${tur} zaten var: taslağa başka bir ad verilmeli`);
  out.ok = out.errors.length === 0;
  return out;
}

/**
 * Every draft with what is wrong with it (nothing, when ok).
 * @returns {{tur:"mekan"|"nesne", id:string, ok:boolean, errors:string[], name:string|null, layers:{id:string, derinlik:number}[], taken:boolean}[]}
 */
export function listDrafts(proj, lib) {
  if (!proj) return [];
  const out = [];
  for (const tur of Object.keys(KIND)) {
    const base = draftsDir(proj, tur);
    if (!existsSync(base)) continue;
    const ids = new Set();
    for (const e of readdirSync(base, { withFileTypes: true })) {
      if (e.name === ASIDE) continue;
      if (e.isFile() && e.name.endsWith(".svg")) ids.add(e.name.slice(0, -4));
      else if (e.isDirectory() && tur === "mekan") ids.add(e.name);
    }
    for (const id of [...ids].sort()) {
      if (!ID_PATTERN.test(id)) {
        out.push({ tur, id, ok: false, errors: ["ad küçük harf, rakam, - ya da _ olmalı"], name: null, layers: [], taken: false });
        continue;
      }
      const d = inspect(proj, tur, id, lib);
      if (d) out.push({ tur: d.tur, id: d.id, ok: d.ok, errors: d.errors, name: d.name, layers: d.layers, taken: d.taken });
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

/** Take a draft into the project library: it is checked again, then moved out of taslak/. */
export function approveDraft(proj, tur, id, lib) {
  folderOf(tur);
  if (!ID_PATTERN.test(id || "")) throw new Error(`taslak adı geçersiz: ${id}`);
  const d = inspect(proj, tur, id, lib);
  if (!d) throw new Error(`taslak yok: ${tur} ${id}`);
  if (!d.ok) throw new Error(d.errors.join("; "));
  const from = draftPath(proj, tur, id);
  const target = join(proj, folderOf(tur), from.folder ? id : `${id}.svg`);
  if (existsSync(target)) throw new Error(`"${id}" adında bir ${tur} zaten var`);
  mkdirSync(dirname(target), { recursive: true });
  move(from.path, target);
  return { tur, id };
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
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  move(from.path, join(aside, `${tur}-${id}-${stamp}${from.folder ? "" : ".svg"}`));
  return { tur, id };
}

/** Changes when a draft is added, changed, taken in or put aside (for the panel's poll). */
export function draftsSignature(proj) {
  const base = proj && join(proj, "taslak");
  if (!base || !existsSync(base)) return "0";
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
  walk(base);
  return hash.digest("hex").slice(0, 16);
}
