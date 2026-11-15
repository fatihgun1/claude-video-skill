// Scene decor (scene.dekor): library props standing in the scene, behind the characters.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadLibrary, checkProp } from "../src/library.mjs";
import { validateEpisode } from "../src/validate.mjs";
import { compileEpisode } from "../src/compile.mjs";

const LIB = fileURLToPath(new URL("../../library", import.meta.url));
const SOKAK = fileURLToPath(new URL("../../../../ornekler/sokak/bolum.json", import.meta.url));
const lib = loadLibrary(LIB);
const fresh = () => JSON.parse(readFileSync(SOKAK, "utf8"));

test("a prop needs a base; a grip only when someone will hold it", () => {
  assert.deepEqual(checkProp('<svg viewBox="0 0 10 10" data-base="5,10"><rect width="10" height="10"/></svg>').errors, []);
  assert.match(checkProp('<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>').errors.join(), /data-base/);
});

test("the park's tree, bench, lamp and slide are props of their own; none can be held", () => {
  for (const id of ["agac", "bank", "lamba", "kaydirak"]) {
    assert.ok(lib.props.has(id), id);
    assert.equal(lib.props.get(id).grip, null, `${id} has no grip`);
  }
  assert.ok(lib.props.get("plastik-sise").grip); // the bottle still can be held
});

test("decor names library props, with unique ids and values in range", () => {
  const ep = fresh();
  ep.scenes[1].dekor = [{ id: "agac1", prop: "agac", x: 200 }, { id: "bank1", prop: "bank", x: 1500, back: 0.3, olcek: 0.9, ters: true }];
  assert.deepEqual(validateEpisode(ep, lib).errors, []);
  ep.scenes[1].dekor.push({ id: "agac1", prop: "agac", x: 400 });
  assert.match(validateEpisode(ep, lib).errors.join("\n"), /agac1.*twice|iki kez/);
  ep.scenes[1].dekor = [{ id: "x", prop: "ejderha", x: 0 }];
  assert.match(validateEpisode(ep, lib).errors.join("\n"), /ejderha/);
  ep.scenes[1].dekor = [{ id: "x", prop: "agac", x: 99999 }];
  assert.equal(validateEpisode(ep, lib).ok, false);
});

test("in 9:16, decor moves toward the middle as the marks do, so it stays beside the character it was put by", () => {
  const ep = fresh();
  const { marks, portrait } = lib.world;
  ep.scenes[1].dekor = [{ id: "a", prop: "bank", x: marks.sol }, { id: "b", prop: "bank", x: marks.sag }, { id: "c", prop: "bank", x: marks.orta }];
  const out = mkdtempSync(join(tmpdir(), "cizgi-dekor-dikey-"));
  compileEpisode(SOKAK, lib, out, { episode: ep, missingAudio: "estimate", format: "9:16" });
  const html = readFileSync(join(out, "index.html"), "utf8");
  const xOf = (id) => Number(new RegExp(`id="dekor-s1--${id}" transform="translate\\(([\\d.-]+) `).exec(html)[1]);
  assert.equal(xOf("a"), portrait.marks.sol);
  assert.equal(xOf("b"), portrait.marks.sag);
  assert.equal(xOf("c"), portrait.marks.orta);
});

test("a prop with no grip cannot be held", () => {
  const ep = fresh();
  const shot = ep.scenes[1].shots.find((s) => s.props?.some((p) => p.holder));
  shot.props.find((p) => p.holder).prop = "bank";
  assert.match(validateEpisode(ep, lib).errors.join("\n"), /bank.*held|tutulamaz/);
});

test("compiled, each scene's decor stands in its own group behind the characters, scaled like them", () => {
  const ep = fresh();
  ep.scenes[1].dekor = [{ id: "agac1", prop: "agac", x: 200 }, { id: "bank1", prop: "bank", x: 1500, back: 1, ters: true }];
  const out = mkdtempSync(join(tmpdir(), "cizgi-dekor-"));
  compileEpisode(SOKAK, lib, out, { episode: ep, missingAudio: "estimate" });
  const html = readFileSync(join(out, "index.html"), "utf8");
  const group = html.indexOf('id="dekor-s1"');
  const firstChar = html.indexOf('id="kar-');
  assert.ok(group > 0 && group < firstChar, "decor before (behind) the characters");
  assert.match(html, /id="dekor-s1--agac1" transform="translate\(200 870\)/);
  // standing back: higher up the ground and smaller (cast.back's rule), mirrored by ters
  const bench = /id="dekor-s1--bank1" transform="translate\(1500 ([\d.]+)\) scale\((-[\d.]+) ([\d.]+)\)/.exec(html);
  assert.ok(bench, "bench transform");
  assert.ok(Number(bench[1]) < 870);
  assert.ok(Number(bench[2]) < 0 && Math.abs(Number(bench[2])) === Number(bench[3]));
  const data = JSON.parse(/window\.__CIZGI__ = (\{[\s\S]*?\});\s*<\/script>/.exec(html)[1]);
  assert.deepEqual(data.decor, ["s1"]);
  assert.equal(data.shots.find((s) => s.scene_id === "s1")?.scene_id, "s1");
});
