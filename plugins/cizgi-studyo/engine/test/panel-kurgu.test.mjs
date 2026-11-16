import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadLibrary } from "../src/library.mjs";
import { validateEpisode } from "../src/validate.mjs";
import { vocabulary } from "../src/panel-kutuphane.mjs";
import { buildTimeline, TIMING } from "../src/timing.mjs";
import {
  nextShotId, standingAction, addShotAfter, duplicateShot, deleteShot, moveShot, createHistory,
  shotLength, minShotLength, holdForLength, sfxAtAfterDrag, reorderAt, delayFirstSegment, MAX_HOLD,
} from "../src/panel/kurgu.js";

const RULES = { lead: TIMING.lead, tail: TIMING.tail, min_shot: TIMING.min_shot, default_hold: TIMING.default_hold };

test("a shot's length from its hold matches the engine's timeline", () => {
  const shots = [
    { shot_id: "a", hold: 2, utterances: [{ speaker: "x", text: "bir" }, { speaker: "x", text: "iki" }] },
    { shot_id: "b", utterances: [] },
    { shot_id: "c", hold: 0 },
  ];
  const timeline = buildTimeline({ scenes: [{ scene_id: "s", shots }] }, () => ({ duration: 1.3 }), TIMING);
  for (const t of timeline.shots) {
    const speechEnd = t.utterances.length ? t.utterances.at(-1).end : t.start + TIMING.lead;
    const len = shotLength({ start: t.start, speech_end: speechEnd }, shots.find((s) => s.shot_id === t.shot_id), RULES);
    assert.ok(Math.abs(len - (t.end - t.start)) < 1e-6, `${t.shot_id}: ${len} vs ${t.end - t.start}`);
  }
});

test("dragging the edge never cuts into the lines or past an effect, and holds stay in range", () => {
  const speech = 3;
  assert.equal(minShotLength(speech, RULES), speech + RULES.tail);
  assert.equal(minShotLength(0, RULES), RULES.min_shot);
  assert.equal(minShotLength(1, RULES, [{ at: 4.2 }, { at: 0.5 }]), 4.25);
  assert.equal(holdForLength(speech + RULES.tail + 1.234, speech, RULES), 1.25);
  assert.equal(holdForLength(speech, speech, RULES), 0);
  assert.equal(holdForLength(speech + 50, speech, RULES), MAX_HOLD);
});

test("a dragged effect snaps, and always starts inside its shot", () => {
  assert.equal(sfxAtAfterDrag(1, 0.52, 5), 1.5);
  assert.equal(sfxAtAfterDrag(1, -9, 5), 0);
  for (const len of [3.68, 3.66, 0.6, 2.05, 7.123]) {
    const at = sfxAtAfterDrag(0, 99, len);
    assert.ok(at < len && at >= 0, `${len} → ${at}`);
    assert.ok(len - at < 0.11, `${len} → ${at} stays near the end`);
  }
});

test("a dragged shot lands where the pointer is: between the two shots around it", () => {
  const sib = [{ start: 0, len: 2 }, { start: 2, len: 4 }, { start: 6, len: 1 }];
  // the last shot: left of the first one's middle goes first, past it second
  assert.deepEqual(reorderAt(sib, 2, 0.5), { index: 0, at: 0 });
  assert.deepEqual(reorderAt(sib, 2, 1.5), { index: 1, at: 2 });
  assert.deepEqual(reorderAt(sib, 2, 4.5), { index: 2, at: 6 }); // where it already is
  // the first shot: a short drag into the next one's first half keeps it in place, past the middle moves it
  assert.equal(reorderAt(sib, 0, 3.9).index, 0);
  assert.deepEqual(reorderAt(sib, 0, 4.1), { index: 1, at: 6 });
  assert.deepEqual(reorderAt(sib, 0, 99), { index: 2, at: 7 });
});

