import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadLibrary, checkAction } from "../src/library.mjs";
import { brokenFoot, draftPoseErrors, poseWarnings, FOOT_SLACK } from "../src/poz-denetim.mjs";

const lib = loadLibrary(fileURLToPath(new URL("../../library", import.meta.url)));
const action = (id) => lib.actions.get(id);
const rig = (id) => lib.characters.get(id);

test("a pose is checked whole: the lower foot stands on the ground on the drawing that plays it (Faz 3.6)", () => {
  assert.equal(brokenFoot(action("yuru"), rig("genc")), null, "a walk keeps a foot down");
  assert.equal(brokenFoot(action("egil-al"), rig("genc")), null);
  // a child's bend on a grown-up drawing: the feet leave the floor
  const float = brokenFoot(action("egil-al-cocuk"), rig("genc"));
  assert.ok(float && float.d < -FOOT_SLACK, JSON.stringify(float));
  // a grown-up's sitting on the child drawing: the feet sink into it, temas or not
  const sink = brokenFoot(action("otur"), rig("ela-profil"));
  assert.ok(sink && sink.d > 60, JSON.stringify(sink));
  assert.ok(brokenFoot({ ...action("otur"), temas: "oturma" }, rig("ela-profil")), "resting on a seat does not let the feet go under the floor");
  // the library's jump declares its top key in the air and passes; without that it is told
  const jump = action("zipla");
  assert.equal(brokenFoot(jump, rig("genc-on")), null);
  const undeclared = { ...jump, keys: jump.keys.map(({ temas, ...k }) => k) };
  assert.ok(brokenFoot(undeclared, rig("genc-on")));
});

test("temas and for are checked on actions; a draft is tried on the drawings it is made for", () => {
  assert.match(checkAction({ ...action("yuru"), temas: "ucma" }, "x").join(" "), /temas must be/);
  assert.match(checkAction({ ...action("yuru"), for: "genc" }, "x").join(" "), /for must be a list/);
  assert.deepEqual(draftPoseErrors({ ...action("egil-al"), for: ["genc"] }, lib), []);
  assert.match(draftPoseErrors({ ...action("egil-al-cocuk"), for: ["genc"] }, lib).join(" "), /havada/);
  assert.match(draftPoseErrors({ ...action("yuru"), for: ["yok-boyle"] }, lib).join(" "), /çizimi yok/);
});

test("an episode is told once per drawing and action whose feet leave the ground", () => {
  const ep = {
    characters: [{ id: "k", rig: "genc" }],
    scenes: [{ scene_id: "s1", bg: "park", shots: ["a", "b"].map((id) => ({ shot_id: id, camera: { framing: "wide" }, cast: [{ id: "k", action: "egil-al-cocuk", mark: "orta" }] })) }],
  };
  const w = poseWarnings(ep, lib);
  assert.equal(w.length, 1);
  assert.match(w[0], /shot a: "k" \(genc\) in "egil-al-cocuk": .* float/);
});
