// Scene editing for the project tree: add, delete, reorder, name, and moving shots between scenes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadLibrary } from "../src/library.mjs";
import { validateEpisode } from "../src/validate.mjs";
import { vocabulary } from "../src/panel-kutuphane.mjs";
import { scriptFingerprint, storyboardFingerprint } from "../src/onay.mjs";
import {
  nextSceneId, addSceneAfter, deleteScene, moveScene, moveShotToScene, setSceneTitle, SCENE_TITLE_MAX,
} from "../src/panel/kurgu.js";

const LIB_DIR = fileURLToPath(new URL("../../library", import.meta.url));
const SOKAK = fileURLToPath(new URL("../../../../ornekler/sokak/bolum.json", import.meta.url));
const lib = loadLibrary(LIB_DIR);
const vocab = vocabulary(lib);
const fresh = () => JSON.parse(readFileSync(SOKAK, "utf8"));
const viewOf = (ep) => (id) => vocab.rigs.find((r) => r.id === ep.characters.find((c) => c.id === id)?.rig)?.view || "front";
const ids = (ep) => ep.scenes.map((s) => s.scene_id);
const valid = (ep) => {
  const res = validateEpisode(ep, lib);
  assert.deepEqual(res.errors, []);
};

test("a new scene id is s<n> and unused", () => {
  const ep = fresh(); // s0, s1
  assert.equal(nextSceneId(ep), "s2");
  ep.scenes[1].scene_id = "s2";
  assert.equal(nextSceneId(ep), "s3");
});

test("a scene added after another keeps its place, its people standing, and stays valid", () => {
  const ep = fresh();
  const after = ep.scenes[0];
  const last = after.shots.at(-1);
  const scene = addSceneAfter(ep, after, vocab, viewOf(ep));
  assert.deepEqual(ids(ep), ["s0", scene.scene_id, "s1"]);
  assert.equal(scene.bg, after.bg);
  assert.equal(scene.shots.length, 1);
  assert.equal(scene.shots[0].shot_id, `${scene.scene_id}_sh1`);
  assert.deepEqual(scene.shots[0].cast.map((m) => [m.id, m.mark]), last.cast.map((m) => [m.id, m.mark]));
  assert.equal(scene.shots[0].utterances, undefined); // lines come from the script
  valid(ep);
});

test("deleting a scene selects a neighbour's first shot; the last scene stays", () => {
  const ep = fresh();
  const next = deleteScene(ep, ep.scenes[0]);
  assert.deepEqual(ids(ep), ["s1"]);
  assert.equal(next, ep.scenes[0].shots[0].shot_id);
  assert.equal(deleteScene(ep, ep.scenes[0]), null);
  assert.deepEqual(ids(ep), ["s1"]);
  const two = fresh();
  assert.equal(deleteScene(two, two.scenes[1]), two.scenes[0].shots[0].shot_id); // the one before when it was last
  valid(two);
});

test("scenes reorder; out-of-range indexes are clamped and no-ops say so", () => {
  const ep = fresh();
  assert.equal(moveScene(ep, "s1", 0), true);
  assert.deepEqual(ids(ep), ["s1", "s0"]);
  assert.equal(moveScene(ep, "s1", 99), true);
  assert.deepEqual(ids(ep), ["s0", "s1"]);
  assert.equal(moveScene(ep, "s1", 1), false);
  assert.equal(moveScene(ep, "yok", 0), false);
  valid(ep);
});

test("a shot moves to another scene at an index; a scene never loses its last shot", () => {
  const ep = fresh();
  const [a, b] = ep.scenes;
  const moving = b.shots[0].shot_id;
  const bCount = b.shots.length;
  assert.equal(moveShotToScene(ep, moving, a, 0), true);
  assert.equal(a.shots[0].shot_id, moving);
  assert.equal(b.shots.length, bCount - 1);
  valid(ep);
  // within the same scene it is a reorder
  assert.equal(moveShotToScene(ep, moving, a, 1), true);
  assert.equal(a.shots[1].shot_id, moving);
  // a scene with one shot keeps it
  const one = fresh();
  one.scenes[1].shots = one.scenes[1].shots.slice(0, 1);
  const only = one.scenes[1].shots[0].shot_id;
  assert.equal(moveShotToScene(one, only, one.scenes[0], 0), false);
  assert.equal(one.scenes[1].shots[0].shot_id, only);
  assert.equal(moveShotToScene(one, "yok", one.scenes[0], 0), false);
});

test("a scene title is trimmed, capped, and removed when empty; the schema accepts it", () => {
  const ep = fresh();
  const s = ep.scenes[0];
  setSceneTitle(s, "  Sokakta karşılaşma  ");
  assert.equal(s.title, "Sokakta karşılaşma");
  valid(ep);
  setSceneTitle(s, "x".repeat(200));
  assert.equal(s.title.length, SCENE_TITLE_MAX);
  valid(ep);
  setSceneTitle(s, "   ");
  assert.equal("title" in s, false);
  valid(ep);
});

test("naming a scene does not make the approvals stale; moving a shot does", () => {
  const ep = fresh();
  const before = [scriptFingerprint(ep), storyboardFingerprint(ep, null)];
  setSceneTitle(ep.scenes[0], "Giriş");
  assert.deepEqual([scriptFingerprint(ep), storyboardFingerprint(ep, null)], before);
  moveShotToScene(ep, ep.scenes[1].shots[0].shot_id, ep.scenes[0], 0);
  assert.notEqual(storyboardFingerprint(ep, null), before[1]);
});
