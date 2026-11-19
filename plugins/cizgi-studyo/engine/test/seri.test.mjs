// A series (plan v3, Faz 1.4-1.5): seriler/<id>.json holds what every episode of it must keep, and
// dogrula compares each episode with it and with the episode before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { seriesWarnings, seriesSummary, validateSeries } from "../src/seri.mjs";

const lib = { characters: new Map([["kadir", { meta: {} }], ["kadir-on", { meta: { same_as: "kadir" } }], ["suluman", { meta: {} }]]) };

const SERI = {
  ad: "Hurda Kralı", format: "9:16", kisi_kurallari: ["oyun dili yok: anlatıcı hikâye anlatır"],
  karakterler: { kadir: { rig: "kadir", ses: { hazir: "erkek" } } },
  anlatici: { ses: { hazir: "kadin" } },
  nesneler: [{ ad: "çanta", not: "Kadir'in sırt çantası; şişeler hep ona girer" }],
  bolumler: ["hk-01", "hk-02"],
};

function episodeOf(id, extra = {}) {
  return {
    episode: id, title: id, language: "tr", format: "9:16", seri: "hurda-krali",
    characters: [{ id: "kadir", rig: "kadir", voice: { hazir: "erkek" } }, { id: "kadir_on", rig: "kadir-on" }],
    narrator_voice: { hazir: "kadin" },
    scenes: [
      { scene_id: "s1", bg: "sokak", isik: { saat: "sabah" }, shots: [{ shot_id: "s1_sh1", cast: [{ id: "kadir", action: "bekle", mark: "orta" }], utterances: [{ speaker: "kadir", text: "Bir." }], camera: { framing: "wide" } }] },
      { scene_id: "s2", bg: "dukkan", isik: { saat: "ogle" }, shots: [{ shot_id: "s2_sh1", cast: [{ id: "kadir_on", action: "bekle", mark: "orta" }], utterances: [{ speaker: "anlatici", text: "İki." }], camera: { framing: "wide" } }] },
    ],
    ...extra,
  };
}

function project({ seri = SERI, e1 = episodeOf("hk-01"), e2 = episodeOf("hk-02") } = {}) {
  const root = mkdtempSync(join(tmpdir(), "seri-"));
  mkdirSync(join(root, "seriler"));
  writeFileSync(join(root, "seriler", "hurda-krali.json"), JSON.stringify(seri));
  for (const ep of [e1, e2]) {
    mkdirSync(join(root, "bolumler", ep.episode), { recursive: true });
    writeFileSync(join(root, "bolumler", ep.episode, "bolum.json"), JSON.stringify(ep));
  }
  return { root, path: (id) => join(root, "bolumler", id, "bolum.json") };
}

test("an episode that keeps the series has no series warnings", () => {
  const { path } = project();
  const e2 = episodeOf("hk-02");
  e2.scenes[0].isik = { saat: "ogle" }; // goes on from where episode 1 ended (noon)
  assert.deepEqual(seriesWarnings(path("hk-02"), e2, lib), []);
});

test("a character with another drawing or voice than the series, or another narrator voice, is told", () => {
  // Hurda Kralı: in episode 1 Sülüman stood in for Kadir; voices were picked again in episode 2
  const e2 = episodeOf("hk-02", { characters: [{ id: "kadir", rig: "suluman", voice: { hazir: "yasli" } }], narrator_voice: { hazir: "erkek" } });
  e2.scenes[1].shots[0].cast = [{ id: "kadir", action: "bekle", mark: "orta" }];
  const { path } = project({ e2 });
  const w = seriesWarnings(path("hk-02"), e2, lib).join("\n");
  assert.match(w, /seri: "kadir" is drawn as "suluman", the series says "kadir"/);
  assert.match(w, /seri: "kadir" speaks with .*yasli.*erkek/);
  assert.match(w, /seri: the narrator speaks with .*erkek.*kadin/);
});

test("an episode outside the list, of another format, or that goes back in time from the one before is told", () => {
  const e2 = episodeOf("hk-02", { format: "16:9" }); // starts in the morning; episode 1 ended at noon
  const { path } = project({ e2 });
  const w = seriesWarnings(path("hk-02"), e2, lib).join("\n");
  assert.match(w, /seri: format 16:9/);
  assert.match(w, /scene s1: .*sabah.*hk-01 ended at ogle/);
  e2.scenes[0].shots[0].zaman_atlama = true; // "ertesi sabah": a jump in time, said so
  assert.doesNotMatch(seriesWarnings(path("hk-02"), e2, lib).join("\n"), /ended at/);
  const stray = episodeOf("hk-09");
  const p2 = project({ e2: stray });
  assert.match(seriesWarnings(p2.path("hk-09"), stray, lib).join("\n"), /not in the series' list/);
});

test("a missing or broken series file is told; an episode without seri has no series checks", () => {
  const e2 = episodeOf("hk-02", { seri: "yok-boyle" });
  const { path } = project({ e2 });
  assert.match(seriesWarnings(path("hk-02"), e2, lib).join("\n"), /seriler\/yok-boyle\.json/);
  const { seri, ...plain } = episodeOf("hk-02");
  assert.deepEqual(seriesWarnings(path("hk-02"), plain, lib), []);
  assert.match(validateSeries({ ad: "x", karakterler: { a: { rig: 3 } }, bolumler: "x" }).join("\n"), /rig|bolumler/);
});

test("seri-ozet gives each episode's characters, voices, opening and ending, for the next episode to read first", () => {
  const { root } = project();
  const out = seriesSummary(join(root, "seriler", "hurda-krali.json"));
  assert.equal(out.seri.ad, "Hurda Kralı");
  assert.equal(out.bolumler.length, 2);
  const first = out.bolumler[0];
  assert.equal(first.id, "hk-01");
  assert.deepEqual(first.acilis, { sahne: "s1", mekan: "sokak", saat: "sabah" });
  assert.deepEqual(first.kapanis, { sahne: "s2", mekan: "dukkan", saat: "ogle", eldekiler: [] });
  assert.deepEqual(first.sesler, { kadir: { hazir: "erkek" }, anlatici: { hazir: "kadin" } });
});
