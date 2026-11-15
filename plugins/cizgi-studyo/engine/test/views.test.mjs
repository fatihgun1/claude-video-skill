import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadLibrary, checkAction, VIEWS } from "../src/library.mjs";
import { validateEpisode, viewWarnings } from "../src/validate.mjs";

const lib = loadLibrary(fileURLToPath(new URL("../../library", import.meta.url)));

const episode = (rig, action) => ({
  episode: "gorunus",
  language: "tr",
  characters: [{ id: "ela", rig }],
  scenes: [{ scene_id: "s1", bg: "park", shots: [{ shot_id: "s1_sh1", cast: [{ id: "ela", action, mark: "orta" }], camera: { framing: "wide" } }] }],
});

test("every library action says which views it suits", () => {
  for (const [id, a] of lib.actions) {
    assert.ok(Array.isArray(a.views) && a.views.length, `${id} has no views`);
    for (const v of a.views) assert.ok(VIEWS.includes(v), `${id}: unknown view ${v}`);
  }
});

test("an unknown or empty views list is a library error", () => {
  const base = { duration: 1, keys: [{ t: 0, pose: { head: 0 } }] };
  assert.ok(checkAction({ ...base, views: ["yandan"] }, "x").some((e) => e.includes('unknown view "yandan"')));
  assert.ok(checkAction({ ...base, views: [] }, "x").some((e) => e.includes("views must be a non-empty list")));
  assert.deepEqual(checkAction({ ...base, views: ["front"] }, "x"), []);
});

test("Ela's own actions fit her rigs without breaking a joint or a view", () => {
  const cases = {
    ela: ["bekle-cocuk", "el-salla-cocuk", "sevin", "goster", "sasir", "selam", "alkis", "zipla", "bekle"],
    "ela-profil": ["yuru-cocuk", "kos-cocuk", "egil-al-cocuk", "fark-et", "bak"],
  };
  for (const [rig, actions] of Object.entries(cases)) {
    for (const action of actions) {
      const res = validateEpisode(episode(rig, action), lib);
      assert.equal(res.ok, true, `${rig} + ${action}: ${res.errors.join("; ")}`);
      assert.deepEqual(viewWarnings(episode(rig, action), lib), [], `${rig} + ${action}`);
    }
  }
});

test("an action made for another view is a warning, not an error", () => {
  const wrong = validateEpisode(episode("ela-profil", "bekle"), lib);
  assert.equal(wrong.ok, true, wrong.errors.join("\n"));
  assert.ok(wrong.warnings.some((w) => w.includes('"bekle" is made for front/three-quarter-right views') && w.includes("profile-right")));
  assert.deepEqual(viewWarnings(episode("ela", "selam"), lib), []);
  assert.deepEqual(viewWarnings(episode("ela-profil", "yuru-cocuk"), lib), []);
});
