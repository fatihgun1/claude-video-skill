/**
 * Character rig specification (see docs/RIG-SPEC.md) and a checker for rig SVG files.
 * The checker works on the SVG text with regular expressions so it needs no DOM.
 */

/**
 * Arms are "hoses": one continuous stroke from shoulder through elbow to wrist, redrawn
 * every frame, so no joint seam is ever visible. Each hose group has
 *   data-hose="sx,sy ex,ey wx,wy"   rest-pose shoulder, elbow and wrist
 * and two <path> children: class="hose-line" (outline) and class="hose-fill".
 * Pose channels <arm>_upper / <arm>_lower bend it; the hand group follows the wrist.
 */
export const HOSES = Object.freeze(["arm_L", "arm_R"]);

/**
 * Legs are either one rotating group (data-pivot = hip, channel leg_L) or, for rigs that
 * need knees, a hose like the arms (data-hose = hip knee ankle, channels leg_L_upper /
 * leg_L_lower) with a foot_L group (data-pivot = ankle, channel foot_L) following the ankle.
 */
export const LEGS = Object.freeze(["leg_L", "leg_R"]);

/** End group that follows each hose: the hand of an arm, the foot of a leg. */
export const HOSE_END = Object.freeze({ arm_L: "hand_L", arm_R: "hand_R", leg_L: "foot_L", leg_R: "foot_R" });

/** Groups every rig must contain. */
export const REQUIRED_PARTS = Object.freeze([
  "root", "body", "head", "mouth",
  "eye_L", "eye_R", "eye_L_open", "eye_L_closed", "eye_R_open", "eye_R_closed",
  "arm_L", "hand_L", "arm_R", "hand_R",
  "leg_L", "leg_R",
]);

/** Groups the player rotates; each needs data-pivot="x,y" (legs only when they are not hoses). */
export const ROTATABLE_PARTS = Object.freeze(["body", "head", "hand_L", "hand_R", "leg_L", "leg_R"]);

/**
 * Optional rotatable parts. body_back is a second layer of the body drawn behind the legs
 * (far arm, backpack in a profile view); it turns with the "body" channel around its own pivot.
 */
export const OPTIONAL_ROTATABLE = Object.freeze(["ear_L", "ear_R", "tail", "body_back"]);

/** Parts that may sit in body_back instead of body. */
const BACK_LAYER_OK = new Set(["arm_L", "arm_R"]);

/** Every pose channel an action may use. */
export const POSE_CHANNELS = Object.freeze([
  ...ROTATABLE_PARTS, ...OPTIONAL_ROTATABLE.filter((p) => p !== "body_back"),
  ...[...HOSES, ...LEGS].flatMap((h) => [`${h}_upper`, `${h}_lower`]),
  "foot_L", "foot_R",
  "leg_L_lift", "leg_R_lift",
  "gaze_x", "gaze_y",
  "grip_L", "grip_R",
  "root_y", "root_sx", "root_sy",
]);

/**
 * Optional hand shapes. A hand may contain
 *   hand_L_slot  (empty, self-closing) where a held prop is drawn: shapes before it are behind the prop
 *   hand_L_open  fingers open (visible by default)
 *   hand_L_grip  fingers closed around what it holds (display="none")
 * Channel grip_L >= 0.5 shows the grip, else the open hand.
 */
export const HAND_SHAPES = Object.freeze(["hand_L_open", "hand_L_grip", "hand_R_open", "hand_R_grip"]);

/** Mouth shapes, children of #mouth; exactly one is visible at a time. */
export const VISEMES = Object.freeze([
  "mouth_rest", "mouth_A", "mouth_E", "mouth_O", "mouth_U",
  "mouth_MBP", "mouth_FV", "mouth_L", "mouth_smile",
]);

