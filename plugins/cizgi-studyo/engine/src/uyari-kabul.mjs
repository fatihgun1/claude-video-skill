/**
 * Warnings that hold a gate (plan v3, Faz 0.1).
 *
 * `dogrula` warnings used to be advice: kpss-ajani was approved with 17 of them and Hurda Kralı 1 was
 * rendered with a dog off screen. Now every open warning holds the approvals (onayla.mjs). A warning
 * the person decides to keep is written into bolum.json with their reason:
 *   "kabul_uyarilar": [{"kod": "film:s2b_sh3:a1b2c3", "neden": "köpek şişeyi kapıp geri döner"}]
 * and is open no more. Only the person's yes writes one (the agent runs `cizgi uyari-kabul` after it).
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const CODE = /^[a-z_]+:[^:\s]+:[0-9a-f]{6}$/;
const MAX_REASON = 300;

/**
 * A warning's stable code: its kind (the text before the first colon), the shot or scene it names
 * ("-" when none) and six hex of a hash of its text with the numbers taken out, so that moving
 * something a little does not turn an accepted warning into a new one.
 * @param {string} text
 */
export function warningCode(text) {
  const kind = (/^([a-z_]+)\b/i.exec(text)?.[1] || "uyari").toLowerCase(); // "film: …", "scene s2: …", "voices: …"
  const where = /\b(?:shot|scene)\s+([A-Za-z0-9_-]+)/.exec(text)?.[1] || "-";
  const hash = createHash("sha256").update(text.replace(/-?\d+(\.\d+)?/g, "#")).digest("hex").slice(0, 6);
  return `${kind}:${where}:${hash}`;
}

/** The warnings the episode has not accepted, each with its code. */
export function openWarnings(episode, warnings) {
  const accepted = new Set((episode.kabul_uyarilar || []).map((k) => k.kod));
  return warnings.map((metin) => ({ kod: warningCode(metin), metin })).filter((w) => !accepted.has(w.kod));
}

/**
 * Record the person's acceptance of warnings in the saved bolum.json (once per code).
 * @param {string} episodePath
 * @param {string[]} codes
 * @param {string} reason the person's reason, in their words
 */
export function acceptWarnings(episodePath, codes, reason) {
  const neden = String(reason || "").trim();
  if (!neden) throw new Error("bir neden gerekli (kişinin neden kabul ettiği)");
  if (neden.length > MAX_REASON) throw new Error(`neden en çok ${MAX_REASON} karakter`);
  for (const kod of codes) if (!CODE.test(kod)) throw new Error(`geçersiz uyarı kodu "${kod}" (dogrula'nın acik_uyarilar listesinden)`);
  const episode = JSON.parse(readFileSync(episodePath, "utf8"));
  const have = new Set((episode.kabul_uyarilar || []).map((k) => k.kod));
  const added = codes.filter((kod) => !have.has(kod)).map((kod) => ({ kod, neden }));
  episode.kabul_uyarilar = [...(episode.kabul_uyarilar || []), ...added];
  writeFileSync(episodePath, `${JSON.stringify(episode, null, 2)}\n`);
  return added;
}
