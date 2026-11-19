import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadLibrary } from "../src/library.mjs";
import { validateEpisode } from "../src/validate.mjs";
import { compileEpisode } from "../src/compile.mjs";
import { libraryFingerprint } from "../src/onay.mjs";

const lib = loadLibrary(fileURLToPath(new URL("../../library", import.meta.url)));

const episode = (sfx) => ({
  episode: "efekt",
  language: "tr",
  characters: [{ id: "ela", rig: "ela-profil" }],
  scenes: [{ scene_id: "s1", bg: "oda", shots: [
    { shot_id: "s1_sh1", cast: [{ id: "ela", action: "bekle", mark: "orta" }], camera: { framing: "wide" }, hold: 2, ...(sfx ? { sfx } : {}) },
  ] }],
});

function compiled(ep) {
  const dir = mkdtempSync(join(tmpdir(), "cizgi-sfx-"));
  const path = join(dir, "bolum.json");
  writeFileSync(path, JSON.stringify(ep));
  try {
    compileEpisode(path, lib, join(dir, "out"));
    return { html: readFileSync(join(dir, "out", "index.html"), "utf8"), dir };
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}

test("the library loads the bundled sound effects with their lengths", () => {
  assert.ok(lib.sfx.size >= 20);
  const kapi = lib.sfx.get("kapi-ac");
  assert.ok(kapi.duration > 0.1 && kapi.duration < 5, `kapi-ac lasts ${kapi.duration}s`);
});

test("a sound effect outside the library is an error", () => {
  const res = validateEpisode(episode([{ sfx: "patlama", at: 0.5 }]), lib);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('sound effect "patlama" is not in the library')));
  assert.equal(validateEpisode(episode([{ sfx: "kapi-ac", at: 0.5, volume: 0.6 }]), lib).ok, true);
});

