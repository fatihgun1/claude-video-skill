/* Knee legs, back body layer, props, face-anchored framing, silent episodes. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadLibrary, checkProp, checkAction } from "../src/library.mjs";
import { checkRig } from "../src/rigspec.mjs";
import { validateEpisode } from "../src/validate.mjs";
import { compileEpisode, propLayer, facesOf } from "../src/compile.mjs";
import { buildTimeline } from "../src/timing.mjs";
import { approve, scriptFingerprint, libraryFingerprint } from "../src/onay.mjs";
import { runAudio } from "../src/ses.mjs";
import "../src/runtime/core.js";

const LIB_DIR = fileURLToPath(new URL("../../library", import.meta.url));
const lib = loadLibrary(LIB_DIR);
const C = globalThis.CizgiCore;
const genc = readFileSync(join(LIB_DIR, "characters", "genc", "rig.svg"), "utf8");
const bottle = readFileSync(join(LIB_DIR, "props", "plastik-sise.svg"), "utf8");

function episode(shotOverrides = {}) {
  return {
    episode: "sokak",
    language: "tr",
    characters: [{ id: "genc", rig: "genc" }],
    scenes: [{
      scene_id: "s1",
      bg: "sokak",
      shots: [
        {
          shot_id: "a",
          cast: [{ id: "genc", action: "egil-al", mark: "sol" }],
          props: [{ id: "sise", prop: "plastik-sise", mark: "sol", dx: 178, holder: "genc" }],
          camera: { framing: "wide" },
          hold: 3.6,
          ...shotOverrides,
        },
        {
          shot_id: "b",
          cast: [{ id: "genc", action: "bak", mark: "sol" }],
          props: [{ id: "sise", prop: "plastik-sise", mark: "sol", holder: "genc" }],
          camera: { framing: "medium", target: "genc" },
        },
      ],
    }],
  };
}

test("the profile rig with knee legs and a back layer passes the spec", () => {
  assert.deepEqual(checkRig(genc), []);
});

test("knee legs need a foot inside them; the back layer must sit on root", () => {
  const noFoot = genc.replace('<g id="foot_L" data-pivot="514,902">', '<g id="ayak_L">');
  assert.ok(checkRig(noFoot).some((e) => e.includes("missing group #foot_L")));
  const badHose = genc.replace('data-hose="512,530 522,728 514,902"', 'data-hose="512,530"');
  assert.ok(checkRig(badHose).some((e) => e.includes("#leg_L needs data-hose")));
  const nested = genc.replace('<g id="root">\n    <g id="body_back" data-pivot="506,525">', '<g id="root"><g id="kap">\n    <g id="body_back" data-pivot="506,525">').replace("</svg>", "").trimEnd().replace(/<\/g>$/, "</g></g>") + "\n</svg>";
  assert.ok(checkRig(nested).some((e) => e.includes("#body_back must be a direct child of #root")));
});

test("checkProp needs both anchors and safe markup", () => {
  assert.deepEqual(checkProp(bottle), { errors: [], grip: [20, 58], base: [20, 98] });
  const noGrip = checkProp(bottle.replace(' data-grip="20,58"', ""));
  assert.ok(noGrip.errors.some((e) => e.includes("data-grip")));
  assert.equal(noGrip.grip, null);
  assert.ok(checkProp(bottle.replace("</svg>", "<script/></svg>")).errors.some((e) => e.includes("<script>")));
});

test("an action's grab time must fall inside it", () => {
  const ok = { duration: 2, keys: [{ t: 0, pose: {} }], grab: { t: 1 } };
  assert.deepEqual(checkAction(ok, "x"), []);
  assert.ok(checkAction({ ...ok, grab: { t: 3 } }, "x").some((e) => e.includes("grab.t")));
  assert.ok(checkAction({ ...ok, grab: {} }, "x").some((e) => e.includes("grab.t")));
});

test("props are validated against the library and the shot's cast", () => {
  assert.deepEqual(validateEpisode(episode(), lib).errors, []);
  const bad = episode({
    props: [
      { id: "sise", prop: "teneke", mark: "sol" },
      { id: "sise", prop: "plastik-sise", mark: "sol", holder: "kedi" },
      { id: "x", prop: "plastik-sise", mark: "sol", hand: "R" },
    ],
  });
  const joined = validateEpisode(bad, lib).errors.join("\n");
  for (const s of ['prop "teneke"', 'prop id "sise" is used twice', 'holder "kedi"', 'prop "x" has a hand but no holder']) {
    assert.ok(joined.includes(s), s);
  }
});

test("propLayer: ground copy in the world, held copy in the holder's hand, grab time from the action", () => {
  const ep = episode();
  const timeline = buildTimeline(ep, () => ({ duration: 0 }));
  const { ground, held, data } = propLayer(timeline, ep, lib, { width: 1920, height: 1080 });
  const x = lib.world.marks.sol + 178;
  assert.ok(ground[0].includes(`id="prop-a-sise-yer"`) && ground[0].includes(`translate(${x.toFixed(1)} ${lib.world.ground_y})`));
  assert.equal(held.get("genc").length, 2);
  assert.ok(held.get("genc")[0].markup.includes("translate(530 583) rotate(90)"), "uses the hand's data-grip and holds the bottle across the palm");
  assert.deepEqual(data, [[{ key: "a-sise", holder: "genc", grab: 0.9 }], [{ key: "b-sise", holder: "genc", grab: null }]]);
  const portrait = propLayer(timeline, ep, lib, { width: 1080, height: 1920 });
  assert.ok(portrait.ground[0].includes("scale(0.7500)"), "props shrink with characters in portrait");
  const loose = { ...ep, scenes: [{ ...ep.scenes[0], shots: [{ ...ep.scenes[0].shots[0], props: [{ id: "s", prop: "plastik-sise", mark: "orta" }] }] }] };
  const free = propLayer(buildTimeline(loose, () => ({ duration: 0 })), loose, lib, { width: 1920, height: 1080 });
  assert.deepEqual(free.data[0], [{ key: "a-s", holder: null, grab: null }]);
});

test("compiled page puts the held prop first inside the hand group", () => {
  const dir = mkdtempSync(join(tmpdir(), "cizgi-f3-"));
  writeFileSync(join(dir, "bolum.json"), JSON.stringify(episode()));
  compileEpisode(join(dir, "bolum.json"), lib, join(dir, "p"));
  const html = readFileSync(join(dir, "p", "index.html"), "utf8");
  assert.match(html, /<g id="genc--hand_L_slot"\/><g id="prop-[ab]-sise-el" display="none"/, "the prop sits in the hand slot, between palm and fingers");
  const hand = html.slice(html.indexOf('id="genc--hand_L"'), html.indexOf('id="genc--hand_L"') + 4000);
  assert.ok(hand.includes('id="prop-a-sise-el"') && hand.includes('id="prop-b-sise-el"'), "both shots' copies sit in the hand");
  assert.ok(html.includes('id="prop-a-sise-yer"'));
  assert.ok(html.includes('"faces":{"genc":125}'));
});

test("framings anchored to the face follow tall and short characters", () => {
  const vp = { width: 1920, height: 1080 };
  const shot = { cast: [{ id: "genc", mark: "orta" }], camera: { framing: "close", target: "genc" } };
  const faceWorld = lib.world.ground_y - (950 - 125) * (lib.world.character_height / 900);
  const close = C.shotCamera(shot, 0, lib.world, lib.cameras, vp, { genc: 125 });
  const halfH = 1080 / close.zoom / 2;
  assert.ok(Math.abs(close.cy - Math.max(faceWorld, halfH)) < 1e-6);
  const medium = C.shotCamera({ ...shot, camera: { framing: "medium", target: "genc" } }, 0, lib.world, lib.cameras, vp, { genc: 125 });
  assert.ok(Math.abs(medium.cy - (faceWorld + lib.world.ground_y) / 2) < 1e-6);
  const bear = C.shotCamera({ ...shot, camera: { framing: "medium" } }, 0, lib.world, lib.cameras, vp, {});
  assert.ok(bear.cy > medium.cy, "a short character's medium shot looks lower");
  assert.deepEqual(facesOf({ characters: [{ id: "a", rig: "genc" }, { id: "b", rig: "test-ayi" }] }, lib), { a: 125, b: 405 });
});

test("a silent episode needs no audio tools", () => {
  const dir = mkdtempSync(join(tmpdir(), "cizgi-f3s-"));
  const path = join(dir, "bolum.json");
  const ep = episode();
  writeFileSync(path, JSON.stringify(ep));
  approve(path, "senaryo", scriptFingerprint(ep));
  const res = runAudio(path, lib, { ffmpeg: "ffmpeg", configPath: "none" }, { run: () => assert.fail("nothing should run") });
  assert.deepEqual(res, { generated: [], kept: [], failed: [] });
});

test("changing a prop drawing invalidates the storyboard approval", () => {
  const ep = episode();
  const base = libraryFingerprint(ep, lib);
  const props = new Map(lib.props);
  props.set("plastik-sise", { ...props.get("plastik-sise"), svg: bottle.replace("#3b82c4", "#ff0000") });
  assert.notEqual(libraryFingerprint(ep, { ...lib, props }), base);
});

test("anatomy: a pose beyond the rig's joint limits is an error", () => {
  const actions = new Map(lib.actions);
  actions.set("kanat", { duration: 1, keys: [{ t: 0, pose: { arm_L_upper: 28, arm_L_lower: -128 } }] });
  const ep = { episode: "a", language: "tr", characters: [{ id: "g", rig: "genc-on" }], scenes: [{ scene_id: "s", bg: "sokak", shots: [{ shot_id: "x", cast: [{ id: "g", action: "kanat", mark: "orta" }], camera: { framing: "wide" } }] }] };
  const res = validateEpisode(ep, { ...lib, actions });
  assert.equal(res.ok, false);
  assert.ok(res.errors.join().includes("bends arm_L_upper to 28°"));
  ep.characters[0].rig = "test-ayi"; // no limits declared
  assert.equal(validateEpisode(ep, { ...lib, actions }).ok, true);
});

test("film: a back or front view must not walk sideways", () => {
  const ep = { episode: "a", language: "tr", characters: [{ id: "g", rig: "genc-arka" }], scenes: [{ scene_id: "s", bg: "sokak", shots: [{ shot_id: "x", cast: [{ id: "g", action: "yuru-arka", mark: "sol", walk: { dx: 300 } }], camera: { framing: "wide" } }] }] };
  assert.ok(validateEpisode(ep, lib).warnings.some((w) => w.includes("walks sideways")));
  ep.characters[0].rig = "genc";
  ep.scenes[0].shots[0].cast[0].action = "yuru";
  assert.ok(!validateEpisode(ep, lib).warnings.some((w) => w.includes("walks sideways")));
});

test("depth props live inside the background and need a mark or depth", () => {
  const ep = {
    episode: "a", language: "tr", characters: [{ id: "g", rig: "genc-arka" }],
    scenes: [{ scene_id: "s", bg: "sokak-derinlik", shots: [{ shot_id: "x", cast: [{ id: "g", action: "yuru-arka", mark: "orta" }],
      props: [{ id: "sise", prop: "plastik-sise", depth: { x: 1100, y: 630, scale: 0.4 } }], camera: { framing: "medium", move: "dolly_ileri" } }] }],
  };
  assert.deepEqual(validateEpisode(ep, lib).errors, []);
  const dir = mkdtempSync(join(tmpdir(), "cizgi-depth-"));
  writeFileSync(join(dir, "bolum.json"), JSON.stringify(ep));
  compileEpisode(join(dir, "bolum.json"), lib, join(dir, "p"));
  const html = readFileSync(join(dir, "p", "index.html"), "utf8");
  const bg = html.slice(html.indexOf('<g id="bg-sokak-derinlik">'), html.indexOf('<g id="kar-g"'));
  assert.ok(bg.includes('id="prop-x-sise-yer"'), "the prop is inside the background group");
  assert.ok(html.includes('"vanishing":{"sokak-derinlik":[1150,470]}'));
  const bad = structuredClone(ep);
  bad.scenes[0].shots[0].props = [{ id: "s", prop: "plastik-sise" }, { id: "t", prop: "plastik-sise", depth: { x: 1, y: 1, scale: 1 }, holder: "g" }];
  const errs = validateEpisode(bad, lib).errors.join("\n");
  assert.ok(errs.includes("needs a mark or a depth") && errs.includes("cannot be held"));
});
