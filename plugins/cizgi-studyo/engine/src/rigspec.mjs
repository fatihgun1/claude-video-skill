/**
 * Character rig specification (see docs/RIG-SPEC.md) and a checker for rig SVG files.
 * The checker works on the SVG text with regular expressions so it needs no DOM.
 */

/** Groups every rig must contain. */
export const REQUIRED_PARTS = Object.freeze([
  "root", "body", "head", "mouth",
  "eye_L", "eye_R", "eye_L_open", "eye_L_closed", "eye_R_open", "eye_R_closed",
  "arm_L_upper", "arm_L_lower", "hand_L",
  "arm_R_upper", "arm_R_lower", "hand_R",
  "leg_L", "leg_R",
]);

/** Groups the player rotates; each needs data-pivot="x,y". */
export const ROTATABLE_PARTS = Object.freeze([
  "body", "head", "arm_L_upper", "arm_L_lower", "hand_L",
  "arm_R_upper", "arm_R_lower", "hand_R", "leg_L", "leg_R",
]);

/** Optional rotatable parts. */
export const OPTIONAL_ROTATABLE = Object.freeze(["ear_L", "ear_R", "tail"]);

/** Mouth shapes, children of #mouth; exactly one is visible at a time. */
export const VISEMES = Object.freeze([
  "mouth_rest", "mouth_A", "mouth_E", "mouth_O", "mouth_U",
  "mouth_MBP", "mouth_FV", "mouth_L", "mouth_smile",
]);

/** Parent each part must be nested inside (direct or indirect). */
export const NESTING = Object.freeze({
  arm_L_lower: "arm_L_upper",
  hand_L: "arm_L_lower",
  arm_R_lower: "arm_R_upper",
  hand_R: "arm_R_lower",
  eye_L_open: "eye_L",
  eye_L_closed: "eye_L",
  eye_R_open: "eye_R",
  eye_R_closed: "eye_R",
  ...Object.fromEntries(VISEMES.map((v) => [v, "mouth"])),
});

const VIEWBOX = "0 0 1000 1000";

/** Remove comments and CDATA so markup inside them is not parsed. */
function stripComments(svg) {
  return svg.replace(/<!--[\s\S]*?-->/g, "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
}

/**
 * Parse <g> opening tags with their attributes and nesting path.
 * @param {string} svg
 * @returns {Map<string, {attrs: Record<string,string>, ancestors: string[]}> & {duplicates: string[]}}
 */
export function parseGroups(svg) {
  const groups = new Map();
  groups.duplicates = [];
  const stack = [];
  const tagRe = /<(\/?)g\b([^<>]*?)(\/?)>/g;
  let m;
  while ((m = tagRe.exec(stripComments(svg))) !== null) {
    const [, closing, attrText, selfClosing] = m;
    if (closing) {
      stack.pop();
      continue;
    }
    const attrs = Object.fromEntries(
      [...attrText.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((a) => [a[1], a[2] ?? a[3]]),
    );
    const id = attrs.id || null;
    if (id && groups.has(id)) groups.duplicates.push(id);
    if (id) groups.set(id, { attrs, ancestors: stack.filter(Boolean) });
    if (!selfClosing) stack.push(id);
  }
  return groups;
}

/**
 * Reject markup that could run code or fetch from the network when the page renders.
 * Library files may come from third parties, so this applies to rigs and backgrounds.
 * @param {string} svg
 * @returns {string[]}
 */
export function checkSvgSafety(svg) {
  const errors = [];
  const src = stripComments(svg);
  const banned = /<\s*(script|foreignObject|style|iframe|object|embed|image|link)\b/i.exec(src);
  if (banned) errors.push(`<${banned[1]}> is not allowed`);
  if (/\son[a-z]+\s*=/i.test(src)) errors.push("event handler attributes (on...=) are not allowed");
  if (/href\s*=\s*["'](?!#)/i.test(src)) errors.push("only #fragment href values are allowed");
  if (/url\(\s*['"]?(?!#)/i.test(src)) errors.push("only url(#fragment) references are allowed");
  return errors;
}

/**
 * Check a rig SVG against the specification.
 * @param {string} svg SVG source text
 * @returns {string[]} human-readable errors; empty when the rig is valid
 */
export function checkRig(svg) {
  const errors = checkSvgSafety(svg);
  const viewBox = /<svg\b[^>]*\bviewBox=["']([^"']+)["']/.exec(svg);
  if (!viewBox || viewBox[1].trim() !== VIEWBOX) {
    errors.push(`svg viewBox must be "${VIEWBOX}"`);
  }
  const groups = parseGroups(svg);
  for (const id of new Set(groups.duplicates)) errors.push(`group id #${id} is used twice`);
  for (const v of VISEMES) {
    const g = groups.get(v);
    if (!g) continue;
    const hidden = g.attrs.display === "none";
    if (v === "mouth_rest" && hidden) errors.push("#mouth_rest must be visible by default");
    if (v !== "mouth_rest" && !hidden) errors.push(`#${v} needs display="none"`);
  }

  for (const id of [...REQUIRED_PARTS, ...VISEMES]) {
    if (!groups.has(id)) errors.push(`missing group #${id}`);
  }
  for (const id of [...ROTATABLE_PARTS, ...OPTIONAL_ROTATABLE]) {
    const g = groups.get(id);
    if (!g) continue;
    if (!/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(g.attrs["data-pivot"] || "")) {
      errors.push(`#${id} needs data-pivot="x,y"`);
    }
  }
  for (const [id, g] of groups) {
    if (g.attrs.transform) errors.push(`#${id} must not have a transform attribute (the player owns transforms)`);
  }
  for (const [child, parent] of Object.entries(NESTING)) {
    const g = groups.get(child);
    if (g && !g.ancestors.includes(parent)) errors.push(`#${child} must be inside #${parent}`);
  }
  if (groups.has("root") && groups.get("root").ancestors.length > 0) {
    errors.push("#root must be the outermost group");
  }
  return errors;
}

/**
 * Prefix every id (and url(#id) / href="#id" reference) so several rigs can share one page.
 * @param {string} svgInner SVG markup without the outer <svg> element
 * @param {string} prefix
 * @returns {string}
 */
export function prefixIds(svgInner, prefix) {
  return svgInner
    .replace(/(?<![\w-])id=(["'])([^"']+)\1/g, (_, q, id) => `id=${q}${prefix}--${id}${q}`)
    .replace(/url\(\s*(['"]?)#([^)'"]+)\1\s*\)/g, (_, q, id) => `url(${q}#${prefix}--${id}${q})`)
    .replace(/href=(["'])#([^"']+)\1/g, (_, q, id) => `href=${q}#${prefix}--${id}${q}`);
}

/**
 * Return the markup inside the outer <svg> element.
 * @param {string} svg
 * @returns {string}
 */
export function svgInner(svg) {
  const m = /<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/.exec(svg.trim());
  if (!m) throw new Error("not an <svg> document");
  return m[1];
}
