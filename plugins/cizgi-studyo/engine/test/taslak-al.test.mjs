// Claude takes the drafts it drew into the project library itself (no "Kütüphaneye al" click),
// only the ones it names: leftovers of other episodes stay drafts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../src/cli.mjs", import.meta.url));
const PROP = fileURLToPath(new URL("../../library/props/agac.svg", import.meta.url));

test("cizgi taslak-al takes the named drafts in and leaves the others", () => {
  const root = mkdtempSync(join(tmpdir(), "tal-"));
  const drafts = join(root, "kutuphane", "taslak", "props");
  mkdirSync(drafts, { recursive: true });
  copyFileSync(PROP, join(drafts, "benim.svg"));
  copyFileSync(PROP, join(drafts, "eski.svg"));
  const r = spawnSync(process.execPath, [CLI, "taslak-al", root, "nesne/benim"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).alinan.map((d) => d.id), ["benim"]);
  assert.ok(existsSync(join(root, "kutuphane", "props", "benim.svg")));
  assert.ok(existsSync(join(drafts, "eski.svg")), "a draft not named stays a draft");
  const bad = spawnSync(process.execPath, [CLI, "taslak-al", root, "nesne/yok"], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.match(JSON.parse(bad.stdout).hatalar[0].hata, /taslak yok/);
});
