import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadLibrary } from "../src/library.mjs";
import { validateEpisode } from "../src/validate.mjs";

const lib = loadLibrary(fileURLToPath(new URL("../../library", import.meta.url)));
const sokak = () => JSON.parse(readFileSync(fileURLToPath(new URL("../../../../ornekler/sokak/bolum.json", import.meta.url)), "utf8"));

test("a cast member may stand off its mark (cast.dx), within limits", () => {
  const ep = sokak();
  ep.scenes[1].shots[0].cast[0].dx = 140;
  assert.deepEqual(validateEpisode(ep, lib).errors, []);
  ep.scenes[1].shots[0].cast[0].dx = 2000;
  assert.ok(validateEpisode(ep, lib).errors.some((e) => /dx/.test(e)));
  ep.scenes[1].shots[0].cast[0].dx = "sağa";
  assert.ok(validateEpisode(ep, lib).errors.some((e) => /dx/.test(e)));
});

test("a cast member may stand back (cast.back 0..1)", () => {
  const ep = sokak();
  ep.scenes[1].shots[0].cast[0].back = 0.6;
  assert.deepEqual(validateEpisode(ep, lib).errors, []);
  ep.scenes[1].shots[0].cast[0].back = 1.5;
  assert.ok(validateEpisode(ep, lib).errors.some((e) => /back/.test(e)));
});
