// The project library (<project>/kutuphane): assets drawn for a project, next to the plugin's
// library; drafts in kutuphane/taslak wait until the person takes them in.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync, copyFileSync } from "node:fs";
import { openPanel } from "../src/panel-baslat.mjs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadLibrary } from "../src/library.mjs";
import { validateEpisode } from "../src/validate.mjs";
import { projectLibraryOf, listDrafts, draftSvg, approveDraft, rejectDraft, draftsSignature } from "../src/proje-kutuphane.mjs";

const LIB = fileURLToPath(new URL("../../library", import.meta.url));
const SOKAK = fileURLToPath(new URL("../../../../ornekler/sokak/bolum.json", import.meta.url));
const layer = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080"><rect id="r" width="1920" height="1080" fill="${fill}"/></svg>`;
const PROP = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 200" data-grip="50,40" data-base="50,200"><rect width="100" height="200" fill="#a86"/></svg>';
let base;

function project() {
  const root = mkdtempSync(join(tmpdir(), "cizgi-pk-"));
  mkdirSync(join(root, "bolumler", "a"), { recursive: true });
  return root;
}
function draftBackground(proj, id, mekan = { ad: "Orman", katmanlar: [{ id: "gok", dosya: "gok.svg", derinlik: 0 }, { id: "zemin", dosya: "zemin.svg", derinlik: 1 }] }) {
  const dir = join(proj, "taslak", "backgrounds", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "mekan.json"), JSON.stringify(mekan));
  writeFileSync(join(dir, "gok.svg"), layer("#9cf"));
  writeFileSync(join(dir, "zemin.svg"), layer("#cb9"));
}

before(() => {
  base = loadLibrary(LIB);
});

test("project sound effects join the library only with their source written in KAYNAKLAR.md", () => {
  const root = project();
  const sfxDir = join(root, "kutuphane", "sfx");
  mkdirSync(sfxDir, { recursive: true });
  const wav = join(LIB, "sfx", "pat.wav");
  copyFileSync(wav, join(sfxDir, "kus.wav"));
  copyFileSync(wav, join(sfxDir, "gizemli.wav"));
  copyFileSync(wav, join(sfxDir, "pat.wav")); // the plugin has one by this name
  writeFileSync(join(sfxDir, "Kotu Ad.wav"), "not a wav");
  writeFileSync(join(sfxDir, "KAYNAKLAR.md"), "| Dosya | Kaynak | Lisans |\n|---|---|---|\n| kus.wav | example.org/kus | CC0 |\n| pat.wav | x | CC0 |\n");
  const lib = loadLibrary(LIB, { project: join(root, "kutuphane") });
  assert.ok(lib.sfx.has("kus"), "listed in KAYNAKLAR.md: in");
  assert.equal(lib.sfx.get("kus").path, join(sfxDir, "kus.wav"));
  assert.ok(!lib.sfx.has("gizemli"), "no source written: out");
  assert.ok(lib.projectErrors.some((e) => /gizemli/.test(e) && /KAYNAKLAR/.test(e)), lib.projectErrors.join("\n"));
  assert.equal(lib.sfx.get("pat").path, join(LIB, "sfx", "pat.wav"), "the plugin's keeps its name");
  assert.ok(lib.projectErrors.some((e) => /pat/.test(e) && /already/.test(e)));
  assert.ok(lib.projectErrors.some((e) => /Kotu Ad/.test(e)));
  // writing a source changes the signature the panel polls (its list of effects left out follows)
  const before = draftsSignature(join(root, "kutuphane"));
  writeFileSync(join(sfxDir, "KAYNAKLAR.md"), `${readFileSync(join(sfxDir, "KAYNAKLAR.md"), "utf8")}| gizemli.wav | example.org/g | CC0 |\n`);
  assert.notEqual(draftsSignature(join(root, "kutuphane")), before);
  assert.ok(loadLibrary(LIB, { project: join(root, "kutuphane") }).sfx.has("gizemli"));
  // a file name only mentioned inside a link or a sentence is not a source row
  writeFileSync(join(sfxDir, "KAYNAKLAR.md"), "Bkz. https://x.org/a/kus.wav ve no-kus.wav\n");
  assert.ok(!loadLibrary(LIB, { project: join(root, "kutuphane") }).sfx.has("kus"));
  writeFileSync(join(sfxDir, "KAYNAKLAR.md"), "- `kus.wav`, freesound.org/s/1 (CC0)\n| **gizemli.wav** | x | CC0 |\n");
  const listed = loadLibrary(LIB, { project: join(root, "kutuphane") });
  assert.ok(listed.sfx.has("kus") && listed.sfx.has("gizemli"));
  // an episode can use it
  const ep = JSON.parse(readFileSync(SOKAK, "utf8"));
  ep.scenes[0].shots[0].sfx = [{ sfx: "kus", at: 0.2 }];
  assert.deepEqual(validateEpisode(ep, lib).errors, []);
});

