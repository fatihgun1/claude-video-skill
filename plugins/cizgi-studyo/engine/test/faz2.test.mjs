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

const lib = loadLibrary(fileURLToPath(new URL("../../library", import.meta.url)));
const TOOLS = { pythonTts: "py-tts", pythonAlign: "py-align", rhubarb: "rhubarb", ffmpeg: "ffmpeg", configPath: "x" };

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
    characters: [{ id: "pamuk", rig: "pamuk", voice: { exaggeration: 0.6 } }],
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

/** Fake external tools: records calls; CER per line and attempt comes from `cerOf`. */
function fakeRunner(cerOf = () => 0) {
  const calls = [];
  const attempts = {};
  const runFn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    if (cmd === "py-tts") {
      for (const job of JSON.parse(readFileSync(args[1], "utf8"))) writeFileSync(job.out, silentWav(1));
    } else if (cmd === "ffmpeg") {
      copyFileSync(args[args.indexOf("-i") + 1], args.at(-1));
    } else if (cmd === "py-align") {
      const results = JSON.parse(readFileSync(args[1], "utf8")).map((job) => {
        attempts[job.id] = (attempts[job.id] || 0) + 1;
        writeFileSync(job.words_out, JSON.stringify([{ word: job.text, start: 0.1, end: 0.5 }]));
        return { id: job.id, heard: job.text, cer: cerOf(job.id, attempts[job.id]) };
      });
      writeFileSync(args[2], JSON.stringify(results));
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
    }
    return "";
  };
  return { run: runFn, calls };
}

test("profiles load and checkProfile catches bad values", () => {
  assert.ok(lib.profiles.has("genel") && lib.profiles.has("pedagoji-0-3"));
  const errs = checkProfile({ timing: { lead: -1 }, speech: { tempo: 3, max_cer: 2, retries: 9 }, rules: { max_cast: 0, min_hold: "x", allowed_moves: "static" } }, "p").join("\n");
  for (const s of ["timing.lead", "timing.gap", "speech.tempo", "speech.max_cer", "speech.retries", "rules.max_cast", "rules.min_hold", "rules.allowed_moves"]) {
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
  const { ep } = makeEpisode({ narrator_voice: { cfg: 0.6 } });
  const lines = linesOf(ep);
  assert.deepEqual(lines.map((l) => [l.key, l.path]), [["a-0", "ses/a-0.wav"], ["b-0", "ses/b-0.wav"], ["b-1", "ses/b-1.wav"]]);
  assert.deepEqual(lines[1].voice, { cfg: 0.6 });
  assert.deepEqual(lines[2].voice, { exaggeration: 0.6 });
  assert.notEqual(lineFingerprint(lines[0], "tr", 1), lineFingerprint(lines[0], "tr", 0.85));
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

test("runAudio speaks, slows to profile tempo, retries bad takes and is incremental", () => {
  const { path, ep, dir } = makeEpisode();
  approve(path, "senaryo", scriptFingerprint(ep));
  const fake = fakeRunner((id, attempt) => (id === "b-0" && attempt === 1 ? 0.4 : 0.01));
  const logged = [];
  const res = runAudio(path, lib, TOOLS, { ...fake, log: (m) => logged.push(m) });
  assert.deepEqual(res.generated, ["a-0", "b-0", "b-1"]);
  assert.deepEqual(res.failed, []);
  // progress for the panel: each step starts at 0, mouth shapes count line by line
  const progress = logged.filter((m) => m.startsWith("ilerleme ")).map((m) => JSON.parse(m.slice(9)));
  assert.deepEqual(progress[0], { adim: "seslendirme", bitti: 0, toplam: 3 });
  assert.ok(progress.some((p) => p.adim === "kontrol" && p.bitti === 0));
  assert.deepEqual(progress.at(-1), { adim: "agiz", bitti: 3, toplam: 3 });
  // the Python steps write their own progress straight through
  assert.ok(fake.calls.filter((c) => c.cmd === "py-tts" || c.cmd === "py-align").every((c) => c.opts?.liveStderr === true));
  const ffmpeg = fake.calls.filter((c) => c.cmd === "ffmpeg");
  assert.ok(ffmpeg.length >= 3 && ffmpeg[0].args.includes("atempo=0.85"));
  const ttsJobs = JSON.parse(readFileSync(join(dir, ".cizgi", "ses", "tts.json"), "utf8"));
  assert.deepEqual(ttsJobs.map((j) => j.id), ["b-0"], "only the bad take is retried");
  const m = readManifest(path);
  assert.equal(m.lines["b-0"].attempts, 2);
  assert.ok(existsSync(join(dir, "ses", "b-1.rhubarb.json")) && existsSync(join(dir, "ses", "a-0.words.json")));

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

test("runAudio reports lines that stay wrong after all retries; tempo 1 copies", () => {
  const { path, ep } = makeEpisode({ profile: "genel" });
  approve(path, "senaryo", scriptFingerprint(ep));
  const fake = fakeRunner((id) => (id === "a-0" ? 0.5 : 0));
  const res = runAudio(path, lib, TOOLS, fake);
  assert.deepEqual(res.failed.map((f) => f.key), ["a-0"]);
  assert.equal(readManifest(path).lines["a-0"].attempts, 3);
  assert.equal(fake.calls.filter((c) => c.cmd === "ffmpeg").length, 0);
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
  assert.ok(r.calls.every((c) => c.args.includes("looks")));

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
  runAudio(path, lib, TOOLS, fakeRunner((id) => (id === "b-1" ? 0.9 : 0)));
  const s2 = status(path, lib);
  assert.match(s2.next, /cizgi storyboard/);
  assert.deepEqual(s2.audio.failed.map((f) => f.key), ["b-1"]);
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
  assert.throws(() => requireTools(t, ["pythonTts", "pythonAlign"]), /CIZGI_PYTHON_ALIGN/);
  requireTools(t, ["pythonTts"]);
});

test("run returns stdout and reports failures", () => {
  assert.equal(run(process.execPath, ["-e", "process.stdout.write('ok')"]).trim(), "ok");
  assert.throws(() => run(process.execPath, ["-e", "console.error('boom'); process.exit(3)"]), /exited with 3[\s\S]*boom/);
  assert.throws(() => run("cizgi-olmayan-komut-xyz", []), /cizgi-olmayan-komut-xyz/);
});

test("an accepted take leaves the failed list until the line is regenerated", async () => {
  const { acceptLine, failedLines } = await import("../src/ses.mjs");
  const { path, ep } = makeEpisode({ profile: "genel" });
  approve(path, "senaryo", scriptFingerprint(ep));
  runAudio(path, lib, TOOLS, fakeRunner((id) => (id === "a-0" ? 0.5 : 0)));
  assert.deepEqual(failedLines(readManifest(path)).map((f) => f.key), ["a-0"]);
  assert.throws(() => acceptLine(path, "zz-9"), /no generated line/);
  assert.equal(acceptLine(path, "a-0").accepted, true);
  assert.deepEqual(failedLines(readManifest(path)), []);
  assert.deepEqual(status(path, lib).audio.failed, []);
  runAudio(path, lib, TOOLS, { ...fakeRunner((id) => (id === "a-0" ? 0.5 : 0)), force: true });
  assert.deepEqual(failedLines(readManifest(path)).map((f) => f.key), ["a-0"], "a new take needs a new decision");
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
