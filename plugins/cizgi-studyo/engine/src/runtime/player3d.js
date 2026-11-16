// 3D player (F7 spike): the same episode data as the 2D player, drawn with Three.js from simple
// shapes. Where people stand, how they walk, which action plays, what the camera frames and which
// mouth shape shows all come from CizgiCore (core.js), so a 3D film follows the 2D one. Every frame
// is a pure function of time (seek), as HyperFrames renders frames out of order.
import * as THREE from "./vendor/three.module.js";

const C = window.CizgiCore;
const D = window.__CIZGI3D__;
const WU = D.unitsPerMetre; // 2D world units per metre
const GROUND = D.world.ground_y;
const toX = (x) => (x - D.world.width / 2) / WU;
const toY = (y) => (GROUND - y) / WU;
const deg = (d) => (d * Math.PI) / 180;

// ---- renderer, toon shading ----
const canvas = document.getElementById("sahne3d");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(D.viewport.width, D.viewport.height, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, D.viewport.width / D.viewport.height, 0.05, 200);

/** Three flat bands of light: the cartoon look (no smooth gradients). */
const bands = (() => {
  const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();
/**
 * The look the episode chose (episode.stil3d):
 *   toon     three flat bands of light and an outline
 *   yumusak  smooth shading and soft shadows, no outline (clay / animated film)
 *   pastel   soft flat colours, a thin outline, a light shadow (storybook)
 *   golge    toon bands with a shadow, no outline
 */
const STIL = D.stil || "toon";
const LOOK = {
  toon: { mat: "toon", outline: 0.012, shadow: false },
  yumusak: { mat: "standard", outline: 0, shadow: true },
  pastel: { mat: "lambert", outline: 0.006, shadow: true },
  golge: { mat: "toon", outline: 0, shadow: true },
}[STIL] || { mat: "toon", outline: 0.012, shadow: false };
const toon = (color) => {
  if (LOOK.mat === "standard") return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 });
  if (LOOK.mat === "lambert") return new THREE.MeshLambertMaterial({ color });
  return new THREE.MeshToonMaterial({ color, gradientMap: bands });
};
// sky, sun and clouds keep their colours whatever the light (no tone mapping greys them)
const flat = (color) => new THREE.MeshBasicMaterial({ color, toneMapped: false });

scene.add(new THREE.HemisphereLight(0xffffff, 0x9fbf8a, LOOK.mat === "lambert" ? 2.0 : 1.4));
const sun = new THREE.DirectionalLight(0xfff4e0, LOOK.mat === "lambert" ? 1.4 : 2.2);
sun.position.set(-3, 6, 5);
scene.add(sun);
if (LOOK.shadow) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 0.5, far: 30 });
  sun.shadow.radius = 4;
  sun.shadow.bias = -0.0005;
}
if (LOOK.mat === "standard") {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
}

/** A dark shell a little larger than the mesh, seen from inside: the outline (inverted hull). */
function outlined(mesh, color, width = 0.012) {
  const shell = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ color, side: THREE.BackSide }));
  const s = mesh.scale;
  shell.scale.set(1 + width / Math.max(s.x, 1e-3), 1 + width / Math.max(s.y, 1e-3), 1 + width / Math.max(s.z, 1e-3));
  mesh.add(shell);
  return mesh;
}

const SPHERE = new THREE.SphereGeometry(1, 32, 20);