test("a project library is the nearest kutuphane folder above an episode", () => {
  const root = project();
  assert.equal(projectLibraryOf(join(root, "bolumler", "a")), null);
  mkdirSync(join(root, "kutuphane"));
  assert.equal(projectLibraryOf(join(root, "bolumler", "a")), join(root, "kutuphane"));
  assert.equal(projectLibraryOf(root), join(root, "kutuphane"));
});

test("project assets join the plugin's library; drafts do not", () => {
  const root = project();
  const proj = join(root, "kutuphane");
  mkdirSync(join(proj, "props"), { recursive: true });
  writeFileSync(join(proj, "props", "kutu.svg"), PROP);
  draftBackground(proj, "orman");
  const lib = loadLibrary(LIB, { project: proj });
  assert.ok(lib.props.has("kutu"));
  assert.ok(lib.backgrounds.has("park")); // the plugin's own are still there
  assert.ok(!lib.backgrounds.has("orman")); // a draft is not usable
  const ep = JSON.parse(readFileSync(SOKAK, "utf8"));
  ep.scenes[0].bg = "orman";
  assert.match(validateEpisode(ep, lib).errors.join("\n"), /orman/);
});

test("a project asset with a plugin asset's name, or a broken one, is left out and reported; the rest loads", () => {
  const proj = join(project(), "kutuphane");
  mkdirSync(join(proj, "backgrounds"), { recursive: true });
  mkdirSync(join(proj, "props"), { recursive: true });
  writeFileSync(join(proj, "backgrounds", "park.svg"), layer("#000"));
  writeFileSync(join(proj, "props", "kirik.svg"), "<svg><script>x()</script></svg>");
  writeFileSync(join(proj, "props", "kutu.svg"), PROP);
  const lib = loadLibrary(LIB, { project: proj });
  assert.equal(lib.backgrounds.get("park"), base.backgrounds.get("park")); // the plugin's park, not shadowed
  assert.ok(!lib.props.has("kirik"));
  assert.ok(lib.props.has("kutu"));
  assert.match(lib.projectErrors.join("\n"), /park/);
  assert.match(lib.projectErrors.join("\n"), /kirik/);
  assert.deepEqual(base.projectErrors, []);
});

test("drafts are listed with their problems; a good one can be looked at", () => {
  const proj = join(project(), "kutuphane");
  draftBackground(proj, "orman");
  draftBackground(proj, "bozuk", { katmanlar: [{ id: "gok", dosya: "yok.svg", derinlik: 0 }] });
  mkdirSync(join(proj, "taslak", "props"), { recursive: true });
  writeFileSync(join(proj, "taslak", "props", "sandik.svg"), PROP);
  writeFileSync(join(proj, "taslak", "props", "kirik.svg"), "<svg><script>x()</script></svg>");
  const list = listDrafts(proj, base);
  const by = (tur, id) => list.find((d) => d.tur === tur && d.id === id);
  assert.equal(by("mekan", "orman").ok, true);
  assert.equal(by("mekan", "orman").name, "Orman");
  assert.deepEqual(by("mekan", "orman").layers, [{ id: "gok", derinlik: 0 }, { id: "zemin", derinlik: 1 }]);
  assert.equal(by("mekan", "bozuk").ok, false);
  assert.match(by("mekan", "bozuk").errors.join(" "), /yok\.svg/);
  assert.equal(by("nesne", "sandik").ok, true);
  assert.equal(by("nesne", "kirik").ok, false);
  assert.match(draftSvg(proj, "mekan", "orman", base), /data-katman="zemin"/);
  assert.equal(draftSvg(proj, "mekan", "bozuk", base), null);
  assert.equal(draftSvg(proj, "mekan", "../x", base), null);
});

