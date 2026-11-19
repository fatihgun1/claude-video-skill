import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { warningCode, openWarnings, acceptWarnings } from "../src/uyari-kabul.mjs";

const W1 = 'film: shot s2b_sh3: "kopek" faces right but faced left in s2b_sh2 (screen direction flips; put a front or back view between, or keep the direction)';
const W2 = 'film: shot s2_sh5: "kadir" ended s2_sh4b at x 960 but starts here at x 660 (jumps across the place at the cut); start them where they stopped (mark/dx)';

test("a warning has a stable code: its kind, where it is, and a short hash that ignores numbers", () => {
  const code = warningCode(W1);
  assert.match(code, /^film:s2b_sh3:[0-9a-f]{6}$/);
  assert.equal(warningCode(W1), code, "the same warning, the same code");
  // the same jump with other positions is the same warning: a nudge must not reopen an accepted one
  assert.equal(warningCode(W2.replace("x 660", "x 700")), warningCode(W2));
  assert.notEqual(warningCode(W2), code);
  assert.match(warningCode('voices: "anlatici" and "kadir" speak with the same voice'), /^voices:-:[0-9a-f]{6}$/);
  assert.match(warningCode("scene s2: same place as s1, but only s1 has a light (isik)"), /^scene:s2:[0-9a-f]{6}$/);
});

test("open warnings are the ones not accepted in kabul_uyarilar", () => {
  const episode = { kabul_uyarilar: [{ kod: warningCode(W1), neden: "köpek şişeyi kapıp geri döner" }] };
  assert.deepEqual(openWarnings(episode, [W1, W2]).map((w) => w.metin), [W2]);
  assert.equal(openWarnings({}, [W1]).length, 1);
});

test("accepting writes the code and the person's reason into bolum.json", () => {
  const file = join(mkdtempSync(join(tmpdir(), "kabul-")), "bolum.json");
  writeFileSync(file, JSON.stringify({ episode: "a", scenes: [] }));
  acceptWarnings(file, [warningCode(W1)], "kişi: köpek geri dönsün");
  acceptWarnings(file, [warningCode(W1)], "ikinci kez"); // once per code
  const saved = JSON.parse(readFileSync(file, "utf8"));
  assert.deepEqual(saved.kabul_uyarilar, [{ kod: warningCode(W1), neden: "kişi: köpek geri dönsün" }]);
  assert.throws(() => acceptWarnings(file, ["film:x:123456"], ""), /neden/);
  assert.throws(() => acceptWarnings(file, ["bozuk"], "x"), /kod/);
});
