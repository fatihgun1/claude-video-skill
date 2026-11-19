// Flow mistakes from "Köşe Başı": a frozen crowd, people crossing a deep street sideways, a talking
// tableau, a dip to black inside one moment, and a moving crowd that the player walks by.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadLibrary } from "../src/library.mjs";
import { filmWarnings } from "../src/sinema.mjs";
import { compileEpisode, sceneTransition } from "../src/compile.mjs";
import { validateEpisode } from "../src/validate.mjs";

const LIB = fileURLToPath(new URL("../../library", import.meta.url));
const SOKAK = fileURLToPath(new URL("../../../../ornekler/sokak/bolum.json", import.meta.url));
const lib = loadLibrary(LIB);
const fresh = () => JSON.parse(readFileSync(SOKAK, "utf8"));

test("a crowd standing frozen is told; one that walks by is not", () => {
  const ep = fresh();
  ep.scenes[0].dekor = [{ id: "k1", prop: "kalabalik-gelen", x: 600, back: 0.8 }];
  assert.ok(filmWarnings(ep, lib).some((w) => /crowd "k1".*frozen/.test(w)));
  ep.scenes[0].dekor[0].akis = { back: -0.1 };
  assert.ok(!filmWarnings(ep, lib).some((w) => /frozen/.test(w)));
});

test("walking sideways across a street that runs into depth is told", () => {
  const ep = fresh();
  const scene = ep.scenes.find((s) => s.bg === "sokak-derinlik");
  const shot = scene.shots[0];
  const side = ep.characters.find((c) => lib.characters.get(c.rig)?.meta?.view?.startsWith("profile"));
  shot.cast = [{ id: side.id, action: "bekle", mark: "orta", walk: { dx: 200, time: 1 } }];
  assert.ok(filmWarnings(ep, lib).some((w) => w.includes(`shot ${shot.shot_id}`) && /sideways across "sokak-derinlik"/.test(w)));
});

test("two people talking in one static shot is told; one speaker is not", () => {
  const ep = fresh();
  const shot = ep.scenes[1].shots[0];
  const a = ep.characters.find((c) => c.id === "genc");
  const other = [...lib.characters.keys()].find((r) => !r.startsWith("genc"));
  const b = { id: "oteki", rig: other };
  ep.characters.push(b);
  shot.utterances = [{ speaker: a.id, text: "Merhaba." }, { speaker: b.id, text: "Selam." }];
  shot.camera = { ...shot.camera, move: "static" };
  assert.ok(filmWarnings(ep, lib).some((w) => w.includes(`shot ${shot.shot_id}`) && /talk in one static shot/.test(w)));
  shot.utterances = [{ speaker: a.id, text: "Merhaba." }];
  assert.ok(!filmWarnings(ep, lib).some((w) => w.includes(`shot ${shot.shot_id}`) && /static shot/.test(w)));
});

test("a scene going on in the same place and time cuts; another place or time dips to black", () => {
  const ep = { scenes: [
    { scene_id: "a", bg: "sokak", isik: { saat: "aksam" } },
    { scene_id: "b", bg: "sokak", isik: { saat: "aksam" } },
    { scene_id: "c", bg: "oda", isik: { saat: "sabah" } },
    { scene_id: "d", bg: "oda", isik: { saat: "aksam" } },
    { scene_id: "e", bg: "oda", isik: { saat: "aksam" }, gecis: "kararma" },
  ] };
  assert.deepEqual(ep.scenes.map((s) => sceneTransition(ep, s.scene_id)), ["kararma", "kesme", "kararma", "kararma", "kararma"]);
});

