import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadLibrary } from "../src/library.mjs";
import { validateEpisode } from "../src/validate.mjs";
import { decisionProblems, requireDecisions } from "../src/kararlar.mjs";
import { storyboardFingerprint } from "../src/onay.mjs";

const LIB_DIR = fileURLToPath(new URL("../../library", import.meta.url));
const CLI = fileURLToPath(new URL("../src/cli.mjs", import.meta.url));
const lib = loadLibrary(LIB_DIR);

const KARARLAR = { boyut: "2b", muzik: "yok", efekt: "yok", altyazi: "var" };

function episode(overrides = {}) {
  return {
    episode: "deneme",
    language: "tr",
    format: "9:16",
    kararlar: KARARLAR,
    characters: [{ id: "genc", rig: "genc" }],
    scenes: [{ scene_id: "s1", bg: "sokak", shots: [{
      shot_id: "s1_sh1",
      utterances: [{ speaker: "genc", text: "Merhaba." }],
      cast: [{ id: "genc", action: "bak", mark: "orta" }],
      camera: { framing: "wide", move: "static", target: "genc" },
    }] }],
    ...overrides,
  };
}

test("an episode with every decision recorded has no problems", () => {
  assert.deepEqual(decisionProblems(episode(), lib), { eksik: [], uyarilar: [] });
});

test("the schema accepts kararlar and refuses unknown values", () => {
  assert.equal(validateEpisode(episode(), lib).ok, true);
  const bad = validateEpisode(episode({ kararlar: { ...KARARLAR, boyut: "4b" } }), lib);
  assert.equal(bad.ok, false);
  assert.equal(validateEpisode(episode({ kararlar: { ...KARARLAR, renk: "mavi" } }), lib).ok, false);
});

test("missing format and decisions are listed by name", () => {
  const { format, kararlar, ...rest } = episode();
  const { eksik } = decisionProblems(rest, lib);
  for (const name of ["format", "boyut", "muzik", "efekt", "altyazi"]) {
    assert.ok(eksik.some((m) => m.startsWith(`${name}:`)), `${name} missing from ${JSON.stringify(eksik)}`);
  }
});

test("a 3D episode needs its look (stil3d)", () => {
  const ep = episode({ kararlar: { ...KARARLAR, boyut: "3b" } });
  assert.ok(decisionProblems(ep, lib).eksik.some((m) => m.startsWith("stil3d:")));
  assert.ok(!decisionProblems({ ...ep, stil3d: "toon" }, lib).eksik.some((m) => m.startsWith("stil3d:")));
});

test("a 3D episode warns about characters and places with no 3D recipe", () => {
  const { uyarilar } = decisionProblems(episode({ kararlar: { ...KARARLAR, boyut: "3b" }, stil3d: "toon" }), lib);
  assert.ok(uyarilar.some((m) => m.includes("genc")), JSON.stringify(uyarilar));
  assert.ok(uyarilar.some((m) => m.includes("sokak")), JSON.stringify(uyarilar));
});

test("a decision that the episode contradicts is a problem", () => {
  const musicYes = decisionProblems(episode({ kararlar: { ...KARARLAR, muzik: "var" } }), lib).eksik;
  assert.ok(musicYes.some((m) => m.startsWith("muzik:")), JSON.stringify(musicYes));
  const musicNo = decisionProblems(episode({ music: { track: "x" } }), lib).eksik;
  assert.ok(musicNo.some((m) => m.startsWith("muzik:")));
  const capsNo = decisionProblems(episode({ kararlar: { ...KARARLAR, altyazi: "yok" } }), lib).eksik;
  assert.ok(capsNo.some((m) => m.startsWith("altyazi:")));
  const ep = episode();
  ep.scenes[0].shots[0].sfx = [{ sfx: "adim-beton", at: 0 }];
  assert.ok(decisionProblems(ep, lib).eksik.some((m) => m.startsWith("efekt:")));
});

test("requireDecisions throws with every missing decision", () => {
  assert.doesNotThrow(() => requireDecisions(episode(), lib));
  const { kararlar, ...rest } = episode();
  assert.throws(() => requireDecisions(rest, lib), /boyut[\s\S]*muzik/);
});

test("recording decisions does not make the storyboard approval stale", () => {
  const { kararlar, ...rest } = episode();
  assert.equal(storyboardFingerprint(rest, null), storyboardFingerprint(episode(), null));
});

test("cizgi onayla senaryo refuses an episode with open decisions", () => {
  const dir = mkdtempSync(join(tmpdir(), "kararlar-"));
  const path = join(dir, "bolum.json");
  const { kararlar, ...rest } = episode();
  writeFileSync(path, JSON.stringify(rest));
  const refused = spawnSync(process.execPath, [CLI, "onayla", "senaryo", path], { encoding: "utf8" });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /boyut/);
  assert.equal(existsSync(join(dir, "onay.json")), false);

  writeFileSync(path, JSON.stringify(episode()));
  const ok = spawnSync(process.execPath, [CLI, "onayla", "senaryo", path], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
});

test("cizgi dogrula and durum report open decisions", () => {
  const dir = mkdtempSync(join(tmpdir(), "kararlar-"));
  const path = join(dir, "bolum.json");
  const { kararlar, ...rest } = episode();
  writeFileSync(path, JSON.stringify(rest));
  const dogrula = JSON.parse(spawnSync(process.execPath, [CLI, "dogrula", path], { encoding: "utf8" }).stdout);
  assert.ok(dogrula.kararlar.eksik.length >= 4);
  const durum = JSON.parse(spawnSync(process.execPath, [CLI, "durum", path], { encoding: "utf8" }).stdout);
  assert.ok(durum.kararlar.eksik.length >= 4);
  assert.match(durum.next, /kararlar/);
});
