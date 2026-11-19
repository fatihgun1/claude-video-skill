import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadLibrary } from "../src/library.mjs";
import { compileEpisode, escapeHtml, safeJoin, readAudioInfo } from "../src/compile.mjs";

const lib = loadLibrary(fileURLToPath(new URL("../../library", import.meta.url)));

function silentWav(seconds) {
  const rate = 8000;
  const data = Math.round(seconds * rate) * 2;
  const buf = Buffer.alloc(44 + data);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + data, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(data, 40);
  return buf;
}

function makeEpisodeDir(text = "Merhaba <b>dünya</b>") {
  const dir = mkdtempSync(join(tmpdir(), "cizgi-"));
  mkdirSync(join(dir, "ses"));
  writeFileSync(join(dir, "ses", "a.wav"), silentWav(1.2));
  writeFileSync(join(dir, "ses", "a.words.json"), JSON.stringify([{ word: "Merhaba", start: 0.1, end: 0.5 }]));
  writeFileSync(join(dir, "ses", "a.rhubarb.json"), JSON.stringify({ mouthCues: [{ start: 0, end: 0.3, value: "D" }] }));
  const episode = {
    episode: "test",
    title: "T & <x>",
    language: "tr",
    characters: [{ id: "pamuk", rig: "pamuk", palette: { accent: "#123456" } }],
    scenes: [
      {
        scene_id: "s1",
        bg: "cayir",
        shots: [
          {
            shot_id: "s1_sh1",
            utterances: [{ speaker: "pamuk", text, audio: "ses/a.wav" }],
            cast: [{ id: "pamuk", action: "selam", mark: "orta" }],
            camera: { framing: "wide" },
          },
        ],
      },
    ],
  };
  writeFileSync(join(dir, "bolum.json"), JSON.stringify(episode));
  return dir;
}

test("escapeHtml escapes markup characters", () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
});

test("safeJoin refuses paths that leave the episode folder", () => {
  const dir = makeEpisodeDir();
  assert.ok(safeJoin(dir, "ses/a.wav").endsWith("a.wav"));
  assert.throws(() => safeJoin(dir, "../disari.wav"), /escapes/);
  assert.throws(() => safeJoin(dir, "C:/Windows/win.ini"), /escapes/);
});

test("readAudioInfo reads duration and optional sidecars", () => {
  const dir = makeEpisodeDir();
  const info = readAudioInfo(join(dir, "ses", "a.wav"));
  assert.equal(info.duration, 1.2);
  assert.equal(info.words[0].word, "Merhaba");
  assert.equal(info.cues[0].value, "D");
  writeFileSync(join(dir, "ses", "b.wav"), silentWav(0.5));
  assert.deepEqual(readAudioInfo(join(dir, "ses", "b.wav")).cues, []);
  assert.throws(() => readAudioInfo(join(dir, "ses", "yok.wav")), /audio not found/);
});

test("compileEpisode writes a HyperFrames project with escaped text and copied assets", () => {
  const dir = makeEpisodeDir();
  const out = join(dir, "proje");
  const res = compileEpisode(join(dir, "bolum.json"), lib, out);
  assert.equal(res.shots, 1);
  const html = readFileSync(join(out, "index.html"), "utf8");
  assert.ok(html.includes('data-composition-id="main"'));
  assert.ok(html.includes("data-no-timeline"));
  assert.ok(html.includes(`data-duration="${res.duration}"`));
  assert.ok(html.includes("<title>T &amp; &lt;x&gt;</title>"));
  assert.ok(html.includes('id="pamuk--arm_L"'));
  assert.ok(html.includes("--accent:#123456"));
  assert.ok(html.includes('<audio id="ses-s1_sh1-0"'));
  assert.ok(!html.includes("<b>"), "caption text must be escaped");
  assert.ok(existsSync(join(out, "assets", "audio", "ses-s1_sh1-0.wav")));
  assert.ok(existsSync(join(out, "runtime", "player.js")));
  assert.ok(existsSync(join(out, "runtime", "yuz.js")));
  assert.ok(existsSync(join(out, "timing.json")));
});

test("caption falls back to text words and script data cannot close the tag", () => {
  const dir = makeEpisodeDir("bir </script> iki");
  writeFileSync(join(dir, "ses", "a.words.json"), "[]");
  const out = join(dir, "proje");
  compileEpisode(join(dir, "bolum.json"), lib, out, { format: "9:16" });
  const html = readFileSync(join(out, "index.html"), "utf8");
  assert.ok(html.includes('data-width="1080" data-height="1920"'));
  assert.ok(html.includes('<span class="kelime" data-parca="0">&lt;/script&gt;</span>'));
  assert.equal(html.split("</script>").length - 1, 4, "only the four real script tags close");
});

test("compileEpisode refuses an invalid episode", () => {
  const dir = makeEpisodeDir();
  const ep = JSON.parse(readFileSync(join(dir, "bolum.json"), "utf8"));
  ep.scenes[0].shots[0].cast[0].action = "uc";
  writeFileSync(join(dir, "bolum.json"), JSON.stringify(ep));
  assert.throws(() => compileEpisode(join(dir, "bolum.json"), lib, join(dir, "p")), /episode is invalid[\s\S]*"uc"/);
});

test("a jump in time reaches the player, so a pose does not blend over it", () => {
  // the player eased a seated pose into the next shot even after a cut to another moment
  const dir = makeEpisodeDir();
  const ep = JSON.parse(readFileSync(join(dir, "bolum.json"), "utf8"));
  ep.scenes[0].shots[0].zaman_atlama = true;
  writeFileSync(join(dir, "bolum.json"), JSON.stringify(ep));
  const out = join(dir, "proje");
  compileEpisode(join(dir, "bolum.json"), lib, out);
  assert.ok(readFileSync(join(out, "index.html"), "utf8").includes('"zaman_atlama":true'));
});
