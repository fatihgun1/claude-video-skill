// A face outside speech: cast[].ifade ("gulumse" for the whole shot, or a list of moments).
// While the character speaks the mouth follows the speech; in its silences (and outside lines)
// it shows the expression.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import "../src/runtime/core.js";
import { loadLibrary } from "../src/library.mjs";
import { validateEpisode } from "../src/validate.mjs";

const C = globalThis.CizgiCore;
const lib = loadLibrary(fileURLToPath(new URL("../../library", import.meta.url)));

test("no ifade is a neutral face", () => {
  assert.equal(C.expressionAt({ id: "a" }, 1), "notr");
});

test("one ifade holds for the whole shot", () => {
  assert.equal(C.expressionAt({ ifade: "gulumse" }, 0), "gulumse");
  assert.equal(C.expressionAt({ ifade: "gulumse" }, 9), "gulumse");
});

test("a list changes the face at its moments, neutral before the first", () => {
  const m = { ifade: [{ ifade: "gulumse", at: 1.5 }, { ifade: "notr", at: 3 }] };
  assert.equal(C.expressionAt(m, 1), "notr");
  assert.equal(C.expressionAt(m, 1.5), "gulumse");
  assert.equal(C.expressionAt(m, 2.9), "gulumse");
  assert.equal(C.expressionAt(m, 3), "notr");
  const unordered = { ifade: [{ ifade: "notr", at: 3 }, { ifade: "gulumse", at: 1 }] };
  assert.equal(C.expressionAt(unordered, 2), "gulumse");
});

test("the mouth: speech first, the expression in its silences and outside lines", () => {
  assert.equal(C.mouthAt("mouth_A", "gulumse"), "mouth_A");
  assert.equal(C.mouthAt("mouth_rest", "gulumse"), "mouth_smile");
  assert.equal(C.mouthAt("mouth_rest", "notr"), "mouth_rest");
});

const episode = (ifade) => ({
  episode: "deneme", language: "tr",
  characters: [{ id: "genc", rig: "genc" }],
  scenes: [{ scene_id: "s1", bg: "sokak", shots: [{ shot_id: "s1_sh1", cast: [{ id: "genc", action: "bak", mark: "orta", ifade }], camera: { framing: "close", move: "static", target: "genc" } }] }],
});

test("the schema takes an expression or a list of moments, nothing else", () => {
  assert.equal(validateEpisode(episode("gulumse"), lib).ok, true);
  assert.equal(validateEpisode(episode([{ ifade: "gulumse", at: 0.5 }]), lib).ok, true);
  assert.equal(validateEpisode(episode("kizgin"), lib).ok, false);
  assert.equal(validateEpisode(episode([{ ifade: "gulumse", at: -1 }]), lib).ok, false);
  assert.equal(validateEpisode(episode([{ ifade: "gulumse" }]), lib).ok, false);
});
