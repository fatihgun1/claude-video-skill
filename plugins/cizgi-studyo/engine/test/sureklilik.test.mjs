import { test } from "node:test";
import assert from "node:assert/strict";
import { continuityWarnings } from "../src/sureklilik.mjs";

const lib = { world: { marks: { sol: 560, orta: 960, sag: 1360 } }, characters: new Map([["kadir", {}], ["kopek", {}]]), props: new Map([["karton-yatak", {}]]), backgrounds: new Map() };

function episode(over = {}) {
  return {
    characters: [
      { id: "kadir", rig: "kadir", voice: { hazir: "erkek" } },
      { id: "kadir_on", rig: "kadir-on" },
      { id: "kopek", rig: "kopek" },
    ],
    narrator_voice: { hazir: "kadin" },
    scenes: [
      { scene_id: "s1", bg: "sokak", isik: { saat: "sabah" }, shots: [{ shot_id: "a", cast: [{ id: "kadir", action: "bekle", mark: "orta" }], utterances: [{ speaker: "anlatici", text: "x" }] }] },
      { scene_id: "s2", bg: "sokak", isik: { saat: "sabah" }, shots: [{ shot_id: "b", cast: [{ id: "kadir_on", action: "bekle", mark: "orta" }], utterances: [{ speaker: "kadir_on", text: "y" }] }] },
    ],
    ...over,
  };
}

test("a clean episode has no continuity warnings", () => {
  assert.deepEqual(continuityWarnings(episode(), lib), []);
});

test("the same place in the next scene with a light on one side only is told", () => {
  const ep = episode();
  delete ep.scenes[1].isik;
  const w = continuityWarnings(ep, lib);
  assert.equal(w.length, 1);
  assert.match(w[0], /scene s2: same place as s1, but only s1 has a light/);
  ep.scenes[1].gecis = "kesme"; // chosen on purpose
  assert.deepEqual(continuityWarnings(ep, lib), []);
});

test("a person and the narrator heard with one voice are told; a view speaks with its person", () => {
  const ep = episode({ narrator_voice: { hazir: "erkek" } });
  const w = continuityWarnings(ep, lib);
  assert.equal(w.length, 1);
  assert.match(w[0], /"anlatici" and "kadir" speak with the same voice|"kadir" and "anlatici" speak with the same voice/);
  // a perde of its own is enough to tell them apart
  assert.deepEqual(continuityWarnings(episode({ narrator_voice: { hazir: "erkek", perde: -12 } }), lib), []);
});

test("views of one person with a copy of its voice are one speaker; views with different voices are told", () => {
  // kpss-ajani: "kiz, kiz_on and kiz_arka speak with the same voice" — they are one girl
  const viewLib = { ...lib, characters: new Map([["kiz", { meta: {} }], ["kiz-on", { meta: { same_as: "kiz" } }], ["kiz-arkadan", { meta: { same_as: "kiz" } }]]) };
  const v = { hazir: "kadin-2" };
  const ep = episode({
    characters: [{ id: "kiz", rig: "kiz", voice: v }, { id: "kiz_on", rig: "kiz-on", voice: v }, { id: "kiz_arka", rig: "kiz-arkadan", voice: v }],
    narrator_voice: { hazir: "erkek" },
  });
  ep.scenes[0].shots[0].cast = [{ id: "kiz", action: "bekle", mark: "orta" }];
  ep.scenes[0].shots[0].utterances = [{ speaker: "kiz", text: "a" }, { speaker: "anlatici", text: "b" }];
  ep.scenes[1].shots[0].cast = [{ id: "kiz_on", action: "bekle", mark: "orta" }, { id: "kiz_arka", action: "bekle", mark: "sol" }];
  ep.scenes[1].shots[0].utterances = [{ speaker: "kiz_on", text: "c" }, { speaker: "kiz_arka", text: "d" }];
  assert.deepEqual(continuityWarnings(ep, viewLib), []);
  ep.characters[2].voice = { hazir: "kadin" };
  const w = continuityWarnings(ep, viewLib);
  assert.equal(w.length, 1, w.join("\n"));
  assert.match(w[0], /views of one person speak with different voices: "kiz".*"kiz_arka"/);
});

test("a speaker with no voice of its own is told (it would speak with the library's first voice)", () => {
  const ep = episode();
  delete ep.characters[0].voice;
  const w = continuityWarnings(ep, lib).join("\n");
  assert.match(w, /voices: "kadir" has no voice/);
});

