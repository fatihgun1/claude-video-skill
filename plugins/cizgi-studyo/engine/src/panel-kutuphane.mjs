/**
 * The library as the control panel shows it: rich vocabulary for the browser cards,
 * the library files themselves (drawings and sounds, looked up by id, never by path),
 * and small compiled previews of one character doing one action.
 */
import { readFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ID_PATTERN } from "./util.mjs";
import { compileEpisode, vanishingPoint } from "./compile.mjs";

const label = (x, id) => x?.label?.tr || x?.name?.tr || id;

/** Turkish names for the sound effect ids (the cards show them; the id stays the key). */
const SFX_LABELS = {
  "adim-cim": "Adım (çim)", "adim-beton": "Adım (beton)", "adim-tahta": "Adım (tahta)", "adim-hali": "Adım (halı)",
  "kapi-ac": "Kapı açılır", "kapi-kapa": "Kapı kapanır", "kitap-ac": "Kitap açılır", sayfa: "Sayfa çevrilir",
  kumas: "Kumaş hışırtısı", gicirti: "Gıcırtı", pat: "Pat (yumuşak düşüş)", tok: "Tok (tahta)", zil: "Zil",
  cam: "Cam şıngırtısı", metal: "Metal tıngırtısı", tik: "Tık", pop: "Pop", onay: "Onay sesi", soru: "Soru sesi", dusur: "Düşürme",
};

const COLOUR = /^#[0-9a-f]{6}$/i;

/**
 * The colours a rig lets an episode change (character.json palette_vars), each with the
 * colour the drawing uses when the episode sets none (its var(--name, #hex) fallback).
 * @returns {Record<string, string|null>}
 */
