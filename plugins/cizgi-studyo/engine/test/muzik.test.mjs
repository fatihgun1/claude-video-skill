// Sound mix: line delay and volume, track volumes (mix), and background music with fades
// and ducking under speech, mixed into one file at compile time.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadLibrary } from "../src/library.mjs";
import { validateEpisode } from "../src/validate.mjs";
import { libraryFingerprint } from "../src/onay.mjs";
import { compileEpisode } from "../src/compile.mjs";
import { buildTimeline, TIMING } from "../src/timing.mjs";
import { readWav, writeWav, musicGain, mixMusic } from "../src/muzik.mjs";

const LIB_DIR = fileURLToPath(new URL("../../library", import.meta.url));
let dir, lib;

/** A PCM16 sine tone: `seconds` long at 22050 Hz. */
function tone(seconds, rate = 22050, channels = 1) {
  const n = Math.round(seconds * rate);
  const samples = new Int16Array(n * channels);
  for (let i = 0; i < n; i++) for (let c = 0; c < channels; c++) samples[i * channels + c] = Math.round(Math.sin(i / 10) * 10000);
  return writeWav({ rate, channels, samples });
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), "cizgi-muzik-"));
  cpSync(LIB_DIR, join(dir, "library"), { recursive: true });
  mkdirSync(join(dir, "library", "muzik"), { recursive: true });
  writeFileSync(join(dir, "library", "muzik", "deneme-ezgi.wav"), tone(1.5));
  lib = loadLibrary(join(dir, "library"));
});
after(() => rmSync(dir, { recursive: true, force: true }));

/** Pamuk says one line; the audio is a 1 s tone written next to the episode. */
function episode(extra = {}, line = {}) {
  const epDir = join(dir, "ep");
  mkdirSync(join(epDir, "ses"), { recursive: true });
  writeFileSync(join(epDir, "ses", "s1_sh1-0.wav"), tone(1));
  return {
    path: join(epDir, "bolum.json"),
    episode: {
      episode: "muzik-deneme", language: "tr",
      characters: [{ id: "pamuk", name: "Pamuk", rig: "pamuk" }],
      scenes: [{ scene_id: "s1", bg: "cayir", shots: [{
        shot_id: "s1_sh1",
        utterances: [{ speaker: "pamuk", text: "Merhaba!", ...line }],
        cast: [{ id: "pamuk", action: "bekle", mark: "orta" }],
        sfx: [{ sfx: "tik", at: 0.2, volume: 0.5 }],
        camera: { framing: "wide", move: "static", target: "pamuk" },
        hold: 1,
      }] }],
      ...extra,
    },
  };
}

test("a line can wait a little longer before it is spoken (utterance.delay)", () => {
  const ep = episode({}, { delay: 0.7 }).episode;
  const t = buildTimeline(ep, () => ({ duration: 1 }));
  const u = t.shots[0].utterances[0];
  assert.equal(u.start, TIMING.lead + 0.7);
  assert.equal(t.shots[0].end, TIMING.lead + 0.7 + 1 + 1 + TIMING.tail);
});

test("WAV files read back as written", () => {
  const w = readWav(tone(0.25, 16000, 2));
  assert.equal(w.rate, 16000);
  assert.equal(w.channels, 2);
  assert.equal(w.samples.length, 4000 * 2);
  assert.throws(() => readWav(Buffer.from("not a wav")), /WAV/);
});

test("music fades in and out and ducks under speech", () => {
  const m = { volume: 0.5, fade_in: 1, fade_out: 2, duck: 0.4 };
  const speech = [{ start: 4, end: 6 }];
  const g = (t) => musicGain(t, 10, m, speech);
  assert.equal(g(0), 0);
  assert.ok(Math.abs(g(0.5) - 0.25) < 1e-9);
  assert.equal(g(2), 0.5);
  assert.ok(Math.abs(g(5) - 0.2) < 1e-9); // during the line: volume × duck
  assert.equal(g(10), 0);
  assert.ok(Math.abs(g(9) - 0.25) < 1e-9);
  // the duck eases in and out instead of jumping
  assert.ok(g(3.9) < 0.5 && g(3.9) > 0.2);
});

