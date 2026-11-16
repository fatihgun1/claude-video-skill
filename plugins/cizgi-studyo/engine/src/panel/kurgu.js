// Shot editing for the timeline (add, duplicate, delete, reorder) and the undo history.
// Plain functions over the episode object, no DOM, so they are tested in Node too.

const NEW_HOLD = 2;
export const STEP = 0.05; // hold and effect times snap to 5 hundredths
export const MAX_HOLD = 10;
const EPS = 1e-9;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const round2 = (x) => Math.round(x * 100) / 100;
export const snap = (x) => round2(Math.round(x / STEP) * STEP);
const snapDown = (x) => round2(Math.floor(x / STEP + EPS) * STEP);

/* ---------- timeline math (seconds; px only where a drag is turned into time) ---------- */

/**
 * How long a shot lasts with its current hold, from where its speech ends in the last
 * compile (the same rule as timing.mjs: speech + hold + tail, at least min_shot).
 * @param {{start:number, speech_end:number}} t
 * @param {{hold?:number}} shot
 * @param {{tail:number, min_shot:number, default_hold:number}} rules
 */
export function shotLength(t, shot, rules) {
  return Math.max(t.speech_end - t.start + (shot.hold ?? rules.default_hold) + rules.tail, rules.min_shot);
}

/** Shortest a shot may be dragged: its lines, and every effect must still start inside it. */
export function minShotLength(speech, rules, sfx = []) {
  const lastAt = sfx.reduce((m, s) => Math.max(m, s.at), -Infinity);
  return Math.max(speech + rules.tail, rules.min_shot, lastAt + STEP);
}

/** The hold that gives a shot this length (snapped, 0..MAX_HOLD). */
export function holdForLength(len, speech, rules) {
  return clamp(snap(len - speech - rules.tail), 0, MAX_HOLD);
}

/** An effect's new time after a drag: snapped, inside its shot (compile refuses at >= length). */
export function sfxAtAfterDrag(at, seconds, shotLen) {
  return clamp(snap(at + seconds), 0, Math.max(0, snapDown(shotLen - STEP)));
}

/**
 * The timeline's magnet: a time within `tol` seconds of a target (the playhead, a line's start or
 * end, the shot's start) takes the nearest one; else it stays. tol 0 = the magnet is off.
 * @returns {{t:number, hit:number|null}} hit: the target it took, for the guide line
 */
export function snapTo(t, targets, tol) {
  let hit = null;
  for (const x of targets) if (tol > 0 && Math.abs(x - t) <= tol + EPS && (hit === null || Math.abs(x - t) < Math.abs(hit - t))) hit = x;
  return hit === null ? { t, hit: null } : { t: hit, hit };
}

/* ---------- action sequences (cast.action, then cast.actions[] from their `at`) ---------- */

const starts = (m) => [0, ...(m.actions || []).map((a) => a.at)];

/**
 * The actions of a member laid out on its track: segment 0 is its own `action` from the
 * start; each listed one runs from its `at` until the next starts or the shot ends.
 * @returns {{index:number, action:string, from:number, start:number, end:number}[]}
 */
export function segmentSpans(member, shotLen) {
  const list = [{ action: member.action, at: 0, from: member.from || 0 }, ...(member.actions || [])];
  return list.map((s, i) => ({
    // an action listed past the shot's end gets an empty span (compile refuses it anyway)
    index: i, action: s.action, from: s.from || 0, start: s.at, end: Math.max(s.at, i + 1 < list.length ? list[i + 1].at : shotLen),
  }));
}

/** The segment playing at shot-local time t. */
export function segmentIndexAt(member, t) {
  const s = starts(member);
  let i = 0;
  while (i + 1 < s.length && t >= s[i + 1]) i++;
  return i;
}

/**
 * Start another action at shot-local time `at` (the playhead). Refused (null) outside the
 * shot or on top of another action's start.
 * @returns {number|null} the new segment's index
 */