test("a piece of decor with akis carries what the player needs to walk it by", () => {
  const ep = fresh();
  ep.scenes[1].dekor = [{ id: "bank1", prop: "bank", x: 1500, back: 0.4, akis: { dx: -60, back: 0.05 } }];
  assert.deepEqual(validateEpisode(ep, lib).errors, []);
  const dir = mkdtempSync(join(tmpdir(), "akis-"));
  compileEpisode(SOKAK, lib, dir, { episode: ep, missingAudio: "estimate" });
  const html = readFileSync(join(dir, "index.html"), "utf8");
  const m = /id="dekor-s1--bank1" data-uzak="1" data-akis="([^"]+)"/.exec(html);
  assert.ok(m, "moving decor marked");
  const f = JSON.parse(m[1].replace(/&quot;/g, '"'));
  assert.equal(f.dx, -60);
  assert.equal(f.db, 0.05);
  ep.scenes[1].dekor[0].akis = { dx: 9999 };
  assert.equal(validateEpisode(ep, lib).ok, false);
});

test("a close-up of someone sitting looks down at their face, not at the standing height", () => {
  const C = globalThis.CizgiCore;
  const vp = { width: 1080, height: 1920 };
  const stand = { cast: [{ id: "a", action: "bekle", mark: "orta" }], camera: { framing: "close", target: "a" } };
  const sit = { ...stand, cast: [{ ...stand.cast[0], kok_y: 300 }] };
  const up = C.shotCamera(stand, 0, lib.world, lib.cameras, vp, { a: 125 });
  const down = C.shotCamera(sit, 0, lib.world, lib.cameras, vp, { a: 125 });
  assert.ok(down.cy > up.cy + 50, `the camera goes down with the face (${up.cy.toFixed(0)} → ${down.cy.toFixed(0)})`);
});

test("a follow shot of someone getting up rises with them, from their face on the ground to the standing one", () => {
  // Hurda Kralı 1 s1_sh1: one unbroken shot, lying → sitting → standing; framed for the end, the
  // sitting face was in the bottom corner
  const C = globalThis.CizgiCore;
  const vp = { width: 1080, height: 1920 };
  const shot = { cast: [{ id: "a", action: "bekle", mark: "orta", kok_y: 0, kok_yol: [[0, 350], [0.5, 350], [1, 0]] }], camera: { framing: "medium", move: "follow", target: "a" } };
  const start = C.shotCamera(shot, 0, lib.world, lib.cameras, vp, { a: 125 });
  const end = C.shotCamera(shot, 1, lib.world, lib.cameras, vp, { a: 125 });
  const standing = C.shotCamera({ ...shot, cast: [{ ...shot.cast[0], kok_yol: undefined }] }, 0, lib.world, lib.cameras, vp, { a: 125 });
  assert.ok(start.cy > end.cy + 50, `down at the start, up at the end (${start.cy.toFixed(0)} → ${end.cy.toFixed(0)})`);
  assert.ok(Math.abs(end.cy - standing.cy) < 1, "at the end it frames the standing face");
  // the body down on the ground lies behind its feet (root_x): the camera goes along sideways too
  const behind = { ...shot, cast: [{ ...shot.cast[0], kok_yol: [[0, 350, -170], [1, 0, 0]] }] };
  const back = C.shotCamera(behind, 0, lib.world, lib.cameras, vp, { a: 125 });
  assert.ok(back.cx < start.cx - 20, `left with the body (${start.cx.toFixed(0)} → ${back.cx.toFixed(0)})`);
  const mirrored = C.shotCamera({ ...behind, cast: [{ ...behind.cast[0], facing: "sol" }] }, 0, lib.world, lib.cameras, vp, { a: 125 });
  assert.ok(mirrored.cx > start.cx + 20, "a drawing turned to face left lies the other way");
});

test("a follow shot carries the drop of its target over time; other shots only the end", () => {
  const ep = fresh();
  const shot = ep.scenes[1].shots[0];
  const side = ep.characters.find((c) => lib.characters.get(c.rig)?.meta?.view?.startsWith("profile"));
  const data = (camera) => {
    shot.cast = [{ id: side.id, action: "oturuyor", mark: "orta", actions: [{ action: "kalk", at: 0.5 }] }];
    shot.camera = { ...camera, target: side.id };
    const dir = mkdtempSync(join(tmpdir(), "kok-"));
    compileEpisode(SOKAK, lib, dir, { episode: ep, missingAudio: "estimate" });
    const html = readFileSync(join(dir, "index.html"), "utf8");
    return JSON.parse(/window\.__CIZGI__ = (\{[\s\S]*?\});\s*<\/script>/.exec(html)[1]).shots.find((s) => s.shot_id === shot.shot_id).cast[0];
  };
  const follow = data({ framing: "medium", move: "follow" });
  assert.ok(Array.isArray(follow.kok_yol), "samples of the drop");
  assert.ok(follow.kok_yol[0][1] > 50 && follow.kok_yol.at(-1)[1] < 50, JSON.stringify(follow.kok_yol));
  assert.equal(data({ framing: "medium", move: "static" }).kok_yol, undefined);
});

