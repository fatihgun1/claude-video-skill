// The story against the episode (plan v3, Faz 2.2-2.3): the length the person asked for, and every
// story card's people, objects and place on screen in the scene it became.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { storyWarnings, estimateLine, episodeLength } from "../src/hikaye-kontrol.mjs";

const lib = { characters: new Map([["kadir", { meta: {} }], ["kadir-on", { meta: { same_as: "kadir" } }], ["necmi", { meta: {} }]]) };

function episode() {
  const shot = (id, cast, props = [], lines = []) => ({ shot_id: id, cast, props, utterances: lines, camera: { framing: "wide" } });
  return {
    episode: "e", language: "tr", format: "9:16",
    characters: [{ id: "kadir", name: "Kadir", rig: "kadir" }, { id: "kadir_on", rig: "kadir-on" }, { id: "necmi", name: "Necmi", rig: "necmi" }],
    scenes: [
      { scene_id: "s1", bg: "dar-sokak", shots: [shot("s1_sh1", [{ id: "kadir", action: "bekle", mark: "orta" }], [], [{ speaker: "kadir", text: "Necmi abi, geliyorum!" }])] },
      { scene_id: "s2", bg: "dukkan-ici", dekor: [{ id: "k", prop: "kantar", x: 900 }], shots: [shot("s2_sh1", [{ id: "kadir_on", action: "bekle", mark: "sol" }, { id: "necmi", action: "bekle", mark: "sag" }], [{ id: "s", prop: "plastik-sise", mark: "orta" }], [{ speaker: "anlatici", text: "Necmi şişeleri tarttı." }])] },
    ],
  };
}
function story(extra = {}) {
  return {
    fikir: "x", kisi: [],
    karakterler: [{ ad: "Kadir", rig: "kadir" }, { ad: "Necmi", rig: "necmi" }],
    kartlar: [
      { id: "k1", olay: "Kadir dükkâna yürür.", kim: ["Kadir"], sahne: "s1", mekan: "dar-sokak" },
      { id: "k2", olay: "Necmi kantarda şişeleri tartar.", kim: ["Kadir", "Necmi"], nesneler: ["kantar", "şişe"], sahne: "s2", mekan: "dukkan-ici" },
    ],
    ...extra,
  };
}
function files(ep, st) {
  const dir = mkdtempSync(join(tmpdir(), "hk-"));
  writeFileSync(join(dir, "bolum.json"), JSON.stringify(ep));
  if (st) writeFileSync(join(dir, "hikaye.json"), JSON.stringify(st));
  return join(dir, "bolum.json");
}

test("a line's length is guessed from its letters and pauses (measured on recorded lines)", () => {
  assert.ok(Math.abs(estimateLine("Hayatımın ilk parası lan bu. Yirmi lira.") - 3.6) < 0.4, String(estimateLine("Hayatımın ilk parası lan bu. Yirmi lira.")));
  assert.equal(estimateLine("Hop!"), 1, "at least a second");
});

test("an episode that keeps its story has no story warnings", () => {
  const ep = episode();
  assert.deepEqual(storyWarnings(files(ep, story()), ep, lib), []);
});

test("an episode much longer than asked is told, with the estimate", () => {
  // Hurda Kralı 1: 40 s asked, 107 s made, nobody warned before the voices
  const ep = episode();
  const w = storyWarnings(files(ep, story({ istekler: { sure: 5 } })), ep, lib).join("\n");
  assert.match(w, /sure: about \d+ s, the person asked for 5 s/);
  assert.ok(episodeLength(ep, files(ep, null)) > 5);
});

test("a card's person, object or place missing from its scene is told; a card left out on purpose says why", () => {
  // Hurda Kralı 1: the box of card k1 and the shop of card k3 never came on screen
  const ep = episode();
  ep.scenes[1].dekor = []; // no scale
  ep.scenes[1].shots[0].cast = [{ id: "kadir_on", action: "bekle", mark: "sol" }]; // no Necmi
  ep.scenes[0].bg = "yoksul-sokak";
  const w = storyWarnings(files(ep, story()), ep, lib).join("\n");
  assert.match(w, /hikaye: card k2: "Necmi" is not in scene s2/);
  assert.match(w, /hikaye: card k2: "kantar" is not on screen in scene s2/);
  assert.doesNotMatch(w, /"şişe"/, "a bottle (plastik-sise) is there");
  assert.match(w, /hikaye: card k1: the place "dar-sokak" is not scene s1's background/);
  const st = story();
  st.kartlar[1].atlandi = "kantar çizilmedi; kişi tartıyı anlatıcıyla geçmeyi seçti";
  assert.doesNotMatch(storyWarnings(files(ep, st), ep, lib).join("\n"), /card k2/);
});

test("a card not linked to any scene is told once the episode has scenes", () => {
  const ep = episode();
  const st = story();
  delete st.kartlar[0].sahne;
  assert.match(storyWarnings(files(ep, st), ep, lib).join("\n"), /hikaye: card k1 is not linked to a scene/);
});
