import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import "../src/runtime/core.js";
import { checkRig, slidingDetails } from "../src/rigspec.mjs";
import { loadLibrary } from "../src/library.mjs";
import { compileEpisode } from "../src/compile.mjs";

const C = globalThis.CizgiCore;
const REST = [[500, 280], [505, 410], [508, 545]]; // an arm hanging down, as in the rigs
const FILL = 47;
const BAND = 18;

const points = (d) => [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);

/** Distance from p to the hose's quadratic curve (dense samples). */
function distToHose(geo, p) {
  let best = Infinity;
  for (let i = 0; i <= 400; i++) {
    const t = i / 400;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    const x = a * geo.start[0] + b * geo.ctrl[0] + c * geo.wrist[0];
    const y = a * geo.start[1] + b * geo.ctrl[1] + c * geo.wrist[1];
    best = Math.min(best, Math.hypot(p[0] - x, p[1] - y));
  }
  return best;
}

const POSES = [
  [0, 0], [0, 90], [0, 150], [-60, -120], [180, 0], [120, 60], [-40, 0], [90, -100],
];

test("hose shade: the band stays inside the fill in every bend, facing and body turn", () => {
  for (const [upper, lower] of POSES) {
    const geo = C.hoseGeometry(REST, upper, lower, 0);
    for (const flip of [1, -1]) {
      for (const turn of [0, 35, -50]) {
        const band = C.hoseShade(geo, FILL, BAND, C.shadeLight(flip, turn));
        assert.ok(band.width >= 0 && band.width <= BAND + 1e-9);
        for (const p of points(band.d)) {
          const dist = distToHose(geo, p);
          // each point sits k = R - width/2 from the curve, so the band's outer edge is on the fill's edge
          assert.ok(dist + band.width / 2 <= FILL / 2 + 0.2, `pose ${upper},${lower} flip ${flip} turn ${turn}: ${dist} + ${band.width / 2}`);
        }
      }
    }
  }
});

test("hose shade: the band follows the bend from shoulder to wrist", () => {
  for (const [upper, lower] of POSES) {
    const geo = C.hoseGeometry(REST, upper, lower, 0);
    const band = C.hoseShade(geo, FILL, BAND, C.shadeLight(1, 0));
    const pts = points(band.d);
    const k = FILL / 2 - band.width / 2;
    const first = pts[0];
    const last = pts[pts.length - 1];
    assert.ok(Math.abs(Math.hypot(first[0] - geo.start[0], first[1] - geo.start[1]) - k) < 0.2, "starts beside the shoulder");
    assert.ok(Math.abs(Math.hypot(last[0] - geo.wrist[0], last[1] - geo.wrist[1]) - k) < 0.2, "ends beside the wrist");
    // the middle of the band is beside the middle of the curve, not where the rest pose had it
    const mid = pts[Math.floor(pts.length / 2)];
    assert.ok(distToHose(geo, mid) < k + 0.2);
  }
  const bent = C.hoseShade(C.hoseGeometry(REST, 0, 90, 0), FILL, BAND, C.shadeLight(1, 0));
  const straight = C.hoseShade(C.hoseGeometry(REST, 0, 0, 0), FILL, BAND, C.shadeLight(1, 0));
  assert.notEqual(bent.d, straight.d, "redrawn for each bend");
});

test("hose shade: on the side away from the light (upper left of the screen), in both facings", () => {
  const geo = C.hoseGeometry(REST, 0, 0, 0); // hanging down
  const right = C.hoseShade(geo, FILL, BAND, C.shadeLight(1, 0));
  const mid = points(right.d)[8];
  assert.ok(mid[0] > 506, "facing right: the band is on the right (screen right) of the arm");
  assert.equal(right.width, BAND);
  // mirrored rig: drawing x flips on screen, so the band moves to the drawing's left = screen right again
  const mirrored = C.hoseShade(geo, FILL, BAND, C.shadeLight(-1, 0));
  assert.ok(points(mirrored.d)[8][0] < 506, "facing left: drawn on the rig's left, which the mirror puts on screen right");
  // an arm raised straight up keeps its shade on the screen-right side too
  const up = C.hoseGeometry(REST, 180, 0, 0);
  const upBand = C.hoseShade(up, FILL, BAND, C.shadeLight(1, 0));
  assert.ok(points(upBand.d)[8][0] > 500);
});

