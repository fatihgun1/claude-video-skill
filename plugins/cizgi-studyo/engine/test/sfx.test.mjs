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
