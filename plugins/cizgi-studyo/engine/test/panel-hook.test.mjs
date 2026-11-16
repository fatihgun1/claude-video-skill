// The hooks that hand panel requests to the Claude session: Stop (after a turn) and
// UserPromptSubmit (when the person writes). Each waiting request is announced once.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { queueOf, addRequest, readRequests } from "../src/istekler.mjs";

const HOOK = fileURLToPath(new URL("../src/panel-hook.mjs", import.meta.url));
let project;

function run(event, extra = {}, env = { CLAUDE_PROJECT_DIR: project }) {
  const input = JSON.stringify({ session_id: "s", transcript_path: "t", cwd: project, hook_event_name: event, ...extra });
  const out = spawnSync(process.execPath, [HOOK], { input, encoding: "utf8", env: { ...process.env, ...env } });
  return { code: out.status, stdout: out.stdout, stderr: out.stderr, json: out.stdout.trim() ? JSON.parse(out.stdout) : null };
}

const ask = (metin) => addRequest(queueOf(project), { root: "C:/p", b: "bolum.json", hedef: { tur: "karakter", id: "ela", etiket: "Ela" }, metin });

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "cizgi-hook-"));
  process.env.CIZGI_ISTEK_KOK = mkdtempSync(join(tmpdir(), "cizgi-hook-kuyruk-")); // children inherit it
});

test("with no queue or nothing waiting, the hooks say nothing and let things go on", () => {
  for (const ev of ["Stop", "UserPromptSubmit"]) {
    const r = run(ev);
    assert.equal(r.code, 0);
    assert.equal(r.stdout, "");
  }
});

test("Stop keeps Claude going with the waiting requests, once", () => {
  const a = ask("el sallasın");
  const r = run("Stop", { stop_hook_active: false });
  assert.equal(r.code, 0);
  assert.equal(r.json.decision, "block");
  assert.match(r.json.reason, /panel_istekleri/);
  assert.match(r.json.reason, new RegExp(a.id));
  assert.match(r.json.reason, /"el sallasın"/);
  assert.equal(readRequests(queueOf(project))[0].duyuruldu, true);
  // the next stop (even while continuing because of this hook) has nothing new
  assert.equal(run("Stop", { stop_hook_active: true }).stdout, "");
});

test("a new request after the first is announced on the next stop", () => {
  ask("bir");
  run("Stop");
  const b = ask("iki");
  const r = run("Stop", { stop_hook_active: true });
  assert.equal(r.json.decision, "block");
  assert.match(r.json.reason, new RegExp(b.id));
  assert.doesNotMatch(r.json.reason, /"bir"/);
});

test("UserPromptSubmit adds the waiting requests as context", () => {
  ask("zıplasın");
  const r = run("UserPromptSubmit", { prompt: "panel" });
  assert.equal(r.json.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.match(r.json.hookSpecificOutput.additionalContext, /"zıplasın"/);
  assert.equal(run("UserPromptSubmit", { prompt: "panel" }).stdout, "");
});

test("the project folder comes from the input when the environment lacks it", () => {
  ask("dönsün");
  const r = run("Stop", {}, { CLAUDE_PROJECT_DIR: "" });
  assert.equal(r.json.decision, "block");
});

test("a broken input or another event never blocks", () => {
  ask("x");
  const bad = spawnSync(process.execPath, [HOOK], { input: "{yarım", encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: project } });
  assert.equal(bad.status, 0);
  assert.equal(bad.stdout, "");
  assert.equal(run("PreToolUse").stdout, "");
});

test("a request written in another session's panel (same folder) is left for that session", async () => {
  const { claimQueue } = await import("../src/istekler.mjs");
  claimQueue(queueOf(project), "oturum-test-7-aaaa");
  const theirs = ask("bölümü oluştur");
  claimQueue(queueOf(project), null);
  assert.equal(theirs.oturum, "oturum-test-7-aaaa");
  const other = run("Stop", { session_id: "gelistirme-oturumu-bbbb" });
  assert.equal(other.stdout, "", "another session's hook stays silent");
  assert.notEqual(readRequests(queueOf(project))[0].duyuruldu, true, "and does not mark it announced");
  const own = run("Stop", { session_id: "oturum-test-7-aaaa" });
  assert.match(own.json.reason, new RegExp(theirs.id), "the panel's own session gets it");
});
