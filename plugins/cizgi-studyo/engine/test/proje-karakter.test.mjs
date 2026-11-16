// Characters and actions in the project library (<project>/kutuphane/characters, .../actions),
// and their drafts in kutuphane/taslak, taken in by the person from the panel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadLibrary } from "../src/library.mjs";
import { validateEpisode } from "../src/validate.mjs";
import { listDrafts, draftSvg, approveDraft, rejectDraft } from "../src/proje-kutuphane.mjs";
import { draftFile } from "../src/panel-taslak.mjs";

const LIB = fileURLToPath(new URL("../../library", import.meta.url));

function project() {
  const root = mkdtempSync(join(tmpdir(), "cizgi-pkar-"));
  const kut = join(root, "kutuphane");
  mkdirSync(kut, { recursive: true });
  return kut;
}
function putCharacter(dir, id, from = "genc") {
  mkdirSync(join(dir, id), { recursive: true });
  copyFileSync(join(LIB, "characters", from, "rig.svg"), join(dir, id, "rig.svg"));
  copyFileSync(join(LIB, "characters", from, "character.json"), join(dir, id, "character.json"));
}
function putAction(dir, id, from = "bak") {
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(LIB, "actions", `${from}.json`), join(dir, `${id}.json`));
}
const episode = (rig, action) => ({
  episode: "deneme", language: "tr",
  characters: [{ id: "a", rig }],
  scenes: [{ scene_id: "s1", bg: "sokak", shots: [{ shot_id: "s1_sh1", cast: [{ id: "a", action, mark: "orta" }], camera: { framing: "wide", move: "static", target: "a" } }] }],
});

test("project characters and actions join the library and episodes can use them", () => {
  const kut = project();
  putCharacter(join(kut, "characters"), "ali");
  putAction(join(kut, "actions"), "bekle-ali");
  const lib = loadLibrary(LIB, { project: kut });
  assert.ok(lib.characters.has("ali"));
  assert.ok(lib.actions.has("bekle-ali"));
  assert.deepEqual(lib.projectErrors, []);
  assert.equal(validateEpisode(episode("ali", "bekle-ali"), lib).ok, true);
});

test("a project character or action with a name the plugin uses is left out", () => {
  const kut = project();
  putCharacter(join(kut, "characters"), "genc", "pamuk");
  putAction(join(kut, "actions"), "bak", "selam");
  const lib = loadLibrary(LIB, { project: kut });
  assert.equal(lib.characters.get("genc").svg, readFileSync(join(LIB, "characters", "genc", "rig.svg"), "utf8"));
  assert.deepEqual(lib.actions.get("bak"), JSON.parse(readFileSync(join(LIB, "actions", "bak.json"), "utf8")));
  assert.ok(lib.projectErrors.some((e) => /character genc/.test(e) && /already/.test(e)), lib.projectErrors.join("\n"));
  assert.ok(lib.projectErrors.some((e) => /action bak/.test(e) && /already/.test(e)), lib.projectErrors.join("\n"));
});

test("a broken project character or action is left out and reported, not fatal", () => {
  const kut = project();
  mkdirSync(join(kut, "characters", "bozuk"), { recursive: true });
  writeFileSync(join(kut, "characters", "bozuk", "rig.svg"), "<svg/>");
  writeFileSync(join(kut, "characters", "bozuk", "character.json"), "{}");
  mkdirSync(join(kut, "characters", "yarim"), { recursive: true }); // no files at all
  mkdirSync(join(kut, "actions"), { recursive: true });
  writeFileSync(join(kut, "actions", "kirik.json"), "{ yarım");
  const lib = loadLibrary(LIB, { project: kut });
  assert.ok(!lib.characters.has("bozuk") && !lib.characters.has("yarim") && !lib.actions.has("kirik"));
  for (const id of ["bozuk", "yarim", "kirik"]) assert.ok(lib.projectErrors.some((e) => e.includes(id)), `${id}: ${lib.projectErrors.join("\n")}`);
});

