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

const vp916 = { width: 1080, height: 1920 };
const fit916 = 1920 / 1080;

test("portrait wide shot zooms slightly past fit and looks up for caption headroom", () => {
  const cam = C.cameraAt({ framing: "wide" }, 0, 960, world, presets, vp916);
  near(cam.zoom, fit916 * 1.1);
  const halfH = 1920 / cam.zoom / 2;
  near(cam.cy, halfH, 1e-6); // pushed up as far as the world allows
  assert.ok(cam.cy < 540);
});

test("portrait framing zoom is compressed, not multiplied", () => {
  const close = C.cameraAt({ framing: "close" }, 0, 960, world, presets, vp916);
  near(close.zoom, Math.max(2, fit916 * 1.1 * (1 + 1 * 0.35)));
  assert.ok(close.zoom < 2 * fit916);
});

test("landscape framing is unaffected by portrait rules", () => {
  const cam = C.cameraAt({ framing: "close" }, 0, 960, world, presets, vp169);
  near(cam.zoom, 2);
  near(cam.cy, 540);
});

test("hose arm: rest pose keeps the drawing, bends move elbow and wrist on one smooth curve", () => {
  const rest = [[0, 0], [0, 100], [0, 180]];
  const straight = C.hoseGeometry(rest, 0, 0);
  near(straight.wrist[0], 0);
  near(straight.wrist[1], 180);
  assert.match(straight.d, /^M0\.0 0\.0 Q0\.0 105\.0 0\.0 180\.0$/, "control point on the line: still straight");
  const raised = C.hoseGeometry(rest, 180, 0);
  near(raised.elbow[1], -100);
  near(raised.wrist[1], -180);
  const bent = C.hoseGeometry(rest, 0, 90);
  near(bent.elbow[1], 100);
  near(bent.wrist[0], -80);
  near(bent.wrist[1], 100);
  assert.equal(bent.d.split("Q").length, 2, "a single quadratic: no joint seam");
});

test("follow-through: ears react to head turns and jumps, forearms trail", () => {
  const still = C.secondaryMotion({ head: 5 }, { head: 5 });
  near(still.ear_L, 0);
  near(still.arm_L_lower, 0);
  const turned = C.secondaryMotion({ head: 10 }, { head: 0 });
  near(turned.ear_L, -12);
  near(turned.ear_R, -12);
  const rising = C.secondaryMotion({ root_y: -40 }, { root_y: 0 });
  near(rising.ear_L, 10);
  near(rising.ear_R, -10);
  const capped = C.secondaryMotion({ head: 90 }, { head: 0 });
  near(capped.ear_L, -25);
  const arm = C.secondaryMotion({ arm_L_upper: -100, arm_L_lower: 10 }, { arm_L_upper: -60 });
  near(arm.arm_L_lower, 10 + 40 * 0.35);
});

test("a cast member stands dx world units from its mark (scaled like other distances in portrait)", () => {
  const world = { character_height: 620, marks: { sol: 560, orta: 960, sag: 1360 }, portrait: { marks: { sol: 820, orta: 960, sag: 1100 }, character_scale: 0.75 } };
  const land = C.layoutFor(world, { width: 1920, height: 1080 });
  const port = C.layoutFor(world, { width: 1080, height: 1920 });
  near(C.memberX({ mark: "sol", dx: 120 }, land, 0, 2), 680);
  near(C.memberX({ mark: "sol", dx: 120 }, port, 0, 2), 910);
  near(C.memberX({ mark: "orta" }, land, 0, 2), 960);
  // A walk starts from the shifted place.
  near(C.memberX({ mark: "sol", dx: 100, walk: { dx: 200 } }, land, 2, 2), 860);
});

test("a cast member placed back (cast.back) stands higher and smaller, and the camera finds its face there", () => {
  const world = { character_height: 620, ground_y: 870, marks: { sol: 560, orta: 960, sag: 1360 } };
  const land = C.layoutFor(world, { width: 1920, height: 1080 });
  assert.deepEqual(C.depthOf({}, land), { rise: 0, shrink: 1 });
  const back = C.depthOf({ back: 1 }, land);
  assert.ok(back.rise > 0 && back.shrink < 1);
  const half = C.depthOf({ back: 0.5 }, land);
  near(half.rise, back.rise / 2);
  near(half.shrink, 1 - (1 - back.shrink) / 2);
  const shot = (b) => ({ camera: { framing: "medium", target: "a" }, cast: [{ id: "a", mark: "orta", action: "x", back: b }] });
  const front = C.focusFaceY(shot(0), land, world, { a: 400 });
  const far = C.focusFaceY(shot(1), land, world, { a: 400 });
  // feet rise; the head comes down by what the smaller body no longer reaches
  near(front - far, back.rise - (950 - 400) * land.scale * (1 - back.shrink));
});
