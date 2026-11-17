// Composition in the panel: one person in other views, and the ready shot recipes (panel/kompozisyon.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadLibrary } from "../src/library.mjs";
import { vocabulary } from "../src/panel-kutuphane.mjs";
import { validateEpisode } from "../src/validate.mjs";
import { filmWarnings } from "../src/sinema.mjs";
import { setView, applyRecipe, viewsOf, viewKindOf, shotProblems } from "../src/panel/kompozisyon.js";

const lib = loadLibrary(fileURLToPath(new URL("../../library", import.meta.url)));
const vocab = vocabulary(lib);

function episode() {
  return {
    episode: "x", language: "tr",
    characters: [{ id: "genc", name: "Genç", rig: "genc" }, { id: "ela", name: "Ela", rig: "ela-profil" }],
    scenes: [{ scene_id: "s1", bg: "sokak", shots: [
      { shot_id: "s1_sh1", cast: [{ id: "genc", action: "bekle-yan", mark: "sol" }, { id: "ela", action: "bekle-yan", mark: "sag", facing: "sol" }],
        camera: { framing: "wide", target: "ela" }, utterances: [{ speaker: "ela", text: "Merhaba." }, { speaker: "genc", text: "Selam." }] },
      { shot_id: "s1_sh2", cast: [{ id: "genc", action: "bekle-yan", mark: "sol" }], camera: { framing: "medium" } },
      { shot_id: "s1_sh3", cast: [{ id: "ela", action: "bekle-yan", mark: "orta" }], camera: { framing: "medium" } },
    ] }],
  };
}

test("a person's drawn views are found through the rigs' same_as", () => {
  const ep = episode();
  assert.deepEqual(viewsOf(vocab, ep, "genc"), { yan: "genc", on: "genc-on", arka: "genc-arka" });
  assert.equal(viewKindOf(vocab, "genc-arka"), "arka");
  assert.equal(viewKindOf(vocab, "ela"), "on");
});

test("switching a view swaps the rig, keeps the lines and the camera on that person, and stays valid", () => {
  const ep = episode();
  const shot = ep.scenes[0].shots[0];
  const res = setView(ep, vocab, shot, 1, "on");
  assert.deepEqual(res, { ok: true, id: "ela_on" });
  assert.ok(ep.characters.some((c) => c.id === "ela_on" && c.rig === "ela" && c.name === "Ela (önden)"), "a new entry for the view, named after the person");
  assert.equal(shot.utterances[0].speaker, "ela_on");
  assert.equal(shot.camera.target, "ela_on");
  assert.equal(shot.cast[1].facing, undefined, "a new view starts as drawn");
  assert.deepEqual(validateEpisode(ep, lib).errors, []);
  assert.equal(setView(ep, vocab, shot, 0, "yan").ok, true, "already that view: nothing to do");
  assert.match(setView(ep, vocab, ep.scenes[0].shots[2], 0, "arka").why, /çizilmemiş/, "Ela has no back view drawn");
});

test("over the shoulder: the listener from behind in front, the speaker from the front further back", () => {
  const ep = episode();
  const shot = ep.scenes[0].shots[0];
  assert.deepEqual(applyRecipe(ep, vocab, shot, "omuz").ok, true);
  const [a, b] = [shot.cast.find((m) => m.id.startsWith("ela")), shot.cast.find((m) => m.id.startsWith("genc"))];
  assert.equal(ep.characters.find((c) => c.id === b.id).rig, "genc-arka");
  assert.equal(ep.characters.find((c) => c.id === a.id).rig, "ela");
  assert.ok(a.back > b.back, "the speaker stands further back");
  assert.equal(shot.camera.framing, "medium");
  assert.equal(shot.camera.target, a.id);
  assert.deepEqual(validateEpisode(ep, lib).errors, []);
});

test("a recipe that needs a view nobody drew changes nothing and says why", () => {
  const ep = episode();
  const before = JSON.stringify(ep);
  const res = applyRecipe(ep, vocab, ep.scenes[0].shots[2], "takip");
  assert.equal(res.ok, false);
  assert.match(res.why, /arkadan görünüş çizilmemiş/);
  assert.equal(JSON.stringify(ep), before);
  assert.match(applyRecipe(ep, vocab, ep.scenes[0].shots[1], "omuz").why, /iki kişi/);
});

