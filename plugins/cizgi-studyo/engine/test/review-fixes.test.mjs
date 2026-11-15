/* Regression tests for the Faz 1 code-review findings. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadLibrary, checkAction, checkSettings } from "../src/library.mjs";
import { validateEpisode } from "../src/validate.mjs";
import { checkRig, checkSvgSafety, prefixIds } from "../src/rigspec.mjs";
import { compileEpisode, readAudioInfo, safeJoin } from "../src/compile.mjs";
import { readJson } from "../src/util.mjs";
import { wavDuration } from "../src/timing.mjs";

const LIB_DIR = fileURLToPath(new URL("../../library", import.meta.url));
const lib = loadLibrary(LIB_DIR);
const rig = readFileSync(join(LIB_DIR, "characters", "pamuk", "rig.svg"), "utf8");
const tmp = () => mkdtempSync(join(tmpdir(), "cizgi-rf-"));

function episode() {
  return {
    episode: "deneme",
    language: "tr",
    characters: [{ id: "pamuk", rig: "pamuk" }],
    scenes: [{ scene_id: "s1", bg: "cayir", shots: [{ shot_id: "a", cast: [{ id: "pamuk", action: "selam", mark: "orta" }], camera: { framing: "wide" } }] }],
  };
}

test("HIGH: Object.prototype names cannot pass as camera framing or move", () => {
  for (const camera of [{ framing: "constructor" }, { framing: "wide", move: "constructor" }, { framing: "tostring" }]) {
    const ep = episode();
    ep.scenes[0].shots[0].camera = camera;
    assert.equal(validateEpisode(ep, lib).ok, false, JSON.stringify(camera));
  }
});

test("palette keys must be declared colours of the rig and cannot inject CSS", () => {
  const ep = episode();
  ep.characters[0].palette = { accent: "#123456" };
  assert.equal(validateEpisode(ep, lib).ok, true);
  ep.characters[0].palette = { sac: "#123456" };
  assert.ok(validateEpisode(ep, lib).errors.join().includes('palette "sac"'));
  ep.characters[0].palette = { "x;background:url(http://e)": "#123456" };
  assert.ok(validateEpisode(ep, lib).errors[0].startsWith("schema"));
});

test("scene ids must be unique", () => {
  const ep = episode();
  ep.scenes.push({ ...ep.scenes[0], shots: [{ ...ep.scenes[0].shots[0], shot_id: "b" }] });
  assert.ok(validateEpisode(ep, lib).errors.join().includes('scene id "s1" is used twice'));
});

test("library loader skips stray files and rejects bad ids and settings", () => {
  const dir = tmp();
  cpSync(LIB_DIR, dir, { recursive: true });
  writeFileSync(join(dir, "characters", "Thumbs.db"), "x");
  assert.ok(loadLibrary(dir).characters.has("pamuk"));
  writeFileSync(join(dir, "actions", "Kotu Ad.json"), JSON.stringify({ duration: 1, keys: [{ t: 0, pose: {} }] }));
  assert.throws(() => loadLibrary(dir), /action "Kotu Ad"/);
});

test("checkSettings requires world fields, all marks and a static move", () => {
  const errs = checkSettings({ width: 1920, marks: { sol: 1 } }, { framings: { wide: { zoom: 0.5 } }, moves: { push: { zoom_to: "x", ease: "zoom" } } }).join("\n");
  for (const s of ["height must be", "marks.orta", 'include "static"', "zoom >= 1", "push.zoom_to", 'unknown ease "zoom"']) {
    assert.ok(errs.includes(s), s);
  }
  assert.ok(checkSettings({}, {}).some((e) => e.includes("needs framings")));
});

test("checkAction rejects unknown channels, non-numbers, unknown eases, null keys and open loops", () => {
  const errs = checkAction(
    { duration: 1, loop: true, keys: [{ t: 0, pose: { arm_L_uper: 3, head: "5" } }, null, { t: 0.5, pose: {}, ease: "bounce" }] },
    "x",
  ).join("\n");
  for (const s of ['unknown pose channel "arm_L_uper"', "head must be a number", "must be an object", 'unknown ease "bounce"', "last key at t=duration"]) {
    assert.ok(errs.includes(s), s);
  }
});

test("SVG safety: script, handlers, external references are rejected", () => {
  assert.deepEqual(checkSvgSafety(rig), []);
  const cases = {
    "<script>": `<svg><script>alert(1)</script></svg>`,
    "event handler": `<svg><g onload="x()"/></svg>`,
    "#fragment href": `<svg><use href="http://e/x.svg#a"/></svg>`,
    "url(#fragment)": `<svg><rect fill="url(http://e/p.png)"/></svg>`,
    "<foreignObject>": `<svg><foreignObject/></svg>`,
  };
  for (const [msg, svg] of Object.entries(cases)) assert.ok(checkSvgSafety(svg).join().includes(msg), msg);
  assert.deepEqual(checkSvgSafety(`<svg><!-- <script> --><rect fill="url(#g)"/></svg>`), []);
  // a script hidden behind a namespace prefix, or an animation that turns a link into javascript:
  assert.ok(checkSvgSafety('<svg xmlns="http://www.w3.org/2000/svg" xmlns:s="http://www.w3.org/2000/svg"><s:script>alert(1)</s:script></svg>').length);
  assert.ok(checkSvgSafety('<svg><a><set attributeName="href" to="javascript:alert(1)"/><rect/></a></svg>').length);
  assert.ok(checkSvgSafety('<svg><rect><set attributeName="onclick" to="alert(1)"/></rect></svg>').length);
  assert.deepEqual(checkSvgSafety('<svg xmlns="http://www.w3.org/2000/svg"><rect><animate attributeName="opacity" values="0;1" dur="1s"/></rect></svg>'), []);
  assert.ok(checkRig(rig.replace("<g id=\"root\">", '<g id="root"><script/>')).some((e) => e.includes("<script>")));
});

test("rig checker: single-quoted transform, duplicate ids and viseme visibility", () => {
  const bad = rig
    .replace('<g id="hand_L"', `<g id='hand_L' transform='rotate(3)'`)
    .replace('<g id="ear_R"', '<g id="head"')
    .replace('<g id="mouth_O" display="none">', '<g id="mouth_O">')
    .replace('<g id="mouth_rest">', '<g id="mouth_rest" display="none">');
  const errs = checkRig(bad).join("\n");
  for (const s of ["#hand_L must not have a transform", "#head is used twice", '#mouth_O needs display="none"', "#mouth_rest must be visible"]) {
    assert.ok(errs.includes(s), s);
  }
});

test("prefixIds handles quotes and leaves data-id alone", () => {
  assert.equal(
    prefixIds(`<g id='a' data-id="z"><rect fill="url('#g')"/><use href='#a'/></g>`, "p"),
    `<g id='p--a' data-id="z"><rect fill="url('#p--g')"/><use href='#p--a'/></g>`,
  );
});

test("BOM-prefixed JSON reads fine", () => {
  const f = join(tmp(), "bom.json");
  writeFileSync(f, "﻿{\"a\":1}");
  assert.deepEqual(readJson(f), { a: 1 });
  writeFileSync(f, "{bad");
  assert.throws(() => readJson(f), /cannot read .*bom\.json/);
});

test("safeJoin allows names starting with '..' inside the folder", () => {
  const dir = tmp();
  assert.ok(safeJoin(dir, "..ses.wav").endsWith("..ses.wav"));
  assert.throws(() => safeJoin(dir, ".."), /escapes/);
});

test("sidecar shape is validated; untimed words keep their text", () => {
  const dir = tmp();
  const wav = Buffer.alloc(44 + 1600);
  wav.write("RIFF", 0); wav.write("WAVE", 8); wav.write("fmt ", 12); wav.writeUInt32LE(16, 16);
  wav.writeUInt32LE(1600, 28); wav.write("data", 36); wav.writeUInt32LE(1600, 40);
  writeFileSync(join(dir, "a.wav"), wav);
  writeFileSync(join(dir, "a.words.json"), JSON.stringify([{ word: "bir", start: 0.1, end: 0.2 }, { word: "iki" }]));
  const info = readAudioInfo(join(dir, "a.wav"));
  assert.deepEqual(info.words[1], { word: "iki", start: null, end: null });
  writeFileSync(join(dir, "a.words.json"), "{}");
  assert.throws(() => readAudioInfo(join(dir, "a.wav")), /expected an array/);
  writeFileSync(join(dir, "a.words.json"), "[]");
  writeFileSync(join(dir, "a.rhubarb.json"), JSON.stringify({ cues: [] }));
  assert.throws(() => readAudioInfo(join(dir, "a.wav")), /mouthCues/);
});

test("truncated or zero-rate WAV headers give clear errors", () => {
  const wav = Buffer.alloc(44);
  wav.write("RIFF", 0); wav.write("WAVE", 8); wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.write("data", 36);
  assert.throws(() => wavDuration(wav), /byte rate is 0/);
  const short = Buffer.alloc(24);
  short.write("RIFF", 0); short.write("WAVE", 8); short.write("fmt ", 12); short.writeUInt32LE(16, 16);
  assert.throws(() => wavDuration(short), /truncated/);
});

test("compile: unknown format is refused and root attributes are well formed", () => {
  const dir = tmp();
  mkdirSync(join(dir, "ses"));
  const ep = episode();
  writeFileSync(join(dir, "bolum.json"), JSON.stringify(ep));
  assert.throws(() => compileEpisode(join(dir, "bolum.json"), lib, join(dir, "p"), { format: "4:3" }), /unknown format "4:3"/);
  assert.throws(() => compileEpisode(join(dir, "bolum.json"), lib, join(dir, "p"), { format: "constructor" }), /unknown format/);
  compileEpisode(join(dir, "bolum.json"), lib, join(dir, "p"));
  const html = readFileSync(join(dir, "p", "index.html"), "utf8");
  assert.match(html, /data-no-timeline data-start="0" data-width="1920" data-height="1080" data-duration="/);
});
