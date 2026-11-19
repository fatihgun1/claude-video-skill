/**
 * A pose as a whole (Faz 3.6): the joints were checked one by one, so broken poses passed — a child's
 * bend on a grown-up drawing lifted the feet 184 units into the air, a grown-up's action on the child
 * drawing pushed them 250 units into the ground. With the rig's own legs (data-hose: hip, knee,
 * ankle) the lower foot of every key is worked out and must stand on the ground, within FOOT_SLACK,
 * unless the action says the body rests on something else: temas "oturma" (sitting), "yatma" (lying),
 * "havada" (in the air), for the whole action or for one key.
 */
import { parseGroups, LEGS } from "./rigspec.mjs";
import "./runtime/core.js";

export const FOOT_SLACK = 25; // rig units the lower foot may be off the ground
// resting on something (temas), the feet may leave the ground, but not sink this far into it: the
// child drawing in a grown-up's sitting pose had them 128 units under the floor
export const CONTACT_SINK = 60;
export const CONTACTS = Object.freeze(["oturma", "yatma", "havada"]);

/** The rest legs of a rig ([[hip], [knee], [ankle]] per leg), or null when its legs are not hoses. */
function legsOf(rig) {
  const g = parseGroups(rig.svg);
  const legs = LEGS.map((id) => g.get(id)?.attrs["data-hose"]).filter(Boolean).map((h) => h.trim().split(/\s+/).map((p) => p.split(",").map(Number)));
  return legs.length === LEGS.length && legs.every((l) => l.length === 3 && l.flat().every(Number.isFinite)) ? legs : null;
}

/**
 * How far the lower foot is from the ground at each key (rig units: + into the ground, - above it),
 * with what the body rests on instead (temas); null when the rig's legs cannot be worked out.
 * @returns {{t:number, d:number, temas:string|null}[]|null}
 */
export function footOffsets(action, rig) {
  const legs = legsOf(rig);
  if (!legs) return null;
  const C = globalThis.CizgiCore;
  return action.keys
    .map((k) => {
      const p = k.pose || {};
      const d = LEGS.map((id, i) => C.hoseGeometry(legs[i], p[`${id}_upper`] || 0, p[`${id}_lower`] || 0, p[`${id}_lift`] || 0).wrist[1] + (p.root_y || 0) - legs[i][2][1]);
      return { t: k.t, d: Math.round(Math.max(...d)), temas: k.temas || action.temas || null }; // the lower foot carries the body
    });
}

/** The worst key off the ground for this action on this rig, or null when every key stands. */
export function brokenFoot(action, rig) {
  const offs = footOffsets(action, rig);
  if (!offs) return null;
  const bad = offs.filter((o) => (o.temas ? o.d > CONTACT_SINK : Math.abs(o.d) > FOOT_SLACK));
  return bad.length ? bad.reduce((a, b) => (Math.abs(b.d) > Math.abs(a.d) ? b : a)) : null;
}

const say = (id, b) => `at ${b.t}s the feet ${b.d > 0 ? `go ${b.d} units into the ground` : `float ${-b.d} units above it`}`;

/** Errors of a draft action on the rigs it is made for (action.for), for the draft check. */
export function draftPoseErrors(action, lib) {
  return (Array.isArray(action.for) ? action.for : []).flatMap((rid) => {
    const rig = lib.characters.get(rid);
    if (!rig) return [`for: "${rid}" diye bir karakter çizimi yok`];
    const b = brokenFoot(action, rig);
    return b ? [`"${rid}" çiziminde ${b.t}. saniyede ayaklar ${b.d > 0 ? `${b.d} birim yerin içine giriyor` : `yerden ${-b.d} birim havada`}; pozu düzelt ya da gövde başka bir yere dayanıyorsa temas yaz (oturma, yatma, havada)`] : [];
  });
}

/** Each drawing and action pair of the episode whose feet leave the ground, once, on its first shot. */
export function poseWarnings(episode, lib) {
  const seen = new Set();
  const out = [];
  const rigOf = Object.fromEntries(episode.characters.map((c) => [c.id, c.rig]));
  for (const shot of episode.scenes.flatMap((sc) => sc.shots)) {
    for (const m of shot.cast) {
      for (const aid of [m.action, ...(m.actions || []).map((a) => a.action)]) {
        const key = `${rigOf[m.id]}|${aid}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const rig = lib.characters.get(rigOf[m.id]);
        const action = lib.actions.get(aid);
        const b = rig && action ? brokenFoot(action, rig) : null;
        if (b) out.push(`film: shot ${shot.shot_id}: "${m.id}" (${rigOf[m.id]}) in "${aid}": ${say(m.id, b)}; use an action made for this drawing, fix the pose, or declare temas (oturma, yatma, havada) on the action`);
      }
    }
  }
  return out;
}
