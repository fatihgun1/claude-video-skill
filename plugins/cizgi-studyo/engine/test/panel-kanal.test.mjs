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
  for (const bad of [{}, { sekme: "gizli" }, { shot: "../x" }, { kaydir: "her yer" }, { vurgula: "x".repeat(81) }, { bolum: 5 }, { bolum: "a\nb" }, { renk: "mavi" }, { proje: "sokak" }, { proje_adim: "hikaye" }]) {
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

test("a second question while one is open is refused; replacing it on purpose tells the first waiter", async () => {
  // a question asked again (or two at once) dropped the first one; its answer could never come
  const ch = createChannel();
  const { id } = ch.sor(Q);
  const waiting = ch.bekle(id, 5000);
  assert.throws(() => ch.sor({ ...Q, soru: "Hangi ses?" }), /açık bir soru var/);
  assert.equal(ch.durum().soru.id, id, "the first question is still shown");
  const second = ch.sor({ ...Q, soru: "Hangi ses?" }, { yerine: true });
  assert.notEqual(second.id, id);
  assert.deepEqual(await waiting, { yerine: true }, "the first waiter learns it was replaced, not that time ran out");
});

test("drafts taken in while nobody listens go to the idle handler (the queue), not only to memory", () => {
  // the news reached an idle session only at its next panel_dinle, and the oldest were dropped
  const sent = [];
  const ch = createChannel({ onIdleDraft: (item) => sent.push(item) });
  assert.equal(ch.taslak({ islem: "al", cizimler: [{ tur: "karakter", id: "necmi" }] }), false);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].cizimler, [{ tur: "karakter", id: "necmi" }]);
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

test("a question replaced on purpose: its waiter learns it was replaced, its answer is refused", async () => {
  const ch = createChannel();
  const first = ch.sor(Q);
  const waiting = ch.bekle(first.id, 1000);
  const second = ch.sor({ ...Q, soru: "Hangi saat?" }, { yerine: true });
  assert.deepEqual(await waiting, { yerine: true });
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

test("the channel knows whether a browser tab has the panel open (it polls GET /api/kanal)", () => {
  let t = 10_000;
  const ch = createChannel({ now: () => t });
  assert.equal(ch.izleniyor(), false, "nobody has looked yet");
  channelRoutes(ch)["GET /api/kanal"]();
  assert.equal(ch.izleniyor(), true);
  t += 7000;
  assert.equal(ch.izleniyor(), false, "a few seconds of silence: the tab is gone");
});

test("a question can carry a spoken line to play; only an episode's ses/*.wav or voice sample is accepted", () => {
  const ch = createChannel();
  ch.sor({ ...Q, ses: "bolumler/kpss/ses/s1_sh4-0.wav" });
  assert.equal(ch.durum().soru.ses, "bolumler/kpss/ses/s1_sh4-0.wav");
  // a voice sample (cizgi ses-ornek) too: the person picks a voice by ear
  ch.sor({ ...Q, ses: "bolumler/kpss/cikti/ses-ornegi-kiz.wav" }, { yerine: true });
  assert.equal(ch.durum().soru.ses, "bolumler/kpss/cikti/ses-ornegi-kiz.wav");
  for (const bad of ["../x/ses/a.wav", "bolumler/kpss/ses/a.mp3", "bolumler/kpss/cikti/a.wav", "bolumler/kpss/cikti/ses-ornegi-../a.wav", "/etc/ses/a.wav", "ses/a.wav"]) {
    assert.throws(() => createChannel().sor({ ...Q, ses: bad }), /ses bir replik sesi/, bad);
  }
});

test("taking a draft in wakes a listening Claude, and waits for a busy one", async () => {
  const ch = createChannel();
  const listening = ch.dinle(5000);
  assert.equal(ch.taslak({ islem: "al", cizimler: [{ tur: "karakter", id: "selin" }] }), true);
  const [got] = await listening;
  assert.deepEqual({ ...got, at: undefined }, { tur: "taslak", islem: "al", cizimler: [{ tur: "karakter", id: "selin" }], at: undefined });
  // nobody listening (Claude is working): kept for its next panel_dinle
  assert.equal(ch.taslak({ islem: "reddet", cizimler: [{ tur: "nesne", id: "vazo" }] }), false);
  const later = await ch.dinle(10);
  assert.equal(later[0].tur, "taslak");
  assert.equal(later[0].cizimler[0].id, "vazo");
});

test("the panel reports the moves it carried out; panel_git can tell one that never arrived", () => {
  const ch = createChannel();
  const a = ch.yonlendir({ sekme: "karakter" });
  assert.equal(ch.uygulanan(), 0);
  ch.gitti(a.seq);
  assert.equal(ch.uygulanan(), a.seq);
  ch.gitti(a.seq + 5); // a move that does not exist yet is ignored
  assert.equal(ch.uygulanan(), a.seq);
});

test("an option card may play a library track or effect; a long plan question fits", () => {
  const ch = createChannel();
  ch.sor({ soru: "x".repeat(1200), secenekler: [{ etiket: "A", ses: "/kutuphane/muzik/eskiz-1.wav" }, { etiket: "B", ses: "/kutuphane/ses/kapi.wav" }] });
  assert.equal(ch.durum().soru.secenekler[0].ses, "/kutuphane/muzik/eskiz-1.wav");
  for (const bad of ["/etc/x.wav", "/kutuphane/muzik/../x.wav", "http://a/b.wav", "/kutuphane/karakter/a.wav"]) {
    assert.throws(() => createChannel().sor({ soru: "s", secenekler: [{ etiket: "A", ses: bad }] }), /seçeneğin sesi/, bad);
  }
  assert.throws(() => createChannel().sor({ soru: "x".repeat(1600), secenekler: [{ etiket: "A" }] }), /soru/);
});