test("a sound effect plays at its time inside the shot, each on its own track", () => {
  const { html, dir } = compiled(episode([{ sfx: "kapi-ac", at: 0.5, volume: 0.6 }, { sfx: "tik", at: 1.25 }]));
  try {
    assert.match(html, /<audio id="efekt-s1_sh1-0" src="assets\/audio\/efekt-s1_sh1-0\.wav" data-start="0\.5" data-duration="[\d.]+" data-track-index="2" data-volume="0\.6">/);
    assert.match(html, /<audio id="efekt-s1_sh1-1" [^>]*data-start="1\.25" [^>]*data-track-index="3" data-volume="1">/);
    assert.ok(existsSync(join(dir, "out", "assets", "audio", "efekt-s1_sh1-0.wav")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a sound effect that starts after its shot ends is refused before anything is written", () => {
  const dir = mkdtempSync(join(tmpdir(), "cizgi-sfx-"));
  try {
    const path = join(dir, "bolum.json");
    writeFileSync(path, JSON.stringify(episode([{ sfx: "tik", at: 9 }])));
    assert.throws(() => compileEpisode(path, lib, join(dir, "out")), /starts after the shot ends/);
    assert.equal(existsSync(join(dir, "out")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a sound effect is cut where the film ends", () => {
  const { html, dir } = compiled(episode([{ sfx: "kapi-ac", at: 2.5 }]));
  try {
    const film = Number(/data-composition-id[^>]*data-duration="([\d.]+)"|data-duration="([\d.]+)"[^>]*data-composition-id/.exec(html)?.slice(1).find(Boolean));
    const effect = Number(/<audio id="efekt-s1_sh1-0" [^>]*data-duration="([\d.]+)"/.exec(html)[1]);
    assert.ok(film > 0, "film duration found");
    assert.ok(2.5 + effect <= film + 0.001, `effect ends at ${2.5 + effect}s, film at ${film}s`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("adding a sound effect changes the library fingerprint; episodes without effects keep theirs", () => {
  const plain = libraryFingerprint(episode(), lib);
  assert.notEqual(libraryFingerprint(episode([{ sfx: "tik", at: 0.2 }]), lib), plain);
  const noSfxLib = { ...lib, sfx: new Map() };
  assert.equal(libraryFingerprint(episode(), noSfxLib), plain);
});

test("an effect tied to a line, a word, a moment or a walk plays on it (efekt.mjs)", async () => {
  // a "ding" tied to seconds fell on the wrong line when a recording got longer
  const { effectTimes } = await import("../src/efekt.mjs");
  const shot = {
    shot_id: "x", start: 10, end: 16,
    utterances: [{ start: 10.4, words: [] }, { start: 12, words: [{ start: 0 }, { start: 0.35 }] }],
    cast: [{ id: "ela", action: "yuru", walk: { dx: 300, time: 3 } }, { id: "ali", action: "egil-al" }],
  };
  const momentAt = (m, an) => (m.id === "ali" && an === "grab" ? 1.1 : null);
  assert.deepEqual(effectTimes({ sfx: "tik", at: 1 }, shot, lib, momentAt), [1]);
  assert.deepEqual(effectTimes({ sfx: "tik", replik: 1 }, shot, lib, momentAt), [2]);
  assert.deepEqual(effectTimes({ sfx: "tik", replik: 1, kelime: 1, ofset: 0.05 }, shot, lib, momentAt).map((t) => Math.round(t * 100) / 100), [2.4]);
  assert.deepEqual(effectTimes({ sfx: "tik", oyuncu: "ali", an: "grab" }, shot, lib, momentAt), [1.1]);
  assert.deepEqual(effectTimes({ sfx: "adim-beton", oyuncu: "ela", adim: true }, shot, lib, momentAt), [0, 0.6, 1.2, 1.8, 2.4], "a step every half walk cycle while the walk lasts");
  assert.throws(() => effectTimes({ sfx: "tik", oyuncu: "ela", an: "grab" }, shot, lib, momentAt), /no action of theirs/);
  assert.throws(() => effectTimes({ sfx: "tik", replik: 5 }, shot, lib, momentAt), /does not have/);
});

test("a tied effect follows its line in the film, steps fill a walk, and an effect stops at its shot's end", () => {
  const ep = episode([{ sfx: "tik", replik: 0 }, { sfx: "kapi-ac", at: 0.2 }]);
  ep.scenes[0].shots[0].utterances = [{ speaker: "ela", text: "Merhaba." }];
  ep.scenes[0].shots.push({ shot_id: "s1_sh2", cast: [{ id: "ela", action: "bekle", mark: "orta" }], camera: { framing: "wide" }, hold: 1 });
  const dir = mkdtempSync(join(tmpdir(), "cizgi-sfx-"));
  try {
    const path = join(dir, "bolum.json");
    writeFileSync(path, JSON.stringify(ep));
    compileEpisode(path, lib, join(dir, "out"), { missingAudio: "estimate" });
    const html = readFileSync(join(dir, "out", "index.html"), "utf8");
    const timing = JSON.parse(readFileSync(join(dir, "out", "timing.json"), "utf8"));
    const [one, two] = timing.shots;
    const tik = Number(/<audio id="efekt-s1_sh1-0" [^>]*data-start="([\d.]+)"/.exec(html)[1]);
    assert.equal(tik, one.utterances[0].start, "on the line's start");
    assert.deepEqual(one.efekt_at, [[Math.round((one.utterances[0].start - one.start) * 1000) / 1000], [0.2]], "the panel gets where each plays");
    const kapi = /<audio id="efekt-s1_sh1-1" [^>]*data-start="([\d.]+)" data-duration="([\d.]+)"/.exec(html);
    assert.ok(Number(kapi[1]) + Number(kapi[2]) <= one.end + 1e-6, "cut at the end of its own shot");
    assert.ok(two.start >= one.end);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an effect is tied to exactly one thing, and to something that is there", () => {
  const errs = (sfx, extra = {}) => {
    const ep = episode(sfx);
    Object.assign(ep.scenes[0].shots[0], extra);
    return validateEpisode(ep, lib).errors.join("\n");
  };
  assert.match(errs([{ sfx: "tik" }]), /needs exactly one of at/);
  assert.match(errs([{ sfx: "tik", at: 1, replik: 0 }]), /has at, replik/);
  assert.match(errs([{ sfx: "tik", replik: 2 }]), /tied to line 2/);
  assert.match(errs([{ sfx: "tik", oyuncu: "ali" }]), /not in this shot's cast/);
  assert.match(errs([{ sfx: "adim-beton", oyuncu: "ela", adim: true }]), /does not walk/);
  assert.match(errs([{ sfx: "tik", oyuncu: "ela", an: "grab" }]), /none of their actions has one/);
  assert.equal(errs([{ sfx: "tik", replik: 0, kelime: 0 }], { utterances: [{ speaker: "ela", text: "Merhaba." }] }), "");
});
