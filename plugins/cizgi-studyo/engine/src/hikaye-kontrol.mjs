/**
 * The story against the episode (plan v3, Faz 2.2-2.3). Warnings, so an open one holds the gates:
 *   - the length: about how long the film will be against hikaye.istekler.sure (Hurda Kralı 1: 40 s
 *     asked, 107 s made; nobody was told before the voices were spoken)
 *   - the cards: each card's people (kim), objects (nesneler) and place (mekan) on screen in the scene
 *     it became (Hurda Kralı 1: the box and the shop of the cards never came on screen). A card left
 *     out on purpose carries `atlandi: "<why>"`.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildTimeline, wavDuration } from "./timing.mjs";
import { momentsOf } from "./compile.mjs";
import { profileOf } from "./validate.mjs";
import { storyPathOf } from "./hikaye.mjs";

// Seconds per letter and per pause mark, least squares over 39 recorded lines (Edge TTS, Hurda Kralı
// 1 and kpss-ajani): the total of an episode comes within a few per cent; a single line, ±50%.
const S_PER_LETTER = 0.101;
const S_PER_PAUSE = 0.177;
const MIN_LINE_S = 1;
const TOO_LONG = 1.15; // above this share of the asked length the episode is told
const VIEW_SUFFIX = /-(on|arka)$/;

/** About how long a line takes to say, before it is spoken. */
export function estimateLine(text) {
  const letters = text.replace(/[^\p{L}\p{N}]/gu, "").length;
  const pauses = (text.match(/[.,!?…;:]/g) || []).length;
  return Math.max(MIN_LINE_S, Math.round((letters * S_PER_LETTER + pauses * S_PER_PAUSE) * 100) / 100);
}

/** The film's length: each recorded line by its file, the others guessed (seconds). */
export function episodeLength(episode, episodePath, lib = null) {
  const dir = dirname(resolve(episodePath));
  const audio = (u, shot, i) => {
    const file = join(dir, "ses", `${shot.shot_id}-${i}.wav`);
    try {
      if (existsSync(file)) return { duration: wavDuration(readFileSync(file)) };
    } catch {
      /* a broken file: guess, the audio step reports it */
    }
    return { duration: estimateLine(u.text) };
  };
  // with the library: the profile's pauses and the grabs and put-aways that keep a shot on, as the film has them
  return lib?.actions ? buildTimeline(episode, audio, profileOf(episode, lib).timing, momentsOf(lib)).duration : buildTimeline(episode, audio).duration;
}

/** Lower case, Turkish letters folded to ASCII: "Şişe" and "sise" meet. */
const fold = (s) => String(s).toLocaleLowerCase("tr").replace(/ş/g, "s").replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ü/g, "u").replace(/â/g, "a").replace(/î/g, "i").replace(/û/g, "u");

/** The person (rig family) of a rig. */
const personOf = (lib, rig) => lib.characters?.get(rig)?.meta?.same_as || String(rig).replace(VIEW_SUFFIX, "");

/** Whether an object word of a card is on screen in a scene (a prop or decor whose id holds the word). */
function onScreen(scene, word) {
  const w = fold(word).trim();
  const ids = [...(scene.dekor || []).map((d) => d.prop), ...scene.shots.flatMap((s) => (s.props || []).map((p) => p.prop))].map(fold);
  return ids.some((id) => id === w || id.split(/[-_]/).includes(w) || id.includes(w));
}

function cardWarnings(episode, story, lib) {
  const out = [];
  const scenes = new Map(episode.scenes.map((s) => [s.scene_id, s]));
  // a card's name → the people (rig families) it may be on screen as
  const people = new Map();
  for (const c of story.karakterler || []) if (c.rig) people.set(c.ad, new Set([personOf(lib, c.rig)]));
  for (const c of episode.characters) {
    for (const name of [c.name, c.id].filter(Boolean)) {
      const key = [...people.keys()].find((k) => fold(k) === fold(name)) ?? name;
      people.set(key, new Set([...(people.get(key) || []), personOf(lib, c.rig)]));
    }
  }
  const rigOf = new Map(episode.characters.map((c) => [c.id, c.rig]));
  for (const card of story.kartlar || []) {
    if (card.atlandi) continue;
    if (!card.sahne) {
      out.push(`hikaye: card ${card.id} is not linked to a scene (sahne); write the scene it became, or atlandi with why it was left out`);
      continue;
    }
    const scene = scenes.get(card.sahne);
    if (!scene) {
      out.push(`hikaye: card ${card.id}: scene ${card.sahne} is not in the episode`);
      continue;
    }
    const inScene = new Set(scene.shots.flatMap((s) => s.cast.map((m) => personOf(lib, rigOf.get(m.id)))));
    for (const name of card.kim || []) {
      const want = people.get(name) || [...people.entries()].find(([k]) => fold(k) === fold(name))?.[1];
      if (want && ![...want].some((p) => inScene.has(p))) out.push(`hikaye: card ${card.id}: "${name}" is not in scene ${card.sahne}`);
    }
    for (const word of card.nesneler || []) {
      if (!onScreen(scene, word)) out.push(`hikaye: card ${card.id}: "${word}" is not on screen in scene ${card.sahne} (a prop or decor); show it, or atlandi with why`);
    }
    // a place given as a background id (not a description) must be the scene's background, or an angle of it
    if (card.mekan && /^[a-z0-9]+([_-][a-z0-9]+)*$/.test(card.mekan) && !(scene.bg === card.mekan || scene.bg.startsWith(`${card.mekan}-`))) {
      out.push(`hikaye: card ${card.id}: the place "${card.mekan}" is not scene ${card.sahne}'s background (${scene.bg})`);
    }
  }
  return out;
}

/**
 * The story warnings of an episode (none without hikaye.json; its absence is a decision problem).
 * @param {string} episodePath
 * @param {object} episode
 * @param {{characters?: Map}} lib
 * @returns {string[]}
 */
export function storyWarnings(episodePath, episode, lib) {
  const path = storyPathOf(episodePath);
  if (!existsSync(path)) return [];
  let story;
  try {
    story = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return []; // a broken story file is reported where it is read (readStory)
  }
  const out = [];
  const asked = story.istekler?.sure;
  if (asked) {
    const length = episodeLength(episode, episodePath, lib);
    if (length > asked * TOO_LONG) {
      out.push(`sure: about ${Math.round(length)} s, the person asked for ${asked} s (${(length / asked).toFixed(1)}×); shorten (fewer lines and shots, about 2 spoken words a second) or the person accepts the length`);
    }
  }
  return [...out, ...cardWarnings(episode, story, lib)];
}
