import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkRig, parseGroups, prefixIds, svgInner } from "../src/rigspec.mjs";

const rig = readFileSync(new URL("../../library/characters/test-ayi/rig.svg", import.meta.url), "utf8");

test("the bundled test rig satisfies the specification", () => {
  assert.deepEqual(checkRig(rig), []);
});

test("missing part, missing pivot and wrong viewBox are reported", () => {
  const broken = rig
    .replace('viewBox="0 0 1000 1000"', 'viewBox="0 0 800 800"')
    .replace('<g id="mouth_O" display="none">', '<g id="mouth_X" display="none">')
    .replace(' data-pivot="500,540"', "");
  const errors = checkRig(broken);
  assert.ok(errors.some((e) => e.includes("viewBox")));
  assert.ok(errors.some((e) => e.includes("#mouth_O")));
  assert.ok(errors.some((e) => e.includes("#head needs data-pivot")));
});

test("authored transforms and wrong nesting are rejected", () => {
  const svg = `<svg viewBox="0 0 1000 1000"><g id="root"><g id="hand_L" data-pivot="1,1" transform="rotate(4)"></g><g id="arm_L_lower" data-pivot="1,1"></g></g></svg>`;
  const errors = checkRig(svg);
  assert.ok(errors.some((e) => e.includes("#hand_L must not have a transform")));
  assert.ok(errors.some((e) => e.includes("#hand_L must be inside #arm_L_lower")));
  assert.ok(errors.some((e) => e.includes("#arm_L_lower must be inside #arm_L_upper")));
});

test("root must be outermost", () => {
  const svg = `<svg viewBox="0 0 1000 1000"><g id="wrap"><g id="root"></g></g></svg>`;
  assert.ok(checkRig(svg).includes("#root must be the outermost group"));
});

test("parseGroups tracks ancestors and self-closing groups", () => {
  const groups = parseGroups(`<g id="a"><g id="b"/><g><g id="c"></g></g></g>`);
  assert.deepEqual(groups.get("b").ancestors, ["a"]);
  assert.deepEqual(groups.get("c").ancestors, ["a"]);
});

test("prefixIds rewrites ids and references", () => {
  const out = prefixIds(`<g id="x"><rect fill="url(#grad)"/><use href="#x"/></g>`, "pamuk");
  assert.equal(out, `<g id="pamuk--x"><rect fill="url(#pamuk--grad)"/><use href="#pamuk--x"/></g>`);
});

test("svgInner strips the outer element and rejects non-SVG", () => {
  assert.equal(svgInner(`<svg a="1"><g/></svg>\n`), "<g/>");
  assert.throws(() => svgInner("<div></div>"), /not an <svg>/);
});