test("follow from behind and a front close-up; people who speak are kept in the shot", () => {
  const ep = episode();
  assert.equal(applyRecipe(ep, vocab, ep.scenes[0].shots[1], "takip").ok, true);
  const s2 = ep.scenes[0].shots[1];
  assert.equal(s2.camera.move, "dolly_ileri");
  assert.equal(s2.cast[0].action, "yuru-arka");
  const s1 = ep.scenes[0].shots[0];
  assert.equal(applyRecipe(ep, vocab, s1, "yakin").ok, true);
  assert.equal(s1.camera.framing, "close");
  assert.equal(s1.cast.length, 2, "Genç speaks in this shot: he stays");
  assert.deepEqual(validateEpisode(ep, lib).errors, []);
});

test("the film rules flag a talk with no over-the-shoulder shot and a scene seen only from the side", () => {
  const ep = episode();
  ep.characters[1].rig = "ela"; // drawn from the front
  const w = filmWarnings(ep, lib);
  assert.ok(w.some((x) => /scene s1 has no over-the-shoulder/.test(x)));
  assert.ok(!w.some((x) => /from the side/.test(x)), "Ela is drawn from the front: not side-only");
  ep.characters[1].rig = "ela-profil";
  ep.scenes[0].shots[2].cast[0].id = "genc";
  const side = filmWarnings(ep, lib);
  assert.ok(side.some((x) => /every shot of scene s1 shows people from the side/.test(x)));
  applyRecipe(ep, vocab, ep.scenes[0].shots[0], "omuz");
  assert.ok(!filmWarnings(ep, lib).some((x) => /over-the-shoulder/.test(x)), "the recipe answers the rule");
  const probs = shotProblems(side, "s1_sh2", "s1");
  assert.ok(probs.some((p) => /bütün çekimleri yandan/.test(p.metin)), "a scene-wide finding shows on every shot of it, in Turkish");
});

test("the quick start makes a folder id and a short title from the story", async () => {
  const { idFromTitle, titleFromStory } = await import("../src/panel/hizli-basla.js");
  assert.equal(titleFromStory("KPSS'ye hazırlanan bir öğrenci kütüphanede bir kızla tanışır. Kız ajandır."), "KPSS'ye hazırlanan bir öğrenci kütüphanede");
  assert.equal(idFromTitle("KPSS'ye hazırlanan bir öğrenci kütüphanede"), "kpss-ye-hazirlanan-bir-ogrenci");
  assert.equal(idFromTitle("Çığ ŞÜÖ"), "cig-suo");
  assert.equal(idFromTitle("!!!"), "bolum");
});

test("a quick start needs only the idea and the format; the full wizard needs characters and cards", async () => {
  const { missingForBuild } = await import("../src/panel-yapim.mjs");
  const story = { fikir: "Bir öğrenci kütüphanede bir ajanla tanışır.", karakterler: [], kartlar: [], istekler: { format: "9:16", boyut: "2b" } };
  assert.deepEqual(missingForBuild(story, { quick: true }), []);
  assert.ok(missingForBuild(story).length >= 2);
  assert.deepEqual(missingForBuild({ ...story, istekler: {} }, { quick: true }), ["format (9:16 ya da 16:9)"]);
});

test("a cut to another scene is neither a jump cut nor a flip of direction", () => {
  const ep = episode();
  ep.scenes.push({ scene_id: "s2", bg: "sokak", shots: [{ shot_id: "s2_sh1", cast: [{ id: "ela", action: "bekle-yan", mark: "orta" }], camera: { framing: "medium" } }] });
  const w = filmWarnings(ep, lib);
  assert.ok(!w.some((x) => x.startsWith("film: shot s2_sh1:") && /jump cut|direction flips/.test(x)), "s1_sh3 → s2_sh1 is a new place: no jump cut");
});