test("delaying the first action: a standing action fills the time before it", () => {
  const isLoop = (id) => id === "bekle" || id === "yuru";
  const m = { id: "pamuk", action: "selam", from: 0.3, mark: "orta" };
  assert.equal(delayFirstSegment(m, 1.23, 6, "bekle", isLoop), true);
  assert.deepEqual(m, { id: "pamuk", action: "bekle", mark: "orta", actions: [{ action: "selam", at: 1.25, from: 0.3 }] });
  // never past the next action's start
  const two = { action: "alkis", actions: [{ action: "zipla", at: 2 }] };
  assert.equal(delayFirstSegment(two, 5, 6, "bekle", isLoop), true);
  assert.deepEqual(two.actions.map((a) => [a.action, a.at]), [["alkis", 1.95], ["zipla", 2]]);
  // refused: too close to the start, already standing, or a walk (it starts with the shot)
  const keep = { action: "selam" };
  assert.equal(delayFirstSegment(keep, 0.01, 6, "bekle", isLoop), false);
  assert.deepEqual(keep, { action: "selam" });
  assert.equal(delayFirstSegment({ action: "bekle" }, 2, 6, "bekle", isLoop), false);
  const walker = { action: "yuru", walk: { dx: 300 } };
  assert.equal(delayFirstSegment(walker, 2, 6, "bekle", isLoop), false);
  assert.equal(walker.action, "yuru");
});

const LIB_DIR = fileURLToPath(new URL("../../library", import.meta.url));
const SOKAK = fileURLToPath(new URL("../../../../ornekler/sokak/bolum.json", import.meta.url));
const lib = loadLibrary(LIB_DIR);
const vocab = vocabulary(lib);
const sokak = () => JSON.parse(readFileSync(SOKAK, "utf8"));
const ids = (scene) => scene.shots.map((s) => s.shot_id);
const viewOf = (ep) => (id) => lib.characters.get(ep.characters.find((c) => c.id === id).rig).meta.view || "front";

test("a new shot id is never one already used in the episode", () => {
  const ep = sokak();
  const scene = ep.scenes[1];
  const id = nextShotId(ep, scene);
  assert.ok(!ep.scenes.flatMap((s) => s.shots).some((s) => s.shot_id === id));
  assert.match(id, new RegExp(`^${scene.scene_id}_sh\\d+$`));
});

test("an added shot keeps the people and places, stands them still, and stays valid", () => {
  const ep = sokak();
  const scene = ep.scenes[1];
  const after = scene.shots[0];
  const shot = addShotAfter(ep, scene, after, vocab, viewOf(ep));
  assert.equal(scene.shots[1], shot);
  assert.deepEqual(shot.cast.map((m) => [m.id, m.mark]), after.cast.map((m) => [m.id, m.mark]));
  assert.equal(shot.utterances, undefined);
  assert.equal(shot.camera.framing, "wide");
  const v = validateEpisode(ep, lib);
  assert.deepEqual(v.errors, []);
  // The standing action suits each rig's view (no view warning for the new shot).
  assert.ok(!v.warnings.some((w) => w.includes(shot.shot_id) && /views/.test(w)), v.warnings.join("\n"));
});

test("a standing action is picked for the rig's view, or the old one is kept", () => {
  const actions = [{ id: "bekle", views: ["front"] }, { id: "bekle-yan", views: ["profile-right"] }, { id: "yuru", views: null }];
  assert.equal(standingAction({ actions }, "front", "x"), "bekle");
  assert.equal(standingAction({ actions }, "profile-right", "x"), "bekle-yan");
  assert.equal(standingAction({ actions }, "back-three-quarter-right", "x"), "x");
});

test("a duplicated shot comes right after it, without the lines", () => {
  const ep = sokak();
  const scene = ep.scenes[1];
  const src = scene.shots[2];
  src.utterances = [{ speaker: src.cast[0].id, text: "Deneme." }];
  const copy = duplicateShot(ep, scene, src);
  assert.equal(scene.shots[3], copy);
  assert.notEqual(copy.shot_id, src.shot_id);
  assert.equal(copy.utterances, undefined);
  assert.deepEqual(copy.cast, src.cast);
  assert.notEqual(copy.cast, src.cast); // a deep copy: editing one does not edit the other
});