/** One part of a recipe: kure (sphere, radii), kapsul (radius, length), simit (torus), silindir, koni, kutu. */
function shape(p, colors) {
  const color = colors[p.renk] || p.renk;
  const mat = toon(color);
  let mesh;
  switch (p.sekil) {
    case "kure":
      mesh = new THREE.Mesh(SPHERE, mat);
      mesh.scale.set(p.boyut[0], p.boyut[1], p.boyut[2]);
      break;
    case "kapsul":
      mesh = new THREE.Mesh(new THREE.CapsuleGeometry(p.boyut[0], p.boyut[1], 8, 16), mat);
      break;
    case "simit":
      mesh = new THREE.Mesh(new THREE.TorusGeometry(p.boyut[0], p.boyut[1], 12, 32), mat);
      break;
    case "silindir":
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(p.boyut[0], p.boyut[1] ?? p.boyut[0], p.boyut[2], 20), mat);
      break;
    case "koni":
      mesh = new THREE.Mesh(new THREE.ConeGeometry(p.boyut[0], p.boyut[1], 20), mat);
      break;
    default:
      mesh = new THREE.Mesh(new THREE.BoxGeometry(...p.boyut), mat);
  }
  mesh.position.set(...p.konum);
  if (p.don) mesh.rotation.set(deg(p.don[0]), deg(p.don[1]), deg(p.don[2]));
  if (p.kontur !== false && LOOK.outline) outlined(mesh, colors.kontur || "#333333", LOOK.outline);
  mesh.castShadow = LOOK.shadow;
  return mesh;
}

// ---- the place ----
function buildPlace(t) {
  const group = new THREE.Group();
  // sky: a gradient drawn once on a canvas, far behind everything
  const sky = document.createElement("canvas");
  sky.width = 2;
  sky.height = 256;
  const g = sky.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, t.gok[0]);
  grad.addColorStop(1, t.gok[1]);
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 256);
  const skyTex = new THREE.CanvasTexture(sky);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  const skyPlane = new THREE.Mesh(new THREE.PlaneGeometry(120, 40), new THREE.MeshBasicMaterial({ map: skyTex, depthWrite: false, toneMapped: false }));
  skyPlane.position.set(0, 14, -40);
  group.add(skyPlane);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 60), toon(t.zemin));
  ground.rotation.x = -Math.PI / 2;
  ground.position.z = -20;
  ground.receiveShadow = LOOK.shadow;
  group.add(ground);
  for (const h of t.tepeler || []) {
    const hill = new THREE.Mesh(SPHERE, toon(h.renk));
    hill.scale.set(...h.boyut);
    hill.position.set(...h.konum);
    group.add(hill);
  }
  for (const a of t.agaclar || []) {
    const tree = new THREE.Group();
    const trunk = shape({ sekil: "silindir", boyut: [0.07 * a.boy, 0.1 * a.boy, 0.6 * a.boy], konum: [0, 0.3 * a.boy, 0], renk: "#8a5a3a" }, { kontur: t.kontur });
    const crown = shape({ sekil: "kure", boyut: [0.45 * a.boy, 0.42 * a.boy, 0.45 * a.boy], konum: [0, 0.85 * a.boy, 0], renk: "#79bf63" }, { kontur: t.kontur });
    tree.add(trunk, crown);
    tree.position.set(...a.konum);
    group.add(tree);
  }
  if (t.gunes) {
    const s = new THREE.Mesh(SPHERE, flat(t.gunes.renk));
    s.scale.setScalar(t.gunes.r);
    s.position.set(...t.gunes.konum);
    group.add(s);
  }
  for (const c of t.bulutlar || []) {
    const cloud = new THREE.Group();
    [[0, 0, 0.9], [0.9, -0.15, 0.7], [-0.9, -0.15, 0.7], [0.35, 0.35, 0.65]].forEach(([x, y, r]) => {
      const puff = new THREE.Mesh(SPHERE, flat("#ffffff"));
      puff.scale.set(r, r * 0.8, r * 0.6);
      puff.position.set(x, y, 0);
      cloud.add(puff);
    });
    cloud.position.set(...c);
    group.add(cloud);
  }
  if (t.cicekler) {
    // seeded: the same flowers in every frame and every render
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const [x0, x1, z0, z1] = t.cicekler.alan;
    for (let i = 0; i < t.cicekler.sayi; i++) {
      const f = new THREE.Mesh(SPHERE, flat(t.cicekler.renkler[i % t.cicekler.renkler.length]));
      f.scale.set(0.035, 0.02, 0.035);
      f.position.set(x0 + rnd() * (x1 - x0), 0.02, z0 + rnd() * (z1 - z0));
      group.add(f);
    }
  }
  return group;
}

