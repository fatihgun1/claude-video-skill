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
  const BLEND = 0.3; // seconds to blend from the previous shot's pose
  const ROTATABLE = ["body", "head", "arm_L_upper", "arm_L_lower", "hand_L", "arm_R_upper", "arm_R_lower", "hand_R", "leg_L", "leg_R", "ear_L", "ear_R", "tail"];
  const VISEMES = ["mouth_rest", "mouth_A", "mouth_E", "mouth_O", "mouth_U", "mouth_MBP", "mouth_FV", "mouth_L", "mouth_smile"];
  const rigScale = D.world.character_height / 900;

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
      if (!el) continue;
      const pivot = el.getAttribute("data-pivot").split(",").map(Number);
      joints.push({ name, el, px: pivot[0], py: pivot[1] });
    }
    const visemes = {};
    for (const v of VISEMES) visemes[v] = part(v);
    rigs[ch.id] = {
      wrap: byId("kar-" + ch.id),
      root: part("root"),
      joints,
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
  const backgrounds = {};
  for (const bg of D.backgrounds) backgrounds[bg] = byId("bg-" + bg);
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

  function poseFor(shotIdx, member, local) {
    const pose = C.sampleAction(D.actions[member.action], local);
    const prev = shotIdx > 0 ? D.shots[shotIdx - 1] : null;
    const prevMember = prev && castMember(prev, member.id);
    if (!prevMember || local >= BLEND) return pose;
    const prevPose = C.sampleAction(D.actions[prevMember.action], prev.end - prev.start);
    return C.blendPose(prevPose, pose, C.ease("inOutSine", local / BLEND));
  }

  function drawCharacter(rig, member, pose, t, speaking) {
    const x = D.world.marks[member.mark];
    const flip = member.facing === "sol" ? -1 : 1;
    const sx = (pose.root_sx == null ? 1 : pose.root_sx) * rigScale * flip;
    const sy = (pose.root_sy == null ? 1 : pose.root_sy) * rigScale;
    const y = D.world.ground_y + (pose.root_y || 0) * rigScale;
    rig.root.setAttribute("transform", "translate(" + x + " " + y + ") scale(" + sx.toFixed(4) + " " + sy.toFixed(4) + ") translate(-500 -950)");

    const idle = C.idleOffsets(t, rig.phase);
    for (const j of rig.joints) {
      const angle = (pose[j.name] || 0) + (idle[j.name] || 0);
      j.el.setAttribute("transform", "rotate(" + angle.toFixed(2) + " " + j.px + " " + j.py + ")");
    }

    const closed = C.blinkClosed(t, rig.phase);
    for (const pair of rig.eyes) {
      setShown(pair[0], !closed);
      setShown(pair[1], closed);
    }

    const viseme = speaking ? C.visemeAt(speaking.cues, t - speaking.start) : "mouth_rest";
    if (viseme !== rig.shownViseme) {
      setShown(rig.visemes[rig.shownViseme], false);
      setShown(rig.visemes[viseme], true);
      rig.shownViseme = viseme;
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

    for (const bg in backgrounds) setShown(backgrounds[bg], bg === shot.bg);

    for (const ch of D.characters) {
      const rig = rigs[ch.id];
      const member = castMember(shot, ch.id);
      setShown(rig.wrap, !!member);
      if (!member) continue;
      const speaking = line && line.u.speaker === ch.id ? line.u : null;
      drawCharacter(rig, member, poseFor(idx, member, local), t, speaking);
    }

    const target = shot.camera.target ? castMember(shot, shot.camera.target) : null;
    const targetX = target ? D.world.marks[target.mark] : null;
    const p = (t - shot.start) / (shot.end - shot.start);
    const cam = C.cameraAt(shot.camera, p, targetX, D.world, D.cameras, D.viewport);
    camera.setAttribute("transform", C.cameraTransform(cam, D.viewport));

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