test("character and action drafts are listed, previewed, taken in and put aside", () => {
  const kut = project();
  putCharacter(join(kut, "taslak", "characters"), "veli");
  putAction(join(kut, "taslak", "actions"), "bekle-veli");
  putCharacter(join(kut, "taslak", "characters"), "red");
  let lib = loadLibrary(LIB, { project: kut });
  const drafts = listDrafts(kut, lib);
  const byId = Object.fromEntries(drafts.map((d) => [d.id, d]));
  assert.equal(byId.veli.tur, "karakter");
  assert.equal(byId.veli.ok, true, byId.veli.errors.join("; "));
  assert.equal(byId["bekle-veli"].tur, "hareket");
  assert.equal(byId["bekle-veli"].ok, true, byId["bekle-veli"].errors.join("; "));
  assert.ok(!lib.characters.has("veli"), "a draft is not usable yet");

  assert.match(draftSvg(kut, "karakter", "veli", lib), /<svg/);
  assert.match(draftFile("/kutuphane-taslak/karakter/veli.svg", { project: kut, loadLib: () => lib }), /<svg/);

  approveDraft(kut, "karakter", "veli", lib);
  approveDraft(kut, "hareket", "bekle-veli", lib);
  rejectDraft(kut, "karakter", "red");
  assert.ok(existsSync(join(kut, "characters", "veli", "rig.svg")));
  assert.ok(existsSync(join(kut, "actions", "bekle-veli.json")));
  assert.ok(readdirSync(join(kut, "taslak", "_reddedilen")).some((n) => n.startsWith("karakter-red-")));
  lib = loadLibrary(LIB, { project: kut });
  assert.ok(lib.characters.has("veli") && lib.actions.has("bekle-veli"));
  assert.deepEqual(listDrafts(kut, lib), []);
});

test("a concept sketch is served from taslak/konsept only when its SVG is safe", () => {
  const kut = project();
  mkdirSync(join(kut, "taslak", "konsept"), { recursive: true });
  writeFileSync(join(kut, "taslak", "konsept", "ali.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5"/></svg>');
  writeFileSync(join(kut, "taslak", "konsept", "kotu.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const ctx = { project: kut, loadLib: () => loadLibrary(LIB, { project: kut }) };
  assert.match(draftFile("/kutuphane-taslak/konsept/ali.svg", ctx), /<rect/);
  assert.throws(() => draftFile("/kutuphane-taslak/konsept/kotu.svg", ctx), (e) => e.code === 404);
  assert.throws(() => draftFile("/kutuphane-taslak/konsept/yok.svg", ctx), (e) => e.code === 404);
  assert.equal(draftFile("/kutuphane-taslak/konsept/../x.svg", ctx), undefined);
});

test("a broken character draft cannot be taken in and says why", () => {
  const kut = project();
  mkdirSync(join(kut, "taslak", "characters", "kotu"), { recursive: true });
  writeFileSync(join(kut, "taslak", "characters", "kotu", "rig.svg"), "<svg/>");
  const lib = loadLibrary(LIB, { project: kut });
  const [d] = listDrafts(kut, lib);
  assert.equal(d.ok, false);
  assert.ok(d.errors.some((e) => /character\.json/.test(e)), d.errors.join("; "));
  assert.throws(() => approveDraft(kut, "karakter", "kotu", lib));
});

test("a draft named like an existing character is refused", () => {
  const kut = project();
  putCharacter(join(kut, "taslak", "characters"), "genc");
  const lib = loadLibrary(LIB, { project: kut });
  const [d] = listDrafts(kut, lib);
  assert.equal(d.ok, false);
  assert.ok(d.taken);
});

test("a character draft with a detail that slides on a bending limb cannot be taken in", () => {
  const kut = project();
  putCharacter(join(kut, "taslak", "characters"), "yamali");
  const rigFile = join(kut, "taslak", "characters", "yamali", "rig.svg");
  writeFileSync(rigFile, readFileSync(rigFile, "utf8").replace(/(<g id="arm_L"[^>]*>)/, '$1<rect x="515" y="420" width="18" height="18" fill="#863"/>'));
  const lib = loadLibrary(LIB, { project: kut });
  const [d] = listDrafts(kut, lib);
  assert.equal(d.ok, false);
  assert.ok(d.errors.some((e) => /arm_L/.test(e) && /slide/.test(e)), d.errors.join("; "));
});

test("an episode whose character has such a detail is valid, with a warning", () => {
  const kut = project();
  putCharacter(join(kut, "characters"), "yamali");
  const rigFile = join(kut, "characters", "yamali", "rig.svg");
  writeFileSync(rigFile, readFileSync(rigFile, "utf8").replace(/(<g id="arm_L"[^>]*>)/, '$1<rect x="515" y="420" width="18" height="18" fill="#863"/>'));
  const lib = loadLibrary(LIB, { project: kut });
  assert.ok(lib.characters.has("yamali"), "it still loads");
  const res = validateEpisode(episode("yamali", "bak"), lib);
  assert.equal(res.ok, true);
  assert.ok(res.warnings.some((w) => /yamali/.test(w) && /slide/.test(w)), res.warnings.join("\n"));
});
