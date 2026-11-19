/**
 * Recording a gate approval, shared by `cizgi onayla` and the panel's approval buttons (Üretim).
 * Both run only on the person's decision: the CLI after their yes in chat, the panel when they press
 * the button themselves. The checks are the same either way, on the saved bolum.json:
 * a valid episode, no library file changed behind the plugin's back, and, for the script, every
 * decision made (kararlar).
 */
import { validateEpisode } from "./validate.mjs";
import { GATES, approve, scriptFingerprint, storyboardFingerprint, libraryFingerprint } from "./onay.mjs";
import { readManifest, requireFreshAudio } from "./ses.mjs";
import { checkLibrary, integrityErrors } from "./icerik.mjs";
import { requireDecisions } from "./kararlar.mjs";
import { readJson } from "./util.mjs";
import { openWarnings } from "./uyari-kabul.mjs";
import { readStory } from "./hikaye.mjs";
import { contextWarnings } from "./baglam.mjs";
import { existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { STILLS_FINGERPRINT } from "./uretim.mjs";

/**
 * @param {string} episodePath
 * @param {string} gate "senaryo" | "storyboard"
 * @param {ReturnType<import("./library.mjs").loadLibrary>} lib
 * @returns {{approved: string, fingerprint: string}}
 */
/**
 * The storyboard gate approves what the person saw: the stills must have been taken of this very
 * episode (Faz 0.5: a change made after the stills was approved unseen).
 */
function requireStillsOf(episodePath, fingerprint) {
  const file = join(dirname(resolve(episodePath)), STILLS_FINGERPRINT);
  const shown = existsSync(file) ? readJson(file).fingerprint : null;
  const now = String(fingerprint).split("|");
  if (!shown) throw new Error("storyboard kareleri yok: önce cizgi storyboard <bolum.json>, kareleri kişiye göster, sonra onayla");
  if (!String(shown).split("|").some((f) => now.includes(f))) throw new Error("bölüm storyboard karelerinden sonra değişti: kişi bu hâlini görmedi; cizgi storyboard ile kareleri yenile, göster, sonra onayla");
}

export function approveEpisode(episodePath, gate, lib) {
  if (!GATES.includes(gate)) throw new Error(`unknown gate "${gate}" (${GATES.join(", ")})`);
  const episode = readJson(episodePath);
  const { ok, errors, warnings: own } = validateEpisode(episode, lib);
  if (!ok) throw new Error(`episode is invalid:\n- ${errors.join("\n- ")}`);
  const warnings = [...own, ...contextWarnings(episodePath, episode, lib)]; // its series and its story cards too
  // an open warning holds the gate: fix it, or the person keeps it (cizgi uyari-kabul, after their yes)
  const open = openWarnings(episode, warnings);
  if (open.length) {
    throw new Error(`${open.length} açık uyarı var; düzelt ya da kişi kabul ederse "cizgi uyari-kabul <bolum.json> <kod> --neden …" ile yaz:\n- ${open.map((w) => `${w.kod}  ${w.metin}`).join("\n- ")}`);
  }
  const local = integrityErrors(episode, checkLibrary(lib.dir));
  if (local.length) throw new Error(`episode uses library files that are not part of the plugin:\n- ${local.join("\n- ")}`);
  if (gate === "senaryo") requireDecisions(episode, lib, readStory(episodePath));
  else requireFreshAudio(episodePath, episode, lib); // a storyboard of lines nobody spoke for these words
  const fingerprint = gate === "senaryo"
    ? scriptFingerprint(episode)
    : storyboardFingerprint(episode, readManifest(episodePath), libraryFingerprint(episode, lib));
  if (gate === "storyboard") requireStillsOf(episodePath, fingerprint);
  approve(episodePath, gate, fingerprint);
  return { approved: gate, fingerprint };
}
