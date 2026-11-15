// Layered backgrounds (backgrounds/<id>/mekan.json + one SVG per layer), per-scene layer
// settings (scene.katmanlar) and parallax.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadLibrary } from "../src/library.mjs";
import { validateEpisode } from "../src/validate.mjs";
import { compileEpisode } from "../src/compile.mjs";
import "../src/runtime/core.js";

const LIB = fileURLToPath(new URL("../../library", import.meta.url));
const SOKAK = fileURLToPath(new URL("../../../../ornekler/sokak/bolum.json", import.meta.url));
const layer = (fill, extra = "") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080"><rect id="r" width="1920" height="1080" fill="${fill}"/>${extra}</svg>`;
const MEKAN = {
  ad: "Deneme parkı",
  katmanlar: [
    { id: "gok", dosya: "gok.svg", derinlik: 0 },
    { id: "uzak", dosya: "uzak.svg", derinlik: 0.4 },
    { id: "zemin", dosya: "zemin.svg", derinlik: 1 },
  ],
};

let root;
/** A small copy of the library (no music or effects) with one layered background added. */
function library(mekan = MEKAN, files = { "gok.svg": layer("#9fd3ee"), "uzak.svg": layer("#b4d99a"), "zemin.svg": layer("#c9b48a") }) {
  const dir = mkdtempSync(join(root, "lib-"));
  for (const sub of ["characters", "actions", "backgrounds", "profiles", "props"]) cpSync(join(LIB, sub), join(dir, sub), { recursive: true });
  for (const f of ["world.json", "cameras.json"]) cpSync(join(LIB, f), join(dir, f));
  const bg = join(dir, "backgrounds", "katmanli");
  mkdirSync(bg);
  writeFileSync(join(bg, "mekan.json"), JSON.stringify(mekan));
  for (const [name, svg] of Object.entries(files)) writeFileSync(join(bg, name), svg);
  return dir;
}

before(() => {
  root = mkdtempSync(join(tmpdir(), "cizgi-mekan-"));
});

test("a layered background loads with its layers and depths; a single-file one is one layer at depth 1", () => {
  const lib = loadLibrary(library());
  assert.deepEqual(lib.layers.get("katmanli").map((l) => [l.id, l.derinlik]), [["gok", 0], ["uzak", 0.4], ["zemin", 1]]);
  assert.deepEqual(lib.layers.get("park").map((l) => [l.id, l.derinlik]), [["tum", 1]]);
  // the combined drawing stands in for it wherever one picture is needed (thumbnails, fingerprints)
  const svg = lib.backgrounds.get("katmanli");
  assert.match(svg, /^<svg[^>]*viewBox="0 0 1920 1080"/);
  assert.match(svg, /data-katman="uzak" data-derinlik="0.4"/);
  assert.equal(lib.backgroundNames.get("katmanli"), "Deneme parkı");
});

test("a broken layered background stops the library with a clear reason", () => {
  const cases = [
    [{ ...MEKAN, katmanlar: [{ id: "gok", dosya: "yok.svg", derinlik: 0 }] }, /yok\.svg/],
    [{ ...MEKAN, katmanlar: [{ id: "gok", dosya: "gok.svg", derinlik: 2 }] }, /derinlik/],
    [{ ...MEKAN, katmanlar: [{ id: "gok", dosya: "gok.svg", derinlik: 0 }, { id: "gok", dosya: "uzak.svg", derinlik: 1 }] }, /twice|iki kez/],
    [{ ...MEKAN, katmanlar: [{ id: "gok", dosya: "../gok.svg", derinlik: 0 }] }, /dosya/],
    [{ ...MEKAN, katmanlar: [] }, /katman/],
  ];
  for (const [mekan, re] of cases) assert.throws(() => loadLibrary(library(mekan)), re);
  assert.throws(() => loadLibrary(library(MEKAN, { "gok.svg": layer("#000", "<script>x()</script>"), "uzak.svg": layer("#111"), "zemin.svg": layer("#222") })), /script/i);
  assert.throws(() => loadLibrary(library(MEKAN, { "gok.svg": layer("#000").replace("0 0 1920 1080", "0 0 800 600"), "uzak.svg": layer("#111"), "zemin.svg": layer("#222") })), /viewBox/);
});

