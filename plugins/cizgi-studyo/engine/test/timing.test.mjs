import { test } from "node:test";
import assert from "node:assert/strict";
import { wavDuration, buildTimeline, TIMING } from "../src/timing.mjs";

function wav(seconds, { sampleRate = 24000, bytesPerSample = 4, extraChunk = false } = {}) {
  const dataBytes = Math.round(seconds * sampleRate) * bytesPerSample;
  const extra = extraChunk ? 8 + 3 + 1 : 0; // odd-sized LIST chunk + pad byte
  const buf = new Uint8Array(12 + 24 + extra + 8 + dataBytes);
  const v = new DataView(buf.buffer);
  const put = (o, s) => [...s].forEach((c, i) => (buf[o + i] = c.charCodeAt(0)));
  put(0, "RIFF");
  put(8, "WAVE");
  put(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint32(28, sampleRate * bytesPerSample, true);
  let o = 36;
  if (extraChunk) {
    put(o, "LIST");
    v.setUint32(o + 4, 3, true);
    o += 12;
  }
  put(o, "data");
  v.setUint32(o + 4, dataBytes, true);
  return buf;
}

test("wavDuration reads byte rate and data size, skipping other chunks", () => {
  assert.equal(wavDuration(wav(2)), 2);
  assert.equal(wavDuration(wav(1.5, { extraChunk: true })), 1.5);
});

test("wavDuration rejects non-WAV and broken files", () => {
  assert.throws(() => wavDuration(new Uint8Array(4)), /not a WAV/);
  const noData = wav(1).slice(0, 36);
  assert.throws(() => wavDuration(noData), /no data chunk/);
  const dataFirst = wav(1);
  dataFirst.set([..."data"].map((c) => c.charCodeAt(0)), 12);
  assert.throws(() => wavDuration(dataFirst), /before fmt/);
});

const ep = {
  scenes: [
    {
      scene_id: "s1",
      bg: "cayir",
      shots: [
        {
          shot_id: "a",
          hold: 2,
          utterances: [
            { speaker: "anlatici", text: "x", audio: "1.wav" },
            { speaker: "anlatici", text: "y", audio: "2.wav" },
          ],
        },
        { shot_id: "b" },
      ],
    },
  ],
};
const info = (u) => ({ duration: u.audio === "1.wav" ? 1 : 2, words: [{ start: 0 }] });

test("buildTimeline places lines with lead, gap, hold and tail", () => {
  const tl = buildTimeline(ep, info);
  const [a, b] = tl.shots;
  assert.equal(a.utterances[0].start, TIMING.lead);
  assert.equal(a.utterances[1].start, 1.7);
  assert.equal(a.end, 6.1);
  assert.equal(a.utterances[0].words.length, 1);
  assert.deepEqual(a.utterances[0].cues, []);
  assert.equal(b.start, a.end);
  assert.ok(Math.abs(b.end - b.start - (TIMING.lead + TIMING.default_hold + TIMING.tail)) < 1e-9);
  assert.equal(tl.duration, b.end);
  assert.equal(a.bg, "cayir");
});

test("a shot never ends before min_shot", () => {
  const tl = buildTimeline({ scenes: [{ scene_id: "s", bg: "b", shots: [{ shot_id: "x", hold: 0 }] }] }, info, { ...TIMING, min_shot: 3 });
  assert.equal(tl.shots[0].end, 3);
});