test("a medium shot of someone bending frames the whole bend: the face goes down and forward", () => {
  // Hurda Kralı 1 s2_sh2 (9:16): framed for the end of the bend, the standing head was cut at the
  // top, and the body leaning forward went out at the side
  const ep = fresh();
  const shot = ep.scenes[1].shots[0];
  const side = ep.characters.find((c) => lib.characters.get(c.rig)?.meta?.view?.startsWith("profile"));
  const member = (camera, extra = {}) => {
    shot.cast = [{ id: side.id, action: "egil-al", mark: "orta", ...extra }];
    shot.camera = { ...camera, target: side.id };
    const dir = mkdtempSync(join(tmpdir(), "egil-"));
    compileEpisode(SOKAK, lib, dir, { episode: ep, missingAudio: "estimate" });
    const html = readFileSync(join(dir, "index.html"), "utf8");
    return JSON.parse(/window\.__CIZGI__ = (\{[\s\S]*?\});\s*<\/script>/.exec(html)[1]).shots.find((s) => s.shot_id === shot.shot_id).cast[0];
  };
  const medium = member({ framing: "medium", move: "push_in" });
  assert.ok(medium.kok_y > 100, `between standing and bent (${medium.kok_y})`);
  assert.ok(medium.kok_x > 50, `forward, the way the drawing faces (${medium.kok_x})`);
  const follow = member({ framing: "medium", move: "follow" });
  assert.ok(follow.kok_yol.some(([, , x]) => x > 200), "a follow shot goes along with the lean");
  // a close-up keeps its framing for the end of the shot (the sitting face of Köşe Başı)
  assert.equal(member({ framing: "close", move: "static" }).kok_x, undefined);
});

test("the camera centres on kok_x, mirrored for a drawing turned to face left", () => {
  const C = globalThis.CizgiCore;
  const vp = { width: 1080, height: 1920 };
  const base = { cast: [{ id: "a", action: "bekle", mark: "orta" }], camera: { framing: "medium", target: "a" } };
  const plain = C.shotCamera(base, 0.5, lib.world, lib.cameras, vp, { a: 125 });
  const lean = C.shotCamera({ ...base, cast: [{ ...base.cast[0], kok_x: 300 }] }, 0.5, lib.world, lib.cameras, vp, { a: 125 });
  const turned = C.shotCamera({ ...base, cast: [{ ...base.cast[0], kok_x: 300, facing: "sol" }] }, 0.5, lib.world, lib.cameras, vp, { a: 125 });
  assert.ok(lean.cx > plain.cx + 20 && turned.cx < plain.cx - 20, `${plain.cx} ${lean.cx} ${turned.cx}`);
});