// ---- characters from recipes ----
function buildCharacter(recipe) {
  const root = new THREE.Group();
  const joints = { kok: root };
  const colors = recipe.renkler;
  const pending = Object.entries(recipe.eklemler);
  while (pending.length) {
    const i = pending.findIndex(([, j]) => joints[j.ust]);
    if (i < 0) throw new Error("joint tree is broken");
    const [name, j] = pending.splice(i, 1)[0];
    const node = new THREE.Group();
    node.position.set(...j.konum);
    joints[j.ust].add(node);
    joints[name] = node;
  }
  const eyes = [];
  let mouth = null;
  for (const p of recipe.parcalar) {
    const m = shape(p, colors);
    joints[p.eklem].add(m);
    if (p.rol === "goz") eyes.push({ mesh: m, y: m.scale.y });
    if (p.rol === "agiz") mouth = { mesh: m, y: m.scale.y };
  }
  const rest = {};
  for (const [name, j] of Object.entries(joints)) rest[name] = j.position.clone();
  return { root, joints, eyes, mouth, rest };
}

// one group per place; each shot shows its own scene's place
const places = {};
for (const [bg, recipe] of Object.entries(D.places)) {
  places[bg] = buildPlace(recipe);
  places[bg].visible = false;
  scene.add(places[bg]);
}
const actors = {};
for (const ch of D.characters) {
  actors[ch.id] = { ...buildCharacter(ch.tarif), phase: C.phaseFor(ch.id) };
  scene.add(actors[ch.id].root);
}

// ---- actions as procedural poses ----
const OPEN = { mouth_rest: 0, mouth_MBP: 0, mouth_E: 0.45, mouth_A: 1, mouth_O: 0.8, mouth_U: 0.5, mouth_FV: 0.2, mouth_L: 0.55 };
const kindOf = (action) =>
  /^(yuru|kos)/.test(action) ? "yuru"
    : /^(el-salla|selam)/.test(action) ? "salla"
      : /^zipla/.test(action) ? "zipla"
        : /^alkis/.test(action) ? "alkis"
          : /^egil/.test(action) ? "egil"
            : "bekle";

/** Joint angles (radians) and root lift for an action `time` seconds in. */
function pose(action, time) {
  const a = D.actions[action] || { duration: 1, loop: true };
  const kind = kindOf(action);
  const p = { body: 0, head: 0, armL: 0.12, armR: -0.12, armLx: 0, armRx: 0, legL: 0, legR: 0, lift: 0, lean: 0 };
  if (kind === "yuru") {
    const ph = (time / a.duration) * 2 * Math.PI;
    p.legL = Math.sin(ph) * 0.55;
    p.legR = -Math.sin(ph) * 0.55;
    p.armLx = -Math.sin(ph) * 0.5;
    p.armRx = Math.sin(ph) * 0.5;
    p.lift = Math.abs(Math.sin(ph)) * 0.03;
    p.body = Math.sin(ph) * 0.05;
  } else if (kind === "salla") {
    const up = Math.min(1, time / 0.3);
    p.armR = -(0.12 + up * 2.5) + Math.sin(time * 9) * 0.35 * up;
    p.head = Math.sin(time * 3) * 0.08;
  } else if (kind === "zipla") {
    const k = (time % a.duration) / a.duration;
    p.lift = Math.max(0, Math.sin(k * Math.PI)) * 0.35;
    p.armL = 0.12 + p.lift * 6;
    p.armR = -(0.12 + p.lift * 6);
    p.legL = -p.lift;
    p.legR = -p.lift;
  } else if (kind === "alkis") {
    const k = Math.abs(Math.sin(time * 6));
    p.armLx = -1.2;
    p.armRx = -1.2;
    p.armL = -0.2 + k * 0.5;
    p.armR = 0.2 - k * 0.5;
  } else if (kind === "egil") {
    const k = Math.min(1, time / 0.6);
    p.lean = k * 0.6;
    p.armLx = -k * 1.1;
    p.armRx = -k * 1.1;
  }
  return p;
}

