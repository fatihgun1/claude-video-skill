// Generates Ela's action set from her rig geometry (two-link IK for planted feet and reaches).
// Usage (from the engine folder): node scripts/ela-hareketleri.mjs ../library/actions
// Rest points below are copied from library/characters/ela-profil/rig.svg; update them if the drawing changes.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv[2];
const deg = (r) => (r * 180) / Math.PI;
const ang = (v) => deg(Math.atan2(v[1], v[0]));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = (v) => Math.hypot(v[0], v[1]);
const r1 = (x) => Math.round(x * 10) / 10;

// ela-profil rest points (rig units)
const LEG_L = [[506, 778], [512, 842], [508, 904]];
const LEG_R = [[494, 778], [500, 842], [496, 904]];
const ARM_L = [[504, 624], [508, 690], [510, 750]];
const GRIP_L = [511, 771];
const BODY_PIVOT = [500, 780];

/** Two-link IK: angles (upper, lower) that put the end of `rest` at `target`; knee/elbow on `side` (+1 = forward). */
function ik(rest, target, side, extra = 0) {
  const [S, E, W] = rest;
  const L1 = len(sub(E, S));
  const L2 = len(sub(W, E)) + extra;
  const d = sub(target, S);
  const D = Math.min(len(d), L1 + L2 - 0.01);
  const a = Math.acos((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D));
  const base = ang(d);
  const thigh = base - side * deg(a); // knee forward (+x) for side = +1 when the limb points down
  const knee = [S[0] + L1 * Math.cos((thigh * Math.PI) / 180), S[1] + L1 * Math.sin((thigh * Math.PI) / 180)];
  const shin = ang(sub(target, knee));
  const upper = thigh - ang(sub(E, S));
  const lower = shin - ang(sub(W, E)) - upper;
  return { upper: r1(upper), lower: r1(lower) };
}

/** Leg angles that keep the ankle where it stands while the root drops by h (rig units). */
function plantedLeg(rest, h) {
  const { upper, lower } = ik(rest, [rest[2][0], rest[2][1] - h], +1);
  return { upper, lower, foot: r1(-(upper + lower)) };
}

const rot = (p, c, a) => {
  const r = (a * Math.PI) / 180;
  const x = p[0] - c[0], y = p[1] - c[1];
  return [c[0] + x * Math.cos(r) - y * Math.sin(r), c[1] + x * Math.sin(r) + y * Math.cos(r)];
};

function write(id, action) {
  writeFileSync(join(OUT, `${id}.json`), `${JSON.stringify(action, null, 2)}\n`);
  console.log("wrote", id);
}

/* ---------------- front ---------------- */
write("bekle-cocuk", {
  label: { tr: "Bekle (çocuk, nefes)", en: "Idle (child, breathing)" },
  views: ["front"],
  notes: "Child idle for front rigs: a slow breath (stretch 1.2%), a small weight shift from foot to foot and a head that follows it. Loops seamlessly.",
  duration: 2.4,
  loop: true,
  keys: [
    { t: 0, pose: { root_sy: 1, body: 0, head: 0, arm_L_upper: -4, arm_R_upper: 4 } },
    { t: 0.6, pose: { root_sy: 1.012, body: 2, head: 3, arm_L_upper: -3, arm_R_upper: 6 }, ease: "inOutSine" },
    { t: 1.2, pose: { root_sy: 1, body: 0, head: 0, arm_L_upper: -4, arm_R_upper: 4 }, ease: "inOutSine" },
    { t: 1.8, pose: { root_sy: 1.012, body: -2, head: -3, arm_L_upper: -6, arm_R_upper: 3 }, ease: "inOutSine" },
    { t: 2.4, pose: { root_sy: 1, body: 0, head: 0, arm_L_upper: -4, arm_R_upper: 4 }, ease: "inOutSine" },
  ],
});