test("deleting keeps at least one shot in a scene and picks the neighbour", () => {
  const ep = sokak();
  assert.equal(deleteShot(ep.scenes[0], ep.scenes[0].shots[0]), null);
  assert.equal(ep.scenes[0].shots.length, 1);
  const scene = ep.scenes[1];
  const [a, b, c] = ids(scene);
  assert.equal(deleteShot(scene, scene.shots[1]), c);
  assert.deepEqual(ids(scene).slice(0, 2), [a, c]);
  const last = scene.shots.at(-1);
  const beforeLast = scene.shots.at(-2).shot_id;
  assert.equal(deleteShot(scene, last), beforeLast);
  assert.ok(!ids(scene).includes(b));
});

test("a shot moves within its scene", () => {
  const ep = sokak();
  const scene = ep.scenes[1];
  const before = ids(scene);
  assert.equal(moveShot(scene, before[3], 0), true);
  assert.deepEqual(ids(scene), [before[3], before[0], before[1], before[2]]);
  assert.equal(moveShot(scene, before[3], 0), false); // already there
  assert.equal(moveShot(scene, "yok", 1), false);
  assert.equal(moveShot(scene, before[3], 99), true); // clamped to the end
  assert.deepEqual(ids(scene), before);
});

test("history steps back and forward, and a new edit drops the redo branch", () => {
  const h = createHistory(3);
  h.reset("a");
  assert.equal(h.canUndo(), false);
  assert.equal(h.record("a"), false); // no change, no step
  h.record("b");
  h.record("c");
  assert.equal(h.undo(), "b");
  assert.equal(h.undo(), "a");
  assert.equal(h.undo(), null);
  assert.equal(h.redo(), "b");
  h.record("d");
  assert.equal(h.canRedo(), false);
  assert.equal(h.undo(), "b");
  h.record("e");
  h.record("f");
  h.record("g"); // limit 3: the oldest steps fall off
  assert.equal(h.undo(), "f");
  assert.equal(h.undo(), "e");
  assert.equal(h.undo(), "b");
  assert.equal(h.undo(), null);
});

test("dropping someone on the stage snaps to a free mark, or keeps the offset from the nearest free one", async () => {
  const { placeAt, walkDxAfterDrag } = await import("../src/panel/kurgu.js");
  const marks = { sol: 560, orta: 960, sag: 1360 };
  assert.deepEqual(placeAt(975, marks, new Set()), { mark: "orta", dx: 0 }); // within the snap distance
  assert.deepEqual(placeAt(1100, marks, new Set()), { mark: "orta", dx: 140 });
  assert.deepEqual(placeAt(1100, marks, new Set(["orta"])), { mark: "sag", dx: -260 }); // orta is taken
  assert.deepEqual(placeAt(1100, { sol: 820, orta: 960, sag: 1100 }, new Set(), 0.75), { mark: "sag", dx: 0 });
  assert.deepEqual(placeAt(1000, { sol: 820, orta: 960, sag: 1100 }, new Set(["orta"]), 0.75), { mark: "sag", dx: -133 });
  assert.equal(placeAt(10, marks, new Set(["sol", "orta", "sag"])), null);
  assert.deepEqual(placeAt(-5000, marks, new Set()), { mark: "sol", dx: -900 }); // schema limit
  // A walk's free end, dragged: the distance from where the walk is anchored.
  assert.equal(walkDxAfterDrag(700, 960, 1), -260);
  assert.equal(walkDxAfterDrag(9000, 960, 1), 1500);
  assert.equal(walkDxAfterDrag(1100, 960, 0.5), 280);
});

