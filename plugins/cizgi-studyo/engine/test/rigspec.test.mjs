import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkRig, parseGroups, prefixIds, svgInner, slidingDetails } from "../src/rigspec.mjs";

const rig = readFileSync(new URL("../../library/characters/pamuk/rig.svg", import.meta.url), "utf8");

test("the bundled test rig satisfies the specification", () => {
  assert.deepEqual(checkRig(rig), []);
});

test("missing part, missing pivot and wrong viewBox are reported", () => {
  const broken = rig
    .replace('viewBox="0 0 1000 1000"', 'viewBox="0 0 800 800"')
    .replace('<g id="mouth_O" display="none">', '<g id="mouth_X" display="none">')
    .replace(/(<g id="head") data-pivot="[^"]*"/, "$1")
    .replace(/(<g id="arm_R") data-hose="[^"]*"/, '$1 data-hose="408,640"')
    .replace(/(id="arm_L"[\s\S]*?)class="hose-fill"/, '$1class="kol"');
  const errors = checkRig(broken);
  assert.ok(errors.some((e) => e.includes("viewBox")));
  assert.ok(errors.some((e) => e.includes("#mouth_O")));
  assert.ok(errors.some((e) => e.includes("#head needs data-pivot")));
  assert.ok(errors.some((e) => e.includes('#arm_R needs data-hose')));
  assert.ok(errors.some((e) => e.includes('#arm_L needs a <path class="hose-fill">')));
});

test("authored transforms and wrong nesting are rejected", () => {
  const svg = `<svg viewBox="0 0 1000 1000"><g id="root"><g id="hand_L" data-pivot="1,1" transform="rotate(4)"></g><g id="arm_L" data-hose="1,1 2,2 3,3"></g></g></svg>`;
  const errors = checkRig(svg);
  assert.ok(errors.some((e) => e.includes("#hand_L must not have a transform")));
  assert.ok(errors.some((e) => e.includes("#hand_L must be inside #arm_L")));
  assert.ok(errors.some((e) => e.includes("#arm_L must be inside #body")));
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

// A shape inside a bending limb (a hose: arm, or a leg with a knee) that is not its redrawn
// outline or fill stays where it was drawn while the limb bends: a patch on a knee slides off.
test("a loose shape on a bending limb is reported", () => {
  const genc = readFileSync(new URL("../../library/characters/genc/rig.svg", import.meta.url), "utf8");
  assert.deepEqual(slidingDetails(genc), [], "the library's own rigs have none (a joint cap at the shoulder is fine)");
  const patched = genc.replace(/(<g id="arm_L"[^>]*>)/, '$1<rect x="520" y="400" width="20" height="20" fill="#863"/>');
  assert.deepEqual(checkRig(patched), [], "a rig with it still loads: an episode warns, a draft is refused");
  const errors = slidingDetails(patched);
  assert.ok(errors.some((e) => e.includes("#arm_L") && /bend/.test(e)), errors.join("\n"));
});

test("shapes inside the hand or foot group of a limb are fine: those groups follow the limb", () => {
  const genc = readFileSync(new URL("../../library/characters/genc/rig.svg", import.meta.url), "utf8");
  const ringed = genc.replace(/(<g id="hand_L"[^>]*>)/, '$1<circle cx="530" cy="560" r="4" fill="#fc0"/>');
  assert.deepEqual(slidingDetails(ringed), []);
});

test("every character of the plugin's library is free of sliding details", async () => {
  const { readdirSync } = await import("node:fs");
  const dir = new URL("../../library/characters/", import.meta.url);
  for (const id of readdirSync(dir)) assert.deepEqual(slidingDetails(readFileSync(new URL(`${id}/rig.svg`, dir), "utf8")), [], id);
});
