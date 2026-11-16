// The channel from Claude to the open panel: navigate it (panel_git) and ask in it (panel_sor).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createChannel, channelRoutes } from "../src/panel-kanal.mjs";

const Q = { soru: "Hangi mekân?", secenekler: [{ etiket: "Sokak", aciklama: "gece" }, { etiket: "Park" }] };

test("a navigation command is kept with a growing sequence number", () => {
  const ch = createChannel();
  assert.equal(ch.durum().yon, null);
  const a = ch.yonlendir({ sekme: "karakter", kaydir: "taslaklar", vurgula: "Kütüphaneye al" });
  const b = ch.yonlendir({ bolum: "bolumler/x/bolum.json", shot: "s1_sh2" });
  assert.ok(b.seq > a.seq);
  assert.deepEqual(ch.durum().yon, b);
});

test("navigation is checked: known panels, short fields, at least one thing to do", () => {
  const ch = createChannel();
  for (const bad of [{}, { sekme: "gizli" }, { shot: "../x" }, { kaydir: "her yer" }, { vurgula: "x".repeat(81) }, { bolum: 5 }, { bolum: "a\nb" }, { renk: "mavi" }]) {
    assert.throws(() => ch.yonlendir(bad), undefined, JSON.stringify(bad));
  }
  assert.doesNotThrow(() => ch.yonlendir({ vurgula: "Sahne 2028 / 2029 — İç ses" }), "digits and Turkish letters are ordinary text");
  assert.throws(() => ch.yonlendir({ vurgula: "a b" }));
});

test("a question is shown until it is answered, and the waiter gets the answer", async () => {
  const ch = createChannel();
  const { id } = ch.sor(Q);
  assert.equal(ch.durum().soru.id, id);
  assert.equal(ch.durum().soru.soru, "Hangi mekân?");
  const waiting = ch.bekle(id, 1000);
  ch.cevapla(id, { secim: ["Sokak"], metin: "yağmurlu olsun" });
  assert.deepEqual(await waiting, { id, soru: "Hangi mekân?", secim: ["Sokak"], metin: "yağmurlu olsun" });
  assert.equal(ch.durum().soru, null);
});

test("an answer must pick from the options (one unless several are allowed) or say something", () => {
  const ch = createChannel();
  const { id } = ch.sor(Q);
  assert.throws(() => ch.cevapla(id, { secim: ["Deniz"] }));
  assert.throws(() => ch.cevapla(id, { secim: ["Sokak", "Park"] }));
  assert.throws(() => ch.cevapla(id, { secim: [] }));
  assert.throws(() => ch.cevapla("baska", { secim: ["Sokak"] }));
  const several = createChannel();
  const q = several.sor({ ...Q, coklu: true });
  assert.doesNotThrow(() => several.cevapla(q.id, { secim: ["Sokak", "Park"] }));
  const free = createChannel();
  const f = free.sor(Q);
  assert.doesNotThrow(() => free.cevapla(f.id, { secim: [], metin: "ikisi de değil, sahil" }));
  const closed = createChannel();
  const c = closed.sor({ ...Q, serbest: false });
  assert.throws(() => closed.cevapla(c.id, { secim: [], metin: "sahil" }));
});

test("questions are checked: text, 1-8 options, pictures only from the panel's own drawings", () => {
  const ch = createChannel();
  for (const bad of [
    { soru: "", secenekler: Q.secenekler },
    { soru: "x", secenekler: [] },
    { soru: "x", secenekler: Array.from({ length: 9 }, (_, i) => ({ etiket: `s${i}` })) },
    { soru: "x", secenekler: [{ etiket: "a" }, { etiket: "a" }] },
    { soru: "x", secenekler: [{ etiket: "a", gorsel: "https://kotu.example/a.svg" }] },
    { soru: "x", secenekler: [{ etiket: "a", gorsel: "/kutuphane/../../etc.svg" }] },
    { soru: "x", secenekler: [{ etiket: "a", gorsel: "file:///C:/a.svg" }] },
  ]) {
    assert.throws(() => ch.sor(bad), undefined, JSON.stringify(bad));
  }
  assert.doesNotThrow(() => ch.sor({ soru: "x", secenekler: [{ etiket: "a", gorsel: "/kutuphane-taslak/konsept/suluman.svg" }, { etiket: "b", gorsel: "/kutuphane/karakter/genc.svg" }] }));
});