test("someone bending with the head at a standing person's waist is told, in the episode's format", () => {
  // Hurda Kralı 2 s2_sh1 (9:16): Kadir bent over the scale with his face at Necmi's crotch
  const ep = fresh();
  ep.format = "9:16";
  const side = ep.characters.find((c) => lib.characters.get(c.rig)?.meta?.view?.startsWith("profile"));
  const other = { id: "pamuk", rig: "pamuk" }; // another person, not a view of the one who bends
  ep.characters.push(other);
  const shot = ep.scenes[1].shots[0];
  shot.utterances = [];
  shot.props = [];
  shot.camera = { framing: "wide", move: "static" };
  shot.cast = [{ id: side.id, action: "egil-al", mark: "orta" }, { id: other.id, action: "bekle", mark: "sag", dx: -200 }];
  const close = filmWarnings(ep, lib).filter((w) => /bends with the head at/.test(w));
  assert.ok(close.some((w) => w.includes(`"${side.id}"`) && w.includes(`"${other.id}"`)), close.join("\n") || "no warning");
  const here = () => filmWarnings(ep, lib).filter((w) => w.includes(`shot ${shot.shot_id} `) && /bends with the head at/.test(w));
  // behind the one who bends (sag + 400 would still be close in 9:16, which is the point): nothing to see
  shot.cast[1] = { id: other.id, action: "bekle", mark: "sol" };
  assert.deepEqual(here(), []);
  // bending away from them: the head goes the other way
  shot.cast = [{ id: side.id, action: "egil-al", mark: "orta", facing: "sol" }, { id: other.id, action: "bekle", mark: "sag", dx: -200 }];
  assert.deepEqual(here(), []);
});

test("someone walking through a person standing in the way is told, in the episode's format", () => {
  // walks keep their stride in 9:16 while the marks close up: a walk sol → sag ran through whoever stood at sag
  const ep = fresh();
  ep.format = "9:16";
  const side = ep.characters.find((c) => lib.characters.get(c.rig)?.meta?.view?.startsWith("profile"));
  ep.characters.push({ id: "pamuk", rig: "pamuk" });
  const shot = ep.scenes[1].shots[0];
  shot.utterances = [];
  shot.props = [];
  shot.camera = { framing: "wide", move: "static" };
  shot.cast = [{ id: side.id, action: "yuru", mark: "sol", walk: { dx: 800, time: 2 } }, { id: "pamuk", action: "bekle", mark: "sag" }];
  const here = () => filmWarnings(ep, lib).filter((w) => w.includes(`shot ${shot.shot_id} `) && /walks through/.test(w));
  assert.equal(here().length, 1, filmWarnings(ep, lib).join("\n"));
  shot.cast[0].walk = { dx: 300, time: 1 }; // stops before them
  assert.deepEqual(here(), []);
});

test("two people drawn over each other is told by the validator, not only in the panel's review", () => {
  const ep = fresh();
  ep.format = "16:9";
  ep.characters.push({ id: "pamuk", rig: "pamuk" });
  const side = ep.characters[0];
  const shot = ep.scenes[1].shots[0];
  shot.utterances = [];
  shot.props = [];
  shot.camera = { framing: "wide", move: "static" };
  shot.cast = [{ id: side.id, action: "bekle", mark: "orta" }, { id: "pamuk", action: "bekle", mark: "orta" }];
  const here = () => filmWarnings(ep, lib).filter((w) => w.includes(`shot ${shot.shot_id} `) && /drawn over each other/.test(w));
  assert.equal(here().length, 1, filmWarnings(ep, lib).join("\n"));
  shot.cast[1].mark = "sag";
  assert.deepEqual(here(), []);
});

test("a head cut at the top of a medium or wide frame is told (the framing checks were sideways only)", () => {
  // the camera audit: a medium on a short character cut a tall one's face off at the top, unwarned
  const ep = fresh();
  ep.format = "16:9";
  const side = ep.characters.find((c) => lib.characters.get(c.rig)?.rig !== "x" && c.rig === "genc") || ep.characters[0];
  ep.characters.push({ id: "pamuk", rig: "pamuk" });
  const shot = ep.scenes[1].shots[0];
  shot.utterances = [];
  shot.props = [];
  shot.cast = [{ id: side.id, action: "bekle", mark: "sol" }, { id: "pamuk", action: "bekle", mark: "orta" }];
  shot.camera = { framing: "medium", move: "static", target: "pamuk" };
  const here = () => filmWarnings(ep, lib).filter((w) => w.includes(`shot ${shot.shot_id} `) && /head is cut/.test(w));
  assert.ok(here().some((w) => w.includes(`"${side.id}"`)), filmWarnings(ep, lib).filter((w) => w.includes(shot.shot_id)).join("\n") || "none");
  shot.camera = { framing: "wide", move: "static" };
  assert.deepEqual(here(), [], "a wide frame holds them both");
});

