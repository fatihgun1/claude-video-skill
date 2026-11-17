// Object chats: one short conversation per thing clicked on the stage (panel-sohbet.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createChats, cleanTopic, parseKey } from "../src/panel-sohbet.mjs";
import { createChannel } from "../src/panel-kanal.mjs";

const KIZ = { tur: "karakter", id: "kiz", ad: "Kız", bolum: "bolumler/x/bolum.json", shot: "s1_sh2", oyuncu: "kiz_on" };

test("a topic is a character or a prop by drawing id; anything else is refused", () => {
  assert.deepEqual(cleanTopic(KIZ), KIZ);
  assert.deepEqual(parseKey("nesne:telefon"), { tur: "nesne", id: "telefon" });
  for (const bad of [{ tur: "mekan", id: "park" }, { tur: "karakter", id: "../x" }, { tur: "karakter", id: "kiz", shot: "a b" }, null]) {
    assert.throws(() => cleanTopic(bad));
  }
  assert.throws(() => parseKey("karakter"), /konu/);
});

test("the person's message and Claude's reply land in one conversation per thing", () => {
  const chats = createChats({ now: () => 5 });
  chats.kisi(KIZ, "Gözlüğünü kaldır");
  chats.kisi({ tur: "nesne", id: "telefon" }, "Daha büyük olsun");
  chats.claude({ konu: "karakter:kiz", durum: "Çiziyorum…" });
  let kiz = chats.durum().sohbetler.find((c) => c.konu.id === "kiz");
  assert.equal(kiz.durum, "Çiziyorum…");
  assert.equal(kiz.mesajlar.length, 1, "a working note is not a message");
  chats.claude({ konu: "karakter:kiz", metin: "Tamam", oneriler: ["Saçını kısalt"] });
  kiz = chats.durum().sohbetler.find((c) => c.konu.id === "kiz");
  assert.equal(kiz.durum, null);
  assert.deepEqual(kiz.mesajlar, [{ kim: "kisi", metin: "Gözlüğünü kaldır", at: 5 }, { kim: "claude", metin: "Tamam", oneriler: ["Saçını kısalt"], at: 5 }]);
  assert.equal(kiz.konu.oyuncu, "kiz_on", "the context the person clicked in is kept");
});

test("Claude's reply is checked: pictures only the panel's drawings, short chips, something to say", () => {
  const chats = createChats();
  assert.throws(() => chats.claude({ konu: "karakter:kiz" }), /metin, durum/);
  assert.throws(() => chats.claude({ konu: "karakter:kiz", gorsel: ["https://x/y.svg"] }), /gorsel/);
  assert.throws(() => chats.claude({ konu: "karakter:kiz", oneriler: ["x".repeat(81)] }), /öneri/);
  assert.throws(() => chats.claude({ konu: "karakter:kiz", durum: "a\nb" }), /tek satır/);
  const state = chats.durum();
  state.sohbetler.push("x");
  assert.equal(chats.durum().sohbetler.length, 0, "the state handed out is a copy");
});

test("the channel hands a window message to a listening Claude, or keeps it for the next listen", async () => {
  const ch = createChannel();
  const heard = ch.dinle(1000);
  assert.deepEqual(ch.sohbet(KIZ, "Gülümsesin"), { dinliyor: true });
  assert.deepEqual((await heard).map(({ at, ...i }) => i), [{ tur: "sohbet", konu: KIZ, metin: "Gülümsesin" }]);
  assert.equal(ch.durum().sohbet.sohbetler[0].durum, "Claude okuyor…");
  assert.deepEqual(ch.sohbet(KIZ, "Bir de şapka"), { dinliyor: false });
  assert.match(ch.durum().sohbet.sohbetler[0].durum, /sırada/);
  assert.deepEqual((await ch.dinle(1000)).map((i) => i.metin), ["Bir de şapka"]);
});

test("while Claude is not listening a window message goes to the idle handler (the request queue)", () => {
  const got = [];
  const ch = createChannel({ onIdleChat: (item) => got.push(item) });
  assert.deepEqual(ch.sohbet(KIZ, "Saçı kısa olsun"), { dinliyor: false });
  assert.equal(got[0].konu.id, "kiz");
});