test("someone who stops in one spot and starts the next shot far from it is told", () => {
  const ep = episode();
  ep.scenes[0].shots = [
    { shot_id: "a", cast: [{ id: "kopek", action: "kopek-kos", mark: "sag", walk: { dx: -900, time: 1 } }] },
    { shot_id: "b", cast: [{ id: "kopek", action: "kopek-bekle", mark: "sag" }] },
    { shot_id: "c", cast: [{ id: "kopek", action: "kopek-bekle", mark: "sag" }] },
  ];
  const w = continuityWarnings(ep, lib);
  assert.equal(w.length, 1);
  assert.match(w[0], /shot b: "kopek" ended a at x 460 but starts here at x 1360/);
  // a montage after a jump in time (Hurda Kralı 1 s2_sh5, "sabah boyunca dolaştı"): not a jump at the cut
  ep.scenes[0].shots[1].zaman_atlama = true;
  assert.deepEqual(continuityWarnings(ep, lib), []);
});

test("a prop that jumps between hand and floor, or vanishes from a hand, at a cut is told", () => {
  // Hurda Kralı 2: the bag on the floor, in the hand, on the floor again; Hurda Kralı 1: the bottle
  // held up in one shot was gone in the next
  const libActs = { ...lib, actions: new Map([["egil-al", { grab: { t: 0.9 } }], ["cantaya-koy", { release: { t: 0.95 } }], ["bekle", {}]]) };
  const ep = episode();
  const s = (id, cast, props) => ({ shot_id: id, cast, props });
  const k = (action) => [{ id: "kadir", action, mark: "orta" }];
  ep.scenes[0].shots = [
    s("a", k("bekle"), [{ id: "poset", prop: "p", mark: "orta" }, { id: "sise", prop: "s", mark: "orta", holder: "kadir" }]),
    s("b", k("bekle"), [{ id: "poset", prop: "p", mark: "orta", holder: "kadir" }, { id: "sise", prop: "s", mark: "orta", holder: "kadir" }]),
    s("c", k("bekle"), [{ id: "poset", prop: "p", mark: "orta", holder: "kadir" }, { id: "sise", prop: "s", mark: "orta", holder: "kadir" }]),
    s("d", [{ id: "kadir_on", action: "bekle", mark: "orta" }], [{ id: "poset", prop: "p", mark: "orta", holder: "kadir_on" }]),
    // a shot of someone else: what Kadir holds is simply not in it
    s("e", [{ id: "kopek", action: "bekle", mark: "orta" }], []),
  ];
  const w = continuityWarnings(ep, libActs);
  assert.equal(w.length, 2, w.join("\n"));
  assert.match(w[0], /shot b: "poset" lay on the ground in a but is in "kadir"'s hand here/);
  assert.match(w[1], /shot d: "sise" was in "kadir"'s hand in c but is gone here/);
  // picked up on screen, or put away on screen: fine
  ep.scenes[0].shots[1].cast = k("egil-al");
  ep.scenes[0].shots[2].cast = [{ id: "kadir", action: "cantaya-koy", mark: "orta" }];
  assert.deepEqual(continuityWarnings(ep, libActs), []);
});

test("a line naming a time of day the scene's light contradicts is told; habits and other days are not", () => {
  // Hurda Kralı 2: "Ertesi sabah…" over an evening light
  const ep = episode();
  ep.scenes[1].isik = { saat: "aksam" };
  ep.scenes[1].shots[0].utterances = [{ speaker: "anlatici", text: "Ertesi sabah köşede bir araba vardı." }];
  const w = continuityWarnings(ep, lib).join("\n");
  assert.match(w, /lines: shot b: "sabah" is said, but scene s2's light is aksam/);
  ep.scenes[1].shots[0].utterances = [{ speaker: "anlatici", text: "Her sabah aynı köşe. Dün gece de buradaydı." }];
  assert.doesNotMatch(continuityWarnings(ep, lib).join("\n"), /lines:/);
  // a character speaks of other times ("Sabah yola çıkıyoruz", kpss-ajani): only the narrator tells the time
  ep.scenes[1].shots[0].utterances = [{ speaker: "kadir_on", text: "Sabah yola çıkıyoruz. Bu gece parkta." }];
  assert.doesNotMatch(continuityWarnings(ep, lib).join("\n"), /lines:/);
});

test("a number of things said while another number of them is on screen is told", () => {
  // Hurda Kralı 2: "Abi on şişe bu, on!" with six bottles on the scale
  const ep = episode();
  const shot = ep.scenes[1].shots[0];
  shot.props = [0, 1, 2, 3, 4, 5].map((i) => ({ id: `k${i}`, prop: "plastik-sise", mark: "orta", dx: i * 20 }));
  shot.utterances = [{ speaker: "kadir_on", text: "Abi on şişe bu, on!" }];
  assert.match(continuityWarnings(ep, lib).join("\n"), /lines: shot b: "on şişe" is said, but 6 are on screen/);
  shot.utterances = [{ speaker: "kadir_on", text: "Altı şişe, bir kuruş etmez." }];
  assert.doesNotMatch(continuityWarnings(ep, lib).join("\n"), /lines:/);
  // the number is the thing's name (one twenty-lira note), not a count (Hurda Kralı 2)
  shot.props = [{ id: "para", prop: "yirmi-lira", mark: "orta" }];
  shot.utterances = [{ speaker: "kadir_on", text: "Hayatımın ilk parası. Yirmi lira." }];
  assert.doesNotMatch(continuityWarnings(ep, lib).join("\n"), /lines:/);
  shot.props = [];
  shot.utterances = [{ speaker: "kadir_on", text: "Bugün on şişe, yarın on çuval." }]; // none on screen: talk, not a count
  assert.doesNotMatch(continuityWarnings(ep, lib).join("\n"), /lines:/);
});

test("asking to be given what one already holds is told", () => {
  // Hurda Kralı 2: "Ver bakalım" with the money already in Kadir's hand
  const ep = episode();
  const shot = ep.scenes[1].shots[0];
  shot.props = [{ id: "para", prop: "yirmi-lira", mark: "orta", holder: "kadir_on" }];
  shot.utterances = [{ speaker: "kadir_on", text: "Peki abi. Ver bakalım." }];
  assert.match(continuityWarnings(ep, lib).join("\n"), /lines: shot b: "kadir_on" says "ver" but already holds "para"/);
  shot.props[0].holder = undefined;
  assert.doesNotMatch(continuityWarnings(ep, lib).join("\n"), /lines:/);
});

test("the prop ledger: a thing in a hand from nowhere, more things at a cut, a thing out of reach", () => {
  const acts = { ...lib, actions: new Map([["egil-al", { grab: { t: 0.9 } }], ["bekle", {}]]) };
  const ep = episode();
  const s = (id, framing, cast, props) => ({ shot_id: id, cast, props, camera: { framing } });
  const k = [{ id: "kadir", action: "bekle", mark: "sol" }];
  // Hurda Kralı 2 s3_sh2: the note was suddenly in Necmi's hand
  ep.scenes[0].shots = [s("a", "medium", k, []), s("b", "medium", k, [{ id: "para", prop: "yirmi-lira", mark: "sol", holder: "kadir" }])];
  assert.match(continuityWarnings(ep, acts).join("\n"), /shot b: "para" \(yirmi-lira\) is in "kadir"'s hand, but was nowhere in a/);
  // seen in a closer shot first, then more of them wide: what was off frame comes into view
  ep.scenes[0].shots = [
    s("a", "close", k, [{ id: "s0", prop: "plastik-sise", mark: "orta" }]),
    s("b", "wide", k, [0, 1, 2].map((i) => ({ id: `k${i}`, prop: "plastik-sise", mark: "orta", dx: i * 30 }))),
  ];
  assert.doesNotMatch(continuityWarnings(ep, acts).join("\n"), /plastik-sise/);
  // as wide as before, and three appear where one stood: they came from nowhere
  ep.scenes[0].shots[0].camera.framing = "wide";
  assert.match(continuityWarnings(ep, acts).join("\n"), /shot b: plastik-sise: 1 on screen in a, 3 here/);
  // a prop parked far from the hand that picks it up (Hurda Kralı 2: para_k at sag +600)
  ep.scenes[0].shots = [s("a", "wide", [{ id: "kadir", action: "egil-al", mark: "sol" }], [{ id: "p", prop: "yirmi-lira", mark: "sag", dx: 600, holder: "kadir" }])];
  assert.match(continuityWarnings(ep, acts).join("\n"), /shot a: "p" lies 1400 from "kadir", out of reach of the hand/);
  // taken out of a bag or a pocket (gizli): it lies nowhere, so nothing is out of reach
  ep.scenes[0].shots[0].props[0].gizli = true;
  assert.doesNotMatch(continuityWarnings(ep, acts).join("\n"), /out of reach/);
});

test("a drawing listed as missing that the library has now is told", () => {
  const w = continuityWarnings(episode({ new_assets: [{ name: "karton-yatak", type: "prop" }, { name: "cop-torbasi", type: "prop" }] }), lib);
  assert.deepEqual(w, ['new_assets: "karton-yatak" is in the library now; take it off the list']);
});
