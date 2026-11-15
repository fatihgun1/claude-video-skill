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
  function cameraAt(shotCamera, p, targetX, world, presets, viewport) {
    const framing = presets.framings[shotCamera.framing];
    const move = presets.moves[shotCamera.move || "static"];
    const zStart = framing.zoom * (move.zoom_from || 1);
    const zEnd = framing.zoom * (move.zoom_to || 1);
    const k = ease(move.ease || "inOutSine", p);
    // `fit` is the zoom needed to cover the viewport (1 for 16:9, ~1.78 for 9:16). A portrait
    // frame is already tight, so framing zoom is compressed there instead of multiplied.
    const fit = Math.max(viewport.width / world.width, viewport.height / world.height);
    const z = Math.max(zStart + (zEnd - zStart) * k, 1);
    const zoom = Math.max(z, fit * (1 + (z - 1) * PORTRAIT_ZOOM_SHARE));

    const panFrom = move.pan_from || 0;
    const panTo = move.pan_to || 0;
    const baseX = targetX == null ? world.width / 2 : targetX;
    let cx = baseX + (panFrom + (panTo - panFrom) * k) * world.width;
    let cy = world.height * (framing.focus_y == null ? 0.5 : framing.focus_y);

    const halfW = viewport.width / zoom / 2;
    const halfH = viewport.height / zoom / 2;
    cx = Math.min(Math.max(cx, halfW), world.width - halfW);
    cy = Math.min(Math.max(cy, halfH), world.height - halfH);
    return { zoom, cx, cy };
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
    wordIndexAt,
    cameraAt,
    cameraTransform,
  };
  root.CizgiCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
