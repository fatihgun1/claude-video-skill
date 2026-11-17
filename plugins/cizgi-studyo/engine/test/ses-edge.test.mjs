// Edge TTS: what each line asks Edge for (voice, feeling, tempo), one voice job at a time, and
// episodes that still carry the old engine's voice settings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadLibrary } from "../src/library.mjs";
import { validateEpisode } from "../src/validate.mjs";
import { MOODS, edgeSettings, DEFAULT_EDGE_VOICE, readyVoicePreview, PREVIEW_TEXT } from "../src/ses.mjs";
import { withVoiceLock, lockHolder } from "../src/ses-kilit.mjs";

const lib = loadLibrary(fileURLToPath(new URL("../../library", import.meta.url)));
const tmpLock = () => join(mkdtempSync(join(tmpdir(), "cizgi-kilit-")), "ses.lock");

test("a ready voice gives its Edge voice and presets; the character's own perde and hiz add to them", () => {
  assert.deepEqual(edgeSettings({ hazir: "erkek-kalin" }, undefined, lib), { voice: "tr-TR-AhmetNeural", rate: "+0%", pitch: "-12Hz", volume: "+0%" });
  assert.deepEqual(edgeSettings({ hazir: "cocuk", perde: 5, hiz: -8 }, undefined, lib), { voice: "tr-TR-EmelNeural", rate: "+0%", pitch: "+30Hz", volume: "+0%" });
  // no ready voice: the library's first one (kadin); no library voices at all: Emel as she is
  assert.equal(edgeSettings({}, undefined, lib).voice, "tr-TR-EmelNeural");
  assert.deepEqual(edgeSettings(undefined, undefined, { voices: new Map() }), { voice: DEFAULT_EDGE_VOICE, rate: "+0%", pitch: "+0Hz", volume: "+0%" });
});

test("every feeling shifts rate, pitch and loudness; an unknown one changes nothing", () => {
  assert.deepEqual(Object.keys(MOODS).sort(), ["heyecanli", "kizgin", "korkmus", "neseli", "sakin", "uzgun"]);
  const flat = edgeSettings({ hazir: "kadin" }, undefined, lib);
  for (const [duygu, m] of Object.entries(MOODS)) {
    const s = edgeSettings({ hazir: "kadin" }, duygu, lib);
    assert.notDeepEqual(s, flat, duygu);
    assert.equal(s.rate, `${m.rate > 0 ? "+" : ""}${m.rate}%`, duygu);
    assert.equal(s.pitch, `${m.pitch > 0 ? "+" : ""}${m.pitch}Hz`, duygu);
    assert.equal(s.volume, `${m.volume > 0 ? "+" : ""}${m.volume}%`, duygu);
  }
  assert.ok(MOODS.heyecanli.rate > 0 && MOODS.uzgun.rate < 0, "excited is faster, sad is slower");
  assert.deepEqual(edgeSettings({ hazir: "kadin" }, "yok", lib), flat);
});

test("the profile tempo becomes Edge's rate, added to the voice's and the feeling's, within bounds", () => {
  assert.equal(edgeSettings({ hazir: "kadin" }, undefined, lib, 0.85).rate, "-15%");
  assert.equal(edgeSettings({ hazir: "cocuk" }, "uzgun", lib, 0.85).rate, "-25%"); // +8 -18 -15
  assert.equal(edgeSettings({ hazir: "kadin", hiz: 40 }, "heyecanli", lib, 1.5).rate, "+100%", "capped");
});

test("the voice lock runs one job at a time and lets go afterwards, even when the job fails", () => {
  const lockPath = tmpLock();
  const seen = withVoiceLock("a/bolum.json", () => lockHolder(lockPath), { lockPath });
  assert.equal(seen.pid, process.pid);
  assert.equal(seen.bolum, "a/bolum.json");
  assert.ok(!existsSync(lockPath));
  assert.throws(() => withVoiceLock("a", () => { throw new Error("boom"); }, { lockPath }), /boom/);
  assert.ok(!existsSync(lockPath), "released after a failure");
});

