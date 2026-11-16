/**
 * 3D compile (F7 spike): the same episode and the same timeline as the 2D render, drawn by
 * runtime/player3d.js with Three.js from simple-shape recipes:
 *   library/3d/karakterler/<rig>.json   a character: joints and parts (spheres, capsules…)
 *   library/3d/mekanlar/<bg>.json       a place: sky, ground, hills, trees, sun, clouds
 * Three.js comes from the engine's own node_modules (no network while rendering).
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { prepareMedia, facesOf, escapeHtml } from "./compile.mjs";
import { readJson } from "./util.mjs";
import { validateEpisode } from "./validate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = join(HERE, "runtime");
/** 2D world units per metre: a 1920-wide world is 6.4 m across. */
export const UNITS_PER_METRE = 300;

/** The shapes and how many numbers each one's boyut needs (player3d.js shape()). */
const SIZES = { kure: 3, kapsul: 2, simit: 2, silindir: 3, koni: 2, kutu: 3 };
const SHAPES = new Set(Object.keys(SIZES));
const JOINTS = ["govde", "kafa", "kol_L", "kol_R", "bacak_L", "bacak_R"];
const vec = (v, n) => Array.isArray(v) && v.length >= n && v.every((x) => Number.isFinite(x));

/** A character recipe the player can build, or an error naming what is wrong (instead of a blank render). */
function checkCharacter(t, where) {
  const bad = [];
  const joints = new Set(["kok", ...Object.keys(t.eklemler || {})]);
  for (const j of JOINTS) if (!t.eklemler?.[j]) bad.push(`joint "${j}" is missing`);
  for (const [name, j] of Object.entries(t.eklemler || {})) {
    if (!joints.has(j.ust)) bad.push(`joint ${name}: parent "${j.ust}" does not exist`);
    if (!vec(j.konum, 3)) bad.push(`joint ${name}: konum must be [x, y, z]`);
  }
  (t.parcalar || []).forEach((p, i) => {
    if (!joints.has(p.eklem)) bad.push(`part ${i}: joint "${p.eklem}" does not exist`);
    if (!SHAPES.has(p.sekil)) bad.push(`part ${i}: unknown shape "${p.sekil}" (${[...SHAPES].join(", ")})`);
    if (!vec(p.konum, 3)) bad.push(`part ${i}: konum must be [x, y, z]`);
    if (SHAPES.has(p.sekil) && !vec(p.boyut, SIZES[p.sekil])) bad.push(`part ${i}: ${p.sekil} needs ${SIZES[p.sekil]} numbers in boyut`);
  });
  if (bad.length) throw new Error(`${where}:\n- ${bad.join("\n- ")}`);
}

const isColor = (c) => typeof c === "string" && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(c);

/** A place recipe the player can build, or an error naming what is wrong (instead of a blank render). */
function checkPlace(t, where) {
  const bad = [];
  if (!Array.isArray(t.gok) || t.gok.length !== 2 || !t.gok.every(isColor)) bad.push("gok must be two colours [top, bottom]");
  if (!isColor(t.zemin)) bad.push("zemin must be a colour");
  (t.tepeler || []).forEach((h, i) => {
    if (!vec(h.konum, 3) || !vec(h.boyut, 3) || !isColor(h.renk)) bad.push(`tepeler ${i}: konum [x, y, z], boyut [x, y, z] and renk`);
  });
  (t.agaclar || []).forEach((a, i) => {
    if (!vec(a.konum, 3) || !(a.boy > 0)) bad.push(`agaclar ${i}: konum [x, y, z] and boy > 0`);
  });
  if (t.gunes && (!vec(t.gunes.konum, 3) || !(t.gunes.r > 0) || !isColor(t.gunes.renk))) bad.push("gunes: konum [x, y, z], r > 0 and renk");
  (t.bulutlar || []).forEach((c, i) => { if (!vec(c, 3)) bad.push(`bulutlar ${i}: [x, y, z]`); });
  if (t.cicekler && (!vec(t.cicekler.alan, 4) || !(t.cicekler.sayi >= 0) || !Array.isArray(t.cicekler.renkler) || !t.cicekler.renkler.every(isColor))) {
    bad.push("cicekler: alan [x0, x1, z0, z1], sayi and renkler");
  }
  if (bad.length) throw new Error(`${where}:\n- ${bad.join("\n- ")}`);
}

