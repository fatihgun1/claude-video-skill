// Approval fingerprints (plan v3, Faz 0.6-0.7): the script gate locks the words only; the storyboard
// gate also covers character data, decor and voice presets; approvals given before stay valid.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scriptFingerprint, libraryFingerprint, storyboardFingerprint, approve, readApprovals, gateStatus } from "../src/onay.mjs";

const lib = () => ({
  world: { w: 1 }, cameras: { c: 1 }, profiles: new Map([["genel", { p: 1 }]]),
  actions: new Map([["bekle", { duration: 1 }]]),
  characters: new Map([["kadir", { svg: "<svg/>", meta: { face_y: 125 } }]]),
  backgrounds: new Map([["sokak", "<svg/>"]]),
  props: new Map([["bank", { svg: "<svg>bank</svg>" }]]),
  voices: new Map([["kadin", { edge: "tr-TR-EmelNeural" }], ["erkek", { edge: "tr-TR-AhmetNeural" }]]),
});
const episode = () => ({
  episode: "a", language: "tr", characters: [{ id: "kadir", rig: "kadir", voice: { hazir: "erkek" } }], narrator_voice: { hazir: "kadin" },
  scenes: [{ scene_id: "s1", bg: "sokak", dekor: [{ id: "b", prop: "bank", x: 900 }], shots: [{ shot_id: "s1_sh1", cast: [{ id: "kadir", action: "bekle", mark: "orta" }], utterances: [{ speaker: "kadir", text: "Merhaba." }], camera: { framing: "wide" } }] }],
});
const dir = () => join(mkdtempSync(join(tmpdir(), "onay-izi-")), "bolum.json");

test("the script approval locks the words only: adding, splitting or renaming a silent shot keeps it", () => {
  // Hurda Kralı 1: the person approved the same script again and again after shot edits
  const path = dir();
  const ep = episode();
  approve(path, "senaryo", scriptFingerprint(ep));
  ep.scenes[0].shots.push({ shot_id: "s1_sh2", cast: [{ id: "kadir", action: "bekle", mark: "orta" }], camera: { framing: "medium" } });
  ep.scenes[0].shots[0].shot_id = "s1_sh1a";
  assert.equal(gateStatus(readApprovals(path), "senaryo", scriptFingerprint(ep)), "onayli");
  ep.scenes[0].shots[0].utterances[0].text = "Selam.";
  assert.equal(gateStatus(readApprovals(path), "senaryo", scriptFingerprint(ep)), "eskimis");
});

test("an approval recorded with the earlier fingerprint stays valid until something changes", () => {
  const path = dir();
  const ep = episode();
  const [, legacy] = scriptFingerprint(ep).split("|");
  writeFileSync(path.replace("bolum.json", "onay.json"), JSON.stringify({ senaryo: { fingerprint: legacy, at: "x" } }));
  assert.equal(gateStatus(readApprovals(path), "senaryo", scriptFingerprint(ep)), "onayli");
  approve(path, "senaryo", scriptFingerprint(ep));
  assert.equal(readApprovals(path).senaryo.fingerprint.includes("|"), false, "one fingerprint is recorded");
});

test("the storyboard fingerprint covers character data, decor props and voice presets", () => {
  const ep = episode();
  const base = storyboardFingerprint(ep, null, libraryFingerprint(ep, lib()));
  const changed = (edit) => { const l = lib(); edit(l); return storyboardFingerprint(ep, null, libraryFingerprint(ep, l)).split("|")[0]; };
  assert.notEqual(changed((l) => { l.characters.get("kadir").meta.face_y = 300; }), base.split("|")[0], "face_y reframes shots");
  assert.notEqual(changed((l) => { l.props.get("bank").svg = "<svg>yeni</svg>"; }), base.split("|")[0], "a decor prop redrawn");
  assert.notEqual(changed((l) => { l.voices.get("erkek").edge = "tr-TR-Baska"; }), base.split("|")[0], "a voice preset remapped");
  // an approval of the earlier fingerprint: still valid while none of that changed
  const path = dir();
  writeFileSync(path.replace("bolum.json", "onay.json"), JSON.stringify({ storyboard: { fingerprint: base.split("|")[1], at: "x" } }));
  assert.equal(gateStatus(readApprovals(path), "storyboard", base), "onayli");
});