function drawActor(actor, member, shot, t, local, speaking) {
  const dur = shot.end - shot.start;
  const layout = C.layoutFor(D.world, D.viewport);
  const x = C.memberX(member, layout, local, dur);
  const seg = C.segmentAt(member, local);
  const p = pose(seg.action, seg.time);
  const idle = C.idleOffsets(t, actor.phase);
  const { joints, rest } = actor;
  actor.root.visible = true;
  // standing back (cast.back 0..1): further from the camera; the perspective makes them smaller
  actor.root.position.set(toX(x), p.lift, -(member.back || 0) * 3);
  // facing: toward the walk while walking, else toward the camera
  const walking = member.walk && kindOf(seg.action) === "yuru" && local < (member.walk.time ?? dur);
  const turn = walking ? Math.sign(member.walk.dx) * Math.PI / 2 : member.facing === "left" ? 0.35 : member.facing === "right" ? -0.35 : 0;
  actor.root.rotation.y = turn;
  joints.govde.rotation.set(p.lean, 0, p.body + deg(idle.body) * 0.5);
  joints.govde.position.y = rest.govde.y + Math.sin((t + actor.phase) * 2) * 0.004;
  joints.kafa.rotation.set(-p.lean * 0.5, 0, p.head + deg(idle.head) * 0.5);
  joints.kol_L.rotation.set(p.armLx, 0, p.armL);
  joints.kol_R.rotation.set(p.armRx, 0, p.armR);
  joints.bacak_L.rotation.set(p.legL, 0, 0);
  joints.bacak_R.rotation.set(p.legR, 0, 0);
  const closed = C.blinkClosed(t, actor.phase);
  for (const e of actor.eyes) e.mesh.scale.y = closed ? e.y * 0.15 : e.y;
  if (actor.mouth) {
    const open = speaking ? OPEN[C.visemeAt(speaking.cues, t - speaking.start)] ?? 0 : 0;
    actor.mouth.mesh.scale.y = actor.mouth.y * (0.25 + open * 0.9);
  }
}

// ---- camera: the 2D shot camera, seen through a perspective lens ----
const FOV = deg(30);
function placeCamera(shot, t) {
  const p = (t - shot.start) / (shot.end - shot.start);
  const cam = C.shotCamera(shot, p, D.world, D.cameras, D.viewport, D.faces);
  const visibleH = D.viewport.height / cam.zoom / WU; // metres the frame shows top to bottom
  const dist = visibleH / 2 / Math.tan(FOV / 2);
  const tx = toX(cam.cx);
  const ty = toY(cam.cy);
  camera.position.set(tx, ty + dist * 0.08, dist);
  camera.lookAt(tx, ty, 0);
}

function render(t) {
  let idx = D.shots.length - 1;
  for (let i = 0; i < D.shots.length; i++) if (t < D.shots[i].end) { idx = i; break; }
  const shot = D.shots[idx];
  const local = t - shot.start;
  const line = shot.utterances.find((u) => t >= u.start && t < u.end) || null;
  for (const bg in places) places[bg].visible = bg === shot.bg;
  for (const id in actors) actors[id].root.visible = false;
  for (const member of shot.cast) {
    const actor = actors[member.id];
    if (actor) drawActor(actor, member, shot, t, local, line && line.speaker === member.id ? line : null);
  }
  placeCamera(shot, t);
  renderer.render(scene, camera);
}

window.__hfAnime = window.__hfAnime || [];
window.__hfAnime.push({ seek: (ms) => render(Math.max(0, ms) / 1000), pause() {}, play() {} });
render(0);
