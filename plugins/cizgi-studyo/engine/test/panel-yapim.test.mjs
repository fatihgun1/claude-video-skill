// The project wizard's side on the server: an episode being made has only its story
// (bolumler/<id>/hikaye.json); "Oluştur" asks Claude to build bolum.json from it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadLibrary } from "../src/library.mjs";
import { makingRoutes } from "../src/panel-yapim.mjs";
import { readRequests } from "../src/istekler.mjs";

const LIB = fileURLToPath(new URL("../../library", import.meta.url));
const SOKAK = fileURLToPath(new URL("../../../../ornekler/sokak/bolum.json", import.meta.url));
const lib = loadLibrary(LIB);

const story = () => ({
  baslik: "Sokaktan kurtuluş",
  fikir: "Sokakta yaşayan genç bir adam kendi çabasıyla iş bulur.",
  yas: "genel",
  istekler: { format: "9:16", sure: 40, boyut: "2b", muzik: "yok", efekt: true, altyazi: "var" },
  karakterler: [{ ad: "Sülüman", not: "25 yaşında, sarışın, yorgun yüzlü" }],
  kartlar: [{ id: "k1", baslik: "Gece", olay: "Şişe toplar.", kim: ["Sülüman"], mekan: "sokak", saat: "gece" }],
});

function setup({ withQueue = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "cizgi-yapim-"));
  const queue = withQueue ? join(mkdtempSync(join(tmpdir(), "cizgi-yapim-q-")), "q.jsonl") : null;
  return { root, queue, routes: makingRoutes({ root, loadLib: () => lib, requests: queue }) };
}
const empty = { version: "e3b0c44298fc1c14" }; // the version of a story never written (readStory)

test("a new episode's story is written under bolumler/<id>/ and listed as being made", () => {
  const { root, routes } = setup();
  const read = routes["GET /api/yapim/oku"](undefined, new URL("http://p/api/yapim/oku?id=suluman"));
  assert.equal(read.bolum, null);
  const res = routes["POST /api/yapim"]({ id: "suluman", story: story(), version: read.version });
  assert.match(res.version, /^[0-9a-f]{16}$/);
  assert.ok(existsSync(join(root, "bolumler", "suluman", "hikaye.json")));
  assert.deepEqual(routes["GET /api/yapim"]().yapimlar, [{ id: "suluman", baslik: "Sokaktan kurtuluş" }]);
  // written again only over the version it read
  assert.throws(() => routes["POST /api/yapim"]({ id: "suluman", story: story(), ...empty }), (e) => e.code === 409);
});

test("an episode that has its bolum.json is not 'being made', but its wishes can still be edited", () => {
  const { root, routes } = setup();
  mkdirSync(join(root, "bolumler", "sokak"), { recursive: true });
  copyFileSync(SOKAK, join(root, "bolumler", "sokak", "bolum.json"));
  const read = routes["GET /api/yapim/oku"](undefined, new URL("http://p/api/yapim/oku?id=sokak"));
  assert.equal(read.bolum, "bolumler/sokak/bolum.json");
  routes["POST /api/yapim"]({ id: "sokak", story: story(), version: read.version });
  assert.deepEqual(routes["GET /api/yapim"]().yapimlar, []);
});

test("ids, stories and paths are checked", () => {
  const { root, routes } = setup();
  for (const id of ["../kacak", "Büyük", "a_b", "", 5]) {
    assert.throws(() => routes["POST /api/yapim"]({ id, story: story(), ...empty }), (e) => e.code === 400, String(id));
  }
  assert.throws(() => routes["POST /api/yapim"]({ id: "x", story: { ...story(), istekler: { boyut: "4b" } }, ...empty }), (e) => e.code === 400);
  assert.equal(existsSync(join(root, "bolumler", "x")), false, "nothing is written for a refused story");
  assert.throws(() => routes["GET /api/yapim/oku"](undefined, new URL("http://p/api/yapim/oku?id=..")), (e) => e.code === 400);
});

test("Oluştur asks Claude to build the episode from the story, once the essentials are there", () => {
  const { root, queue, routes } = setup();
  const thin = { ...story(), kartlar: [], istekler: { boyut: "2b" } };
  routes["POST /api/yapim"]({ id: "ince", story: thin, ...empty });
  assert.throws(() => routes["POST /api/yapim/olustur"]({ id: "ince" }), (e) => e.code === 400 && /kart/.test(e.message) && /format/.test(e.message));
  routes["POST /api/yapim"]({ id: "suluman", story: story(), ...empty });
  const { istek } = routes["POST /api/yapim/olustur"]({ id: "suluman" });
  const [req] = readRequests(queue);
  assert.equal(req.id, istek.id);
  assert.equal(req.root, root);
  assert.equal(req.b, "bolumler/suluman/bolum.json");
  assert.match(req.metin, /hikaye\.json/);
  assert.match(req.metin, /oluştur/i);
});

test("Oluştur needs a Claude session", () => {
  const { routes } = setup({ withQueue: false });
  routes["POST /api/yapim"]({ id: "suluman", story: story(), ...empty });
  assert.throws(() => routes["POST /api/yapim/olustur"]({ id: "suluman" }), (e) => e.code === 409);
});

test("a broken story file is reported, never overwritten silently", () => {
  const { root, routes } = setup();
  mkdirSync(join(root, "bolumler", "bozuk"), { recursive: true });
  writeFileSync(join(root, "bolumler", "bozuk", "hikaye.json"), "{ yarım");
  assert.throws(() => routes["GET /api/yapim/oku"](undefined, new URL("http://p/api/yapim/oku?id=bozuk")), (e) => e.code === 422);
  assert.deepEqual(routes["GET /api/yapim"]().yapimlar, [{ id: "bozuk", baslik: null }]);
});
