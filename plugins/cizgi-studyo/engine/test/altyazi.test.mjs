// Captions: per line on/off, per scene place and size, off for the whole episode, the speaker's colour.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadLibrary } from "../src/library.mjs";
import { validateEpisode } from "../src/validate.mjs";
import { compileEpisode } from "../src/compile.mjs";
import { SPEAKER_COLORS, speakerColor, captionPlace, captionShown } from "../src/altyazi.mjs";

const LIB = fileURLToPath(new URL("../../library", import.meta.url));
const FAZ1 = fileURLToPath(new URL("../../../../ornekler/faz1/bolum.json", import.meta.url));
const lib = loadLibrary(LIB);
const fresh = () => JSON.parse(readFileSync(FAZ1, "utf8"));

function compiled(ep, format = "16:9") {
  const out = mkdtempSync(join(tmpdir(), "cizgi-altyazi-"));
  compileEpisode(FAZ1, lib, out, { episode: ep, missingAudio: "estimate", format });
  return readFileSync(join(out, "index.html"), "utf8");
}
const captionDivs = (html) => [...html.matchAll(/<div class="altyazi[^"]*"[^>]*>/g)].map((m) => m[0]);

test("a speaker's colour: its own, else the palette by its place in the cast; the narrator is grey", () => {
  const ep = { characters: [{ id: "a" }, { id: "b", renk: "#123456" }, { id: "c" }] };
  assert.equal(speakerColor(ep, "a"), SPEAKER_COLORS[0]);
  assert.equal(speakerColor(ep, "b"), "#123456");
  assert.equal(speakerColor(ep, "c"), SPEAKER_COLORS[2]);
  assert.match(speakerColor(ep, "anlatici"), /^#[0-9a-f]{6}$/);
  assert.notEqual(speakerColor(ep, "anlatici"), SPEAKER_COLORS[0]);
});

test("caption place: the scene's choice, else the format's default (bottom for 16:9, top for 9:16)", () => {
  assert.deepEqual(captionPlace({}, "16:9"), { konum: "alt", boyut: "orta" });
  assert.deepEqual(captionPlace({}, "9:16"), { konum: "ust", boyut: "orta" });
  assert.deepEqual(captionPlace({ altyazi: { konum: "orta", boyut: "buyuk" } }, "9:16"), { konum: "orta", boyut: "buyuk" });
  assert.deepEqual(captionPlace({ altyazi: { boyut: "kucuk" } }, "16:9"), { konum: "alt", boyut: "kucuk" });
});

test("a caption shows unless its line or the whole episode turns it off", () => {
  assert.equal(captionShown({}, { text: "x" }), true);
  assert.equal(captionShown({}, { text: "x", altyazi: false }), false);
  assert.equal(captionShown({ altyazi: { kapali: true } }, { text: "x" }), false);
});

test("the schema takes the caption settings and refuses unknown places, sizes and fields", () => {
  const ep = fresh();
  ep.altyazi = { kapali: false, konusan_rengi: true };
  ep.characters[0].renk = "#4fb8a0";
  ep.scenes[0].altyazi = { konum: "ust", boyut: "buyuk" };
  ep.scenes[0].shots[0].utterances[0].altyazi = false;
  assert.deepEqual(validateEpisode(ep, lib).errors, []);
  for (const bad of [
    (e) => { e.scenes[0].altyazi = { konum: "sol" }; },
    (e) => { e.scenes[0].altyazi = { boyut: "dev" }; },
    (e) => { e.altyazi = { renk: "#fff" }; },
    (e) => { e.scenes[0].shots[0].utterances[0].altyazi = "hayir"; },
    (e) => { e.characters[0].renk = "kirmizi"; },
  ]) {
    const e = fresh();
    bad(e);
    assert.equal(validateEpisode(e, lib).ok, false);
  }
});

test("compiled: a line turned off has no caption; a scene's place and size are classes on its captions", () => {
  const ep = fresh();
  ep.scenes[0].altyazi = { konum: "orta", boyut: "buyuk" };
  ep.scenes[0].shots[1].utterances[0].altyazi = false;
  const divs = captionDivs(compiled(ep));
  const shots = ep.scenes[0].shots;
  assert.equal(divs.length, shots.reduce((n, s) => n + (s.utterances || []).length, 0) - 1);
  assert.ok(!divs.some((d) => d.includes(`altyazi-${shots[1].shot_id}-0`)));
  assert.ok(divs.every((d) => /class="altyazi konum-orta boyut-buyuk"/.test(d)), divs[0]);
  // 9:16 defaults to the top
  assert.ok(captionDivs(compiled(fresh(), "9:16")).every((d) => d.includes("konum-ust boyut-orta")));
});

test("compiled: the whole episode off has no captions; the speaker's colour rides on each caption when asked", () => {
  const off = fresh();
  off.altyazi = { kapali: true };
  assert.equal(captionDivs(compiled(off)).length, 0);
  const plain = captionDivs(compiled(fresh()));
  assert.ok(plain.every((d) => !d.includes("--konusan")));
  const coloured = fresh();
  coloured.altyazi = { konusan_rengi: true };
  coloured.characters[0].renk = "#123456";
  const divs = captionDivs(compiled(coloured));
  assert.ok(divs.length && divs.every((d) => d.includes("konusan") && d.includes("--konusan: #123456")), divs[0]);
});
