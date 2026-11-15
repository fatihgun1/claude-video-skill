/**
 * Timing is derived, never written by the LLM: shot length = lead + speech + gaps + hold + tail.
 */

export const TIMING = Object.freeze({
  lead: 0.4, // silence before the first line of a shot
  gap: 0.3, // silence between lines in the same shot
  defaultHold: 1.5, // time after speech for the viewer to imitate
  tail: 0.4,
  minShot: 2.5,
});

/**
 * Duration in seconds of a RIFF/WAVE buffer (any sample format).
 * @param {Uint8Array} buf
 * @returns {number}
 */
export function wavDuration(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
  if (buf.byteLength < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");
  let byteRate = 0;
  let offset = 12;
  while (offset + 8 <= buf.byteLength) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") {
      if (size < 16 || offset + 20 > buf.byteLength) throw new Error("WAV fmt chunk is truncated");
      byteRate = view.getUint32(offset + 16, true);
      if (!byteRate) throw new Error("WAV byte rate is 0");
    }
    if (id === "data") {
      if (!byteRate) throw new Error("WAV data chunk before fmt chunk");
      const available = Math.min(size, buf.byteLength - offset - 8);
      return available / byteRate;
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
}

/** Round to milliseconds so the clock never accumulates float noise. */
const ms = (x) => Math.round(x * 1000) / 1000;

/**
 * Lay out every shot and line on the episode clock.
 * @param {object} episode validated episode
 * @param {(audioPath: string) => {duration: number, words?: object[], cues?: object[]}} audioInfo
 * @returns {{duration: number, shots: object[]}}
 */
export function buildTimeline(episode, audioInfo) {
  const shots = [];
  let clock = 0;
  for (const scene of episode.scenes) {
    for (const shot of scene.shots) {
      const start = clock;
      let cursor = ms(start + TIMING.lead);
      const utterances = (shot.utterances || []).map((u, i) => {
        if (i > 0) cursor = ms(cursor + TIMING.gap);
        const info = audioInfo(u.audio);
        const line = { ...u, start: cursor, end: ms(cursor + info.duration), words: info.words || [], cues: info.cues || [] };
        cursor = line.end;
        return line;
      });
      const hold = shot.hold == null ? TIMING.defaultHold : shot.hold;
      const end = ms(Math.max(cursor + hold + TIMING.tail, start + TIMING.minShot));
      shots.push({ scene_id: scene.scene_id, bg: scene.bg, ...shot, start, end, utterances });
      clock = end;
    }
  }
  return { duration: clock, shots };
}
