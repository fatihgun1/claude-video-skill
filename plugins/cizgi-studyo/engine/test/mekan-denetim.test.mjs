import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { paintedIn, backgroundDraftErrors, farLayerNotes, copiedFarLayers, placeWarnings } from "../src/mekan-denetim.mjs";
import { loadLibrary } from "../src/library.mjs";
import { listDrafts } from "../src/proje-kutuphane.mjs";

const LIB = fileURLToPath(new URL("../../library", import.meta.url));
const lib = loadLibrary(LIB);
const svg = (comment, body = "") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080"><!-- ${comment} -->${body}</svg>`;

test("people and usable things named in a background are found; words that only say where people stand are not", () => {
  // Hurda Kralı: "kapı önünde oturanlar", "oturan adam", "içeride kantar ışığı", "şişe çuvalı"
  assert.deepEqual(paintedIn([svg("kapı önünde oturanlar, oturan adam")]).people.sort(), ["adam", "oturan"]);
  assert.deepEqual(paintedIn([svg("içeride kantar ışığı, şişe çuvalı")]).things.sort(), ["kantar", "çuval", "şişe"].sort());
  assert.deepEqual(paintedIn([svg("sidewalk where people stand (y 870)"), svg("many manholes")]).people, []);
  assert.deepEqual(paintedIn([svg("a woman at the window")]).people, ["woman"]);
  assert.deepEqual(paintedIn([svg("plain wall", '<g id="kantar-golge"></g>')]).things, ["kantar"], "ids count too");
  assert.deepEqual(paintedIn([svg("tabela ve şişe rafı")], ["şişe rafı"]).things, [], "declared fixed scenery passes");
  assert.equal(backgroundDraftErrors([svg("kapı önünde oturanlar")], ["oturan"]).length, 1, "a person is refused even when declared");
});

test("the real dar-sokak-hurdaci, offered as a draft, is refused (Faz 7.1)", () => {
  const real = "C:/Users/Fatih/Desktop/Video/kutuphane/backgrounds/dar-sokak-hurdaci";
  if (!existsSync(real)) return; // only on the machine that has the project
  const proj = join(mkdtempSync(join(tmpdir(), "mekan-")), "kutuphane");
  mkdirSync(join(proj, "taslak", "backgrounds"), { recursive: true });
  cpSync(real, join(proj, "taslak", "backgrounds", "eski-sokak"), { recursive: true });
  const d = listDrafts(proj, lib).find((x) => x.id === "eski-sokak");
  assert.equal(d.ok, false);
  assert.match(d.errors.join("\n"), /insan çizilmiş \(oturan\)/);
  assert.match(d.errors.join("\n"), /kullanılabilir nesne çizilmiş/);
});

test("a nearly empty far layer, and one far layer copied to another place, are told (Faz 7.2)", () => {
  const thin = { id: "uzak", derinlik: 0.3, svg: svg("skyline", "<rect/><rect/>") };
  const rich = { id: "uzak", derinlik: 0.3, svg: svg("skyline", "<path/>".repeat(80)) };
  assert.equal(farLayerNotes("a", [thin]).length, 1);
  assert.deepEqual(farLayerNotes("a", [rich]), []);
  assert.deepEqual(farLayerNotes("a", [{ ...thin, derinlik: 0 }]), [], "the sky is not a far layer");
  const layers = new Map([["sokak", [thin]], ["sokak-gece", [thin]], ["park", [thin]]]);
  const told = copiedFarLayers(layers, ["sokak", "sokak-gece"]);
  assert.deepEqual(told, [], "a variant of the same place may share it");
  assert.equal(copiedFarLayers(layers, ["sokak", "park"]).length, 1);
});

test("an outdoor scene with nothing moving, and a thing painted in and also placed, are told (Faz 7.1, 7.3)", () => {
  const sky = { id: "gok", derinlik: 0, svg: svg("sky", "<path/>".repeat(80)) };
  const street = { id: "sokak", derinlik: 1, svg: svg("sokak, içeride kantar") };
  const my = { ...lib, layers: new Map([["sokak-x", [sky, street]]]), backgrounds: new Map([["sokak-x", svg("x")]]) };
  const ep = {
    characters: [], scenes: [{ scene_id: "s1", bg: "sokak-x", dekor: [], shots: [{ shot_id: "s1_sh1", cast: [], camera: { framing: "wide" }, props: [{ id: "k", prop: "kantar", mark: "orta" }] }] }],
  };
  const w = placeWarnings(ep, my).join("\n");
  assert.match(w, /nothing moves in it/);
  assert.match(w, /kantar is painted into the background and also placed/);
  ep.scenes[0].dekor = [{ id: "a", prop: "kedi", x: 100, akis: { dx: 40 } }, { id: "b", prop: "araba", x: 900, akis: { dx: -80 } }];
  assert.doesNotMatch(placeWarnings(ep, my).join("\n"), /moves in it/);
});
