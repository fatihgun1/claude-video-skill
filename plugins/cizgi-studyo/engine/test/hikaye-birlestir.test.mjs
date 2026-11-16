// The project wizard and Claude edit the same hikaye.json at once: the person's changes and Claude's
// are merged field by field (characters by name, cards by id) instead of one overwriting the other.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeStory } from "../src/panel/hikaye-birlestir.js";

const base = () => ({
  baslik: "Sokaktan kurtuluş", fikir: "Ahmet şişe toplar.", yas: "genel",
  istekler: { format: "9:16" },
  karakterler: [{ ad: "Ahmet", not: "yorgun" }],
  kartlar: [{ id: "k1", baslik: "Gece", olay: "Şişe toplar." }],
});

test("each side keeps what only it changed", () => {
  const mine = { ...base(), istekler: { format: "9:16", sure: 50, boyut: "2b" } };
  const theirs = { ...base(), fikir: "Ahmet şişe toplar ve markete gider." };
  const m = mergeStory(base(), mine, theirs);
  assert.equal(m.fikir, "Ahmet şişe toplar ve markete gider.");
  assert.deepEqual(m.istekler, { format: "9:16", sure: 50, boyut: "2b" });
});

test("a character the person adds and one Claude adds are both kept; an edit to the same one is the person's", () => {
  const mine = { ...base(), karakterler: [{ ad: "Ahmet", not: "yorgun, sarışın" }, { ad: "Karakter 1" }] };
  const theirs = { ...base(), karakterler: [{ ad: "Ahmet", not: "yorgun" }, { ad: "Market sahibi", not: "yaşlı" }] };
  const m = mergeStory(base(), mine, theirs);
  assert.deepEqual(m.karakterler.map((c) => c.ad), ["Ahmet", "Market sahibi", "Karakter 1"]);
  assert.equal(m.karakterler[0].not, "yorgun, sarışın");
});

test("a card the person deleted stays deleted; one Claude wrote is kept; cards merge by id", () => {
  const b = { ...base(), kartlar: [...base().kartlar, { id: "k2", baslik: "Sabah" }] };
  const mine = { ...b, kartlar: [{ id: "k1", baslik: "Gece", olay: "Yağmurda şişe toplar." }] }; // k2 deleted, k1 edited
  const theirs = { ...b, kartlar: [...b.kartlar, { id: "k3", baslik: "Market" }] };
  const m = mergeStory(b, mine, theirs);
  assert.deepEqual(m.kartlar.map((k) => k.id), ["k1", "k3"]);
  assert.equal(m.kartlar[0].olay, "Yağmurda şişe toplar.");
});

test("when both changed the same field, the person's wins", () => {
  const m = mergeStory(base(), { ...base(), baslik: "Benim başlığım" }, { ...base(), baslik: "Claude'un başlığı" });
  assert.equal(m.baslik, "Benim başlığım");
});

test("a wish the person removed stays removed", () => {
  const b = { ...base(), istekler: { format: "9:16", muzik: "yok" } };
  const m = mergeStory(b, { ...b, istekler: { format: "9:16" } }, { ...b, istekler: { format: "9:16", muzik: "yok", efekt: true } });
  assert.deepEqual(m.istekler, { format: "9:16", efekt: true });
});