/** The 3D recipes an episode needs, by rig and by background; missing ones are named. */
export function recipesFor(episode, libDir) {
  const base = join(libDir, "3d");
  const missing = [];
  const read = (kind, id) => {
    const p = join(base, kind, `${id}.json`);
    if (!existsSync(p)) {
      missing.push(`3d/${kind}/${id}.json`);
      return null;
    }
    return readJson(p);
  };
  const characters = episode.characters.map((c) => ({ id: c.id, tarif: read("karakterler", c.rig) }));
  const problems0 = [];
  for (const c of characters) {
    if (!c.tarif) continue;
    try {
      checkCharacter(c.tarif, `3d/karakterler/${episode.characters.find((x) => x.id === c.id).rig}.json`);
    } catch (err) {
      problems0.push(err.message);
    }
  }
  const bgs = [...new Set(episode.scenes.map((s) => s.bg))];
  const places = Object.fromEntries(bgs.map((bg) => [bg, read("mekanlar", bg)]));
  if (missing.length) throw new Error(`no 3D recipe for: ${missing.join(", ")}`);
  const problems = [...problems0]; // every broken recipe at once, characters and places
  for (const [bg, t] of Object.entries(places)) {
    try {
      checkPlace(t, `3d/mekanlar/${bg}.json`);
    } catch (err) {
      problems.push(err.message);
    }
  }
  if (problems.length) throw new Error(problems.join("\n"));
  return { characters, places };
}

/** Where three.module.js and three.core.js are (the engine's dependency). */
function threeBuild() {
  // the package main is build/three.cjs: its folder holds the module files too
  return dirname(createRequire(import.meta.url).resolve("three"));
}

/**
 * @param {string} episodePath
 * @param {ReturnType<import("./library.mjs").loadLibrary>} lib
 * @param {string} outDir
 * @param {{format?: string, episode?: object}} [opts]
 */
export function compileEpisode3d(episodePath, lib, outDir, opts = {}) {
  // what can fail before anything is written: a valid episode, Three.js installed, the recipes there and sound
  const build = threeBuild();
  const first = opts.episode ?? readJson(episodePath);
  const { ok, errors } = validateEpisode(first, lib);
  if (!ok) throw new Error(`episode is invalid:\n- ${errors.join("\n- ")}`);
  recipesFor(first, lib.dir);
  const { episode, timeline, viewport, audioTags, estimated } = prepareMedia(episodePath, lib, outDir, opts);
  const { characters, places } = recipesFor(episode, lib.dir);

  mkdirSync(join(outDir, "runtime", "vendor"), { recursive: true });
  copyFileSync(join(RUNTIME_DIR, "core.js"), join(outDir, "runtime", "core.js"));
  copyFileSync(join(RUNTIME_DIR, "player3d.js"), join(outDir, "runtime", "player3d.js"));
  for (const f of ["three.module.js", "three.core.js"]) {
    // the panel recompiles its preview on every edit: Three.js (1.3 MB) is copied only when it differs
    const to = join(outDir, "runtime", "vendor", f);
    if (!existsSync(to) || statSync(to).size !== statSync(join(build, f)).size) copyFileSync(join(build, f), to);
  }

  const data = {
    viewport,
    world: lib.world,
    cameras: lib.cameras,
    faces: facesOf(episode, lib),
    unitsPerMetre: UNITS_PER_METRE,
    stil: episode.stil3d || "toon", // the look the episode chose (schema: stil3d)
    actions: Object.fromEntries([...lib.actions].map(([id, a]) => [id, { duration: a.duration, loop: !!a.loop }])),
    characters,
    places,
    shots: timeline.shots.map((s) => ({
      shot_id: s.shot_id, scene_id: s.scene_id, bg: s.bg, start: s.start, end: s.end, cast: s.cast, camera: s.camera,
      utterances: s.utterances.map((u) => ({ speaker: u.speaker, start: u.start, end: u.end, cues: u.cues })),
    })),
  };
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const html = `<!doctype html>
<html lang="${escapeHtml(episode.language)}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${viewport.width}, height=${viewport.height}" />
    <title>${escapeHtml(episode.title || episode.episode)} (3B)</title>
    <style>
      body { margin: 0; background: #dff3fb; }
      #root { position: relative; width: ${viewport.width}px; height: ${viewport.height}px; overflow: hidden; }
      #sahne3d { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-no-timeline data-start="0" data-width="${viewport.width}" data-height="${viewport.height}" data-duration="${timeline.duration}">
      <canvas id="sahne3d" width="${viewport.width}" height="${viewport.height}"></canvas>
      ${audioTags.join("\n      ")}
    </div>
    <script>window.__CIZGI3D__ = ${json};</script>
    <script src="runtime/core.js"></script>
    <script type="module" src="runtime/player3d.js"></script>
  </body>
</html>
`;
  writeFileSync(join(outDir, "index.html"), html);
  writeFileSync(join(outDir, "timing.json"), JSON.stringify(timeline, null, 2));
  return { duration: timeline.duration, shots: timeline.shots.length, outDir, ...(opts.missingAudio === "estimate" ? { estimated } : {}) };
}