// Front view: an arm raised to the side bends its forearm UP by turning it toward the head
// (negative for _L, positive for _R); hanging arms bend inward the other way.
const wave = (t, lower, hand) => ({ t, pose: { arm_L_upper: -100, arm_L_lower: lower, hand_L: hand, head: 5, body: 2, arm_R_upper: 6 }, ease: "inOutSine" });
write("el-salla-cocuk", {
  label: { tr: "El salla (çocuk)", en: "Wave (child)" },
  views: ["front"],
  notes: "Classic 'hi!' wave for front rigs with the arm on the viewer's right: a small dip as anticipation, the elbow comes out to shoulder height, the forearm stands up and swings side to side three times with the hand trailing, the head tilts toward the hand, then the arm comes down.",
  duration: 2.2,
  loop: false,
  keys: [
    { t: 0, pose: { arm_L_upper: -4, arm_L_lower: 0, hand_L: 0, head: 0, body: 0, arm_R_upper: 4, root_sy: 1 } },
    { t: 0.2, pose: { arm_L_upper: 8, arm_L_lower: 10, hand_L: 0, head: -2, body: -2, arm_R_upper: 4, root_sy: 0.98 }, ease: "inOutSine" },
    { t: 0.45, pose: { arm_L_upper: -105, arm_L_lower: -50, hand_L: -8, head: 6, body: 3, arm_R_upper: 8, root_sy: 1.01 }, ease: "outCubic" },
    wave(0.65, -30, 18), wave(0.85, -55, -18), wave(1.05, -30, 18), wave(1.25, -55, -18), wave(1.45, -30, 18), wave(1.65, -45, 0),
    { t: 2.2, pose: { arm_L_upper: -4, arm_L_lower: 0, hand_L: 0, head: 0, body: 0, arm_R_upper: 4, root_sy: 1 }, ease: "inOutCubic" },
  ],
});

write("sevin", {
  label: { tr: "Sevin (zıpla, kollar havada)", en: "Cheer (hop, arms up)" },
  views: ["front"],
  notes: "Joy for front rigs: crouch (squash) as anticipation, hop with both arms thrown up in a V and the legs kicking out a little, squash on landing, arms stay up and give two small pumps.",
  duration: 1.8,
  loop: false,
  keys: [
    { t: 0, pose: { root_y: 0, root_sy: 1, root_sx: 1, arm_L_upper: -4, arm_R_upper: 4, arm_L_lower: 0, arm_R_lower: 0, leg_L: 0, leg_R: 0, head: 0 } },
    { t: 0.25, pose: { root_y: 0, root_sy: 0.92, root_sx: 1.05, arm_L_upper: 12, arm_R_upper: -12, arm_L_lower: 0, arm_R_lower: 0, leg_L: 0, leg_R: 0, head: 0 }, ease: "inOutSine" },
    { t: 0.45, pose: { root_y: -70, root_sy: 1.06, root_sx: 0.97, arm_L_upper: -125, arm_R_upper: 125, arm_L_lower: 15, arm_R_lower: -15, leg_L: -10, leg_R: 10, head: 0 }, ease: "outCubic" },
    { t: 0.62, pose: { root_y: -82, root_sy: 1.02, root_sx: 0.99, arm_L_upper: -130, arm_R_upper: 130, arm_L_lower: 10, arm_R_lower: -10, leg_L: -6, leg_R: 6, head: 0 }, ease: "outSine" },
    { t: 0.82, pose: { root_y: 0, root_sy: 0.93, root_sx: 1.04, arm_L_upper: -120, arm_R_upper: 120, arm_L_lower: 20, arm_R_lower: -20, leg_L: 0, leg_R: 0, head: 0 }, ease: "inCubic" },
    { t: 1.0, pose: { root_y: 0, root_sy: 1, root_sx: 1, arm_L_upper: -125, arm_R_upper: 125, arm_L_lower: 10, arm_R_lower: -10, leg_L: 0, leg_R: 0, head: 0 }, ease: "outSine" },
    { t: 1.2, pose: { root_y: -8, root_sy: 1, root_sx: 1, arm_L_upper: -115, arm_R_upper: 115, arm_L_lower: 25, arm_R_lower: -25, leg_L: 0, leg_R: 0, head: 3 }, ease: "inOutSine" },
    { t: 1.4, pose: { root_y: 0, root_sy: 1, root_sx: 1, arm_L_upper: -127, arm_R_upper: 127, arm_L_lower: 10, arm_R_lower: -10, leg_L: 0, leg_R: 0, head: -3 }, ease: "inOutSine" },
    { t: 1.6, pose: { root_y: -8, root_sy: 1, root_sx: 1, arm_L_upper: -115, arm_R_upper: 115, arm_L_lower: 25, arm_R_lower: -25, leg_L: 0, leg_R: 0, head: 3 }, ease: "inOutSine" },
    { t: 1.8, pose: { root_y: 0, root_sy: 1, root_sx: 1, arm_L_upper: -125, arm_R_upper: 125, arm_L_lower: 10, arm_R_lower: -10, leg_L: 0, leg_R: 0, head: 0 }, ease: "inOutSine" },
  ],
});

