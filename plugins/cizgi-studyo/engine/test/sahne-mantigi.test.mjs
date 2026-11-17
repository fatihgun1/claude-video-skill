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
  flat.dekor = [{ id: "k3", prop: "kalabalik-yandan", x: 900, back: 0.7, akis: { dx: 30 } }];
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
