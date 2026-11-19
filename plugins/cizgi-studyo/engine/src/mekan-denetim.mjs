/**
 * What a background (mekân) may hold. A background is the place; people and the things the story
 * uses are drawn apart (characters, props), so they can move, be taken, and are not drawn twice.
 * Hurda Kralı 1: two scrap dealers and two scales, one painted into the alley and one as a prop.
 *
 *   paintedIn      people and usable things named in a drawing (its comments, titles, ids, classes)
 *   farLayerNotes  a far layer that is nearly empty (the houses with nothing behind them)
 *   copiedFarLayers the same far layer reused by different places
 *
 * A background may declare things it shows on purpose as fixed scenery: mekan.json "icerik":
 * ["tabela", ...]; a usable thing declared there is not refused (a person never is).
 */
import { createHash } from "node:crypto";
import { episodeBgs, shotBg } from "./arka-plan.mjs";

// Turkish word starts (suffixes follow: oturanlar, kantarı) and whole English words: people, and
// things a story picks up, weighs, carries. "where people stand" says where characters go: not listed.
const PEOPLE = ["adam", "kadın", "kadin", "insan", "kişi", "kisi", "oturan", "çocuk", "cocuk", "satıcı", "satici", "yolcu", "figür", "figur"];
const PEOPLE_EN = ["man", "men", "woman", "women", "person", "persons", "child", "children", "vendor", "vendors", "passer-by", "passers-by"];
const USABLE = ["kantar", "terazi", "çuval", "cuval", "poşet", "poset", "çanta", "canta", "şişe", "sise", "bavul"];
const USABLE_EN = ["scale", "scales", "sack", "sacks", "bottle", "bottles", "handbag", "handbags"];
const LETTER = "a-zçğıöşüâîû";
const wordsRe = (list, whole) => new RegExp(`(?:^|[^${LETTER}])(${list.join("|")})${whole ? `(?![${LETTER}])` : ""}`, "giu");

const FAR_MAX_DEPTH = 0.5; // layers between the sky (0) and here are the far ones
const FAR_MIN_SHAPES = 60; // fewer drawn shapes than this: the far layer is nearly empty…
const FAR_MIN_BYTES = 6000; // …and this small (dar-sokak: 28 shapes, 2 KB)
const SHAPES = /<(path|rect|polygon|circle|ellipse|polyline|line)\b/g;

/** The words a drawing says about itself: comments, title/desc, id and class values. */
function selfText(svg) {
  const parts = [];
  for (const m of svg.matchAll(/<!--([\s\S]*?)-->/g)) parts.push(m[1]);
  for (const m of svg.matchAll(/<(title|desc)\b[^>]*>([\s\S]*?)<\/\1>/g)) parts.push(m[2]);
  for (const m of svg.matchAll(/\b(id|class)="([^"]*)"/g)) parts.push(m[2].replace(/[-_]/g, " "));
  return parts.join(" \n ").toLocaleLowerCase("tr");
}

const found = (text, tr, en) => [...new Set([...text.matchAll(wordsRe(tr, false)), ...text.matchAll(wordsRe(en, true))].map((m) => m[1].toLocaleLowerCase("tr")))];

/** Things a background declares on purpose (mekan.json icerik, carried as data-icerik on its svg). */
export const declaredIn = (svg) => (/\bdata-icerik="([^"]*)"/.exec(svg || "")?.[1] || "").split(",").map((x) => x.trim().toLocaleLowerCase("tr")).filter(Boolean);

/**
 * People and undeclared usable things named in a background's drawings.
 * @param {string[]} svgs the layers (or the one file)
 * @param {string[]} [icerik] declared fixed scenery
 * @returns {{people:string[], things:string[]}}
 */
export function paintedIn(svgs, icerik = []) {
  const text = svgs.map(selfText).join(" \n ");
  const declared = icerik.map((x) => x.toLocaleLowerCase("tr"));
  return { people: found(text, PEOPLE, PEOPLE_EN), things: found(text, USABLE, USABLE_EN).filter((w) => !declared.some((d) => d.startsWith(w) || w.startsWith(d))) };
}

/** Problems of a background draft that refuse it (people and undeclared usable things). */
export function backgroundDraftErrors(svgs, icerik = []) {
  const { people, things } = paintedIn(svgs, icerik);
  const out = [];
  if (people.length) out.push(`arka planda insan çizilmiş (${people.join(", ")}): insanlar karakter olarak ayrı çizilir; arka plandan çıkar`);
  if (things.length) out.push(`arka planda kullanılabilir nesne çizilmiş (${things.join(", ")}): hikâyede kullanılacaksa nesne (prop) olarak ayrı çiz ve arka plandan çıkar; yalnızca sabit görüntüyse mekan.json "icerik" listesine yaz`);
  return out;
}