test("an action sequence on the actor track: spans, inserting, moving, replacing, removing", async () => {
  const K = await import("../src/panel/kurgu.js");
  const loop = new Set(["yuru-cocuk", "bekle"]);
  const isLoop = (id) => loop.has(id);
  const m = { id: "ela", action: "yuru-cocuk", mark: "sol", walk: { dx: 288, time: 2 }, actions: [{ action: "egil-al-cocuk", at: 2 }] };
  assert.deepEqual(K.segmentSpans(m, 6).map((s) => [s.index, s.action, s.start, s.end]), [[0, "yuru-cocuk", 0, 2], [1, "egil-al-cocuk", 2, 6]]);

  // a new action at the playhead goes in time order; on top of another start it is refused
  assert.equal(K.insertSegment(m, "bekle", 4.5, 6), 2);
  assert.deepEqual(m.actions.map((a) => [a.action, a.at]), [["egil-al-cocuk", 2], ["bekle", 4.5]]);
  assert.equal(K.insertSegment(m, "bekle", 2.02, 6), null);
  assert.equal(K.insertSegment(m, "bekle", 0, 6), null);
  assert.equal(K.insertSegment(m, "bekle", 6, 6), null);

  // moving the stop of a walk keeps walking speed: walk.time follows, dx scales with it
  K.moveSegmentStart(m, 1, 2.5, 6, isLoop);
  assert.equal(m.actions[0].at, 2.5);
  assert.deepEqual(m.walk, { dx: 360, time: 2.5 });
  // clamped between its neighbours
  K.moveSegmentStart(m, 1, 9, 6, isLoop);
  assert.equal(m.actions[0].at, 4.45);
  K.moveSegmentStart(m, 2, 1, 6, isLoop);
  assert.equal(m.actions[1].at, 4.5);
  K.moveSegmentStart(m, 2, 5.97, 6, isLoop);
  assert.equal(m.actions[1].at, 5.95);

  K.replaceSegmentAction(m, 0, "yuru");
  K.replaceSegmentAction(m, 2, "selam");
  assert.equal(m.action, "yuru");
  assert.equal(m.actions[1].action, "selam");

  assert.equal(K.removeSegment(m, 0), false); // the first action stays: it is the member's own
  assert.equal(K.removeSegment(m, 2), true);
  assert.equal(K.removeSegment(m, 1), true);
  assert.equal(m.actions, undefined);
});

test("which segment a playhead time falls in", async () => {
  const K = await import("../src/panel/kurgu.js");
  const m = { action: "a", actions: [{ action: "b", at: 2 }] };
  assert.equal(K.segmentIndexAt(m, 0.5), 0);
  assert.equal(K.segmentIndexAt(m, 2), 1);
  assert.equal(K.segmentIndexAt(m, 5), 1);
});

test("the walk keeps its speed whenever the stop changes: inserted, removed, replaced or moved", async () => {
  const K = await import("../src/panel/kurgu.js");
  const loops = new Set(["yuru-cocuk", "bekle"]);
  const isLoop = (id) => loops.has(id);
  // walks the whole 6 s shot (no walk.time): 120 units/s
  const m = { action: "yuru-cocuk", mark: "sol", walk: { dx: 720 } };
  K.insertSegment(m, "egil-al-cocuk", 2, 6, isLoop);
  assert.deepEqual(m.walk, { dx: 240, time: 2 });
  K.replaceSegmentAction(m, 1, "bekle", isLoop, 6); // a loop again: no stop, walk the whole shot
  assert.deepEqual(m.walk, { dx: 720 });
  K.replaceSegmentAction(m, 1, "egil-al-cocuk", isLoop, 6);
  assert.deepEqual(m.walk, { dx: 240, time: 2 });
  K.removeSegment(m, 1, isLoop, 6);
  assert.deepEqual(m.walk, { dx: 720 });
  // never past the schema's limit, and a zero time does not divide by zero
  const fast = { action: "yuru-cocuk", walk: { dx: 1400, time: 1 }, actions: [{ action: "egil-al-cocuk", at: 1 }] };
  K.moveSegmentStart(fast, 1, 1.5, 6, isLoop);
  assert.equal(fast.walk.dx, 1500);
  const zero = { action: "yuru-cocuk", walk: { dx: 100, time: 0 }, actions: [{ action: "egil-al-cocuk", at: 1 }] };
  K.moveSegmentStart(zero, 1, 2, 6, isLoop);
  assert.ok(Number.isFinite(zero.walk.dx));
  // a last action past the shot's end gives an empty span, not a negative one
  assert.ok(K.segmentSpans({ action: "a", actions: [{ action: "b", at: 9 }] }, 6).every((s) => s.end >= s.start));
});