test("taking a draft in moves it into the project library, where episodes can use it", () => {
  const root = project();
  const proj = join(root, "kutuphane");
  draftBackground(proj, "orman");
  const before_ = draftsSignature(proj);
  approveDraft(proj, "mekan", "orman", base);
  assert.notEqual(draftsSignature(proj), before_);
  assert.ok(existsSync(join(proj, "backgrounds", "orman", "mekan.json")));
  assert.ok(!existsSync(join(proj, "taslak", "backgrounds", "orman")));
  const lib = loadLibrary(LIB, { project: proj });
  assert.deepEqual(lib.layers.get("orman").map((l) => l.id), ["gok", "zemin"]);
});

test("a broken draft, a taken name or an unknown draft cannot be taken in", () => {
  const proj = join(project(), "kutuphane");
  draftBackground(proj, "bozuk", { katmanlar: [] });
  assert.throws(() => approveDraft(proj, "mekan", "bozuk", base), /katman/);
  draftBackground(proj, "park");
  assert.throws(() => approveDraft(proj, "mekan", "park", base), /zaten/);
  assert.throws(() => approveDraft(proj, "mekan", "yok", base), /taslak yok/);
  assert.throws(() => approveDraft(proj, "ses", "x", base), /tür/);
  assert.throws(() => approveDraft(proj, "mekan", "../../etc", base), /taslak yok|geçersiz/);
});

test("the panel lists drafts, shows a good one, and takes it in only when asked from its own page", async () => {
  const root = project();
  const proj = join(root, "kutuphane");
  draftBackground(proj, "orman");
  copyFileSync(SOKAK, join(root, "bolumler", "a", "bolum.json"));
  const panel = await openPanel({ target: root, library: LIB, status: () => null, port: 0 });
  try {
    const host = new URL(panel.url).host;
    const get = (p) => fetch(`${panel.url.replace(/\/$/, "")}${p}`);
    const post = (body, origin = `http://${host}`) => fetch(`${panel.url.replace(/\/$/, "")}/api/taslak`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
    const list = await (await get("/api/taslaklar")).json();
    assert.equal(list.kutuphane, proj);
    assert.deepEqual(list.taslaklar.map((d) => [d.tur, d.id, d.ok]), [["mekan", "orman", true]]);
    const svg = await get("/kutuphane-taslak/mekan/orman.svg");
    assert.equal(svg.status, 200);
    assert.match(svg.headers.get("content-security-policy"), /default-src 'none'.*sandbox/); // opened alone, it runs nothing
    assert.match(await svg.text(), /data-katman="gok"/);
    assert.equal((await get("/kutuphane-taslak/mekan/yok.svg")).status, 404);
    assert.equal((await post({ islem: "al", tur: "mekan", id: "orman" }, "http://evil.example")).status, 403);
    const taken = await (await post({ islem: "al", tur: "mekan", id: "orman" })).json();
    assert.deepEqual(taken.taslaklar, []);
    assert.ok(taken.vocab.backgrounds.some((b) => b.id === "orman" && b.label === "Orman" && b.layers.length === 2));
    assert.equal((await post({ islem: "uc", tur: "mekan", id: "orman" })).status, 400);
  } finally {
    await panel.close();
  }
});

test("rejecting a draft puts it aside (not deleted) and out of the list", () => {
  const proj = join(project(), "kutuphane");
  draftBackground(proj, "orman");
  const before_ = draftsSignature(proj);
  rejectDraft(proj, "mekan", "orman");
  assert.notEqual(draftsSignature(proj), before_);
  assert.equal(listDrafts(proj, base).length, 0);
  const aside = readdirSync(join(proj, "taslak", "_reddedilen"));
  assert.equal(aside.length, 1);
  assert.match(aside[0], /^mekan-orman-/);
});
