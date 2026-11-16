import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { scanLibrary, writeManifest, checkLibrary, integrityErrors } from "../src/icerik.mjs";

const LIB_DIR = fileURLToPath(new URL("../../library", import.meta.url));

function fakeLibrary() {
  const dir = mkdtempSync(join(tmpdir(), "icerik-"));
  mkdirSync(join(dir, "characters", "ali"), { recursive: true });
  mkdirSync(join(dir, "actions"));
  mkdirSync(join(dir, "sfx"));
  writeFileSync(join(dir, "characters", "ali", "rig.svg"), "<svg>\n</svg>\n");
  writeFileSync(join(dir, "actions", "bekle.json"), "{}\n");
  writeFileSync(join(dir, "sfx", "pat.wav"), Buffer.from([1, 2, 3]));
  return dir;
}

test("the shipped library matches its manifest (run npm run icerik after changing the library)", () => {
  const res = checkLibrary(LIB_DIR);
  assert.equal(res.manifest, true, "library/icerik.json is missing");
  assert.deepEqual({ eklenen: res.eklenen, degisen: res.degisen, silinen: res.silinen }, { eklenen: [], degisen: [], silinen: [] });
});

test("a library without a manifest is not checked", () => {
  assert.deepEqual(checkLibrary(fakeLibrary()), { manifest: false, eklenen: [], degisen: [], silinen: [] });
});

test("added, changed and removed files are found", () => {
  const dir = fakeLibrary();
  writeManifest(dir);
  assert.deepEqual(checkLibrary(dir), { manifest: true, eklenen: [], degisen: [], silinen: [] });
  mkdirSync(join(dir, "characters", "veli"));
  writeFileSync(join(dir, "characters", "veli", "rig.svg"), "<svg/>");
  writeFileSync(join(dir, "actions", "bekle.json"), '{"x":1}\n');
  rmSync(join(dir, "sfx", "pat.wav"));
  assert.deepEqual(checkLibrary(dir), {
    manifest: true,
    eklenen: ["characters/veli/rig.svg"],
    degisen: ["actions/bekle.json"],
    silinen: ["sfx/pat.wav"],
  });
});

test("line endings do not count as a change", () => {
  const dir = fakeLibrary();
  writeManifest(dir);
  writeFileSync(join(dir, "characters", "ali", "rig.svg"), "<svg>\r\n</svg>\r\n");
  assert.deepEqual(checkLibrary(dir).degisen, []);
});

test("the manifest lists every file but itself, with forward slashes", () => {
  const dir = fakeLibrary();
  writeManifest(dir);
  assert.deepEqual(Object.keys(scanLibrary(dir)).sort(), ["actions/bekle.json", "characters/ali/rig.svg", "sfx/pat.wav"]);
});

const episode = {
  characters: [{ id: "n", rig: "nazim" }],
  music: { track: "parca" },
  scenes: [{ scene_id: "s1", bg: "sokak", dekor: [{ id: "d", prop: "bank", x: 0 }], shots: [{
    shot_id: "s1_sh1",
    cast: [{ id: "n", action: "bekle-yan", actions: [{ action: "bak", at: 1 }] }],
    props: [{ id: "p", prop: "plastik-sise" }],
    sfx: [{ sfx: "pat", at: 0 }],
    camera: { framing: "wide" },
  }] }],
};

test("an episode that uses an added or changed library file gets an error per file", () => {
  const check = {
    manifest: true,
    eklenen: ["characters/nazim/rig.svg", "actions/bak.json", "backgrounds/sokak/gok.svg", "props/plastik-sise.svg", "sfx/pat.wav", "muzik/parca.wav", "props/bank.svg"],
    degisen: ["actions/bekle-yan.json"],
    silinen: [],
  };
  const errors = integrityErrors(episode, check);
  assert.equal(errors.length, 8, errors.join("\n"));
  assert.ok(errors.every((e) => /plugin update/.test(e)));
  assert.ok(errors.some((e) => e.includes("characters/nazim/rig.svg")));
});

test("files the episode does not use are not its errors", () => {
  const check = { manifest: true, eklenen: ["characters/baska/rig.svg", "actions/bekle-yan-2.json", "backgrounds/sokak2.svg"], degisen: [], silinen: [] };
  assert.deepEqual(integrityErrors(episode, check), []);
});

test("the shared files (world, cameras, profiles) count for every episode", () => {
  const check = { manifest: true, eklenen: [], degisen: ["cameras.json"], silinen: [] };
  assert.equal(integrityErrors(episode, check).length, 1);
});
