import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createJobs, outputsOf } from "../src/panel-is.mjs";

/** A child process stand-in the test finishes by hand. */
function fakeSpawn(calls) {
  return (cmd, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    calls.push({ cmd, args, opts, child });
    return child;
  };
}

test("a storyboard job runs the CLI in the background and reports its result", () => {
  const calls = [];
  const jobs = createJobs({ cli: "/x/cli.mjs", library: "/x/lib", spawn: fakeSpawn(calls), now: () => 5 });
  const started = jobs.start("/e/bolum.json", "storyboard", "16:9");
  assert.equal(started.status, "running");
  assert.deepEqual(calls[0].args, ["/x/cli.mjs", "storyboard", "/e/bolum.json", "--format", "16:9", "--kutuphane", "/x/lib"]);
  assert.equal(calls[0].cmd, process.execPath);
  assert.throws(() => jobs.start("/e/bolum.json", "taslak", "16:9"), /already running/);
  calls[0].child.stdout.emit("data", '{"formats":{}}');
  calls[0].child.emit("close", 0);
  assert.equal(jobs.get("/e/bolum.json").status, "done");
  assert.deepEqual(jobs.get("/e/bolum.json").result, { formats: {} });
});

test("a draft job asks for a draft render, and a failure says why", () => {
  const calls = [];
  const jobs = createJobs({ cli: "/x/cli.mjs", spawn: fakeSpawn(calls) });
  jobs.start("/e/bolum.json", "taslak", "9:16");
  assert.deepEqual(calls[0].args, ["/x/cli.mjs", "render", "--taslak", "/e/bolum.json", "--format", "9:16"]);
  calls[0].child.stderr.emit("data", "error: gate \"senaryo\" is not approved for the current content\n");
  calls[0].child.emit("close", 1);
  const j = jobs.get("/e/bolum.json");
  assert.equal(j.status, "failed");
  assert.match(j.error, /senaryo/);
  // a finished job does not block the next one
  jobs.start("/e/bolum.json", "storyboard", "16:9");
  assert.equal(calls.length, 2);
});

test("a failed render says the cause under the CLI's error line, not just 'npx exited with 1:'", () => {
  const calls = [];
  const jobs = createJobs({ cli: "/x/cli.mjs", spawn: fakeSpawn(calls) });
  jobs.start("/e/bolum.json", "taslak", "16:9");
  calls[0].child.stderr.emit("data", "Rendering 120/120\nerror: npx exited with 1:\n✗ Failed: EPERM: operation not permitted, rename 'a.mp4' -> 'b.mp4' (ffmpeg error: none)\n  at renameSync\n");
  calls[0].child.emit("close", 1);
  const { error } = jobs.get("/e/bolum.json");
  assert.match(error, /npx exited with 1/);
  assert.match(error, /EPERM/);
  assert.doesNotMatch(error, /Rendering/);
});

test("a scene stills job passes its scene id; a bad or missing id is refused", () => {
  const calls = [];
  const jobs = createJobs({ cli: "/x/cli.mjs", spawn: fakeSpawn(calls) });
  assert.throws(() => jobs.start("/e/bolum.json", "sahne", "16:9"), /scene id/);
  assert.throws(() => jobs.start("/e/bolum.json", "sahne", "16:9", "--hepsi"), /scene id/);
  assert.throws(() => jobs.start("/e/bolum.json", "sahne", "16:9", "../x"), /scene id/);
  const j = jobs.start("/e/bolum.json", "sahne", "16:9", "s1");
  assert.equal(j.scene, "s1");
  assert.deepEqual(calls[0].args, ["/x/cli.mjs", "storyboard", "--sahne", "s1", "/e/bolum.json", "--format", "16:9"]);
});

test("an audio job runs `cizgi ses` (no format) and reports its progress line by line", () => {
  const calls = [];
  const jobs = createJobs({ cli: "/x/cli.mjs", library: "/x/lib", spawn: fakeSpawn(calls) });
  const j = jobs.start("/e/bolum.json", "ses", "16:9");
  assert.equal(j.progress, null);
  assert.deepEqual(calls[0].args, ["/x/cli.mjs", "ses", "/e/bolum.json", "--kutuphane", "/x/lib"]);
  const err = calls[0].child.stderr;
  err.emit("data", 'loading model\nilerleme {"adim":"seslendirme","bitti":1,"top');
  assert.equal(jobs.get("/e/bolum.json").progress, null, "half a line is not read yet");
  err.emit("data", 'lam":3}\n');
  assert.deepEqual(jobs.get("/e/bolum.json").progress, { adim: "seslendirme", bitti: 1, toplam: 3 });
  err.emit("data", 'ilerleme {"adim":"kotu","bitti":1,"toplam":3}\nilerleme {"adim":"agiz","bitti":-1,"toplam":3}\nilerleme nope\n');
  assert.deepEqual(jobs.get("/e/bolum.json").progress, { adim: "seslendirme", bitti: 1, toplam: 3 }, "only well-formed progress counts");
  err.emit("data", 'ilerleme {"adim":"kontrol","bitti":3,"toplam":3}\n');
  assert.equal(jobs.get("/e/bolum.json").progress.adim, "kontrol");
  calls[0].child.stdout.emit("data", '{"generated":["a"],"kept":[],"failed":[]}');
  calls[0].child.emit("close", 0);
  assert.equal(jobs.get("/e/bolum.json").status, "done");
  // lines that failed the listening check still make a finished job (exit 3 with an answer)
  jobs.start("/e/bolum.json", "ses", "16:9");
  calls[1].child.stdout.emit("data", '{"generated":["a"],"kept":[],"failed":[{"key":"a","cer":0.4,"heard":"x"}]}');
  calls[1].child.emit("close", 3);
  assert.equal(jobs.get("/e/bolum.json").status, "done");
  assert.equal(jobs.get("/e/bolum.json").result.failed.length, 1);
});