test("waiting runs out without an answer, and a later answer goes to the late handler", async () => {
  const late = [];
  const ch = createChannel({ onLateAnswer: (a) => late.push(a) });
  const { id } = ch.sor(Q);
  assert.equal(await ch.bekle(id, 20), null);
  assert.equal(ch.durum().soru.id, id, "still shown after the wait ran out");
  ch.cevapla(id, { secim: ["Park"] });
  assert.deepEqual(late, [{ id, soru: "Hangi mekân?", secim: ["Park"], metin: "" }]);
});

test("a new question replaces the open one; its waiter learns it was dropped", async () => {
  const ch = createChannel();
  const first = ch.sor(Q);
  const waiting = ch.bekle(first.id, 1000);
  const second = ch.sor({ ...Q, soru: "Hangi saat?" });
  assert.equal(await waiting, null);
  assert.equal(ch.durum().soru.id, second.id);
  assert.throws(() => ch.cevapla(first.id, { secim: ["Sokak"] }));
});

test("the panel routes read the channel and post an answer", () => {
  const ch = createChannel();
  const routes = channelRoutes(ch);
  const { id } = ch.sor(Q);
  assert.equal(routes["GET /api/kanal"]().soru.id, id);
  assert.deepEqual(routes["POST /api/kanal/cevap"]({ id, secim: ["Sokak"] }), { ok: true });
  assert.throws(() => routes["POST /api/kanal/cevap"]({ id: "yok", secim: ["Sokak"] }), (e) => e.code === 400);
});

const WIZ = { baslik: "Yeni karakter: Sülüman", adimlar: [{ id: "bilgi", baslik: "Bilgiler" }, { id: "konsept", baslik: "Konsept" }, { id: "gorunus", baslik: "Görünüşler" }, { id: "al", baslik: "Kütüphaneye al" }] };

test("a wizard starts with every step waiting", () => {
  const ch = createChannel();
  assert.equal(ch.durum().sihirbaz, null);
  const w = ch.sihirbaz({ sihirbaz: WIZ });
  assert.equal(w.baslik, "Yeni karakter: Sülüman");
  assert.deepEqual(w.adimlar.map((a) => a.durum), ["sirada", "sirada", "sirada", "sirada"]);
  assert.equal(w.aktif, null);
  assert.deepEqual(ch.durum().sihirbaz, w);
});

test("Claude moves the wizard on: earlier steps are done, the current one runs or waits", () => {
  const ch = createChannel();
  ch.sihirbaz({ sihirbaz: WIZ });
  const w = ch.sihirbaz({ adim: "gorunus", durum: "calisiyor", aciklama: "Önden ve arkadan çiziliyor", gorsel: ["/kutuphane-taslak/konsept/suluman.svg"] });
  assert.deepEqual(w.adimlar.map((a) => a.durum), ["bitti", "bitti", "calisiyor", "sirada"]);
  assert.equal(w.aktif, "gorunus");
  assert.equal(w.adimlar[2].aciklama, "Önden ve arkadan çiziliyor");
  assert.deepEqual(w.adimlar[2].gorsel, ["/kutuphane-taslak/konsept/suluman.svg"]);
  const v = ch.sihirbaz({ adim: "al", durum: "bekliyor", aciklama: "Taslakları al" });
  assert.equal(v.adimlar[2].durum, "bitti");
  assert.equal(v.adimlar[3].durum, "bekliyor");
  assert.ok(v.seq > w.seq);
});

