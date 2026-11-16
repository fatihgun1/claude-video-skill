import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync, existsSync, symlinkSync, renameSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadLibrary } from "../src/library.mjs";
import { validateEpisode } from "../src/validate.mjs";
import { startPanel, serialize } from "../src/panel.mjs";
import { findEpisodes, workspaceOf } from "../src/panel-proje.mjs";

const LIB_DIR = fileURLToPath(new URL("../../library", import.meta.url));
const SOKAK = fileURLToPath(new URL("../../../../ornekler/sokak/bolum.json", import.meta.url));
const FAZ1 = fileURLToPath(new URL("../../../../ornekler/faz1/bolum.json", import.meta.url));
const lib = loadLibrary(LIB_DIR);

let root, panel, host;
const started = [];
const cancelled = [];

function put(rel, from) {
  const file = join(root, ...rel.split("/"));
  mkdirSync(join(file, ".."), { recursive: true });
  copyFileSync(from, file);
  return file;
}

function call(method, path, { body, headers = {} } = {}) {
  return new Promise((ok, fail) => {
    const data = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    const req = request(`${panel.url.replace(/\/$/, "")}${path}`, {
      method,
      headers: { ...(data !== undefined ? { "content-type": "application/json", origin: `http://${host}` } : {}), ...headers },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        ok({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on("error", fail);
    if (data !== undefined) req.write(data);
    req.end();
  });
}

const open = (rel) => call("GET", `/api/bolum?b=${encodeURIComponent(rel)}`);
const read = (rel) => JSON.parse(readFileSync(join(root, ...rel.split("/")), "utf8"));

before(async () => {
  root = mkdtempSync(join(tmpdir(), "cizgi-proje-"));
  put("ornekler/sokak/bolum.json", SOKAK);
  put("ornekler/faz1/bolum.json", FAZ1);
  put("node_modules/paket/bolum.json", SOKAK);
  put(".gizli/bolum.json", SOKAK);
  put("ornekler/sokak/.cizgi/kopya/bolum.json", SOKAK);
  panel = await startPanel({
    root, loadLib: () => lib, port: 0,
    jobs: {
      start: (path, kind, format) => {
        if (kind !== "storyboard") throw Object.assign(new Error(`unknown job "${kind}"`), { code: 400 });
        started.push({ path, kind, format });
        return { kind, format, status: "running" };
      },
      get: (path) => (started.some((s) => s.path === path) ? { status: "running" } : null),
      cancel: (path) => { cancelled.push(path); return true; },
    },
    status: () => ({ gates: { senaryo: "onayli", storyboard: "eskimis" }, next: "cizgi render" }),
  });
  host = new URL(panel.url).host;
});

after(async () => {
  await panel.close();
  rmSync(root, { recursive: true, force: true });
});

test("every bolum.json under the folder is found; tool, output and hidden folders are skipped", () => {
  assert.deepEqual(findEpisodes(root), ["ornekler/faz1/bolum.json", "ornekler/sokak/bolum.json"]);
});

test("a folder opens as a project; a bolum.json opens its folder with that episode first", () => {
  assert.deepEqual(workspaceOf(root), { root, initial: null });
  const ws = workspaceOf(join(root, "ornekler", "sokak", "bolum.json"));
  assert.equal(ws.initial, "bolum.json");
  const other = join(root, "notlar.json");
  writeFileSync(other, "{}");
  assert.throws(() => workspaceOf(other), /folder or a bolum\.json/);
  rmSync(other);
  assert.throws(() => workspaceOf(join(root, "yok")), /not found/);
});

test("GET /api/bolumler summarizes each episode: title, shots, duration, background and gates", async () => {
  const res = await call("GET", "/api/bolumler");
  assert.equal(res.status, 200);
  const [faz1, sokak] = res.json.episodes;
  assert.equal(sokak.path, "ornekler/sokak/bolum.json");
  assert.equal(sokak.title, "Sokakta bir şişe");
  assert.equal(sokak.shots, 5);
  assert.equal(sokak.bg, "sokak-derinlik");
  assert.equal(typeof sokak.duration, "number");
  assert.deepEqual(sokak.gates, { senaryo: "onayli", storyboard: "eskimis" });
  assert.equal(sokak.next, "cizgi render");
  // faz1's lines have no audio files in this copy: its length is not known yet.
  assert.equal(faz1.shots, 3);
  assert.equal(faz1.duration, null);
});

test("a broken bolum.json is still listed, with the reason", async () => {
  const file = put("ornekler/bozuk/bolum.json", SOKAK);
  writeFileSync(file, "{ yarım");
  try {
    const { json } = await call("GET", "/api/bolumler");
    const bad = json.episodes.find((e) => e.path === "ornekler/bozuk/bolum.json");
    assert.equal(bad.ok, false);
    assert.match(bad.error, /^okunamadı/);
    assert.equal((await open("ornekler/bozuk/bolum.json")).status, 422);
  } finally {
    rmSync(join(root, "ornekler", "bozuk"), { recursive: true, force: true });
  }
});

test("two episodes are edited and saved independently, each with its own version and preview", async () => {
  const a = (await open("ornekler/sokak/bolum.json")).json;
  const b = (await open("ornekler/faz1/bolum.json")).json;
  assert.equal(a.episode.episode, "sokakta-bir-sise");
  assert.equal(b.episode.episode, "pamuk-ilk-sahne");
  assert.notEqual(a.preview.url, undefined);
  // faz1 has no audio here: its preview plays the lines silent, with guessed lengths.
  assert.equal(b.preview.ok, true, b.preview.error);
  assert.deepEqual(b.preview.unspoken, ["s1_sh1-0", "s1_sh2-0", "s1_sh3-0"]);

  const ep = structuredClone(a.episode);
  ep.title = "Sokakta bir şişe (panel)";
  const saved = await call("POST", "/api/kaydet", { body: { b: "ornekler/sokak/bolum.json", episode: ep, version: a.version } });
  assert.equal(saved.json.saved, true);
  assert.equal(read("ornekler/sokak/bolum.json").title, "Sokakta bir şişe (panel)");
  assert.equal(read("ornekler/faz1/bolum.json").title, b.episode.title);

  // Another episode's version never unlocks a save.
  const wrong = await call("POST", "/api/kaydet", { body: { b: "ornekler/sokak/bolum.json", episode: ep, version: b.version } });
  assert.equal(wrong.status, 409);
  // The version from before the save is stale now.
  const stale = await call("POST", "/api/kaydet", { body: { b: "ornekler/sokak/bolum.json", episode: ep, version: a.version } });
  assert.equal(stale.status, 409);
  const page = await call("GET", saved.json.preview.url);
  assert.equal(page.status, 200);
});

test("episode names must stay inside the folder and point at a bolum.json", async () => {
  const cases = [
    ["", 400], ["../bolum.json", 400], ["ornekler/../../x/bolum.json", 400], ["ornekler/sokak/onay.json", 400],
    ["node_modules/paket/bolum.json", 400], [".gizli/bolum.json", 400], ["/etc/bolum.json", 400],
    ["ornekler//bolum.json", 400], ["ornekler/yok/bolum.json", 404], ["C:/Windows/bolum.json", 400],
    ["ornekler\\..\\..\\x/bolum.json", 400], [".cizgi\\x/bolum.json", 400], ["node_modules\\paket/bolum.json", 400],
    ["//host/share/bolum.json", 400], ["\\\\host\\share/bolum.json", 400], ["C:bolum.json", 400],
  ];
  for (const [rel, code] of cases) assert.equal((await open(rel)).status, code, rel);
  assert.equal((await call("GET", "/api/bolum")).status, 400);
  const ep = read("ornekler/sokak/bolum.json");
  const outside = await call("POST", "/api/onizle", { body: { b: "../bolum.json", episode: ep } });
  assert.equal(outside.status, 400);
  const none = await call("POST", "/api/kaydet", { body: { episode: ep, version: "x" } });
  assert.equal(none.status, 400);
});

test("a new episode is written from a valid template under bolumler/<id>/ and listed", async () => {
  const res = await call("POST", "/api/yeni", { body: { id: "park-gunu", title: "Park günü" } });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.path, "bolumler/park-gunu/bolum.json");
  const ep = read("bolumler/park-gunu/bolum.json");
  assert.equal(ep.episode, "park-gunu");
  assert.equal(ep.title, "Park günü");
  assert.equal(validateEpisode(ep, lib).ok, true);
  assert.equal(readFileSync(join(root, "bolumler", "park-gunu", "bolum.json"), "utf8"), serialize(ep));
  const { json } = await call("GET", "/api/bolumler");
  const listed = json.episodes.find((e) => e.path === "bolumler/park-gunu/bolum.json");
  assert.equal(listed.shots, 1);
  assert.equal(listed.valid, true);
  const opened = await open("bolumler/park-gunu/bolum.json");
  assert.equal(opened.json.preview.ok, true, opened.json.preview.error);
});

test("a new episode never overwrites, and its id and title are checked", async () => {
  await call("POST", "/api/yeni", { body: { id: "tek", title: "Tek" } });
  const before = readFileSync(join(root, "bolumler", "tek", "bolum.json"), "utf8");
  const again = await call("POST", "/api/yeni", { body: { id: "tek", title: "Başka" } });
  assert.equal(again.status, 409);
  assert.equal(readFileSync(join(root, "bolumler", "tek", "bolum.json"), "utf8"), before);
  for (const body of [{ id: "../kacak", title: "x" }, { id: "Büyük", title: "x" }, { id: "a_b", title: "x" }, { id: "", title: "x" },
    { id: "bos-baslik", title: "  " }, { id: "uzun", title: "x".repeat(121) }, { id: 5, title: "x" }, {}]) {
    assert.equal((await call("POST", "/api/yeni", { body })).status, 400, JSON.stringify(body));
  }
  assert.equal(existsSync(join(root, "kacak")), false);
  assert.equal(existsSync(join(root, "bolumler", "bos-baslik")), false);
});

test("a link inside the folder that leads out of it is refused", async (t) => {
  const outside = mkdtempSync(join(tmpdir(), "cizgi-disari-"));
  copyFileSync(SOKAK, join(outside, "bolum.json"));
  try {
    try {
      symlinkSync(outside, join(root, "baglanti"), "junction");
    } catch (err) {
      return t.skip(`cannot make a link here: ${err.code}`);
    }
    assert.equal((await open("baglanti/bolum.json")).status, 403);
    // bolumler/ as a link out of the folder: no new episode is written there.
    rmSync(join(root, "bolumler"), { recursive: true, force: true });
    symlinkSync(outside, join(root, "bolumler"), "junction");
    const res = await call("POST", "/api/yeni", { body: { id: "kacak", title: "x" } });
    assert.equal(res.status, 403);
    assert.equal(existsSync(join(outside, "kacak")), false);
  } finally {
    rmSync(join(root, "baglanti"), { force: true, recursive: false });
    rmSync(join(root, "bolumler"), { force: true, recursive: false });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("a save is refused when that episode's file changed on disk", async () => {
  const a = (await open("ornekler/sokak/bolum.json")).json;
  const file = join(root, "ornekler", "sokak", "bolum.json");
  writeFileSync(file, serialize({ ...a.episode, title: "başkası değiştirdi" }));
  const res = await call("POST", "/api/kaydet", { body: { b: "ornekler/sokak/bolum.json", episode: a.episode, version: a.version } });
  assert.equal(res.status, 409);
  assert.equal(read("ornekler/sokak/bolum.json").title, "başkası değiştirdi");
});

test("the preview tells the timeline where each shot's speech ends", async () => {
  const { json } = await open("ornekler/sokak/bolum.json");
  assert.deepEqual(Object.keys(json.preview.rules).sort(), ["default_hold", "lead", "min_shot", "tail"]);
  for (const s of json.preview.shots) {
    assert.ok(s.speech_end >= s.start && s.speech_end <= s.end, s.shot_id);
    assert.ok(Array.isArray(s.utterances));
  }
  const { json: list } = await call("GET", "/api/bolumler");
  assert.equal(list.truncated, false);
});

test("an episode previews in 9:16 too, in its own folder", async () => {
  const wide = (await open("ornekler/sokak/bolum.json")).json.preview;
  const tall = (await call("GET", `/api/bolum?b=${encodeURIComponent("ornekler/sokak/bolum.json")}&f=9:16`)).json.preview;
  assert.equal(tall.ok, true, tall.error);
  assert.equal(tall.format, "9:16");
  assert.notEqual(tall.url, wide.url);
  assert.equal((await call("GET", tall.url)).status, 200);
  const ep = read("ornekler/sokak/bolum.json");
  const posted = await call("POST", "/api/onizle", { body: { b: "ornekler/sokak/bolum.json", episode: ep, format: "9:16" } });
  assert.equal(posted.json.preview.format, "9:16");
  assert.equal((await call("GET", `/api/bolum?b=${encodeURIComponent("ornekler/sokak/bolum.json")}&f=4:3`)).status, 400);
  assert.equal((await call("POST", "/api/onizle", { body: { b: "ornekler/sokak/bolum.json", episode: ep, format: 9 } })).status, 400);
});

test("creating an episode needs the panel's own host and origin and a JSON body", async () => {
  const host2 = await call("POST", "/api/yeni", { body: { id: "csrf", title: "x" }, headers: { host: "evil.example" } });
  assert.equal(host2.status, 403);
  const other = await call("POST", "/api/yeni", { body: { id: "csrf", title: "x" }, headers: { origin: "http://evil.example" } });
  assert.equal(other.status, 403);
  const form = await call("POST", "/api/yeni", { body: "id=csrf", headers: { "content-type": "text/plain" } });
  assert.equal(form.status, 415);
  assert.equal(existsSync(join(root, "bolumler", "csrf")), false);
});

test("production jobs start on the saved episode, from the panel's own origin only", async () => {
  const res = await call("POST", "/api/is", { body: { b: "ornekler/sokak/bolum.json", kind: "storyboard", format: "16:9" } });
  assert.equal(res.status, 200, res.text);
  assert.equal(started.at(-1).path, join(root, "ornekler", "sokak", "bolum.json"));
  assert.equal((await call("POST", "/api/is", { body: { b: "ornekler/sokak/bolum.json", kind: "onayla", format: "16:9" } })).status, 400);
  assert.equal((await call("POST", "/api/is", { body: { b: "../bolum.json", kind: "storyboard", format: "16:9" } })).status, 400);
  const cross = await call("POST", "/api/is", { body: { b: "ornekler/sokak/bolum.json", kind: "storyboard", format: "16:9" }, headers: { origin: "http://evil.example" } });
  assert.equal(cross.status, 403);
  const status = await call("GET", `/api/is?b=${encodeURIComponent("ornekler/sokak/bolum.json")}`);
  assert.equal(status.json.job.status, "running");
});

test("storyboard sheets and videos of an opened episode are served, nothing else", async () => {
  const dir = join(root, "ornekler", "sokak");
  mkdirSync(join(dir, "storyboard", "16x9"), { recursive: true });
  mkdirSync(join(dir, "cikti"), { recursive: true });
  writeFileSync(join(dir, "storyboard", "16x9", "contact-sheet-1.png"), "png");
  writeFileSync(join(dir, "cikti", "x-16x9-taslak.mp4"), "mp4");
  const { json } = await open("ornekler/sokak/bolum.json");
  assert.deepEqual(json.outputs.sheets, ["storyboard/16x9/contact-sheet-1.png"]);
  const sheet = await call("GET", `${json.outputsUrl}storyboard/16x9/contact-sheet-1.png`);
  assert.equal(sheet.status, 200);
  assert.equal(sheet.headers["content-type"], "image/png");
  assert.equal((await call("GET", `${json.outputsUrl}cikti/x-16x9-taslak.mp4`)).headers["content-type"], "video/mp4");
  for (const p of ["bolum.json", "cikti/..%2Fbolum.json", "storyboard/..%2F..%2Fbolum.json", "ses/manifest.json"]) {
    assert.notEqual((await call("GET", `${json.outputsUrl}${p}`)).status, 200, p);
  }
  assert.equal((await call("GET", "/uretim/0123456789abcdef/cikti/x.mp4")).status, 404);
});

test("a video request the browser drops lets go of the file, so the next render can replace it", async () => {
  const dir = join(root, "ornekler", "sokak");
  const video = join(dir, "cikti", "birak.mp4");
  const big = () => writeFileSync(video, Buffer.alloc(32 * 1024 * 1024)); // far more than one read: the stream is mid-file when dropped
  // what HyperFrames does at the end of a render: rename the new file over the old one (EPERM on Windows while open);
  // the server closes the file a moment after the drop, so a few tries over a second
  const replace = async () => {
    writeFileSync(`${video}.yeni`, "yeni");
    for (let tries = 0; ; tries++) {
      try {
        return renameSync(`${video}.yeni`, video);
      } catch (err) {
        if (err.code !== "EPERM" || tries >= 10) throw err;
        await new Promise((ok) => setTimeout(ok, 100));
      }
    }
  };
  try {
    big();
    const { json } = await open("ornekler/sokak/bolum.json");
    for (const range of [undefined, "bytes=0-"]) {
      await new Promise((ok, fail) => {
        const req = request(`${panel.url.replace(/\/$/, "")}${json.outputsUrl}cikti/birak.mp4`, { headers: range ? { range } : {} }, (res) => {
          res.once("data", () => { req.destroy(); ok(); }); // the player seeks: it drops this request
        });
        req.on("error", (err) => (err.code === "ECONNRESET" ? ok() : fail(err)));
        req.end();
      });
      await replace();
      assert.equal(readFileSync(video, "utf8"), "yeni");
      big();
    }
  } finally {
    rmSync(video, { force: true });
    rmSync(`${video}.yeni`, { force: true });
  }
});

test("a draft video can be seeked (byte ranges), and a link out of the outputs is refused", async (t) => {
  const dir = join(root, "ornekler", "sokak");
  writeFileSync(join(dir, "cikti", "aralik.mp4"), Buffer.from("0123456789"));
  const { json } = await open("ornekler/sokak/bolum.json");
  const part = await call("GET", `${json.outputsUrl}cikti/aralik.mp4`, { headers: { range: "bytes=2-5" } });
  assert.equal(part.status, 206);
  assert.equal(part.text, "2345");
  assert.equal(part.headers["content-range"], "bytes 2-5/10");
  assert.equal(part.headers["accept-ranges"], "bytes");
  const whole = await call("GET", `${json.outputsUrl}cikti/aralik.mp4`);
  assert.equal(whole.status, 200);
  assert.equal(whole.text, "0123456789");
  assert.equal((await call("GET", `${json.outputsUrl}cikti/aralik.mp4`, { headers: { range: "bytes=50-60" } })).status, 416);
  const outside = mkdtempSync(join(tmpdir(), "cizgi-disari-"));
  writeFileSync(join(outside, "gizli.png"), "secret");
  try {
    try {
      symlinkSync(outside, join(dir, "storyboard", "baglanti"), "junction");
    } catch (err) {
      return t.skip(`cannot make a link here: ${err.code}`);
    }
    assert.equal((await call("GET", `${json.outputsUrl}storyboard/baglanti/gizli.png`)).status, 403);
  } finally {
    rmSync(join(dir, "storyboard", "baglanti"), { force: true, recursive: false });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("a running job can be stopped from the panel", async () => {
  const res = await call("POST", "/api/is/durdur", { body: { b: "ornekler/sokak/bolum.json" } });
  assert.equal(res.status, 200, res.text);
  assert.equal(cancelled.at(-1), join(root, "ornekler", "sokak", "bolum.json"));
});
