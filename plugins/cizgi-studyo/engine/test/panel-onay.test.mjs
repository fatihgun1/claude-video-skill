// Approvals given by the person with a button in the panel (Üretim): the same checks as
// `cizgi onayla`, on the saved file; and the script table the senaryo step shows.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { openPanel } from "../src/panel-baslat.mjs";
import { status } from "../src/cli.mjs";
import { approveEpisode } from "../src/onayla.mjs";
import { loadLibrary } from "../src/library.mjs";

const LIB = fileURLToPath(new URL("../../library", import.meta.url));
const lib = loadLibrary(LIB);

const episode = (extra = {}) => ({
  episode: "deneme", language: "tr", format: "9:16",
  kararlar: { boyut: "2b", muzik: "yok", efekt: "yok", altyazi: "var" },
  characters: [{ id: "genc", rig: "genc", voice: { hazir: "erkek" } }],
  scenes: [{ scene_id: "s1", bg: "sokak", shots: [{ shot_id: "s1_sh1", utterances: [{ speaker: "genc", text: "Merhaba." }], cast: [{ id: "genc", action: "bak", mark: "orta" }], camera: { framing: "wide", move: "static", target: "genc" } }] }],
  ...extra,
});

function project(ep = episode()) {
  const root = mkdtempSync(join(tmpdir(), "cizgi-onay-"));
  mkdirSync(join(root, "bolumler", "a"), { recursive: true });
  writeFileSync(join(root, "bolumler", "a", "bolum.json"), JSON.stringify(ep));
  // the person was asked and wished nothing special
  writeFileSync(join(root, "bolumler", "a", "hikaye.json"), JSON.stringify({ fikir: "deneme", karakterler: [], kartlar: [], kisi: [] }));
  return root;
}

const panels = [];
after(async () => {
  for (const p of panels) await p.close();
});
async function panelOn(root) {
  const p = await openPanel({ target: root, library: LIB, status, port: 0 });
  panels.push(p);
  const base = p.url.replace(/\/$/, "");
  const host = new URL(p.url).host;
  return {
    get: async (path) => (await fetch(`${base}${path}`)).json(),
    post: (path, body, origin = `http://${host}`) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) }),
  };
}

test("approveEpisode records the gate with the same checks as cizgi onayla", () => {
  const root = project();
  const path = join(root, "bolumler", "a", "bolum.json");
  const res = approveEpisode(path, "senaryo", lib);
  assert.equal(res.approved, "senaryo");
  assert.ok(JSON.parse(readFileSync(join(root, "bolumler", "a", "onay.json"), "utf8")).senaryo);
  const open = project(episode({ kararlar: undefined }));
  assert.throws(() => approveEpisode(join(open, "bolumler", "a", "bolum.json"), "senaryo", lib), /kararlar/);
  assert.throws(() => approveEpisode(path, "baska", lib), /gate/);
});

test("an open dogrula warning holds both gates until the person accepts it (kabul_uyarilar)", async () => {
  // kpss-ajani was approved with 17 warnings; Hurda Kralı 1 rendered with a dog off screen
  const warned = episode();
  warned.scenes.push({ scene_id: "s2", bg: "sokak", isik: { saat: "gece" }, shots: [{ shot_id: "s2_sh1", cast: [{ id: "genc", action: "bak", mark: "orta" }], camera: { framing: "wide", move: "static" } }] });
  const root = project(warned);
  const path = join(root, "bolumler", "a", "bolum.json");
  const refused = (() => { try { approveEpisode(path, "senaryo", lib); return null; } catch (err) { return err; } })();
  assert.ok(refused, "refused");
  assert.match(refused.message, /açık uyarı/);
  const code = /\b(scene:s2:[0-9a-f]{6})\b/.exec(refused.message)?.[1];
  assert.ok(code, refused.message);
  // the panel refuses with the same reason
  const p = await panelOn(root);
  const res = await p.post("/api/onay", { b: "bolumler/a/bolum.json", kapi: "senaryo" });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /scene:s2:/);
  // the person keeps it: accepted with their reason, the gate opens
  const { acceptWarnings } = await import("../src/uyari-kabul.mjs");
  const all = [...refused.message.matchAll(/\b((?:scene|film):[a-z0-9_]+:[0-9a-f]{6})\b/g)].map((m) => m[1]); // the fixture is also a two-shot skeleton
  acceptWarnings(path, all, "kişi: gece sahnesi bilerek kararmayla başlasın");
  assert.equal(approveEpisode(path, "senaryo", lib).approved, "senaryo");
});

test("the panel approves the script only when the person presses its button, from the panel's own page", async () => {
  const root = project();
  const p = await panelOn(root);
  const forged = await p.post("/api/onay", { b: "bolumler/a/bolum.json", kapi: "senaryo" }, "http://evil.example");
  assert.equal(forged.status, 403);
  assert.equal(existsSync(join(root, "bolumler", "a", "onay.json")), false);
  const ok = await p.post("/api/onay", { b: "bolumler/a/bolum.json", kapi: "senaryo" });
  assert.equal(ok.status, 200, await ok.clone().text());
  const body = await ok.json();
  assert.equal(body.status.gates.senaryo, "onayli");
});

test("an approval the checks refuse is an error with the reason, and nothing is recorded", async () => {
  const root = project(episode({ kararlar: { boyut: "2b" } }));
  const p = await panelOn(root);
  const res = await p.post("/api/onay", { b: "bolumler/a/bolum.json", kapi: "senaryo" });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /muzik/);
  assert.equal(existsSync(join(root, "bolumler", "a", "onay.json")), false);
  assert.equal((await p.post("/api/onay", { b: "bolumler/a/bolum.json", kapi: "her-sey" })).status, 400);
});

test("the senaryo step reads the script table, open decisions and new assets of the saved file", async () => {
  const root = project(episode({ kararlar: { boyut: "2b" }, new_assets: [{ name: "suluman", type: "character" }] }));
  const p = await panelOn(root);
  const s = await p.get("/api/senaryo?b=bolumler%2Fa%2Fbolum.json");
  assert.equal(s.satirlar.length, 1);
  assert.match(s.tablo, /\| s1_sh1 /);
  assert.ok(s.kararlar.eksik.some((m) => m.startsWith("muzik:")));
  assert.equal(s.new_assets.length, 1);
});