test("stopping a job ends its whole process tree (the CLI's own children too)", () => {
  const calls = [];
  const killed = [];
  const spawn = (cmd, args, opts) => Object.assign(fakeSpawn(calls)(cmd, args, opts), { pid: 4242, kill: () => killed.push("kill") });
  const jobs = createJobs({ cli: "/x/cli.mjs", spawn, killTree: (pid) => killed.push(pid) });
  jobs.start("/e/bolum.json", "ses", "16:9");
  // a progress line right after a bar redrawn with \r (no newline) still counts
  calls[0].child.stderr.emit("data", 'Sampling: 5%\rilerleme {"adim":"seslendirme","bitti":2,"toplam":3}\r\n');
  assert.equal(jobs.get("/e/bolum.json").progress.bitti, 2);
  assert.equal(jobs.cancel("/e/bolum.json"), true);
  assert.deepEqual(killed, [4242]);
  assert.equal(jobs.get("/e/bolum.json").status, "failed");
});

test("only known jobs and formats start", () => {
  const jobs = createJobs({ cli: "/x/cli.mjs", spawn: fakeSpawn([]) });
  assert.throws(() => jobs.start("/e/bolum.json", "onayla", "16:9"), /unknown job/);
  assert.throws(() => jobs.start("/e/bolum.json", "storyboard", "4:3"), /format/);
  assert.throws(() => jobs.start("/e/bolum.json", "__proto__", "16:9"), /unknown job/);
});

test("the outputs of the production steps are listed relative to the episode", () => {
  const dir = mkdtempSync(join(tmpdir(), "cizgi-cikti-"));
  try {
    mkdirSync(join(dir, "storyboard", "16x9"), { recursive: true });
    mkdirSync(join(dir, "cikti"));
    writeFileSync(join(dir, "storyboard", "16x9", "contact-sheet-1.png"), "x");
    writeFileSync(join(dir, "storyboard", "16x9", "kare-1.png"), "x");
    writeFileSync(join(dir, "cikti", "b-16x9-taslak.mp4"), "x");
    mkdirSync(join(dir, "inceleme", "s1", "16x9"), { recursive: true });
    writeFileSync(join(dir, "inceleme", "s1", "16x9", "contact-sheet-1.jpg"), "x");
    writeFileSync(join(dir, "cikti", "ses-ornegi-genc.wav"), "x");
    // scene review stills are listed apart: they are not the storyboard to approve; voice samples too
    assert.deepEqual(outputsOf(join(dir, "bolum.json")), {
      sheets: ["storyboard/16x9/contact-sheet-1.png"], videos: ["cikti/b-16x9-taslak.mp4"], samples: ["cikti/ses-ornegi-genc.wav"], review: ["inceleme/s1/16x9/contact-sheet-1.jpg"],
    });
    assert.deepEqual(outputsOf(join(dir, "yok", "bolum.json")), { sheets: [], videos: [], samples: [], review: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a job can be stopped, and one that runs too long is stopped for the person", async () => {
  const calls = [];
  const spawn = (cmd, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => { child.killed = true; setImmediate(() => child.emit("close", null)); };
    calls.push(child);
    return child;
  };
  const jobs = createJobs({ cli: "/x/cli.mjs", spawn, timeoutMs: 30 });
  jobs.start("/a/bolum.json", "storyboard", "16:9");
  assert.equal(jobs.cancel("/a/bolum.json"), true);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(calls[0].killed, true);
  assert.equal(jobs.get("/a/bolum.json").status, "failed");
  assert.match(jobs.get("/a/bolum.json").error, /durduruldu/);
  assert.equal(jobs.cancel("/a/bolum.json"), false); // nothing running
  jobs.start("/b/bolum.json", "taslak", "16:9");
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(calls[1].killed, true);
  assert.match(jobs.get("/b/bolum.json").error, /zaman/);
  // output kept bounded
  jobs.start("/c/bolum.json", "storyboard", "16:9");
  calls[2].stdout.emit("data", "x".repeat(3_000_000));
  calls[2].emit("close", 0);
  assert.equal(jobs.get("/c/bolum.json").status, "failed");
  jobs.stopAll();
});

test("a 3D draft job asks the CLI for a 3D draft render", () => {
  const calls = [];
  const jobs = createJobs({ cli: "/x/cli.mjs", spawn: fakeSpawn(calls) });
  jobs.start("/e/bolum.json", "taslak3b", "16:9");
  assert.deepEqual(calls[0].args, ["/x/cli.mjs", "render", "--taslak", "--3b", "/e/bolum.json", "--format", "16:9"]);
});

test("a voice sample job runs cizgi ses-ornek for one character, with no format", () => {
  const calls = [];
  const jobs = createJobs({ cli: "/x/cli.mjs", library: "/x/lib", spawn: fakeSpawn(calls), now: () => 5 });
  jobs.start("/e/bolum.json", "ornek", "16:9", "nazim");
  assert.deepEqual(calls[0].args.slice(0, 4), ["/x/cli.mjs", "ses-ornek", "/e/bolum.json", "nazim"]);
  assert.ok(!calls[0].args.includes("--format"));
  assert.throws(() => jobs.start("/f/bolum.json", "ornek", "16:9", "../x"), /character/);
});