export function insertSegment(member, action, at, shotLen, isLoop) {
  const t = snap(at);
  if (t < STEP || t > shotLen - STEP + EPS || starts(member).some((s) => Math.abs(s - t) < STEP - EPS)) return null;
  const list = [...(member.actions || []), { action, at: t }].sort((a, b) => a.at - b.at);
  member.actions = list;
  syncWalkStop(member, isLoop, shotLen);
  return list.findIndex((a) => a.at === t && a.action === action) + 1;
}

/**
 * Move where segment `index` (1..) starts, between its neighbours and inside the shot. When
 * it is the moment a walk stops (the first still action after a walking start), the walk
 * ends there too, at the same speed: walk.time follows and walk.dx scales with it, so the
 * feet do not slide.
 * @param {(actionId:string) => boolean} isLoop
 */
export function moveSegmentStart(member, index, at, shotLen, isLoop) {
  const list = member.actions || [];
  if (!list[index - 1]) return;
  const s = starts(member);
  const lo = s[index - 1] + STEP;
  const hi = (index < list.length ? s[index + 1] : shotLen) - STEP;
  const t = round2(clamp(snap(at), lo, hi));
  member.actions = list.map((x, i) => (i === index - 1 ? { ...x, at: t } : x));
  syncWalkStop(member, isLoop, shotLen);
}

/**
 * Start the member's first action later: a standing action fills the shot until `at`, and
 * the first action (with its `from`) becomes the first listed one. Not for a walk (it moves
 * from the shot's start) nor when the first action already is the standing one.
 * @returns {boolean} whether it changed
 */
export function delayFirstSegment(member, at, shotLen, standing, isLoop) {
  if (member.walk || member.action === standing) return false;
  const list = member.actions || [];
  const hi = (list.length ? list[0].at : shotLen) - STEP;
  const t = round2(clamp(snap(at), STEP, hi));
  if (snap(at) < STEP || hi < STEP) return false;
  const first = { action: member.action, at: t, ...(member.from ? { from: member.from } : {}) };
  member.action = standing;
  member.actions = [first, ...list];
  delete member.from;
  syncWalkStop(member, isLoop, shotLen);
  return true;
}

/**
 * Keep a walk in step with its sequence: a walking start followed by a still action stops
 * walking when that action starts (walk.time), with no stop it walks the whole shot (no
 * walk.time). The speed stays the same, so walk.dx grows or shrinks with the walking time
 * (within the schema's ±MAX_WALK) and the feet do not slide.
 * @param {(actionId:string) => boolean} isLoop
 */
export function syncWalkStop(member, isLoop, shotLen) {
  if (!member.walk || !isLoop || !(shotLen > 0)) return;
  const segs = segmentSpans(member, shotLen);
  const stop = isLoop(segs[0].action) ? segs.find((g) => g.index > 0 && !isLoop(g.action)) : null;
  const was = member.walk.time > 0 ? member.walk.time : shotLen;
  const now = stop ? stop.start : shotLen;
  if (Math.abs(now - was) < EPS && (stop ? member.walk.time !== undefined : member.walk.time === undefined)) return;
  const dx = clamp(Math.round((member.walk.dx * now) / was), -MAX_WALK, MAX_WALK);
  const { time, ...rest } = member.walk;
  member.walk = stop ? { ...rest, dx, time: now } : { ...rest, dx };
}

/** Put another library action in a segment (0 is the member's own `action`). */
export function replaceSegmentAction(member, index, action, isLoop, shotLen) {
  if (index === 0) member.action = action;
  else if (member.actions?.[index - 1]) member.actions = member.actions.map((x, i) => (i === index - 1 ? { ...x, action } : x));
  syncWalkStop(member, isLoop, shotLen);
}

/** Remove a listed action (index 1..); the member's own first action stays. */
export function removeSegment(member, index, isLoop, shotLen) {
  if (index < 1 || !member.actions?.[index - 1]) return false;
  const list = member.actions.filter((_, i) => i !== index - 1);
  if (list.length) member.actions = list;
  else delete member.actions;
  syncWalkStop(member, isLoop, shotLen);
  return true;
}

/* ---------- validation messages → the row they are about ---------- */

