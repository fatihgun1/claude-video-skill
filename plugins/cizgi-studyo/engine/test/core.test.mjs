import { test } from "node:test";
import assert from "node:assert/strict";
import "../src/runtime/core.js";

const C = globalThis.CizgiCore;
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

const twoKey = {
  duration: 1,
  loop: false,
  keys: [
    { t: 0, pose: { head: 0 } },
    { t: 1, pose: { head: 10 }, ease: "linear" },
  ],
};

test("ease clamps input and falls back to inOutSine for unknown names", () => {
  near(C.ease("linear", -1), 0);
  near(C.ease("linear", 2), 1);
  near(C.ease("nope", 0.5), C.EASES.inOutSine(0.5));
});

test("all easing functions map 0→0 and 1→1", () => {
  for (const [name, fn] of Object.entries(C.EASES)) {
    near(fn(0), 0);
    near(fn(1), 1, 1e-9);
    assert.ok(Number.isFinite(fn(0.5)), name);
  }
});

test("sampleAction interpolates between keys with the target key's ease", () => {
  near(C.sampleAction(twoKey, 0.5).head, 5);
  near(C.sampleAction(twoKey, 0).head, 0);
});

test("one-shot actions hold their last key; looping actions wrap", () => {
  near(C.sampleAction(twoKey, 5).head, 10);
  const looping = { ...twoKey, loop: true };
  near(C.sampleAction(looping, 1.25).head, 2.5);
});

test("channels missing from a key use their neutral value (1 for scale)", () => {
  const action = {
    duration: 1,
    keys: [
      { t: 0, pose: { root_sy: 0.5 } },
      { t: 1, pose: { head: 4 }, ease: "linear" },
    ],
  };
  const p = C.sampleAction(action, 1);
  near(p.root_sy, 1);
  near(p.head, 4);
  near(C.sampleAction(action, 0).head, 0);
});

test("negative time samples the first key", () => {
  near(C.sampleAction(twoKey, -3).head, 0);
});

test("blendPose mixes channels present on either side", () => {
  const out = C.blendPose({ head: 10 }, { arm_L_upper: -20, root_sx: 2 }, 0.5);
  near(out.head, 5);
  near(out.arm_L_upper, -10);
  near(out.root_sx, 1.5);
});

test("visemeAt maps Rhubarb shapes and rests outside cues", () => {
  const cues = [
    { start: 0, end: 0.1, value: "A" },
    { start: 0.1, end: 0.3, value: "D" },
    { start: 0.3, end: 0.4, value: "Q" },
  ];
  assert.equal(C.visemeAt(cues, 0.05), "mouth_MBP");
  assert.equal(C.visemeAt(cues, 0.2), "mouth_A");
  assert.equal(C.visemeAt(cues, 0.35), "mouth_rest");
  assert.equal(C.visemeAt(cues, 1), "mouth_rest");
});

test("wordIndexAt returns the latest started word and skips untimed words", () => {
  const words = [{ start: 0.1 }, { start: null }, { start: 0.5 }];
  assert.equal(C.wordIndexAt(words, 0), -1);
  assert.equal(C.wordIndexAt(words, 0.3), 0);
  assert.equal(C.wordIndexAt(words, 0.6), 2);
});

test("blink and idle are deterministic and phase is stable per id", () => {
  assert.equal(C.phaseFor("pamuk"), C.phaseFor("pamuk"));
  assert.ok(C.phaseFor("pamuk") >= 0 && C.phaseFor("pamuk") < 3);
  assert.equal(C.blinkClosed(0.05, 0), true);
  assert.equal(C.blinkClosed(1, 0), false);
  assert.deepEqual(C.idleOffsets(1.3, 0.4), C.idleOffsets(1.3, 0.4));
});

const world = { width: 1920, height: 1080 };
const presets = {
  framings: { wide: { zoom: 1, focus_y: 0.5 }, close: { zoom: 2 } },
  moves: { static: {}, push_in: { zoom_to: 1.5, ease: "linear" }, pan_right: { pan_from: -0.1, pan_to: 0.1, ease: "linear" } },
};
const vp169 = { width: 1920, height: 1080 };

test("wide static camera shows the whole world", () => {
  const cam = C.cameraAt({ framing: "wide" }, 0.5, null, world, presets, vp169);
  near(cam.zoom, 1);
  near(cam.cx, 960);
  near(cam.cy, 540);
  assert.equal(C.cameraTransform(cam, vp169), "translate(0.00 0.00) scale(1.0000)");
});

test("push_in zooms over the shot and close framing follows the target", () => {
  const start = C.cameraAt({ framing: "close", move: "push_in", target: "x" }, 0, 1300, world, presets, vp169);
  const end = C.cameraAt({ framing: "close", move: "push_in", target: "x" }, 1, 1300, world, presets, vp169);
  near(start.zoom, 2);
  near(end.zoom, 3);
  near(start.cx, 1300);
});

test("camera is clamped inside the world", () => {
  const cam = C.cameraAt({ framing: "close" }, 0, 1900, world, presets, vp169);
  near(cam.cx, 1920 - 1920 / 2 / 2);
});

test("pan moves the centre across the shot", () => {
  const a = C.cameraAt({ framing: "close", move: "pan_right" }, 0, 960, world, presets, vp169);
  const b = C.cameraAt({ framing: "close", move: "pan_right" }, 1, 960, world, presets, vp169);
  near(b.cx - a.cx, 0.2 * 1920);
});

test("portrait viewport covers the world height (zoom ≥ fit)", () => {
  const vp916 = { width: 1080, height: 1920 };
  const cam = C.cameraAt({ framing: "wide" }, 0, 960, world, presets, vp916);
  near(cam.zoom, 1920 / 1080);
  near(cam.cy, 540);
});

test("portrait framing zoom is compressed, not multiplied", () => {
  const vp916 = { width: 1080, height: 1920 };
  const fit = 1920 / 1080;
  const close = C.cameraAt({ framing: "close" }, 0, 960, world, presets, vp916);
  near(close.zoom, Math.max(2, fit * (1 + 1 * 0.35)));
  assert.ok(close.zoom < 2 * fit);
});
