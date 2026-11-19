/**
 * Sound effects on the episode clock. An effect is tied to what makes the sound, so it stays on it
 * when a line's recording gets longer or shorter (a "ding" tied to seconds fell on the wrong line;
 * Hurda Kralı 1 walked its last five seconds in silence):
 *
 *   at                   seconds into the shot
 *   replik [+ kelime]    the start of a line of the shot, or of one of its words
 *   oyuncu + an          a moment of someone's actions: baslangic (the shot), grab, release, put_down
 *   oyuncu + adim        a step sound on every step of their walk (cast.walk)
 *
 * ofset moves any of them. An effect stops where its own shot ends.
 */

const STEP_DEFAULT_S = 0.6; // half a walk cycle when the action does not say (yuru: 1.2 s, two steps)
const ms = (x) => Math.round(x * 1000) / 1000;

/** Seconds between steps of a member's walk: half its looping walk action. */
function stepOf(member, lib) {
  const a = lib.actions.get(member.action);
  return a?.loop && a.duration > 0 ? a.duration / 2 : STEP_DEFAULT_S;
}

/**
 * The shot-local times one effect plays at.
 * @param {object} s the effect (shot.sfx[i])
 * @param {object} shot the timeline shot (utterances with absolute start and words relative to it)
 * @param {(member:object, an:string) => number|null} momentAt shot seconds of an action moment
 * @returns {number[]}
 * @throws when what it is tied to is not there
 */
export function effectTimes(s, shot, lib, momentAt) {
  const off = s.ofset || 0;
  if (s.at != null) return [s.at + off];
  if (s.replik != null) {
    const u = shot.utterances[s.replik];
    if (!u) throw new Error(`shot ${shot.shot_id}: sound effect "${s.sfx}" is tied to line ${s.replik}, which this shot does not have`);
    const w = s.kelime != null ? u.words?.[s.kelime] : null;
    if (s.kelime != null && w?.start == null) {
      throw new Error(`shot ${shot.shot_id}: sound effect "${s.sfx}" is tied to word ${s.kelime} of line ${s.replik}, which has no timing (${(u.words || []).length} words)`);
    }
    return [u.start - shot.start + (w ? w.start : 0) + off];
  }
  const member = shot.cast.find((m) => m.id === s.oyuncu);
  if (!member) throw new Error(`shot ${shot.shot_id}: sound effect "${s.sfx}" is tied to "${s.oyuncu}", who is not in this shot`);
  if (s.adim) {
    if (!member.walk) throw new Error(`shot ${shot.shot_id}: sound effect "${s.sfx}" steps with "${s.oyuncu}", who does not walk in this shot`);
    const time = member.walk.time ?? shot.end - shot.start;
    const step = stepOf(member, lib);
    const out = [];
    for (let t = off; t < time - 0.05; t += step) if (t >= 0) out.push(ms(t));
    return out;
  }
  if (!s.an || s.an === "baslangic") return [off];
  const t = momentAt(member, s.an);
  if (t == null) throw new Error(`shot ${shot.shot_id}: sound effect "${s.sfx}" is tied to "${s.oyuncu}"'s ${s.an}, but no action of theirs in this shot has one`);
  return [t + off];
}

/**
 * Every effect occurrence on the episode clock. Each gets its own track (lines use 1) so overlapping
 * effects never cut each other off.
 * @returns {{id:string, shot_id:string, index:number, at:number, path:string, start:number, track:number, volume:number, duration:number}[]}
 * @throws when an effect starts outside its shot or what it is tied to is missing
 */
export function placeEffects(episode, timeline, lib, momentAt) {
  const sfxOf = new Map(episode.scenes.flatMap((sc) => sc.shots).map((s) => [s.shot_id, s.sfx || []]));
  const out = [];
  for (const shot of timeline.shots) {
    const length = shot.end - shot.start;
    sfxOf.get(shot.shot_id).forEach((s, i) => {
      const { path, duration } = lib.sfx.get(s.sfx);
      effectTimes(s, shot, lib, momentAt).forEach((at, k, all) => {
        if (at >= length) throw new Error(`shot ${shot.shot_id}: sound effect "${s.sfx}" at ${ms(at)}s starts after the shot ends (${length.toFixed(2)}s)`);
        if (at < 0) throw new Error(`shot ${shot.shot_id}: sound effect "${s.sfx}" at ${ms(at)}s starts before the shot (ofset too far back)`);
        const start = ms(shot.start + at);
        out.push({
          id: all.length > 1 ? `efekt-${shot.shot_id}-${i}-${k}` : `efekt-${shot.shot_id}-${i}`, shot_id: shot.shot_id, index: i, at: ms(at), path, start, track: 2 + out.length, volume: s.volume ?? 1,
          duration: Math.min(duration, shot.end - start), // cut where its shot ends
        });
      });
    });
  }
  return out;
}
