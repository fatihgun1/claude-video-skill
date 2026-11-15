import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtempSync, copyFileSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadLibrary } from "../src/library.mjs";
import { startPanel, vocabulary, versionOf, serialize } from "../src/panel.mjs";

const LIB_DIR = fileURLToPath(new URL("../../library", import.meta.url));
const EXAMPLE = fileURLToPath(new URL("../../../../ornekler/sokak/bolum.json", import.meta.url));
const lib = loadLibrary(LIB_DIR);

let dir, episodePath, panel, host;

function call(method, path, { body, headers = {} } = {}) {
  return new Promise((ok, fail) => {
    const data = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    const req = request(`${panel.url.replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        ...(data !== undefined ? { "content-type": "application/json", origin: `http://${host}` } : {}),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON (a page or a file) */ }
        ok({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on("error", fail);
    if (data !== undefined) req.write(data);
    req.end();
  });
}

const episode = () => JSON.parse(readFileSync(episodePath, "utf8"));

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "cizgi-panel-"));
  episodePath = join(dir, "bolum.json");
  copyFileSync(EXAMPLE, episodePath);
  panel = await startPanel({ episodePath, loadLib: () => lib, status: () => ({ gates: { senaryo: "yok", storyboard: "yok" } }), port: 0 });
  host = new URL(panel.url).host;
});

after(async () => {
  await panel.close();
  rmSync(dir, { recursive: true, force: true });
});

test("vocabulary offers only library words, with Turkish labels", () => {
  const v = vocabulary(lib);
  assert.ok(v.actions.some((a) => a.id === "egil-al"));
  assert.deepEqual(v.marks, Object.keys(lib.world.marks));
  assert.equal(v.framings.find((f) => f.id === "wide").label, "Geniş");
  assert.ok(v.props.some((p) => p.id === "plastik-sise"));
});

test("serialize writes 2-space JSON with a final newline", () => {
  assert.equal(serialize({ a: 1 }), '{\n  "a": 1\n}\n');
});

test("GET / serves the panel page", async () => {
  const res = await call("GET", "/");
  assert.equal(res.status, 200);
  assert.match(res.text, /Çizgi Stüdyo paneli/);
  assert.equal(res.headers["content-security-policy"], "frame-ancestors 'self'");
  assert.equal(res.headers["x-content-type-options"], "nosniff");
});

test("GET /api/bolum returns the episode, its version, vocabulary and a compiled preview", async () => {
  const res = await call("GET", "/api/bolum");
  assert.equal(res.status, 200);
  assert.equal(res.json.version, versionOf(readFileSync(episodePath, "utf8")));
  assert.equal(res.json.episode.episode, "sokakta-bir-sise");
  assert.equal(res.json.validation.ok, true);
  assert.equal(res.json.preview.ok, true, res.json.preview.error);
  assert.equal(res.json.preview.shots.length, 5);
  const page = await call("GET", "/onizleme/index.html");
  assert.equal(page.status, 200);
  assert.match(page.text, /__CIZGI__/);
});

test("POST /api/onizle previews an unsaved edit without touching the file", async () => {
  const before = readFileSync(episodePath, "utf8");
  const ep = episode();
  ep.scenes[1].shots[3].hold = 1.25;
  const res = await call("POST", "/api/onizle", { body: { episode: ep } });
  assert.equal(res.status, 200);
  assert.equal(res.json.validation.ok, true);
  assert.equal(res.json.preview.ok, true, res.json.preview.error);
  assert.equal(readFileSync(episodePath, "utf8"), before);
});

test("an episode with an action outside the library is not saved", async () => {
  const { json: loaded } = await call("GET", "/api/bolum");
  const before = readFileSync(episodePath, "utf8");
  const ep = episode();
  ep.scenes[1].shots[0].cast[0].action = "salla-sise";
  const res = await call("POST", "/api/kaydet", { body: { episode: ep, version: loaded.version } });
  assert.equal(res.status, 200);
  assert.equal(res.json.saved, false);
  assert.ok(res.json.validation.errors.some((e) => /salla-sise/.test(e)));
  assert.equal(readFileSync(episodePath, "utf8"), before);
});

test("a valid edit is saved, recompiled, and gets a new version", async () => {
  const { json: loaded } = await call("GET", "/api/bolum");
  const ep = episode();
  ep.scenes[1].shots[3].hold = 3;
  const res = await call("POST", "/api/kaydet", { body: { episode: ep, version: loaded.version } });
  assert.equal(res.status, 200);
  assert.equal(res.json.saved, true);
  assert.equal(episode().scenes[1].shots[3].hold, 3);
  assert.equal(res.json.version, versionOf(readFileSync(episodePath, "utf8")));
  assert.notEqual(res.json.version, loaded.version);
  assert.equal(res.json.preview.ok, true);
});

test("a save is refused when the file changed on disk since the panel loaded it", async () => {
  const { json: loaded } = await call("GET", "/api/bolum");
  const ep = episode();
  writeFileSync(episodePath, serialize({ ...ep, title: "someone else edited this" }));
  const res = await call("POST", "/api/kaydet", { body: { episode: ep, version: loaded.version } });
  assert.equal(res.status, 409);
  assert.equal(episode().title, "someone else edited this");
});

test("requests for another host are refused (DNS rebinding)", async () => {
  const res = await call("GET", "/api/bolum", { headers: { host: "evil.example:4810" } });
  assert.equal(res.status, 403);
});

test("POSTs from another origin or without JSON are refused (CSRF)", async () => {
  const ep = episode();
  const other = await call("POST", "/api/onizle", { body: { episode: ep }, headers: { origin: "http://evil.example" } });
  assert.equal(other.status, 403);
  const form = await call("POST", "/api/onizle", { body: "episode=x", headers: { "content-type": "text/plain" } });
  assert.equal(form.status, 415);
  const broken = await call("POST", "/api/onizle", { body: "{not json" });
  assert.equal(broken.status, 400);
  const notObject = await call("POST", "/api/onizle", { body: { episode: [] } });
  assert.equal(notObject.status, 400);
  const nullBody = await call("POST", "/api/kaydet", { body: "null" });
  assert.equal(nullBody.status, 400);
});

test("preview files cannot escape the preview folder", async () => {
  const res = await call("GET", "/onizleme/..%2F..%2Fbolum.json");
  assert.equal(res.status, 403);
  const missing = await call("GET", "/onizleme/yok.js");
  assert.equal(missing.status, 404);
  const badEscape = await call("GET", "/onizleme/%zz");
  assert.equal(badEscape.status, 400);
});

test("unknown routes are 404", async () => {
  const res = await call("DELETE", "/api/bolum");
  assert.equal(res.status, 404);
});
