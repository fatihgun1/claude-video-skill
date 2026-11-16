// A new version of a drawing already in the project library (same id), taking several drafts in
// at once, and which episode a draft was drawn for (kutuphane/taslak/notlar.json).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadLibrary } from "../src/library.mjs";
import { listDrafts, approveDraft, approveAll, rejectDraft } from "../src/proje-kutuphane.mjs";

const LIB = fileURLToPath(new URL("../../library", import.meta.url));
const PROP = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 200" data-grip="50,40" data-base="50,200"><rect width="100" height="200" fill="${fill}"/></svg>`;

function project() {
  const kut = join(mkdtempSync(join(tmpdir(), "cizgi-guncel-")), "kutuphane");
  mkdirSync(kut, { recursive: true });
  return kut;
}
function putCharacter(dir, id) {
  mkdirSync(join(dir, id), { recursive: true });
  copyFileSync(join(LIB, "characters", "genc", "rig.svg"), join(dir, id, "rig.svg"));
  copyFileSync(join(LIB, "characters", "genc", "character.json"), join(dir, id, "character.json"));
}
const lib = (kut) => loadLibrary(LIB, { project: kut });

test("a draft with the id of a project drawing is an update, not an error", () => {
  const kut = project();
  mkdirSync(join(kut, "props"));
  writeFileSync(join(kut, "props", "brosur.svg"), PROP("#aaa"));
  mkdirSync(join(kut, "taslak", "props"), { recursive: true });
  writeFileSync(join(kut, "taslak", "props", "brosur.svg"), PROP("#f00"));
  const [d] = listDrafts(kut, lib(kut));
  assert.equal(d.ok, true, d.errors.join("; "));
  assert.equal(d.guncelleme, true);
});

test("taking an update in replaces the drawing and keeps the old one aside", () => {
  const kut = project();
  mkdirSync(join(kut, "props"));
  writeFileSync(join(kut, "props", "brosur.svg"), PROP("#aaa"));
  mkdirSync(join(kut, "taslak", "props"), { recursive: true });
  writeFileSync(join(kut, "taslak", "props", "brosur.svg"), PROP("#f00"));
  const res = approveDraft(kut, "nesne", "brosur", lib(kut));
  assert.equal(res.guncelleme, true);
  assert.match(readFileSync(join(kut, "props", "brosur.svg"), "utf8"), /#f00/);
  const aside = readdirSync(join(kut, "taslak", "_reddedilen"));
  assert.ok(aside.some((n) => n.startsWith("nesne-brosur-eski-") && n.endsWith(".svg")), aside.join(", "));
  assert.equal(existsSync(join(kut, "taslak", "props", "brosur.svg")), false);
});

test("a character update replaces the whole folder", () => {
  const kut = project();
  putCharacter(join(kut, "characters"), "ali");
  putCharacter(join(kut, "taslak", "characters"), "ali");
  writeFileSync(join(kut, "taslak", "characters", "ali", "yeni.txt"), "v2");
  const [d] = listDrafts(kut, lib(kut));
  assert.equal(d.guncelleme, true);
  approveDraft(kut, "karakter", "ali", lib(kut));
  assert.ok(existsSync(join(kut, "characters", "ali", "yeni.txt")));
  assert.ok(lib(kut).characters.has("ali"));
});

test("a draft named like a plugin drawing is still refused", () => {
  const kut = project();
  putCharacter(join(kut, "taslak", "characters"), "genc");
  const [d] = listDrafts(kut, lib(kut));
  assert.equal(d.ok, false);
  assert.equal(d.guncelleme, false);
  assert.ok(d.errors.some((e) => /eklentide/.test(e)), d.errors.join("; "));
});

test("all good drafts are taken in at once; broken ones stay with their reason", () => {
  const kut = project();
  for (const id of ["ali", "ali-on", "ali-arka"]) putCharacter(join(kut, "taslak", "characters"), id);
  mkdirSync(join(kut, "taslak", "props"), { recursive: true });
  writeFileSync(join(kut, "taslak", "props", "kitap.svg"), PROP("#00f"));
  writeFileSync(join(kut, "taslak", "props", "bozuk.svg"), "<svg/>");
  const onlyCharacters = approveAll(kut, lib(kut), "karakter");
  assert.deepEqual(onlyCharacters.alinan.map((d) => d.id).sort(), ["ali", "ali-arka", "ali-on"]);
  assert.deepEqual(onlyCharacters.hatalar, []);
  const rest = approveAll(kut, lib(kut));
  assert.deepEqual(rest.alinan.map((d) => d.id), ["kitap"]);
  assert.deepEqual(rest.hatalar.map((d) => d.id), ["bozuk"]);
  assert.deepEqual(listDrafts(kut, lib(kut)).map((d) => d.id), ["bozuk"]);
});

test("a draft says which episode it was drawn for, and the note goes when it is taken in or put aside", () => {
  const kut = project();
  putCharacter(join(kut, "taslak", "characters"), "ali");
  putCharacter(join(kut, "taslak", "characters"), "veli");
  writeFileSync(join(kut, "taslak", "notlar.json"), JSON.stringify({
    "karakter/ali": { bolum: "bolumler/suluman/bolum.json", not: "yamalar gövdeye taşındı" },
    "karakter/veli": { bolum: "bolumler/x/bolum.json" },
    "nesne/yok": { bolum: 5 },
  }));
  const byId = Object.fromEntries(listDrafts(kut, lib(kut)).map((d) => [d.id, d]));
  assert.equal(byId.ali.bolum, "bolumler/suluman/bolum.json");
  assert.equal(byId.ali.not, "yamalar gövdeye taşındı");
  approveDraft(kut, "karakter", "ali", lib(kut));
  rejectDraft(kut, "karakter", "veli");
  const notes = JSON.parse(readFileSync(join(kut, "taslak", "notlar.json"), "utf8"));
  assert.deepEqual(Object.keys(notes), ["nesne/yok"]);
});

test("a broken notes file is ignored, not fatal", () => {
  const kut = project();
  putCharacter(join(kut, "taslak", "characters"), "ali");
  writeFileSync(join(kut, "taslak", "notlar.json"), "{ yarım");
  const [d] = listDrafts(kut, lib(kut));
  assert.equal(d.ok, true);
  assert.equal(d.bolum, null);
  assert.doesNotThrow(() => approveDraft(kut, "karakter", "ali", lib(kut)));
});

test("the panel route takes every good draft of a kind in with one request", async () => {
  const { draftRoutes } = await import("../src/panel-taslak.mjs");
  const kut = project();
  for (const id of ["ali", "ali-on"]) putCharacter(join(kut, "taslak", "characters"), id);
  const routes = draftRoutes({ project: kut, loadLib: () => lib(kut) });
  const res = routes["POST /api/taslak"]({ islem: "hepsini-al", tur: "karakter" });
  assert.deepEqual(res.alinan.map((d) => d.id).sort(), ["ali", "ali-on"]);
  assert.deepEqual(res.taslaklar, []);
  assert.ok(res.vocab.rigs.some((r) => r.id === "ali-on"));
  assert.throws(() => routes["POST /api/taslak"]({ islem: "hepsini-al", tur: "ses" }), (e) => e.code === 400);
});