export function paletteOf(rig) {
  const defaults = {};
  for (const m of rig.svg.matchAll(/var\(--([a-z][a-z0-9-]*)\s*,\s*(#[0-9a-fA-F]{6})\)/g)) defaults[m[1]] ??= m[2].toLowerCase();
  return Object.fromEntries((rig.meta.palette_vars || []).map((v) => [v, COLOUR.test(defaults[v] || "") ? defaults[v] : null]));
}

/**
 * Everything the library browser and the dropdowns may offer: only library words, never free text.
 * @param {ReturnType<import("./library.mjs").loadLibrary>} lib
 */
export function vocabulary(lib) {
  return {
    rigs: [...lib.characters].map(([id, c]) => ({
      id, label: label(c.meta, id), view: c.meta.view || "front", person: c.meta.same_as || id,
      palette: paletteOf(c),
    })),
    // views: the rig views an action is drawn for (null = every view); the Hareket tab offers only those that fit.
    actions: [...lib.actions].map(([id, a]) => ({ id, label: label(a, id), duration: a.duration, loop: !!a.loop, grab: !!a.grab, views: a.views || null })),
    // layers: back to front, with their depth (a one-file background has one, "tum")
    backgrounds: [...lib.backgrounds].map(([id, svg]) => ({
      id, label: lib.backgroundNames?.get(id) || id, depth: vanishingPoint(svg) !== null,
      layers: (lib.layers?.get(id) || []).map((l) => ({ id: l.id, derinlik: l.derinlik })),
    })),
    props: [...lib.props].map(([id, p]) => ({ id, label: id, holdable: !!p.grip })),
    sfx: [...(lib.sfx || new Map())].map(([id, s]) => ({ id, label: SFX_LABELS[id] || id, duration: Math.round(s.duration * 100) / 100 })),
    music: [...(lib.music || new Map())].map(([id, s]) => ({ id, label: id, duration: Math.round(s.duration * 10) / 10 })),
    framings: Object.entries(lib.cameras.framings).map(([id, v]) => ({ id, label: label(v, id), zoom: v.zoom ?? 1, anchor: v.anchor || null })),
    moves: Object.entries(lib.cameras.moves).map(([id, v]) => ({
      id, label: label(v, id),
      zoom_from: v.zoom_from, zoom_to: v.zoom_to, pan_from: v.pan_from, pan_to: v.pan_to, dolly_to: v.dolly_to,
    })),
    marks: Object.keys(lib.world.marks),
    // Where the marks are (world units), so dragging on the stage can snap to them.
    world: {
      ground_y: lib.world.ground_y,
      // how far up a character at cast.back = 1 stands (landscape world units), from the runtime itself
      back_rise: globalThis.CizgiCore.depthOf({ back: 1 }, { ratio: 1 }).rise,
      marks: lib.world.marks,
      portrait: lib.world.portrait ? { marks: lib.world.portrait.marks, scale: lib.world.portrait.character_scale } : null,
    },
    facings: ["sag", "sol"],
    profiles: [...lib.profiles.keys()],
  };
}

/**
 * A library loader that loads again only when a library file changed (added, removed or
 * edited), so a page of thumbnails does not reload the whole library per picture while
 * an edited rig or action still shows up without a restart.
 * @param {string} dir library folder
 * @param {(dir:string) => object} load
 * @returns {() => object}
 */
const SIGNATURE_MS = 500;

export function cachedLibrary(dirs, load) {
  const list = Array.isArray(dirs) ? dirs : [dirs]; // the plugin's library, then the project's (may not exist yet)
  let sig = null;
  let lib = null;
  // every file's path and time: a draft moved into the library keeps its times but changes its path.
  // Drafts (taslak/) are not part of the library. A folder moved away mid-walk is simply skipped.
  const signature = () => {
    const hash = createHash("sha256");
    const walk = (d) => {
      let found;
      try {
        found = readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of found) {
        const p = join(d, e.name);
        if (e.isDirectory()) {
          if (e.name !== "taslak") walk(p);
          continue;
        }
        try {
          hash.update(`${p}\0${statSync(p).mtimeMs}\n`);
        } catch {
          /* gone meanwhile */
        }
      }
    };
    for (const d of list) if (existsSync(d)) walk(d);
    return hash.digest("hex");
  };
  // a page asks for many thumbnails at once: look at the disk at most twice a second
  // (fresh: look now, e.g. right after a drawing was taken into the library)
  let lookedAt = 0;
  return (fresh = false) => {
    const t = Date.now();
    if (lib && !fresh && t - lookedAt < SIGNATURE_MS) return lib;
    lookedAt = t;
    const now = signature();
    if (now !== sig || !lib) {
      lib = load(list[0]);
      sig = now;
    }
    return lib;
  };
}

const KINDS = {
  karakter: { ext: ".svg", type: "image/svg+xml", get: (lib, id) => lib.characters.get(id)?.svg },
  mekan: { ext: ".svg", type: "image/svg+xml", get: (lib, id) => lib.backgrounds.get(id) },
  nesne: { ext: ".svg", type: "image/svg+xml", get: (lib, id) => lib.props.get(id)?.svg },
  ses: { ext: ".wav", type: "audio/wav", get: (lib, id) => (lib.sfx?.get(id) ? readFileSync(lib.sfx.get(id).path) : undefined) },
  muzik: { ext: ".wav", type: "audio/wav", get: (lib, id) => (lib.music?.get(id) ? readFileSync(lib.music.get(id).path) : undefined) },
};

/**
 * A library file by kind and id ("karakter/ela.svg"). Ids are looked up in the loaded
 * library, so no request can reach a file outside it.
 * @returns {{body: string|Buffer, type: string} | null}
 */
export function libraryFile(lib, kind, file) {
  const k = Object.hasOwn(KINDS, kind) ? KINDS[kind] : null;
  if (!k || !file.endsWith(k.ext)) return null;
  const id = file.slice(0, -k.ext.length);
  if (!ID_PATTERN.test(id)) return null;
  const body = k.get(lib, id);
  return body === undefined ? null : { body, type: k.type };
}

/**
 * Compile a one-shot episode of one character doing one action, for the hover preview
 * of an action card. Errors (an action that breaks the rig's joint limits, say) come back
 * as {ok:false} so the card can tell the person why it does not fit.
 * @param {object} lib
 * @param {{rig:string, action:string, bg?:string}} q
 * @param {{episodePath:string, dir:string, compile?:typeof compileEpisode}} where
 */
export function actionPreview(lib, q, where) {
  const { rig, action } = q;
  if (!ID_PATTERN.test(rig || "") || !lib.characters.has(rig)) return { ok: false, error: `unknown character "${rig}"` };
  if (!ID_PATTERN.test(action || "") || !lib.actions.has(action)) return { ok: false, error: `unknown action "${action}"` };
  const bg = q.bg && lib.backgrounds.has(q.bg) ? q.bg : [...lib.backgrounds.keys()][0];
  const a = lib.actions.get(action);
  const episode = {
    episode: "hareket-onizleme",
    language: "tr",
    characters: [{ id: "oyuncu", rig }],
    scenes: [{ scene_id: "s", bg, shots: [{
      shot_id: "s_sh1",
      cast: [{ id: "oyuncu", action, mark: "orta" }],
      camera: { framing: "medium", move: "static", target: "oyuncu" },
      hold: Math.min(10, Math.max(1, a.duration)),
    }] }],
  };
  const name = `${rig}__${action}__${bg}`;
  const out = join(where.dir, name);
  const url = `/hareket-onizleme/${name}/index.html`;
  // The same library object means nothing changed since this preview was compiled.
  const seen = where.cache?.get(name);
  if (seen && seen.lib === lib && existsSync(join(out, "index.html"))) return seen.result;
  try {
    mkdirSync(out, { recursive: true });
    const res = (where.compile || compileEpisode)(where.episodePath, lib, out, { format: "16:9", episode });
    const result = { ok: true, url, duration: res.duration, loop: !!a.loop };
    where.cache?.set(name, { lib, result });
    return result;
  } catch (err) {
    return { ok: false, error: explain(err.message, rig) };
  }
}

const JOINTS = {
  arm_L_upper: "yakın omuz", arm_L_lower: "yakın dirsek", arm_R_upper: "uzak omuz", arm_R_lower: "uzak dirsek",
  leg_L_upper: "yakın kalça", leg_L_lower: "yakın diz", leg_R_upper: "uzak kalça", leg_R_lower: "uzak diz",
  hand_L: "yakın bilek", hand_R: "uzak bilek", head: "baş", body: "gövde", leg_L: "yakın bacak", leg_R: "uzak bacak",
};

/** A short Turkish reason for the card instead of the validator's full message. */
export function explain(message, rig) {
  const limit = /bends (\w+) to (-?[\d.]+)° .*? allows (-?[\d.]+)\.\.(-?[\d.]+)°/.exec(message);
  if (limit) {
    const [, ch, want, lo, hi] = limit;
    return `Bu karaktere uymuyor: ${JOINTS[ch] || ch} ${want}° istiyor, ${rig} en çok ${lo}..${hi}° bükülüyor.`;
  }
  return `Önizlenemedi: ${message.replace(/^episode is invalid:\n- /, "").split("\n")[0]}`;
}
