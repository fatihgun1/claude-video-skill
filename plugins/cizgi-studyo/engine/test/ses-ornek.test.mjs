// A voice sample: one sentence in a character's voice settings, to choose the voice before the
// lines are spoken. It needs no script approval and leaves the episode's audio alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadLibrary } from "../src/library.mjs";
import { voiceSample, SAMPLE_TEXT } from "../src/ses.mjs";

const lib = loadLibrary(fileURLToPath(new URL("../../library", import.meta.url)));
const tools = { pythonTts: "py-tts", rhubarb: "rhubarb", ffmpeg: "ffmpeg" };
const lockPath = join(mkdtempSync(join(tmpdir(), "cizgi-kilit-")), "ses.lock");

function episodeDir(lines = [{ speaker: "genc", text: "Abi, gel benimle." }]) {
  const dir = mkdtempSync(join(tmpdir(), "cizgi-ornek-"));
  const path = join(dir, "bolum.json");
  writeFileSync(path, JSON.stringify({
    episode: "ornek", language: "tr",
    characters: [{ id: "genc", rig: "genc", voice: { hazir: "cocuk", hiz: 10 } }, { id: "ela", rig: "ela-profil" }],
    scenes: [{ scene_id: "s1", bg: "sokak", shots: [{ shot_id: "s1_sh1", utterances: lines, cast: [{ id: "genc", action: "bak", mark: "orta" }, { id: "ela", action: "bak", mark: "sol" }], camera: { framing: "wide", move: "static", target: "genc" } }] }],
  }));
  return { dir, path };
}

/** Stands in for the speech tools: writes the files they would write and remembers the calls. */
function fakeRun() {
  const calls = [];
  const run = (cmd, args) => {
    calls.push({ cmd, args });
    if (String(args[0]).endsWith("tts_edge.py")) {
      for (const job of JSON.parse(readFileSync(args[1], "utf8"))) writeFileSync(job.out, "RIFF-fake");
    }
    return "";
  };
  return { run, calls, lockPath };
}

test("a sample speaks the character's first line with its voice settings, without the script approval", () => {
  const { dir, path } = episodeDir();
  const { run, calls } = fakeRun();
  const res = voiceSample(path, lib, tools, { run, lockPath }, { karakter: "genc" });
  assert.equal(res.metin, "Abi, gel benimle.");
  assert.equal(res.dosya, "cikti/ses-ornegi-genc.wav");
  assert.ok(existsSync(join(dir, res.dosya)));
  const tts = calls.find((c) => String(c.args[0]).endsWith("tts_edge.py"));
  const [job] = JSON.parse(readFileSync(tts.args[1], "utf8"));
  // cocuk is Emel +25 Hz +8 %, and this character speaks 10 % faster still
  assert.deepEqual([job.voice, job.pitch, job.rate, job.volume], ["tr-TR-EmelNeural", "+25Hz", "+18%", "+0%"]);
  assert.equal(existsSync(join(dir, "ses", "manifest.json")), false, "the episode's audio is not touched");
  assert.ok(!calls.some((c) => c.cmd === "rhubarb"), "no mouth shapes for a sample");
});

test("a character with no lines speaks a sample sentence; a given text wins", () => {
  const { path } = episodeDir();
  const { run } = fakeRun();
  assert.equal(voiceSample(path, lib, tools, { run, lockPath }, { karakter: "ela" }).metin, SAMPLE_TEXT.tr);
  assert.equal(voiceSample(path, lib, tools, { run, lockPath }, { karakter: "genc", metin: "Bir, iki, üç." }).metin, "Bir, iki, üç.");
});

test("the narrator can be sampled; an unknown character cannot", () => {
  const { path } = episodeDir();
  const { run } = fakeRun();
  assert.equal(voiceSample(path, lib, tools, { run, lockPath }, { karakter: "anlatici" }).dosya, "cikti/ses-ornegi-anlatici.wav");
  assert.throws(() => voiceSample(path, lib, tools, { run, lockPath }, { karakter: "yok" }), /yok/);
});

test("the speech tool must be set up", () => {
  const { path } = episodeDir();
  const { run } = fakeRun();
  assert.throws(() => voiceSample(path, lib, { ffmpeg: "ffmpeg" }, { run, lockPath }, { karakter: "genc" }), /python_tts|pythonTts/);
});
