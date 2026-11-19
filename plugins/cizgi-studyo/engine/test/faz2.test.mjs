import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadLibrary, checkProfile, checkSettings } from "../src/library.mjs";
import { ruleWarnings, validateEpisode } from "../src/validate.mjs";
import { approve, readApprovals, gateStatus, requireGate, scriptFingerprint, storyboardFingerprint, libraryFingerprint } from "../src/onay.mjs";
import { linesOf, lineFingerprint, planAudio, runAudio, readManifest } from "../src/ses.mjs";
import { storyboard, render, stillTimes } from "../src/uretim.mjs";
import { loadTools, requireTools, run } from "../src/tools.mjs";
import { parseArgs, status } from "../src/cli.mjs";
import { approveEpisode } from "../src/onayla.mjs";

const lib = loadLibrary(fileURLToPath(new URL("../../library", import.meta.url)));
const TOOLS = { pythonTts: "py-tts", rhubarb: "rhubarb", ffmpeg: "ffmpeg", configPath: "x" };
const LOCK = join(mkdtempSync(join(tmpdir(), "cizgi-kilit-")), "ses.lock"); // not the real ~/.cizgi-studyo one

function silentWav(seconds = 1) {
  const rate = 8000;
  const data = Math.round(seconds * rate) * 2;
  const buf = Buffer.alloc(44 + data);
  buf.write("RIFF", 0); buf.write("WAVE", 8); buf.write("fmt ", 12); buf.writeUInt32LE(16, 16);
  buf.writeUInt32LE(rate * 2, 28); buf.write("data", 36); buf.writeUInt32LE(data, 40);
  return buf;
}

function makeEpisode(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), "cizgi-f2-"));
  const ep = {
    episode: "deneme",
    language: "tr",
    profile: "pedagoji-0-3",
    characters: [{ id: "pamuk", rig: "pamuk", voice: { hazir: "erkek", perde: -5 } }],
    narrator_voice: { hazir: "kadin" },
    scenes: [
      {
        scene_id: "s1",
        bg: "cayir",
        shots: [
          { shot_id: "a", utterances: [{ speaker: "pamuk", text: "Merhaba!" }], cast: [{ id: "pamuk", action: "selam", mark: "orta" }], camera: { framing: "wide" } },
          { shot_id: "b", utterances: [{ speaker: "anlatici", text: "Alkışla!" }, { speaker: "pamuk", text: "Hop!" }], cast: [{ id: "pamuk", action: "alkis", mark: "orta" }], camera: { framing: "medium" } },
        ],
      },
    ],
    ...overrides,
  };
  const path = join(dir, "bolum.json");
  writeFileSync(path, JSON.stringify(ep, null, 2));
  return { dir, path, ep };
}

const save = (path, ep) => writeFileSync(path, JSON.stringify(ep, null, 2));

/** Fake external tools: records calls; the TTS writes each line's WAV and word timings. */
function fakeRunner() {
  const calls = [];
  const runFn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    if (cmd === "py-tts") {
      for (const job of JSON.parse(readFileSync(args[1], "utf8"))) {
        writeFileSync(job.out, silentWav(1));
        writeFileSync(job.out.replace(/\.wav$/, ".words.json"), JSON.stringify([{ word: job.text, start: 0.1, end: 0.5 }]));
      }
    } else if (cmd === "rhubarb") {
      writeFileSync(args[args.indexOf("-o") + 1], JSON.stringify({ mouthCues: [{ start: 0, end: 0.2, value: "B" }] }));
    } else if (cmd === "npx") {
      const sub = args[2];
      if (sub === "check") return "◇  Check passed";
      if (sub === "snapshot") {
        const out = args[args.indexOf("-o") + 1];
        mkdirSync(out, { recursive: true });
        writeFileSync(join(out, "contact-sheet.jpg"), "jpg");
      }
      if (sub === "render") writeFileSync(args[args.indexOf("-o") + 1], "mp4");
    } else if (cmd === "ffprobe") {
      // a good render: the timeline's length, a picture and a sound
      const duration = JSON.parse(readFileSync(join(opts.cwd, "timing.json"), "utf8")).duration;
      return JSON.stringify({ format: { duration: String(duration) }, streams: [{ codec_type: "video" }, { codec_type: "audio" }] });
    }
    return "";
  };
  return { run: runFn, calls, lockPath: LOCK };
}

