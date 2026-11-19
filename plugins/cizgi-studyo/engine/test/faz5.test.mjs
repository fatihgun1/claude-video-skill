import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { captionChunks, captionMax } from "../src/altyazi.mjs";
import { loadLibrary } from "../src/library.mjs";
import { storyboard, render } from "../src/uretim.mjs";

const lib = loadLibrary(fileURLToPath(new URL("../../library", import.meta.url)));

test("a long caption is cut into pieces of at most two lines, words kept whole (Faz 5.7)", () => {
  // 9:16 grew to 3-4 lines over the faces
  const words = "kelime ".repeat(14).trim().split(" "); // 97 letters
  const max = captionMax(undefined, "9:16");
  const pieces = captionChunks(words, max);
  assert.equal(pieces.length, words.length);
  assert.ok(pieces.at(-1) >= 1, "more than one piece in 9:16");
  for (let p = 0; p <= pieces.at(-1); p++) {
    const text = words.filter((_, k) => pieces[k] === p).join(" ");
    assert.ok(text.length <= max, `piece ${p}: ${text.length} > ${max}`);
  }
  assert.deepEqual(captionChunks(words, captionMax(undefined, "16:9")), words.map(() => 0), "fits whole in 16:9");
  assert.deepEqual(captionChunks(["çokçokçokuzunbirkelime"], 5), [0], "a word longer than a piece stays on its own");
});

test("a storyboard or render waits for the episode's other build, then says so (Faz 5.9)", () => {
  const dir = mkdtempSync(join(tmpdir(), "kilit-"));
  try {
    mkdirSync(join(dir, ".cizgi"), { recursive: true });
    writeFileSync(join(dir, "bolum.json"), "{}");
    writeFileSync(join(dir, ".cizgi", "uretim.lock"), JSON.stringify({ pid: process.ppid, bolum: "x" })); // a live process holds it
    const deps = { lockWaitMs: 0, run: () => "" };
    assert.throws(() => storyboard(join(dir, "bolum.json"), lib, deps), /başka bir derleme/);
    assert.throws(() => render(join(dir, "bolum.json"), lib, deps), /başka bir derleme/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("one rules file, read whichever way the work begins: the panel, the hook and every skill point to it (Faz 6.1)", async () => {
  const { readFileSync, existsSync } = await import("node:fs");
  const RULES_FILE = fileURLToPath(new URL("../../kurallar.md", import.meta.url)); // mcp.mjs starts its server when imported
  assert.match(readFileSync(fileURLToPath(new URL("../src/mcp.mjs", import.meta.url)), "utf8"), /kurallar: rulesText()/);
  assert.ok(existsSync(RULES_FILE));
  assert.match(readFileSync(RULES_FILE, "utf8"), /temel kurallar/);
  const skills = ["cizgi-proje", "cizgi-senaryo", "cizgi-sinema", "cizgi-panel", "cizgi-studyo", "cizgi-storyboard", "cizgi-ses", "cizgi-render"];
  for (const s of skills) {
    const text = readFileSync(fileURLToPath(new URL(`../../skills/${s}/SKILL.md`, import.meta.url)), "utf8");
    assert.ok(text.includes("${CLAUDE_PLUGIN_ROOT}/kurallar.md"), s);
  }
  assert.match(readFileSync(fileURLToPath(new URL("../src/panel-hook.mjs", import.meta.url)), "utf8"), /kurallar\.md/);
});