test("a dolly on a background with no vanishing point is told (the picture would not move at all)", () => {
  // kpss-ajani s5_sh5: dolly_ileri on a flat street; both people walked in place
  const ep = fresh();
  const flat = ep.scenes.find((s) => s.bg === "sokak");
  const shot = flat.shots[0];
  shot.camera = { framing: "wide", move: "dolly_ileri" };
  assert.ok(filmWarnings(ep, lib).some((w) => w.includes(`shot ${shot.shot_id}:`) && /dolly.*no vanishing point/.test(w)));
  shot.camera = { framing: "wide", move: "push_in" };
  assert.ok(!filmWarnings(ep, lib).some((w) => /no vanishing point/.test(w)));
});

test("compiled shots carry how far a sitting member has dropped", () => {
  const ep = fresh();
  const shot = ep.scenes[1].shots[0];
  const side = ep.characters.find((c) => lib.characters.get(c.rig)?.meta?.view?.startsWith("profile"));
  shot.cast = [{ id: side.id, action: "oturuyor", mark: "orta" }];
  const dir = mkdtempSync(join(tmpdir(), "kok-"));
  compileEpisode(SOKAK, lib, dir, { episode: ep, missingAudio: "estimate" });
  const html = readFileSync(join(dir, "index.html"), "utf8");
  const data = JSON.parse(/window\.__CIZGI__ = (\{[\s\S]*?\});\s*<\/script>/.exec(html)[1]);
  const m = data.shots.find((s) => s.shot_id === shot.shot_id).cast[0];
  assert.ok(m.kok_y > 50, `kok_y ${m.kok_y}`);
});

test("a crowd walks the way it faces, and into depth only on a deep street", () => {
  const ep = fresh();
  const flat = ep.scenes.find((s) => s.bg === "sokak");
  flat.dekor = [{ id: "k1", prop: "kalabalik-uzaklasan", x: 600, back: 0.7, akis: { back: 0.04 } }, { id: "k2", prop: "kalabalik-gelen", x: 900, back: 0.7, akis: { dx: 30 } }];
  const w = filmWarnings(ep, lib).join("\n");
  assert.match(w, /"k1" walks into depth on "sokak", a flat street/);
  assert.match(w, /"k2" \(kalabalik-gelen\) faces the camera or away from it but slides sideways/);
  flat.dekor = [{ id: "k3", prop: "kalabalik-yuruyen-yandan", x: 900, back: 0.7, akis: { dx: 30 } }];
  assert.doesNotMatch(filmWarnings(ep, lib).join("\n"), /k3/);
});

test("someone sitting at the end of a shot does not stand at the start of the next", () => {
  const ep = fresh();
  const scene = ep.scenes.find((s) => s.shots.length >= 2) || ep.scenes[0];
  const side = ep.characters.find((c) => lib.characters.get(c.rig)?.meta?.view?.startsWith("profile"));
  scene.shots[0].cast = [{ id: side.id, action: "otur", mark: "orta" }];
  scene.shots[1].cast = [{ id: side.id, action: "bekle-yan", mark: "orta" }];
  assert.ok(filmWarnings(ep, lib).some((w) => w.includes(`shot ${scene.shots[1].shot_id}`) && /stands at once/.test(w)));
  scene.shots[1].cast = [{ id: side.id, action: "kalk", mark: "orta" }];
  assert.ok(!filmWarnings(ep, lib).some((w) => /stands at once/.test(w)));
});

test("nobody stands inside a bench; sitting on it is fine", () => {
  const ep = fresh();
  const scene = ep.scenes[1];
  const side = ep.characters.find((c) => lib.characters.get(c.rig)?.meta?.view?.startsWith("profile"));
  scene.dekor = [{ id: "b1", prop: "bank", x: 960 }];
  scene.shots[0].cast = [{ id: side.id, action: "bekle-yan", mark: "orta" }];
  assert.ok(filmWarnings(ep, lib).some((w) => /stands inside the bank "b1"/.test(w)));
  scene.shots[0].cast = [{ id: side.id, action: "oturuyor", mark: "orta" }];
  assert.ok(!filmWarnings(ep, lib).some((w) => w.includes(`shot ${scene.shots[0].shot_id}:`) && /stands inside/.test(w)));
  // getting up from it ends standing at the bench, which is right (kpss-ajani s4_sh4)
  scene.shots[0].cast = [{ id: side.id, action: "kalk", mark: "orta" }];
  assert.ok(!filmWarnings(ep, lib).some((w) => w.includes(`shot ${scene.shots[0].shot_id}:`) && /stands inside/.test(w)));
});