test("profiles load and checkProfile catches bad values", () => {
  assert.ok(lib.profiles.has("genel") && lib.profiles.has("pedagoji-0-3"));
  const errs = checkProfile({ timing: { lead: -1 }, speech: { tempo: 3 }, rules: { max_cast: 0, min_hold: "x", allowed_moves: "static" } }, "p").join("\n");
  for (const s of ["timing.lead", "timing.gap", "speech.tempo", "rules.max_cast", "rules.min_hold", "rules.allowed_moves"]) {
    assert.ok(errs.includes(s), s);
  }
});

test("unknown profile is an error; profile rules become warnings", () => {
  const { ep } = makeEpisode({ profile: "yok" });
  assert.ok(validateEpisode(ep, lib).errors.join().includes('profile "yok"'));
  const rules = lib.profiles.get("pedagoji-0-3").rules;
  const { ep: e2 } = makeEpisode();
  const shot = e2.scenes[0].shots[0];
  shot.utterances[0].text = "Bir iki üç dört beş altı yedi sekiz! 5 elma.";
  shot.camera.move = "pan_left";
  shot.hold = 0.2;
  shot.cast = [
    { id: "pamuk", action: "selam", mark: "sol" },
    { id: "b", action: "selam", mark: "orta" },
    { id: "c", action: "selam", mark: "sag" },
  ];
  const w = ruleWarnings(e2, rules).join("\n");
  for (const s of ["3 characters", '"pan_left"', "hold 0.2s", "has 8 words", "counting beyond 3"]) assert.ok(w.includes(s), s);
  assert.deepEqual(ruleWarnings(makeEpisode().ep, rules), []);
});

test("script fingerprint follows the words only; storyboard follows picture and audio", () => {
  const { ep } = makeEpisode();
  const s0 = scriptFingerprint(ep);
  const b0 = storyboardFingerprint(ep, null);
  const camera = structuredClone(ep);
  camera.scenes[0].shots[0].camera.framing = "close";
  assert.equal(scriptFingerprint(camera), s0);
  assert.notEqual(storyboardFingerprint(camera, null), b0);
  const words = structuredClone(ep);
  words.scenes[0].shots[0].utterances[0].text = "Selam!";
  assert.notEqual(scriptFingerprint(words), s0);
  const notes = structuredClone(ep);
  notes.scenes[0].shots[0].notes = "x";
  notes.scenes[0].shots[0].status = "approved";
  notes.revision = 9;
  assert.equal(storyboardFingerprint(notes, null), b0);
  assert.notEqual(storyboardFingerprint(ep, { lines: { "a-0": { fingerprint: "f" } } }), b0);
});

test("approvals are recorded, become stale and are enforced", () => {
  const { path, ep } = makeEpisode();
  assert.deepEqual(readApprovals(path), {});
  assert.throws(() => requireGate({}, "senaryo", "x"), /has not been approved/);
  approve(path, "senaryo", scriptFingerprint(ep), new Date("2026-11-15T00:00:00Z"));
  const a = readApprovals(path);
  assert.equal(a.senaryo.at, "2026-11-15T00:00:00.000Z");
  assert.equal(gateStatus(a, "senaryo", scriptFingerprint(ep)), "onayli");
  assert.equal(gateStatus(a, "senaryo", "other"), "eskimis");
  assert.throws(() => requireGate(a, "senaryo", "other"), /content changed since/);
  assert.throws(() => approve(path, "yayin", "x"), /unknown gate/);
});

test("linesOf assigns default audio paths and voices", () => {
  const { ep } = makeEpisode({ narrator_voice: { hazir: "kadin" } });
  const lines = linesOf(ep);
  assert.deepEqual(lines.map((l) => [l.key, l.path]), [["a-0", "ses/a-0.wav"], ["b-0", "ses/b-0.wav"], ["b-1", "ses/b-1.wav"]]);
  assert.deepEqual(lines[1].voice, { hazir: "kadin" });
  assert.deepEqual(lines[2].voice, { hazir: "erkek", perde: -5 });
  assert.notEqual(lineFingerprint(lines[0], "tr", 1), lineFingerprint(lines[0], "tr", 0.85));
});

