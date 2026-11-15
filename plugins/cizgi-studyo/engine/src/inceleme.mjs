/**
 * Scene review: the checks behind the panel's "İncele" on one scene of a compiled draft.
 *
 *   dogrulama  the validator's errors and warnings about this scene's shots
 *   kadraj     a character not fully in frame (start, middle, end of the shot)
 *   ust-uste   two characters at about the same depth drawn over each other
 *   altyazi    a line too long for two caption lines in this format
 *   ses        a line with no recording yet (the preview guesses its length)
 *   dinleme    a recording that failed the listening check and was not accepted
 *
 * Messages are in Turkish for the person; validator messages stay as the validator wrote them.
 * Picture problems a rule cannot see (a pose that reads wrong, a cut that jars) are for the
 * stills and for Claude's look at them.
 */
import { VIEWPORTS } from "./compile.mjs";
import "./runtime/core.js";
import { captionPlace, captionShown } from "./altyazi.mjs";

/** Characters that fit in two caption lines (54/58 px bold on 88% of the width, roughly). */
export const CAPTION_MAX = Object.freeze({ "16:9": 110, "9:16": 56 });
/** How many more (or fewer) letters fit at each caption size (the usual font size over its own). */
const CAPTION_FIT = Object.freeze({ kucuk: 54 / 42, orta: 1, buyuk: 54 / 68 });
const SAMPLES = [0, 0.5, 1];
const SAME_DEPTH = 0.25; // closer in cast.back than this: drawn in one row
const OVERLAP = 0.5; // share of the narrower figure hidden behind the other

const shotOfMessage = (msg) => /(?:^|: )shot ([a-z0-9_-]+)/.exec(msg)?.[1] ?? null;

/**
 * @param {{episode:object, sceneId:string, lib:object, timing:{shots:object[]}, anchors:object[], format:string,
 *          validation:{errors:string[], warnings:string[]}, failed?:{key:string}[], unspoken?:string[]}} input
 *   timing and anchors: the compiled draft's timing.json and propLayer anchors (one per shot, in order)
 * @returns {{sahne:string, shots:string[], sorunlar:{seviye:"hata"|"uyari"|"bilgi", tur:string, shot:string|null, mesaj:string}[],
 *            sayac:{hata:number, uyari:number, bilgi:number}}}
 */
export function reviewScene({ episode, sceneId, lib, timing, anchors, format, validation, failed = [], unspoken = [] }) {
  const scene = episode.scenes.find((s) => s.scene_id === sceneId);
  if (!scene) throw new Error(`sahne yok: ${sceneId}`);
  const viewport = VIEWPORTS[format];
  if (!viewport) throw new Error(`biçim ${Object.keys(VIEWPORTS).join(" ya da ")} olmalı`);
  const ids = scene.shots.map((s) => s.shot_id);
  const mine = new Set(ids);
  const sorunlar = [];
  const add = (seviye, tur, shot, mesaj) => sorunlar.push({ seviye, tur, shot, mesaj });
  const name = (id) => episode.characters.find((c) => c.id === id)?.name || id;

  // the validator: messages about this scene's shots, or naming the scene ("scene s1" but not "scene s1-b")
  const named = `scene ${sceneId}`;
  const aboutScene = (m) => mine.has(shotOfMessage(m)) || m.split(named).slice(1).some((after) => !/^[\w-]/.test(after));
  for (const m of validation.errors || []) if (aboutScene(m)) add("hata", "dogrulama", shotOfMessage(m), m);
  for (const m of validation.warnings || []) if (aboutScene(m)) add("uyari", "dogrulama", shotOfMessage(m), m);

  const { outOfFrame, layoutFor, memberX, memberHalfWidth } = globalThis.CizgiCore;
  const layout = layoutFor(lib.world, viewport);
  timing.shots.forEach((t, i) => {
    if (!mine.has(t.shot_id)) return;
    const shot = { ...t, anchors: anchors[i] };
    for (const id of outOfFrame(shot, lib.world, lib.cameras, viewport, null)) {
      add("uyari", "kadraj", t.shot_id, `${name(id)} kadraja tam sığmıyor (${format}).`);
    }
    for (const pair of overlaps(t, layout, memberX, memberHalfWidth)) {
      add("uyari", "ust-uste", t.shot_id, `${name(pair[0])} ile ${name(pair[1])} üst üste biniyor: birini kaydır ya da arkaya al.`);
    }
  });

  // bigger captions fit fewer letters in two lines (font sizes as compile.mjs sets them)
  const captionMax = Math.round(CAPTION_MAX[format] * CAPTION_FIT[captionPlace(scene, format).boyut]);
  for (const shot of scene.shots) {
    (Array.isArray(shot.utterances) ? shot.utterances : []).forEach((u, n) => {
      if (typeof u?.text !== "string") return; // an invalid draft: the validator already says so
      const key = `${shot.shot_id}-${n}`;
      if (captionShown(episode, u) && u.text.length > captionMax) {
        add("uyari", "altyazi", shot.shot_id, `“${u.text.slice(0, 40)}…” ${u.text.length} harf: ${format} altyazıda iki satıra sığmaz; repliği böl ya da altyazıyı küçült.`);
      }
      if (unspoken.includes(key)) add("bilgi", "ses", shot.shot_id, `${name(u.speaker)} repliği henüz seslendirilmedi: süresi tahmini.`);
      if (failed.some((f) => f.key === key)) add("uyari", "dinleme", shot.shot_id, `${name(u.speaker)} repliği dinleme kontrolünden geçmedi: dinleyip kabul et ya da yeniden seslendir.`);
    });
  }

  const sayac = { hata: 0, uyari: 0, bilgi: 0 };
  for (const s of sorunlar) sayac[s.seviye]++;
  return { sahne: sceneId, shots: ids, sorunlar, sayac };
}

/** Pairs of cast members drawn over each other at some moment of the shot. */
function overlaps(t, layout, memberX, memberHalfWidth) {
  const dur = t.end - t.start;
  const found = new Map();
  for (const p of SAMPLES) {
    for (let a = 0; a < t.cast.length; a++) {
      for (let b = a + 1; b < t.cast.length; b++) {
        const A = t.cast[a];
        const B = t.cast[b];
        if (Math.abs((A.back || 0) - (B.back || 0)) >= SAME_DEPTH) continue;
        const xa = memberX(A, layout, p * dur, dur);
        const xb = memberX(B, layout, p * dur, dur);
        const ha = memberHalfWidth(A, layout);
        const hb = memberHalfWidth(B, layout);
        const shared = Math.min(xa + ha, xb + hb) - Math.max(xa - ha, xb - hb);
        if (shared > OVERLAP * 2 * Math.min(ha, hb)) found.set(`${A.id}|${B.id}`, [A.id, B.id]);
      }
    }
  }
  return [...found.values()];
}
