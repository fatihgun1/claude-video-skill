/**
 * A series (plan v3, Faz 1.4-1.5). Episodes of one series used to know nothing of each other: the
 * bag of episode 1 became a sack in episode 2, voices were picked again, a stand-in drawing played
 * the lead. A series file holds what every episode must keep:
 *
 *   <project>/seriler/<id>.json
 *   {
 *     "ad": "Hurda Kralı",
 *     "kisi_kurallari": ["oyun dili yok: anlatıcı hikâye anlatır"],   the person's standing wishes, word for word
 *     "format": "9:16", "sure_hedefi": 60,
 *     "karakterler": { "kadir": { "rig": "kadir", "ses": { "hazir": "erkek" }, "kim": "…", "konusma": "…" } },
 *     "anlatici": { "ses": { "hazir": "kadin" } },
 *     "nesneler": [{ "ad": "çanta", "prop": "…", "not": "Kadir'in sırt çantası" }],
 *     "bolumler": ["hurda-kral-01", "hurda-kral-02"]                  in order; each is bolumler/<id>/bolum.json
 *   }
 *
 * An episode joins it with `"seri": "<id>"` in bolum.json. dogrula then warns (and an open warning
 * holds the gates) when it leaves the series: another drawing or voice for a series character,
 * another narrator voice or format, an episode missing from the list, or a start earlier in the day
 * than where the episode before ended without a jump in time (`zaman_atlama` on its first shot).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { storyPathOf } from "./hikaye.mjs";

const SERIES_DIR = "seriler";
const VIEW_SUFFIX = /-(on|arka)$/;
const DAY = ["sabah", "ogle", "aksam", "gece"];
const NARRATOR = "anlatici";

/** The nearest seriler/ folder at or above `start` (below the home folder), or null. */
function seriesDirOf(start) {
  const norm = (p) => (process.platform === "win32" ? p.toLowerCase() : p).replace(/[\\/]+$/, "");
  const home = norm(resolve(homedir()));
  let dir = resolve(start);
  for (;;) {
    if (norm(dir) === home || home.startsWith(norm(dir) + sep)) return null;
    const candidate = join(dir, SERIES_DIR);
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** Shape problems of a series file (empty when it is fine). */
export function validateSeries(seri) {
  const errors = [];
  if (!seri || typeof seri !== "object" || Array.isArray(seri)) return ["seri bir nesne olmalı"];
  if (typeof seri.ad !== "string" || !seri.ad.trim()) errors.push("ad: seri adı gerekli");
  if (seri.kisi_kurallari !== undefined && !(Array.isArray(seri.kisi_kurallari) && seri.kisi_kurallari.every((k) => typeof k === "string"))) errors.push("kisi_kurallari: yazı listesi olmalı");
  if (seri.format !== undefined && !["9:16", "16:9"].includes(seri.format)) errors.push("format: 9:16 ya da 16:9");
  if (!seri.karakterler || typeof seri.karakterler !== "object" || Array.isArray(seri.karakterler)) errors.push("karakterler: karakter kimliği → {rig, ses} nesnesi olmalı");
  else {
    for (const [id, c] of Object.entries(seri.karakterler)) {
      if (!c || typeof c.rig !== "string") errors.push(`karakterler.${id}: rig gerekli`);
      if (c?.ses !== undefined && (typeof c.ses !== "object" || typeof c.ses.hazir !== "string")) errors.push(`karakterler.${id}: ses {hazir, perde?, hiz?} olmalı`);
    }
  }
  if (seri.anlatici?.ses !== undefined && typeof seri.anlatici.ses?.hazir !== "string") errors.push("anlatici.ses: {hazir} olmalı");
  if (!Array.isArray(seri.bolumler) || !seri.bolumler.every((b) => typeof b === "string")) errors.push("bolumler: bölüm kimliklerinin sırayla listesi olmalı");
  if (seri.nesneler !== undefined && !Array.isArray(seri.nesneler)) errors.push("nesneler: liste olmalı");
  return errors;
}

const voiceKey = (v) => JSON.stringify([v?.hazir || "", v?.perde || 0, v?.hiz || 0]);
const voiceText = (v) => (v ? JSON.stringify(v) : "none");
const readJsonFile = (path) => JSON.parse(readFileSync(path, "utf8"));

/** The person (rig family) behind a rig: same_as of its views, else the rig without -on / -arka. */
const personOf = (lib, rig) => lib.characters?.get(rig)?.meta?.same_as || String(rig).replace(VIEW_SUFFIX, "");

/** Where an episode opens and ends, and what is in hands at its end. */
function endsOf(episode) {
  const first = episode.scenes[0];
  const last = episode.scenes.at(-1);
  const lastShot = last?.shots.at(-1);
  return {
    acilis: { sahne: first?.scene_id, mekan: first?.bg, saat: first?.isik?.saat ?? null },
    kapanis: { sahne: last?.scene_id, mekan: last?.bg, saat: last?.isik?.saat ?? null, eldekiler: (lastShot?.props || []).filter((p) => p.holder).map((p) => `${p.holder}: ${p.prop}`) },
  };
}

/**
 * The series warnings of an episode (none when it has no `seri`).
 * @param {string} episodePath
 * @param {object} episode
 * @param {{characters?: Map}} lib
 * @returns {string[]}
 */
export function seriesWarnings(episodePath, episode, lib) {
  if (!episode.seri) return [];
  const dir = seriesDirOf(dirname(resolve(episodePath)));
  const file = dir && join(dir, `${episode.seri}.json`);
  if (!file || !existsSync(file)) return [`seri: seriler/${episode.seri}.json not found (looked in the project folder above the episode); write the series file or remove "seri"`];
  let seri;
  try {
    seri = readJsonFile(file);
  } catch (err) {
    return [`seri: seriler/${episode.seri}.json cannot be read: ${err.message}`];
  }
  const shape = validateSeries(seri);
  if (shape.length) return shape.map((e) => `seri: seriler/${episode.seri}.json: ${e}`);
  const out = [];
  if (!seri.bolumler.includes(episode.episode)) out.push(`seri: episode "${episode.episode}" is not in the series' list (bolumler); add it in its place`);
  if (seri.format && episode.format && seri.format !== episode.format) out.push(`seri: format ${episode.format}, the series is ${seri.format}`);
  // the series' characters: the same drawing (person) and the same voice in every episode
  for (const [id, want] of Object.entries(seri.karakterler)) {
    const mine = episode.characters.find((c) => c.id === id);
    if (!mine) continue;
    if (personOf(lib, mine.rig) !== personOf(lib, want.rig)) out.push(`seri: "${id}" is drawn as "${mine.rig}", the series says "${want.rig}"`);
    const voiced = episode.characters.find((c) => c.voice && (c.id === id || personOf(lib, c.rig) === personOf(lib, mine.rig)));
    if (want.ses && voiceKey(voiced?.voice) !== voiceKey(want.ses)) out.push(`seri: "${id}" speaks with ${voiceText(voiced?.voice)}, the series says ${voiceText(want.ses)}`);
  }
  const speaks = episode.scenes.some((s) => s.shots.some((sh) => (sh.utterances || []).some((u) => u.speaker === NARRATOR)));
  if (speaks && seri.anlatici?.ses && voiceKey(episode.narrator_voice) !== voiceKey(seri.anlatici.ses)) {
    out.push(`seri: the narrator speaks with ${voiceText(episode.narrator_voice)}, the series says ${voiceText(seri.anlatici.ses)}`);
  }
  // the episode before: the day does not go back unless a jump in time is said
  const i = seri.bolumler.indexOf(episode.episode);
  const prevId = i > 0 ? seri.bolumler[i - 1] : null;
  const prevPath = prevId && join(dirname(dirname(resolve(episodePath))), prevId, "bolum.json");
  if (prevPath && existsSync(prevPath)) {
    const prevEnd = endsOf(readJsonFile(prevPath)).kapanis.saat;
    const first = episode.scenes[0];
    const start = first?.isik?.saat;
    if (prevEnd && start && DAY.indexOf(start) < DAY.indexOf(prevEnd) && !first.shots[0]?.zaman_atlama) {
      out.push(`scene ${first.scene_id}: starts in the ${start}, but ${prevId} ended at ${prevEnd}; set zaman_atlama on its first shot if time jumped (a new day), or go on from ${prevEnd}`);
    }
  }
  return out;
}

/**
 * What a new episode of the series reads first (cizgi seri-ozet): the series file and, per episode,
 * its idea, voices, opening and ending.
 * @param {string} seriesPath seriler/<id>.json
 */
export function seriesSummary(seriesPath) {
  const seri = readJsonFile(seriesPath);
  const shape = validateSeries(seri);
  if (shape.length) throw new Error(`seri dosyası hatalı:\n- ${shape.join("\n- ")}`);
  const root = dirname(dirname(resolve(seriesPath)));
  const bolumler = seri.bolumler.map((id) => {
    const path = join(root, "bolumler", id, "bolum.json");
    if (!existsSync(path)) return { id, yok: true };
    const ep = readJsonFile(path);
    const storyPath = storyPathOf(path);
    const story = existsSync(storyPath) ? readJsonFile(storyPath) : null;
    const sesler = Object.fromEntries([
      ...ep.characters.filter((c) => c.voice).map((c) => [c.id, c.voice]),
      ...(ep.narrator_voice ? [[NARRATOR, ep.narrator_voice]] : []),
    ]);
    return { id, baslik: ep.title ?? null, fikir: story?.fikir ?? null, kisi: story?.kisi ?? [], sesler, ...endsOf(ep), replik: ep.scenes.reduce((n, s) => n + s.shots.reduce((m, sh) => m + (sh.utterances || []).length, 0), 0) };
  });
  return { seri, bolumler };
}
