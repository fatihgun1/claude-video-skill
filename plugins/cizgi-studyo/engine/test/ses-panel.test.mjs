// Voice in the panel: views share a person's voice, one line spoken again, the person's own recording.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { voicesOf, voiceOwner, planAudio, linesOf } from "../src/ses.mjs";
import { wavSeconds } from "../src/panel-ses.mjs";
import { createJobs } from "../src/panel-is.mjs";

const episode = (kizVoice) => ({
  characters: [
    { id: "kiz", rig: "kiz", ...(kizVoice ? { voice: kizVoice } : {}) },
    { id: "kiz_on", rig: "kiz-on" },
    { id: "kiz_arka", rig: "kiz-arka", voice: { exaggeration: 1 } },
    { id: "ogrenci_on", rig: "ogrenci-on" },
  ],
  scenes: [{ scene_id: "s1", shots: [
    { shot_id: "a", utterances: [{ speaker: "kiz_on", text: "Merhaba" }, { speaker: "kiz", text: "Nasılsın" }] },
  ] }],
});

test("a view with no voice of its own speaks with its person's voice", () => {
  const v = voicesOf(episode({ ref: "sesler/kiz.wav" }));
  assert.deepEqual(v.kiz_on, { ref: "sesler/kiz.wav" }, "kiz-on is a view of kiz");
  assert.deepEqual(v.kiz_arka, { exaggeration: 1 }, "a view's own voice wins");
  assert.deepEqual(v.ogrenci_on, {}, "no person with the base rig: the default voice");
  assert.equal(voiceOwner(episode(), "kiz_on"), "kiz");
  assert.equal(voiceOwner(episode(), "kiz_arka"), "kiz_arka");
  assert.equal(voiceOwner(episode(), "ogrenci_on"), "ogrenci_on");
  assert.deepEqual(linesOf(episode({ ref: "r.wav" })).map((l) => l.voice), [{ ref: "r.wav" }, { ref: "r.wav" }]);
});

test("one line can be spoken again on its own; the others are kept as they are", () => {
  const lines = linesOf(episode());
  const plan = planAudio(lines, { lines: {} }, () => "x", () => false, { only: "a-1" });
  assert.deepEqual(plan.todo.map((l) => l.key), ["a-1"]);
  assert.deepEqual(plan.keep.map((l) => l.key), ["a-0"], "even a stale line is left for the full audio step");
  assert.throws(() => planAudio(lines, null, () => "x", () => true, { only: "b-0" }), /no line "b-0"/);
});

function wav({ seconds, rate = 16000, bits = 16, format = 1 }) {
  const n = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(format, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(bits, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(n * 2, 40);
  return buf;
}

test("a recording must be a 16-bit PCM WAV; its length is read from it", () => {
  assert.equal(wavSeconds(wav({ seconds: 5 })), 5);
  assert.throws(() => wavSeconds(Buffer.from("not a wav file at all, really not one at all...")), /WAV/);
  assert.throws(() => wavSeconds(wav({ seconds: 1, format: 3 })), /16 bit PCM/);
  assert.throws(() => wavSeconds(wav({ seconds: 1, bits: 8 })), /16 bit PCM/);
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

test("a ready voice from the library is cloned unless the person's own recording is set", async () => {
  const { ttsVoice } = await import("../src/ses.mjs");
  const lib = { voices: new Map([["kadin", { path: "/lib/sesler/kadin.wav" }]]) };
  const abs = (rel) => `/ep/${rel}`;
  assert.deepEqual(ttsVoice({ hazir: "kadin", exaggeration: 0.7 }, abs, lib), { exaggeration: 0.7, ref: "/lib/sesler/kadin.wav" });
  assert.deepEqual(ttsVoice({ hazir: "kadin", ref: "sesler/a.wav" }, abs, lib), { ref: "/ep/sesler/a.wav" }, "the person's recording wins");
  assert.deepEqual(ttsVoice({}, abs, lib), {});
});

test("the shipped library has the ready voices, and an unknown one is an error", async () => {
  const { loadLibrary } = await import("../src/library.mjs");
  const { validateEpisode } = await import("../src/validate.mjs");
  const lib = loadLibrary(new URL("../../library", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));
  assert.deepEqual([...lib.voices.keys()].sort(), ["cocuk", "erkek", "erkek-kalin", "kadin"]);
  assert.equal(lib.voices.get("kadin").ad, "Kadın");
  const ep = { episode: "x", language: "tr", characters: [{ id: "genc", rig: "genc", voice: { hazir: "yok" } }],
    scenes: [{ scene_id: "s1", bg: "sokak", shots: [{ shot_id: "a", cast: [{ id: "genc", action: "bekle-yan", mark: "orta" }], camera: { framing: "wide" } }] }] };
  assert.ok(validateEpisode(ep, lib).errors.some((e) => e.includes('ready voice "yok"')));
});
