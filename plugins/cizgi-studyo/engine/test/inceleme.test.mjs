// Scene review: the checks the panel's "İncele" runs on one scene of a compiled draft.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadLibrary } from "../src/library.mjs";
import { validateEpisode } from "../src/validate.mjs";
import { compileEpisode, VIEWPORTS, propLayer } from "../src/compile.mjs";
import { reviewScene, CAPTION_MAX } from "../src/inceleme.mjs";
import "../src/runtime/core.js";

const LIB_DIR = fileURLToPath(new URL("../../library", import.meta.url));
const SOKAK = fileURLToPath(new URL("../../../../ornekler/sokak/bolum.json", import.meta.url));
const lib = loadLibrary(LIB_DIR);
const fresh = () => JSON.parse(readFileSync(SOKAK, "utf8"));

/** Compile a draft as the panel does and review one scene. */
function review(episode, sceneId, format = "16:9", extra = {}) {
  const out = mkdtempSync(join(tmpdir(), "cizgi-incele-"));
  compileEpisode(SOKAK, lib, out, { format, episode, missingAudio: "estimate" });
  const timing = JSON.parse(readFileSync(join(out, "timing.json"), "utf8"));
  const { anchors } = propLayer(timing, episode, lib, VIEWPORTS[format]);
  return reviewScene({ episode, sceneId, lib, timing, anchors, format, validation: validateEpisode(episode, lib), ...extra });
}
const kinds = (r) => r.sorunlar.map((s) => s.tur);

test("the example scene has no framing, overlap or caption problems", () => {
  const ep = fresh();
  const r = review(ep, "s1");
  assert.equal(r.sahne, "s1");
  assert.deepEqual(r.shots, ep.scenes[1].shots.map((s) => s.shot_id));
  for (const k of ["kadraj", "ust-uste", "altyazi"]) assert.ok(!kinds(r).includes(k), `${k}: ${JSON.stringify(r.sorunlar)}`);
});

test("someone pushed past the edge of a wide shot is out of frame; standing back makes them fit again", () => {
  const ep = fresh();
  const shot = ep.scenes[1].shots[1];
  shot.camera = { framing: "wide", move: "static" };
  shot.cast[0] = { ...shot.cast[0], mark: "sag", dx: 900 };
  delete shot.cast[0].walk;
  const r = review(ep, "s1");
  const found = r.sorunlar.find((s) => s.tur === "kadraj" && s.shot === shot.shot_id);
  assert.ok(found, JSON.stringify(r.sorunlar));
  assert.equal(found.seviye, "uyari");
});

test("two people on top of each other at the same depth are flagged; one standing back is not", () => {
  const ep = fresh();
  const shot = ep.scenes[1].shots[1];
  const other = ep.characters.find((c) => !shot.cast.some((m) => m.id === c.id)) || ep.characters[0];
  shot.cast = [
    { id: shot.cast[0].id, action: "bekle", mark: "orta" },
    { id: other.id === shot.cast[0].id ? ep.characters[1].id : other.id, action: "bekle", mark: "sol", dx: 380 },
  ];
  shot.camera = { framing: "wide", move: "static" };
  let r = review(ep, "s1");
  assert.ok(r.sorunlar.some((s) => s.tur === "ust-uste" && s.shot === shot.shot_id), JSON.stringify(r.sorunlar));
  shot.cast[1].back = 1;
  r = review(ep, "s1");
  assert.ok(!r.sorunlar.some((s) => s.tur === "ust-uste" && s.shot === shot.shot_id));
});