write("goster", {
  label: { tr: "Göster (kolu uzat, oraya bak)", en: "Show (reach out, look there)" },
  views: ["front"],
  notes: "Front rigs show something to the viewer's right: the arm draws in a little, then reaches out level with a small overshoot, the body leans after it and the eyes look the same way. Holds.",
  duration: 2.2,
  loop: false,
  keys: [
    { t: 0, pose: { arm_L_upper: -4, arm_L_lower: 0, hand_L: 0, body: 0, head: 0, gaze_x: 0, arm_R_upper: 4 } },
    { t: 0.25, pose: { arm_L_upper: 6, arm_L_lower: 20, hand_L: 0, body: -2, head: -2, gaze_x: 3, arm_R_upper: 4 }, ease: "inOutSine" },
    { t: 0.5, pose: { arm_L_upper: -96, arm_L_lower: -4, hand_L: -6, body: 4, head: 5, gaze_x: 6, arm_R_upper: 8 }, ease: "outCubic" },
    { t: 0.7, pose: { arm_L_upper: -88, arm_L_lower: 0, hand_L: 0, body: 3, head: 4, gaze_x: 6, arm_R_upper: 6 }, ease: "inOutSine" },
    { t: 2.2, pose: { arm_L_upper: -86, arm_L_lower: 2, hand_L: 0, body: 3, head: 4, gaze_x: 6, arm_R_upper: 6 }, ease: "inOutSine" },
  ],
});

write("sasir", {
  label: { tr: "Şaşır (eller havada)", en: "Surprised (hands up)" },
  views: ["front"],
  notes: "Front rigs: a quick dip, then a small startled hop that stretches the body while both hands fly up beside the head (elbows out, forearms up, a classic startle that reads from the front) and the eyes look up; lands and holds the pose.",
  duration: 1.6,
  loop: false,
  keys: [
    { t: 0, pose: { root_y: 0, root_sy: 1, arm_L_upper: -4, arm_L_lower: 0, arm_R_upper: 4, arm_R_lower: 0, gaze_y: 0, head: 0 } },
    { t: 0.12, pose: { root_y: 0, root_sy: 0.96, arm_L_upper: -2, arm_L_lower: 0, arm_R_upper: 2, arm_R_lower: 0, gaze_y: 0, head: 0 }, ease: "inSine" },
    { t: 0.3, pose: { root_y: -26, root_sy: 1.06, arm_L_upper: -95, arm_L_lower: -72, arm_R_upper: 95, arm_R_lower: 72, gaze_y: -3, head: 0 }, ease: "outCubic" },
    { t: 0.5, pose: { root_y: 0, root_sy: 0.97, arm_L_upper: -90, arm_L_lower: -68, arm_R_upper: 90, arm_R_lower: 68, gaze_y: -3, head: 0 }, ease: "inCubic" },
    { t: 0.7, pose: { root_y: 0, root_sy: 1, arm_L_upper: -92, arm_L_lower: -70, arm_R_upper: 92, arm_R_lower: 70, gaze_y: -2, head: 0 }, ease: "outSine" },
    { t: 1.6, pose: { root_y: 0, root_sy: 1, arm_L_upper: -92, arm_L_lower: -70, arm_R_upper: 92, arm_R_lower: 70, gaze_y: -2, head: 0 }, ease: "inOutSine" },
  ],
});