test("hose shade: when the limb points along the light the band narrows to nothing instead of jumping sides", () => {
  // light from upper left: an arm pointing to the lower right lies along it
  const geo = C.hoseGeometry([[0, 0], [0, 100], [0, 200]], -45, 0, 0);
  const band = C.hoseShade(geo, FILL, BAND, C.shadeLight(1, 0));
  assert.ok(band.width < 0.5, `width ${band.width}`);
  // and the width changes smoothly as the arm swings through that direction
  let prev = null;
  for (let a = -70; a <= -20; a += 1) {
    const w = C.hoseShade(C.hoseGeometry([[0, 0], [0, 100], [0, 200]], a, 0, 0), FILL, BAND, C.shadeLight(1, 0)).width;
    if (prev != null) assert.ok(Math.abs(w - prev) < 2.5, `jump at ${a}°: ${prev} → ${w}`);
    prev = w;
  }
});

test("hose shade: the body's turn is taken into account", () => {
  const geo = C.hoseGeometry(REST, 0, 0, 0);
  // the body turned -90° (counter-clockwise): the hanging arm points to the screen's right and its
  // drawing +x side faces the screen's top, toward the light, so the band goes to the drawing's -x side
  const a = points(C.hoseShade(geo, FILL, BAND, C.shadeLight(1, 0)).d)[8][0];
  const b = points(C.hoseShade(geo, FILL, BAND, C.shadeLight(1, -90)).d)[8][0];
  assert.ok(a > 506 && b < 506, `${a} ${b}`);
});

const library = fileURLToPath(new URL("../../library", import.meta.url));
const genc = readFileSync(join(library, "characters", "genc", "rig.svg"), "utf8");

test("rig check: hose-shade is a redrawn path, not a sliding detail; a real detail is still refused", () => {
  assert.match(genc, /class="hose-shade"/, "the library's profile rig has shade bands");
  assert.deepEqual(checkRig(genc), []);
  assert.deepEqual(slidingDetails(genc), []);
  const patched = genc.replace(/(<path class="hose-shade")/, '<rect x="520" y="400" width="20" height="20" fill="#863"/>$1');
  assert.ok(slidingDetails(patched).some((e) => /#arm_R bends/.test(e)), "the first hose-shade is on the far arm");
  // a band needs its width, no wider than the fill
  const noWidth = genc.replace(/(<path class="hose-shade"[^>]*?) stroke-width="[\d.]+"/, "$1");
  assert.ok(checkRig(noWidth).some((e) => /hose-shade.*stroke-width/.test(e)), checkRig(noWidth).join("\n"));
  const wide = genc.replace(/(<path class="hose-shade"[^>]*?) stroke-width="[\d.]+"/, '$1 stroke-width="200"');
  assert.ok(checkRig(wide).some((e) => /wider than the hose-fill/.test(e)));
});

test("every human rig of the plugin's library shades its hose arms", () => {
  for (const id of readdirSync(join(library, "characters"))) {
    const svg = readFileSync(join(library, "characters", id, "rig.svg"), "utf8");
    if (!/data-hose/.test(svg) || id === "pamuk") continue;
    assert.deepEqual(checkRig(svg), [], id);
    assert.ok((svg.match(/class="hose-shade"/g) || []).length >= 2, `${id} shades both arms`);
  }
});

test("a rig with shades compiles and its bands are in the page, inside their limbs", () => {
  const dir = mkdtempSync(join(tmpdir(), "cizgi-golge-"));
  mkdirSync(join(dir, "ses"));
  const episode = {
    episode: "golge",
    title: "Gölge",
    language: "tr",
    characters: [{ id: "genc", rig: "genc" }],
    scenes: [{
      scene_id: "s1",
      bg: "park",
      shots: [{ shot_id: "s1_sh1", cast: [{ id: "genc", action: "otur", mark: "orta", facing: "sol" }], camera: { framing: "wide" } }],
    }],
  };
  writeFileSync(join(dir, "bolum.json"), JSON.stringify(episode));
  const out = join(dir, "proje");
  compileEpisode(join(dir, "bolum.json"), loadLibrary(library), out, { format: "9:16" });
  const html = readFileSync(join(out, "index.html"), "utf8");
  const arm = /<g id="genc--arm_L"[^>]*>([\s\S]*?)<g\b/.exec(html);
  assert.ok(arm, "the arm is in the page");
  assert.match(arm[1], /class="hose-fill"[\s\S]*class="hose-shade"/, "the band is drawn over the fill, before the hand");
  const player = readFileSync(join(out, "runtime", "player.js"), "utf8");
  assert.match(player, /path\.hose-shade/);
  const core = readFileSync(join(out, "runtime", "core.js"), "utf8");
  assert.match(core, /function hoseShade/);
});
