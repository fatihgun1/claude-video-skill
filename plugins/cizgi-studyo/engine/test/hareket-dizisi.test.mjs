// Several actions one after another in a shot: cast[].actions = [{action, at, from?}],
// played after the member's own `action` (which starts the shot).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadLibrary } from "../src/library.mjs";
import { validateEpisode } from "../src/validate.mjs";
import { libraryFingerprint } from "../src/onay.mjs";
import { compileEpisode, propLayer, VIEWPORTS } from "../src/compile.mjs";
import { buildTimeline } from "../src/timing.mjs";
import "../src/runtime/core.js";

const C = globalThis.CizgiCore;
const LIB_DIR = fileURLToPath(new URL("../../library", import.meta.url));
const lib = loadLibrary(LIB_DIR);

/** Ela in profile walks, then stops and picks up the bottle. */
function episode(member = {}, shot = {}) {
  return {
    episode: "dizi-deneme",
    language: "tr",
    characters: [{ id: "ela", name: "Ela", rig: "ela-profil" }],
    scenes: [{
      scene_id: "s1",
      bg: "park",
      shots: [{
        shot_id: "s1_sh1",
        cast: [{
          id: "ela", action: "yuru-cocuk", mark: "sol",
          walk: { dx: 288, time: 2 },
          actions: [{ action: "egil-al-cocuk", at: 2 }],
          ...member,
        }],
        props: [{ id: "sise", prop: "plastik-sise", mark: "orta", holder: "ela" }],
        camera: { framing: "wide", move: "static", target: "ela" },
        hold: 6,
        ...shot,
      }],
    }],
  };
}
const errorsOf = (ep) => validateEpisode(ep, lib).errors;
const warningsOf = (ep) => validateEpisode(ep, lib).warnings;

test("which action plays when: the member's own action from 0, then each listed one from its time", () => {
  const m = { action: "a", from: 0.5, actions: [{ action: "b", at: 2 }, { action: "c", at: 3, from: 0.25 }] };
  assert.deepEqual(C.segmentsOf(m).map((s) => [s.action, s.at, s.from]), [["a", 0, 0.5], ["b", 2, 0], ["c", 3, 0.25]]);
  assert.deepEqual(C.segmentAt(m, 1), { action: "a", time: 1.5, index: 0, at: 0 });
  assert.deepEqual(C.segmentAt(m, 2.5), { action: "b", time: 0.5, index: 1, at: 2 });
  assert.deepEqual(C.segmentAt(m, 3.5), { action: "c", time: 0.75, index: 2, at: 3 });
  assert.deepEqual(C.segmentAt({ action: "a" }, 9), { action: "a", time: 9, index: 0, at: 0 });
});

test("an episode with an action sequence is valid", () => {
  assert.deepEqual(errorsOf(episode()), []);
});

test("every listed action must be in the library and fit the rig", () => {
  assert.ok(errorsOf(episode({ actions: [{ action: "salla-sise", at: 2 }] })).some((e) => /salla-sise/.test(e)));
  // alkis bends the far elbow further than the profile rig allows
  assert.ok(errorsOf(episode({ actions: [{ action: "alkis", at: 2 }] })).some((e) => /"alkis" bends/.test(e)));
  const late = errorsOf(episode({ actions: [{ action: "egil-al-cocuk", at: 2, from: 9 }] }));
  assert.ok(late.some((e) => /starts "egil-al-cocuk" at 9s but it lasts/.test(e)), late.join("\n"));
});

test("listed actions come in time order, after the start", () => {
  const ep = episode({ actions: [{ action: "egil-al-cocuk", at: 3 }, { action: "fark-et", at: 2 }] });
  assert.ok(errorsOf(ep).some((e) => /in time order/.test(e)));
  assert.ok(errorsOf(episode({ actions: [{ action: "egil-al-cocuk", at: 0 }] })).some((e) => /at/.test(e)));
  assert.ok(errorsOf(episode({ actions: [{ action: "egil-al-cocuk" }] })).length > 0);
});

test("a listed action drawn for another view is warned about, like the first one", () => {
  // bak-on is drawn for three-quarter rigs: it fits the profile rig's joints but not its view
  const w = warningsOf(episode({ actions: [{ action: "bak-on", at: 2 }] }));
  assert.ok(w.some((x) => /"bak-on" is made for three-quarter-right views/.test(x)), w.join("\n"));
});

test("a walk that stops inside the shot must end when the walking action ends", () => {
  assert.ok(!warningsOf(episode()).some((x) => /feet/.test(x)));
  const long = warningsOf(episode({ walk: { dx: 432, time: 3 } }));
  assert.ok(long.some((x) => /stops walking at 2s but walk\.time is 3s/.test(x)), long.join("\n"));
  const whole = warningsOf(episode({ walk: { dx: 288 } }));
  assert.ok(whole.some((x) => /stops walking at 2s but walks the whole shot/.test(x)), whole.join("\n"));
});

