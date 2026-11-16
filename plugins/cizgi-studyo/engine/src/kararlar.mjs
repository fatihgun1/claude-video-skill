/**
 * The episode's decisions (kararlar): choices of taste the person makes before the script
 * is approved, recorded in bolum.json so the engine can tell a choice from a default.
 *
 *   format                 16:9 | 9:16 (top-level field)
 *   kararlar.boyut         2b | 3b   (3b also needs stil3d)
 *   kararlar.muzik         var | yok (var: episode.music is set)
 *   kararlar.efekt         var | yok (yok: no shot has sfx)
 *   kararlar.altyazi       var | yok (yok: altyazi.kapali)
 *
 * `eksik` (missing or contradicted) blocks the script approval; `uyarilar` only inform.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

export const DECISIONS = Object.freeze(["boyut", "muzik", "efekt", "altyazi"]);

const ASK = Object.freeze({
  format: "not chosen; ask the person: 16:9 or 9:16",
  boyut: "not chosen; ask the person: 2D or 3D (kararlar.boyut)",
  muzik: "not chosen; ask the person: background music or none (kararlar.muzik)",
  efekt: "not chosen; ask the person: sound effects or none (kararlar.efekt)",
  altyazi: "not chosen; ask the person: captions on or off (kararlar.altyazi)",
});

const shotsOf = (episode) => episode.scenes.flatMap((s) => s.shots);

function contradictions(episode, k) {
  const out = [];
  if (k.boyut === "3b" && !episode.stil3d) out.push("stil3d: a 3D episode needs its look; ask the person: toon, yumusak, pastel or golge");
  if (k.muzik === "var" && !episode.music) out.push("muzik: the person chose music but none is set (music.track)");
  if (k.muzik === "yok" && episode.music) out.push("muzik: the person chose no music but music is set");
  const hasSfx = shotsOf(episode).some((s) => (s.sfx || []).length);
  if (k.efekt === "yok" && hasSfx) out.push("efekt: the person chose no sound effects but some shots have sfx");
  const off = episode.altyazi?.kapali === true;
  if (k.altyazi === "yok" && !off) out.push("altyazi: the person chose no captions but altyazi.kapali is not set");
  if (k.altyazi === "var" && off) out.push("altyazi: the person chose captions but altyazi.kapali is set");
  return out;
}

function missing3d(episode, lib) {
  const has = (kind, id) => existsSync(join(lib.dir, "3d", kind, `${id}.json`));
  const rigs = [...new Set(episode.characters.map((c) => c.rig))].filter((r) => !has("karakterler", r));
  const bgs = [...new Set(episode.scenes.map((s) => s.bg))].filter((b) => !has("mekanlar", b));
  return [
    ...rigs.map((r) => `boyut: character "${r}" has no 3D recipe (library/3d/karakterler/${r}.json); a 3D render will be refused`),
    ...bgs.map((b) => `boyut: place "${b}" has no 3D recipe (library/3d/mekanlar/${b}.json); a 3D render will be refused`),
  ];
}

/**
 * @param {object} episode a schema-valid episode
 * @param {{dir: string}} lib
 * @returns {{eksik: string[], uyarilar: string[]}}
 */
export function decisionProblems(episode, lib) {
  const k = episode.kararlar || {};
  const eksik = [
    ...(episode.format ? [] : [`format: ${ASK.format}`]),
    ...DECISIONS.filter((d) => !k[d]).map((d) => `${d}: ${ASK[d]}`),
    ...contradictions(episode, k),
  ];
  const uyarilar = k.boyut === "3b" ? missing3d(episode, lib) : [];
  return { eksik, uyarilar };
}

/** Throw unless every decision is recorded and the episode agrees with them. */
export function requireDecisions(episode, lib) {
  const { eksik } = decisionProblems(episode, lib);
  if (!eksik.length) return;
  throw new Error(`the person's decisions are not complete (kararlar). Ask them, record the answers in bolum.json, then show the script again:\n- ${eksik.join("\n- ")}`);
}