test("a line's feeling sets how it is spoken and makes only that line be spoken again", () => {
  const { ep } = makeEpisode();
  const before = linesOf(ep).map((l) => lineFingerprint(l, "tr", 1));
  const u = ep.scenes[0].shots.flatMap((sh) => sh.utterances || [])[2];
  u.duygu = "heyecanli";
  const lines = linesOf(ep);
  assert.equal(lines[2].duygu, "heyecanli");
  assert.deepEqual(lines[2].voice, { hazir: "erkek", perde: -5 }, "the feeling is kept apart from the voice");
  const after = lines.map((l) => lineFingerprint(l, "tr", 1));
  assert.deepEqual(after.map((x, i) => x === before[i]), [true, true, false]);
});

test("planAudio redoes changed, missing or forced lines only", () => {
  const { ep } = makeEpisode();
  const lines = linesOf(ep);
  const fp = (l) => lineFingerprint(l, "tr", 1);
  const manifest = { lines: { "a-0": { fingerprint: fp(lines[0]) }, "b-0": { fingerprint: "old" }, "b-1": { fingerprint: fp(lines[2]) } } };
  const plan = planAudio(lines, manifest, fp, (p) => p !== "ses/b-1.wav");
  assert.deepEqual(plan.todo.map((l) => l.key), ["b-0", "b-1"]);
  assert.deepEqual(plan.keep.map((l) => l.key), ["a-0"]);
  assert.equal(planAudio(lines, manifest, fp, () => true, { force: true }).todo.length, 3);
  assert.equal(planAudio(lines, null, fp, () => true).todo.length, 3);
});

test("runAudio refuses before the script is approved and without tools", () => {
  const { path, ep } = makeEpisode();
  const fake = fakeRunner();
  assert.throws(() => runAudio(path, lib, TOOLS, fake), /gate "senaryo"/);
  approve(path, "senaryo", scriptFingerprint(ep));
  assert.throws(() => runAudio(path, lib, { ffmpeg: "ffmpeg", configPath: "c" }, fake), /CIZGI_PYTHON_TTS[\s\S]*CIZGI_RHUBARB/);
  const bad = structuredClone(ep);
  bad.scenes[0].bg = "uzay";
  save(path, bad);
  assert.throws(() => runAudio(path, lib, TOOLS, fake), /episode is invalid/);
});

test("runAudio speaks every line in one Edge call, tempo as rate, mouth shapes per line, and is incremental", () => {
  const { path, ep, dir } = makeEpisode();
  approve(path, "senaryo", scriptFingerprint(ep));
  const fake = fakeRunner();
  const logged = [];
  const res = runAudio(path, lib, TOOLS, { ...fake, log: (m) => logged.push(m) });
  assert.deepEqual(res.generated, ["a-0", "b-0", "b-1"]);
  assert.deepEqual(res.failed, []);
  // progress for the panel: the mouth shapes count line by line (the TTS writes its own progress)
  const progress = logged.filter((m) => m.startsWith("ilerleme ")).map((m) => JSON.parse(m.slice(9)));
  assert.deepEqual(progress.at(-1), { adim: "agiz", bitti: 3, toplam: 3 });
  const tts = fake.calls.filter((c) => c.cmd === "py-tts");
  assert.equal(tts.length, 1, "one call speaks every line");
  assert.ok(tts[0].args[0].endsWith("tts_edge.py") && tts[0].opts?.liveStderr === true);
  assert.deepEqual(tts[0].args.slice(-2), ["--ffmpeg", "ffmpeg"]);
  assert.equal(fake.calls.filter((c) => c.cmd === "ffmpeg").length, 0, "the tempo is Edge's rate, not atempo");
  assert.equal(fake.calls.filter((c) => c.cmd === "rhubarb").length, 3);
  const ttsJobs = JSON.parse(readFileSync(join(dir, ".cizgi", "ses", "tts.json"), "utf8"));
  // pedagoji-0-3 speaks at tempo 0.85: -15%; pamuk is "erkek" (Ahmet) with perde -5
  assert.deepEqual(ttsJobs.find((j) => j.id === "a-0"), {
    id: "a-0", text: "Merhaba!", voice: "tr-TR-AhmetNeural", rate: "-15%", pitch: "-5Hz", volume: "+0%", out: join(dir, "ses", "a-0.wav"),
  });
  const m = readManifest(path);
  assert.deepEqual(m.lines["b-0"], { fingerprint: m.lines["b-0"].fingerprint, ayar: true, text: "Alkışla!", ok: true, attempts: 1 }); // ayar: the fingerprint counts the voice preset
  assert.ok(existsSync(join(dir, "ses", "b-1.rhubarb.json")) && existsSync(join(dir, "ses", "a-0.words.json")));
  assert.ok(!existsSync(LOCK), "the lock is let go");

  const again = fakeRunner();
  assert.deepEqual(runAudio(path, lib, TOOLS, again).generated, []);
  assert.equal(again.calls.length, 0);

  const changed = structuredClone(ep);
  changed.scenes[0].shots[1].utterances.pop();
  changed.scenes[0].shots[0].utterances[0].text = "Selam!";
  save(path, changed);
  approve(path, "senaryo", scriptFingerprint(changed));
  const third = fakeRunner();
  assert.deepEqual(runAudio(path, lib, TOOLS, third).generated, ["a-0"]);
  assert.deepEqual(Object.keys(readManifest(path).lines).sort(), ["a-0", "b-0"], "removed lines leave the manifest");
});

