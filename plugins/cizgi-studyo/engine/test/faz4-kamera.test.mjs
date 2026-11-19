import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadLibrary } from "../src/library.mjs";
import { compileEpisode, readyShots } from "../src/compile.mjs";
import "../src/runtime/core.js";

const lib = loadLibrary(fileURLToPath(new URL("../../library", import.meta.url)));
const C = globalThis.CizgiCore;
const SOKAK = fileURLToPath(new URL("../../../../ornekler/sokak/bolum.json", import.meta.url));
const fresh = () => JSON.parse(readFileSync(SOKAK, "utf8"));
const vp = { width: 1920, height: 1080 };
const followMove = Object.keys(lib.cameras.moves).find((k) => lib.cameras.moves[k].follow);

test("a follow shot keeps lead room while walking and centres the walker once the walk is over (Faz 4.6)", () => {
  const shot = {
    shot_id: "x", start: 0, end: 6, camera: { framing: "medium", move: followMove, target: "genc" },
    cast: [{ id: "genc", action: "yuru", mark: "sol", walk: { dx: 600, time: 3 } }],
  };
  const layout = C.layoutFor(lib.world, vp);
  const at = (p) => {
    const cam = C.shotCamera(shot, p, lib.world, lib.cameras, vp, { genc: 125 });
    return cam.cx - C.memberX(shot.cast[0], layout, p * 6, 6);
  };
  assert.ok(at(0.25) > 20, `room ahead while walking right (${at(0.25).toFixed(0)})`);
  assert.ok(Math.abs(at(0.9)) < 5, `centred after the walk (${at(0.9).toFixed(1)})`);
});

test("a camera aimed at a prop lying in the background looks at it, not the middle of the world (Faz 4.12)", () => {
  const ep = fresh();
  const shot = ep.scenes[1].shots[0];
  shot.props = [{ id: "uzaktaki", prop: [...lib.props.keys()][0], depth: { x: 300, y: 700, scale: 0.4 } }];
  shot.camera = { framing: "close", target: "uzaktaki" };
  const ready = readyShots(ep, lib, vp).find((s) => s.shot_id === shot.shot_id);
  assert.equal(ready.anchors.uzaktaki[0], 300);
  const cam = C.shotCamera(ready, 0.5, lib.world, lib.cameras, vp, {});
  assert.ok(cam.cx < lib.world.width / 2 - 100, `looks left at it (${cam.cx})`);
});

test("a close-up of a prop carried by someone walking stays on it (Faz 4.7)", () => {
  const ep = fresh();
  const shot = ep.scenes[1].shots[0];
  shot.utterances = [];
  const walker = "genc";
  shot.cast = [{ id: walker, action: "yuru", mark: "sol", walk: { dx: 700, time: 3 } }];
  const holdable = [...lib.props].find(([, p]) => p.grip)[0];
  shot.props = [{ id: "sise", prop: holdable, mark: "sol", holder: walker, hand: "L" }];
  shot.camera = { framing: "close", target: "sise" };
  const ready = readyShots(ep, lib, vp).find((s) => s.shot_id === shot.shot_id);
  assert.ok(Array.isArray(ready.anchors.sise[2]), "the anchor has a path");
  const c0 = C.shotCamera(ready, 0, lib.world, lib.cameras, vp, {}).cx;
  const c1 = C.shotCamera(ready, 1, lib.world, lib.cameras, vp, {}).cx;
  assert.ok(c1 - c0 > 200, `the camera walks with it (${c0.toFixed(0)} → ${c1.toFixed(0)})`);
});

test("ground props sit in one group the dolly moves with the background and decor (Faz 4.5)", () => {
  const ep = fresh();
  const dir = mkdtempSync(join(tmpdir(), "dolly-"));
  compileEpisode(SOKAK, lib, dir, { episode: ep, missingAudio: "estimate" });
  const html = readFileSync(join(dir, "index.html"), "utf8");
  assert.match(html, /<g id="yerdekiler">/);
  const player = readFileSync(join(dir, "runtime", "player.js"), "utf8");
  assert.match(player, /setDolly\(groundProps\)/);
  assert.match(player, /decorEls\[sid\]\.setAttribute\("transform", dolly\)/);
});