/* ---------------- profile ---------------- */
const WORLD_PER_RIG = 620 / 900;
const FPS = 30;
const smooth = (u) => u * u * (3 - 2 * u);

/**
 * A gait solved frame by frame: during stance the ankle slides back along the ground at a
 * constant speed (so with cast.walk at `speed` it stays planted), during swing it travels
 * forward on an arc; the legs are solved with two-link IK every frame.
 */
function gait({ T, stance, a, swingHeight, root, body, head, arms }) {
  const legSet = (phiL) => [["L", LEG_L, phiL], ["R", LEG_R, (phiL + 0.5) % 1]];
  const ankle = (rest, phi, rootY) => {
    if (phi < stance) return [rest[2][0] + a - (2 * a * phi) / stance, 904 - rootY];
    const u = (phi - stance) / (1 - stance);
    return [rest[2][0] - a + 2 * a * smooth(u), 904 - rootY - swingHeight * Math.sin(Math.PI * u)];
  };
  let legsOf;
  const keys = [];
  const frames = Math.round(T * FPS);
  for (let f = 0; f <= frames; f++) {
    const t = f / FPS;
    const phiL = (t / T) % 1;
    legsOf = (rootY) => legSet(phiL).map(([, rest, phi]) => ik(rest, ankle(rest, phi, rootY), +1));
    // At the longest reach the hip drops a little more, so the knee never locks backwards
    // (the rig allows at most -5° there).
    let rootY = root(phiL);
    for (let tries = 0; tries < 40 && legsOf(rootY).some((l) => l.lower < -3); tries++) rootY += 0.5;
    const pose = { root_y: r1(rootY), body, head, ...arms(phiL) };
    for (const [s, rest, phi] of legSet(phiL)) {
      const hipX = rest[0][0], ankleX0 = rest[2][0];
      let x, lift = 0, toe = 0;
      if (phi < stance) {
        const u = phi / stance;
        x = ankleX0 + a - 2 * a * u;
        toe = u > 0.75 ? (u - 0.75) * 4 * 25 : 0; // peel the heel off before push-off
      } else {
        const u = (phi - stance) / (1 - stance);
        x = ankleX0 - a + 2 * a * smooth(u);
        lift = swingHeight * Math.sin(Math.PI * u);
        toe = 20 * Math.sin(Math.PI * u);
      }
      const y = 904 - rootY - lift; // ankle on the ground (or lifted) in the rig's own frame
      void hipX;
      const leg = ik(rest, [x, y], +1);
      pose[`leg_${s}_upper`] = leg.upper;
      pose[`leg_${s}_lower`] = leg.lower;
      pose[`foot_${s}`] = r1(-(leg.upper + leg.lower) + toe);
    }
    keys.push(f ? { t: r1(t * 1000) / 1000, pose, ease: "linear" } : { t: 0, pose });
  }
  keys[keys.length - 1].t = T;
  const speed = ((2 * a) / (stance * T)) * WORLD_PER_RIG;
  return { keys, speed: Math.round(speed) };
}

const run = gait({
  T: 0.6, stance: 0.38, a: 38, swingHeight: 42,
  root: (phi) => -3 + 9 * Math.cos(4 * Math.PI * (phi - 0.19)),
  body: 12, head: -8,
  arms: (phi) => ({
    arm_L_upper: r1(34 * Math.cos(2 * Math.PI * phi)), arm_L_lower: r1(-85 - 10 * Math.sin(2 * Math.PI * phi)),
    arm_R_upper: r1(-34 * Math.cos(2 * Math.PI * phi)), arm_R_lower: r1(-90 + 10 * Math.sin(2 * Math.PI * phi)),
  }),
});
write("kos-cocuk", {
  label: { tr: "Koş (çocuk, profil)", en: "Run (child, profile)" },
  views: ["profile-right"],
  notes: `Run cycle for short-legged knee rigs seen from the side (ela-profil), solved frame by frame: 0.6 s per cycle, each foot on the ground 38% of the cycle (so both feet are off the ground between steps), body leaning 12° into the run, bent arms pumping against the legs, a bounce that is lowest at mid-stance. Pair with cast.walk at ${run.speed} world units per second (dx = ${run.speed} × time) so the planted foot does not slide.`,
  duration: 0.6,
  loop: true,
  keys: run.keys,
});