test("lines of the old engine count as changed and are spoken again", () => {
  const { path, ep, dir } = makeEpisode({ profile: "genel" });
  approve(path, "senaryo", scriptFingerprint(ep));
  mkdirSync(join(dir, "ses"));
  const old = { lines: {} };
  for (const k of ["a-0", "b-0", "b-1"]) {
    writeFileSync(join(dir, "ses", `${k}.wav`), silentWav(1));
    old.lines[k] = { fingerprint: "chatterbox", text: "x", heard: "y", cer: 0.5, ok: false, attempts: 3 };
  }
  writeFileSync(join(dir, "ses", "manifest.json"), JSON.stringify(old));
  assert.equal(runAudio(path, lib, TOOLS, fakeRunner()).generated.length, 3);
  assert.ok(Object.values(readManifest(path).lines).every((l) => l.ok && l.attempts === 1 && !("cer" in l)));
});

test("a draft render is a preview: no script approval and no recorded lines needed; the final one still is gated", () => {
  const { path } = makeEpisode(); // nothing approved, nothing spoken
  const r = fakeRunner();
  const draft = render(path, lib, { ...r, draft: true, formats: ["16:9"] });
  assert.ok(draft[0].endsWith(join("cikti", "deneme-16x9-taslak.mp4")));
  assert.ok(r.calls.some((c) => c.args.includes("draft")));
  assert.throws(() => render(path, lib, fakeRunner()), /gate "senaryo"/);
});

test("a 3D render: the same episode drawn in 3D, its own file name, the same gates", () => {
  const { path, ep } = makeEpisode();
  const r = fakeRunner();
  const draft = render(path, lib, { ...r, draft: true, d3: true, formats: ["16:9"] });
  assert.ok(draft[0].endsWith(join("cikti", "deneme-16x9-3b-taslak.mp4")));
  const project = r.calls.find((c) => c.args.includes("render")).opts.cwd;
  assert.ok(project.endsWith("proje-16x9-3b"));
  assert.ok(existsSync(join(project, "runtime", "player3d.js")));
  // the final one is gated like the 2D one (script, then storyboard)
  assert.throws(() => render(path, lib, { ...fakeRunner(), d3: true }), /gate "senaryo"/);
  approve(path, "senaryo", scriptFingerprint(ep));
  runAudio(path, lib, TOOLS, fakeRunner());
  assert.throws(() => render(path, lib, { ...fakeRunner(), d3: true }), /gate "storyboard"/);
});

test("storyboard, its approval and the final render refuse lines not spoken for the current text", () => {
  // kpss-ajani: script approved, 19 lines still from the old engine; storyboard + render would ship them
  const { path, ep } = makeEpisode();
  approve(path, "senaryo", scriptFingerprint(ep));
  assert.throws(() => storyboard(path, lib, fakeRunner()), /seslendirilmemiş.*a-0/s);
  assert.throws(() => approveEpisode(path, "storyboard", lib), /seslendirilmemiş/);
  runAudio(path, lib, TOOLS, fakeRunner());
  const sb = storyboard(path, lib, fakeRunner());
  approve(path, "storyboard", sb.fingerprint);
  // a feeling changed after the stills: the words (and the script approval) stay, the take is stale
  const moody = JSON.parse(readFileSync(path, "utf8"));
  moody.scenes[0].shots[0].utterances[0].duygu = "kizgin";
  save(path, moody);
  assert.throws(() => render(path, lib, fakeRunner()), /seslendirilmemiş|content changed/);
});

