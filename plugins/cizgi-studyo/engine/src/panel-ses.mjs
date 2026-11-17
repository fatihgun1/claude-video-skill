/**
 * A voice the person records in the panel (the character window's "Sesimi kaydet"): the browser
 * records a few seconds from the microphone and sends them as 16-bit PCM WAV; it is kept next to
 * the episode as sesler/<character>.wav, and the character's voice.ref points at it (Chatterbox
 * clones the voice from it).
 *
 *   POST /api/ses-kayit  {b, karakter, wav: base64}  → {ref: "sesler/<karakter>.wav", sure}
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { HttpError } from "./panel-proje.mjs";

const CHARACTER = /^[a-z0-9]+([_-][a-z0-9]+)*$/;
export const MIN_SECONDS = 3;
export const MAX_SECONDS = 20;

/**
 * The length of a PCM WAV in seconds, or why it is not one we take.
 * @param {Buffer} buf
 * @returns {number}
 */
export function wavSeconds(buf) {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("kayıt bir WAV dosyası değil");
  // walk the chunks: fmt first, then data
  let at = 12;
  let fmt = null;
  while (at + 8 <= buf.length) {
    const id = buf.toString("ascii", at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === "fmt ") {
      fmt = { format: buf.readUInt16LE(at + 8), channels: buf.readUInt16LE(at + 10), rate: buf.readUInt32LE(at + 12), bits: buf.readUInt16LE(at + 22) };
    }
    if (id === "data") {
      if (!fmt || fmt.format !== 1 || fmt.bits !== 16 || fmt.channels < 1 || fmt.rate < 8000) throw new Error("kayıt 16 bit PCM olmalı");
      const bytes = Math.min(size, buf.length - at - 8);
      return bytes / (fmt.rate * fmt.channels * 2);
    }
    at += 8 + size + (size % 2);
  }
  throw new Error("kayıtta ses yok");
}

/** @param {{episodeOf:(rel:string) => {path:string}}} opts */
export function voiceRoutes({ episodeOf }) {
  return {
    "POST /api/ses-kayit": (body) => {
      const ep = episodeOf(body?.b);
      const id = String(body?.karakter ?? "");
      if (!CHARACTER.test(id) || id.length > 60) throw new HttpError(400, "karakter bir karakter kimliği olmalı");
      if (typeof body?.wav !== "string" || !body.wav) throw new HttpError(400, "kayıt yok");
      const buf = Buffer.from(body.wav, "base64");
      let sure;
      try {
        sure = wavSeconds(buf);
      } catch (err) {
        throw new HttpError(400, err.message);
      }
      if (sure < MIN_SECONDS) throw new HttpError(400, `kayıt çok kısa: en az ${MIN_SECONDS} saniye konuş`);
      if (sure > MAX_SECONDS + 1) throw new HttpError(400, `kayıt çok uzun: en çok ${MAX_SECONDS} saniye`);
      const dir = join(dirname(ep.path), "sesler");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${id}.wav`), buf);
      return { ref: `sesler/${id}.wav`, sure: Math.round(sure * 10) / 10 };
    },
  };
}
