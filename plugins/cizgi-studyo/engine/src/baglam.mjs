/**
 * Warnings that need the episode's place on disk, not only its JSON: its series (seri.mjs) and its
 * story cards (hikaye-kontrol.mjs). dogrula, durum and the approvals add them to validateEpisode's.
 */
import { seriesWarnings } from "./seri.mjs";
import { storyWarnings } from "./hikaye-kontrol.mjs";

/**
 * @param {string} episodePath
 * @param {object} episode a schema-valid episode
 * @param {ReturnType<import("./library.mjs").loadLibrary>} lib
 * @returns {string[]}
 */
export function contextWarnings(episodePath, episode, lib) {
  return [...seriesWarnings(episodePath, episode, lib), ...storyWarnings(episodePath, episode, lib)];
}
