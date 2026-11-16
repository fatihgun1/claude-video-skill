// A voice sample: one sentence in a character's voice settings, to choose the voice before the
// lines are spoken. It needs no script approval and leaves the episode's audio alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadLibrary } from "../src/library.mjs";
import { voiceSample, SAMPLE_TEXT } from "../src/ses.mjs";

const lib = loadLibrary(fileURLToPath(new URL("../../library", import.meta.url)));
const tools = { pythonTts: "py-tts", pythonAlign: "py-align", rhubarb: "rhubarb", ffmpeg: "ffmpeg" };

function episodeDir(lines = [{ speaker: "genc", text: "Abi, gel benimle." }]) {
  const dir = mkdtempSync(join(tmpdir(), "cizgi-ornek-"));
  const path = join(dir, "bolum.json");
  writeFileSync(path, JSON.stringify({
    episode: "ornek", language: "tr",
    characters: [{ id: "genc", rig: "genc", voice: { exaggeration: 0.9, cfg: 0.5 } }, { id: "ela", rig: "ela-profil" }],
    scenes: [{ scene_id: "s1", bg: "sokak", shots: [{ shot_id: "s1_sh1", utterances: lines, cast: [{ id: "genc", action: "bak", mark: "orta" }, { id: "ela", action: "bak", mark: "sol" }], camera: { framing: "wide", move: "static", target: "genc" } }] }],
  }));
  return { dir, path };
}

/** Stands in for the speech tools: writes the files they would write and remembers the calls. */
function fakeRun() {
  const calls = [];
  const run = (cmd, args) => {
    calls.push({ cmd, args });
    if (String(args[0]).endsWith("tts_batch.py")) {
      for (const job of JSON.parse(readFileSync(args[1], "utf8"))) writeFileSync(job.out, "RIFF-fake");
    } else if (cmd === "ffmpeg") {
      const out = args[args.length - 1];
      copyFileSync(args[args.indexOf("-i") + 1], out);
    }
    return "";
  };
  return { run, calls };
}

test("a sample speaks the character's first line with its voice settings, without the script approval", () => {
  const { dir, path } = episodeDir();
  const { run, calls } = fakeRun();
  const res = voiceSample(path, lib, tools, { run }, { karakter: "genc" });
  assert.equal(res.metin, "Abi, gel benimle.");
  assert.equal(res.dosya, "cikti/ses-ornegi-genc.wav");
  assert.ok(existsSync(join(dir, res.dosya)));
  const tts = calls.find((c) => String(c.args[0]).endsWith("tts_batch.py"));
  const [job] = JSON.parse(readFileSync(tts.args[1], "utf8"));
  assert.deepEqual(job.voice, { exaggeration: 0.9, cfg: 0.5 });
  assert.equal(job.lang, "tr");
  assert.equal(existsSync(join(dir, "ses", "manifest.json")), false, "the episode's audio is not touched");
  assert.ok(!calls.some((c) => c.cmd === "py-align" || c.cmd === "rhubarb"), "no listening check or mouth shapes for a sample");
});

test("a character with no lines speaks a sample sentence; a given text wins", () => {
  const { path } = episodeDir();
  const { run } = fakeRun();
  assert.equal(voiceSample(path, lib, tools, { run }, { karakter: "ela" }).metin, SAMPLE_TEXT.tr);
  assert.equal(voiceSample(path, lib, tools, { run }, { karakter: "genc", metin: "Bir, iki, üç." }).metin, "Bir, iki, üç.");
});

test("the narrator can be sampled; an unknown character cannot", () => {
  const { path } = episodeDir();
  const { run } = fakeRun();
  assert.equal(voiceSample(path, lib, tools, { run }, { karakter: "anlatici" }).dosya, "cikti/ses-ornegi-anlatici.wav");
  assert.throws(() => voiceSample(path, lib, tools, { run }, { karakter: "yok" }), /yok/);
});

test("the speech tool must be set up", () => {
  const { path } = episodeDir();
  const { run } = fakeRun();
  assert.throws(() => voiceSample(path, lib, { ffmpeg: "ffmpeg" }, { run }, { karakter: "genc" }), /python_tts|pythonTts/);
});