const walk = gait({
  T: 0.8, stance: 0.6, a: 50, swingHeight: 20,
  root: (phi) => -1 - 3 * Math.cos(4 * Math.PI * (phi - 0.3)),
  body: 3, head: -2,
  arms: (phi) => ({
    arm_L_upper: r1(24 * Math.cos(2 * Math.PI * phi)), arm_L_lower: -6,
    arm_R_upper: r1(-24 * Math.cos(2 * Math.PI * phi)), arm_R_lower: -6,
  }),
});
write("yuru-cocuk", {
  label: { tr: "Yürü (çocuk, profil)", en: "Walk (child, profile)" },
  views: ["profile-right"],
  notes: `Walk cycle for short-legged knee rigs seen from the side (ela-profil), solved frame by frame so the planted foot never slides or floats: 0.8 s per cycle (quick child steps), each foot on the ground 60% of the cycle, a small bounce that is highest at mid-stance, arms swinging against the legs. Pair with cast.walk at ${walk.speed} world units per second (dx = ${walk.speed} × time).`,
  duration: 0.8,
  loop: true,
  keys: walk.keys,
});
console.log({ runSpeed: run.speed, walkSpeed: walk.speed });

// Crouch and pick up: feet stay planted (IK), body leans in, the near hand closes on the
// object's grip point. With grip angle 90 an upright object needs the forearm to point
// forward (body+upper+lower+hand = -90 and |hand| <= 55), so search the crouch depth, the
// body lean and the forearm direction for a pose whose upper arm exactly spans shoulder→wrist.
const GRIP_Y = 892; // grip point of a standing bottle: 58 units above the ground
let target = null;
const L1 = len(sub(ARM_L[1], ARM_L[0]));
const L2 = len(sub(ARM_L[2], ARM_L[1])) + len(sub(GRIP_L, ARM_L[2]));
const restUpper = ang(sub(ARM_L[1], ARM_L[0]));
const restLower = ang(sub(ARM_L[2], ARM_L[1]));
let best = null;
for (let tx = 560; tx <= 720; tx += 4) for (let H = 40; H <= 100; H += 2) {
  for (let BODY = 15; BODY <= 50; BODY += 1) {
    for (let fa = -10; fa <= 45; fa += 1) {
      // forearm absolute angle fa (0 = pointing forward, positive = down)
      const t = [tx, GRIP_Y];
      const wrist = [t[0] - L2 * Math.cos((fa * Math.PI) / 180), t[1] - L2 * Math.sin((fa * Math.PI) / 180)];
      const shoulder = rot(ARM_L[0], BODY_PIVOT, BODY).map((v, i) => (i ? v + H : v));
      const miss = Math.abs(len(sub(wrist, shoulder)) - L1);
      if (miss > 1.5) continue;
      const upper = ang(sub(wrist, shoulder)) - restUpper - BODY;
      const lower = fa - restLower - BODY - upper;
      const hand = -90 - (BODY + upper + lower);
      if (upper < -160 || upper > 50 || lower < -145 || lower > 5 || Math.abs(hand) > 45) continue;
      // prefer a moderate crouch, a natural lean and a relaxed wrist
      const cost = Math.abs(H - 70) / 30 + Math.abs(BODY - 30) / 15 + Math.abs(hand) / 30 + Math.abs(tx - 620) / 60 + miss;
      if (!best || cost < best.cost) best = { tx, H, BODY, fa, upper: r1(upper), lower: r1(lower), hand: r1(hand), cost };
    }
  }
}
if (!best) throw new Error("no reach pose inside the joint limits");
const { H, BODY } = best;
target = [best.tx, GRIP_Y];
const legL = plantedLeg(LEG_L, H);
const legR = plantedLeg(LEG_R, H);
const reachArm = { upper: best.upper, lower: best.lower };
const handAtGrab = best.hand;
console.log({ best, legL, legR });
const stand = { root_y: 0, body: 0, head: 0, gaze_y: 0, leg_L_upper: 0, leg_L_lower: 0, foot_L: 0, leg_R_upper: 0, leg_R_lower: 0, foot_R: 0, arm_L_upper: 0, arm_L_lower: 0, hand_L: 0, grip_L: 0, arm_R_upper: 4 };
const crouch = {
  root_y: H, body: BODY, head: 8, gaze_y: 5,
  leg_L_upper: legL.upper, leg_L_lower: legL.lower, foot_L: legL.foot, leg_R_upper: legR.upper, leg_R_lower: legR.lower, foot_R: legR.foot,
  arm_L_upper: reachArm.upper, arm_L_lower: reachArm.lower, hand_L: handAtGrab, arm_R_upper: -20,
};
const holdPose = { ...stand, head: 10, gaze_y: 4, arm_L_upper: -8, arm_L_lower: -82, hand_L: 0, grip_L: 1, arm_R_upper: 4 };
write("egil-al-cocuk", {
  label: { tr: "Çömelip yerden al (çocuk)", en: "Squat and pick up (child)" },
  views: ["profile-right"],
  notes: `Profile, short-legged knee rigs (ela-profil). Solved from the rig: the root drops ${H} units while both ankles stay where they stand (two-link IK), the body leans ${BODY}°, and the near hand reaches the ground point (${target}) in rig units, ${target[0] - 500} units ahead of the hips. The hand turns so a held object stays upright (body+upper+lower+hand = -90 with grip angle 90). Fingers close at grab.t, then she stands up and holds it in front of her belly, looking at it.`,
  duration: 3.2,
  loop: false,
  grab: { t: 1.35 },
  keys: [
    { t: 0, pose: { ...stand } },
    { t: 0.3, pose: { ...stand, head: 12, gaze_y: 4, body: 4 }, ease: "inOutSine" },
    ...squat(0.3, 1.0, { ...stand, head: 12, gaze_y: 4, body: 4 }, { ...crouch, grip_L: 0 }),
    { t: 1.2, pose: { ...crouch, grip_L: 0 }, ease: "inOutSine" },
    { t: 1.35, pose: { ...crouch, grip_L: 1 }, ease: "linear" },
    { t: 1.55, pose: { ...crouch, grip_L: 1 }, ease: "linear" },
    ...squat(1.55, 2.3, { ...crouch, grip_L: 1 }, { ...holdPose }),
    { t: 3.2, pose: { ...holdPose, head: 8 }, ease: "inOutSine" },
  ],
});

