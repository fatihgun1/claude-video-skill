// Composition in the panel, without waiting for Claude: switch a person to another view (side,
// front 3/4, back 3/4: separate rigs of the same person, rig meta same_as) and ready shot recipes
// (over the shoulder, two people in depth, follow from behind, front close-up). They change the
// open episode in place, like every edit of the editor; undo takes them back.
// No DOM here: the functions are tested in node (test/panel-kompozisyon.test.mjs).

/** The kinds of view a person can be seen in, and the rig views each covers. */
export const VIEW_KINDS = Object.freeze({
  yan: (v) => v.startsWith("profile"),
  on: (v) => v === "front" || v.startsWith("three-quarter"),
  arka: (v) => v.startsWith("back"),
});
const SUFFIX = { yan: "", on: "_on", arka: "_arka" };
const NAME = { yan: "", on: " (önden)", arka: " (arkadan)" };

/** @param {{rigs:{id:string, view:string, person:string}[]}} vocab */
export function viewKindOf(vocab, rig) {
  const view = vocab.rigs.find((r) => r.id === rig)?.view || "front";
  return Object.keys(VIEW_KINDS).find((k) => VIEW_KINDS[k](view)) || "on";
}

/** The person a rig belongs to (its same_as, else itself). */
export const personOf = (vocab, rig) => vocab.rigs.find((r) => r.id === rig)?.person || rig;

/** The person's rig for a kind of view, or null when it is not drawn. */
export function rigFor(vocab, person, kind) {
  return vocab.rigs.find((r) => r.person === person && VIEW_KINDS[kind](r.view))?.id || null;
}

/** Which views of a cast member's person are drawn: {yan, on, arka} → rig id or null. */
export function viewsOf(vocab, episode, characterId) {
  const c = episode.characters.find((x) => x.id === characterId);
  const person = c ? personOf(vocab, c.rig) : null;
  return Object.fromEntries(Object.keys(VIEW_KINDS).map((k) => [k, person ? rigFor(vocab, person, k) : null]));
}

/**
 * The episode character drawn with `rig`: an existing entry, or a new one next to the person's
 * (named after it, so the panel shows "Kız (önden)").
 * @returns {string} character id
 */
function characterWith(episode, base, rig, kind) {
  const have = episode.characters.find((c) => c.rig === rig);
  if (have) return have.id;
  const stem = base.id.replace(/_(on|arka)$/, "");
  let id = `${stem}${SUFFIX[kind]}` || stem;
  for (let n = 2; episode.characters.some((c) => c.id === id); n++) id = `${stem}${SUFFIX[kind]}${n}`;
  const name = (base.name || stem).replace(/ \((önden|arkadan)\)$/, "");
  episode.characters.push({ id, name: `${name}${NAME[kind]}`, rig, static_features: `same person as ${stem}, another view` });
  return id;
}

/**
 * A standing action for a view: one drawn for it (bekle…, else anything but a walk), else the plain
 * "bekle", which every rig can hold (only warned about). Never an action drawn for every view: those
 * bend limbs past what some rigs allow.
 */
function standing(vocab, view) {
  const fits = vocab.actions.filter((a) => a.views?.includes(view));
  return (fits.find((a) => a.id.startsWith("bekle")) || fits.find((a) => !a.id.startsWith("yuru")))?.id || "bekle";
}
const viewOfRig = (vocab, rig) => vocab.rigs.find((r) => r.id === rig)?.view || "front";

/** Rename a cast member everywhere in the shot: its lines, what it holds, the camera's target. */
function rename(shot, from, to) {
  if (from === to) return;
  for (const u of shot.utterances || []) if (u.speaker === from) u.speaker = to;
  for (const p of shot.props || []) if (p.holder === from) p.holder = to;
  if (shot.camera?.target === from) shot.camera.target = to;
}

/**
 * Show cast member `index` of the shot in another view of the same person. Its action becomes a
 * standing one drawn for that view when the old one is not; a walk stays only in a side view.
 * @returns {{ok:true, id:string}|{ok:false, why:string}}
 */
