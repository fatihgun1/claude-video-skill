// The hooks that hand panel requests to the Claude session: Stop (after a turn) and
// UserPromptSubmit (when the person writes). Each waiting request is announced once.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { queueOf, addRequest, readRequests, updateRequest, markPanelOpen, markWatcher } from "../src/istekler.mjs";

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

test("Stop with the panel open and no watcher running asks once for istek-bekle, with the exact command", () => {
  // Hurda Kralı 1 and 2: the turn ended on a chat question; the panel's fixes sat "Sırada"
  markPanelOpen(project, process.pid);
  const r = run("Stop", { stop_hook_active: false });
  assert.equal(r.json?.decision, "block", r.stdout);
  assert.match(r.json.reason, /istek-bekle/);
  assert.match(r.json.reason, /run_in_background/);
  // once: a second Stop in the same chain lets the turn end (no loop if the watcher could not start)
  assert.equal(run("Stop", { stop_hook_active: true }).stdout, "");
  // a watcher running: nothing to say
  markWatcher(project, process.pid);
  assert.equal(run("Stop", { stop_hook_active: false }).stdout, "");
  // the panel closed (or its process gone): nothing to say
  markWatcher(project, null);
  markPanelOpen(project, null);
  assert.equal(run("Stop", { stop_hook_active: false }).stdout, "");
  markPanelOpen(project, 999999); // a process that is not running
  assert.equal(run("Stop", { stop_hook_active: false }).stdout, "");
});

test("Stop asks once to answer a request taken minutes ago and never answered", () => {
  // a request taken in a busy turn and forgotten showed "Claude üzerinde çalışıyor" for an hour
  const a = ask("kapıyı aç");
  updateRequest(queueOf(project), a.id, { durum: "alindi", duyuruldu: true });
  assert.equal(run("Stop", { stop_hook_active: false }).stdout, "", "just taken: it is being worked on");
  const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  appendFileSync(queueOf(project), `${JSON.stringify({ id: a.id, guncel: old, durum: "alindi" })}
`); // taken ten minutes ago
  const r = run("Stop", { stop_hook_active: false });
  assert.equal(r.json?.decision, "block", r.stdout);
  assert.match(r.json.reason, new RegExp(`${a.id}.*panel_yanitla`, "s"));
  assert.equal(run("Stop", { stop_hook_active: true }).stdout, "", "once");
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
