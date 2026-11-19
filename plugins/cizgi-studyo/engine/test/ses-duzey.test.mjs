import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { levelledWav, levelGain, moodGain, SFX_TARGET_DB, TARGET_DB } from "../src/ses-duzey.mjs";
import { decodeWav } from "../src/dudak.mjs";
import { mixMusic } from "../src/muzik.mjs";
import { loadLibrary } from "../src/library.mjs";
import { validateEpisode } from "../src/validate.mjs";

const lib = loadLibrary(fileURLToPath(new URL("../../library", import.meta.url)));

/** RMS of the voiced frames, dB (as levelGain measures). */
const levelDb = (buf) => {
  const a = decodeWav(buf);
  return TARGET_DB - 20 * Math.log10(levelGain(a, TARGET_DB));
};

test("every library effect comes out at one level, whatever level its file has (Faz 5.2)", () => {
  // the library's effects lay 23 dB apart; "onay" rang out over the voices
  const levels = [...lib.sfx.values()].map((s) => levelDb(levelledWav(s.path, 1, SFX_TARGET_DB)));
  const spread = Math.max(...levels) - Math.min(...levels);
  assert.ok(spread < 6, `levels ${levels.map((x) => x.toFixed(1)).join(", ")}`);
  assert.ok(levels.every((x) => x < TARGET_DB), "effects stay under the speech level");
});

test("a feeling keeps its loudness after the levelling (Faz 5.6)", () => {
  assert.equal(moodGain(undefined), 1);
  assert.ok(moodGain("kizgin") > 1 && moodGain("uzgun") < 1);
});

test("music brought up to the common level clips instead of wrapping round", () => {
  const track = { rate: 8000, channels: 1, samples: Int16Array.from({ length: 8000 }, (_, i) => (i % 2 ? 30000 : -30000)) };
  const out = mixMusic(track, 1, { volume: 1, fade_in: 0, fade_out: 0, duck: 1 }, [], 4);
  assert.ok(out.samples.every((v) => Math.abs(v) >= 30000), "a loud sample stays loud (an Int16Array wraps 120000 to a small number)");
});

test("a speaker whose speed adds up under -30% is warned (Faz 5.6)", () => {
  const dir = mkdtempSync(join(tmpdir(), "hiz-"));
  try {
    const ep = {
      episode: "hiz", language: "tr", profile: "genel",
      characters: [{ id: "ela", rig: "ela-profil", voice: { hiz: -25 } }],
      scenes: [{ scene_id: "s1", bg: "oda", shots: [{ shot_id: "s1_sh1", cast: [{ id: "ela", action: "bekle", mark: "orta" }], camera: { framing: "wide" },
        utterances: [{ speaker: "ela", text: "Merhaba.", duygu: "uzgun" }] }] }],
    };
    writeFileSync(join(dir, "bolum.json"), JSON.stringify(ep));
    const slow = (e) => validateEpisode(e, lib).warnings.filter((w) => /speaks at -\d+% speed/.test(w));
    assert.equal(slow(ep).length, 1, validateEpisode(ep, lib).warnings.join("\n"));
    ep.characters[0].voice.hiz = 0;
    assert.deepEqual(slow(ep), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
