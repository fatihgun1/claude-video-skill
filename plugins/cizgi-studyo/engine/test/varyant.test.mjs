// Costume variants: one drawing, parts shown or hidden per variant (data-varyant / data-varyant-yok)
// and the variant's own colours (character.json varyantlar). A shot picks one with cast[].varyant,
// so the same person keeps their name, voice and timeline track.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import "../src/runtime/core.js";
import { loadLibrary } from "../src/library.mjs";
import { validateEpisode } from "../src/validate.mjs";
import { compileEpisode } from "../src/compile.mjs";

const C = globalThis.CizgiCore;
const LIB = fileURLToPath(new URL("../../library", import.meta.url));

/** A project copy of genc whose bag goes away in the variant "cantasiz", which also has a blue top. */
function project() {
  const root = mkdtempSync(join(tmpdir(), "cizgi-varyant-"));
  const dir = join(root, "kutuphane", "characters", "ali");
  mkdirSync(dir, { recursive: true });
  const svg = readFileSync(join(LIB, "characters", "genc", "rig.svg"), "utf8").replace(/<path (?=[^>]*var\(--bag)/g, '<path data-varyant-yok="cantasiz" ');
  writeFileSync(join(dir, "rig.svg"), svg);
  const meta = JSON.parse(readFileSync(join(LIB, "characters", "genc", "character.json"), "utf8"));
  meta.varyantlar = { cantasiz: { ad: { tr: "Çantasız" }, palette: { top: "#3a5f8a" } } };
  writeFileSync(join(dir, "character.json"), JSON.stringify(meta));
  mkdirSync(join(root, "bolumler", "a"), { recursive: true });
  return root;
}

const episode = (varyant) => ({
  episode: "varyant", language: "tr",
  characters: [{ id: "ali", rig: "ali", palette: { top: "#6f8f7a" } }],
  scenes: [{ scene_id: "s1", bg: "sokak", shots: [
    { shot_id: "s1_sh1", cast: [{ id: "ali", action: "bak", mark: "orta" }], camera: { framing: "wide", move: "static", target: "ali" }, hold: 1 },
    { shot_id: "s1_sh2", cast: [{ id: "ali", action: "bak", mark: "orta", ...(varyant ? { varyant } : {}) }], camera: { framing: "medium", move: "static", target: "ali" }, hold: 1 },
  ] }],
});

test("a part shows in the variants it names and hides in the ones it excludes", () => {
  assert.equal(C.partShown({ varyant: "temiz bayram" }, "temiz"), true);
  assert.equal(C.partShown({ varyant: "temiz" }, ""), false);
  assert.equal(C.partShown({ yok: "temiz" }, ""), true);
  assert.equal(C.partShown({ yok: "temiz" }, "temiz"), false);
  assert.equal(C.partShown({}, "temiz"), true);
});

test("a shot may pick a variant the drawing declares, nothing else", () => {
  const root = project();
  const lib = loadLibrary(LIB, { project: join(root, "kutuphane") });
  assert.deepEqual(lib.projectErrors, []);
  assert.equal(validateEpisode(episode("cantasiz"), lib).ok, true);
  const bad = validateEpisode(episode("bayramlik"), lib);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /bayramlik/.test(e) && /cantasiz/.test(e)), bad.errors.join("\n"));
  assert.equal(validateEpisode(episode("../x"), lib).ok, false);
});

test("a variant whose colours are not the drawing's colours is a library problem", () => {
  const root = project();
  const file = join(root, "kutuphane", "characters", "ali", "character.json");
  const meta = JSON.parse(readFileSync(file, "utf8"));
  meta.varyantlar.cantasiz.palette = { pelerin: "#f00" };
  writeFileSync(file, JSON.stringify(meta));
  const lib = loadLibrary(LIB, { project: join(root, "kutuphane") });
  assert.ok(lib.projectErrors.some((e) => /ali/.test(e) && /pelerin/.test(e)), lib.projectErrors.join("\n"));
});

test("the compiled film carries the variant parts and colours for the player", () => {
  const root = project();
  const lib = loadLibrary(LIB, { project: join(root, "kutuphane") });
  const path = join(root, "bolumler", "a", "bolum.json");
  writeFileSync(path, JSON.stringify(episode("cantasiz")));
  const out = join(root, "derle");
  compileEpisode(path, lib, out, { format: "16:9", missingAudio: "estimate" });
  const html = readFileSync(join(out, "index.html"), "utf8");
  assert.match(html, /data-varyant-yok="cantasiz"/);
  assert.match(html, /data-varyant-renk="[^"]*cantasiz[^"]*3a5f8a/);
  assert.match(html, /"varyant":"cantasiz"/, "the shot's cast tells the player which variant");
});
