// The plugin's MCP server (stdio, JSON-RPC): it opens the editor panel for a folder and lists its episodes.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../src/mcp.mjs", import.meta.url));
const SOKAK = fileURLToPath(new URL("../../../../ornekler/sokak/bolum.json", import.meta.url));

let root, other, queues, child, lines, nextId = 1;
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
  queues = mkdtempSync(join(tmpdir(), "cizgi-mcp-kuyruk-"));
  child = spawn(process.execPath, [SERVER], { cwd: root, env: { ...process.env, CIZGI_PANEL_PORT: "0", CIZGI_ISTEK_KOK: queues }, stdio: ["pipe", "pipe", "pipe"] });
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
  rmSync(queues, { recursive: true, force: true });
});

test("initialize answers with tools capability and the asked protocol version", async () => {
  const res = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
  assert.equal(res.result.protocolVersion, "2025-06-18");
  assert.ok(res.result.capabilities.tools);
  assert.equal(res.result.serverInfo.name, "cizgi-studyo");
  send({ jsonrpc: "2.0", method: "notifications/initialized" }); // a notification gets no answer
});

test("tools/list names the panel and request tools with input schemas", async () => {
  const res = await rpc("tools/list", {});
  const names = res.result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["panel_ac", "panel_git", "panel_istekleri", "panel_kapat", "panel_sor", "panel_yanitla"]);
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

test("a request written in the panel reaches Claude, and the answer reaches the panel", async () => {
  const open = textOf(await callTool("panel_ac", { klasor: root }));
  const base = open.url.replace(/\/$/, "");
  const host = new URL(open.url).host;
  const b = "bolumler/bir/bolum.json";
  const post = (body) => fetch(`${base}/api/istek`, { method: "POST", headers: { "content-type": "application/json", origin: `http://${host}` }, body: JSON.stringify(body) });
  const sent = await post({ b, hedef: { tur: "karakter", shot: "s1_sh1", id: "genc", etiket: "Genç" }, metin: "el sallasın", zaman: 1.5 });
  assert.equal(sent.status, 200);
  const { istek } = await sent.json();
  // another site cannot queue one
  const forged = await fetch(`${base}/api/istek`, { method: "POST", headers: { "content-type": "application/json", origin: "http://evil.example" }, body: JSON.stringify({ b, hedef: { tur: "bolum" }, metin: "x" }) });
  assert.equal(forged.status, 403);

  assert.equal(existsSync(join(root, ".cizgi")), false); // the queue is not in the project
  const taken = textOf(await callTool("panel_istekleri"));
  assert.deepEqual(taken.istekler.map((r) => r.id), [istek.id]);
  assert.match(taken.istekler[0].aciklama, /"el sallasın"/);
  assert.deepEqual(textOf(await callTool("panel_istekleri")).istekler, []); // taken once

  const poll = async () => (await fetch(`${base}/api/istekler?b=${encodeURIComponent(b)}`)).json();
  assert.equal((await poll()).istekler[0].durum, "alindi");
  textOf(await callTool("panel_yanitla", { id: istek.id, durum: "yapildi", yanit: "s1_sh1'de Genç el sallıyor." }));
  const after = await poll();
  assert.equal(after.oturum, true);
  assert.equal(after.istekler[0].durum, "yapildi");
  assert.equal(after.istekler[0].yanit, "s1_sh1'de Genç el sallıyor.");
  assert.match(after.surum, /^[0-9a-f]{16}$/);

  const wrong = await callTool("panel_yanitla", { id: "pyok", durum: "yapildi", yanit: "x" });
  assert.equal(wrong.result.isError, true);
});

test("panel_git moves the open panel: the page reads the command from /api/kanal", async () => {
  const open = textOf(await callTool("panel_ac", { klasor: root }));
  const base = open.url.replace(/\/$/, "");
  const res = textOf(await callTool("panel_git", { bolum: "bolumler/iki/bolum.json", sekme: "karakter", kaydir: "taslaklar", vurgula: "Kütüphaneye al" }));
  assert.equal(res.yon.sekme, "karakter");
  const kanal = await (await fetch(`${base}/api/kanal`)).json();
  assert.deepEqual(kanal.yon, res.yon);
  const unknown = await callTool("panel_git", { bolum: "bolumler/yok/bolum.json" });
  assert.equal(unknown.result.isError, true);
  const bad = await callTool("panel_git", { sekme: "gizli" });
  assert.equal(bad.result.isError, true);
});

test("panel_sor waits for the answer given in the panel and returns it", async () => {
  const open = textOf(await callTool("panel_ac", { klasor: root }));
  const base = open.url.replace(/\/$/, "");
  const host = new URL(open.url).host;
  const asking = callTool("panel_sor", { soru: "Hangi mekân?", secenekler: [{ etiket: "Sokak" }, { etiket: "Park", gorsel: "/kutuphane/mekan/park.svg" }] });
  let kanal;
  for (let i = 0; i < 50 && !kanal?.soru; i++) {
    kanal = await (await fetch(`${base}/api/kanal`)).json();
    if (!kanal.soru) await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(kanal.soru.soru, "Hangi mekân?");
  // other tools still answer while a question waits
  assert.ok(textOf(await callTool("panel_git", { sekme: "mekan" })).yon);
  const posted = await fetch(`${base}/api/kanal/cevap`, { method: "POST", headers: { "content-type": "application/json", origin: `http://${host}` }, body: JSON.stringify({ id: kanal.soru.id, secim: ["Park"], metin: "akşam olsun" }) });
  assert.equal(posted.status, 200);
  const answer = textOf(await asking);
  assert.deepEqual(answer.cevap.secim, ["Park"]);
  assert.equal(answer.cevap.metin, "akşam olsun");
});

test("an answer after panel_sor stopped waiting reaches Claude as a panel request", async () => {
  const open = textOf(await callTool("panel_ac", { klasor: root }));
  const base = open.url.replace(/\/$/, "");
  const host = new URL(open.url).host;
  const out = textOf(await callTool("panel_sor", { soru: "Müzik olsun mu?", secenekler: [{ etiket: "Evet" }, { etiket: "Hayır" }], bolum: "bolumler/bir/bolum.json", bekle: 0.05 }));
  assert.equal(out.durum, "bekliyor");
  const posted = await fetch(`${base}/api/kanal/cevap`, { method: "POST", headers: { "content-type": "application/json", origin: `http://${host}` }, body: JSON.stringify({ id: out.id, secim: ["Hayır"] }) });
  assert.equal(posted.status, 200);
  const taken = textOf(await callTool("panel_istekleri"));
  const late = taken.istekler.find((r) => /Müzik olsun mu/.test(r.metin));
  assert.ok(late, JSON.stringify(taken));
  assert.match(late.metin, /Seçim: Hayır/);
  assert.match(late.bolum, /bir/);
  textOf(await callTool("panel_yanitla", { id: late.id, durum: "yapildi", yanit: "Müzik yok." }));
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