test("a grown-up drawing does not do a child's action", () => {
  const ep = fresh();
  const side = ep.characters.find((c) => lib.characters.get(c.rig)?.meta?.view?.startsWith("profile"));
  ep.scenes[1].shots[0].cast = [{ id: side.id, action: "kos-cocuk", mark: "orta" }];
  assert.ok(filmWarnings(ep, lib).some((w) => /grown-up drawing but does the child's action "kos-cocuk"/.test(w)));
});

test("garbled Turkish (UTF-8 read as Windows-1252) is refused; real Turkish passes", () => {
  const ep = fresh();
  ep.title = "Köşe Başı: ıİğĞüÜşŞöÖçÇ";
  assert.deepEqual(validateEpisode(ep, lib).errors.filter((e) => /garbled/.test(e)), []);
  ep.title = "KÃ¶ÅŸe BaÅŸÄ±";
  assert.match(validateEpisode(ep, lib).errors.join("\n"), /\/title: the text looks garbled/);
});

test("an over-the-shoulder shot in 9:16 keeps the front person's shoulder on screen", () => {
  const C = globalThis.CizgiCore;
  const vp = { width: 1080, height: 1920 };
  const shot = {
    cast: [{ id: "on", action: "bekle", mark: "sol", dx: 140 }, { id: "konusan", action: "bekle", mark: "orta", dx: 150, back: 0.35 }],
    camera: { framing: "medium", target: "konusan" },
  };
  assert.deepEqual(C.offFrame(shot, lib.world, lib.cameras, vp, { on: 125, konusan: 140 }), []);
  // a close-up still leaves the other out on purpose
  const close = { ...shot, camera: { framing: "close", target: "konusan" } };
  const cam = C.shotCamera(close, 0.5, lib.world, lib.cameras, vp, { on: 125, konusan: 140 });
  assert.ok(cam.zoom > C.shotCamera(shot, 0.5, lib.world, lib.cameras, vp, { on: 125, konusan: 140 }).zoom);
});

test("a prop in the far hand of a profile drawing is told; the near hand is fine", () => {
  const ep = fresh();
  const side = ep.characters.find((c) => lib.characters.get(c.rig)?.meta?.view?.startsWith("profile"));
  const shot = ep.scenes[1].shots[0];
  shot.cast = [{ id: side.id, action: "bekle-yan", mark: "orta" }];
  shot.props = [{ id: "tel", prop: "plastik-sise", holder: side.id, hand: "R" }];
  assert.ok(filmWarnings(ep, lib).some((w) => /holds "tel" in the far hand \(R\)/.test(w)));
  shot.props[0].hand = "L";
  assert.ok(!filmWarnings(ep, lib).some((w) => /far hand/.test(w)));
});

test("a shot may look at its place from another angle (shot.bg): validated, drawn, decor kept on the scene's picture", () => {
  // the camera audit: every reverse angle needed a new scene and a fade, so episodes stayed on one angle
  const ep = fresh();
  ep.scenes[1].dekor = [{ id: "bank1", prop: "bank", x: 1500, back: 0.4 }];
  const shot = ep.scenes[1].shots[2];
  shot.bg = "yok-boyle-bir-yer";
  assert.ok(validateEpisode(ep, lib).errors.some((e) => e.includes(`shot ${shot.shot_id}: background "yok-boyle-bir-yer"`)));
  shot.bg = "park";
  assert.deepEqual(validateEpisode(ep, lib).errors, []);
  const dir = mkdtempSync(join(tmpdir(), "aci-"));
  compileEpisode(SOKAK, lib, dir, { episode: ep, missingAudio: "estimate" });
  const html = readFileSync(join(dir, "index.html"), "utf8");
  assert.ok(html.includes("bg-park"), "the angle's picture is in the page");
  assert.ok(html.includes(`"shot_id":"${shot.shot_id}","scene_id":"s1","bg":"park"`), "the shot is drawn on park");
  assert.ok(/"bg":"park"[^]*?"aci":true/.test(html), "marked as another angle: the scene's decor is hidden on it");
});

test("a scene of three or more shots on one angle, a listener who only waits, and a skeleton episode are told", () => {
  const ep = fresh();
  const scene = ep.scenes[1];
  const one = (w) => w.includes(`shot ${scene.shots[0].shot_id}:`) && /look from one angle/.test(w);
  for (const s of scene.shots) s.cast = [{ id: "genc", action: "bekle", mark: "orta" }];
  assert.equal(filmWarnings(ep, lib).filter(one).length, 1, filmWarnings(ep, lib).join("\n"));
  scene.shots[1].bg = "park"; // another angle
  assert.deepEqual(filmWarnings(ep, lib).filter(one), []);

  const talk = scene.shots[0];
  const other = { id: "pamuk", rig: "pamuk" }; // a second person seen from the front (a back view shows no idle face)
  ep.characters.push(other);
  talk.cast = [{ id: "genc", action: "bekle", mark: "sol" }, { id: other.id, action: "bekle", mark: "sag" }];
  talk.utterances = [{ speaker: "genc", text: "Merhaba." }];
  const idle = (w) => w.includes(`shot ${talk.shot_id}:`) && /only stands and waits/.test(w);
  assert.equal(filmWarnings(ep, lib).filter(idle).length, 1);
  talk.cast[1].action = "bak";
  assert.deepEqual(filmWarnings(ep, lib).filter(idle), []);

  const skeleton = (w) => /\(a skeleton\)/.test(w);
  assert.deepEqual(filmWarnings(ep, lib).filter(skeleton), []);
  scene.shots = [scene.shots[0]];
  for (const sc of ep.scenes) sc.shots[0].camera = { framing: "wide", move: "static" };
  assert.equal(filmWarnings(ep, lib).filter(skeleton).length, 1);
});

test("a side-on place (mekan.json yol: yan) keeps its vanishing point but is not a street into depth", async () => {
  // Hurda Kralı 3: every place drawn by the rules has a vanishing point (kaybolma), so walking
  // along a shop front drawn side-on was told as crossing a deep street.
  const { loadLayered } = await import("../src/mekan.mjs");
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "yan-"));
  const layer = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lib.world.width} ${lib.world.height}"><rect width="10" height="10"/></svg>`;
  writeFileSync(join(dir, "zemin.svg"), layer);
  const meta = { katmanlar: [{ id: "zemin", dosya: "zemin.svg", derinlik: 1 }], kaybolma: [960, 480] };
  writeFileSync(join(dir, "mekan.json"), JSON.stringify({ ...meta, yol: "yan" }));
  const side = loadLayered(dir, "yan-sokak", lib.world);
  assert.deepEqual(side.errors, []);
  assert.match(side.svg, /data-vp="960,480"/);
  writeFileSync(join(dir, "mekan.json"), JSON.stringify({ ...meta, yol: "capraz" }));
  assert.ok(loadLayered(dir, "yan-sokak", lib.world).errors.some((e) => /yol/.test(e)));

  const ep = fresh();
  const scene = ep.scenes.find((s) => s.bg === "sokak-derinlik");
  const shot = scene.shots[0];
  const walker = ep.characters.find((c) => lib.characters.get(c.rig)?.meta?.view?.startsWith("profile"));
  shot.cast = [{ id: walker.id, action: "bekle", mark: "orta", walk: { dx: 200, time: 1 } }];
  const sideLib = { ...lib, backgrounds: new Map([...lib.backgrounds, ["sokak-derinlik", side.svg]]) };
  assert.ok(!filmWarnings(ep, sideLib).some((w) => /sideways across/.test(w)));
});
