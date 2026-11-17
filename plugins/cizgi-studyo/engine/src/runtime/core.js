/*
 * Çizgi Stüdyo — pure animation math shared by the browser player and Node tests.
 * Every function is a pure function of its inputs (no clocks, no randomness) so any
 * frame can be rendered by seeking directly to it.
 *
 * Loaded two ways: as a classic <script> in the composition, and via `import` in tests.
 * Both attach the API to globalThis.CizgiCore.
 */
(function (root) {
  "use strict";

  const EASES = {
    linear: (x) => x,
    inSine: (x) => 1 - Math.cos((x * Math.PI) / 2),
    outSine: (x) => Math.sin((x * Math.PI) / 2),
    inOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
    inCubic: (x) => x * x * x,
    outCubic: (x) => 1 - Math.pow(1 - x, 3),
    inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    outBack: (x) => {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
    },
  };

  /** How much of a framing's extra zoom survives in a portrait viewport. */
  const PORTRAIT_ZOOM_SHARE = 0.35;
  /** Share of the portrait frame height kept free above the characters for captions. */
  const PORTRAIT_HEADROOM = 0.12;
  /** Portrait wide shots zoom this much past "just covers the frame", so headroom can apply. */
  const PORTRAIT_MIN_ZOOM = 1.1;

  /** Channels whose neutral value is 1 instead of 0. */
  const UNIT_CHANNELS = { root_sx: true, root_sy: true };

  function clamp01(x) {
    return x < 0 ? 0 : x > 1 ? 1 : x;
  }

  function ease(name, x) {
    const fn = EASES[name] || EASES.inOutSine;
    return fn(clamp01(x));
  }

  function neutral(channel) {
    return UNIT_CHANNELS[channel] ? 1 : 0;
  }

  /** Union of channel names used by any keyframe of an action. */
  function actionChannels(action) {
    const seen = {};
    for (const key of action.keys) {
      for (const ch of Object.keys(key.pose)) seen[ch] = true;
    }
    return Object.keys(seen);
  }

  /**
   * Pose of an action at local time t (seconds since the action started).
   * Looping actions wrap; one-shot actions hold their last key.
   * A channel missing from a key keeps its neutral value at that key.
   */
  function sampleAction(action, t) {
    const keys = action.keys;
    const cycle = action.duration;
    let local = Math.max(0, t);
    local = action.loop ? local % cycle : Math.min(local, cycle);

    let i = 0;
    while (i < keys.length - 1 && keys[i + 1].t <= local) i++;
    const a = keys[i];
    const b = keys[Math.min(i + 1, keys.length - 1)];
    const span = b.t - a.t;
    const k = span > 0 ? ease(b.ease, (local - a.t) / span) : 0;

    const pose = {};
    for (const ch of actionChannels(action)) {
      const va = ch in a.pose ? a.pose[ch] : neutral(ch);
      const vb = ch in b.pose ? b.pose[ch] : neutral(ch);
      pose[ch] = va + (vb - va) * k;
    }
    return pose;
  }

  /** Linear blend between two poses (k=0 → from, k=1 → to). */
  function blendPose(from, to, k) {
    const out = {};
    const channels = Object.keys(Object.assign({}, from, to));
    for (const ch of channels) {
      const va = ch in from ? from[ch] : neutral(ch);
      const vb = ch in to ? to[ch] : neutral(ch);
      out[ch] = va + (vb - va) * k;
    }
    return out;
  }

  /**
   * Gentle idle motion added on top of any action: breathing and a slow head sway.
   * `phase` de-synchronises characters.
   */
  function idleOffsets(t, phase) {
    const breath = Math.sin(((t + phase) * 2 * Math.PI) / 3.2);
    return { body: breath * 0.8, head: Math.sin(((t + phase) * 2 * Math.PI) / 4.1) * 1.5 };
  }

  /** Deterministic blink: eyes closed for 0.12 s every `period` seconds. */
  function blinkClosed(t, phase) {
    const period = 3.7;
    return (t + phase) % period < 0.12;
  }

  /** Stable per-id phase in [0, 3) derived from the id string. */
  function phaseFor(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return (h % 300) / 100;
  }

  /** Rhubarb mouth shape → rig viseme group name. */
  const RHUBARB_TO_VISEME = {
    A: "mouth_MBP",
    B: "mouth_E",
    C: "mouth_A",
    D: "mouth_A",
    E: "mouth_O",
    F: "mouth_U",
    G: "mouth_FV",
    H: "mouth_L",
    X: "mouth_rest",
  };

  /** Viseme at local time t from Rhubarb cues [{start,end,value}]; rest outside cues. */
  function visemeAt(cues, t) {
    for (const cue of cues) {
      if (t >= cue.start && t < cue.end) return RHUBARB_TO_VISEME[cue.value] || "mouth_rest";
    }
    return "mouth_rest";
  }

  /**
   * A cast member's face at shot-local time t (cast[].ifade): one expression for the whole shot,
   * or a list of {ifade, at} moments (neutral before the first). "notr" when none is given.
   */
  function expressionAt(member, t) {
    const f = member && member.ifade;
    if (!f) return "notr";
    if (typeof f === "string") return f;
    let face = "notr";
    let latest = -Infinity;
    for (const m of f) {
      if (m.at <= t && m.at >= latest) {
        face = m.ifade;
        latest = m.at;
      }
    }
    return face;
  }

  /**
   * Whether a part of a drawing shows in a costume variant (cast[].varyant, "" for the drawing as it is):
   * data-varyant="a b" shows it only in those variants, data-varyant-yok="a b" hides it in them.
   * @param {{varyant?:string, yok?:string}} attrs
   */
  function partShown(attrs, variant) {
    const names = (s) => String(s || "").split(/\s+/).filter(Boolean);
    if (attrs.varyant != null && !names(attrs.varyant).includes(variant)) return false;
    if (attrs.yok != null && names(attrs.yok).includes(variant)) return false;
    return true;
  }

  /** The mouth to show: speech wins; in its silences (and outside lines) the expression shows. */
  function mouthAt(viseme, face) {
    return viseme === "mouth_rest" && face === "gulumse" ? "mouth_smile" : viseme;
  }

  /** Index of the word being spoken at local time t, or -1. Words: [{start,end}]. */
  function wordIndexAt(words, t) {
    let idx = -1;
    for (let i = 0; i < words.length; i++) {
      if (words[i].start != null && t >= words[i].start) idx = i;
    }
    return idx;
  }

  /**
   * Camera at shot progress p∈[0,1].
   * Returns {zoom, cx, cy}: the world point shown at the canvas centre and the zoom factor.
   * The view is clamped so the camera never shows outside the world.
   */
  function cameraAt(shotCamera, p, targetX, world, presets, viewport, keepWidth, faceY) {
    const framing = presets.framings[shotCamera.framing];
    const move = presets.moves[shotCamera.move || "static"];
    const zStart = framing.zoom * (move.zoom_from || 1);
    const zEnd = framing.zoom * (move.zoom_to || 1);
    const k = ease(move.ease || "inOutSine", p);
    // `fit` is the zoom needed to cover the viewport (1 for 16:9, ~1.78 for 9:16). A portrait
    // frame is already tight, so framing zoom is compressed there instead of multiplied.
    const fit = Math.max(viewport.width / world.width, viewport.height / world.height);
    const z = Math.max(zStart + (zEnd - zStart) * k, 1);
    const portrait = viewport.height > viewport.width;
    // In portrait a little extra zoom leaves room to shift the view for caption headroom.
    const base = portrait ? fit * PORTRAIT_MIN_ZOOM : fit;
    let zoom = Math.max(z, base * (1 + (z - 1) * PORTRAIT_ZOOM_SHARE));
    // Without a target the whole cast must stay visible: zoom out as far as covering the frame allows.
    if (keepWidth) zoom = Math.max(Math.min(zoom, viewport.width / keepWidth), fit);

    const panFrom = move.pan_from || 0;
    const panTo = move.pan_to || 0;
    const baseX = targetX == null ? world.width / 2 : targetX;
    let cx = baseX + (panFrom + (panTo - panFrom) * k) * world.width;
    // Framings anchored to the character follow its face (close) or its upper body (medium),
    // so tall and short characters are framed alike. Others use a fixed height in the world.
    let cy = world.height * (framing.focus_y == null ? 0.5 : framing.focus_y);
    if (faceY != null && framing.anchor === "face") cy = faceY;
    if (faceY != null && framing.anchor === "body") cy = (faceY + world.ground_y) / 2;
    // chest: a medium close-up that keeps the face and what the hands hold in one frame
    if (faceY != null && framing.anchor === "chest") cy = faceY + (world.ground_y - faceY) * 0.22;
    // A reveal starts centred on its target (e.g. a bottle) and settles on the framing.
    if (faceY != null && move.from_target) cy = faceY + (cy - faceY) * k;
    // Portrait frames keep captions at the top, so look a little higher to push the characters down.
    if (portrait) cy -= (viewport.height / zoom) * PORTRAIT_HEADROOM;

    const halfW = viewport.width / zoom / 2;
    const halfH = viewport.height / zoom / 2;
    cx = Math.min(Math.max(cx, halfW), world.width - halfW);
    cy = Math.min(Math.max(cy, halfH), world.height - halfH);
    return { zoom, cx, cy };
  }

  function rotate(x, y, deg) {
    const r = (deg * Math.PI) / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    return [x * c - y * s, x * s + y * c];
  }

  /** How far the curve's control point leans toward a sharp elbow (0 = soft hose, 1 = through the elbow). */
  const HOSE_ELBOW = 0.5;

  /**
   * Rubber-hose arm: shoulder stays put, the elbow and wrist follow the two angles, and one
   * smooth quadratic curve joins them — no visible joint.
   * @param {number[][]} rest [[sx,sy],[ex,ey],[wx,wy]] rest pose
   * @returns {{elbow:number[], wrist:number[], d:string}}
   */
  function hoseGeometry(rest, upperDeg, lowerDeg, lift) {
    const S = rest[0];
    // lift (rig units) raises the end straight up, the middle joint half as much: a leg seen
    // from the front or back steps by lifting the foot, not by swinging sideways.
    const up = lift || 0;
    const E = [rest[1][0], rest[1][1] - up * 0.5];
    const W = [rest[2][0], rest[2][1] - up];
    const u = rotate(E[0] - S[0], E[1] - S[1], upperDeg);
    const elbow = [S[0] + u[0], S[1] + u[1]];
    const l = rotate(W[0] - E[0], W[1] - E[1], upperDeg + lowerDeg);
    const wrist = [elbow[0] + l[0], elbow[1] + l[1]];
    const through = [2 * elbow[0] - (S[0] + wrist[0]) / 2, 2 * elbow[1] - (S[1] + wrist[1]) / 2];
    const cx = elbow[0] + (through[0] - elbow[0]) * HOSE_ELBOW;
    const cy = elbow[1] + (through[1] - elbow[1]) * HOSE_ELBOW;
    const f = (n) => n.toFixed(1);
    return { elbow, wrist, d: "M" + f(S[0]) + " " + f(S[1]) + " Q" + f(cx) + " " + f(cy) + " " + f(wrist[0]) + " " + f(wrist[1]) };
  }

  /** Seconds between the pose and the earlier pose used for follow-through. */
  const LAG = 0.1;

  /**
   * Follow-through: parts that hang off the body lag behind it.
   * Ears swing against head turns and flop on vertical moves; forearms trail the upper arm.
   * @param {object} pose pose at t
   * @param {object} prev pose at t - LAG
   */
  function secondaryMotion(pose, prev) {
    const out = Object.assign({}, pose);
    const g = (p, ch) => p[ch] || 0;
    const turn = g(prev, "head") - g(pose, "head") + g(prev, "body") - g(pose, "body");
    const lift = -(g(pose, "root_y") - g(prev, "root_y")) * 0.25;
    const clampDeg = (x) => Math.max(-25, Math.min(25, x));
    out.ear_L = g(pose, "ear_L") + clampDeg(turn * 1.2 + lift);
    out.ear_R = g(pose, "ear_R") + clampDeg(turn * 1.2 - lift);
    out.arm_L_lower = g(pose, "arm_L_lower") + (g(prev, "arm_L_upper") - g(pose, "arm_L_upper")) * 0.35;
    out.arm_R_lower = g(pose, "arm_R_lower") + (g(prev, "arm_R_upper") - g(pose, "arm_R_upper")) * 0.35;
    return out;
  }

  /** Rig height in rig units (feet at 950, top of ears near 50). */
  const RIG_HEIGHT = 900;
  /** Half the width a character occupies, in rig units (arms out, ears). */
  const RIG_HALF_WIDTH = 250;

  /**
   * Marks and character scale for a viewport. Portrait frames are narrow, so marks move
   * closer together and characters shrink a little (world.portrait).
   */
  function layoutFor(world, viewport) {
    const portrait = viewport.height > viewport.width && world.portrait;
    const ratio = portrait ? world.portrait.character_scale : 1;
    return {
      marks: portrait ? world.portrait.marks : world.marks,
      scale: (world.character_height / RIG_HEIGHT) * ratio,
      ratio, // world distances shrink with the characters in portrait
    };
  }

  /**
   * World x of a cast member at shot-local time t: its mark, moved by cast.dx. A walking member
   * (cast.walk = {dx, time}) moves walk.dx world units from there at constant speed over `time`
   * seconds (default: the shot).
   */
  function memberX(member, layout, t, shotDuration) {
    // cast.dx: a free place dx world units from the mark (the marks stay as snapping points).
    const x = layout.marks[member.mark] + (member.dx || 0) * layout.ratio;
    if (!member.walk) return x;
    const span = member.walk.time || shotDuration || 1;
    const k = clamp01(t / span);
    // arrive: walk in and stop ON the mark (start dx before it); otherwise start on the mark.
    return x + member.walk.dx * layout.ratio * (member.walk.arrive ? k - 1 : k);
  }

  /**
   * The actions a cast member plays in a shot, in order: its own `action` from the start
   * (part-way in by `from`), then each of `actions` from its time `at` (seconds in the shot).
   */
  function segmentsOf(member) {
    const first = { action: member.action, at: 0, from: member.from || 0 };
    const rest = (member.actions || []).map((a) => ({ action: a.action, at: a.at, from: a.from || 0 }));
    return [first].concat(rest);
  }

  /** The action playing at shot-local time t and how far into it: {action, time, index, at}. */
  function segmentAt(member, t) {
    const segs = segmentsOf(member);
    let i = 0;
    while (i + 1 < segs.length && t >= segs[i + 1].at) i++;
    const s = segs[i];
    return { action: s.action, time: t - s.at + s.from, index: i, at: s.at };
  }

  /** At cast.back = 1 (as far back as a character goes): this much higher on the ground... */
  const BACK_RISE = 140;
  /** ...and drawn this much smaller. */
  const BACK_SHRINK = 0.4;

  /**
   * Where a member stands in depth: cast.back 0 (front, on the ground line) .. 1 (far back).
   * rise: world units up from the ground line; shrink: size factor.
   */
  function depthOf(member, layout) {
    const b = Math.min(1, Math.max(0, member.back || 0));
    return { rise: b * BACK_RISE * layout.ratio, shrink: 1 - b * BACK_SHRINK };
  }

  /**
   * How far a world x is pulled toward the middle in this frame, as the marks are: 1 in 16:9; in
   * 9:16 the ratio of the portrait marks' spread to the landscape ones' (so a piece of decor put
   * by a mark stays by it). Returns {centre, k}: x' = centre + (x - centre) * k.
   */
  function markPull(world, viewport) {
    const p = viewport.height > viewport.width && world.portrait && world.portrait.marks;
    const m = world.marks;
    const mid = m.orta == null ? world.width / 2 : m.orta;
    if (!p || !(m.sag > m.sol)) return { centre: mid, to: mid, k: 1 };
    return { centre: mid, to: p.orta, k: (p.sag - p.sol) / (m.sag - m.sol) };
  }

  /** Where a piece of decor at world x stands in this frame (see markPull). */
  function decorX(x, world, viewport) {
    const pull = markPull(world, viewport);
    return pull.to + (x - pull.centre) * pull.k;
  }

  /** Half the world width a member takes: a character standing back is drawn smaller. */
  function memberHalfWidth(member, layout) {
    return RIG_HALF_WIDTH * layout.scale * depthOf(member, layout).shrink;
  }

  function shotDuration(shot) {
    return shot.end != null && shot.start != null ? shot.end - shot.start : 1;
  }

  /** Where the camera looks at progress p: a targeted prop, its target, else the middle of the cast. */
  function focusX(shot, layout, p) {
    const anchor = propAnchor(shot);
    if (anchor) return anchor[0];
    const cast = shot.camera.target ? shot.cast.filter((m) => m.id === shot.camera.target) : shot.cast;
    if (!cast.length) return null;
    const dur = shotDuration(shot);
    let sum = 0;
    for (const m of cast) sum += memberX(m, layout, (p || 0) * dur, dur);
    return sum / cast.length;
  }

  /** Walking direction (+1 right, -1 left, 0 standing) of the member the camera follows. */
  function walkDirection(shot) {
    const id = shot.camera.target || (shot.cast.length === 1 ? shot.cast[0].id : null);
    const m = id && shot.cast.filter((c) => c.id === id)[0];
    return m && m.walk ? Math.sign(m.walk.dx) : 0;
  }

  /** World point of the prop the camera targets, if its target is a prop ([x, y]) — else null. */
  function propAnchor(shot) {
    const t = shot.camera.target;
    return t && shot.anchors && shot.anchors[t] ? shot.anchors[t] : null;
  }

  /** Margin kept on each side of the cast when the camera frames everyone. */
  const CAST_MARGIN = 20;

  /** World width the camera must keep visible: the whole cast, unless it follows a target. */
  function keepWidthFor(shot, layout) {
    if (shot.camera.target || !shot.cast.length) return null;
    let lo = Infinity;
    let hi = -Infinity;
    const dur = shotDuration(shot);
    for (const m of shot.cast) {
      for (const x of [memberX(m, layout, 0, dur), memberX(m, layout, dur, dur)]) {
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
    }
    return hi - lo + 2 * (RIG_HALF_WIDTH * layout.scale + CAST_MARGIN);
  }

  /** Half of a scene change's dip to black, in seconds (out, then back in). */
  const TRANSITION_HALF = 0.3;

  /**
   * How dark the picture is at time t (0 clear, 1 black): it dips to black around each change of
   * scene (unless that scene begins with gecis "kesme"), so scenes no longer jump into each other.
   * The film's first and last frames stay clear: the panel opens on the first one.
   * @param {{scene_id:string, start:number, end:number, gecis?:string}[]} shots
   */
  function transitionAlpha(shots, t) {
    if (!shots.length) return 0;
    const cuts = [];
    for (let i = 1; i < shots.length; i++) {
      if (shots[i].scene_id !== shots[i - 1].scene_id && shots[i].gecis !== "kesme") cuts.push(shots[i].start);
    }
    let a = 0;
    for (const c of cuts) {
      const d = Math.abs(t - c);
      if (d < TRANSITION_HALF) a = Math.max(a, 1 - d / TRANSITION_HALF);
    }
    return a;
  }

  /** Default rig face height (rig units) when a character does not declare one. */
  const DEFAULT_FACE_Y = 400;

  /**
   * World y the camera anchors to: a targeted prop, else the faces of its target or the cast.
   * @param {Record<string, number>} [faces] character id → face y in rig units
   */
  function focusFaceY(shot, layout, world, faces) {
    const anchor = propAnchor(shot);
    if (anchor) return anchor[1];
    const cast = shot.camera.target ? shot.cast.filter((m) => m.id === shot.camera.target) : shot.cast;
    if (!cast.length) return null;
    let sum = 0;
    for (const m of cast) {
      const fy = faces && faces[m.id] != null ? faces[m.id] : DEFAULT_FACE_Y;
      const d = depthOf(m, layout);
      sum += world.ground_y - d.rise - (950 - fy) * layout.scale * d.shrink;
    }
    return sum / cast.length;
  }

  /** Share of the visible width kept as lead room ahead of a walker the camera follows. */
  const LEAD_ROOM = 0.15;

  /** Camera of a shot at progress p, with focus and cast framing worked out. */
  function shotCamera(shot, p, world, presets, viewport, faces) {
    const layout = layoutFor(world, viewport);
    let x = focusX(shot, layout, p);
    const move = presets.moves[shot.camera.move || "static"];
    if (move.follow && x != null) {
      // tracking: stay with the walker and keep space ahead of them (lead room)
      const fit = Math.max(viewport.width / world.width, viewport.height / world.height);
      const zoom = presets.framings[shot.camera.framing].zoom * fit;
      x += walkDirection(shot) * LEAD_ROOM * (viewport.width / zoom);
    }
    return cameraAt(shot.camera, p, x, world, presets, viewport, keepWidthFor(shot, layout), focusFaceY(shot, layout, world, faces));
  }

  /**
   * Cast members that are not fully inside the frame at the start, middle or end of a shot.
   * @returns {string[]} character ids
   */
  function outOfFrame(shot, world, presets, viewport, faces) {
    if (propAnchor(shot)) return []; // an insert on a prop leaves people out on purpose
    const layout = layoutFor(world, viewport);
    const out = {};
    for (const p of [0, 0.5, 1]) {
      const cam = shotCamera(shot, p, world, presets, viewport, faces);
      const left = cam.cx - viewport.width / cam.zoom / 2;
      const right = cam.cx + viewport.width / cam.zoom / 2;
      for (const m of shot.cast) {
        const half = memberHalfWidth(m, layout); // narrower when standing back
        const x = memberX(m, layout, p * shotDuration(shot), shotDuration(shot));
        if (x - half < left || x + half > right) out[m.id] = true;
      }
    }
    return Object.keys(out);
  }

  /**
   * The camera a background is drawn for: a wide, still shot with no target, as cameraAt frames it
   * in this format (in 9:16 that includes the portrait zoom and the caption headroom). Such a shot
   * sees every layer exactly as drawn; other shots move the layers by parallax.
   */
  function homeCamera(world, viewport, presets) {
    if (!presets || !presets.framings || !presets.framings.wide) {
      return { cx: world.width / 2, cy: world.height / 2, zoom: Math.max(viewport.width / world.width, viewport.height / world.height) };
    }
    return cameraAt({ framing: "wide", move: "static" }, 0, null, world, { framings: presets.framings, moves: { static: {} } }, viewport, null, null);
  }

  /**
   * Parallax for a background layer at `depth` (0 the farthest, 1 the characters' plane), as the
   * transform {s, tx, ty} of the layer inside the camera group: q = p * s + t. The layer is seen
   * through its own camera, which moves and zooms only `depth` of the way from the home camera
   * (`home`, see homeCamera) to the shot's camera now (`cam`). The farthest layer always looks as
   * drawn; the nearer a layer, the more it follows the camera. Parallax alone never shows past a
   * layer's edge (the layer camera stays between two cameras that see only the world); a scene's
   * own layer settings (moved, scaled down) can, so draw such layers with some margin.
   */
  function parallaxTransform(cam, home, depth) {
    const start = home;
    const d = Math.min(1, Math.max(0, depth));
    if (d === 1) return { s: 1, tx: 0, ty: 0 };
    const lx = start.cx + d * (cam.cx - start.cx);
    const ly = start.cy + d * (cam.cy - start.cy);
    const lz = start.zoom + d * (cam.zoom - start.zoom);
    const s = lz / cam.zoom;
    return { s, tx: cam.cx - lx * s, ty: cam.cy - ly * s };
  }

  /**
   * Time of day as a colour grade: per-channel gain, offset and saturation. Noon is the drawing as
   * it is. Night is dark, blue and greyish; evening warm orange; morning a little golden.
   */
  const LIGHT_PRESETS = {
    sabah: { gain: [1.04, 1.0, 0.9], offset: [0.03, 0.02, 0], sat: 1.05 },
    ogle: { gain: [1, 1, 1], offset: [0, 0, 0], sat: 1 },
    aksam: { gain: [1.0, 0.8, 0.68], offset: [0.04, 0, 0.02], sat: 1.1 },
    gece: { gain: [0.42, 0.5, 0.75], offset: [0, 0.01, 0.05], sat: 0.6 },
  };
  const LIGHT_TIMES = Object.keys(LIGHT_PRESETS);
  const LUMA = [0.2126, 0.7152, 0.0722];
  const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];

  /**
   * The feColorMatrix values (20 numbers, row-major 4x5) for time of day `saat` at strength `guc`
   * (0 none .. 1 full, default 1): the way from the identity to the preset. Unknown times are none.
   */
  function lightMatrix(saat, guc) {
    const p = LIGHT_PRESETS[saat];
    const k = Math.min(1, Math.max(0, guc == null ? 1 : guc));
    if (!p || k === 0) return IDENTITY_MATRIX.slice();
    const m = IDENTITY_MATRIX.slice();
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const satEl = (1 - p.sat) * LUMA[c] + (r === c ? p.sat : 0);
        m[r * 5 + c] = p.gain[r] * satEl;
      }
      m[r * 5 + 4] = p.offset[r];
    }
    return m.map((v, i) => Math.round((IDENTITY_MATRIX[i] + k * (v - IDENTITY_MATRIX[i])) * 10000) / 10000);
  }

  /** SVG transform string that puts camera point (cx,cy) at the viewport centre. */
  function cameraTransform(cam, viewport) {
    const tx = viewport.width / 2 - cam.cx * cam.zoom;
    const ty = viewport.height / 2 - cam.cy * cam.zoom;
    return "translate(" + tx.toFixed(2) + " " + ty.toFixed(2) + ") scale(" + cam.zoom.toFixed(4) + ")";
  }

  const api = {
    EASES,
    RHUBARB_TO_VISEME,
    ease,
    sampleAction,
    blendPose,
    idleOffsets,
    blinkClosed,
    phaseFor,
    visemeAt,
    expressionAt,
    partShown,
    mouthAt,
    wordIndexAt,
    cameraAt,
    cameraTransform,
    parallaxTransform,
    homeCamera,
    layoutFor,
    focusX,
    memberX,
    memberHalfWidth,
    markPull,
    decorX,
    lightMatrix,
    LIGHT_TIMES,
    depthOf,
    focusFaceY,
    segmentsOf,
    segmentAt,
    keepWidthFor,
    shotCamera,
    outOfFrame,
    transitionAlpha,
    TRANSITION_HALF,
    hoseGeometry,
    secondaryMotion,
    LAG,
  };
  root.CizgiCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
