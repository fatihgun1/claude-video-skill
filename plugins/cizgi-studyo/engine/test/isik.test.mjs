// Light and time of day (scene.isik): a colour grade over the world of the scene.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadLibrary } from "../src/library.mjs";
import { validateEpisode } from "../src/validate.mjs";
import { compileEpisode } from "../src/compile.mjs";
import "../src/runtime/core.js";

const LIB = fileURLToPath(new URL("../../library", import.meta.url));
const SOKAK = fileURLToPath(new URL("../../../../ornekler/sokak/bolum.json", import.meta.url));
const lib = loadLibrary(LIB);
const fresh = () => JSON.parse(readFileSync(SOKAK, "utf8"));
const IDENTITY = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
/** A colour through a 4x5 matrix (r, g, b in 0..1). */
const apply = (m, [r, g, b]) => [0, 1, 2].map((i) => m[i * 5] * r + m[i * 5 + 1] * g + m[i * 5 + 2] * b + m[i * 5 + 4]);

test("noon and zero strength change nothing; every time of day is a 4x5 matrix", () => {
  const { lightMatrix, LIGHT_TIMES } = globalThis.CizgiCore;
  assert.deepEqual(LIGHT_TIMES, ["sabah", "ogle", "aksam", "gece"]);
  assert.deepEqual(lightMatrix("ogle", 1), IDENTITY);
  for (const t of LIGHT_TIMES) {
    assert.deepEqual(lightMatrix(t, 0), IDENTITY, t);
    assert.equal(lightMatrix(t, 1).length, 20);
  }
});

test("night is darker and bluer, evening warmer, morning a little golden", () => {
  const { lightMatrix } = globalThis.CizgiCore;
  const white = [1, 1, 1];
  const night = apply(lightMatrix("gece", 1), white);
  assert.ok(night[0] < 0.6 && night[2] > night[0], `night ${night}`);
  const evening = apply(lightMatrix("aksam", 1), white);
  assert.ok(evening[0] > evening[2], `evening ${evening}`);
  const morning = apply(lightMatrix("sabah", 1), white);
  assert.ok(morning[0] >= morning[2] && morning[1] > 0.9, `morning ${morning}`);
  // half strength lies between
  const half = apply(lightMatrix("gece", 0.5), white);
  assert.ok(half[0] > night[0] && half[0] < 1);
});

test("scene light names a time of day and a strength in range", () => {
  const ep = fresh();
  ep.scenes[1].isik = { saat: "gece", guc: 0.8 };
  assert.deepEqual(validateEpisode(ep, lib).errors, []);
  ep.scenes[1].isik = { saat: "gunbatimi" };
  assert.equal(validateEpisode(ep, lib).ok, false);
  ep.scenes[1].isik = { saat: "gece", guc: 2 };
  assert.equal(validateEpisode(ep, lib).ok, false);
});

test("compiled, the world gets a light filter and each shot carries its scene's light; captions stay out", () => {
  const ep = fresh();
  ep.scenes[1].isik = { saat: "aksam" };
  const out = mkdtempSync(join(tmpdir(), "cizgi-isik-"));
  compileEpisode(SOKAK, lib, out, { episode: ep, missingAudio: "estimate" });
  const html = readFileSync(join(out, "index.html"), "utf8");
  assert.match(html, /<filter id="isik"[^>]*><feColorMatrix id="isik-m" type="matrix"/);
  const data = JSON.parse(/window\.__CIZGI__ = (\{[\s\S]*?\});\s*<\/script>/.exec(html)[1]);
  assert.deepEqual(data.shots.find((s) => s.scene_id === "s1").isik, { saat: "aksam" });
  assert.equal(data.shots.find((s) => s.scene_id === "s0").isik, undefined);
  assert.ok(html.indexOf('id="altyazilar"') > html.indexOf("</svg>"), "captions are outside the world (not graded)");
});