export function setView(episode, vocab, shot, index, kind) {
  const m = shot.cast[index];
  const c = m && episode.characters.find((x) => x.id === m.id);
  if (!c) return { ok: false, why: "Bu oyuncu bölümde yok." };
  const rig = rigFor(vocab, personOf(vocab, c.rig), kind);
  if (!rig) return { ok: false, why: `${c.name || c.id} için bu görünüş çizilmemiş: karakter penceresinde Claude'dan çizmesini iste.` };
  if (rig === c.rig) return { ok: true, id: c.id };
  const id = characterWith(episode, c, rig, kind);
  const view = viewOfRig(vocab, rig);
  // keep only an action drawn for this view: one made for every view still bends limbs past what
  // another view's rig allows (Test: "bak" broke the back view's arm), so it becomes a standing one
  const fits = (a) => !!vocab.actions.find((x) => x.id === a)?.views?.includes(view);
  rename(shot, m.id, id);
  m.id = id;
  if (!fits(m.action)) m.action = standing(vocab, view);
  if (m.actions) m.actions = m.actions.filter((s) => fits(s.action));
  if (m.actions && !m.actions.length) delete m.actions;
  if (m.walk && kind !== "yan") delete m.walk; // sideways steps look wrong from the front or back
  delete m.facing;
  return { ok: true, id };
}

/** The ready shot recipes the shot window offers. */
export const RECIPES = Object.freeze([
  { id: "omuz", ad: "Omuz üstü", not: "Biri arkadan, omzunun üstünden karşısındaki önden görünür", kisi: 2 },
  { id: "derin", ad: "İki kişi derinlikli", not: "Biri önde yandan, öbürü geride önden: sahnede derinlik", kisi: 2 },
  { id: "takip", ad: "Arkadan takip", not: "Kişi arkadan görünür, kamera onunla derinliğe ilerler", kisi: 1 },
  { id: "yakin", ad: "Yakın, önden", not: "Yüz önden, yakın plan: duygu ve tepki", kisi: 1 },
]);

/** Who the shot is about: the camera's target, else the first speaker, else the first in the cast. */
function subjectIndex(shot) {
  const by = (id) => shot.cast.findIndex((m) => m.id === id);
  const target = shot.camera?.target ? by(shot.camera.target) : -1;
  if (target >= 0) return target;
  const speaker = (shot.utterances || []).map((u) => by(u.speaker)).find((i) => i >= 0);
  return speaker ?? 0;
}

/** Drop cast members that neither speak nor hold anything (a recipe frames fewer people). */
function keepOnly(shot, keep) {
  const needed = new Set([...(shot.utterances || []).map((u) => u.speaker), ...(shot.props || []).map((p) => p.holder).filter(Boolean)]);
  shot.cast = shot.cast.filter((m) => keep.includes(m) || needed.has(m.id));
}

/**
 * Apply a recipe to the shot (the episode open in the panel, changed in place).
 * @returns {{ok:true, not:string}|{ok:false, why:string}}
 */
export function applyRecipe(episode, vocab, shot, recipe) {
  const r = RECIPES.find((x) => x.id === recipe);
  if (!r) return { ok: false, why: "Böyle bir tarif yok." };
  if (shot.cast.length < r.kisi) return { ok: false, why: r.kisi === 2 ? "Bu tarif için çekimde iki kişi olmalı." : "Bu çekimde kimse yok." };
  const ai = subjectIndex(shot);
  const a = shot.cast[ai];
  const b = r.kisi === 2 ? shot.cast.find((m, i) => i !== ai) : null;
  const need = { omuz: [["a", "on"], ["b", "arka"]], derin: [["a", "on"]], takip: [["a", "arka"]], yakin: [["a", "on"]] }[recipe];
  // check every view first: a recipe either applies whole or not at all
  for (const [who, kind] of need) {
    const m = who === "a" ? a : b;
    const c = episode.characters.find((x) => x.id === m.id);
    if (!rigFor(vocab, personOf(vocab, c?.rig), kind)) {
      return { ok: false, why: `${c?.name || m.id} için ${kind === "on" ? "önden" : "arkadan"} görünüş çizilmemiş: karakter penceresinde Claude'dan çizmesini iste.` };
    }
  }
  const at = (m) => shot.cast.indexOf(m);
  if (recipe === "omuz") {
    setView(episode, vocab, shot, at(a), "on");
    setView(episode, vocab, shot, at(b), "arka");
    // close together in the middle: the camera on the speaker (medium) keeps the listener's shoulder in
    // the left third; at the two side marks the listener fell out of the frame
    Object.assign(b, { mark: "sol", dx: 140, back: 0 }); // two people may not share a mark: x 700, the speaker 1110
    Object.assign(a, { mark: "orta", dx: 150, back: 0.35, facing: "sol" }); // further back, turned toward them
    keepOnly(shot, [a, b]);
    shot.camera = { ...shot.camera, framing: "medium", move: "static", target: a.id };
    return { ok: true, not: `Omuz üstü: ${b.id} arkadan önde, ${a.id} önden geride.` };
  }
  if (recipe === "derin") {
    setView(episode, vocab, shot, at(a), "on");
    Object.assign(a, { mark: "sag", back: 0.4, facing: "sol" });
    Object.assign(b, { mark: "sol", back: 0 });
    delete b.facing;
    keepOnly(shot, [a, b]);
    shot.camera = { ...shot.camera, framing: "wide", move: "static" };
    delete shot.camera.target;
    return { ok: true, not: `İki kişi derinlikli: ${b.id} önde, ${a.id} geride.` };
  }
  if (recipe === "takip") {
    setView(episode, vocab, shot, at(a), "arka");
    const walk = vocab.actions.find((x) => x.id.startsWith("yuru") && x.views?.includes(viewOfRig(vocab, episode.characters.find((c) => c.id === a.id).rig)));
    if (walk) a.action = walk.id;
    Object.assign(a, { mark: "orta", back: 0 });
    delete a.dx;
    keepOnly(shot, [a]);
    shot.camera = { ...shot.camera, framing: "wide", move: "dolly_ileri", target: a.id };
    return { ok: true, not: walk ? `Arkadan takip: ${a.id} derinliğe yürüyor.` : `Arkadan takip: ${a.id} arkadan (bu görünüşte yürüme hareketi yok, duruyor).` };
  }
  setView(episode, vocab, shot, at(a), "on"); // yakin
  Object.assign(a, { mark: "orta", back: 0 });
  delete a.dx;
  keepOnly(shot, [a]);
  shot.camera = { ...shot.camera, framing: "close", move: "static", target: a.id };
  return { ok: true, not: `Yakın, önden: ${a.id}.` };
}

