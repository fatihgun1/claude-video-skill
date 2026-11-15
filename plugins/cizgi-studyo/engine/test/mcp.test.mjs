// The plugin's MCP server (stdio, JSON-RPC): it opens the editor panel for a folder and lists its episodes.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../src/mcp.mjs", import.meta.url));
const SOKAK = fileURLToPath(new URL("../../../../ornekler/sokak/bolum.json", import.meta.url));

let root, other, child, lines, nextId = 1;
const waiting = new Map();

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function rpc(method, params) {
  const id = nextId++;
  send({ jsonrpc: "2.0", id, method, params });
  return new Promise((ok) => waiting.set(id, ok));
}

const callTool = (name, args = {}) => rpc("tools/call", { name, arguments: args });
const textOf = (res) => JSON.parse(res.result.content[0].text);

function put(dir, rel) {
  const file = join(dir, ...rel.split("/"));
  mkdirSync(join(file, ".."), { recursive: true });
  copyFileSync(SOKAK, file);
}

before(() => {
  root = mkdtempSync(join(tmpdir(), "cizgi-mcp-"));
  other = mkdtempSync(join(tmpdir(), "cizgi-mcp-b-"));
  put(root, "bolumler/bir/bolum.json");
  put(root, "bolumler/iki/bolum.json");
  put(other, "tek/bolum.json");
  writeFileSync(join(root, "notlar.txt"), "not an episode");
  child = spawn(process.execPath, [SERVER], { cwd: root, env: { ...process.env, CIZGI_PANEL_PORT: "0" }, stdio: ["pipe", "pipe", "pipe"] });
  lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const msg = JSON.parse(line); // anything on stdout that is not JSON-RPC breaks the client
    waiting.get(msg.id)?.(msg);
    waiting.delete(msg.id);
  });
});

after(async () => {
  const exited = new Promise((ok) => child.once("exit", ok));
  child.stdin.end(); // the session closing: the server stops its panel and exits
  await exited; // Windows keeps a folder locked while a process has it as its working folder
  rmSync(root, { recursive: true, force: true });
  rmSync(other, { recursive: true, force: true });
});

test("initialize answers with tools capability and the asked protocol version", async () => {
  const res = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
  assert.equal(res.result.protocolVersion, "2025-06-18");
  assert.ok(res.result.capabilities.tools);
  assert.equal(res.result.serverInfo.name, "cizgi-studyo");
  send({ jsonrpc: "2.0", method: "notifications/initialized" }); // a notification gets no answer
});

test("tools/list names panel_ac and panel_kapat with input schemas", async () => {
  const res = await rpc("tools/list", {});
  const names = res.result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["panel_ac", "panel_kapat"]);
  for (const t of res.result.tools) assert.equal(t.inputSchema.type, "object");
});

test("panel_ac with no folder opens the working folder and lists its episodes", async () => {
  const out = textOf(await callTool("panel_ac"));
  assert.match(out.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.deepEqual(out.bolumler.map((b) => b.path).sort(), ["bolumler/bir/bolum.json", "bolumler/iki/bolum.json"]);
  assert.ok(out.bolumler.every((b) => b.valid && b.shots > 0));
  const page = await fetch(out.url);
  assert.equal(page.status, 200);
});

test("panel_ac again on the same folder keeps the same panel", async () => {
  const a = textOf(await callTool("panel_ac"));
  const b = textOf(await callTool("panel_ac", { klasor: root }));
  assert.equal(a.url, b.url);
});

test("panel_ac with an episode opens it in the address", async () => {
  const out = textOf(await callTool("panel_ac", { bolum: "bolumler/iki/bolum.json" }));
  assert.ok(out.url.endsWith(`#b=${encodeURIComponent("bolumler/iki/bolum.json")}`));
});

test("panel_ac on another folder moves the panel there", async () => {
  const before_ = textOf(await callTool("panel_ac"));
  const out = textOf(await callTool("panel_ac", { klasor: other }));
  assert.deepEqual(out.bolumler.map((b) => b.path), ["tek/bolum.json"]);
  await assert.rejects(fetch(before_.url)); // the old panel is closed
});

test("a missing folder or an unknown episode is a tool error, not a crash", async () => {
  const open = textOf(await callTool("panel_ac", { klasor: root }));
  const res = await callTool("panel_ac", { klasor: join(root, "yok") });
  assert.equal(res.result.isError, true);
  assert.equal((await fetch(open.url)).status, 200); // a wrong folder leaves the open panel alone
  const res2 = await callTool("panel_ac", { klasor: root, bolum: "bolumler/uc/bolum.json" });
  assert.equal(res2.result.isError, true);
  const ok = await rpc("ping", {});
  assert.deepEqual(ok.result, {});
});

test("a stray file or a wrong episode on another folder leaves the open panel where it was", async () => {
  const open = textOf(await callTool("panel_ac", { klasor: root }));
  const file = await callTool("panel_ac", { klasor: join(root, "notlar.txt") }); // exists, but is not a folder or a bolum.json
  assert.equal(file.result.isError, true);
  const typo = await callTool("panel_ac", { klasor: other, bolum: "yanlis/bolum.json" });
  assert.equal(typo.result.isError, true);
  const again = textOf(await callTool("panel_ac"));
  assert.equal(again.url, open.url);
  assert.equal(again.klasor, root);
});

test("calls in flight at once share one panel", async () => {
  textOf(await callTool("panel_kapat"));
  const [a, b, c] = (await Promise.all([callTool("panel_ac"), callTool("panel_ac"), callTool("panel_ac", { klasor: root })])).map(textOf);
  assert.equal(a.url, b.url);
  assert.equal(b.url, c.url);
});

test("panel_kapat closes the panel", async () => {
  const out = textOf(await callTool("panel_ac", { klasor: root }));
  textOf(await callTool("panel_kapat"));
  await assert.rejects(fetch(out.url));
});

test("unknown methods and tools are errors", async () => {
  const res = await rpc("nope/nope", {});
  assert.equal(res.error.code, -32601);
  const tool = await callTool("yok");
  assert.equal(tool.error.code, -32602); // unknown tool: a protocol error (MCP spec)
});