test("a failed step stays failed when later steps move on", () => {
  const ch = createChannel();
  ch.sihirbaz({ sihirbaz: WIZ });
  ch.sihirbaz({ adim: "konsept", durum: "hata", aciklama: "çizim kontrolden geçmedi" });
  const w = ch.sihirbaz({ adim: "gorunus" });
  assert.deepEqual(w.adimlar.map((a) => a.durum), ["bitti", "hata", "calisiyor", "sirada"]);
});

test("the last step done finishes the wizard; kapat removes it", () => {
  const ch = createChannel();
  ch.sihirbaz({ sihirbaz: WIZ });
  const w = ch.sihirbaz({ adim: "al", durum: "bitti" });
  assert.equal(w.bitti, true);
  assert.equal(ch.sihirbaz({ kapat: true }), null);
  assert.equal(ch.durum().sihirbaz, null);
});

test("wizard commands are checked", () => {
  const ch = createChannel();
  assert.throws(() => ch.sihirbaz({ adim: "bilgi" }), /sihirbaz/); // none open
  for (const bad of [
    { sihirbaz: { baslik: "", adimlar: WIZ.adimlar } },
    { sihirbaz: { baslik: "x", adimlar: [] } },
    { sihirbaz: { baslik: "x", adimlar: Array.from({ length: 13 }, (_, i) => ({ id: `a${i}`, baslik: "x" })) } },
    { sihirbaz: { baslik: "x", adimlar: [{ id: "a", baslik: "x" }, { id: "a", baslik: "y" }] } },
    { sihirbaz: { baslik: "x", adimlar: [{ id: "A B", baslik: "x" }] } },
    {},
  ]) assert.throws(() => ch.sihirbaz(bad), undefined, JSON.stringify(bad));
  ch.sihirbaz({ sihirbaz: WIZ });
  assert.throws(() => ch.sihirbaz({ adim: "yok" }));
  assert.throws(() => ch.sihirbaz({ adim: "bilgi", durum: "uyuyor" }));
  assert.throws(() => ch.sihirbaz({ adim: "bilgi", gorsel: ["file:///C:/a.svg"] }));
  assert.throws(() => ch.sihirbaz({ adim: "bilgi", aciklama: "x".repeat(501) }));
});

test("Claude can open the project wizard on an episode being made, at a step", () => {
  const ch = createChannel();
  const nav = ch.yonlendir({ proje: "sokaktan-kurtulus", proje_adim: "karakterler" });
  assert.equal(nav.proje, "sokaktan-kurtulus");
  assert.equal(nav.proje_adim, "karakterler");
  assert.doesNotThrow(() => ch.yonlendir({ proje: "sokaktan-kurtulus" }));
  for (const bad of [{ proje: "../x" }, { proje: "Büyük" }, { proje: "a", proje_adim: "renkler" }, { proje_adim: "hikaye" }]) {
    assert.throws(() => ch.yonlendir(bad), undefined, JSON.stringify(bad));
  }
});

test("after the person answers, Claude is thinking until its next move in the panel (or it times out)", () => {
  let now = 1000;
  const ch = createChannel({ now: () => now });
  assert.equal(ch.durum().dusunuyor, false);
  const { id } = ch.sor(Q);
  assert.equal(ch.durum().dusunuyor, false, "a question waits for the person, not for Claude");
  ch.cevapla(id, { secim: ["Sokak"] });
  assert.equal(ch.durum().dusunuyor, true);
  ch.yonlendir({ sekme: "karakter" });
  assert.equal(ch.durum().dusunuyor, false, "moving the panel is Claude's move");
  const q = ch.sor(Q);
  ch.cevapla(q.id, { secim: ["Park"] });
  now += 121_000;
  assert.equal(ch.durum().dusunuyor, false, "the lock lets go when Claude says nothing for two minutes");
});
