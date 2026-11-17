// A face outside speech: cast[].ifade ("gulumse" for the whole shot, or a list of moments).
// While the character speaks the mouth follows the speech; in its silences (and outside lines)
// it shows the expression.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import "../src/runtime/core.js";
import { loadLibrary } from "../src/library.mjs";
import { validateEpisode } from "../src/validate.mjs";

const C = globalThis.CizgiCore;
const lib = loadLibrary(fileURLToPath(new URL("../../library", import.meta.url)));

test("no ifade is a neutral face", () => {
  assert.equal(C.expressionAt({ id: "a" }, 1), "notr");
});

test("one ifade holds for the whole shot", () => {
  assert.equal(C.expressionAt({ ifade: "gulumse" }, 0), "gulumse");
  assert.equal(C.expressionAt({ ifade: "gulumse" }, 9), "gulumse");
});

test("a list changes the face at its moments, neutral before the first", () => {
  const m = { ifade: [{ ifade: "gulumse", at: 1.5 }, { ifade: "notr", at: 3 }] };
  assert.equal(C.expressionAt(m, 1), "notr");
  assert.equal(C.expressionAt(m, 1.5), "gulumse");
  assert.equal(C.expressionAt(m, 2.9), "gulumse");
  assert.equal(C.expressionAt(m, 3), "notr");
  const unordered = { ifade: [{ ifade: "notr", at: 3 }, { ifade: "gulumse", at: 1 }] };
  assert.equal(C.expressionAt(unordered, 2), "gulumse");
});

test("the mouth: speech first, the expression in its silences and outside lines", () => {
  assert.equal(C.mouthAt("mouth_A", "gulumse"), "mouth_A");
  assert.equal(C.mouthAt("mouth_rest", "gulumse"), "mouth_smile");
  assert.equal(C.mouthAt("mouth_rest", "notr"), "mouth_rest");
});

const episode = (ifade) => ({
  episode: "deneme", language: "tr",
  characters: [{ id: "genc", rig: "genc" }],
  scenes: [{ scene_id: "s1", bg: "sokak", shots: [{ shot_id: "s1_sh1", cast: [{ id: "genc", action: "bak", mark: "orta", ifade }], camera: { framing: "close", move: "static", target: "genc" } }] }],
});

test("the schema takes an expression or a list of moments, nothing else", () => {
  assert.equal(validateEpisode(episode("gulumse"), lib).ok, true);
  assert.equal(validateEpisode(episode([{ ifade: "gulumse", at: 0.5 }]), lib).ok, true);
  for (const face of ["notr", "kizgin", "uzgun", "sasirmis", "korkmus"]) assert.equal(validateEpisode(episode(face), lib).ok, true, face);
  assert.equal(validateEpisode(episode([{ ifade: "kizgin", at: 0 }, { ifade: "korkmus", at: 1 }]), lib).ok, true);
  assert.equal(validateEpisode(episode("ofkeli"), lib).ok, false);
  assert.equal(validateEpisode(episode([{ ifade: "ofkeli", at: 0 }]), lib).ok, false);
  assert.equal(validateEpisode(episode([{ ifade: "gulumse", at: -1 }]), lib).ok, false);
  assert.equal(validateEpisode(episode([{ ifade: "gulumse" }]), lib).ok, false);
});

// ---- expressions beyond the smile: brows (also while speaking) and expression mouths (runtime/yuz.js) ----
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import "../src/runtime/yuz.js";
import { checkRig, parseGroups } from "../src/rigspec.mjs";
import { compileEpisode } from "../src/compile.mjs";

const Y = globalThis.CizgiYuz;

test("the shot's ifade wins; without it the spoken line's duygu gives the face", () => {
  assert.equal(Y.faceAt({ ifade: "kizgin" }, 0, { duygu: "neseli" }), "kizgin");
  assert.equal(Y.faceAt({ ifade: "notr" }, 0, { duygu: "kizgin" }), "notr", "an explicit neutral face stays neutral");
  assert.equal(Y.faceAt({}, 0, { duygu: "kizgin" }), "kizgin");
  assert.equal(Y.faceAt({}, 0, { duygu: "uzgun" }), "uzgun");
  assert.equal(Y.faceAt({}, 0, { duygu: "korkmus" }), "korkmus");
  assert.equal(Y.faceAt({}, 0, { duygu: "heyecanli" }), "sasirmis");
  assert.equal(Y.faceAt({}, 0, { duygu: "neseli" }), "gulumse");
  assert.equal(Y.faceAt({}, 0, { duygu: "sakin" }), "notr");
  assert.equal(Y.faceAt({}, 0, {}), "notr");
  assert.equal(Y.faceAt({}, 0, null), "notr", "not speaking: neutral");
});

test("speech wins the mouth; in silences each expression shows its mouth when the drawing has it", () => {
  const all = () => true;
  assert.equal(Y.mouthFor("mouth_A", "kizgin", all), "mouth_A");
  assert.equal(Y.mouthFor("mouth_rest", "kizgin", all), "mouth_angry");
  assert.equal(Y.mouthFor("mouth_rest", "uzgun", all), "mouth_sad");
  assert.equal(Y.mouthFor("mouth_rest", "sasirmis", all), "mouth_O");
  assert.equal(Y.mouthFor("mouth_rest", "gulumse", all), "mouth_smile");
  assert.equal(Y.mouthFor("mouth_rest", "notr", all), "mouth_rest");
  assert.equal(Y.mouthFor("mouth_rest", "kizgin", (m) => m !== "mouth_angry"), "mouth_rest", "no angry mouth: neutral");
});

