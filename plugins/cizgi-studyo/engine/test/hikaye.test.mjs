// Story cards (hikaye.json next to an episode): a draft, not a gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadLibrary } from "../src/library.mjs";
import { emptyStory, validateStory, readStory, writeStory, storyPathOf, nextCardId, LIMITS } from "../src/hikaye.mjs";

const lib = loadLibrary(fileURLToPath(new URL("../../library", import.meta.url)));
const rig = [...lib.characters.keys()][0]; // the library's drawn characters (rigs)

const good = () => ({
  fikir: "Ela parkta bir kuş yuvası bulur.",
  yas: "4-6",
  karakterler: [{ ad: "Ela", rig, not: "meraklı" }, { ad: "Kuş", not: "kütüphanede yok" }],
  kartlar: [
    { id: "k1", baslik: "Parkta", olay: "Ela salıncakta, bir ses duyar.", kim: ["Ela"], duygu: "merak", sure: 8 },
    { id: "k2", baslik: "Yuva", olay: "Ağaçta yuvayı görür.", kim: ["Ela", "Kuş"], duygu: "sevinç", sahne: "s1" },
  ],
});

test("an empty story is valid and has the fields the panel edits", () => {
  const s = emptyStory();
  assert.deepEqual(validateStory(s, lib), { ok: true, errors: [] });
  assert.deepEqual(Object.keys(s).sort(), ["fikir", "karakterler", "kartlar", "yas"]);
});

test("a filled story is valid; a character without a rig is a new one still to draw", () => {
  assert.deepEqual(validateStory(good(), lib).errors, []);
});

test("wrong shapes, unknown fields, rigs outside the library and long texts are refused", () => {
  const cases = [
    [(s) => { s.kartlar[0].id = "K 1"; }, /id/],
    [(s) => { s.kartlar[1].id = "k1"; }, /iki kez/],
    [(s) => { s.karakterler[0].rig = "ejderha"; }, /kütüphane/],
    [(s) => { s.kartlar[0].sure = 0; }, /süre/],
    [(s) => { s.kartlar[0].olay = "x".repeat(LIMITS.text + 1); }, /uzun/],
    [(s) => { s.kartlar[0].kim = ["Zeynep"]; }, /karakter/],
    [(s) => { s.karakterler[1].ad = "Ela"; }, /iki kez/],
    [(s) => { s.kartlar[1].kim = ["Ela", "Ela"]; }, /iki kez/],
    [(s) => { s.kartlar[0].sahne = "S 1"; }, /sahne/],
    [(s) => { s.gizli = 1; }, /bilinmeyen/],
    [(s) => { s.kartlar[0].renk = "kırmızı"; }, /bilinmeyen/],
    [(s) => { s.kartlar = "yok"; }, /kartlar/],
    [(s) => { s.kartlar = Array.from({ length: LIMITS.cards + 1 }, (_, i) => ({ id: `k${i}`, baslik: "x" })); }, /en çok/],
  ];
  for (const [spoil, re] of cases) {
    const s = good();
    spoil(s);
    const res = validateStory(s, lib);
    assert.equal(res.ok, false, String(re));
    assert.match(res.errors.join("\n"), re);
  }
});

test("reading a missing story gives an empty one without writing a file", () => {
  const dir = mkdtempSync(join(tmpdir(), "cizgi-hikaye-"));
  const ep = join(dir, "bolum.json");
  assert.equal(storyPathOf(ep), join(dir, "hikaye.json"));
  const r = readStory(ep);
  assert.equal(r.exists, false);
  assert.deepEqual(r.story, emptyStory());
  assert.match(r.version, /^[0-9a-f]{16}$/);
  assert.equal(existsSync(join(dir, "hikaye.json")), false);
});

test("a story is written only when valid, and only over the version it was read from", () => {
  const dir = mkdtempSync(join(tmpdir(), "cizgi-hikaye-"));
  const ep = join(dir, "bolum.json");
  const first = readStory(ep);
  const saved = writeStory(ep, good(), lib, first.version);
  assert.equal(readStory(ep).version, saved.version);
  assert.deepEqual(readStory(ep).story, good());
  assert.ok(readFileSync(storyPathOf(ep), "utf8").endsWith("\n"));
  assert.throws(() => writeStory(ep, good(), lib, first.version), /değişti/); // stale
  const bad = good();
  bad.kartlar[0].id = "?";
  assert.throws(() => writeStory(ep, bad, lib, saved.version), /id/);
  assert.deepEqual(readStory(ep).story, good()); // untouched
});

test("a broken file reads as an error, not as an empty story that would overwrite it", () => {
  const dir = mkdtempSync(join(tmpdir(), "cizgi-hikaye-"));
  const ep = join(dir, "bolum.json");
  writeFileSync(storyPathOf(ep), "{yarım");
  assert.throws(() => readStory(ep), /hikaye\.json/);
});

test("the next card id is k<n> and unused", () => {
  assert.equal(nextCardId(emptyStory()), "k1");
  assert.equal(nextCardId(good()), "k3");
});
