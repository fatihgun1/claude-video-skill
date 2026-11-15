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
    assert.deepEqual(outputsOf(join(dir, "bolum.json")), { sheets: ["storyboard/16x9/contact-sheet-1.png"], videos: ["cikti/b-16x9-taslak.mp4"] });
    assert.deepEqual(outputsOf(join(dir, "yok", "bolum.json")), { sheets: [], videos: [] });
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