test("a long line warns that its caption will not fit; the limit is tighter in 9:16", () => {
  assert.ok(CAPTION_MAX["9:16"] < CAPTION_MAX["16:9"]);
  const ep = fresh();
  const shot = ep.scenes[1].shots.find((s) => s.utterances?.length) || ep.scenes[1].shots[0];
  const speaker = shot.cast[0].id;
  shot.utterances = [{ speaker, text: "kelime ".repeat(14).trim(), audio: "ses/uzun.wav" }];
  const wide = review(ep, "s1", "16:9");
  const tall = review(ep, "s1", "9:16");
  assert.ok(!wide.sorunlar.some((s) => s.tur === "altyazi"));
  assert.ok(tall.sorunlar.some((s) => s.tur === "altyazi" && s.shot === shot.shot_id));
  // big captions fit fewer letters, small ones more; a caption turned off is not checked
  ep.scenes[1].altyazi = { boyut: "buyuk" };
  assert.ok(review(ep, "s1", "16:9").sorunlar.some((s) => s.tur === "altyazi"));
  shot.utterances[0].text = "kelime ".repeat(9).trim(); // 62 letters: too many for 9:16 at the usual size
  delete ep.scenes[1].altyazi;
  assert.ok(review(ep, "s1", "9:16").sorunlar.some((s) => s.tur === "altyazi"));
  ep.scenes[1].altyazi = { boyut: "kucuk" };
  assert.ok(!review(ep, "s1", "9:16").sorunlar.some((s) => s.tur === "altyazi"));
  delete ep.scenes[1].altyazi;
  shot.utterances[0].altyazi = false;
  assert.ok(!review(ep, "s1", "9:16").sorunlar.some((s) => s.tur === "altyazi"));
  delete shot.utterances[0].altyazi;
  ep.altyazi = { kapali: true };
  assert.ok(!review(ep, "s1", "9:16").sorunlar.some((s) => s.tur === "altyazi"));
});

test("validation messages, unspoken lines and failed listening checks of the scene are listed; other scenes' are not", () => {
  const ep = fresh();
  // the example has no lines: give one shot in each scene a line
  for (const shot of [ep.scenes[0].shots[0], ep.scenes[1].shots[0]]) {
    shot.utterances = [{ speaker: shot.cast[0].id, text: "Merhaba", audio: `ses/${shot.shot_id}-yeni.wav` }];
  }
  const s0shot = ep.scenes[0].shots[0].shot_id;
  const s1shot = ep.scenes[1].shots[0].shot_id;
  const validation = { ok: true, errors: [], warnings: [`shot ${s1shot}: bir uyarı`, `shot ${s0shot}: başka sahne`, "genel bir uyarı"] };
  const r = review(ep, "s1", "16:9", { validation, unspoken: [`${s1shot}-0`, `${s0shot}-0`], failed: [{ key: `${s1shot}-0`, heard: "x" }] });
  const v = r.sorunlar.filter((s) => s.tur === "dogrulama");
  assert.deepEqual(v.map((s) => s.shot), [s1shot]);
  assert.ok(r.sorunlar.some((s) => s.tur === "ses" && s.seviye === "bilgi" && s.shot === s1shot));
  assert.ok(r.sorunlar.some((s) => s.tur === "dinleme" && s.seviye === "uyari" && s.shot === s1shot));
  assert.ok(!r.sorunlar.some((s) => s.shot === s0shot));
  assert.equal(r.sayac.uyari, r.sorunlar.filter((s) => s.seviye === "uyari").length);
});

test("a scene named in a message counts only for itself, and odd ids are just text", () => {
  const ep = fresh();
  const validation = { ok: false, errors: ["scene s1: background is wrong", "scene s1-b: other", "scene s10: other"], warnings: [] };
  const r = review(ep, "s1", "16:9", { validation });
  assert.deepEqual(r.sorunlar.filter((s) => s.tur === "dogrulama").map((s) => s.mesaj), ["scene s1: background is wrong"]);
  const odd = fresh();
  odd.scenes[1].scene_id = "s(1+";
  odd.scenes[1].shots[0].utterances = [{ speaker: "x" }]; // no text: an invalid draft
  assert.doesNotThrow(() => reviewScene({ episode: odd, sceneId: "s(1+", lib, timing: { shots: [] }, anchors: [], format: "16:9", validation: { errors: ["scene s(1+: bad id"], warnings: [] } }));
});

test("an unknown scene is an error", () => {
  assert.throws(() => review(fresh(), "yok"), /sahne/);
});
