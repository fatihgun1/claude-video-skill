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

test("checkProp needs a base and safe markup; a grip only for props that are held", () => {
  assert.deepEqual(checkProp(bottle), { errors: [], grip: [20, 58], base: [20, 98] });
  // no grip: still a prop (decor such as a tree), just one nobody can hold (validate refuses a holder)
  const noGrip = checkProp(bottle.replace(' data-grip="20,58"', ""));
  assert.deepEqual(noGrip.errors, []);
  assert.equal(noGrip.grip, null);
  assert.ok(checkProp(bottle.replace(' data-base="20,98"', "")).errors.some((e) => e.includes("data-base")));
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
  assert.deepEqual(data, [[{ key: "a-sise", holder: "genc", grab: 0.9, release: null }], [{ key: "b-sise", holder: "genc", grab: null, release: null }]]);
  const portrait = propLayer(timeline, ep, lib, { width: 1080, height: 1920 });
  assert.ok(portrait.ground[0].includes("scale(0.7500)"), "props shrink with characters in portrait");
  const loose = { ...ep, scenes: [{ ...ep.scenes[0], shots: [{ ...ep.scenes[0].shots[0], props: [{ id: "s", prop: "plastik-sise", mark: "orta" }] }] }] };
  const free = propLayer(buildTimeline(loose, () => ({ duration: 0 })), loose, lib, { width: 1920, height: 1080 });
  assert.deepEqual(free.data[0], [{ key: "a-s", holder: null, grab: null, release: null }]);
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
  const top = close.cy - 1080 / close.zoom / 2;
  const bottom = close.cy + 1080 / close.zoom / 2;
  assert.ok(faceWorld > top && faceWorld < top + (bottom - top) * 0.45, "the face in the upper part of a close-up");
  assert.ok(bottom < lib.world.ground_y - 0.4 * (lib.world.ground_y - faceWorld), "a close-up does not reach the knees");
  const medium = C.shotCamera({ ...shot, camera: { framing: "medium", target: "genc" } }, 0, lib.world, lib.cameras, vp, { genc: 125 });
  assert.ok(medium.zoom < close.zoom, "a medium shot shows more of the person");
  const bear = C.shotCamera({ ...shot, camera: { framing: "medium" } }, 0, lib.world, lib.cameras, vp, {});
  assert.ok(bear.cy > medium.cy, "a short character's medium shot looks lower");
  assert.deepEqual(facesOf({ characters: [{ id: "a", rig: "genc" }, { id: "b", rig: "pamuk" }] }, lib), { a: 125, b: 568 });
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
  ep.characters[0].rig = "pamuk"; // a front view: the elbow may not bend back to -128
  const front = validateEpisode(ep, { ...lib, actions });
  assert.equal(front.ok, false);
  assert.ok(front.errors.join().includes("bends arm_L_lower to -128°"));
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

test("propLayer: the camera looks at a held prop in the holder's hand, not where it lay on the floor", () => {
  const ep = episode();
  const timeline = buildTimeline(ep, () => ({ duration: 0 }));
  const { anchors } = propLayer(timeline, ep, lib, { width: 1920, height: 1080 });
  const scale = lib.world.character_height / 900;
  const handY = lib.world.ground_y - (950 - 583) * scale; // genc's hand_L data-grip y
  for (const a of anchors) {
    assert.equal(a.sise[0], lib.world.marks.sol, "over the holder, not at the floor spot (sol + 178)");
    assert.ok(Math.abs(a.sise[1] - handY) < 1e-6, "at hand height");
  }
  const loose = { ...ep, scenes: [{ ...ep.scenes[0], shots: [{ ...ep.scenes[0].shots[0], props: [{ id: "s", prop: "plastik-sise", mark: "orta" }] }] }] };
  const free = propLayer(buildTimeline(loose, () => ({ duration: 0 })), loose, lib, { width: 1920, height: 1080 });
  assert.equal(free.anchors[0].s[0], lib.world.marks.orta, "a prop nobody holds: still its floor spot");
});

test("propLayer: a prop put away (an action's release) leaves the hand at that moment", () => {
  // Hurda Kralı 1: the bottle Kadir picked up vanished at the next cut; it never went into his bag
  const actions = new Map(lib.actions);
  actions.set("cantaya-koy", { duration: 1.6, release: { t: 0.9 }, keys: [{ t: 0, pose: {} }, { t: 1.6, pose: {} }] });
  const withPut = { ...lib, actions };
  const ep = episode({ cast: [{ id: "genc", action: "egil-al", mark: "sol", actions: [{ action: "cantaya-koy", at: 3.2 }] }] });
  const { data } = propLayer(buildTimeline(ep, () => ({ duration: 0 })), ep, withPut, { width: 1920, height: 1080 });
  assert.equal(data[0][0].grab, 0.9, "picked up by egil-al");
  assert.ok(Math.abs(data[0][0].release - 4.1) < 1e-9, "put away 0.9 s into cantaya-koy, which starts at 3.2");
  assert.equal(propLayer(buildTimeline(episode(), () => ({ duration: 0 })), episode(), lib, { width: 1920, height: 1080 }).data[0][0].release, null);
});

test("propLayer: in 9:16 a prop's dx shrinks like a person's, so a prop given its holder's dx lies at the holder", () => {
  // the camera audit: in 9:16 a prop with the holder's dx lay 0.4·dx away (157 units in Hurda Kralı 2 s2_sh4)
  const C = globalThis.CizgiCore;
  const vp = { width: 1080, height: 1920 };
  const layout = C.layoutFor(lib.world, vp);
  const ep = episode({
    cast: [{ id: "genc", action: "bak", mark: "orta", dx: 300 }],
    props: [{ id: "sise", prop: "plastik-sise", mark: "orta", dx: 300 }],
  });
  const { ground } = propLayer(buildTimeline(ep, () => ({ duration: 0 })), ep, lib, vp);
  const x = Number(/id="prop-a-sise-yer"[^>]*?translate\(([-\d.]+) /.exec(ground.join(""))[1]);
  assert.ok(Math.abs(x - C.memberX(ep.scenes[0].shots[0].cast[0], layout, 0, 1)) < 1, `${x} vs the holder`);
});

test("propLayer: a prop taken out of a bag (gizli) has no copy on the ground", () => {
  // Hurda Kralı 2: copies were parked off frame (sag +600) to be "picked up" from the bag
  const ep = episode({ props: [{ id: "sise", prop: "plastik-sise", mark: "sol", holder: "genc", gizli: true }] });
  const { ground, data } = propLayer(buildTimeline(ep, () => ({ duration: 0 })), ep, lib, { width: 1920, height: 1080 });
  assert.ok(!ground.some((g) => g.includes('id="prop-a-sise-yer"')), "nothing on the ground");
  assert.equal(data[0][0].grab, 0.9, "still in the hand from the grab on");
  assert.equal(validateEpisode(ep, lib).errors.length, 0, validateEpisode(ep, lib).errors.join("; "));
});

test("propLayer: a prop set down (put_down) lies where it was put, not gone", () => {
  // Hurda Kralı 2: the bottle put on the scale vanished (release only puts away)
  const actions = new Map(lib.actions);
  actions.set("birak", { duration: 2, put_down: { t: 1.2 }, keys: [{ t: 0, pose: {} }, { t: 2, pose: {} }] });
  const withPut = { ...lib, actions };
  const ep = episode({
    cast: [{ id: "genc", action: "birak", mark: "sol" }],
    props: [{ id: "sise", prop: "plastik-sise", mark: "sol", holder: "genc", sonra: { mark: "orta", dx: 40 } }],
  });
  const { data, ground } = propLayer(buildTimeline(ep, () => ({ duration: 0 })), ep, withPut, { width: 1920, height: 1080 });
  assert.equal(data[0][0].put, 1.2);
  const after = ground.find((g) => g.includes('id="prop-a-sise-sonra"'));
  assert.ok(after, "a copy on the ground where it was put");
  assert.match(after, new RegExp(`translate\\(${lib.world.marks.orta + 40}\\.0 `));
  assert.equal(validateEpisode(ep, withPut).errors.length, 0, validateEpisode(ep, withPut).errors.join("; "));
});

test("propLayer: a prop handed over (to) is in one hand at a time: the giver's until release, then the taker's", () => {
  // Hurda Kralı 2: the same note was in both hands at once (two props, para and para_k)
  const actions = new Map(lib.actions);
  actions.set("uzat", { duration: 2, release: { t: 1.25 }, keys: [{ t: 0, pose: {} }, { t: 2, pose: {} }] });
  const two = { ...lib, actions };
  const ep = episode({
    cast: [{ id: "genc", action: "uzat", mark: "sol" }, { id: "kiz", action: "bak", mark: "sag" }],
    props: [{ id: "para", prop: "plastik-sise", mark: "sol", holder: "genc", to: "kiz" }],
  });
  ep.characters.push({ id: "kiz", rig: "genc" });
  const { data, held } = propLayer(buildTimeline(ep, () => ({ duration: 0 })), ep, two, { width: 1920, height: 1080 });
  assert.equal(data[0][0].release, 1.25);
  assert.equal(data[0][0].to, "kiz");
  assert.ok((held.get("kiz") || []).some((h) => h.markup.includes('id="prop-a-para-al"')), "a copy in the taker's hand");
  const bad = structuredClone(ep);
  bad.scenes[0].shots[0].props[0].to = "yok";
  assert.match(validateEpisode(bad, two).errors.join("\n"), /handed to "yok", who is not in this shot's cast/);
});

test("propLayer: a close insert of a pick-up looks where the hand closes on the prop, not at the bent back", () => {
  // Hurda Kralı 1 s2_sh3: a detail shot of the bottle being picked up showed the man's back, the bottle off frame
  for (const framing of ["detay", "close"]) {
    const ep = episode({ camera: { framing, target: "sise" } });
    const { anchors } = propLayer(buildTimeline(ep, () => ({ duration: 0 })), ep, lib, { width: 1920, height: 1080 });
    assert.equal(anchors[0].sise[0], lib.world.marks.sol + 178, `${framing}: at the floor spot (sol + 178)`);
  }
  // picked up before the shot starts (from past the grab): it is in the hand, the camera looks there
  const late = episode({ camera: { framing: "detay", target: "sise" }, cast: [{ id: "genc", action: "egil-al", mark: "sol", from: 2 }] });
  const held = propLayer(buildTimeline(late, () => ({ duration: 0 })), late, lib, { width: 1920, height: 1080 });
  assert.equal(held.anchors[0].sise[0], lib.world.marks.sol);
});

test("a change of scene dips to black and back; a hard cut and the film's first frame stay clear", () => {
  const shots = [
    { scene_id: "s1", start: 0, end: 3 },
    { scene_id: "s1", start: 3, end: 5 },
    { scene_id: "s2", start: 5, end: 8 },
    { scene_id: "s3", start: 8, end: 10, gecis: "kesme" },
  ];
  const a = (t) => C.transitionAlpha(shots, t);
  assert.equal(a(0), 0, "the first frame (the panel opens on it) is clear");
  assert.equal(a(3), 0, "no dip inside a scene");
  assert.equal(a(5), 1, "black at the change of scene");
  assert.ok(a(4.85) > 0 && a(4.85) < 1 && a(5.15) > 0 && a(5.15) < 1, "out and back in around it");
  assert.ok(a(5 + C.TRANSITION_HALF) < 1e-9, "clear again after the dip");
  assert.equal(a(8), 0, "gecis kesme: a hard cut");
  assert.equal(a(10), 0);
});

test("the compiled page has the fade layer above the world, and a scene's gecis reaches the player", () => {
  const dir = mkdtempSync(join(tmpdir(), "cizgi-gecis-"));
  const ep = episode();
  ep.scenes.push({ scene_id: "s2", bg: "sokak", gecis: "kesme", shots: [{ shot_id: "c", cast: [{ id: "genc", action: "bak", mark: "sol" }], camera: { framing: "wide" } }] });
  writeFileSync(join(dir, "bolum.json"), JSON.stringify(ep));
  compileEpisode(join(dir, "bolum.json"), lib, join(dir, "p"));
  const html = readFileSync(join(dir, "p", "index.html"), "utf8");
  assert.match(html, /<\/g>\s*<\/g>\s*<rect id="gecis"[^>]*fill="#000" opacity="0"/);
  assert.ok(html.includes('"gecis":"kesme"'));
});
