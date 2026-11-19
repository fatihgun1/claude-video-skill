/**
 * Caption rules shared by the compiler and the panel (served to it as it is: pure code, no imports),
 * so the timeline and the inspector show what the render does.
 *
 * - A line's caption shows unless the line (utterance.altyazi = false) or the whole episode
 *   (episode.altyazi.kapali) turns it off. Its text is always the line itself.
 * - A scene sets where and how big its captions are (scene.altyazi {konum, boyut}); without it
 *   the format decides: bottom in 16:9, top in 9:16 (a phone's buttons cover the bottom).
 * - episode.altyazi.konusan_rengi edges each caption with its speaker's colour.
 * - A line longer than two caption lines shows in pieces of at most two lines, one after another
 *   as it is spoken (9:16 grew to 3-4 lines over the faces; Faz 5.7).
 */

/** Speaker colours in cast order (the timeline uses the same). */
export const SPEAKER_COLORS = ["#4fb8a0", "#e88f80", "#7d8fc9", "#c9a14f"];
export const NARRATOR_COLOR = "#8a8f98";
export const CAPTION_PLACES = ["alt", "ust", "orta"];
export const CAPTION_SIZES = ["kucuk", "orta", "buyuk"];

/** A speaker's colour: its own (characters[].renk), else by its place in the cast; the narrator grey. */
export function speakerColor(episode, id) {
  const cast = episode?.characters || [];
  const i = cast.findIndex((c) => c.id === id);
  if (i < 0) return NARRATOR_COLOR;
  return cast[i].renk || SPEAKER_COLORS[i % SPEAKER_COLORS.length];
}

/** Where and how big a scene's captions are, with the format's defaults. */
export function captionPlace(scene, format) {
  const own = scene?.altyazi || {};
  return { konum: own.konum || (format === "9:16" ? "ust" : "alt"), boyut: own.boyut || "orta" };
}

/** Characters that fit in two caption lines (54/58 px bold on 88% of the width, roughly). */
export const CAPTION_MAX = Object.freeze({ "16:9": 110, "9:16": 56 });
/** How many more (or fewer) letters fit at each caption size (the usual font size over its own). */
const CAPTION_FIT = Object.freeze({ kucuk: 54 / 42, orta: 1, buyuk: 54 / 68 });

/** Letters that fit in two lines of a scene's captions in this format. */
export function captionMax(scene, format) {
  return Math.round(CAPTION_MAX[format] * CAPTION_FIT[captionPlace(scene, format).boyut]);
}

/**
 * Which two-line piece each word of a line belongs to (0, 1, …): words fill a piece up to max letters
 * (with the spaces), and a word that would pass it starts the next one.
 * @param {string[]} words
 * @param {number} max
 * @returns {number[]}
 */
export function captionChunks(words, max) {
  let piece = 0;
  let used = 0;
  return words.map((w) => {
    const need = (used ? 1 : 0) + w.length;
    if (used && used + need > max) {
      piece++;
      used = w.length;
    } else used += need;
    return piece;
  });
}

/** Whether a line has a caption at all. */
export function captionShown(episode, utterance) {
  return !episode?.altyazi?.kapali && utterance?.altyazi !== false;
}
