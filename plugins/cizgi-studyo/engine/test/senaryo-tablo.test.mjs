import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scriptTable } from "../src/senaryo-tablo.mjs";

const CLI = fileURLToPath(new URL("../src/cli.mjs", import.meta.url));

function episode(overrides = {}) {
  return {
    episode: "deneme",
    language: "tr",
    format: "9:16",
    kararlar: { boyut: "2b", muzik: "yok", efekt: "var", altyazi: "var" },
    characters: [{ id: "nazim", rig: "genc" }, { id: "genc", rig: "genc" }],
    scenes: [{ scene_id: "s1", bg: "sokak", isik: { saat: "sabah" }, shots: [
      {
        shot_id: "s1_sh1",
        utterances: [{ speaker: "nazim", text: "Ne bakıyon? | Yürü git!" }, { speaker: "genc", text: "Peki." }],
        cast: [
          { id: "nazim", action: "bak", mark: "orta", actions: [{ action: "bak", at: 1.5 }] },
          { id: "genc", action: "yuru", mark: "sag", facing: "sol", walk: { dx: -290 } },
        ],
        props: [{ id: "sise", prop: "plastik-sise", mark: "orta", holder: "nazim" }],
        sfx: [{ sfx: "adim-beton", at: 0.4 }],
        camera: { framing: "close", move: "push_in", target: "nazim" },
        hold: 1.2,
      },
      {
        shot_id: "s1_sh2",
        cast: [{ id: "genc", action: "bak", mark: "orta" }],
        camera: { framing: "wide", move: "static", target: "genc" },
      },
    ] }],
    ...overrides,
  };
}

test("one row per shot with every column filled", () => {
  const { satirlar } = scriptTable(episode());
  assert.equal(satirlar.length, 2);
  const [a, b] = satirlar;
  assert.equal(a.plan, "s1_sh1");
  assert.match(a.mekan, /sokak/);
  assert.match(a.mekan, /sabah/);
  assert.deepEqual(a.konusan, ["nazim", "genc"]);
  assert.deepEqual(a.replik, ["Ne bakıyon? | Yürü git!", "Peki."]);
  assert.match(a.hareket, /nazim: bak → bak \(1\.5 sn\)/);
  assert.match(a.hareket, /genc: yuru, yürür -290/);
  assert.match(a.hareket, /plastik-sise/);
  assert.match(a.hareket, /adim-beton/);
  assert.equal(a.kamera, "close · push_in → nazim");
  assert.equal(a.bekleme, "1.2 sn");
  assert.deepEqual(b.replik, []);
  assert.equal(b.bekleme, "otomatik");
});

test("the markdown table has a header with the decisions and escapes pipes", () => {
  const { tablo } = scriptTable(episode());
  const lines = tablo.split("\n");
  assert.match(lines[0], /Format: 9:16/);
  assert.match(lines[0], /Boyut: 2B/);
  assert.match(lines[0], /Müzik: yok/);
  assert.ok(lines.some((l) => l.startsWith("| Plan | Mekân | Konuşan | Replik | Hareket | Kamera | Bekleme |")));
  const row = lines.find((l) => l.startsWith("| s1_sh1 "));
  assert.equal(row.split(/(?<!\\)\|/).length - 2, 7, row);
  assert.match(row, /Ne bakıyon\? \\\| Yürü git!/);
  assert.match(lines.find((l) => l.startsWith("| s1_sh2 ")), /\| — \|/);
});

test("decisions not made yet read as not chosen", () => {
  const { format, kararlar, ...rest } = episode();
  const { tablo } = scriptTable(rest);
  assert.match(tablo.split("\n")[0], /Format: seçilmedi/);
  assert.match(tablo.split("\n")[0], /Boyut: seçilmedi/);
});

test("a 3D episode names its look", () => {
  const { tablo } = scriptTable(episode({ kararlar: { boyut: "3b", muzik: "var", efekt: "yok", altyazi: "yok" }, stil3d: "pastel", music: { track: "eskiz-2024-04-10" } }));
  assert.match(tablo.split("\n")[0], /Boyut: 3B \(pastel\)/);
  assert.match(tablo.split("\n")[0], /Müzik: eskiz-2024-04-10/);
});

test("cizgi senaryo prints the table of a valid episode", () => {
  const dir = mkdtempSync(join(tmpdir(), "tablo-"));
  const path = join(dir, "bolum.json");
  writeFileSync(path, JSON.stringify(episode()));
  const out = spawnSync(process.execPath, [CLI, "senaryo", path], { encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr);
  const res = JSON.parse(out.stdout);
  assert.equal(res.satirlar.length, 2);
  assert.match(res.tablo, /\| s1_sh1 /);
});
