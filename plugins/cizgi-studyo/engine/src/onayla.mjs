/**
 * Recording a gate approval, shared by `cizgi onayla` and the panel's approval buttons (Üretim).
 * Both run only on the person's decision: the CLI after their yes in chat, the panel when they press
 * the button themselves. The checks are the same either way, on the saved bolum.json:
 * a valid episode, no library file changed behind the plugin's back, and, for the script, every
 * decision made (kararlar).
 */
import { validateEpisode } from "./validate.mjs";
import { GATES, approve, scriptFingerprint, storyboardFingerprint, libraryFingerprint } from "./onay.mjs";
import { readManifest } from "./ses.mjs";
import { checkLibrary, integrityErrors } from "./icerik.mjs";
import { requireDecisions } from "./kararlar.mjs";
import { readJson } from "./util.mjs";

/**
 * @param {string} episodePath
 * @param {string} gate "senaryo" | "storyboard"
 * @param {ReturnType<import("./library.mjs").loadLibrary>} lib
 * @returns {{approved: string, fingerprint: string}}
 */
export function approveEpisode(episodePath, gate, lib) {
  if (!GATES.includes(gate)) throw new Error(`unknown gate "${gate}" (${GATES.join(", ")})`);
  const episode = readJson(episodePath);
  const { ok, errors } = validateEpisode(episode, lib);
  if (!ok) throw new Error(`episode is invalid:\n- ${errors.join("\n- ")}`);
  const local = integrityErrors(episode, checkLibrary(lib.dir));
  if (local.length) throw new Error(`episode uses library files that are not part of the plugin:\n- ${local.join("\n- ")}`);
  if (gate === "senaryo") requireDecisions(episode, lib);
  const fingerprint = gate === "senaryo"
    ? scriptFingerprint(episode)
    : storyboardFingerprint(episode, readManifest(episodePath), libraryFingerprint(episode, lib));
  approve(episodePath, gate, fingerprint);
  return { approved: gate, fingerprint };
}