test("a short track loops to fill the film; without loop it plays once", () => {
  const w = readWav(tone(1, 1000));
  const looped = mixMusic(w, 3, { volume: 1, fade_in: 0, fade_out: 0, duck: 1 }, []);
  assert.equal(looped.samples.length, 3000);
  // each pass after the first starts a fade (X frames) before the track's end: period L = frames - X
  const frames = w.samples.length / w.channels;
  const X = Math.min(Math.round(0.5 * w.rate), Math.floor(frames / 4));
  const L = frames - X;
  assert.equal(looped.samples[2 * L + X + 37], w.samples[X + 37]);
  // at the seam the tail fades into the head: no jump bigger than the tone's own steps
  const steps = (arr, from, to) => Math.max(...Array.from({ length: to - from }, (_, k) => Math.abs(arr[from + k + 1] - arr[from + k])));
  assert.ok(steps(looped.samples, L - 5, L + 5) <= steps(w.samples, 0, 50) * 1.5 + 1);
  const once = mixMusic(w, 3, { volume: 1, fade_in: 0, fade_out: 0, duck: 1, loop: false }, []);
  assert.equal(once.samples[2500], 0);
});

test("the library lists music tracks from library/muzik", () => {
  assert.equal(lib.music.get("deneme-ezgi").duration, 1.5);
});

test("an episode names music from the library only, with volumes in range", () => {
  assert.deepEqual(validateEpisode(episode({ music: { track: "deneme-ezgi" } }).episode, lib).errors, []);
  assert.ok(validateEpisode(episode({ music: { track: "yok" } }).episode, lib).errors.some((e) => /music "yok"/.test(e)));
  assert.ok(validateEpisode(episode({ music: { track: "deneme-ezgi", volume: 2 } }).episode, lib).errors.length > 0);
  assert.ok(validateEpisode(episode({}, { volume: -1 }).episode, lib).errors.length > 0);
  assert.deepEqual(validateEpisode(episode({ mix: { lines: 1.5 } }).episode, lib).errors, []); // lines go to 200%
  assert.ok(validateEpisode(episode({ mix: { lines: 2.5 } }).episode, lib).errors.length > 0);
});

test("compiling mixes the music into one sound and applies line and track volumes", () => {
  const { path, episode: ep } = episode({ music: { track: "deneme-ezgi", volume: 0.3 }, mix: { lines: 0.8, sfx: 0.5 } }, { volume: 0.5 });
  const out = join(dir, "out");
  compileEpisode(path, lib, out, { episode: ep });
  const html = readFileSync(join(out, "index.html"), "utf8");
  assert.match(html, /<audio id="muzik" src="assets\/audio\/muzik\.wav" data-start="0"/);
  assert.match(html, /<audio id="ses-s1_sh1-0" [^>]*data-volume="0\.4"/); // 0.5 × 0.8
  assert.match(html, /<audio id="efekt-s1_sh1-0" [^>]*data-volume="0\.25"/); // 0.5 × 0.5
  const music = readWav(readFileSync(join(out, "assets", "audio", "muzik.wav")));
  const t = buildTimeline(ep, () => ({ duration: 1 }));
  assert.ok(Math.abs(music.samples.length / music.rate - t.duration) < 0.01);
  // no music: no music file
  const plain = episode();
  const out2 = join(dir, "out2");
  compileEpisode(plain.path, lib, out2, { episode: plain.episode });
  assert.equal(existsSync(join(out2, "assets", "audio", "muzik.wav")), false);
});

test("the library fingerprint covers the music track itself", () => {
  const ep = episode({ music: { track: "deneme-ezgi" } }).episode;
  const a = libraryFingerprint(ep, lib);
  writeFileSync(join(dir, "library", "muzik", "deneme-ezgi.wav"), tone(1.2));
  const b = libraryFingerprint(ep, loadLibrary(join(dir, "library")));
  writeFileSync(join(dir, "library", "muzik", "deneme-ezgi.wav"), tone(1.5));
  assert.notEqual(a, b);
});

