// Measures how an action keeps its feet planted, using the runtime's own geometry.
// Usage (from the engine folder): node scripts/ayak-olc.mjs . <action id>
// The leg rest points are those of ela-profil; change LEGS for another rig.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [engine, id] = process.argv.slice(2);
await import(pathToFileURL(join(engine, "src/runtime/core.js")).href);
const C = globalThis.CizgiCore;
const action = JSON.parse(readFileSync(join(engine, "../library/actions", `${id}.json`), "utf8"));
const LEGS = { L: [[506, 778], [512, 842], [508, 904]], R: [[494, 778], [500, 842], [496, 904]] };
const WORLD_PER_RIG = 620 / 900;
const rows = [];
for (let t = 0; t <= action.duration + 1e-9; t += 1 / 30) {
  const p = C.sampleAction(action, t);
  const feet = Object.fromEntries(Object.entries(LEGS).map(([s, rest]) => {
    const g = C.hoseGeometry(rest, p[`leg_${s}_upper`] || 0, p[`leg_${s}_lower`] || 0, 0);
    return [s, [g.wrist[0], g.wrist[1] + (p.root_y || 0)]]; // ankle in the standing frame
  }));
  rows.push({ t, feet });
}
// For each frame, the lower foot is the one on the ground (if it is near the ground line).
const GROUND = 904;
let report = [];
for (let i = 1; i < rows.length; i++) {
  const a = rows[i - 1], b = rows[i];
  for (const s of ["L", "R"]) {
    const onGround = a.feet[s][1] > GROUND - 3 && b.feet[s][1] > GROUND - 3;
    if (onGround) report.push({ t: b.t.toFixed(3), s, vx: ((b.feet[s][0] - a.feet[s][0]) * 30 * WORLD_PER_RIG).toFixed(1), y: b.feet[s][1].toFixed(1) });
  }
}
const vx = report.map((r) => Number(r.vx));
console.log(`${id}: frames with a planted foot: ${report.length}/${rows.length - 1}`);
console.log(`foot speed backwards (world/s): mean ${(-vx.reduce((x, y) => x + y, 0) / (vx.length || 1)).toFixed(1)}, min ${(-Math.max(...vx)).toFixed(1)}, max ${(-Math.min(...vx)).toFixed(1)}`);
console.log("lowest ankle per frame:", rows.map((r) => Math.max(r.feet.L[1], r.feet.R[1]).toFixed(0)).join(" "));
