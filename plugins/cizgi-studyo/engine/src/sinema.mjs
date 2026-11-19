/**
 * Film-grammar checks (skill: cizgi-sinema). They warn; a person decides at the gates.
 *   - establishing first: the opening shot is not a close-up or an insert
 *   - motivated insert: a shot aimed at a prop follows a shot with a character in it
 *   - 30° rule: consecutive shots of the same subject change framing or view
 *   - 180° / screen direction: a person does not flip direction between consecutive shots
 *     unless a neutral (front/back) view sits between
 *   - composition: a scene not seen only from the side; a conversation with an over-the-shoulder shot
 *   - a street running into depth is walked along, not crossed sideways
 *   - a crowd moves; a back-and-forth of lines is cut as shot / reverse shot
 *   - a crowd walks the way its figures face, and into depth only on a deep street
 *   - a child's action is not given to a grown-up drawing
 *   - someone sitting or fallen gets up on screen before standing again
 *   - nobody stands inside a bench, chair or table
 *   - the reverse shots of a conversation match in size
 */
import { shotBg } from "./arka-plan.mjs";
import { readyShots, facesOf } from "./compile.mjs";

const CLOSE_FRAMINGS = new Set(["close", "detay"]);
const NEUTRAL_VIEWS = new Set(["front", "back"]);
const SIDE_ONLY_SHOTS = 3; // a scene of this many shots or more, all from the side, reads flat
const EXCHANGE_LINES = 2; // lines by two people in one static shot: a talking tableau
const CROWD = /kalabalik/; // library props that are a crowd of people
const CROWD_SIDE = /yandan|yuruyen/; // a crowd drawn walking sideways (profile): the only one that may move sideways
const FURNITURE = /bank|sandalye|koltuk|yatak|kanepe|tabure/; // seats and beds: one sits or lies on them, never stands in them (a table is stood at)
const FURNITURE_HALF = 160; // world units: closer to its middle than this, a standing person is in it (a bench is ~300 wide)
const TALL_FACE_Y = 300; // a rig whose eyes are above this (rig units) is a tall, grown-up drawing
const DOWN_Y = 80; // an action that ends with the body this far down (rig units) leaves its person sitting or lying
const TALK_FRAMINGS = new Set(["close", "gogus", "medium", "detay"]);
const ONE_ANGLE_SHOTS = 3; // this many shots on one picture with the same people the same way round: only the zoom changes
const IDLE = /^bekle/; // standing-and-waiting actions: someone doing nothing while another speaks