test("a final render is checked: a new file, the timeline length, a sound track", () => {
  // Hurda Kralı 1: the panel showed a 16:9 video for a 9:16 episode, 107 s against a 109 s timeline
  const { path, ep } = makeEpisode();
  approve(path, "senaryo", scriptFingerprint(ep));
  runAudio(path, lib, TOOLS, fakeRunner());
  approve(path, "storyboard", storyboard(path, lib, fakeRunner()).fingerprint);
  const broken = (patch) => {
    const r = fakeRunner();
    return { ...r, run: (cmd, args, opts) => patch(cmd, args, opts) ?? r.run(cmd, args, opts), formats: ["9:16"] };
  };
  const probe = (duration, streams) => JSON.stringify({ format: { duration: String(duration) }, streams: streams.map((codec_type) => ({ codec_type })) });
  const timelineOf = (opts) => JSON.parse(readFileSync(join(opts.cwd, "timing.json"), "utf8")).duration;
  assert.throws(() => render(path, lib, broken((cmd, args) => (cmd === "npx" && args[2] === "render" ? "" : undefined))), /yazılmadı|eski/);
  assert.throws(() => render(path, lib, broken((cmd) => (cmd === "ffprobe" ? probe(3, ["video", "audio"]) : undefined))), /süre/);
  assert.throws(() => render(path, lib, broken((cmd, args, opts) => (cmd === "ffprobe" ? probe(timelineOf(opts), ["video"]) : undefined))), /ses/);
  assert.equal(render(path, lib, { ...fakeRunner(), formats: ["9:16"] }).length, 1);
});

test("stillTimes takes two stills per shot", () => {
  assert.deepEqual(stillTimes([{ start: 0, end: 10 }, { start: 10, end: 15 }]), [4, 8, 12, 14]);
});

test("storyboard compiles, checks and photographs both formats; render is gated", () => {
  const { path, ep, dir } = makeEpisode();
  approve(path, "senaryo", scriptFingerprint(ep));
  runAudio(path, lib, TOOLS, fakeRunner());
  const fake = fakeRunner();
  const sb = storyboard(path, lib, fake);
  assert.deepEqual(Object.keys(sb.formats), ["16:9", "9:16"]);
  assert.equal(sb.formats["9:16"].check, "passed");
  assert.ok(sb.formats["16:9"].sheets[0].endsWith("contact-sheet.jpg"));
  const snap = fake.calls.find((c) => c.args.includes("snapshot"));
  assert.ok(snap.args.includes("hyperframes@0.8.229") && snap.opts.cwd.includes("proje-16x9"));

  assert.throws(() => render(path, lib, fakeRunner()), /gate "storyboard"/);
  const draft = render(path, lib, { ...fakeRunner(), draft: true, formats: ["9:16"] });
  assert.ok(draft[0].endsWith(join("cikti", "deneme-9x16-taslak.mp4")));

  approve(path, "storyboard", sb.fingerprint);
  const r = fakeRunner();
  const videos = render(path, lib, r);
  assert.equal(videos.length, 2);
  assert.ok(r.calls.filter((c) => c.cmd === "npx").every((c) => c.args.includes("looks")));

  const moved = JSON.parse(readFileSync(path, "utf8"));
  moved.scenes[0].shots[0].camera.move = "push_in";
  save(path, moved);
  assert.throws(() => render(path, lib, fakeRunner()), /content changed since/);
  assert.throws(() => storyboard(path, lib, { ...fakeRunner(), formats: ["4:3"] }), /unknown format/);
  assert.throws(() => render(path, lib, { ...fakeRunner(), draft: true, formats: ["4:3"] }), /unknown format/);
  assert.ok(existsSync(join(dir, "storyboard", "9x16", "contact-sheet.jpg")));
});

test("storyboard surfaces a failing hyperframes check", () => {
  const { path, ep } = makeEpisode();
  approve(path, "senaryo", scriptFingerprint(ep));
  runAudio(path, lib, TOOLS, fakeRunner());
  const failing = { run: (cmd, args) => { if (args.includes("check")) throw new Error("lint error"); return ""; } };
  assert.throws(() => storyboard(path, lib, failing), /hyperframes check failed for 16:9/);
});

