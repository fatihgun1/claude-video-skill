/**
 * The plugin library as shipped: library/icerik.json lists every file with a fingerprint.
 * A file added to or changed in an installed copy (for example a character drawn during a
 * session) is not part of the plugin: the next plugin update replaces the folder and it is
 * gone. Episodes must not rely on such files; new drawings belong in the project library.
 *
 *   text files (svg, json, md): sha256 of the content with LF line endings
 *   other files (wav):          their size (hashing ~150 MB of audio on every check is slow)
 *
 * Plugin developers refresh the manifest after changing the library: npm run icerik.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const MANIFEST = "icerik.json";
const TEXT = /\.(svg|json|md|txt)$/i;

function fingerprint(path) {
  if (!TEXT.test(path)) return `b:${statSync(path).size}`;
  const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  return `h:${createHash("sha256").update(text).digest("hex").slice(0, 16)}`;
}

function walk(dir, prefix, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) walk(join(dir, e.name), rel, out);
    else if (e.isFile() && rel !== MANIFEST) out[rel] = fingerprint(join(dir, e.name));
  }
  return out;
}

/** @returns {Record<string, string>} every file under the library (but the manifest) and its fingerprint */
export function scanLibrary(dir) {
  const files = walk(dir, "", {});
  return Object.fromEntries(Object.keys(files).sort().map((k) => [k, files[k]]));
}

/** Write library/icerik.json from the library as it is now (plugin development only). */
export function writeManifest(dir) {
  writeFileSync(join(dir, MANIFEST), `${JSON.stringify(scanLibrary(dir), null, 2)}\n`);
}

/**
 * Compare the library with its manifest. A library without one (a custom --kutuphane) is not checked.
 * @returns {{manifest: boolean, eklenen: string[], degisen: string[], silinen: string[]}}
 */
export function checkLibrary(dir) {
  const path = join(dir, MANIFEST);
  if (!existsSync(path)) return { manifest: false, eklenen: [], degisen: [], silinen: [] };
  const shipped = JSON.parse(readFileSync(path, "utf8"));
  const now = scanLibrary(dir);
  return {
    manifest: true,
    eklenen: Object.keys(now).filter((k) => !(k in shipped)),
    degisen: Object.keys(now).filter((k) => k in shipped && shipped[k] !== now[k]),
    silinen: Object.keys(shipped).filter((k) => !(k in now)).sort(),
  };
}

/** Library paths (or folder prefixes ending in "/") an episode depends on. */
function usedPaths(episode) {
  const shots = episode.scenes.flatMap((s) => s.shots);
  const actions = shots.flatMap((s) => s.cast.flatMap((m) => [m.action, ...(m.actions || []).map((a) => a.action)]));
  const props = [...shots.flatMap((s) => (s.props || []).map((p) => p.prop)), ...episode.scenes.flatMap((s) => (s.dekor || []).map((d) => d.prop))];
  return new Set([
    "world.json",
    "cameras.json",
    `profiles/${episode.profile || "genel"}.json`,
    ...episode.characters.map((c) => `characters/${c.rig}/`),
    ...actions.map((a) => `actions/${a}.json`),
    ...episode.scenes.flatMap((s) => [`backgrounds/${s.bg}.svg`, `backgrounds/${s.bg}/`]),
    ...props.map((p) => `props/${p}.svg`),
    ...shots.flatMap((s) => (s.sfx || []).map((x) => `sfx/${x.sfx}.wav`)),
    ...(episode.music ? [`muzik/${episode.music.track}.wav`] : []),
  ]);
}

/**
 * One error per library file the episode uses that was added or changed after the plugin shipped.
 * @param {object} episode a schema-valid episode
 * @param {ReturnType<typeof checkLibrary>} check
 * @returns {string[]}
 */
export function integrityErrors(episode, check) {
  if (!check.manifest) return [];
  const used = [...usedPaths(episode)];
  const uses = (file) => used.some((u) => (u.endsWith("/") ? file.startsWith(u) : file === u));
  const why = (file, how) =>
    `library: ${file} was ${how} in this copy of the plugin, not shipped with it; a plugin update will replace it. Put the drawing in the project library (kutuphane/) instead, and do not edit the plugin's library.`;
  return [
    ...check.eklenen.filter(uses).map((f) => why(f, "added")),
    ...check.degisen.filter(uses).map((f) => why(f, "changed")),
  ];
}
