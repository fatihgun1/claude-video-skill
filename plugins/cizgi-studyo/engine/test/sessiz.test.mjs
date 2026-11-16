// An episode with no line, effect or music still gets a sound track: a silent one, so the video
// has an audio stream (platforms and players expect one).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadLibrary } from "../src/library.mjs";
import { compileEpisode, silentWav } from "../src/compile.mjs";

const LIB = fileURLToPath(new URL("../../library", import.meta.url));
const SOKAK = fileURLToPath(new URL("../../../../ornekler/sokak/bolum.json", import.meta.url));
const FAZ1 = fileURLToPath(new URL("../../../../ornekler/faz1/bolum.json", import.meta.url));
const lib = loadLibrary(LIB);

test("a silent WAV is a valid PCM file of the asked length", () => {
  const wav = silentWav(2.5, 8000);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt32LE(24), 8000); // sample rate
  assert.equal(wav.readUInt16LE(34), 16); // bits per sample
  assert.equal(wav.readUInt32LE(40), 2.5 * 8000 * 2); // data bytes
  assert.equal(wav.length, 44 + 2.5 * 8000 * 2);
  assert.ok(wav.subarray(44).every((b) => b === 0));
});

test("a silent episode compiles with one silent track the length of the film", () => {
  const out = mkdtempSync(join(tmpdir(), "cizgi-sessiz-"));
  const res = compileEpisode(SOKAK, lib, out, {});
  const html = readFileSync(join(out, "index.html"), "utf8");
  const tags = html.match(/<audio [^>]*>/g) || [];
  assert.equal(tags.length, 1);
  assert.match(tags[0], /id="sessiz"/);
  assert.match(tags[0], new RegExp(`data-duration="${res.duration.toFixed(3)}"`));
  assert.ok(statSync(join(out, "assets", "audio", "sessiz.wav")).size > 44);
});

test("an episode with sound gets no silent track", () => {
  const out = mkdtempSync(join(tmpdir(), "cizgi-sesli-"));
  compileEpisode(FAZ1, lib, out, { missingAudio: "estimate" });
  assert.doesNotMatch(readFileSync(join(out, "index.html"), "utf8"), /id="sessiz"/);
});

test("the panel's preview leaves the silent track out (it is for the video file only)", () => {
  const out = mkdtempSync(join(tmpdir(), "cizgi-onizleme-"));
  compileEpisode(SOKAK, lib, out, { missingAudio: "estimate", silentTrack: false });
  assert.doesNotMatch(readFileSync(join(out, "index.html"), "utf8"), /<audio /);
});