test("status walks the gates in order", () => {
  const { path, ep } = makeEpisode();
  assert.match(status(path, lib).next, /onayla senaryo/);
  approve(path, "senaryo", scriptFingerprint(ep));
  const s1 = status(path, lib);
  assert.match(s1.next, /cizgi ses \(3 line/);
  runAudio(path, lib, TOOLS, fakeRunner());
  const s2 = status(path, lib);
  assert.match(s2.next, /cizgi storyboard/);
  assert.deepEqual(s2.audio.failed, []);
  approve(path, "storyboard", storyboardFingerprint(ep, readManifest(path), libraryFingerprint(ep, lib)));
  assert.equal(status(path, lib).next, "cizgi render");
  const bad = { ...ep, scenes: [{ ...ep.scenes[0], bg: "uzay" }] };
  save(path, bad);
  assert.equal(status(path, lib).valid, false);
});

test("parseArgs reads flags, formats and library", () => {
  const p = parseArgs(["render", "b.json", "--taslak", "--format", "9:16", "--kutuphane", "lib"]);
  assert.deepEqual(p.args, ["render", "b.json"]);
  assert.ok(p.flags.has("--taslak"));
  assert.deepEqual(p.formats, ["9:16"]);
  assert.equal(p.library, "lib");
  assert.equal(parseArgs(["x"]).formats, undefined);
  assert.throws(() => parseArgs(["--format"]), /needs a value/);
  assert.throws(() => parseArgs(["--hizli"]), /unknown option/);
});

test("loadTools: env wins over config file; requireTools names what is missing", () => {
  const home = mkdtempSync(join(tmpdir(), "cizgi-home-"));
  assert.equal(loadTools({}, home).ffmpeg, "ffmpeg");
  mkdirSync(join(home, ".cizgi-studyo"));
  writeFileSync(join(home, ".cizgi-studyo", "config.json"), JSON.stringify({ python_tts: "a", rhubarb: "r" }));
  const t = loadTools({ CIZGI_PYTHON_TTS: "env" }, home);
  assert.equal(t.pythonTts, "env");
  assert.equal(t.rhubarb, "r");
  assert.throws(() => requireTools({ configPath: "c" }, ["pythonTts", "rhubarb"]), /CIZGI_PYTHON_TTS[\s\S]*CIZGI_RHUBARB/);
  requireTools(t, ["pythonTts"]);
});

test("run returns stdout and reports failures", () => {
  assert.equal(run(process.execPath, ["-e", "process.stdout.write('ok')"]).trim(), "ok");
  assert.throws(() => run(process.execPath, ["-e", "console.error('boom'); process.exit(3)"]), /exited with 3[\s\S]*boom/);
  assert.throws(() => run("cizgi-olmayan-komut-xyz", []), /cizgi-olmayan-komut-xyz/);
});

test("an accepted take of the old engine leaves the failed list until the line is regenerated", async () => {
  const { acceptLine, failedLines } = await import("../src/ses.mjs");
  const { path, ep, dir } = makeEpisode({ profile: "genel" });
  approve(path, "senaryo", scriptFingerprint(ep));
  runAudio(path, lib, TOOLS, fakeRunner());
  // a manifest the old engine left: one take failed its listening check
  const m = readManifest(path);
  m.lines["a-0"] = { ...m.lines["a-0"], ok: false, cer: 0.5, heard: "x" };
  writeFileSync(join(dir, "ses", "manifest.json"), JSON.stringify(m));
  assert.deepEqual(failedLines(readManifest(path)).map((f) => f.key), ["a-0"]);
  assert.throws(() => acceptLine(path, "zz-9"), /no generated line/);
  assert.equal(acceptLine(path, "a-0").accepted, true);
  assert.deepEqual(failedLines(readManifest(path)), []);
  assert.deepEqual(status(path, lib).audio.failed, []);
  runAudio(path, lib, TOOLS, { ...fakeRunner(), force: true });
  assert.deepEqual(failedLines(readManifest(path)), [], "Edge takes always pass");
});

test("framing check catches two characters outside a portrait frame (the Faz 2 storyboard bug)", async () => {
  const { framingWarnings } = await import("../src/uretim.mjs");
  const shot = {
    shot_id: "x",
    cast: [{ id: "pamuk", mark: "sol" }, { id: "pitir", mark: "sag" }],
    camera: { framing: "wide", move: "static" },
  };
  const oldWorld = { ...lib, world: { ...lib.world, portrait: undefined } };
  assert.deepEqual(framingWarnings([shot], oldWorld, "9:16"), [
    'shot x (9:16): "pamuk" is not fully in frame',
    'shot x (9:16): "pitir" is not fully in frame',
  ]);
  assert.deepEqual(framingWarnings([shot], lib, "9:16"), []);
  assert.deepEqual(framingWarnings([shot], lib, "16:9"), []);
  const close = { ...shot, camera: { framing: "close", target: "pamuk" } };
  assert.deepEqual(framingWarnings([close], lib, "16:9"), ['shot x (16:9): "pitir" is not fully in frame']);
});

test("layout and focus: portrait marks, scale and cast-centred camera", () => {
  const C = globalThis.CizgiCore;
  const land = C.layoutFor(lib.world, { width: 1920, height: 1080 });
  const port = C.layoutFor(lib.world, { width: 1080, height: 1920 });
  assert.equal(land.marks.sol, 560);
  assert.equal(port.marks.sol, 820);
  assert.ok(Math.abs(port.scale - land.scale * 0.75) < 1e-9);
  const shot = { cast: [{ id: "a", mark: "sol" }, { id: "b", mark: "sag" }], camera: {} };
  assert.equal(C.focusX(shot, land), 960);
  assert.equal(C.focusX({ ...shot, camera: { target: "b" } }, land), 1360);
  assert.equal(C.focusX({ cast: [], camera: {} }, land), null);
  assert.deepEqual(C.layoutFor({ ...lib.world, portrait: undefined }, { width: 1080, height: 1920 }).marks, lib.world.marks);
});

test("world.portrait is validated", () => {
  const errs = checkSettings({ ...lib.world, portrait: { marks: { sol: 1 }, character_scale: 9 } }, lib.cameras).join("\n");
  assert.ok(errs.includes("portrait.marks.orta"));
  assert.ok(errs.includes("character_scale"));
});

test("without a target the camera zooms out to keep the whole cast in frame", async () => {
  const { framingWarnings } = await import("../src/uretim.mjs");
  const C = globalThis.CizgiCore;
  const cast = [{ id: "pamuk", mark: "sol" }, { id: "pitir", mark: "sag" }];
  for (const camera of [{ framing: "medium" }, { framing: "wide", move: "push_in" }, { framing: "close" }]) {
    assert.deepEqual(framingWarnings([{ shot_id: "m", cast, camera }], lib, "9:16"), [], JSON.stringify(camera));
  }
  const vp = { width: 1920, height: 1080 };
  const solo = { cast: [{ id: "pamuk", mark: "orta" }], camera: { framing: "close" } };
  assert.ok(C.shotCamera(solo, 0, lib.world, lib.cameras, vp).zoom > 1.5, "a single character can still get a close-up");
  assert.equal(C.keepWidthFor({ cast: [], camera: {} }, C.layoutFor(lib.world, vp)), null);
});

test("a library change after approval makes the storyboard approval stale", () => {
  const { ep } = makeEpisode();
  const base = libraryFingerprint(ep, lib);
  const moved = { ...lib, world: { ...lib.world, ground_y: 800 } };
  assert.notEqual(libraryFingerprint(ep, moved), base);
  const actions = new Map(lib.actions);
  actions.set("zipla", { ...actions.get("zipla"), duration: 2 });
  assert.equal(libraryFingerprint(ep, { ...lib, actions }), base, "an action the episode does not use does not matter");
  actions.set("selam", { ...actions.get("selam"), duration: 2 });
  assert.notEqual(libraryFingerprint(ep, { ...lib, actions }), base);
  assert.notEqual(storyboardFingerprint(ep, null, base), storyboardFingerprint(ep, null, "other"));
});

test("run puts flagged error lines before the tail", () => {
  const script = "for (let i = 0; i < 40; i++) console.log('line ' + i); console.log('  ✗ page_error: boom'); for (let i = 0; i < 20; i++) console.log('x' + i); process.exit(1)";
  const err = (() => { try { run(process.execPath, ["-e", script]); } catch (e) { return e.message; } })();
  assert.match(err, /exited with 1:\n {2}✗ page_error: boom/);
});

test("the 3D look is not part of the 2D storyboard approval", () => {
  const { ep } = makeEpisode();
  const before = storyboardFingerprint(ep, null, "lib");
  assert.equal(storyboardFingerprint({ ...ep, stil3d: "pastel" }, null, "lib"), before);
});

test("a retuned voice preset speaks its lines again; older manifests stay fresh until then (Faz 5.3)", async () => {
  const { fingerprintsOf } = await import("../src/ses.mjs");
  const { ep } = makeEpisode();
  const lines = linesOf(ep);
  const fps = fingerprintsOf(ep, lib);
  const [now, older] = fps(lines[0]);
  const exists = () => true;
  // written before presets counted: accepted by the older fingerprint
  assert.equal(planAudio(lines.slice(0, 1), { lines: { [lines[0].key]: { fingerprint: older } } }, fps, exists).todo.length, 0);
  // written now (ayar): only the current one counts
  assert.equal(planAudio(lines.slice(0, 1), { lines: { [lines[0].key]: { fingerprint: older, ayar: true } } }, fps, exists).todo.length, 1);
  assert.equal(planAudio(lines.slice(0, 1), { lines: { [lines[0].key]: { fingerprint: now, ayar: true } } }, fps, exists).todo.length, 0);
  // the library's preset for this voice changes: a new fingerprint
  const first = [...lib.voices.keys()][0];
  const retuned = { ...lib, voices: new Map([...lib.voices].map(([k, v]) => [k, k === first ? { ...v, hiz: (v.hiz || 0) + 10 } : v])) };
  const line = { ...lines[0], voice: { hazir: first } };
  assert.notEqual(fingerprintsOf(ep, retuned)(line)[0], fingerprintsOf(ep, lib)(line)[0]);
});

test("the person's own recording (utterance.audio) is never spoken over; a missing one is stale (Faz 5.4)", () => {
  const { ep } = makeEpisode();
  ep.scenes[0].shots[0].utterances[0].audio = "kayit/benim.wav";
  const lines = linesOf(ep);
  const own = lines.find((l) => l.own);
  assert.ok(own && own.path === "kayit/benim.wav");
  const fp = (l) => lineFingerprint(l, "tr", 1);
  const plan = planAudio(lines, null, fp, () => true, { force: true });
  assert.ok(!plan.todo.includes(own) && plan.keep.includes(own));
  assert.deepEqual(planAudio(lines, null, fp, (p) => p !== own.path).ownMissing, [own]);
  assert.throws(() => planAudio(lines, null, fp, () => true, { only: own.key }), /own recording/);
});

test("a preview plays a take made for other words silent, not on the wrong line (Faz 5.5)", async () => {
  const { compileEpisode } = await import("../src/compile.mjs");
  const { path, ep } = makeEpisode();
  const dir = dirname(path);
  mkdirSync(join(dir, "ses"), { recursive: true });
  for (const l of linesOf(ep)) writeFileSync(join(dir, l.path), silentWav(2));
  const out = join(dir, "onizleme");
  const res = compileEpisode(path, lib, out, { missingAudio: "estimate", stale: ["a-0"] });
  assert.deepEqual(res.estimated, ["a-0"]);
  assert.ok(!readFileSync(join(out, "index.html"), "utf8").includes('id="ses-a-0"'), "the stale take is not played");
});

test("the storyboard gate approves only the episode its stills show (Faz 0.5)", async () => {
  const { acceptWarnings } = await import("../src/uyari-kabul.mjs");
  const { path, ep } = makeEpisode();
  approve(path, "senaryo", scriptFingerprint(ep));
  runAudio(path, lib, TOOLS, fakeRunner());
  // the fixture's own open warnings, kept by the person: the gate then looks at the stills
  const keep = () => {
    try {
      approveEpisode(path, "storyboard", lib);
    } catch (err) {
      const codes = [...err.message.matchAll(/^- (\S+:\S+:[0-9a-f]{6})/gm)].map((m) => m[1]);
      if (codes.length) acceptWarnings(path, codes, "test: fixture");
    }
  };
  keep();
  assert.throws(() => approveEpisode(path, "storyboard", lib), /storyboard kareleri yok/);
  storyboard(path, lib, fakeRunner());
  const shown = JSON.parse(readFileSync(join(dirname(path), "storyboard", "parmak-izi.json"), "utf8"));
  assert.ok(shown.fingerprint);
  // changed after the stills: the person did not see this
  const moved = JSON.parse(readFileSync(path, "utf8"));
  moved.scenes[0].shots[0].camera = { ...moved.scenes[0].shots[0].camera, framing: "medium" };
  save(path, moved);
  keep();
  assert.throws(() => approveEpisode(path, "storyboard", lib), /karelerinden sonra değişti/);
  // a check that does not pass gives no stills to approve
  const failing = fakeRunner();
  const run = failing.run;
  assert.throws(() => storyboard(path, lib, { ...failing, run: (c, a, o) => (a?.[2] === "check" ? "✗ 2 errors" : run(c, a, o)) }), /did not pass/);
});