test("WAV reading: extensible 16-bit PCM is fine, other kinds and broken headers are refused clearly", async () => {
  const { readWavInfo } = await import("../src/muzik.mjs");
  const base = tone(0.1);
  // the same sound as WAVE_FORMAT_EXTENSIBLE (fmt chunk of 40 bytes, subformat PCM)
  const ext = Buffer.alloc(base.length + 24);
  base.copy(ext, 0, 0, 12);
  ext.write("fmt ", 12, "latin1");
  ext.writeUInt32LE(40, 16);
  ext.writeUInt16LE(0xfffe, 20);
  base.copy(ext, 22, 22, 36); // channels, rate, byte rate, block align, bits
  ext.writeUInt16LE(22, 36); // cbSize
  ext.writeUInt16LE(16, 38); // valid bits
  ext.writeUInt32LE(4, 40); // channel mask
  ext.writeUInt16LE(1, 44); // subformat: PCM
  base.copy(ext, 60, 36); // data chunk
  ext.writeUInt32LE(ext.length - 8, 4);
  assert.equal(readWav(ext).samples.length, readWav(base).samples.length);
  const float = Buffer.from(base);
  float.writeUInt16LE(3, 20);
  assert.throws(() => readWav(float), /16-bit PCM/);
  const eight = Buffer.from(base);
  eight.writeUInt16LE(8, 34);
  assert.throws(() => readWav(eight), /16-bit PCM/);
  const noChannels = Buffer.from(base);
  noChannels.writeUInt16LE(0, 22);
  assert.throws(() => readWav(noChannels), /channel/);
  const shortFmt = Buffer.from(base);
  shortFmt.writeUInt32LE(8, 16);
  assert.throws(() => readWav(shortFmt), /fmt/);
  // the duration from the header alone
  assert.ok(Math.abs(readWavInfo(tone(1.5)).duration - 1.5) < 1e-9);
});

test("a pause before a line does not make it be spoken again, but the storyboard goes stale", async () => {
  const { lineFingerprint, linesOf } = await import("../src/ses.mjs");
  const { storyboardFingerprint } = await import("../src/onay.mjs");
  const a = episode().episode;
  const b = episode({}, { delay: 0.8, volume: 0.5 }).episode;
  const fp = (ep) => linesOf(ep).map((l) => lineFingerprint(l, "tr", 1));
  assert.deepEqual(fp(a), fp(b));
  assert.notEqual(storyboardFingerprint(a, null, "x"), storyboardFingerprint(b, null, "x"));
});

test("music for a long film mixes quickly", () => {
  const w = readWav(tone(2, 44100));
  const speech = Array.from({ length: 100 }, (_, i) => ({ start: i * 3 + 0.5, end: i * 3 + 2 }));
  const t0 = Date.now();
  mixMusic(w, 300, { volume: 0.4 }, speech);
  assert.ok(Date.now() - t0 < 4000, `took ${Date.now() - t0} ms`);
});

test("the panel's preview can stand in for a line not spoken yet; a real compile still needs the audio", () => {
  const { path, episode: ep } = episode();
  ep.scenes[0].shots[0].utterances.push({ speaker: "pamuk", text: "Bu replik henüz seslendirilmedi." });
  assert.throws(() => compileEpisode(path, lib, join(dir, "out3"), { episode: ep }), /audio not found/);
  const res = compileEpisode(path, lib, join(dir, "out4"), { episode: ep, missingAudio: "estimate" });
  assert.deepEqual(res.estimated, ["s1_sh1-1"]);
  const html = readFileSync(join(dir, "out4", "index.html"), "utf8");
  assert.ok(!html.includes('id="ses-s1_sh1-1"')); // nothing to play for it
  const t = JSON.parse(readFileSync(join(dir, "out4", "timing.json"), "utf8"));
  const u = t.shots[0].utterances[1];
  assert.ok(u.end - u.start > 1, "a sentence gets a few seconds");
});