test("a second voice job waits, then says clearly that one is running", () => {
  const lockPath = tmpLock();
  writeFileSync(lockPath, JSON.stringify({ pid: 4242, bolum: "kose-basi/bolum.json" }));
  const logged = [];
  assert.throws(
    () => withVoiceLock("b", () => assert.fail("must not run"), { lockPath, waitMs: 0, isAlive: () => true, log: (m) => logged.push(m) }),
    /başka bir seslendirme sürüyor \(bölüm: kose-basi\/bolum\.json, süreç 4242\)/,
  );
  assert.equal(JSON.parse(readFileSync(lockPath, "utf8")).pid, 4242, "someone else's lock is left alone");
  // it waits while the other runs, and goes on once that one ends
  let polls = 0;
  const done = withVoiceLock("b", () => "ran", { lockPath, waitMs: 5000, isAlive: () => ++polls < 3, log: (m) => logged.push(m) });
  assert.equal(done, "ran");
  assert.ok(logged.some((m) => /bekleniyor/.test(m)));
});

test("a lock left by a process that is gone, or a broken lock file, is stale", () => {
  const lockPath = tmpLock();
  writeFileSync(lockPath, JSON.stringify({ pid: 999999999, bolum: "eski" }));
  assert.equal(withVoiceLock("c", () => "ran", { lockPath, waitMs: 0 }), "ran");
  writeFileSync(lockPath, "{broken");
  assert.equal(withVoiceLock("c", () => "ran", { lockPath, waitMs: 0 }), "ran");
});

test("a ready voice's preview is spoken once and then comes from the cache", () => {
  const cache = mkdtempSync(join(tmpdir(), "cizgi-onizleme-"));
  const calls = [];
  const run = (cmd, args) => {
    calls.push(args);
    for (const job of JSON.parse(readFileSync(args[1], "utf8"))) writeFileSync(job.out, "RIFF-fake");
  };
  const tools = { pythonTts: "py", ffmpeg: "ffmpeg" };
  const first = readyVoicePreview(lib, tools, { run }, "yasli", cache);
  assert.ok(existsSync(first));
  const [job] = JSON.parse(readFileSync(calls[0][1], "utf8"));
  assert.deepEqual([job.text, job.voice, job.pitch, job.rate], [PREVIEW_TEXT, "tr-TR-AhmetNeural", "-8Hz", "-12%"]);
  assert.equal(readyVoicePreview(lib, tools, { run }, "yasli", cache), first);
  assert.equal(calls.length, 1, "cached");
  assert.equal(readyVoicePreview(lib, tools, { run }, "yok", cache), null);
});

test("the old engine's voice settings are dropped with a warning; the new ones are checked", () => {
  const ep = (voice) => ({
    episode: "x", language: "tr", characters: [{ id: "genc", rig: "genc", voice }], narrator_voice: { cfg: 0.5 },
    scenes: [{ scene_id: "s1", bg: "sokak", shots: [{ shot_id: "a", cast: [{ id: "genc", action: "bekle-yan", mark: "orta" }], camera: { framing: "wide" } }] }],
  });
  const old = ep({ hazir: "erkek", exaggeration: 0.85, ref: "sesler/genc.wav" });
  const res = validateEpisode(old, lib);
  assert.ok(res.ok, res.errors.join("\n"));
  assert.ok(res.warnings.some((w) => /character "genc": voice ref, exaggeration no longer used/.test(w)));
  assert.ok(res.warnings.some((w) => /narrator: voice cfg/.test(w)));
  assert.equal(old.characters[0].voice.exaggeration, 0.85, "the episode itself is not changed");
  assert.ok(validateEpisode(ep({ hazir: "erkek", perde: -10, hiz: 15 }), lib).ok);
  assert.ok(!validateEpisode(ep({ perde: 90 }), lib).ok, "perde out of range");
  assert.ok(!validateEpisode(ep({ ses: "x" }), lib).ok, "unknown voice fields are still errors");
});
