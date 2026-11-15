/**
 * Backgrounds (mekânlar) in the library: either one SVG (backgrounds/<id>.svg) or a folder of
 * layers (backgrounds/<id>/mekan.json + one SVG per layer). A layer's depth says how far back it
 * is: 0 the farthest (sky), 1 the plane the characters stand on. When the camera moves inside a
 * shot, far layers move less (parallax); see CizgiCore.parallaxTransform.
 *
 *   mekan.json: {
 *     "ad": "Park",                                   a name for people (optional)
 *     "kaybolma": [960, 560],                         vanishing point for a dolly (optional)
 *     "katmanlar": [ { "id": "gok", "dosya": "gok.svg", "derinlik": 0 }, … ]   back to front
 *   }
 *
 * Every layer is a full-frame SVG with the world's viewBox, checked like any library SVG.
 * A one-file background counts as a single layer "tum" at depth 1, so scene layer settings
 * (scene.katmanlar) work for it too.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkSvgSafety, svgInner, prefixIds } from "./rigspec.mjs";
import { ID_PATTERN } from "./util.mjs";

export const SINGLE_LAYER = "tum";
const MAX_LAYERS = 8;
const FILE = /^[a-z0-9]+([_-][a-z0-9]+)*\.svg$/;

const viewBoxOf = (svg) => /<svg\b[^>]*\bviewBox=["']([^"']+)["']/.exec(svg)?.[1]?.trim().split(/[\s,]+/).map(Number) || null;

/**
 * Load one layered background folder.
 * @returns {{svg:string, layers:{id:string, derinlik:number, svg:string}[], name:string|null, errors:string[]}}
 *   svg: the layers drawn together in one SVG (thumbnails, fingerprints, the vanishing point)
 */
export function loadLayered(dir, id, world) {
  const errors = [];
  const where = `background ${id}`;
  let meta;
  try {
    meta = JSON.parse(readFileSync(join(dir, "mekan.json"), "utf8"));
  } catch (err) {
    return { svg: "", layers: [], name: null, errors: [`${where}: mekan.json okunamadı (${err.message})`] };
  }
  const list = Array.isArray(meta?.katmanlar) ? meta.katmanlar : [];
  if (!list.length || list.length > MAX_LAYERS) errors.push(`${where}: katmanlar 1-${MAX_LAYERS} öğelik bir liste olmalı`);
  const seen = new Set();
  const layers = [];
  for (const [i, k] of list.entries()) {
    const at = `${where} katman ${i + 1}`;
    if (!k || typeof k.id !== "string" || !ID_PATTERN.test(k.id)) {
      errors.push(`${at}: id küçük harf, rakam, - ya da _ olmalı`);
      continue;
    }
    if (seen.has(k.id)) errors.push(`${at}: "${k.id}" is used twice`);
    seen.add(k.id);
    if (!(typeof k.derinlik === "number" && k.derinlik >= 0 && k.derinlik <= 1)) errors.push(`${at}: derinlik 0 ile 1 arasında bir sayı olmalı`);
    if (typeof k.dosya !== "string" || !FILE.test(k.dosya)) {
      errors.push(`${at}: dosya bu klasörde bir .svg adı olmalı (${k.dosya})`);
      continue;
    }
    const path = join(dir, k.dosya);
    if (!existsSync(path)) {
      errors.push(`${at}: ${k.dosya} yok`);
      continue;
    }
    const svg = readFileSync(path, "utf8");
    for (const e of checkSvgSafety(svg)) errors.push(`${at} (${k.dosya}): ${e}`);
    const box = viewBoxOf(svg);
    if (!box || box[0] !== 0 || box[1] !== 0 || box[2] !== world.width || box[3] !== world.height) {
      errors.push(`${at} (${k.dosya}): viewBox "0 0 ${world.width} ${world.height}" olmalı`);
    }
    layers.push({ id: k.id, derinlik: k.derinlik, svg });
  }
  // rounded: the vanishing point is read back from the drawing as plain decimals
  const vp = Array.isArray(meta.kaybolma) && meta.kaybolma.length === 2 && meta.kaybolma.every((n) => Number.isFinite(n))
    ? meta.kaybolma.map((n) => Math.round(n * 100) / 100) : null;
  if (meta.kaybolma !== undefined && !vp) errors.push(`${where}: kaybolma [x, y] olmalı`);
  if (errors.length) return { svg: "", layers: [], name: null, errors };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${world.width} ${world.height}"${vp ? ` data-vp="${vp[0]},${vp[1]}"` : ""}>`
    // ids prefixed per layer: two layers may both name a gradient "gok"
    + layers.map((l) => `<g data-katman="${l.id}" data-derinlik="${l.derinlik}">${prefixIds(svgInner(l.svg), `k-${l.id}`)}</g>`).join("")
    + "</svg>";
  return { svg, layers, name: typeof meta.ad === "string" ? meta.ad.slice(0, 80) : null, errors: [] };
}

/** A one-file background as its single layer. */
export function singleLayer(svg) {
  return [{ id: SINGLE_LAYER, derinlik: 1, svg }];
}