const far = (layers) => layers.filter((l) => l.derinlik > 0 && l.derinlik < FAR_MAX_DEPTH);
const sha = (s) => createHash("sha256").update(s).digest("hex");

/** A far layer that is nearly empty: few shapes and a small file. */
export function farLayerNotes(id, layers) {
  return far(layers)
    .filter((l) => (l.svg.match(SHAPES) || []).length < FAR_MIN_SHAPES && l.svg.length < FAR_MIN_BYTES)
    .map((l) => `background ${id}: the far layer "${l.id}" is nearly empty (${(l.svg.match(SHAPES) || []).length} shapes, ${Math.round(l.svg.length / 1000)} KB); what lies behind the houses shows as empty sky: draw the rooftops, trees and buildings beyond`);
}

/**
 * Far layers drawn once and reused by different places (ids that are not one a variant of the
 * other, as dar-sokak and dar-sokak-hurdaci are).
 * @param {Map<string, {id:string, derinlik:number, svg:string}[]>} layersOf
 * @param {string[]} ids the backgrounds to look at
 */
export function copiedFarLayers(layersOf, ids) {
  const byHash = new Map();
  for (const id of ids) for (const l of far(layersOf.get(id) || [])) {
    const h = sha(l.svg);
    byHash.set(h, [...(byHash.get(h) || []), id]);
  }
  const variant = (a, b) => a.startsWith(`${b}-`) || b.startsWith(`${a}-`);
  const out = [];
  for (const group of byHash.values()) {
    const places = [...new Set(group)];
    const apart = places.filter((a) => places.some((b) => a !== b && !variant(a, b)));
    if (apart.length >= 2) out.push(`backgrounds ${apart.join(", ")}: the same far layer in different places; give each its own skyline`);
  }
  return out;
}

const MIN_MOVING = 2; // an outdoor place with fewer moving pieces than this looks like a photograph

/**
 * The episode's places, warned about (they are in the library already; a draft is refused instead):
 * people or usable things painted in, a thing painted in and also on stage (drawn twice), a nearly
 * empty or copied far layer, and an outdoor scene where nothing moves.
 */
export function placeWarnings(episode, lib) {
  const out = [];
  const ids = episodeBgs(episode).filter((id) => lib.layers?.has(id));
  for (const id of ids) {
    const layers = lib.layers.get(id);
    const { people, things } = paintedIn(layers.map((l) => l.svg || ""), declaredIn(lib.backgrounds.get(id)));
    if (people.length) out.push(`background ${id}: people are painted into the place (${people.join(", ")}); they cannot move or speak and stand where a character may: draw the place without them`);
    if (things.length) out.push(`background ${id}: usable things are painted into the place (${things.join(", ")}); a thing the story uses is a prop, else list it in mekan.json "icerik"`);
    out.push(...farLayerNotes(id, layers));
  }
  out.push(...copiedFarLayers(lib.layers || new Map(), ids));
  for (const scene of episode.scenes) {
    const bgs = [...new Set(scene.shots.map((s) => shotBg(scene, s)))].filter((id) => lib.layers?.has(id));
    // a thing painted in and also placed on stage: two of it on screen
    const painted = new Set(bgs.flatMap((id) => paintedIn(lib.layers.get(id).map((l) => l.svg || "")).things));
    const staged = [...(scene.dekor || []).map((d) => d.prop), ...scene.shots.flatMap((s) => (s.props || []).map((p) => p.prop))];
    const twice = [...painted].filter((w) => staged.some((p) => p.toLocaleLowerCase("tr").startsWith(w) || w.startsWith(p.split("-")[0])));
    if (twice.length) out.push(`film: shot ${scene.shots[0].shot_id}: ${twice.join(", ")} is painted into the background and also placed in scene ${scene.scene_id}: it shows twice; take it out of the background`);
    // outdoors (a sky layer) with nothing moving: no passer-by, no leaves, no car
    const outdoor = bgs.some((id) => lib.layers.get(id).some((l) => l.derinlik === 0));
    const moving = (scene.dekor || []).filter((d) => d.akis && (d.akis.dx || d.akis.back)).length;
    if (outdoor && moving < MIN_MOVING) {
      out.push(`film: shot ${scene.shots[0].shot_id}: scene ${scene.scene_id} is outdoors but ${moving ? "only one thing moves" : "nothing moves"} in it (decor with akis: a passer-by, a car, a cat, leaves); give it at least ${MIN_MOVING} so the street is alive`);
    }
  }
  return out;
}
