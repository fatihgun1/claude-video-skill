// Voice in the panel: views share a person's voice, one line spoken again, the ready voices.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { voicesOf, voiceOwner, planAudio, linesOf } from "../src/ses.mjs";
import { createJobs } from "../src/panel-is.mjs";

const episode = (kizVoice) => ({
  characters: [
    { id: "kiz", rig: "kiz", ...(kizVoice ? { voice: kizVoice } : {}) },
    { id: "kiz_on", rig: "kiz-on" },
    { id: "kiz_arka", rig: "kiz-arka", voice: { hazir: "cocuk" } },
    { id: "ogrenci_on", rig: "ogrenci-on" },
  ],
  scenes: [{ scene_id: "s1", shots: [
    { shot_id: "a", utterances: [{ speaker: "kiz_on", text: "Merhaba" }, { speaker: "kiz", text: "Nasılsın" }] },
  ] }],
});

test("a view with no voice of its own speaks with its person's voice", () => {
  const v = voicesOf(episode({ hazir: "kadin" }));
  assert.deepEqual(v.kiz_on, { hazir: "kadin" }, "kiz-on is a view of kiz");
  assert.deepEqual(v.kiz_arka, { hazir: "cocuk" }, "a view's own voice wins");
  assert.deepEqual(v.ogrenci_on, {}, "no person with the base rig: the default voice");
  assert.equal(voiceOwner(episode(), "kiz_on"), "kiz");
  assert.equal(voiceOwner(episode(), "kiz_arka"), "kiz_arka");
  assert.equal(voiceOwner(episode(), "ogrenci_on"), "ogrenci_on");
  assert.deepEqual(linesOf(episode({ hazir: "erkek" })).map((l) => l.voice), [{ hazir: "erkek" }, { hazir: "erkek" }]);
});

test("one line can be spoken again on its own; the others are kept as they are", () => {
  const lines = linesOf(episode());
  const plan = planAudio(lines, { lines: {} }, () => "x", () => false, { only: "a-1" });
  assert.deepEqual(plan.todo.map((l) => l.key), ["a-1"]);
  assert.deepEqual(plan.keep.map((l) => l.key), ["a-0"], "even a stale line is left for the full audio step");
  assert.throws(() => planAudio(lines, null, () => "x", () => true, { only: "b-0" }), /no line "b-0"/);
});

test("a line job speaks one line again: its key goes after the episode", () => {
  const calls = [];
  const spawn = (cmd, args) => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
    calls.push({ args, child });
    return child;
  };
  const jobs = createJobs({ cli: "/x/cli.mjs", spawn });
  jobs.start("/e/bolum.json", "satir", "16:9", "s1_sh3-0");
  assert.deepEqual(calls[0].args, ["/x/cli.mjs", "ses", "/e/bolum.json", "s1_sh3-0"]);
  assert.throws(() => createJobs({ cli: "/x/cli.mjs", spawn }).start("/e/bolum.json", "satir", "16:9", "../x"), /line key/);
  calls[0].child.stdout.emit("data", '{"generated":["s1_sh3-0"],"kept":[],"failed":[{"key":"s1_sh3-0","cer":0.2,"heard":"x"}]}');
  calls[0].child.emit("close", 3);
  assert.equal(jobs.get("/e/bolum.json").status, "done", "a take that failed the check is still a finished job");
});

test("the shipped library has the ready voices, and an unknown one is an error", async () => {
  const { loadLibrary } = await import("../src/library.mjs");
  const { validateEpisode } = await import("../src/validate.mjs");
  const lib = loadLibrary(new URL("../../library", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));
  assert.deepEqual([...lib.voices.keys()], ["kadin", "kadin-2", "erkek", "erkek-kalin", "yasli", "cocuk"]);
  assert.equal(lib.voices.get("kadin").ad, "Kadın");
  assert.deepEqual(lib.voices.get("erkek-kalin"), { edge: "tr-TR-AhmetNeural", perde: -12, hiz: 0, ad: "Kalın erkek", not: "Yetişkin erkek, kalın ve tok" });
  for (const v of lib.voices.values()) assert.match(v.edge, /^tr-TR-(Ahmet|Emel)Neural$/);
  const ep = { episode: "x", language: "tr", characters: [{ id: "genc", rig: "genc", voice: { hazir: "yok" } }],
    scenes: [{ scene_id: "s1", bg: "sokak", shots: [{ shot_id: "a", cast: [{ id: "genc", action: "bekle-yan", mark: "orta" }], camera: { framing: "wide" } }] }] };
  assert.ok(validateEpisode(ep, lib).errors.some((e) => e.includes('ready voice "yok"')));
});

test("every line is brought to the same clear level; a peak never clips, a near-silent take is not blown up", async () => {
  const { levelGain, level, TARGET_DB, PEAK_DB } = await import("../src/ses-duzey.mjs");
  const rate = 16000;
  const tone = (amp) => Float32Array.from({ length: rate }, (_, i) => amp * Math.sin((2 * Math.PI * 220 * i) / rate));
  const db = (x) => 20 * Math.log10(x);
  // a quiet line (rms of a sine = amp / √2): raised to the target
  const quiet = tone(0.03);
  const g = levelGain({ rate, samples: quiet });
  assert.ok(Math.abs(db((0.03 / Math.SQRT2) * g) - TARGET_DB) < 0.5, "speech at the target");
  // a loud line, even pushed twice as loud: the soft limiter keeps every sample under PEAK_DB
  const loud = tone(0.95);
  const out = level(loud, levelGain({ rate, samples: loud }) * 2);
  assert.ok(db(Math.max(...out.map(Math.abs))) <= PEAK_DB + 1e-6);
  // quiet parts pass the limiter untouched
  assert.equal(level(Float32Array.of(0.1), 2)[0], Float32Array.of(0.2)[0]);
  // silence stays silence
  assert.equal(levelGain({ rate, samples: new Float32Array(rate) }), 1);
  // a whisper: at most +24 dB
  assert.ok(db(levelGain({ rate, samples: tone(0.0001) })) <= 24 + 1e-6);
});