/** Parent each part must be nested inside (direct or indirect). */
export const NESTING = Object.freeze({
  hand_L: "arm_L",
  hand_R: "arm_R",
  arm_L: "body",
  arm_R: "body",
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
  // <s:script> with its own namespace prefix is still a script: no prefixed element names at all
  const prefixed = /<\s*([a-z_][\w.-]*):[\w.-]+/i.exec(src);
  if (prefixed) errors.push(`prefixed element names (<${prefixed[1]}:…>) are not allowed`);
  // an animation can set an attribute (href → javascript:, or an event) after the check
  if (/<\s*(set|animate|animateMotion|animateTransform|animateColor)\b[^>]*\battributeName\s*=\s*["'][^"']*(href|^on|:on)/i.test(src)
    || /<\s*(set|animate)\b[^>]*\battributeName\s*=\s*["']\s*on/i.test(src)) {
    errors.push("animations may not change links or event attributes");
  }
  if (/javascript\s*:/i.test(src)) errors.push("javascript: is not allowed");
  if (/\son[a-z]+\s*=/i.test(src)) errors.push("event handler attributes (on...=) are not allowed");
  if (/href\s*=\s*["'](?!#)/i.test(src)) errors.push("only #fragment href values are allowed");
  if (/url\(\s*['"]?(?!#)/i.test(src)) errors.push("only url(#fragment) references are allowed");
  return errors;
}

/** Markup from a group's opening tag up to its first nested <g> (its own direct shapes). */
function hoseBody(svg, id) {
  const start = new RegExp(`<g\\b[^>]*\\bid=["']${id}["'][^>]*>`).exec(stripComments(svg));
  if (!start) return "";
  const rest = stripComments(svg).slice(start.index + start[0].length);
  const stop = rest.search(/<\/?g\b/);
  return stop < 0 ? rest : rest.slice(0, stop);
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
  const hoseLegs = LEGS.filter((id) => groups.get(id)?.attrs["data-hose"] !== undefined);
  const pivoted = [...ROTATABLE_PARTS, ...OPTIONAL_ROTATABLE, ...hoseLegs.map((l) => HOSE_END[l])].filter((id) => !hoseLegs.includes(id));
  for (const id of pivoted) {
    const g = groups.get(id);
    if (!g) {
      if (hoseLegs.some((l) => HOSE_END[l] === id)) errors.push(`missing group #${id} (a hose leg needs a foot)`);
      continue;
    }
    if (!/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(g.attrs["data-pivot"] || "")) {
      errors.push(`#${id} needs data-pivot="x,y"`);
    }
  }
  for (const leg of hoseLegs) {
    const foot = groups.get(HOSE_END[leg]);
    if (foot && !foot.ancestors.includes(leg)) errors.push(`#${HOSE_END[leg]} must be inside #${leg}`);
  }
  const NUM = "-?\\d+(?:\\.\\d+)?";
  const hoseRe = new RegExp(`^${NUM},${NUM} ${NUM},${NUM} ${NUM},${NUM}$`);
  for (const id of [...HOSES, ...hoseLegs]) {
    const g = groups.get(id);
    if (!g) continue;
    if (!hoseRe.test((g.attrs["data-hose"] || "").trim())) errors.push(`#${id} needs data-hose="sx,sy ex,ey wx,wy"`);
    const body = hoseBody(svg, id);
    for (const cls of ["hose-line", "hose-fill"]) {
      if (!new RegExp(`<path\\b[^>]*class=["']${cls}["']`).test(body)) errors.push(`#${id} needs a <path class="${cls}">`);
    }
  }
  for (const [id, g] of groups) {
    if (g.attrs.transform) errors.push(`#${id} must not have a transform attribute (the player owns transforms)`);
  }
  for (const [child, parent] of Object.entries(NESTING)) {
    const g = groups.get(child);
    const inBack = parent === "body" && BACK_LAYER_OK.has(child) && g?.ancestors.includes("body_back");
    if (g && !g.ancestors.includes(parent) && !inBack) errors.push(`#${child} must be inside #${parent}`);
  }
  for (const id of [...HAND_SHAPES, "hand_L_slot", "hand_R_slot"]) {
    const g = groups.get(id);
    if (!g) continue;
    const hand = id.slice(0, 6);
    if (!g.ancestors.includes(hand)) errors.push(`#${id} must be inside #${hand}`);
    if (id.endsWith("_grip") && g.attrs.display !== "none") errors.push(`#${id} needs display="none"`);
  }
  const back = groups.get("body_back");
  if (back && back.ancestors.join() !== "root") errors.push("#body_back must be a direct child of #root");
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
