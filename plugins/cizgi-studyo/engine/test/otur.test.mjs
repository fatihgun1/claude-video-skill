// Sitting down, sitting and standing up (profile): the poses meet at the cuts, the feet stay put.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import "../src/runtime/core.js";
import { loadLibrary } from "../src/library.mjs";
import { validateEpisode } from "../src/validate.mjs";
import { POSE_CHANNELS } from "../src/rigspec.mjs";

const C = globalThis.CizgiCore;
const lib = loadLibrary(fileURLToPath(new URL("../../library", import.meta.url)));
const at = (id, t) => C.sampleAction(lib.actions.get(id), t);
const LEGS = ["leg_L_upper", "leg_L_lower", "foot_L", "root_x", "root_y", "body"];

test("root_x is a pose channel", () => {
  assert.ok(POSE_CHANNELS.includes("root_x"));
});

test("sitting down ends where sitting begins, and standing up starts there", () => {
  const seated = at("otur", 1.4);
  for (const ch of LEGS) {
    assert.equal(at("oturuyor", 0)[ch], seated[ch], `oturuyor ${ch}`);
    assert.equal(at("kalk", 0)[ch], seated[ch], `kalk ${ch}`);
  }
  assert.equal(seated.leg_L_upper, -90);
  assert.equal(seated.root_y, 198);
  assert.equal(seated.root_x, -198, "the hips go back by the thigh, so the ankle stays where it stood");
  for (const ch of LEGS) assert.equal(at("kalk", 1.3)[ch] || 0, 0, `standing again: ${ch}`);
});

test("the feet stay flat all the way down", () => {
  for (const t of [0, 0.25, 0.5, 0.75, 1, 1.4]) {
    const p = at("otur", t);
    assert.ok(Math.abs(p.foot_L + p.leg_L_upper + p.leg_L_lower) < 1e-6, `t=${t}`);
  }
});

test("an episode can sit a profile character down within its joint limits", () => {
  const ep = {
    episode: "otur", language: "tr",
    characters: [{ id: "genc", rig: "genc" }],
    scenes: [{ scene_id: "s1", bg: "park", dekor: [{ id: "b", prop: "bank", x: 860 }], shots: [{ shot_id: "s1_sh1", cast: [{ id: "genc", action: "otur", mark: "orta", actions: [{ action: "oturuyor", at: 1.4 }, { action: "kalk", at: 3 }] }], camera: { framing: "wide", move: "static", target: "genc" } }] }],
  };
  const res = validateEpisode(ep, lib);
  assert.deepEqual(res.errors, []);
});
