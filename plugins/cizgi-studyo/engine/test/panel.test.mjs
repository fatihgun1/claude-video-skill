import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadLibrary } from "../src/library.mjs";
import { startPanel, vocabulary, versionOf, serialize, listeningOf } from "../src/panel.mjs";
import { actionPreview, cachedLibrary } from "../src/panel-kutuphane.mjs";
import { compileEpisode } from "../src/compile.mjs";

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
const B = "/api/bolum?b=bolum.json";

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
  const res = await call("GET", B);
  assert.equal(res.status, 200);
  assert.equal(res.json.version, versionOf(readFileSync(episodePath, "utf8")));
  assert.equal(res.json.episode.episode, "sokakta-bir-sise");
  assert.equal(res.json.validation.ok, true);
  assert.equal(res.json.preview.ok, true, res.json.preview.error);
  assert.equal(res.json.preview.shots.length, 5);
  assert.equal(res.json.path, "bolum.json");
  assert.match(res.json.preview.url, /^\/onizleme\/[0-9a-f]{16}\/index\.html$/);
  const page = await call("GET", res.json.preview.url);
  assert.equal(page.status, 200);
  assert.match(page.text, /__CIZGI__/);
});

test("POST /api/onizle previews an unsaved edit without touching the file", async () => {
  const before = readFileSync(episodePath, "utf8");
  const ep = episode();
  ep.scenes[1].shots[3].hold = 1.25;
  const res = await call("POST", "/api/onizle", { body: { b: "bolum.json", episode: ep } });
  assert.equal(res.status, 200);
  assert.equal(res.json.validation.ok, true);
  assert.equal(res.json.preview.ok, true, res.json.preview.error);
  assert.equal(readFileSync(episodePath, "utf8"), before);
});

test("an episode with an action outside the library is not saved", async () => {
  const { json: loaded } = await call("GET", B);
  const before = readFileSync(episodePath, "utf8");
  const ep = episode();
  ep.scenes[1].shots[0].cast[0].action = "salla-sise";
  const res = await call("POST", "/api/kaydet", { body: { b: "bolum.json", episode: ep, version: loaded.version } });
  assert.equal(res.status, 200);
  assert.equal(res.json.saved, false);
  assert.ok(res.json.validation.errors.some((e) => /salla-sise/.test(e)));
  assert.equal(readFileSync(episodePath, "utf8"), before);
});

test("a valid edit is saved, recompiled, and gets a new version", async () => {
  const { json: loaded } = await call("GET", B);
  const ep = episode();
  ep.scenes[1].shots[3].hold = 3;
  const res = await call("POST", "/api/kaydet", { body: { b: "bolum.json", episode: ep, version: loaded.version } });
  assert.equal(res.status, 200);
  assert.equal(res.json.saved, true);
  assert.equal(episode().scenes[1].shots[3].hold, 3);
  assert.equal(res.json.version, versionOf(readFileSync(episodePath, "utf8")));
  assert.notEqual(res.json.version, loaded.version);
  assert.equal(res.json.preview.ok, true);
});

test("a save is refused when the file changed on disk since the panel loaded it", async () => {
  const { json: loaded } = await call("GET", B);
  const ep = episode();
  writeFileSync(episodePath, serialize({ ...ep, title: "someone else edited this" }));
  const res = await call("POST", "/api/kaydet", { body: { b: "bolum.json", episode: ep, version: loaded.version } });
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
  const { json } = await call("GET", B);
  const base = json.preview.url.replace(/index\.html$/, "");
  const res = await call("GET", `${base}..%2F..%2Fbolum.json`);
  assert.equal(res.status, 403);
  const missing = await call("GET", `${base}yok.js`);
  assert.equal(missing.status, 404);
  const badEscape = await call("GET", `${base}%zz`);
  assert.equal(badEscape.status, 400);
  assert.equal((await call("GET", "/onizleme/0123456789abcdef/index.html")).status, 404);
});

test("the vocabulary carries what the library cards show", () => {
  const v = vocabulary(lib);
  assert.equal(v.rigs.find((r) => r.id === "ela-profil").person, "ela");
  assert.equal(v.rigs.find((r) => r.id === "ela-profil").view, "profile-right");
  assert.equal(v.backgrounds.find((b) => b.id === "sokak-derinlik").depth, true);
  assert.equal(v.backgrounds.find((b) => b.id === "oda").depth, false);
  assert.equal(v.actions.find((a) => a.id === "yuru-cocuk").loop, true);
  assert.equal(v.sfx.find((s) => s.id === "kapi-ac").label, "Kapı açılır");
  assert.ok(v.framings.find((f) => f.id === "detay").zoom > 1);
});

test("library files are served by id only", async () => {
  const rig = await call("GET", "/kutuphane/karakter/ela.svg");
  assert.equal(rig.status, 200);
  assert.match(rig.headers["content-type"], /image\/svg\+xml/);
  assert.match(rig.text, /id="root"/);
  const sound = await call("GET", "/kutuphane/ses/tik.wav");
  assert.equal(sound.status, 200);
  assert.equal(sound.headers["content-type"], "audio/wav");
  for (const path of ["/kutuphane/karakter/yok.svg", "/kutuphane/karakter/ela.json", "/kutuphane/sifre/ela.svg",
    "/kutuphane/karakter/..%2F..%2Fworld.svg", "/kutuphane/karakter/constructor.svg"]) {
    assert.equal((await call("GET", path)).status, 404, path);
  }
});

