// F7 spike: the 3D compile reads the same episode as the 2D one and draws it from recipes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, mkdirSync, cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadLibrary } from "../src/library.mjs";
import { compileEpisode3d, recipesFor } from "../src/compile3d.mjs";

const LIB = fileURLToPath(new URL("../../library", import.meta.url));
const FAZ1 = fileURLToPath(new URL("../../../../ornekler/faz1/bolum.json", import.meta.url));
const lib = loadLibrary(LIB);
const fresh = () => JSON.parse(readFileSync(FAZ1, "utf8"));

test("3D recipes: a character per rig and a place per background; a missing one is named", () => {
  const { characters, places } = recipesFor(fresh(), LIB);
  assert.equal(characters[0].id, "pamuk");
  assert.ok(characters[0].tarif.parcalar.length > 10);
  assert.ok(places.cayir.agaclar.length);
  const ep = fresh();
  ep.scenes[0].bg = "sokak";
  assert.throws(() => recipesFor(ep, LIB), /3d\/mekanlar\/sokak\.json/);
});

test("a broken character recipe is named at compile time, not left to a blank render", () => {
  const dir = mkdtempSync(join(tmpdir(), "cizgi-3b-lib-"));
  mkdirSync(join(dir, "3d", "karakterler"), { recursive: true });
  mkdirSync(join(dir, "3d", "mekanlar"), { recursive: true });
  cpSync(join(LIB, "3d", "mekanlar", "cayir.json"), join(dir, "3d", "mekanlar", "cayir.json"));
  const t = JSON.parse(readFileSync(join(LIB, "3d", "karakterler", "pamuk.json"), "utf8"));
  delete t.eklemler.kol_R;
  t.parcalar.push({ eklem: "kuyruk", sekil: "yildiz", boyut: [1], konum: [0, 0, 0] });
  writeFileSync(join(dir, "3d", "karakterler", "pamuk.json"), JSON.stringify(t));
  assert.throws(() => recipesFor(fresh(), dir), (e) => /kol_R/.test(e.message) && /kuyruk/.test(e.message) && /yildiz/.test(e.message));
});

test("every recipe part hangs on a joint that exists, and every joint on one above it", () => {
  const { characters } = recipesFor(fresh(), LIB);
  for (const { tarif } of characters) {
    const joints = new Set(["kok", ...Object.keys(tarif.eklemler)]);
    for (const [name, j] of Object.entries(tarif.eklemler)) assert.ok(joints.has(j.ust), `${name} → ${j.ust}`);
    for (const p of tarif.parcalar) assert.ok(joints.has(p.eklem), JSON.stringify(p));
    for (const need of ["govde", "kafa", "kol_L", "kol_R", "bacak_L", "bacak_R"]) assert.ok(tarif.eklemler[need], need);
    assert.ok(tarif.parcalar.some((p) => p.rol === "agiz") && tarif.parcalar.filter((p) => p.rol === "goz").length === 2);
  }
});

test("compiled 3D: Three.js from the engine, the timeline and audio of the 2D render, data for the player", () => {
  const out = mkdtempSync(join(tmpdir(), "cizgi-3b-"));
  const res = compileEpisode3d(FAZ1, lib, out, { missingAudio: "estimate" });
  assert.ok(res.duration > 0);
  for (const f of ["runtime/core.js", "runtime/player3d.js", "runtime/vendor/three.module.js", "runtime/vendor/three.core.js", "timing.json"]) {
    assert.ok(existsSync(join(out, f)), f);
  }
  const html = readFileSync(join(out, "index.html"), "utf8");
  assert.match(html, /data-duration="[\d.]+"/);
  assert.match(html, /<script type="module" src="runtime\/player3d\.js">/);
  assert.doesNotMatch(html, /https?:\/\/[^"]*three/, "no Three.js from the network");
  const data = JSON.parse(/window\.__CIZGI3D__ = (\{[\s\S]*?\});<\/script>/.exec(html)[1]);
  assert.equal(data.shots.length, 3);
  assert.equal(data.characters[0].tarif.ad, "Pamuk");
  assert.ok(data.actions.yuru.duration > 0);
});

test("the 3D look is the episode's choice (stil3d), toon unless it says; an unknown one is refused", async () => {
  const { validateEpisode } = await import("../src/validate.mjs");
  const out = mkdtempSync(join(tmpdir(), "cizgi-3b-stil-"));
  compileEpisode3d(FAZ1, lib, out, { missingAudio: "estimate" });
  const look = (dir) => JSON.parse(/window\.__CIZGI3D__ = (\{[\s\S]*?\});<\/script>/.exec(readFileSync(join(dir, "index.html"), "utf8"))[1]).stil;
  assert.equal(look(out), "toon");
  for (const stil of ["yumusak", "pastel", "golge"]) {
    const ep = fresh();
    ep.stil3d = stil;
    assert.ok(validateEpisode(ep, lib).ok, stil);
    const dir = mkdtempSync(join(tmpdir(), "cizgi-3b-stil-"));
    compileEpisode3d(FAZ1, lib, dir, { episode: ep, missingAudio: "estimate" });
    assert.equal(look(dir), stil);
  }
  const bad = fresh();
  bad.stil3d = "neon";
  assert.equal(validateEpisode(bad, lib).ok, false);
});

test("a broken place recipe or a short shape size is named at compile time; an invalid episode gets its validation errors", () => {
  const dir = mkdtempSync(join(tmpdir(), "cizgi-3b-lib2-"));
  mkdirSync(join(dir, "3d", "karakterler"), { recursive: true });
  mkdirSync(join(dir, "3d", "mekanlar"), { recursive: true });
  const t = JSON.parse(readFileSync(join(LIB, "3d", "karakterler", "pamuk.json"), "utf8"));
  t.parcalar.push({ eklem: "govde", sekil: "kure", boyut: [1, 1], konum: [0, 0, 0] }); // a sphere needs three radii
  writeFileSync(join(dir, "3d", "karakterler", "pamuk.json"), JSON.stringify(t));
  const p = JSON.parse(readFileSync(join(LIB, "3d", "mekanlar", "cayir.json"), "utf8"));
  delete p.gok;
  p.agaclar.push({ konum: [0, 0] });
  writeFileSync(join(dir, "3d", "mekanlar", "cayir.json"), JSON.stringify(p));
  assert.throws(() => recipesFor(fresh(), dir), (e) => /kure needs 3/.test(e.message) && /gok/.test(e.message) && /agaclar/.test(e.message));
  const bad = fresh();
  delete bad.scenes;
  assert.throws(() => compileEpisode3d(FAZ1, lib, mkdtempSync(join(tmpdir(), "cizgi-3b-")), { episode: bad }), /invalid/);
});
