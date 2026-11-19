/**
 * The script table shown at the senaryo gate: one row per shot with every column filled
 * (place, speakers, lines, actions, camera, hold), headed by the person's decisions.
 * The engine builds it so no column can be left out when the script is shown.
 */

const NOT_CHOSEN = "seçilmedi";
const COLUMNS = Object.freeze(["Plan", "Mekân", "Konuşan", "Replik", "Hareket", "Kamera", "Bekleme"]);

const sec = (n) => `${n} sn`;
const cell = (s) => (s === "" ? "—" : String(s).replace(/\|/g, "\\|").replace(/\n/g, " "));

function member(m) {
  const extra = (m.actions || []).map((a) => ` → ${a.action} (${sec(a.at)})`).join("");
  const walk = m.walk ? `, yürür ${m.walk.dx}${m.walk.time !== undefined ? ` (${sec(m.walk.time)})` : ""}` : "";
  return `${m.id}: ${m.action}${extra}${walk}`;
}

/** When an effect plays: its time, or what it is tied to (efekt.mjs). */
function sfxWhen(x) {
  const off = x.ofset ? ` ${x.ofset > 0 ? "+" : ""}${sec(x.ofset)}` : "";
  if (x.at != null) return sec(x.at + (x.ofset || 0));
  if (x.replik != null) return `${x.replik + 1}. replikle${x.kelime != null ? `, ${x.kelime + 1}. kelimede` : ""}${off}`;
  if (x.adim) return `${x.oyuncu} her adımda`;
  return `${x.oyuncu}: ${{ baslangic: "başta", grab: "alırken", release: "kaldırırken", put_down: "bırakırken" }[x.an || "baslangic"]}${off}`;
}

function actionsOf(shot) {
  return [
    ...shot.cast.map(member),
    ...(shot.props || []).map((p) => (p.holder ? `${p.holder} elinde: ${p.prop}` : `nesne: ${p.prop}`)),
    ...(shot.sfx || []).map((x) => `efekt: ${x.sfx} (${sfxWhen(x)})`),
  ].join("; ");
}

function cameraOf(c) {
  return `${c.framing} · ${c.move || "static"}${c.target ? ` → ${c.target}` : ""}`;
}

function header(episode) {
  const k = episode.kararlar || {};
  const boyut = k.boyut ? `${k.boyut.toUpperCase()}${k.boyut === "3b" && episode.stil3d ? ` (${episode.stil3d})` : ""}` : NOT_CHOSEN;
  const muzik = k.muzik === "var" && episode.music ? episode.music.track : k.muzik || NOT_CHOSEN;
  return [
    `Format: ${episode.format || NOT_CHOSEN}`,
    `Boyut: ${boyut}`,
    `Müzik: ${muzik}`,
    `Efekt: ${k.efekt || NOT_CHOSEN}`,
    `Altyazı: ${k.altyazi || NOT_CHOSEN}`,
  ].join(" · ");
}

/**
 * @param {object} episode a schema-valid episode
 * @returns {{baslik: string, satirlar: object[], tablo: string}} the rows as data and as a markdown table
 */
export function scriptTable(episode) {
  const satirlar = episode.scenes.flatMap((scene) =>
    scene.shots.map((shot) => ({
      plan: shot.shot_id,
      mekan: `${scene.bg}${scene.isik?.saat ? ` (${scene.isik.saat})` : ""}`,
      konusan: (shot.utterances || []).map((u) => u.speaker),
      replik: (shot.utterances || []).map((u) => u.text),
      hareket: actionsOf(shot),
      kamera: cameraOf(shot.camera),
      bekleme: shot.hold !== undefined ? sec(shot.hold) : "otomatik",
    })),
  );
  const baslik = header(episode);
  const row = (r) => [r.plan, r.mekan, r.konusan.join("<br>"), r.replik.map(cell).join("<br>"), r.hareket, r.kamera, r.bekleme];
  const tablo = [
    baslik,
    "",
    `| ${COLUMNS.join(" | ")} |`,
    `|${COLUMNS.map(() => "---").join("|")}|`,
    ...satirlar.map((r) => `| ${row(r).map((v, i) => (i === 3 ? v || "—" : cell(v))).join(" | ")} |`),
  ].join("\n");
  return { baslik, satirlar, tablo };
}