/**
 * Which row of the shot a validation message is about, read from the ids it quotes:
 * a line's speaker, a sound effect, a prop, a cast member (by id, or by an action of its
 * sequence). null when it is about the shot as a whole (camera, timing…).
 * @returns {{kind:"cast"|"prop"|"sfx"|"line", index:number}|null}
 */
export function rowOfMessage(msg, shot) {
  const quoted = (id) => msg.includes(`"${id}"`);
  const named = (id) => quoted(id) || new RegExp(`(^|[\\s(])${id.replace(/[-_]/g, "[-_]")}([\\s),:]|$)`).test(msg);
  if (/\bspeaker\b/.test(msg)) {
    const i = (shot.utterances || []).findIndex((u) => quoted(u.speaker));
    if (i !== -1) return { kind: "line", index: i };
  }
  if (/\bsound effect\b/.test(msg)) {
    const i = (shot.sfx || []).findIndex((s) => quoted(s.sfx));
    if (i !== -1) return { kind: "sfx", index: i };
  }
  if (/\bprop\b/.test(msg)) {
    const i = (shot.props || []).findIndex((p) => quoted(p.id) || quoted(p.prop));
    if (i !== -1) return { kind: "prop", index: i };
  }
  // quoted ids first; a bare word (`genc (genc) is drawn…`) only when nothing is quoted
  let i = shot.cast.findIndex((m) => quoted(m.id));
  if (i === -1) i = shot.cast.findIndex((m) => [m.action, ...(m.actions || []).map((a) => a.action)].some(quoted));
  if (i === -1) i = shot.cast.findIndex((m) => named(m.id));
  return i === -1 ? null : { kind: "cast", index: i };
}

/* ---------- lines (utterances) ---------- */

/**
 * Add a line at the end of a shot. It gets a recording name of its own (ses/<shot>-yeni-<tag>.wav):
 * the usual ses/<shot>-<n>.wav may belong to a moved line or be a deleted line's leftover.
 * @returns {number|null} its index, null when the text is empty
 */
export function addLine(shot, speaker, text, tag = Date.now().toString(36)) {
  const clean = String(text || "").trim();
  if (!clean) return null;
  shot.utterances = [...(shot.utterances || []), { speaker, text: clean, audio: `ses/${shot.shot_id}-yeni-${tag}.wav` }];
  return shot.utterances.length - 1;
}

/**
 * Remove a line. A line's recording is named after its place in the shot
 * (ses/<shot>-<n>.wav), so the lines after it are pinned to the files they were spoken
 * into before their numbers move.
 */
export function removeLine(shot, index) {
  const list = shot.utterances || [];
  if (!list[index]) return false;
  const next = list
    .map((u, i) => (i > index && !u.audio ? { ...u, audio: `ses/${shot.shot_id}-${i}.wav` } : u))
    .filter((_, i) => i !== index);
  if (next.length) shot.utterances = next;
  else delete shot.utterances;
  return true;
}

/* ---------- stage placement (world units of the current layout) ---------- */

const SNAP = 40; // closer than this to a mark (layout units, so a bit wider in world units in 9:16): stand on it
const MAX_DX = 900; // schema limit of cast.dx
const MAX_WALK = 1500; // schema limit of walk.dx
const nearestOf = (ids, marks, x) => ids.reduce((a, b) => (Math.abs(marks[a] - x) <= Math.abs(marks[b] - x) ? a : b));

/**
 * Where someone dropped at layout x stands: the nearest mark nobody else in the shot uses
 * (two people on one mark is an error) plus an offset; close to that mark, on it exactly.
 * @param {number} x layout x (world units, portrait-scaled in 9:16)
 * @param {Record<string, number>} marks the layout's marks
 * @param {Set<string>} taken marks the others stand on
 * @param {number} [ratio] layout distances per world unit (portrait shrinks them)
 * @returns {{mark:string, dx:number}|null} null when every mark is taken
 */