test("every module the panel page imports is served", async () => {
  const page = (await call("GET", "/")).text;
  const queue = [...page.matchAll(/(?:src|href)="\/panel\/([a-z]+\.(?:m?js|css))"/g)].map((m) => m[1]);
  const seen = new Set();
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const res = await call("GET", `/panel/${name}`);
    assert.equal(res.status, 200, name);
    for (const m of res.text.matchAll(/from "\.\/([a-z]+\.m?js)"/g)) queue.push(m[1]);
  }
  assert.ok(seen.has("kurgu.js") && seen.has("zaman.js") && seen.has("muzik.mjs"));
});

test("the engine's music envelope is shared with the panel as a JavaScript module", async () => {
  const res = await call("GET", "/panel/muzik.mjs");
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /text\/javascript/);
  assert.match(res.text, /export function musicGain/);
});

test("the listening check of each line comes from ses/manifest.json", () => {
  const ep = mkdtempSync(join(tmpdir(), "cizgi-dinle-"));
  try {
    mkdirSync(join(ep, "ses"));
    writeFileSync(join(ep, "ses", "manifest.json"), JSON.stringify({ lines: {
      "s1_sh1-0": { ok: true, heard: "Merhaba", cer: 0 },
      "s1_sh1-1": { ok: false, accepted: true, heard: "Pütreş", cer: 0.33 },
    } }));
    const l = listeningOf(join(ep, "bolum.json"));
    assert.deepEqual(l["s1_sh1-0"], { ok: true, accepted: false, heard: "Merhaba", cer: 0 });
    assert.equal(l["s1_sh1-1"].accepted, true);
    writeFileSync(join(ep, "ses", "manifest.json"), "{ bozuk");
    assert.deepEqual(listeningOf(join(ep, "bolum.json")), {});
  } finally {
    rmSync(ep, { recursive: true, force: true });
  }
});

test("only the panel's own files are served from /panel/", async () => {
  assert.equal((await call("GET", "/panel/app.js")).status, 200);
  assert.match((await call("GET", "/panel/panel.css")).headers["content-type"], /text\/css/);
  assert.equal((await call("GET", "/panel/index.html")).status, 404);
  assert.equal((await call("GET", "/panel/..%2Fpanel.mjs")).status, 404);
});

test("an action preview compiles for a rig it fits, and explains in Turkish when it does not", async () => {
  const ok = await call("GET", "/api/hareket?rig=ela-profil&action=yuru-cocuk&bg=park");
  assert.equal(ok.json.ok, true, ok.json.error);
  const page = await call("GET", ok.json.url);
  assert.equal(page.status, 200);
  assert.match(page.text, /__CIZGI__/);
  const bad = await call("GET", "/api/hareket?rig=genc&action=alkis");
  assert.equal(bad.json.ok, false);
  assert.match(bad.json.error, /^Bu karaktere uymuyor: yakın dirsek 135° istiyor, genc en çok -145\.\.5° bükülüyor\.$/);
  assert.equal((await call("GET", "/api/hareket?rig=../x&action=bekle")).json.ok, false);
});

test("a valid episode that does not compile is not saved", async () => {
  const { json: loaded } = await call("GET", B);
  const before = readFileSync(episodePath, "utf8");
  const ep = episode();
  ep.scenes[1].shots[0].sfx = [{ sfx: "tik", at: 9.5 }]; // valid, but after the shot ends
  const res = await call("POST", "/api/kaydet", { body: { b: "bolum.json", episode: ep, version: loaded.version } });
  assert.equal(res.status, 200);
  assert.equal(res.json.validation.ok, true);
  assert.equal(res.json.saved, false);
  assert.match(res.json.preview.error, /after the shot ends/);
  assert.equal(readFileSync(episodePath, "utf8"), before);
});

test("another site cannot make the panel compile (an <img> pointing at the API)", async () => {
  for (const path of ["/api/hareket?rig=ela&action=bekle", B, "/api/bolumler"]) {
    assert.equal((await call("GET", path, { headers: { "sec-fetch-site": "cross-site" } })).status, 403, path);
    assert.equal((await call("GET", path, { headers: { "sec-fetch-site": "same-site" } })).status, 403, path);
  }
  assert.equal((await call("GET", B, { headers: { "sec-fetch-site": "same-origin" } })).status, 200);
});

test("an action preview is compiled once per library", () => {
  let compiles = 0;
  const counting = (...args) => {
    compiles++;
    return compileEpisode(...args);
  };
  const where = { episodePath, dir: mkdtempSync(join(tmpdir(), "cizgi-hareket-")), compile: counting, cache: new Map() };
  try {
    const a = actionPreview(lib, { rig: "ela", action: "bekle", bg: "park" }, where);
    const b = actionPreview(lib, { rig: "ela", action: "bekle", bg: "park" }, where);
    assert.equal(a.ok, true, a.error);
    assert.deepEqual(b, a);
    assert.equal(compiles, 1);
    actionPreview(loadLibrary(LIB_DIR), { rig: "ela", action: "bekle", bg: "park" }, where); // a reloaded library
    assert.equal(compiles, 2);
  } finally {
    rmSync(where.dir, { recursive: true, force: true });
  }
});

test("the library is loaded again only when one of its files changes", () => {
  const dir = mkdtempSync(join(tmpdir(), "cizgi-kutuphane-"));
  try {
    writeFileSync(join(dir, "a.json"), "{}");
    let loads = 0;
    const get = cachedLibrary(dir, () => ({ n: ++loads }));
    const first = get();
    assert.equal(get(), first);
    assert.equal(loads, 1);
    writeFileSync(join(dir, "b.json"), "{}"); // a new file
    assert.notEqual(get(), first);
    assert.equal(loads, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unknown routes are 404", async () => {
  const res = await call("DELETE", "/api/bolum");
  assert.equal(res.status, 404);
});