// The film warnings (sinema.mjs), as the person reads them in the shot window.
const PROBLEMS = [
  [/jump cut/, "Önceki çekimle aynı kişi, aynı plan, aynı görünüş: kesme sıçrar. Planı ya da görünüşü değiştir."],
  [/screen direction flips/, "Kişinin baktığı yön bir önceki çekime göre ters dönmüş (180° kuralı)."],
  [/from the side \(profile\)/, "Bu sahnenin bütün çekimleri yandan: önden yakın, omuz üstü ya da arkadan takip ekle."],
  [/over-the-shoulder/, "Konuşmada omuz üstü çekim yok: konuşanı karşısındakinin omzunun üstünden göster."],
  [/opens on a/, "Sahne yakın ya da detay çekimle açılıyor: önce geniş planla yeri ve kişiyi göster."],
  [/not motivated/, "Nesne çekimi gerekçesiz: önce birinin ona baktığını göster."],
  [/walks sideways/, "Önden ya da arkadan görünen kişi yana yürüyor (yengeç gibi): yana yürüyüş yalnız yandan."],
];

/**
 * One validation warning as the person reads it: the film rules' findings and an action drawn for
 * another view in Turkish; anything else as the engine says it. Usability test 1: eight English
 * engine lines under the stage read as errors nobody could act on.
 */
export function warningText(w, nameOf = (id) => id) {
  const shot = /^(?:film: )?shot ([^:]+): /.exec(w)?.[1];
  const where = shot ? `${shot}: ` : "";
  const film = PROBLEMS.find(([re]) => re.test(w));
  if (film) return where + film[1];
  const view = /"([^"]+)" is made for .* views, but ([^ ]+) \(/.exec(w);
  if (view) return `${where}“${view[1]}” hareketi ${nameOf(view[2])} görünüşü için çizilmemiş; yine de oynar, biraz farklı durabilir.`;
  return w;
}

/**
 * The film warnings about this shot, and those about its whole scene (told on the scene's first
 * shot, naming the scene), in Turkish.
 * @param {string[]} warnings validation warnings
 * @returns {{metin:string, ham:string}[]}
 */
export function shotProblems(warnings, shotId, sceneId) {
  const scene = new RegExp(`\\bscene ${sceneId}\\b`);
  return (warnings || [])
    .filter((w) => w.startsWith(`film: shot ${shotId}:`) || (w.startsWith("film: ") && scene.test(w)))
    .map((w) => ({ metin: PROBLEMS.find(([re]) => re.test(w))?.[1] || w.replace(/^film: shot [^:]+: /, ""), ham: w }));
}
