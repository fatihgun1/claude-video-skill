import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadLibrary, checkAction } from "../src/library.mjs";
import { validateEpisode } from "../src/validate.mjs";

const lib = loadLibrary(fileURLToPath(new URL("../../library", import.meta.url)));

function episode(overrides = {}) {
  const shot = {
    shot_id: "s1_sh1",
    utterances: [{ speaker: "anlatici", text: "Merhaba!", audio: "ses/a.wav" }],
    cast: [{ id: "pamuk", action: "selam", mark: "orta" }],
    camera: { framing: "wide", move: "static", target: "pamuk" },
    ...overrides.shot,
  };
  return {
    episode: "deneme",
    language: "tr",
    characters: [{ id: "pamuk", rig: "pamuk" }],
    scenes: [{ scene_id: "s1", bg: "cayir", shots: [shot] }],
    ...overrides.episode,
  };
}

test("a valid episode passes", () => {
  assert.deepEqual(validateEpisode(episode(), lib), { ok: true, errors: [], warnings: [] });
});

test("schema errors are reported before library checks", () => {
  const ep = episode();
  ep.scenes[0].shots[0].camera.zoom = 3;
  const res = validateEpisode(ep, lib);
  assert.equal(res.ok, false);
  assert.ok(res.errors[0].startsWith("schema"));
});

test("unknown action, framing, move, rig and background are rejected with the allowed list", () => {
  const ep = episode({
    shot: { cast: [{ id: "pamuk", action: "takla", mark: "orta" }], camera: { framing: "drone", move: "spin" } },
    episode: { characters: [{ id: "pamuk", rig: "ejderha" }] },
  });
  ep.scenes[0].bg = "uzay";
  const { ok, errors } = validateEpisode(ep, lib);
  assert.equal(ok, false);
  const joined = errors.join("\n");
  for (const bad of ['action "takla"', 'framing "drone"', 'move "spin"', 'rig "ejderha"', 'background "uzay"']) {
    assert.ok(joined.includes(bad), `expected error about ${bad}`);
  }
  assert.ok(/\(alkis, bak, [a-z, -]*zipla\)/.test(joined), "lists the library actions");
});

test("cast, speaker and camera target must refer to known characters", () => {
  const ep = episode({
    shot: {
      cast: [{ id: "tavsan", action: "selam", mark: "orta" }],
      utterances: [{ speaker: "kedi", text: "Miyav", audio: "a.wav" }],
      camera: { framing: "wide", target: "kedi" },
    },
  });
  const joined = validateEpisode(ep, lib).errors.join("\n");
  assert.ok(joined.includes('cast "tavsan" is not in characters'));
  assert.ok(joined.includes('speaker "kedi"'));
  assert.ok(joined.includes('camera target "kedi"'));
});

test("duplicate ids, shared marks and reserved narrator id are rejected", () => {
  const ep = episode({
    shot: {
      cast: [
        { id: "pamuk", action: "selam", mark: "orta" },
        { id: "pamuk", action: "alkis", mark: "orta" },
      ],
    },
    episode: {
      characters: [
        { id: "pamuk", rig: "pamuk" },
        { id: "pamuk", rig: "pamuk" },
        { id: "anlatici", rig: "pamuk" },
      ],
    },
  });
  ep.scenes[0].shots.push({ ...ep.scenes[0].shots[0] });
  const joined = validateEpisode(ep, lib).errors.join("\n");
  for (const msg of ['character id "pamuk" is used twice', "appears twice in cast", "share a mark", "reserved", 'shot id "s1_sh1" is used twice']) {
    assert.ok(joined.includes(msg), msg);
  }
});

test("checkAction catches bad keyframes", () => {
  assert.deepEqual(checkAction({ duration: 1, keys: [{ t: 0, pose: {} }] }, "ok"), []);
  const errs = checkAction({ duration: 0, keys: [{ t: 0.5, pose: null }, { t: 0.2, pose: {} }] }, "bad").join("\n");
  assert.ok(errs.includes("duration must be > 0"));
  assert.ok(errs.includes("must increase"));
  assert.ok(errs.includes("has no pose"));
  assert.ok(errs.includes("first key must be at t=0"));
  assert.ok(checkAction({ duration: 1, keys: [] }, "empty")[0].includes("at least one key"));
});