export function placeAt(x, marks, taken, ratio = 1) {
  const free = Object.keys(marks).filter((m) => !taken.has(m));
  if (!free.length) return null;
  const mark = nearestOf(free, marks, x);
  const off = x - marks[mark];
  return { mark, dx: Math.abs(off) <= SNAP ? 0 : clamp(Math.round(off / ratio), -MAX_DX, MAX_DX) };
}

/** A walk's length after its free end was dragged to layout x (anchor: where the walk is pinned). */
export function walkDxAfterDrag(x, anchor, ratio = 1) {
  return clamp(Math.round((x - anchor) / ratio), -MAX_WALK, MAX_WALK);
}

/**
 * Where a dragged shot lands among the shots of its scene: where the pointer is, between the
 * two other shots around it (past the middle of a shot is after it). `at` is the edge between
 * them as they are drawn now, for the drop marker.
 * @param {{start:number, len:number}[]} siblings the scene's shots in order, the dragged one included
 * @param {number} index the dragged shot's index in siblings
 * @param {number} t the pointer's time, on the same clock as `start`
 * @returns {{index:number, at:number}}
 */
export function reorderAt(siblings, index, t) {
  const others = siblings.filter((_, i) => i !== index);
  const k = others.filter((q) => q.start + q.len / 2 < t).length;
  const at = k === 0 ? others[0]?.start ?? siblings[index].start : others[k - 1].start + others[k - 1].len;
  return { index: k, at };
}

/** A shot id not used anywhere in the episode: "<scene>_sh<n>". */
export function nextShotId(episode, scene) {
  const taken = new Set(episode.scenes.flatMap((s) => s.shots.map((x) => x.shot_id)));
  let n = scene.shots.length + 1;
  while (taken.has(`${scene.scene_id}_sh${n}`)) n++;
  return `${scene.scene_id}_sh${n}`;
}

/** A standing action that suits the rig's view: "bekle", else another "bekle…", else what it had. */
export function standingAction(vocab, view, fallback) {
  const fits = vocab.actions.filter((a) => !a.views || a.views.includes(view));
  return (fits.find((a) => a.id === "bekle") || fits.find((a) => a.id.startsWith("bekle")))?.id || fallback;
}

/**
 * A new shot after `after`: the same people in the same places, standing, wide and still.
 * Lines are not added: they come from the script.
 * @param {(characterId:string) => string} viewOf the rig view of a cast member
 */
export function addShotAfter(episode, scene, after, vocab, viewOf) {
  const shot = standingShot(nextShotId(episode, scene), after, vocab, viewOf);
  scene.shots.splice(scene.shots.indexOf(after) + 1, 0, shot);
  return shot;
}

/** A wide, still shot with `from`'s people standing where they stood. */
function standingShot(shotId, from, vocab, viewOf) {
  const cast = from.cast.map((m) => ({
    id: m.id,
    action: standingAction(vocab, viewOf(m.id), m.action),
    mark: m.mark,
    ...(m.facing ? { facing: m.facing } : {}),
  }));
  const target = cast.some((m) => m.id === from.camera.target) ? from.camera.target : cast[0]?.id;
  return { shot_id: shotId, cast, camera: { framing: "wide", move: "static", ...(target ? { target } : {}) }, hold: NEW_HOLD };
}

/* ---------- scenes (the project tree) ---------- */

export const SCENE_TITLE_MAX = 80; // schema limit of scene.title

/** A scene id not used in the episode: "s<n>". */
export function nextSceneId(episode) {
  const taken = new Set(episode.scenes.map((s) => s.scene_id));
  let n = episode.scenes.length;
  while (taken.has(`s${n}`)) n++;
  return `s${n}`;
}

/**
 * A new scene after `after`, in the same place, with one shot: the people of `after`'s last
 * shot standing where they were. Lines are not added: they come from the script.
 */
export function addSceneAfter(episode, after, vocab, viewOf) {
  const id = nextSceneId(episode);
  const taken = new Set(episode.scenes.flatMap((s) => s.shots.map((x) => x.shot_id)));
  let n = 1;
  while (taken.has(`${id}_sh${n}`)) n++;
  const scene = { scene_id: id, bg: after.bg, shots: [standingShot(`${id}_sh${n}`, after.shots.at(-1), vocab, viewOf)] };
  episode.scenes.splice(episode.scenes.indexOf(after) + 1, 0, scene);
  return scene;
}

