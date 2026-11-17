// Records the person's voice from the microphone as 16-bit mono PCM WAV (what the voice cloner
// reads), with a live level for the meter. No library: an AudioContext collects the samples.
const RATE = 16000;
export const MAX_RECORD_S = 20;

/**
 * Start recording. Ask for the microphone first; the browser shows its own permission prompt.
 * @param {{onLevel?:(level:number, seconds:number) => void}} [opts]
 * @returns {Promise<{stop:() => Promise<{blob:Blob, base64:string, seconds:number}>, cancel:() => void}>}
 */
export async function startRecording({ onLevel } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Bu tarayıcı mikrofonu açamıyor.");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const ctx = new AudioContext({ sampleRate: RATE });
  const source = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  let length = 0;
  let done = null;
  node.onaudioprocess = (e) => {
    const data = new Float32Array(e.inputBuffer.getChannelData(0));
    chunks.push(data);
    length += data.length;
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v));
    const seconds = length / ctx.sampleRate;
    onLevel?.(peak, seconds);
    if (seconds >= MAX_RECORD_S) done?.();
  };
  source.connect(node);
  node.connect(ctx.destination);

  function close() {
    node.disconnect();
    source.disconnect();
    for (const t of stream.getTracks()) t.stop();
    ctx.close().catch(() => {});
  }

  return {
    stop() {
      return new Promise((resolve) => {
        done = null;
        close();
        const pcm = new Float32Array(length);
        let at = 0;
        for (const c of chunks) {
          pcm.set(c, at);
          at += c.length;
        }
        const blob = encodeWav(pcm, ctx.sampleRate);
        blob.arrayBuffer().then((buf) => resolve({ blob, base64: toBase64(buf), seconds: length / ctx.sampleRate }));
      });
    },
    cancel: close,
    /** Called once when the time limit is reached (the caller then stops). */
    set onLimit(fn) {
      done = fn;
    },
  };
}

/**
 * A sound file the person picks (a phone recording: m4a, mp3, wav…) as the same 16-bit mono WAV,
 * cut to the first MAX_RECORD_S seconds. The browser decodes it; nothing is uploaded but the result.
 * @param {File} file
 * @returns {Promise<{blob:Blob, base64:string, seconds:number}>}
 */
export async function fileToWav(file) {
  const ac = new AudioContext();
  let audio;
  try {
    audio = await ac.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error("Bu dosya bir ses dosyası olarak açılamadı.");
  } finally {
    ac.close().catch(() => {});
  }
  const seconds = Math.min(audio.duration, MAX_RECORD_S);
  const off = new OfflineAudioContext(1, Math.ceil(seconds * RATE), RATE); // one channel: mixed down
  const src = off.createBufferSource();
  src.buffer = audio;
  src.connect(off.destination);
  src.start();
  const out = await off.startRendering();
  const blob = encodeWav(out.getChannelData(0), RATE);
  return { blob, base64: toBase64(await blob.arrayBuffer()), seconds };
}

function encodeWav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const text = (at, s) => [...s].forEach((ch, i) => v.setUint8(at + i, ch.charCodeAt(0)));
  text(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true));
  return new Blob([buf], { type: "audio/wav" });
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