test("lines: a new one goes at the end; removing one keeps the others on their own recordings", async () => {
  const K = await import("../src/panel/kurgu.js");
  const shot = { shot_id: "s1_sh1", utterances: [{ speaker: "a", text: "Bir." }, { speaker: "b", text: "İki." }, { speaker: "a", text: "Üç.", audio: "ses/ozel.wav" }] };
  assert.equal(K.addLine(shot, "a", "  Dört.  ", "t1"), 3);
  assert.deepEqual(shot.utterances[3], { speaker: "a", text: "Dört.", audio: "ses/s1_sh1-yeni-t1.wav" });
  assert.equal(K.addLine(shot, "a", "   "), null); // nothing to say
  K.removeLine(shot, 0);
  // "İki." was recorded as line 1 of the shot: it keeps that file although it is line 0 now
  assert.deepEqual(shot.utterances.map((u) => [u.text, u.audio]), [["İki.", "ses/s1_sh1-1.wav"], ["Üç.", "ses/ozel.wav"], ["Dört.", "ses/s1_sh1-yeni-t1.wav"]]);
  K.removeLine(shot, 0);
  K.removeLine(shot, 0);
  K.removeLine(shot, 0);
  assert.equal(shot.utterances, undefined);
});

test("a validation message points at the row it is about", async () => {
  const { rowOfMessage } = await import("../src/panel/kurgu.js");
  const shot = {
    shot_id: "s1_sh1",
    cast: [{ id: "ela", action: "yuru-cocuk", actions: [{ action: "egil-al-cocuk", at: 2 }] }, { id: "genc", action: "bekle" }],
    props: [{ id: "sise", prop: "plastik-sise" }],
    sfx: [{ sfx: "tik", at: 1 }, { sfx: "kapi-ac", at: 2 }],
    utterances: [{ speaker: "ela", text: "Merhaba" }, { speaker: "pamuk", text: "Selam" }],
  };
  const at = (msg) => rowOfMessage(msg, shot);
  assert.deepEqual(at('shot s1_sh1: "egil-al-cocuk" bends leg_L_lower to 10° at t=1 but rig ela-profil allows -5..150° (it would look broken)'), { kind: "cast", index: 0 });
  assert.deepEqual(at('shot s1_sh1: "bekle" is made for front views, but genc (genc) is drawn profile-right'), { kind: "cast", index: 1 });
  assert.deepEqual(at('shot s1_sh1: "ela" stops walking at 2s but walk.time is 3s (the feet will slide); set walk.time to 2'), { kind: "cast", index: 0 });
  assert.deepEqual(at('shot s1_sh1: sound effect "kapi-ac" is not in the library (a, b)'), { kind: "sfx", index: 1 });
  assert.deepEqual(at('shot s1_sh1: prop "sise" has a hand but no holder'), { kind: "prop", index: 0 });
  assert.deepEqual(at('shot s1_sh1: speaker "pamuk" must be "anlatici" or in this shot\'s cast'), { kind: "line", index: 1 });
  assert.equal(at("shot s1_sh1: camera framing \"x\" is not in the library"), null);
});

test("a new line never takes a recording that belongs to another line or to a deleted one", async () => {
  const K = await import("../src/panel/kurgu.js");
  const shot = { shot_id: "s1_sh1", utterances: ["Bir.", "İki.", "Üç.", "Dört."].map((text) => ({ speaker: "a", text })) };
  K.removeLine(shot, 1); // lines 2 and 3 are pinned to ses/s1_sh1-2.wav and -3.wav
  const i = K.addLine(shot, "a", "Beş.", "k1");
  const paths = shot.utterances.map((u, n) => u.audio || `ses/${shot.shot_id}-${n}.wav`);
  assert.equal(new Set(paths).size, paths.length, paths.join(" "));
  assert.equal(shot.utterances[i].audio, "ses/s1_sh1-yeni-k1.wav");
  // the last line deleted leaves its file behind: a new line still gets a fresh name
  K.removeLine(shot, shot.utterances.length - 1);
  K.addLine(shot, "a", "Altı.", "k2");
  assert.equal(shot.utterances.at(-1).audio, "ses/s1_sh1-yeni-k2.wav");
});

test("a message names a row by its quoted id before a bare word", async () => {
  const { rowOfMessage } = await import("../src/panel/kurgu.js");
  const shot = { shot_id: "x", cast: [{ id: "on", action: "bekle" }, { id: "ela", action: "bak" }] };
  assert.deepEqual(rowOfMessage('shot x: "ela" stops walking on time', shot), { kind: "cast", index: 1 });
});