/** The action's pose at its end (last key), or null. */
const lastPose = (lib, id) => lib.actions?.get(id)?.keys?.at(-1)?.pose || null;
/** Whether a cast member ends the shot sitting or lying (its last action leaves the body down). */
function endsDown(member, lib) {
  const seq = [member.action, ...(member.actions || []).map((a) => a.action)];
  return (lastPose(lib, seq.at(-1))?.root_y || 0) > DOWN_Y;
}
/** Whether a cast member starts the shot standing. */
const startsUp = (member, lib) => ((lib.actions?.get(member.action)?.keys?.[0]?.pose?.root_y) || 0) < DOWN_Y && !member.from;
/** Whether a cast member starts the shot sitting or lying (its first action begins with the body down). */
const startsDown = (member, lib) => ((lib.actions?.get(member.action)?.keys?.[0]?.pose?.root_y) || 0) > DOWN_Y;
const BEND_MIN = 40; // degrees of forward lean that take the head down to another person's waist
/** The deepest forward lean (body angle) in a member's actions, if it bends at least BEND_MIN, else 0. */
function deepestBend(member, lib) {
  const seq = [member.action, ...(member.actions || []).map((a) => a.action)];
  const most = Math.max(0, ...seq.flatMap((a) => (lib.actions?.get(a)?.keys || []).map((k) => k.pose?.body || 0)));
  return most >= BEND_MIN ? most : 0;
}
/** Rig units from the hips (body pivot) up to the face: how far a bend swings the head. */
function torsoOfRig(rig) {
  const hipY = Number(/<g id="body" data-pivot="[^,"]+,([^"]+)"/.exec(rig?.svg || "")?.[1]);
  const faceY = rig?.meta?.face_y;
  return Number.isFinite(hipY) && Number.isFinite(faceY) && hipY > faceY ? hipY - faceY : 400;
}
/** A child's action, by its label ("Koş (çocuk, profil)"). */
const childAction = (lib, id) => /çocuk|child/i.test(JSON.stringify(lib.actions?.get(id)?.label || ""));

/**
 * Whether a background is a street running into depth: drawn in perspective (data-vp) and not
 * marked side-on (mekan.json yol: "yan" → data-yol="yan", a shop front whose kerbs still have a vanishing point).
 */
const deep = (lib, bg) => {
  const svg = lib.backgrounds?.get(bg) || "";
  return /<svg\b[^>]*\bdata-vp=/.test(svg) && !/<svg\b[^>]*\bdata-yol="yan"/.test(svg);
};

/** The person behind a character entry: rigs that are views of the same person share it. */
function identityOf(character, lib) {
  const meta = lib.characters.get(character.rig)?.meta || {};
  return meta.same_as || character.rig;
}

/** "right", "left" or null (neutral view) for a cast member. */
function directionOf(member, character, lib) {
  const view = lib.characters.get(character.rig)?.meta?.view || "front";
  if (NEUTRAL_VIEWS.has(view)) return null;
  const drawn = view.endsWith("-left") ? "left" : "right";
  if (member.facing !== "sol") return drawn;
  return drawn === "right" ? "left" : "right";
}

const SAMPLES = [0, 0.5, 1];
const SAME_DEPTH = 0.25; // closer in cast.back than this: drawn in one row
const OVERLAP = 0.5; // share of the narrower figure hidden behind the other
export const OVERLAP_MARK = "are drawn over each other";

/** Pairs of cast members drawn over each other at the start, middle or end of a shot dur seconds long. */
export function overlaps(cast, layout, memberX, memberHalfWidth, dur = 1) {
  const found = new Map();
  for (const p of SAMPLES) {
    for (let a = 0; a < cast.length; a++) {
      for (let b = a + 1; b < cast.length; b++) {
        const A = cast[a];
        const B = cast[b];
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

/**
 * @param {object} episode validated episode
 * @param {ReturnType<import("./library.mjs").loadLibrary>} lib
 * @returns {string[]} warnings prefixed with "film:"
 */
export function filmWarnings(episode, lib) {
  // camera-ready shots per format, made once (compile.readyShots); null when they cannot be made
  const ready = {};
  const readyOf = (f) => {
    if (!(f in ready)) {
      try {
        ready[f] = new Map(readyShots(episode, lib, f === "9:16" ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 }).map((s) => [s.shot_id, s]));
      } catch {
        ready[f] = null; // an episode the compiler would refuse: its errors are reported elsewhere
      }
    }
    return ready[f];
  };
  const chars = Object.fromEntries(episode.characters.map((c) => [c.id, c]));
  const shots = episode.scenes.flatMap((s) => s.shots);
  const sceneOf = new Map(episode.scenes.flatMap((s) => s.shots.map((sh) => [sh.shot_id, s.scene_id])));
  const warnings = [];
  const isPropShot = (shot) => (shot.props || []).some((p) => p.id === shot.camera.target);
  const subjectOf = (shot) => {
    if (isPropShot(shot)) return `prop:${shot.camera.target}`;
    const id = shot.camera.target || (shot.cast.length === 1 ? shot.cast[0].id : null);
    return id && chars[id] ? identityOf(chars[id], lib) : null;
  };
  const viewOf = (shot) => {
    const id = shot.camera.target || shot.cast[0]?.id;
    return chars[id]?.rig || null;
  };

  shots.forEach((shot, i) => {
    const where = `film: shot ${shot.shot_id}`;
    for (const m of shot.cast) {
      const view = lib.characters.get(chars[m.id]?.rig)?.meta?.view || "front";
      if (m.walk && !view.startsWith("profile")) {
        warnings.push(`${where}: "${m.id}" is seen ${view} but walks sideways (looks like side-stepping); walk sideways only in a profile view, or keep them in place and use a dolly move to walk into depth`);
      }
    }
    if (i === 0 && (CLOSE_FRAMINGS.has(shot.camera.framing) || isPropShot(shot))) {
      warnings.push(`${where}: opens on a ${isPropShot(shot) ? "prop" : shot.camera.framing} shot; establish place and character first (wide or tracking)`);
    }
    if (i > 0 && isPropShot(shot) && shots[i - 1].cast.length === 0) {
      warnings.push(`${where}: insert on "${shot.camera.target}" is not motivated; show a character looking at or reaching for it first`);
    }
    if (i === 0) return;
    const prev = shots[i - 1];
    // a cut to another scene (another place or time) is neither a jump cut nor a flip of direction
    if (sceneOf.get(prev.shot_id) !== sceneOf.get(shot.shot_id)) return;
    const subject = subjectOf(shot);
    if (subject && subject === subjectOf(prev) && shot.camera.framing === prev.camera.framing && viewOf(shot) === viewOf(prev)) {
      warnings.push(`${where}: same subject, framing and view as ${prev.shot_id} (jump cut); change the framing size or the view`);
    }
    for (const member of shot.cast) {
      const me = chars[member.id];
      const before = prev.cast.find((m) => chars[m.id] && identityOf(chars[m.id], lib) === identityOf(me, lib));
      if (!before) continue;
      const d0 = directionOf(before, chars[before.id], lib);
      const d1 = directionOf(member, me, lib);
      if (d0 && d1 && d0 !== d1) {
        warnings.push(`${where}: "${member.id}" faces ${d1} but faced ${d0} in ${prev.shot_id} (screen direction flips; put a front or back view between, or keep the direction)`);
      }
    }
  });
  warnings.push(...compositionWarnings(episode, lib, chars, readyOf));
  return warnings;
}

/**
 * Scene-wide composition (told on the scene's first shot): a scene seen only from the side, and a
 * conversation without an over-the-shoulder shot. Both made Test 11's film look flat.
 */
function compositionWarnings(episode, lib, chars, readyOf = () => null) {
  const out = [];
  const viewOf = (m) => lib.characters.get(chars[m.id]?.rig)?.meta?.view || "front";
  for (const scene of episode.scenes) {
    const where = `film: shot ${scene.shots[0].shot_id}`;
    // Köşe Başı: people crossed a deep street sideways, past a crowd that stood frozen in a row
    {
      for (const shot of scene.shots.filter((s) => deep(lib, shotBg(scene, s)))) {
        const across = shot.cast.filter((m) => m.walk && viewOf(m).startsWith("profile"));
        if (across.length) {
          out.push(`film: shot ${shot.shot_id}: ${across.map((m) => `"${m.id}"`).join(", ")} walks sideways across "${shotBg(scene, shot)}", a street that runs into depth (it looks like crossing the pavement, not walking down the street); walk along it in a front or back view with a dolly or follow move, or use a flat street`);
        }
      }
    }
    // a crowd moves the way its figures face: sideways only when drawn from the side, into depth only
    // on a deep street (Köşe Başı: figures facing the buildings slid sideways, or walked into the wall)
    for (const d of (scene.dekor || []).filter((x) => CROWD.test(x.prop))) {
      if (d.akis?.back && !deep(lib, scene.bg)) {
        out.push(`${where}: the crowd "${d.id}" walks into depth on "${scene.bg}", a flat street (it walks into the wall); give it akis.dx only, or put the scene on a deep street`);
      }
      if (d.akis?.dx && !CROWD_SIDE.test(d.prop)) {
        out.push(`${where}: the crowd "${d.id}" (${d.prop}) faces the camera or away from it but slides sideways; move it with akis.back on a deep street, or use a crowd walking sideways (the library prop kalabalik-yuruyen-yandan, with ters for the direction)`);
      }
    }
    // a dolly moves the background toward its vanishing point; without one the picture stands still
    // and people walk in place (kpss-ajani s5_sh5)
    for (const shot of scene.shots) {
      if (lib.cameras?.moves?.[shot.camera?.move]?.dolly_to && !deep(lib, shotBg(scene, shot))) {
        out.push(`film: shot ${shot.shot_id}: a ${shot.camera.move} on "${shotBg(scene, shot)}", which has no vanishing point (data-vp): the picture will not move; use push_in, or a street drawn into depth`);
      }
    }
    // the furniture of the scene: nobody stands inside it
    const furniture = (scene.dekor || []).filter((d) => FURNITURE.test(d.prop));
    for (const shot of scene.shots) {
      for (const m of shot.cast) {
        // sitting on it, or getting up from it (starts down, ends standing at the bench): both right
        if (endsDown(m, lib) || startsDown(m, lib) || !furniture.length) continue;
        const x = (lib.world.marks?.[m.mark] ?? 960) + (m.dx || 0);
        const inside = furniture.find((d) => Math.abs(d.x - x) < FURNITURE_HALF && Math.abs((d.back || 0) - (m.back || 0)) < 0.2);
        if (inside) out.push(`film: shot ${shot.shot_id}: "${m.id}" stands inside the ${inside.prop} "${inside.id}"; move them beside it (dx), or keep them sitting`);
      }
    }
    // the same person, sitting or fallen at the end of a shot, standing at the start of the next
    scene.shots.forEach((shot, i) => {
      const prev = scene.shots[i - 1];
      if (!prev) return;
      for (const m of shot.cast) {
        const me = chars[m.id] && identityOf(chars[m.id], lib);
        const before = prev.cast.find((p) => chars[p.id] && identityOf(chars[p.id], lib) === me);
        if (before && endsDown(before, lib) && startsUp(m, lib)) {
          out.push(`film: shot ${shot.shot_id}: "${m.id}" was down (sitting or fallen) at the end of ${prev.shot_id} but stands at once; let them get up on screen (kalk), or keep them down here`);
        }
      }
      // shot / reverse shot: two speakers framed in different sizes jump at every cut
      const speaker = (s) => {
        const u = (s.utterances || [])[0];
        return u && chars[u.speaker] ? identityOf(chars[u.speaker], lib) : null;
      };
      const a = speaker(prev);
      const b = speaker(shot);
      const single = (s) => s.cast.length === 1; // over-the-shoulder two-shots are a size of their own
      if (a && b && a !== b && single(prev) && single(shot) && TALK_FRAMINGS.has(prev.camera.framing) && TALK_FRAMINGS.has(shot.camera.framing) && prev.camera.framing !== shot.camera.framing) {
        out.push(`film: shot ${shot.shot_id}: reverse shot in ${shot.camera.framing} after ${prev.shot_id} in ${prev.camera.framing}; frame the two speakers of a conversation the same size, and change size for both together`);
      }
    });
    // a prop held in the far hand of a profile drawing is hidden behind the body (Köşe Başı: the phone vanished)
    for (const shot of scene.shots) {
      for (const pr of shot.props || []) {
        const holder = pr.holder && chars[pr.holder];
        const view = holder && lib.characters.get(holder.rig)?.meta?.view;
        if (view?.startsWith("profile") && pr.hand === "R") {
          out.push(`film: shot ${shot.shot_id}: "${pr.holder}" holds "${pr.id}" in the far hand (R), behind the body in a profile view; use the near hand (hand "L")`);
        }
      }
    }
    // a child's action on a tall, grown-up drawing looks wrong (Köşe Başı: an adult ran with the child run)
    for (const shot of scene.shots) {
      for (const m of shot.cast) {
        const faceY = lib.characters.get(chars[m.id]?.rig)?.meta?.face_y;
        const acts = [m.action, ...(m.actions || []).map((x) => x.action)].filter((x) => childAction(lib, x));
        if (faceY != null && faceY < TALL_FACE_Y && acts.length) {
          out.push(`film: shot ${shot.shot_id}: "${m.id}" is a grown-up drawing but does the child's action ${acts.map((x) => `"${x}"`).join(", ")}; use a grown-up action, or walk instead of running`);
        }
      }
    }
    // someone in the shot whom the framing leaves out entirely (the front person of an over-the-shoulder)
    const C = globalThis.CizgiCore;
    if (C?.offFrame && lib.cameras && lib.world) {
      const faces = facesOf(episode, lib);
      const formats = episode.format === "both" ? ["16:9", "9:16"] : [episode.format || "16:9"];
      // the shots as the player frames them (timed, settled, prop anchors): Faz 4.1
      const asPlayed = (shot, f) => readyOf(f)?.get(shot.shot_id) || shot;
      for (const shot of scene.shots.filter((s) => s.cast.length >= 2)) {
        for (const f of formats) {
          const vp = f === "9:16" ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
          let gone = [];
          try {
            gone = C.offFrame(asPlayed(shot, f), lib.world, lib.cameras, vp, faces);
          } catch {
            gone = []; // a shot the camera cannot frame is reported elsewhere
          }
          if (gone.length) out.push(`film: shot ${shot.shot_id} (${f}): ${gone.map((id) => `"${id}"`).join(", ")} is in the shot but not on screen; bring them closer (dx) or frame wider`);
        }
      }
      // a head cut off at the top in a medium or wider frame (people of very different heights)
      if (C.headsCut) {
        for (const shot of scene.shots.filter((s) => s.cast.length)) {
          for (const f of formats) {
            const vp = f === "9:16" ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
            let cut = [];
            try {
              cut = C.headsCut(asPlayed(shot, f), lib.world, lib.cameras, vp, faces);
            } catch {
              cut = [];
            }
            for (const id of cut) out.push(`film: shot ${shot.shot_id} (${f}): "${id}"'s head is cut at the top of the frame; frame wider, aim at both (no target), or put the shorter one forward`);
          }
        }
      }
    }
    // someone bending forward with the head at a standing person's waist (Hurda Kralı 2 s2_sh1, 9:16:
    // Kadir bent over the scale with his face at Necmi's crotch). In the episode's own layout: 9:16
    // brings people much closer together than the marks say.
    if (C?.layoutFor && lib.world) {
      const formats = episode.format === "both" ? ["16:9", "9:16"] : [episode.format || "16:9"];
      for (const shot of scene.shots.filter((s) => s.cast.length >= 2)) {
        for (const f of formats) {
          const layout = C.layoutFor(lib.world, f === "9:16" ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 });
          // a walk that runs through someone standing in its way at the same depth (walks keep their
          // stride in 9:16 while the marks close up)
          for (const m of shot.cast.filter((c) => c.walk)) {
            const [a, b] = [C.memberX(m, layout, 0, 1), C.memberX(m, layout, 1e6, 1)].sort((p, q) => p - q);
            for (const o of shot.cast) {
              if (o === m || o.walk || Math.abs((o.back || 0) - (m.back || 0)) > 0.2) continue;
              const xo = C.memberX(o, layout, 0, 1);
              const half = C.memberHalfWidth(o, layout);
              if (xo - half > a && xo + half < b) out.push(`film: shot ${shot.shot_id} (${f}): "${m.id}" walks through "${o.id}" standing in the way; stop the walk before them (walk.dx, arrive), or put them at another depth (back)`);
            }
          }
          for (const [a, b] of overlaps(shot.cast, layout, C.memberX, C.memberHalfWidth)) {
            out.push(`film: shot ${shot.shot_id} (${f}): "${a}" and "${b}" ${OVERLAP_MARK}; move one aside (dx) or back (back)`);
          }
          for (const m of shot.cast) {
            const bend = deepestBend(m, lib);
            const dir = directionOf(m, chars[m.id] || {}, lib);
            if (!bend || !dir) continue;
            const torso = torsoOfRig(lib.characters.get(chars[m.id]?.rig));
            const head = C.memberX(m, layout, 0, 1) + (dir === "right" ? 1 : -1) * torso * Math.sin((bend * Math.PI) / 180) * layout.scale;
            for (const o of shot.cast) {
              if (o === m || deepestBend(o, lib) || endsDown(o, lib) || Math.abs((o.back || 0) - (m.back || 0)) > 0.2) continue;
              if (Math.abs(head - C.memberX(o, layout, 0, 1)) < C.memberHalfWidth(o, layout)) {
                out.push(`film: shot ${shot.shot_id} (${f}): "${m.id}" bends with the head at "${o.id}"'s waist (it reads as something else); move them apart (dx), or turn the one who bends`);
              }
            }
          }
        }
      }
    }
    const still = (scene.dekor || []).filter((d) => CROWD.test(d.prop) && !(d.akis?.dx || d.akis?.back));
    if (still.length) {
      out.push(`${where}: the crowd ${still.map((d) => `"${d.id}"`).join(", ")} in scene ${scene.scene_id} stands frozen; give it akis (dekor[].akis: dx sideways, back + going away / - coming closer) so it walks by, or leave it out`);
    }
    for (const shot of scene.shots) {
      const said = new Set((shot.utterances || []).map((u) => chars[u.speaker] && identityOf(chars[u.speaker], lib)).filter(Boolean));
      if (said.size >= EXCHANGE_LINES && (shot.camera.move || "static") === "static") {
        out.push(`film: shot ${shot.shot_id}: ${said.size} people talk in one static shot; cut it into shot / reverse shot (each line on its speaker, or over the listener's shoulder)`);
      }
    }
    const peopled = scene.shots.filter((s) => s.cast.length);
    if (peopled.length >= SIDE_ONLY_SHOTS && peopled.every((s) => s.cast.every((m) => viewOf(m).startsWith("profile")))) {
      out.push(`${where}: every shot of scene ${scene.scene_id} shows people from the side (profile); add a front 3/4 close-up, an over-the-shoulder shot or a tracking shot from behind`);
    }
    const speakers = new Set(scene.shots.flatMap((s) => (s.utterances || []).map((u) => chars[u.speaker] && identityOf(chars[u.speaker], lib))).filter(Boolean));
    const overShoulder = scene.shots.some((s) => s.cast.some((m) => viewOf(m).startsWith("back")) && s.cast.some((m) => !viewOf(m).startsWith("back")));
    if (speakers.size >= 2 && !overShoulder) {
      out.push(`${where}: the conversation in scene ${scene.scene_id} has no over-the-shoulder shot; show the speaker over the listener's shoulder (the listener's back 3/4 in front, the speaker's front 3/4 behind)`);
    }
    // Köşe Başı and Hurda Kralı: one picture, the same people the same way round, cut only by zoom
    const angle = (shot) => [shotBg(scene, shot), ...shot.cast.map((m) => `${m.id}:${viewOf(m)}:${m.facing || ""}`).sort()].join("|");
    if (peopled.length >= ONE_ANGLE_SHOTS && new Set(peopled.map(angle)).size === 1) {
      out.push(`${where}: all ${peopled.length} shots of scene ${scene.scene_id} look from one angle and only zoom in or out; add another angle of the place (shot.bg), a reverse or over-the-shoulder shot, or turn the people`);
    }
    // everyone but the speaker frozen in a waiting pose: no secondary action
    for (const shot of scene.shots.filter((s) => s.cast.length >= 2 && (s.utterances || []).length)) {
      const speaking = new Set(shot.utterances.map((u) => u.speaker));
      if (!shot.cast.some((m) => speaking.has(m.id))) continue; // the narrator or someone off screen speaks
      // the listener seen from behind (over the shoulder) shows no face to be idle with
      const others = shot.cast.filter((m) => !speaking.has(m.id) && !viewOf(m).startsWith("back"));
      const idle = (m) => !m.walk && [m.action, ...(m.actions || []).map((a) => a.action)].every((a) => IDLE.test(a || ""));
      if (others.length && others.every(idle)) {
        out.push(`film: shot ${shot.shot_id}: ${others.map((m) => `"${m.id}"`).join(", ")} only stands and waits while the other speaks; give the listener something to do (a nod, a look, the work at hand)`);
      }
    }
  }
  // a skeleton: every scene a single static shot
  const scenes = episode.scenes.filter((sc) => sc.shots.length);
  if (scenes.length >= 2 && scenes.every((sc) => sc.shots.length === 1 && (sc.shots[0].camera?.move || "static") === "static")) {
    out.push(`film: shot ${scenes[0].shots[0].shot_id}: every scene of the episode is one static shot (a skeleton); break the scenes into shots: an establishing shot, closer shots on who acts and speaks, an insert on the thing that matters`);
  }
  return out;
}