/**
 * Remove a scene with its shots. An episode keeps at least one scene.
 * @returns {string|null} the shot to select next (the first of the scene now in its place, else
 *   of the one before), or null when refused
 */
export function deleteScene(episode, scene) {
  if (episode.scenes.length <= 1) return null;
  const i = episode.scenes.indexOf(scene);
  if (i === -1) return null;
  episode.scenes.splice(i, 1);
  return episode.scenes[Math.min(i, episode.scenes.length - 1)].shots[0].shot_id;
}

/** Move a scene to a new index. */
export function moveScene(episode, sceneId, index) {
  const from = episode.scenes.findIndex((s) => s.scene_id === sceneId);
  if (from === -1) return false;
  const to = Math.max(0, Math.min(index, episode.scenes.length - 1));
  if (to === from) return false;
  const [scene] = episode.scenes.splice(from, 1);
  episode.scenes.splice(to, 0, scene);
  return true;
}

/**
 * Move a shot to `index` in scene `to` (its own scene: a reorder). It takes on that scene's
 * place (bg). A scene keeps at least one shot.
 */
export function moveShotToScene(episode, shotId, to, index) {
  const from = episode.scenes.find((s) => s.shots.some((x) => x.shot_id === shotId));
  if (!from) return false;
  if (from === to) return moveShot(from, shotId, index);
  if (from.shots.length <= 1) return false;
  const shot = from.shots.find((x) => x.shot_id === shotId);
  from.shots = from.shots.filter((x) => x !== shot);
  to.shots.splice(Math.max(0, Math.min(index, to.shots.length)), 0, shot);
  return true;
}

/** Name a scene (a working label, not in the film); empty removes the name. */
export function setSceneTitle(scene, text) {
  const clean = String(text ?? "").trim().slice(0, SCENE_TITLE_MAX).trim();
  if (clean) scene.title = clean;
  else delete scene.title;
}

/** A copy of the shot right after it, without its lines (they belong to the script). */
export function duplicateShot(episode, scene, shot) {
  const copy = structuredClone(shot);
  delete copy.utterances;
  copy.shot_id = nextShotId(episode, scene);
  scene.shots.splice(scene.shots.indexOf(shot) + 1, 0, copy);
  return copy;
}

/**
 * Remove a shot. A scene keeps at least one shot.
 * @returns {string|null} the shot to select next, or null when refused
 */
export function deleteShot(scene, shot) {
  if (scene.shots.length <= 1) return null;
  const i = scene.shots.indexOf(shot);
  scene.shots.splice(i, 1);
  return scene.shots[Math.min(i, scene.shots.length - 1)].shot_id;
}

/** Move a shot to a new index within its scene. */
export function moveShot(scene, id, index) {
  const from = scene.shots.findIndex((s) => s.shot_id === id);
  if (from === -1) return false;
  const to = Math.max(0, Math.min(index, scene.shots.length - 1));
  if (to === from) return false;
  const [shot] = scene.shots.splice(from, 1);
  scene.shots.splice(to, 0, shot);
  return true;
}

/**
 * Undo/redo over snapshots (JSON strings). record() after every committed change;
 * the first snapshot is the episode as opened.
 */
export function createHistory(limit = 200) {
  let past = [];
  let future = [];
  let last = null;
  return {
    reset(snapshot) {
      past = [];
      future = [];
      last = snapshot;
    },
    /** @returns {boolean} whether this was a change worth a step */
    record(snapshot) {
      if (snapshot === last) return false;
      if (last !== null) past.push(last);
      if (past.length > limit) past.shift();
      future = [];
      last = snapshot;
      return true;
    },
    undo() {
      if (!past.length) return null;
      future.push(last);
      last = past.pop();
      return last;
    },
    redo() {
      if (!future.length) return null;
      past.push(last);
      last = future.pop();
      return last;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
  };
}
