// The panel shows the engine's most common messages in Turkish; the engine (read by Claude) stays English.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tr } from "../src/panel/tr.js";

test("approval errors read as Turkish, without the instructions meant for Claude", () => {
  assert.equal(tr('gate "senaryo" has not been approved. Show it to the person and run: cizgi onayla senaryo <bolum.json> only after they say yes.'),
    "Senaryo onayı verilmedi: Claude'a göster, beğenirsen onay ver.");
  assert.match(tr('gate "storyboard" was approved, but the content changed since. Show it…'), /^Storyboard onaylanmıştı ama içerik sonra değişti/);
});

test("a job error keeps its lines; the ones the panel knows are translated", () => {
  const got = tr("npx exited with 1:\n✗ Failed: EPERM: operation not permitted, rename 'a.mp4' -> 'b.mp4'\n  at renameSync");
  assert.equal(got, "npx hata verdi (çıkış kodu 1):\n✗ Failed: Dosyanın üzerine yazılamadı: başka bir program onu açık tutuyor (EPERM).\n  at renameSync");
});

test("project library problems read as Turkish; an unknown message stays as it is", () => {
  assert.equal(tr("project sound effect kus: its source is not written in kutuphane/sfx/KAYNAKLAR.md (file, where from, licence)"),
    "Proje efekti kus: kaynağı kutuphane/sfx/KAYNAKLAR.md'de yazılı değil (dosya, nereden, lisans).");
  assert.match(tr('project sound effect pop: the plugin\'s library already has a sound effect "pop"'), /aynı adda bir efekt var/);
  assert.equal(tr('project prop top: the plugin\'s library already has a prop "top"'), "Proje nesnesi top: eklentinin kütüphanesinde aynı adda bir nesne var; başka bir ad ver.");
  assert.match(tr('project background deniz: the plugin\'s library already has a background "deniz"'), /^Proje mekânı deniz: .* bir mekân var/);
  assert.equal(tr("something new: never seen"), "something new: never seen");
  assert.equal(tr(undefined), "");
});

test("a message the panel put a prefix on is translated behind it", () => {
  assert.equal(tr('açılamadı: gate "senaryo" has not been approved. Show it to the person and run: …'), "açılamadı: Senaryo onayı verilmedi: Claude'a göster, beğenirsen onay ver.");
});

test("a detail that slides on a bending limb reads as Turkish, with the character when named", () => {
  assert.equal(tr("character nazim: #arm_L bends, but 1 shape(s) in it (path) do not bend with it and will slide: draw details on the body, the hand or the foot, or leave them out"),
    "nazim: #arm_L bükülüyor ama içindeki 1 şekil (path) onunla bükülmüyor, kayacak: ayrıntıyı gövdeye, ele ya da ayağa çiz ya da çıkar.");
  assert.match(tr("#leg_L bends, but 2 shape(s) in it (rect) do not bend with it and will slide: draw details on the body, the hand or the foot, or leave them out"), /^#leg_L bükülüyor ama içindeki 2 şekil/);
});