test("the library fingerprint covers listed actions (an edit to them makes the storyboard stale)", () => {
  const ep = episode();
  const a = libraryFingerprint(ep, lib);
  const other = loadLibrary(LIB_DIR);
  other.actions.set("egil-al-cocuk", { ...other.actions.get("egil-al-cocuk"), duration: 3.3 });
  assert.notEqual(libraryFingerprint(ep, other), a);
});

test("a grab inside a later action counts from when that action starts", () => {
  const ep = episode();
  const timeline = buildTimeline(ep, () => ({ duration: 1 }));
  const layer = propLayer(timeline, ep, lib, VIEWPORTS["16:9"]);
  const grab = lib.actions.get("egil-al-cocuk").grab.t;
  assert.equal(layer.data[0][0].grab, 2 + grab);
  // started part-way, it reaches the grab earlier
  const ep2 = episode({ actions: [{ action: "egil-al-cocuk", at: 2, from: 0.35 }] });
  const layer2 = propLayer(buildTimeline(ep2, () => ({ duration: 1 })), ep2, lib, VIEWPORTS["16:9"]);
  assert.ok(Math.abs(layer2.data[0][0].grab - (2 + grab - 0.35)) < 1e-9);
});

test("a shot grows to show an action listed after its hold, instead of refusing to compile", () => {
  const ep = episode({ actions: [{ action: "egil-al-cocuk", at: 30 }] }, { hold: 1 });
  const out = mkdtempSync(join(tmpdir(), "dizi-"));
  try {
    assert.deepEqual(errorsOf(ep), []);
    const res = compileEpisode(join(out, "bolum.json"), lib, out, { episode: ep });
    assert.ok(res.duration > 30, `the shot lasts past the action (${res.duration}s)`);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("a valid sequence compiles and carries the list to the player", () => {
  const out = mkdtempSync(join(tmpdir(), "dizi-"));
  try {
    compileEpisode(join(out, "bolum.json"), lib, out, { episode: episode() });
    assert.match(readFileSync(join(out, "index.html"), "utf8"), /"actions":\[\{"action":"egil-al-cocuk","at":2\}\]/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("a prop that a character standing back picks up lies at that depth too (no jump at the grab)", () => {
  const ep = episode({ back: 1 });
  const layer = propLayer(buildTimeline(ep, () => ({ duration: 1 })), ep, lib, VIEWPORTS["16:9"]);
  const d = C.depthOf({ back: 1 }, C.layoutFor(lib.world, VIEWPORTS["16:9"]));
  const markup = layer.ground.find((g) => g.includes('id="prop-s1_sh1-sise-yer"'));
  assert.ok(markup.includes(` ${lib.world.ground_y - d.rise}) scale(${d.shrink.toFixed(4)})`), markup.slice(0, 120));
  const front = propLayer(buildTimeline(episode(), () => ({ duration: 1 })), episode(), lib, VIEWPORTS["16:9"]);
  const frontMarkup = front.ground.find((g) => g.includes("sise-yer"));
  assert.ok(frontMarkup.includes(` ${lib.world.ground_y}) scale(1.0000)`), frontMarkup.slice(0, 120));
});

test("a later action started past its grab holds the prop from its own start; the first one from the shot start", async () => {
  const { grabTime } = await import("../src/compile.mjs");
  const g = lib.actions.get("egil-al-cocuk").grab.t;
  assert.equal(grabTime({ action: "yuru-cocuk", actions: [{ action: "egil-al-cocuk", at: 2, from: g + 0.5 }] }, lib), 2);
  assert.ok(grabTime({ action: "egil-al-cocuk", from: g + 0.5 }, lib) < 0); // already in hand when the shot starts
  // the next action starts before the grab: no grab in this shot
  assert.equal(grabTime({ action: "yuru-cocuk", actions: [{ action: "egil-al-cocuk", at: 2 }, { action: "bak", at: 2.5 }] }, lib), null);
  assert.deepEqual(C.segmentAt({ action: "a", actions: [{ action: "b", at: 2 }] }, 2).action, "b");
});

test("a walk without a time (the whole shot) keeps the timeline in numbers, for this shot and the next", () => {
  // Hurda Kralı 3: walk {dx, arrive} with no time made every later shot start at null,
  // and the scene stills came out black.
  const ep = episode({ walk: { dx: 288 }, actions: [] });
  ep.scenes[0].shots.push({ ...ep.scenes[0].shots[0], shot_id: "s1_sh2", cast: [{ id: "ela", action: "bekle-cocuk", mark: "orta" }], props: [] });
  const timeline = buildTimeline(ep, () => ({ duration: 1 }));
  for (const s of timeline.shots) {
    assert.ok(Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start, `${s.shot_id}: ${s.start}-${s.end}`);
  }
  assert.ok(Number.isFinite(timeline.duration));
});

test("a shot whose length is not a number stops the timeline with its id instead of black stills", () => {
  const ep = episode({ actions: [{ action: "egil-al-cocuk", at: Number.NaN }] });
  assert.throws(() => buildTimeline(ep, () => ({ duration: 1 })), /shot s1_sh1/);
});
