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