test("angry brows turn their inner ends down, sad ones up, whichever side they are on", () => {
  const [left, right] = Y.innerSides([[498, 117], [553, 116]]);
  assert.deepEqual([left, right], [1, -1]);
  assert.deepEqual(Y.innerSides([[562, 104]]), [1], "one brow (profile): the inner end is toward the nose");
  assert.equal(Y.browTransform("notr", 1, 498, 117), "");
  assert.match(Y.browTransform("kizgin", left, 498, 117), /rotate\(24 498 117\)/);
  assert.match(Y.browTransform("kizgin", right, 553, 116), /rotate\(-24 553 116\)/);
  assert.ok(Y.BROWS.uzgun.tilt < 0 && Y.BROWS.korkmus.tilt < 0 && Y.BROWS.sasirmis.lift < 0);
});

test("the rig check takes brows and expression mouths and refuses them drawn wrong", () => {
  const svg = readFileSync(fileURLToPath(new URL("../../library/characters/genc-on/rig.svg", import.meta.url)), "utf8");
  assert.deepEqual(checkRig(svg), []);
  const g = parseGroups(svg);
  for (const p of ["brow_L", "brow_R", "mouth_sad", "mouth_angry"]) assert.ok(g.has(p), p);
  assert.ok(checkRig(svg.replace('id="mouth_sad" display="none"', 'id="mouth_sad"')).some((e) => e.includes("#mouth_sad needs display")));
  assert.ok(checkRig(svg.replace(/(id="brow_L") data-pivot="[^"]*"/, "$1")).some((e) => e.includes("#brow_L needs data-pivot")));
});

const faceEpisode = (rig, member, utterances) => ({
  episode: "deneme", language: "tr",
  characters: [{ id: "k", rig }],
  scenes: [{ scene_id: "s1", bg: "sokak", shots: [{ shot_id: "s1_sh1", ...(utterances ? { utterances } : {}), cast: [{ id: "k", action: "bekle", mark: "orta", ...member }], camera: { framing: "close", move: "static", target: "k" } }] }],
});
const faceWarnings = (ep) => validateEpisode(ep, lib).warnings.filter((w) => w.includes("face"));

test("a drawing without the parts warns and shows a neutral face, never an error", () => {
  const angry = validateEpisode(faceEpisode("pamuk", { ifade: "kizgin" }), lib);
  assert.equal(angry.ok, true);
  assert.ok(angry.warnings.some((w) => /has no angry face \(no brow_L\/brow_R, mouth_angry\)/.test(w)), angry.warnings.join("\n"));
  assert.equal(faceWarnings(faceEpisode("genc-on", { ifade: "kizgin" })).length, 0, "a drawing with the parts");
  assert.equal(faceWarnings(faceEpisode("genc-arka", { ifade: "kizgin" })).length, 0, "a back view shows no face");
  assert.equal(faceWarnings(faceEpisode("pamuk", { ifade: "gulumse" })).length, 0, "every rig can smile");
  const spoken = faceWarnings(faceEpisode("pamuk", {}, [{ speaker: "k", text: "Yine mi sen!", duygu: "kizgin" }]));
  assert.equal(spoken.length, 1, "a line's feeling asks for the face too");
  assert.equal(faceWarnings(faceEpisode("pamuk", { ifade: [{ ifade: "uzgun", at: 0 }, { ifade: "uzgun", at: 1 }] })).length, 1, "once per drawing and face");
});

test("a rig with expression parts compiles and the face code reaches the page", () => {
  const dir = mkdtempSync(join(tmpdir(), "cizgi-ifade-"));
  writeFileSync(join(dir, "bolum.json"), JSON.stringify(faceEpisode("genc-on", { ifade: [{ ifade: "kizgin", at: 0 }, { ifade: "korkmus", at: 1 }] })));
  const out = join(dir, "proje");
  compileEpisode(join(dir, "bolum.json"), lib, out, { format: "9:16" });
  const html = readFileSync(join(out, "index.html"), "utf8");
  for (const id of ["brow_L", "brow_R", "mouth_sad", "mouth_angry"]) assert.ok(html.includes(`id="k--${id}"`), id);
  assert.ok(html.indexOf('src="runtime/yuz.js"') > html.indexOf('src="runtime/core.js"'));
  assert.ok(html.indexOf('src="runtime/yuz.js"') < html.indexOf('src="runtime/player.js"'));
  assert.ok(readFileSync(join(out, "runtime", "player.js"), "utf8").includes("Y.browTransform"));
});

test("fear shows the scared mouth, or the speech mouth_E on a drawing without it; the eyes widen or narrow", () => {
  assert.equal(Y.mouthFor("mouth_rest", "korkmus", () => true), "mouth_scared");
  assert.equal(Y.mouthFor("mouth_rest", "korkmus", (m) => m !== "mouth_scared"), "mouth_E");
  assert.equal(Y.eyeTransform("notr", 498, 140), "");
  assert.equal(Y.eyeTransform("sasirmis", 498, 140), "translate(498 140) scale(1.2 1.3) translate(-498 -140)");
  assert.ok(Y.EYES.kizgin[1] < 1 && Y.EYES.korkmus[1] > 1);
  const svg = readFileSync(fileURLToPath(new URL("../../library/characters/genc-on/rig.svg", import.meta.url)), "utf8");
  assert.ok(parseGroups(svg).get("eye_L").attrs["data-pivot"]);
  assert.ok(checkRig(svg.replace(/(id="eye_L") data-pivot="[^"]*"/, '$1 data-pivot="x"')).some((e) => e.includes("#eye_L: data-pivot")));
});
