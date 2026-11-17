/*
 * Çizgi Stüdyo — browser player.
 * Reads the compiled episode data (window.__CIZGI__) and draws the frame for any time t.
 * HyperFrames' anime.js adapter drives it: it seeks every object in window.__hfAnime
 * that has seek(ms) / pause() / play(). The player owns no clock, so every frame is
 * a pure function of t and seeking is deterministic.
 */
(function () {
  "use strict";
  const C = window.CizgiCore;
  const D = window.__CIZGI__;
  const BLEND = 0.45; // seconds to blend from the previous shot's pose
  const ROTATABLE = ["body", "body_back", "head", "leg_L", "leg_R", "ear_L", "ear_R", "tail"];
  // body_back (the layer drawn behind the legs) turns with the body.
  const CHANNEL_OF = { body_back: "body" };
  // [hose group, end group that follows it]; legs are hoses only when the rig draws knees.
  const HOSES = [["arm_L", "hand_L"], ["arm_R", "hand_R"], ["leg_L", "foot_L"], ["leg_R", "foot_R"]];
  const VISEMES = ["mouth_rest", "mouth_A", "mouth_E", "mouth_O", "mouth_U", "mouth_MBP", "mouth_FV", "mouth_L", "mouth_smile"];
  const layout = C.layoutFor(D.world, D.viewport);
  const rigScale = layout.scale;
  let layeredShot = -1; // the shot whose depth order the characters are stacked in

  function byId(id) {
    return document.getElementById(id);
  }

  function setShown(el, shown) {
    if (!el) return;
    const value = shown ? "inline" : "none";
    if (el.getAttribute("display") !== value) el.setAttribute("display", value);
  }

  // ---- one-time lookup of every element the player touches ----
  const rigs = {};
  for (const ch of D.characters) {
    const part = (name) => byId(ch.id + "--" + name);
    const joints = [];
    for (const name of ROTATABLE) {
      const el = part(name);
      if (!el || el.hasAttribute("data-hose")) continue;
      const pivot = el.getAttribute("data-pivot").split(",").map(Number);
      joints.push({ name: CHANNEL_OF[name] || name, el, px: pivot[0], py: pivot[1] });
    }
    const hoses = [];
    for (const pair of HOSES) {
      const limb = part(pair[0]);
      if (!limb || !limb.hasAttribute("data-hose")) continue;
      const rest = limb.getAttribute("data-hose").trim().split(/\s+/).map((pt) => pt.split(",").map(Number));
      const paths = Array.prototype.slice.call(limb.querySelectorAll(":scope > path.hose-line, :scope > path.hose-fill"));
      hoses.push({ name: pair[0], endName: pair[1], rest, paths, end: part(pair[1]) });
    }
    const grips = [];
    for (const side of ["L", "R"]) {
      const open = part("hand_" + side + "_open");
      const closed = part("hand_" + side + "_grip");
      if (open || closed) grips.push({ channel: "grip_" + side, open, closed });
    }
    const visemes = {};
    for (const v of VISEMES) visemes[v] = part(v);
    // costume variants (cast[].varyant): parts shown or hidden per variant, and each variant's colours
    const wrap = byId("kar-" + ch.id);
    const variantParts = wrap
      ? Array.prototype.slice.call(wrap.querySelectorAll("[data-varyant],[data-varyant-yok]")).map((el) => ({
        el, attrs: { varyant: el.getAttribute("data-varyant"), yok: el.getAttribute("data-varyant-yok") },
      }))
      : [];
    const readJson = (name) => {
      try {
        return JSON.parse((wrap && wrap.getAttribute(name)) || "{}");
      } catch (e) {
        return {};
      }
    };
    rigs[ch.id] = {
      wrap,
      variantParts,
      variantColours: readJson("data-varyant-renk"),
      baseColours: readJson("data-renk"),
      shownVariant: null,
      root: part("root"),
      joints,
      hoses,
      grips,
      visemes,
      shownViseme: "mouth_rest",
      eyes: [
        [part("eye_L_open"), part("eye_L_closed")],
        [part("eye_R_open"), part("eye_R_closed")],
      ],
      phase: C.phaseFor(ch.id),
    };
  }
  const camera = byId("kamera");
  const dofBlur = byId("dof-blur");
  // the scene light (scene.isik): a colour matrix over the world group, off when the scene has none
  const lightGroup = byId("isik-g");
  const lightMatrixEl = byId("isik-m");
  const fade = byId("gecis"); // the dip to black between scenes
  let lightKey = null;
  const backgrounds = {};
  for (const bg of D.backgrounds) backgrounds[bg] = byId("bg-" + bg);
  // each scene's decor (scene.dekor): shown with its scene
  const decorEls = {};
  for (const sid of D.decor || []) decorEls[sid] = byId("dekor-" + sid);
  // each background's layers, back to front: moved by parallax and the scene's layer settings
  const layerEls = {};
  for (const bg of D.backgrounds) {
    layerEls[bg] = ((D.layers && D.layers[bg]) || []).map((l) => ({ id: l.id, depth: l.derinlik, el: byId("bg-" + bg + "--k-" + l.id) }));
  }
  // Props: a ground copy in the world and a copy inside the holder's hand; one is shown at a time.
  const props = D.shots.map((shot) =>
    (shot.props || []).map((pr) => ({
      holder: pr.holder,
      grab: pr.grab,
      ground: byId("prop-" + pr.key + "-yer"),
      held: byId("prop-" + pr.key + "-el"),
    })),
  );
  const captions = D.shots.map((shot) =>
    shot.utterances.map((u, i) => {
      const box = byId("altyazi-" + shot.shot_id + "-" + i);
      return { box, words: box ? Array.prototype.slice.call(box.querySelectorAll(".kelime")) : [] };
    }),
  );

  // ---- per-frame helpers ----
  function shotIndexAt(t) {
    for (let i = 0; i < D.shots.length; i++) if (t < D.shots[i].end) return i;
    return D.shots.length - 1;
  }

  function castMember(shot, id) {
    for (const m of shot.cast) if (m.id === id) return m;
    return null;
  }

  /** The pose of a member's action sequence at shot-local time t (no blending). */
  function rawPose(member, t) {
    const seg = C.segmentAt(member, t);
    return C.sampleAction(D.actions[seg.action], seg.time);
  }

  function poseFor(shotIdx, member, local) {
    // cast.from starts an action part-way, so a cut can continue a movement (cut on action);
    // cast.actions follow one another inside the shot
    const seg = C.segmentAt(member, local);
    const pose = C.sampleAction(D.actions[seg.action], seg.time);
    const since = local - seg.at;
    if (since >= BLEND) return pose;
    let before = null;
    if (seg.index > 0) {
      // ease out of the pose on screen when this action began: the previous action, itself
      // possibly still blending in (so a short action between two others does not pop)
      before = poseFor(shotIdx, member, seg.at - 1e-6);
    } else {
      const prev = shotIdx > 0 ? D.shots[shotIdx - 1] : null;
      const prevMember = prev && castMember(prev, member.id);
      if (prevMember) before = rawPose(prevMember, prev.end - prev.start);
    }
    if (!before) return pose;
    return C.blendPose(before, pose, C.ease("inOutSine", since / BLEND));
  }

  /** Show the parts and colours of a costume variant ("" = the drawing as it is) when it changes. */
  function applyVariant(rig, variant) {
    if (rig.shownVariant === variant) return;
    rig.shownVariant = variant;
    for (const p of rig.variantParts) setShown(p.el, C.partShown(p.attrs, variant));
    if (!rig.wrap) return;
    const keys = {};
    for (const v in rig.variantColours) for (const k in rig.variantColours[v]) keys[k] = true;
    for (const k in keys) {
      const value = (rig.variantColours[variant] || {})[k] || rig.baseColours[k];
      if (value) rig.wrap.style.setProperty("--" + k, value);
      else rig.wrap.style.removeProperty("--" + k);
    }
  }

  function drawCharacter(rig, member, pose, t, speaking, local, duration) {
    applyVariant(rig, member.varyant || "");
    const flip = member.facing === "sol" ? -1 : 1;
    const depth = C.depthOf(member, layout); // cast.back: higher up the ground, smaller
    const k = rigScale * depth.shrink;
    // root_x moves the whole figure sideways within its action (forward is where it faces): sitting down, the hips go back
    const x = C.memberX(member, layout, local, duration) + (pose.root_x || 0) * k * flip;
    const sx = (pose.root_sx == null ? 1 : pose.root_sx) * k * flip;
    const sy = (pose.root_sy == null ? 1 : pose.root_sy) * k;
    const y = D.world.ground_y - depth.rise + (pose.root_y || 0) * k;
    rig.root.setAttribute("transform", "translate(" + x + " " + y + ") scale(" + sx.toFixed(4) + " " + sy.toFixed(4) + ") translate(-500 -950)");

    const idle = C.idleOffsets(t, rig.phase);
    for (const j of rig.joints) {
      const angle = (pose[j.name] || 0) + (idle[j.name] || 0);
      j.el.setAttribute("transform", "rotate(" + angle.toFixed(2) + " " + j.px + " " + j.py + ")");
    }

    for (const h of rig.hoses) {
      const upper = pose[h.name + "_upper"] || 0;
      const lower = pose[h.name + "_lower"] || 0;
      const geo = C.hoseGeometry(h.rest, upper, lower, pose[h.name + "_lift"] || 0);
      for (const path of h.paths) path.setAttribute("d", geo.d);
      if (!h.end) continue;
      const w = h.rest[2];
      const turn = upper + lower + (pose[h.endName] || 0);
      h.end.setAttribute(
        "transform",
        "translate(" + (geo.wrist[0] - w[0]).toFixed(2) + " " + (geo.wrist[1] - w[1]).toFixed(2) + ") rotate(" + turn.toFixed(2) + " " + w[0] + " " + w[1] + ")",
      );
    }

    for (const g of rig.grips) {
      const gripping = (pose[g.channel] || 0) >= 0.5;
      setShown(g.open, !gripping);
      setShown(g.closed, gripping);
    }

    const closed = C.blinkClosed(t, rig.phase);
    // gaze: the eyes look where the pose says (rig units), e.g. down at what the hands hold
    const gaze = "translate(" + (pose.gaze_x || 0).toFixed(1) + " " + (pose.gaze_y || 0).toFixed(1) + ")";
    for (const pair of rig.eyes) {
      setShown(pair[0], !closed);
      setShown(pair[1], closed);
      for (const el of pair) if (el) el.setAttribute("transform", gaze);
    }

    // speech first; in its silences and outside lines the face shows the expression (cast[].ifade)
    const viseme = C.mouthAt(speaking ? C.visemeAt(speaking.cues, t - speaking.start) : "mouth_rest", C.expressionAt(member, local));
    if (viseme !== rig.shownViseme) {
      setShown(rig.visemes[rig.shownViseme], false);
      setShown(rig.visemes[viseme], true);
      rig.shownViseme = viseme;
    }
  }

  /**
   * The current background's layers: parallax against the home camera (the background as drawn),
   * then the scene's settings (scene.katmanlar): moved by dx/dy, scaled by olcek around the bottom
   * middle of the world (where the ground meets the frame in a wide shot), tinted (a filter made at
   * compile time), or hidden. A dolly scales the whole background group, every layer alike.
   */
  const home = C.homeCamera(D.world, D.viewport, D.cameras);
  function drawLayers(shot, cam) {
    const list = layerEls[shot.bg] || [];
    if (!list.length) return;
    const start = home;
    const ax = D.world.width / 2;
    const ay = D.world.height;
    for (const l of list) {
      if (!l.el) continue;
      const set = (shot.katmanlar && shot.katmanlar[l.id]) || {};
      setShown(l.el, !set.gizli);
      if (set.gizli) continue;
      const px = C.parallaxTransform(cam, start, l.depth);
      const parts = [];
      if (px.s !== 1 || px.tx !== 0 || px.ty !== 0) parts.push("translate(" + px.tx.toFixed(2) + " " + px.ty.toFixed(2) + ") scale(" + px.s.toFixed(5) + ")");
      if (set.dx || set.dy) parts.push("translate(" + (set.dx || 0) + " " + (set.dy || 0) + ")");
      if (set.olcek && set.olcek !== 1) parts.push("translate(" + ax + " " + ay + ") scale(" + set.olcek + ") translate(" + -ax + " " + -ay + ")");
      if (parts.length) l.el.setAttribute("transform", parts.join(" "));
      else l.el.removeAttribute("transform");
      if (set.ton) l.el.setAttribute("filter", "url(#ton-" + set.ton.slice(1).toLowerCase() + ")");
      else l.el.removeAttribute("filter");
    }
  }

  function activeLine(shot, t) {
    for (let i = 0; i < shot.utterances.length; i++) {
      const u = shot.utterances[i];
      if (t >= u.start && t < u.end) return { u, i };
    }
    return null;
  }

  function render(t) {
    const idx = shotIndexAt(t);
    const shot = D.shots[idx];
    const local = t - shot.start;
    const line = activeLine(shot, t);

    // Shallow focus: close framings soften the background so the eye goes to the subject.
    const blur = (D.cameras.framings[shot.camera.framing] || {}).blur || 0;
    if (dofBlur) dofBlur.setAttribute("stdDeviation", String(blur));
    for (const bg in backgrounds) {
      setShown(backgrounds[bg], bg === shot.bg);
      if (!backgrounds[bg]) continue;
      if (blur > 0 && bg === shot.bg) backgrounds[bg].setAttribute("filter", "url(#dof)");
      else backgrounds[bg].removeAttribute("filter");
      // Dolly: the camera moves forward along a perspective background, so the background
      // (and what lies in it) grows around its vanishing point while the characters keep their size.
      const move = D.cameras.moves[shot.camera.move || "static"] || {};
      const vp = D.vanishing && D.vanishing[bg];
      if (bg === shot.bg && move.dolly_to && vp) {
        const k = C.ease(move.ease || "linear", (t - shot.start) / (shot.end - shot.start));
        const s = 1 + (move.dolly_to - 1) * k;
        backgrounds[bg].setAttribute("transform", "translate(" + vp[0] + " " + vp[1] + ") scale(" + s.toFixed(4) + ") translate(" + -vp[0] + " " + -vp[1] + ")");
      } else backgrounds[bg].removeAttribute("transform");
    }

    for (const sid in decorEls) setShown(decorEls[sid], sid === shot.scene_id);

    // noon and zero strength change nothing: no filter pass at all
    const light = shot.isik && shot.isik.saat !== "ogle" && shot.isik.guc !== 0 ? shot.isik : null;
    const key = light ? light.saat + ":" + (light.guc == null ? 1 : light.guc) : "";
    if (lightGroup && lightMatrixEl && key !== lightKey) {
      lightKey = key;
      if (light) {
        lightMatrixEl.setAttribute("values", C.lightMatrix(light.saat, light.guc).join(" "));
        lightGroup.setAttribute("filter", "url(#isik)");
      } else lightGroup.removeAttribute("filter");
    }

    if (idx !== layeredShot) {
      // Who stands further back is drawn first (behind); same depth keeps the episode's order.
      layeredShot = idx;
      const order = D.characters
        .map((ch, i) => ({ wrap: rigs[ch.id].wrap, back: (castMember(shot, ch.id) || {}).back || 0, i }))
        .sort((a, b) => b.back - a.back || a.i - b.i);
      // The characters are the last children of the camera group (backgrounds and ground props
      // come first), so moving them to the end keeps them in front of those.
      for (const o of order) if (o.wrap && o.wrap.parentNode) o.wrap.parentNode.appendChild(o.wrap);
    }

    for (const ch of D.characters) {
      const rig = rigs[ch.id];
      const member = castMember(shot, ch.id);
      setShown(rig.wrap, !!member);
      if (!member) continue;
      const speaking = line && line.u.speaker === ch.id ? line.u : null;
      const pose = C.secondaryMotion(poseFor(idx, member, local), poseFor(idx, member, Math.max(0, local - C.LAG)));
      drawCharacter(rig, member, pose, t, speaking, local, shot.end - shot.start);
    }

    if (fade) fade.setAttribute("opacity", C.transitionAlpha(D.shots, t).toFixed(3));

    const p = (t - shot.start) / (shot.end - shot.start);
    const cam = C.shotCamera(shot, p, D.world, D.cameras, D.viewport, D.faces);
    camera.setAttribute("transform", C.cameraTransform(cam, D.viewport));
    drawLayers(shot, cam);

    props.forEach((list, si) =>
      list.forEach((pr) => {
        const active = si === idx;
        const attached = !!pr.holder && (pr.grab == null || local >= pr.grab);
        setShown(pr.ground, active && !attached);
        setShown(pr.held, active && attached);
      }),
    );

    captions.forEach((lines, si) =>
      lines.forEach((cap, li) => {
        const on = si === idx && line !== null && line.i === li;
        if (cap.box) cap.box.style.display = on ? "block" : "none";
        if (!on) return;
        const w = C.wordIndexAt(shot.utterances[li].words, t - shot.utterances[li].start);
        cap.words.forEach((el, wi) => el.classList.toggle("soylenen", wi === w));
      }),
    );
  }

  const player = {
    seek(ms) {
      render(Math.max(0, ms) / 1000);
    },
    pause() {},
    play() {},
  };
  window.__hfAnime = window.__hfAnime || [];
  window.__hfAnime.push(player);
  render(0);
})();