test("scene layer settings name layers of the scene's background and stay in range", () => {
  const lib = loadLibrary(library());
  const ep = JSON.parse(readFileSync(SOKAK, "utf8"));
  ep.scenes[1].bg = "katmanli";
  ep.scenes[1].katmanlar = { uzak: { dx: -120, olcek: 1.1, ton: "#ffcc88" }, gok: { gizli: true } };
  assert.deepEqual(validateEpisode(ep, lib).errors, []);
  ep.scenes[1].katmanlar = { bulut: { dx: 10 } };
  assert.match(validateEpisode(ep, lib).errors.join("\n"), /bulut/);
  ep.scenes[1].katmanlar = { uzak: { olcek: 9 } };
  assert.equal(validateEpisode(ep, lib).ok, false);
  ep.scenes[0].katmanlar = { tum: { ton: "#203060" } }; // a single-file background has one layer: tum
  ep.scenes[1].katmanlar = {};
  assert.deepEqual(validateEpisode(ep, lib).errors, []);
});

test("compiling draws each layer in its own group, with the scene's settings for the player", () => {
  const lib = loadLibrary(library());
  const ep = JSON.parse(readFileSync(SOKAK, "utf8"));
  ep.scenes[1].bg = "katmanli";
  ep.scenes[1].katmanlar = { uzak: { dx: -120, ton: "#ffcc88" } };
  const out = mkdtempSync(join(root, "out-"));
  compileEpisode(SOKAK, lib, out, { episode: ep, missingAudio: "estimate" });
  const html = readFileSync(join(out, "index.html"), "utf8");
  for (const k of ["gok", "uzak", "zemin"]) assert.match(html, new RegExp(`id="bg-katmanli--k-${k}" data-derinlik`));
  assert.match(html, /<filter id="ton-ffcc88"/);
  const data = JSON.parse(/window\.__CIZGI__ = (\{[\s\S]*?\});\s*<\/script>/.exec(html)?.[1] || "null") || JSON.parse(readFileSync(join(out, "veri.json"), "utf8"));
  assert.deepEqual(data.layers.katmanli.map((l) => [l.id, l.derinlik]), [["gok", 0], ["uzak", 0.4], ["zemin", 1]]);
  const shot = data.shots.find((s) => s.bg === "katmanli");
  assert.deepEqual(shot.katmanlar, { uzak: { dx: -120, ton: "#ffcc88" } });
  rmSync(out, { recursive: true, force: true });
});

test("parallax: the character plane moves with the camera, the farthest layer stays as drawn for the home camera", () => {
  const { parallaxTransform, homeCamera, shotCamera } = globalThis.CizgiCore;
  const lib = loadLibrary(library());
  const world = lib.world;
  // home = the camera of a wide, still, untargeted shot in that format (portrait zoom and headroom included)
  const wide = (viewport) => shotCamera({ cast: [], camera: { framing: "wide", move: "static" }, start: 0, end: 1 }, 0, world, lib.cameras, viewport, null);
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }]) {
    assert.deepEqual(homeCamera(world, viewport, lib.cameras), wide(viewport));
  }
  assert.deepEqual(homeCamera(world, { width: 1920, height: 1080 }, lib.cameras), { cx: 960, cy: 540, zoom: 1 });
  const start = homeCamera(world, { width: 1920, height: 1080 }, lib.cameras);
  const now = { cx: 1260, cy: 540, zoom: 1.5 };
  const id = parallaxTransform(now, start, 1);
  assert.deepEqual([id.s, id.tx, id.ty], [1, 0, 0]);
  // a layer point p ends up on screen at ((q - c) * z + V/2) with q = p * s + t
  const screen = (p, cam, tr) => [(p[0] * tr.s + tr.tx - cam.cx) * cam.zoom + 960, (p[1] * tr.s + tr.ty - cam.cy) * cam.zoom + 540];
  const far = parallaxTransform(now, start, 0);
  const p = [500, 300];
  const atStart = screen(p, start, parallaxTransform(start, start, 0));
  const atNow = screen(p, now, far);
  assert.ok(Math.abs(atStart[0] - atNow[0]) < 1e-9 && Math.abs(atStart[1] - atNow[1]) < 1e-9);
  // in between: moves part of the way
  const mid = screen(p, now, parallaxTransform(now, start, 0.5));
  const plane = screen(p, now, id);
  assert.ok(mid[0] < atStart[0] === plane[0] < atStart[0]);
  assert.ok(Math.abs(mid[0] - atStart[0]) < Math.abs(plane[0] - atStart[0]));
});
