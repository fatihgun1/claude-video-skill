/**
 * Story cards: hikaye.json next to an episode's bolum.json. A draft the person and Claude shape
 * before the script: the idea, the audience, the characters (from the library, or still to be
 * drawn) and one card per scene (what happens, who is in it, the feeling, about how long).
 * It is not a gate: nothing waits for it, and it never changes the episode by itself.
 *
 *   {
 *     "fikir": "…",                 the idea in a sentence or two
 *     "yas": "4-6",                 the audience (free text)
 *     "karakterler": [{ "ad": "Ela", "rig": "ela", "not": "…" }]   rig: a library character; none = to be drawn
 *     "kartlar": [{ "id": "k1", "baslik": "…", "olay": "…", "kim": ["Ela"], "duygu": "…", "sure": 8, "sahne": "s1" }]
 *   }                                sahne: the scene of bolum.json the card became (set when the script is written)
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

export const LIMITS = Object.freeze({ short: 80, text: 1000, cards: 40, characters: 20, who: 8, minSec: 1, maxSec: 120 });
const ID = /^[a-z0-9]+([_-][a-z0-9]+)*$/;
const TOP = new Set(["fikir", "yas", "karakterler", "kartlar"]);
const CHARACTER = new Set(["ad", "rig", "not"]);
const CARD = new Set(["id", "baslik", "olay", "kim", "duygu", "sure", "sahne"]);

/** The story a new episode starts with. */
export const emptyStory = () => ({ fikir: "", yas: "", karakterler: [], kartlar: [] });

export const storyPathOf = (episodePath) => join(dirname(episodePath), "hikaye.json");
const versionOf = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);
const serialize = (story) => `${JSON.stringify(story, null, 2)}\n`;

/** A card id not used yet: "k<n>". */
export function nextCardId(story) {
  const taken = new Set(story.kartlar.map((k) => k.id));
  let n = story.kartlar.length + 1;
  while (taken.has(`k${n}`)) n++;
  return `k${n}`;
}

/**
 * @param {object} story
 * @param {{characters: Map<string, object>}} lib
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateStory(story, lib) {
  const errors = [];
  const text = (v, where, max = LIMITS.text, required = false) => {
    if (v === undefined && !required) return;
    if (typeof v !== "string") errors.push(`${where}: yazı olmalı`);
    else if (v.length > max) errors.push(`${where}: çok uzun (en çok ${max} harf)`);
    else if (required && !v.trim()) errors.push(`${where}: boş`);
  };
  const known = (obj, allowed, where) => {
    for (const k of Object.keys(obj)) if (!allowed.has(k)) errors.push(`${where}: bilinmeyen alan "${k}"`);
  };
  if (!story || typeof story !== "object" || Array.isArray(story)) return { ok: false, errors: ["hikâye bir nesne olmalı"] };
  known(story, TOP, "hikâye");
  text(story.fikir, "fikir");
  text(story.yas, "yaş", LIMITS.short);

  const names = new Set();
  if (!Array.isArray(story.karakterler)) errors.push("karakterler bir liste olmalı");
  else if (story.karakterler.length > LIMITS.characters) errors.push(`karakterler: en çok ${LIMITS.characters}`);
  else {
    story.karakterler.forEach((c, i) => {
      const where = `karakter ${i + 1}`;
      if (!c || typeof c !== "object") return errors.push(`${where}: nesne olmalı`);
      known(c, CHARACTER, where);
      text(c.ad, `${where} adı`, LIMITS.short, true);
      text(c.not, `${where} notu`);
      if (c.rig !== undefined && !(typeof c.rig === "string" && lib.characters.has(c.rig))) errors.push(`${where}: "${c.rig}" kütüphanede yok (çizilecekse rig boş kalsın)`);
      if (typeof c.ad === "string") {
        if (names.has(c.ad)) errors.push(`${where}: "${c.ad}" adı iki kez kullanılmış`); // kartların "kim" listesi adla eşleşir
        names.add(c.ad);
      }
      return undefined;
    });
  }

  if (!Array.isArray(story.kartlar)) errors.push("kartlar bir liste olmalı");
  else if (story.kartlar.length > LIMITS.cards) errors.push(`kartlar: en çok ${LIMITS.cards}`);
  else {
    const ids = new Set();
    story.kartlar.forEach((k, i) => {
      const where = `kart ${i + 1}`;
      if (!k || typeof k !== "object") return errors.push(`${where}: nesne olmalı`);
      known(k, CARD, where);
      if (typeof k.id !== "string" || !ID.test(k.id)) errors.push(`${where}: id küçük harf, rakam, - ya da _ olmalı`);
      else if (ids.has(k.id)) errors.push(`${where}: id "${k.id}" iki kez kullanılmış`);
      else ids.add(k.id);
      text(k.baslik, `${where} başlığı`, LIMITS.short);
      text(k.olay, `${where} olayı`);
      text(k.duygu, `${where} duygusu`, LIMITS.short);
      if (k.kim !== undefined) {
        if (!Array.isArray(k.kim) || k.kim.length > LIMITS.who) errors.push(`${where}: kim en çok ${LIMITS.who} kişilik bir liste olmalı`);
        else {
          for (const n of k.kim) if (!names.has(n)) errors.push(`${where}: "${n}" karakterler listesinde yok`);
          if (new Set(k.kim).size !== k.kim.length) errors.push(`${where}: kim listesinde aynı ad iki kez var`);
        }
      }
      if (k.sure !== undefined && !(typeof k.sure === "number" && k.sure >= LIMITS.minSec && k.sure <= LIMITS.maxSec)) {
        errors.push(`${where}: süre ${LIMITS.minSec}-${LIMITS.maxSec} saniye olmalı`);
      }
      if (k.sahne !== undefined && !(typeof k.sahne === "string" && ID.test(k.sahne))) errors.push(`${where}: sahne bir sahne kimliği olmalı (örneğin s1)`);
      return undefined;
    });
  }
  return { ok: errors.length === 0, errors };
}

/**
 * The story of an episode, with the version of the file it came from. A missing file reads as an
 * empty story (nothing is written); a broken one is an error, so it is never silently replaced.
 * @returns {{story: object, exists: boolean, version: string}}
 */
export function readStory(episodePath) {
  const path = storyPathOf(episodePath);
  if (!existsSync(path)) return { story: emptyStory(), exists: false, version: versionOf("") };
  const raw = readFileSync(path, "utf8");
  try {
    return { story: JSON.parse(raw), exists: true, version: versionOf(raw) };
  } catch (err) {
    throw new Error(`hikaye.json okunamadı (${err.message}): dosyayı düzelt ya da sil`);
  }
}

/**
 * Write a valid story over the version it was read from (someone else's change is not lost).
 * @returns {{version: string}}
 */
export function writeStory(episodePath, story, lib, version) {
  const { ok, errors } = validateStory(story, lib);
  if (!ok) throw new Error(errors.join("\n"));
  const path = storyPathOf(episodePath);
  const now = existsSync(path) ? versionOf(readFileSync(path, "utf8")) : versionOf("");
  if (version !== now) throw Object.assign(new Error("hikaye.json diskte değişti (Claude düzenlemiş olabilir): yeniden yükle"), { code: 409 });
  const text = serialize(story);
  const tmp = `${path}.panel-tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
  return { version: versionOf(text) };
}