/**
 * Keys for going down into (or up out of) the squat, one per frame, so the ankles stay
 * planted all the way (interpolating only the end poses would sink the feet mid-way).
 * Every other channel follows the same eased fraction, which keeps a held object upright.
 */
function squat(t0, t1, from, to) {
  const keys = [];
  const n = Math.round((t1 - t0) * FPS);
  const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
  for (let k = 1; k <= n; k++) {
    const e = ease(k / n);
    const pose = {};
    for (const ch of new Set([...Object.keys(from), ...Object.keys(to)])) pose[ch] = r1((from[ch] || 0) + ((to[ch] || 0) - (from[ch] || 0)) * e);
    if (ch_grip(from, to)) pose.grip_L = to.grip_L;
    const h = pose.root_y;
    const L = plantedLeg(LEG_L, h), R = plantedLeg(LEG_R, h);
    Object.assign(pose, { leg_L_upper: L.upper, leg_L_lower: L.lower, foot_L: L.foot, leg_R_upper: R.upper, leg_R_lower: R.lower, foot_R: R.foot });
    keys.push({ t: Math.round((t0 + (t1 - t0) * (k / n)) * 1000) / 1000, pose, ease: "linear" });
  }
  return keys;
}
function ch_grip(from, to) {
  return from.grip_L === to.grip_L;
}
