// The panel app: episode state, selection, what a library click changes, the edit →
// validate → preview cycle, saving, the production steps and clickable messages.
import { $, el, setKey } from "./dom.js";
import { createStageEditor } from "./duzen.js";
import { createProduction } from "./uretim.js";
import { createLibrary } from "./kutuphane.js";
import { installDrops } from "./birak.js";
import { tr } from "./tr.js";
import { listen } from "./dinle.js";
import { createStage, shotOfMessage } from "./sahne.js";
import { createInspector, renameMember } from "./denetleyici.js";
import { createProjects } from "./projeler.js";
import { createTimeline } from "./zaman.js";
import { createTree } from "./agac.js";
import { createRequests } from "./istek.js";
import { createReview } from "./inceleme.js";
import { createStory } from "./hikaye.js";
import { createChannel as createClaudeChannel } from "./kanal.js";
import { createProjectWizard } from "./proje-sihirbaz.js";
import { slug } from "./projeler.js";
import { installKeys } from "./klavye.js";
import { installViews } from "./gorunum.js";
import { createDrafts } from "./taslak.js";
import { createObjectWindow } from "./nesne-pencere.js";
import { createVideoButton } from "./video-cikar.js";
import { createQuickStart } from "./hizli-basla.js";
import { setView, applyRecipe, viewsOf, viewKindOf, shotProblems, RECIPES } from "./kompozisyon.js";
import { decorId } from "./dekor.js";
import {
  addShotAfter, duplicateShot, deleteShot, moveShot, createHistory, rowOfMessage,
  moveSegmentStart, insertSegment, replaceSegmentAction, removeSegment, segmentIndexAt,
  delayFirstSegment, standingAction, placeAt, sfxAtAfterDrag,
} from "./kurgu.js";

const PREVIEW_DELAY_MS = 350;
const MARKS = ["orta", "sol", "sag"];

const state = {
  path: null, // the open episode, relative to the panel's folder ("ornekler/sokak/bolum.json")
  saved: null, // episode as on disk
  draft: null, // episode being edited
  version: "",
  vocab: null,
  status: null,
  validation: null,
  sel: { shot: null, kind: null, index: -1 },
  format: "16:9", // how the stage shows it (a view choice, not part of the episode)
  look: "", // "3b": the preview drawn in 3D (watch only: editing on the stage is 2D's)
  scriptAck: false, // the person ticked that editing lines drops the script approval
  unspoken: new Set(), // line keys with no audio yet (the preview guesses their length)
};
let previewSeq = 0;
let opened = 0; // bumped on every open: answers for an earlier open are dropped
let openTicket = 0; // of two opens in flight, only the later one applies
let timer = 0;
const addedHere = new Set(); // character ids this panel added to the open episode

/* ---------- lookups ---------- */
const allShots = () => state.draft.scenes.flatMap((scene) => scene.shots.map((shot) => ({ scene, shot })));
const find = (id) => allShots().find((x) => x.shot.shot_id === id) || null;
const character = (id) => state.draft.characters.find((c) => c.id === id);
const rigOf = (id) => character(id)?.rig || id;
const labelOf = (id) => (id === "anlatici" ? "Anlatıcı" : character(id)?.name || id);
const dirty = () => JSON.stringify(state.draft) !== JSON.stringify(state.saved);
const current = () => find(state.sel.shot);
function selectedItem() {
  const f = current();
  if (!f) return {};
  const { kind, index } = state.sel;
  const member = kind === "cast" ? f.shot.cast[index] : null;
  // Actions need someone to act: the selected member, or the only member of the shot.
  // (A character click with nothing selected adds a member, so it must not use this.)
  const only = kind === null && f.shot.cast.length === 1 ? f.shot.cast[0] : null;
  return {
    member,
    actor: member || only,
    prop: kind === "prop" ? (f.shot.props || [])[index] : null,
  };
}
/** Seconds into the shot where the playhead is, or null when it is in another shot. */
function playheadInShot(shot) {
  const t = stage.shotTime(shot.shot_id);
  const now = stage.now();
  return t && now >= t.start && now < t.end ? Math.round((now - t.start) * 100) / 100 : null;
}
const isLoop = (id) => !!state.vocab?.actions.find((a) => a.id === id)?.loop;
/** A shot's compiled length, or undefined before its first preview (walk sync then waits). */
function shotLen(shot) {
  const t = stage.shotTime(shot.shot_id);
  return t ? t.end - t.start : undefined;
}
function uniqueId(base, taken) {
  const clean = base.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "x";
  if (!taken.has(clean)) return clean;
  let n = 2;
  while (taken.has(`${clean}_${n}`)) n++;
  return `${clean}_${n}`;
}

/* ---------- modules ---------- */
const steps = createHistory(); // undo/redo ("history" is the browser's)
let editor = null; // made after the stage, which already reports to it
const stage = createStage(
  { frame: $("frame"), stage: $("stage"), over: $("over"), play: $("play"), time: $("time"), clock: $("clock"), mute: $("mute") },
  {
    onTime: (t, playing) => {
      timeline?.place(t, playing);
      editor?.draw();
    },
    onLoad: () => {
      editor?.applyLayers();
      editor?.draw();
    },
    onFit: () => editor?.draw(),
  },
);
const timeline = createTimeline(
  { ruler: $("tl-ruler"), tracks: $("tl-tracks"), scroll: $("tl-scroll"), info: $("tl-info"), labels: $("tl-labels"), snap: $("tl-snap"),
    zoomIn: $("tl-zoom-in"), zoomOut: $("tl-zoom-out"), fit: $("tl-fit") },
  {
    shots: allShots, selected: () => state.sel.shot, sel: () => state.sel, choose, select, problems, labelOf,
    characters: () => state.draft.characters.map((c) => ({ id: c.id, label: labelOf(c.id) })),
    music: () => state.draft.music || null,
    trackState: (track) => stage.trackState(track),
    setTrack: (track, how) => stage.setTrack(track, how),
    lineFailed: (shotId, i) => {
      const r = state.listening?.[`${shotId}-${i}`];
      return !!r && !r.ok && !r.accepted;
    },
    selectLine: (shotId, i) => {
      state.sel = { shot: shotId, kind: "line", index: i };
      renderAll();
      const t = topicOf("line", i);
      if (t) objectWindow.open(t); // a line clicked on the timeline opens its window too
    },
    episode: () => state.draft,
    setCaption: (shot, i, shown) => {
      const u = shot.utterances?.[i];
      if (!u) return;
      setKey(u, "altyazi", shown ? undefined : false); // shown is the default: no key
      state.sel = { shot: shot.shot_id, kind: "line", index: i };
      changed(true);
    },
    setDelay: (shot, i, delay) => {
      const u = shot.utterances?.[i];
      if (!u) return;
      setKey(u, "delay", delay || undefined);
      state.sel = { shot: shot.shot_id, kind: "line", index: i };
      changed(true);
    },
    actionInfo: (id) => state.vocab?.actions.find((a) => a.id === id) || null,
    selectSegment: (shotId, castIndex, seg) => {
      state.sel = { shot: shotId, kind: "cast", index: castIndex, seg };
      // show the start of that action on the stage
      const t = stage.shotTime(shotId);
      const m = find(shotId)?.shot.cast[castIndex];
      if (t && m) stage.seek(t.start + (seg ? m.actions[seg - 1].at : 0) + 0.05);
      renderAll();
    },
    delayFirst: (shot, castIndex, at, shotLen) => {
      const m = shot.cast[castIndex];
      const standing = m && standingAction(state.vocab, viewOf(m.id), m.action);
      if (!m || !delayFirstSegment(m, at, shotLen, standing, isLoop)) {
        if (m && standing === m.action) note(`${labelOf(m.id)} bu shot'ta zaten bekliyor: başka bir hareketi sürükle.`);
        else if (m && !m.walk) note("Bir sonraki hareket hemen başlıyor: önce onu sağa sürükle.");
        return false;
      }
      state.sel = { shot: shot.shot_id, kind: "cast", index: castIndex, seg: 1 };
      changed(true);
      return true;
    },
    moveSegment: (shot, castIndex, seg, at, shotLen) => {
      const m = shot.cast[castIndex];
      if (!m) return;
      moveSegmentStart(m, seg, at, shotLen, isLoop);
      state.sel = { shot: shot.shot_id, kind: "cast", index: castIndex, seg };
      changed(true);
    },
    framingLabel: (id) => (state.vocab?.framings.find((f) => f.id === id)?.label || id).replace(/\s*\(.*\)$/, ""),
    sfxInfo: (id) => state.vocab?.sfx.find((s) => s.id === id) || null,
    timing: () => stage.timing(),
    now: () => stage.now(),
    seek: (t) => { stage.toggle(false); stage.seek(t); },
    setHold: (shot, hold) => { shot.hold = hold; changed(true); },
    setSfxAt: (shot, i, at) => {
      shot.sfx[i].at = at;
      state.sel = { shot: shot.shot_id, kind: "sfx", index: i };
      changed(true);
    },
    moveShot: (id, index) => {
      const f = find(id);
      if (f && moveShot(f.scene, id, index)) {
        state.sel = { shot: id, kind: null, index: -1 };
        changed(true);
      }
    },
  },
);
let drops = null; // made once the stage editor exists; cards ask for it only when the library draws
const library = createLibrary(
  { cards: $("lib-cards"), search: $("lib-search"), hint: $("lib-hint") },
  {
    vocab: () => state.vocab,
    context: () => {
      const f = current();
      return { shot: f?.shot, scene: f?.scene, ...selectedItem(), rigOf, labelOf, musicTrack: state.draft?.music?.track || null };
    },
    pick,
    extra: (tab) => drafts.section(tab),
    drag: (node, kind, id) => drops?.source(node, kind, id),
  },
);
/* ---------- drafts of the project library (Claude's drawings waiting for the person) ---------- */
const drafts = createDrafts({
  api,
  path: () => state.path,
  title: () => state.draft?.title || state.draft?.episode || "",
  setVocab: (v) => {
    state.vocab = v; // a drawing just taken in is a card now, and can be used
    if (!state.draft) return; // no episode open (the wizard's step page): the panels draw when one opens
    library.render();
    inspector.render();
  },
  rerender: () => {
    library.render();
    objectWindow.refresh(); // a new version Claude drew shows in the object window
  },
  note: (text) => note(text),
});
/**
 * A voice changed: speak that person's lines again right away, in the background, so the change is
 * heard without another step. Only after the script approval (the audio step needs it).
 * @returns {string} what happens, for the window
 */
function respeak(ownerId) {
  if (state.status?.gates?.senaryo !== "onayli") return "Replikleri bu sesle “🎬 Video çıkar” seslendirir.";
  runJob("ses")
    .then(() => {
      note(`${labelOf(ownerId)}'in replikleri yeni sesle hazır: sahnede oynat, dinle.`);
      refreshPreview();
    })
    .catch((err) => note(`Yeni ses üretilemedi: ${err.message}`));
  return "Replikleri şimdi bu sesle yeniden seslendiriliyor (birkaç dakika); bitince sahnede duyarsın.";
}

/** Run a production job on the saved episode and wait for it: its result, or throws why it failed. */
async function runJob(kind, sahne) {
  if (dirty()) await save();
  if (dirty()) throw new Error("önce kaydet");
  await api("/api/is", { b: state.path, kind, format: state.format, sahne });
  for (;;) {
    await new Promise((r) => setTimeout(r, 1500));
    const { job } = await api(`/api/is?${new URLSearchParams({ b: state.path })}`);
    if (!job || job.status === "running") continue;
    if (job.status !== "done") throw new Error(tr(job.error || "bilinmeyen hata"));
    return job.result;
  }
}
// a view of a person ("kiz-on" of "kiz") speaks with that person's voice (ses.mjs voicesOf)
const VIEW_SUFFIX = /-(on|arka)$/;
function voiceOwner(id) {
  const c = character(id);
  if (!c || c.voice || !VIEW_SUFFIX.test(c.rig)) return c;
  return state.draft.characters.find((x) => x.rig === c.rig.replace(VIEW_SUFFIX, "")) || c;
}
/* ---------- the object window: click a character or prop, work on it with Claude ---------- */
const objectWindow = createObjectWindow({
  api,
  draftOf: (tur, id) => drafts.find(tur, id),
  takeDraft: (tur, id) => drafts.take(tur, id),
  rejectDraft: (tur, id) => drafts.reject(tur, id),
  stageBox: () => $("stage")?.getBoundingClientRect() || null,
  after: () => refreshPreview(), // the stage draws the drawing just taken in
  openShot: () => {
    const t = shotTopic();
    if (t) objectWindow.open(t);
  },
  // the character's voice: whose it is (a view uses its person's), what it is now
  voiceInfo: (id) => {
    const owner = voiceOwner(id);
    if (!owner) return null;
    const v = owner.voice || {};
    const ready = (state.vocab?.voices || []).find((x) => x.id === v.hazir);
    const now = v.ref ? "kendi kaydın" : ready ? `hazır ses: ${ready.label}` : "varsayılan ses (herkesle aynı)";
    return { owner: owner.id, ad: labelOf(owner.id), now, hazir: v.ref ? null : v.hazir || null, voices: state.vocab?.voices || [] };
  },
  // the person's recording becomes that character's voice: saved next to the episode, then the episode is saved
  useRecording: async (id, base64) => {
    const owner = voiceOwner(id);
    const res = await api("/api/ses-kayit", { b: state.path, karakter: owner.id, wav: base64 });
    owner.voice = { ...(owner.voice || {}), ref: res.ref };
    changed(true);
    await save();
    return `${labelOf(owner.id)} artık senin kaydınla konuşacak (${res.sure} sn). ${respeak(owner.id)}`;
  },
  // a ready voice from the library becomes that person's voice (a recording of their own is dropped)
  useReady: async (id, hazir) => {
    const owner = voiceOwner(id);
    const { ref, ...rest } = owner.voice || {};
    owner.voice = { ...rest, hazir };
    changed(true);
    await save();
    const label = (state.vocab?.voices || []).find((x) => x.id === hazir)?.label || hazir;
    return `${labelOf(owner.id)} artık “${label}” sesiyle konuşacak. ${respeak(owner.id)}`;
  },
  sample: async (id) => {
    const owner = voiceOwner(id);
    const res = await runJob("ornek", owner.id);
    return `${state.outputsUrl || ""}${res.dosya}?v=${Date.now()}`;
  },
  // how this scene begins: a dip to black (default) or a hard cut
  setTransition: (kind) => {
    const f = find(state.sel.shot);
    if (!f) return;
    setKey(f.scene, "gecis", kind === "kararma" ? undefined : kind);
    changed(true);
    objectWindow.open(placeTopic());
  },
  // a person brought back into the frame: on its mark, in front
  recenter: (oyuncu) => {
    const f = find(state.sel.shot);
    const m = f?.shot.cast.find((x) => x.id === oyuncu);
    if (!m) return;
    setKey(m, "dx", undefined);
    setKey(m, "back", undefined);
    changed(true);
    note(`${labelOf(oyuncu)} işaretine (${m.mark}) geri alındı. Beğenmezsen geri al (Ctrl+Z).`);
  },
  // the same person in another view, in this shot (side, front 3/4, back 3/4)
  setView: (oyuncu, kind) => {
    const f = find(state.sel.shot);
    const i = f?.shot.cast.findIndex((m) => m.id === oyuncu) ?? -1;
    if (i < 0) return "Bu kişi bu çekimde yok.";
    const res = setView(state.draft, state.vocab, f.shot, i, kind);
    if (!res.ok) return res.why;
    state.sel = { ...state.sel, kind: "cast", index: i };
    changed(true);
    objectWindow.open(topicOf("cast", i));
    return "";
  },
  // a ready shot recipe, applied now (undo takes it back)
  applyRecipe: (id) => {
    const f = find(state.sel.shot);
    if (!f) return "Önce bir çekim seç.";
    const res = applyRecipe(state.draft, state.vocab, f.shot, id);
    if (!res.ok) return res.why;
    state.sel = { ...state.sel, kind: null, index: -1 };
    changed(true);
    note(`${res.not} Beğenmezsen geri al (Ctrl+Z).`);
    objectWindow.open(shotTopic());
    return "";
  },
  // one line spoken again, a new take; the window then plays it
  redoLine: async (key) => {
    const res = await runJob("satir", key);
    const bad = (res.failed || []).find((f) => f.key === key);
    return bad ? `Yeni çekim hazır ama ses kontrolünde farklı duyuldu: “${bad.heard}”. Dinle; olmadıysa yeniden dene.` : "Yeni çekim hazır.";
  },
});
/** What the person clicked on the stage, as an object-window topic (null: nothing it opens for). */
function topicOf(kind, index) {
  const f = find(state.sel.shot);
  if (!f) return null;
  const where = { bolum: state.path, shot: f.shot.shot_id };
  if (kind === "cast") {
    const m = f.shot.cast[index];
    const ch = m && character(m.id);
    if (!ch) return null;
    // its views (side, front, back) and which one this shot shows: the window switches between them
    const goster = { gorunusler: viewsOf(state.vocab, state.draft, ch.id), simdi: viewKindOf(state.vocab, ch.rig) };
    return { tur: "karakter", id: ch.rig, ad: (ch.name || ch.id).slice(0, 80), ...where, oyuncu: ch.id, goster };
  }
  if (kind === "prop") {
    const p = (f.shot.props || [])[index];
    return p ? { tur: "nesne", id: p.prop, ad: p.id.slice(0, 80), ...where } : null;
  }
  if (kind === "dekor") {
    const d = (f.scene.dekor || [])[index];
    return d ? { tur: "nesne", id: d.prop, ad: d.id.slice(0, 80), ...where } : null;
  }
  if (kind === "line") {
    const u = (f.shot.utterances || [])[index];
    if (!u) return null;
    const key = `${f.shot.shot_id}-${index}`;
    const dir = state.path.slice(0, state.path.lastIndexOf("/")); // the episode folder: its audio is <dir>/ses/<key>.wav
    return { tur: "replik", id: key, ad: `${labelOf(u.speaker)}: replik`, ...where, goster: { konusan: labelOf(u.speaker), metin: u.text, ses: `${dir}/ses/${key}.wav`, dinleme: state.listening?.[key] || null } };
  }
  if (kind === "sfx") {
    const x = (f.shot.sfx || [])[index];
    return x ? { tur: "efekt", id: `${f.shot.shot_id}-${index}`, ad: `Efekt: ${x.sfx}`, ...where, goster: { efekt: x.sfx, at: x.at } } : null;
  }
  return null;
}
/** The place of the shot on screen (a click on the empty stage). */
function placeTopic() {
  const f = find(state.sel.shot);
  return f ? { tur: "mekan", id: f.scene.bg, ad: `Mekân: ${f.scene.bg}`, bolum: state.path, shot: f.shot.shot_id, goster: { gecis: f.scene.gecis || "kararma", ilk: state.draft.scenes[0] === f.scene } } : null;
}
/** The shot itself: its camera and composition. */
function shotTopic() {
  const f = find(state.sel.shot);
  if (!f) return null;
  const c = f.shot.camera || {};
  const goster = {
    plan: c.framing, hareket: c.move || "static", hedef: c.target ? labelOf(c.target) : null,
    sorunlar: shotProblems(state.validation?.warnings, f.shot.shot_id, f.scene.scene_id), // what the film rules say about it
    tarifler: RECIPES, kisi: f.shot.cast.length,
  };
  return { tur: "cekim", id: f.shot.shot_id, ad: `Çekim ${f.shot.shot_id}`, bolum: state.path, shot: f.shot.shot_id, goster };
}
/** The open window shows its thing as it is now (after an edit, or a new check of the rules). */
function refreshWindow() {
  const t = objectWindow.current();
  if (!t) return;
  if (t.tur === "cekim" && t.shot === state.sel.shot) objectWindow.open(shotTopic());
  if (t.tur === "karakter") {
    const i = find(state.sel.shot)?.shot.cast.findIndex((m) => m.id === t.oyuncu) ?? -1;
    if (i >= 0) objectWindow.open(topicOf("cast", i));
  }
}
const inspector = createInspector($("inspector"), {
  // a voice sample (cizgi ses-ornek) of one character, from the saved file: save first, then listen
  sample: async (id, report) => {
    try {
      if (dirty()) await save();
      if (dirty()) return report("Önce kaydet: örnek kayıtlı ses ayarlarıyla yapılır.");
      report("Ses örneği hazırlanıyor (ses modeli yüklenirken 1-2 dakika sürebilir)…");
      await api("/api/is", { b: state.path, kind: "ornek", format: state.format, sahne: id });
      for (;;) {
        await new Promise((r) => setTimeout(r, 1500));
        const { job } = await api(`/api/is?${new URLSearchParams({ b: state.path })}`);
        if (!job || job.status === "running") continue;
        if (job.status !== "done") return report(`Örnek olmadı: ${tr(job.error || "bilinmeyen hata")}`);
        report("Çalıyor.");
        return listen(`${state.outputsUrl || ""}${job.result.dosya}?v=${Date.now()}`);
      }
    } catch (err) {
      return report(`Örnek olmadı: ${err.message}`);
    }
  },
  episode: () => state.draft,
  format: () => state.format,
  vocab: () => state.vocab,
  find,
  sel: () => state.sel,
  select,
  changed,
  rigOf,
  labelOf,
  say,
  isLoop,
  shotTime: (id) => stage.shotTime(id),
  listening: (key) => state.listening?.[key] || null,
  soundUrl: (id) => stage.soundUrl(id),
  messages: (shotId) => messagesOf(shotId),
  scriptApproved: () => state.status?.gates?.senaryo === "onayli",
  scriptAck: () => state.scriptAck,
  setScriptAck: (on) => { state.scriptAck = on; },
  unspoken: (key) => state.unspoken.has(key),
  savedLine: (shotId, i) => {
    const s = state.saved?.scenes.flatMap((sc) => sc.shots).find((x) => x.shot_id === shotId);
    return s?.utterances?.[i] || null;
  },
});

/** World layout of the format on the stage: marks, distance ratio and ground line. */
function stageLayout() {
  const w = state.vocab.world;
  const tall = state.format === "9:16" && w.portrait;
  const ratio = tall ? w.portrait.scale : 1;
  // decor moves toward the middle as the marks do (CizgiCore.decorX): world x per layout x
  const decorPull = tall ? (w.portrait.marks.sag - w.portrait.marks.sol) / (w.marks.sag - w.marks.sol) : 1;
  return { marks: tall ? w.portrait.marks : w.marks, ratio, decorPull, ground: w.ground_y, backRise: (w.back_rise || 0) * ratio };
}
const member = (i) => current()?.shot.cast[i];
editor = createStageEditor({ stage: $("stage"), layer: $("edit") }, {
  doc: () => stage.doc(),
  scale: () => stage.scale(),
  playing: () => stage.playing(),
  viewport: () => (state.format === "9:16" ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 }),
  current: () => (state.draft ? current() : null), // the stage resizes before any episode is open
  inShot: () => {
    const t = state.sel.shot && stage.shotTime(state.sel.shot);
    const now = stage.now();
    return !!t && now >= t.start && now < t.end;
  },
  sel: () => state.sel,
  select,
  // a click on the stage while the film plays: stop on the shot under the playhead
  pause: () => {
    stage.toggle(false);
    const now = stage.now();
    const here = allShots().find(({ shot }) => {
      const t = stage.shotTime(shot.shot_id);
      return t && now >= t.start && now < t.end;
    });
    if (here && here.shot.shot_id !== state.sel.shot) {
      state.sel = { shot: here.shot.shot_id, kind: null, index: -1 };
      renderAll();
    }
  },
  emptyClick: () => {
    const t = placeTopic();
    if (t) objectWindow.open(t); // the empty stage is the place
  },
  layout: stageLayout,
  labelOf,
  say,
  place: (kind, i, at) => {
    const f = current();
    const item = kind === "cast" ? f?.shot.cast[i] : f?.shot.props?.[i];
    if (!item) return;
    item.mark = at.mark;
    setKey(item, "dx", at.dx || undefined);
    if (kind === "cast" && at.back !== undefined) setKey(item, "back", at.back || undefined);
    state.sel = { ...state.sel, kind, index: i };
    changed(true);
  },
  placeDecor: (i, at) => {
    const d = current()?.scene.dekor?.[i];
    if (!d) return;
    d.x = at.x;
    setKey(d, "back", at.back || undefined);
    state.sel = { ...state.sel, kind: "dekor", index: i };
    changed(true);
  },
  setWalk: (i, dx) => {
    const m = member(i);
    if (!m?.walk) return;
    m.walk = { ...m.walk, dx };
    changed(true);
  },
  flip: (i) => {
    const m = member(i);
    if (!m) return;
    setKey(m, "facing", m.facing === "sol" ? undefined : "sol"); // no facing = as drawn
    // a walker turned around walks the other way from the same place (it walked backwards before)
    if (m.walk) m.walk = { ...m.walk, dx: -m.walk.dx };
    changed(true);
  },
});

/* ---------- library cards dragged onto the timeline or the stage (birak.js) ---------- */
/** Do what a click on the card does, at the place it was dropped: its shot, moment and character. */
function dropFromLibrary(kind, id, action, shotId) {
  if (action.pick === "muzik") return pick("muzik", id);
  const was = { sel: state.sel, now: stage.now(), episode: JSON.stringify(state.draft) };
  state.sel = { shot: shotId, kind: action.castIndex == null ? null : "cast", index: action.castIndex ?? -1, ...(action.seg !== undefined ? { seg: action.seg } : {}) };
  // an action starts at the playhead: put it where the card was let go (an effect takes its time directly)
  if (action.seek !== undefined && action.pick !== "ses") {
    const t = stage.shotTime(shotId);
    if (t) {
      stage.toggle(false);
      stage.seek(t.start + action.seek);
    }
  }
  pick(action.pick, id, { at: action.pick === "ses" ? action.seek : undefined, worldX: action.worldX });
  if (JSON.stringify(state.draft) !== was.episode) return undefined;
  // refused (pick said why): the selection and the playhead go back to where they were
  state.sel = was.sel;
  stage.seek(was.now);
  return renderAll();
}
drops = installDrops({
  timeline: $("tl-scroll"),
  stage: $("stage"),
  timelineAt: (x, y) => timeline.at(x, y),
  showTimelineDrop: (x, text) => timeline.showDrop(x, text),
  stageAt: (x, y) => {
    // the stage shows the shot under the playhead: a card lands there only when that is the selected one
    const t = state.sel.shot && stage.shotTime(state.sel.shot);
    const now = stage.now();
    const shown = t && now >= t.start && now < t.end ? state.sel.shot : null;
    return { shotId: shown, castIndex: editor.castAt(x, y), worldX: editor.groundXAt(x) ?? undefined };
  },
  apply: dropFromLibrary,
});

/* ---------- selection ---------- */
function choose(id) {
  state.sel = { shot: id, kind: null, index: -1 };
  const t = stage.shotTime(id);
  if (t) stage.seek(t.start + Math.min(0.5, (t.end - t.start) / 2));
  renderAll();
}
function select(kind, index = -1, seg = undefined) {
  state.sel = { ...state.sel, kind, index, seg };
  const topic = topicOf(kind, index);
  if (topic) {
    views?.closeLeft(); // its cards would replace what was clicked; the stage gets the room
    objectWindow.open(topic); // a click on a character or prop opens its window
  }
  requests.renderTarget();
  inspector.render();
  library.render();
  editor.draw();
}

/* ---------- what a library click changes ---------- */
let sticky = ""; // a message about the last edit, kept over the "preparing preview" notes
function say(text) {
  text = tr(text); // an engine message the panel knows, in Turkish
  $("state").textContent = text;
  $("state").title = text; // cut short on a narrow window: the whole of it on hover
}
/** Say something the next preview status must not wipe; cleared by the edit after. */
function note(text) {
  sticky = text;
  say(text);
}
/** Status from the preview cycle: never hides a note about the last edit. */
function status(text) {
  if (!sticky) say(text);
}
function characterFor(rig) {
  const existing = state.draft.characters.find((c) => c.rig === rig);
  if (existing) return existing.id;
  const meta = state.vocab.rigs.find((r) => r.id === rig);
  const id = uniqueId(rig, new Set(state.draft.characters.map((c) => c.id)));
  state.draft.characters.push({ id, name: meta?.label || rig, rig });
  addedHere.add(id);
  return id;
}
/** Drop characters this panel added that no shot uses any more (the file's own stay as they are). */
function pruneCharacters() {
  const used = new Set(allShots().flatMap(({ shot }) => [...shot.cast.map((m) => m.id), ...(shot.utterances || []).map((u) => u.speaker)]));
  const kept = state.draft.characters.filter((c) => used.has(c.id) || !addedHere.has(c.id));
  if (kept.length !== state.draft.characters.length) state.draft.characters = kept;
}
/**
 * What a library card does (a click, or a drop: opts carries where it landed).
 * @param {{at?:number, worldX?:number}} [opts] at: an effect's time in the shot; worldX: where a character stands
 */
function pick(kind, id, opts = {}) {
  if (kind === "muzik") {
    // music is the whole film's: no shot needed; the other settings stay
    state.draft.music = { ...(state.draft.music || {}), track: id };
    state.sel = { ...state.sel, kind: "mix", index: -1 };
    return changed(true);
  }
  const f = current();
  if (!f) return say("Önce aşağıdan bir shot seç.");
  const { shot, scene } = f;
  const { member, actor, prop } = selectedItem();
  switch (kind) {
    case "karakter": {
      const cid = characterFor(id);
      if (member) {
        if (member.id !== cid && shot.cast.some((m) => m.id === cid)) return say(`${labelOf(cid)} bu shot'ta zaten var.`);
        renameMember(shot, member, cid);
      } else {
        if (shot.cast.some((m) => m.id === cid)) return say(`${labelOf(cid)} bu shot'ta zaten var.`);
        const used = new Set(shot.cast.map((m) => m.mark));
        const lay = stageLayout();
        // dropped on the stage: the nearest free mark to where it was let go, or off it
        const spot = opts.worldX != null ? placeAt(opts.worldX, lay.marks, used, lay.ratio) : null;
        const mark = spot?.mark || MARKS.find((k) => !used.has(k)) || "orta";
        const action = state.vocab.actions.some((a) => a.id === "bekle") ? "bekle" : state.vocab.actions[0].id;
        shot.cast.push({ id: cid, action, mark, ...(spot?.dx ? { dx: spot.dx } : {}) });
        state.sel = { ...state.sel, kind: "cast", index: shot.cast.length - 1 };
      }
      break;
    }
    case "hareket": {
      // Replaces the action selected on the actor track, else the one under the playhead.
      if (!actor) return say("Hareket vermek için önce sağdan bir oyuncu seç.");
      const seg = state.sel.seg ?? segmentIndexAt(actor, playheadInShot(shot) ?? 0);
      replaceSegmentAction(actor, seg, id, isLoop, shotLen(shot));
      state.sel = { ...state.sel, kind: "cast", index: shot.cast.indexOf(actor), seg };
      break;
    }
    case "hareket-ekle": {
      // A new action in the sequence, starting at the playhead.
      if (!actor) return say("Hareket eklemek için önce sağdan bir oyuncu seç.");
      const at = playheadInShot(shot);
      const t = stage.shotTime(shot.shot_id);
      if (at === null || !t) return say("Oynatma kafasını bu shot'ın içinde, hareketin başlayacağı ana getir.");
      const seg = insertSegment(actor, id, at, t.end - t.start, isLoop);
      if (seg === null) return say("Bu anda zaten bir hareket başlıyor ya da shot bitiyor: oynatma kafasını biraz kaydır.");
      state.sel = { ...state.sel, kind: "cast", index: shot.cast.indexOf(actor), seg };
      break;
    }
    case "mekan":
      scene.bg = id;
      break;
    case "dekor": {
      // in the middle of the frame (drag it on the stage); further pieces a little to the side
      const n = (scene.dekor || []).length;
      scene.dekor = [...(scene.dekor || []), { id: decorId(scene, id), prop: id, x: 960 + ((n % 5) - 2) * 220 }];
      state.sel = { ...state.sel, kind: "dekor", index: scene.dekor.length - 1 };
      changed(true);
      return note(`${id} sahneye dekor olarak kondu: sahnede sürükleyerek yerini (sağa-sola) ve derinliğini (yukarı-aşağı) ayarla.`);
    }
    case "nesne":
      if (prop) prop.prop = id;
      else {
        const taken = new Set((shot.props || []).map((p) => p.id));
        shot.props = [...(shot.props || []), { id: uniqueId(id, taken), prop: id, mark: "orta" }];
        state.sel = { ...state.sel, kind: "prop", index: shot.props.length - 1 };
      }
      break;
    case "ses": {
      const t = stage.shotTime(shot.shot_id);
      const now = stage.now();
      // dropped: where it was let go (within the shot as last compiled); clicked: the playhead
      const at = opts.at !== undefined
        ? (t ? sfxAtAfterDrag(0, opts.at, t.end - t.start) : Math.round(opts.at * 100) / 100)
        : t && now >= t.start && now < t.end ? Math.round((now - t.start) * 100) / 100 : 0;
      shot.sfx = [...(shot.sfx || []), { sfx: id, at }];
      state.sel = { ...state.sel, kind: "sfx", index: shot.sfx.length - 1 };
      break;
    }
    case "kamera-plan":
      shot.camera.framing = id;
      break;
    case "kamera-hareket":
      shot.camera.move = id;
      break;
    default:
      return undefined;
  }
  return changed(true);
}

/* ---------- header: production steps ---------- */
const production = createProduction({ dialog: $("uretim"), steps: $("steps") }, {
  path: () => state.path,
  dirty: () => !!state.draft && dirty(),
  format: () => state.format,
  status: () => state.status,
  setStatus: (s) => { state.status = s; },
  api: (path, body) => api(path, body),
  audioReady: () => { if (state.draft) refreshPreview(); },
  // the senaryo step completes open decisions in the draft and saves them like any other edit
  applyDecisions: async ({ format, kararlar }) => {
    if (!state.draft) return;
    if (format) state.draft.format = format;
    state.draft.kararlar = { ...(state.draft.kararlar || {}), ...kararlar };
    changed(true);
    await save();
  },
  goShot: (id) => {
    $("uretim").close();
    if (find(id)) choose(id);
  },
});
const renderSteps = () => production.renderSteps();
/* ---------- the studio hint: what to do while Claude listens ---------- */
// Without it the person met a stage and no idea what the buttons do (Test 14). It names the two
// moves and goes away once an object window is open (then the window says the rest).
let hintClosed = false;
function studioHint(listening) {
  const box = $("studyo-ipucu");
  if (!box) return;
  const show = listening && !!state.draft && !hintClosed && !objectWindow.isOpen() && !document.body.classList.contains("at-home");
  if (show && box.hidden) {
    box.replaceChildren(
      el("span", { class: "nokta acik", "aria-hidden": "true" }),
      el("span", { text: "Claude dinliyor. Sahnede bir şeye tıkla (karakter, mekân, altyazı): yanında pencere açılır, ne istediğini oraya yaz. Bitince sağ üstte 🎬 Video çıkar." }),
      el("button", { class: "btn icon small", type: "button", "aria-label": "İpucunu kapat", text: "✕", on: { click: () => { hintClosed = true; box.hidden = true; } } }));
  }
  box.hidden = !show;
}
/* ---------- "Video çıkar": the whole production in one press ---------- */
const videoButton = createVideoButton({
  api,
  path: () => state.path,
  format: () => state.format,
  dirty: () => !!state.draft && dirty(),
  save: () => save(),
  outputsUrl: () => state.outputsUrl || "",
  applyDecisions: async ({ format, kararlar }) => {
    if (format) state.draft.format = format;
    state.draft.kararlar = { ...(state.draft.kararlar || {}), ...kararlar };
    changed(true);
    await save();
  },
  openProduction: () => production.show(),
  after: () => refreshPreview(), // the lines' audio is new: the stage plays it
});
$("video-cikar").addEventListener("click", () => {
  if (state.draft) videoButton.open();
});
function renderHeader() {
  const atHome = document.body.classList.contains("at-home"); // the editor waits behind the home page
  if (!atHome) {
    $("title").textContent = state.draft.title || state.draft.episode;
    $("title").title = state.path; // where the file is: on hover, not in the bar
    document.title = `${state.draft.title || state.draft.episode} · Çizgi Stüdyo`;
  }
  renderSteps();
  const d = dirty();
  $("save").disabled = !d || state.validation?.ok === false || state.previewOk === false;
  $("revert").disabled = !d;
  $("undo").disabled = !steps.canUndo();
  $("redo").disabled = !steps.canRedo();
  const f = current();
  for (const b of ["shot-add", "shot-dup", "shot-del"]) $(b).disabled = !f;
  if (f && f.scene.shots.length <= 1) $("shot-del").disabled = true;
  $("shot-del").title = f && f.scene.shots.length <= 1 ? "Sahnenin tek shot'ı silinemez" : "Seçili shot'ı sil (Delete)";
}

/* ---------- messages ---------- */
function problems() {
  const map = new Map();
  for (const [key, list] of [["errors", state.validation?.errors], ["warnings", state.validation?.warnings]]) {
    for (const m of list || []) {
      const id = shotOfMessage(m);
      if (!id) continue;
      const p = map.get(id) || { errors: 0, warnings: 0 };
      p[key]++;
      map.set(id, p);
    }
  }
  return map;
}
/** Open the shot a message is about, and the row in it (cast member, prop, effect, line). */
function goToMessage(shotId, msg) {
  choose(shotId);
  const f = find(shotId);
  const row = f && rowOfMessage(msg, f.shot);
  if (row) select(row.kind, row.index);
}
/** This shot's messages for the inspector. */
function messagesOf(shotId) {
  const v = state.validation;
  const pick = (list, level) => (list || []).filter((m) => shotOfMessage(m) === shotId).map((text) => ({ level, text }));
  return [...pick(v?.errors, "err"), ...pick(v?.warnings, "warn")];
}
function renderMessages(preview) {
  const v = state.validation;
  const items = [
    ...(v?.errors || []).map((m) => ["err", "Hata", m]),
    ...(preview && !preview.ok && v?.ok ? [[state.look === "3b" ? "warn" : "err", state.look === "3b" ? "3B önizleme" : "Önizleme", tr(preview.error)]] : []),
    ...(v?.warnings || []).map((m) => ["warn", "Uyarı", m]),
  ];
  if (!items.length) return $("msgs").replaceChildren(); // nothing to say: the line takes no room under the stage
  $("msgs").replaceChildren(el("ul", {}, items.map(([cls, kind, m]) => {
    const id = shotOfMessage(m);
    return el("li", { class: cls }, id
      ? el("a", { href: "#", on: { click: (e) => { e.preventDefault(); goToMessage(id, m); } } }, `${kind}: ${m}`)
      : `${kind}: ${m}`);
  })));
}

/* ---------- edit cycle ---------- */
function renderAll() {
  renderHeader();
  tree.render();
  requests.renderTarget();
  timeline.render();
  inspector.render();
  library.render();
  editor.draw();
}
function changed(structural = false) {
  sticky = "";
  pruneCharacters();
  steps.record(JSON.stringify(state.draft));
  renderHeader();
  if (structural) renderAll();
  say(dirty() ? "kaydedilmemiş değişiklik var" : "");
  clearTimeout(timer);
  timer = setTimeout(refreshPreview, PREVIEW_DELAY_MS);
}
async function api(path, body) {
  const res = await fetch(path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
async function refreshPreview() {
  const seq = ++previewSeq;
  status("önizleme hazırlanıyor…");
  try {
    const res = await api("/api/onizle", { b: state.path, episode: state.draft, format: state.format, gorunum: state.look });
    if (seq !== previewSeq) return; // a newer edit, or another episode, is on its way
    state.validation = res.validation;
    // Saving needs a compiled preview too: some limits only show when compiling.
    // a 3D preview that fails (no 3D recipe) does not block saving: saving compiles the 2D one
    state.previewOk = res.validation.ok && (res.preview.ok || state.look === "3b");
    if (res.preview.ok) state.unspoken = new Set(res.preview.unspoken || []);
    renderMessages(res.preview);
    refreshWindow(); // the shot window lists the rules' findings: they may have changed
    if (res.preview.ok) stage.load(res.preview);
    else if (res.validation.ok && state.look === "3b") stage.load({ ...res.preview, error: tr(res.preview.error) }); // why, on the stage
    timeline.render();
    tree.render(); // shot lengths and problem badges
    inspector.render(); // messages, badges and line notes follow the new validation
    renderHeader();
    if (!res.validation.ok) say("hatalı: kaydedilemez");
    else if (!res.preview.ok) say(state.look === "3b" ? "3B önizleme yok (kaydetmek serbest)" : "önizleme derlenemedi: kaydedilemez");
    else status(dirty() ? "kaydedilmemiş değişiklik var" : "");
  } catch (err) {
    if (seq === previewSeq) status(`önizleme hatası: ${err.message}`);
  }
}
let saving = false; // a save on its way: the file on disk changes because of us
async function save() {
  $("save").disabled = true;
  say("kaydediliyor…");
  const sent = structuredClone(state.draft); // edits made while the request runs stay unsaved
  const generation = opened;
  saving = true;
  try {
    const res = await api("/api/kaydet", { b: state.path, episode: sent, version: state.version, format: state.format });
    if (generation !== opened) return; // an episode was (re)opened meanwhile
    state.validation = res.validation;
    renderMessages(res.preview);
    if (!res.saved) return say(res.validation.ok ? "önizleme derlenemedi: kaydedilmedi" : "hatalı: kaydedilmedi");
    state.version = res.version;
    state.saved = sent;
    state.status = res.status;
    state.unspoken = new Set(res.preview.unspoken || []);
    stage.load(res.preview);
    production.refresh();
    timeline.render();
    renderHeader();
    say(dirty() ? "kaydedildi; sonraki değişiklikler kaydedilmedi" : "kaydedildi");
  } catch (err) {
    if (generation !== opened) return;
    say(`kaydedilmedi: ${err.message}`);
    renderHeader();
  } finally {
    saving = false;
  }
}
/** Open an episode (throws when the server cannot); the address keeps it across reloads. */
async function open(rel) {
  say("yükleniyor…");
  const ticket = ++openTicket;
  const res = await api(`/api/bolum?${new URLSearchParams({ b: rel, f: state.format, g: state.look })}`);
  if (ticket !== openTicket) return; // a later open won
  opened++;
  const same = rel === state.path;
  if (!same) story.reset(); // the story cards of the new episode load when the window opens
  clearTimeout(timer);
  previewSeq++; // drop answers still on their way for the previous episode
  stage.toggle(false);
  Object.assign(state, { path: res.path, saved: res.episode, draft: structuredClone(res.episode), version: res.version, vocab: res.vocab, status: res.status, validation: res.validation, listening: res.listening || {} });
  steps.reset(JSON.stringify(state.draft));
  state.previewOk = !!res.preview?.ok || (state.look === "3b" && !!res.validation?.ok);
  state.unspoken = new Set(res.preview?.unspoken || []);
  state.scriptAck = false; // asked again for every episode
  production.set({ job: res.job, outputs: res.outputs, outputsUrl: res.outputsUrl });
  state.outputsUrl = res.outputsUrl;
  addedHere.clear();
  sticky = "";
  const first = allShots()[0]?.shot.shot_id ?? null;
  state.sel = { shot: same && state.sel.shot && find(state.sel.shot) ? state.sel.shot : first, kind: null, index: -1 };
  if (!document.body.classList.contains("at-home")) history.replaceState(null, "", `#b=${encodeURIComponent(res.path)}`);
  if (!same) stage.seek(0);
  renderMessages(res.preview);
  stage.load(res.preview?.ok ? res.preview : { ...res.preview, error: tr(res.preview?.error) }); // why there is none, in Turkish
  renderAll();
  requests.start();
  say("");
  // a new episode is shown in its own frame: editing a vertical film in 16:9 showed a framing it will never have
  const own = res.episode?.format;
  if (!same && own && own !== state.format) $(`fmt-${own.replace(":", "x")}`)?.click();
}

// unsaved story cards count too: switching episodes would drop them
const projectWizard = createProjectWizard({ api, note, slug, onClose: () => { if (projects.shown()) projects.show(); } });
// a new episode starts on one screen (the story, the format, the length); the wizard stays a click away
const quickStart = createQuickStart({
  api,
  wizard: () => projectWizard.open(null),
  done: (id) => {
    note(`Claude “${id}” bölümünü kuruyor: karakterler, sahneler, ilk çekimler. Birkaç dakikada editörde açılır; adımları sağda görürsün.`);
    if (projects.shown()) projects.show(); // the list shows it under "Yapım aşamasında"
  },
});
const projects = createProjects($("projects"), {
  wizard: (id) => (id ? projectWizard.open(id) : quickStart.open()),
  current: () => state.path,
  dirty: () => (!!state.draft && dirty()) || story.dirty(),
  open,
  api,
  // the address says where the person is: in the editor it names the episode, so a reload reopens it; on the home
  // page it names none (a reload stays there, unless the panel was started for one episode: start() opens that)
  onView: (home) => {
    if (home) {
      history.replaceState(null, "", location.pathname);
      $("title").textContent = "Çizgi Stüdyo";
      $("title").title = "";
      document.title = "Projeler · Çizgi Stüdyo";
    } else if (state.path) {
      history.replaceState(null, "", `#b=${encodeURIComponent(state.path)}`);
      renderHeader();
      timeline.render(); // drawn while hidden, it measured no width
      $("home-btn").focus({ preventScroll: true }); // the home page's focus is gone with it
    }
  },
});

/* ---------- Sahneler: the scenes and shots of the open episode (a left rail panel) ---------- */
const tree = createTree($("proje-pane"), {
  episode: () => state.draft,
  selected: () => state.sel.shot,
  choose,
  problems,
  timing: () => stage.timing(),
  framingLabel: (id) => (state.vocab?.framings.find((f) => f.id === id)?.label || id).replace(/\s*\(.*\)$/, ""),
  vocab: () => state.vocab,
  viewOf: (id) => viewOf(id),
  changed: (shotId, text) => {
    if (shotId) state.sel = { shot: shotId, kind: null, index: -1 }; // null: naming or moving a scene keeps the selection
    changed(true);
    if (text) note(text);
  },
  say: note, // a refusal must outlive the preview status of the edit before it
  review: (scene) => review.open(scene),
});
/* ---------- Hikâye: story cards (hikaye.json, a draft) ---------- */
const story = createStory($("hikaye"), {
  path: () => state.path,
  title: () => state.draft?.title || state.draft?.episode || "",
  scenes: () => state.draft?.scenes || [],
  rigs: () => (state.vocab?.rigs || []).map((r) => ({ id: r.id, label: r.label || r.id })),
  goToScene: (sceneId) => {
    const scene = state.draft.scenes.find((s) => s.scene_id === sceneId);
    if (scene) choose(scene.shots[0].shot_id);
  },
  note,
  api,
});
$("story").addEventListener("click", () => story.show());
// "Bölümü düzenle": the project wizard on the open episode (its wishes live in its story)
$("story").after(el("button", {
  class: "btn small", type: "button", text: "Bölümü düzenle", title: "Proje sihirbazı: bu bölümün isteklerini değiştir",
  on: {
    click: () => {
      const m = /^bolumler\/([a-z0-9]+(?:-[a-z0-9]+)*)\/bolum\.json$/.exec(state.path || "");
      if (!m) return note("Sihirbaz yalnız bolumler/<kimlik>/bolum.json bölümlerini düzenler.");
      return projectWizard.open(m[1]);
    },
  },
}));
/* ---------- Claude moving the panel and asking in it (panel_git, panel_sor) ---------- */
createClaudeChannel({
  api,
  current: () => state.path,
  home: () => projects.show(),
  openEpisode: async (rel) => {
    await projects.show(); // from the home page, so unsaved edits are asked about where the person sees it
    await projects.go(rel);
  },
  story: () => story.show(),
  selectShot: (id) => {
    if (!state.draft || !find(id)) return false;
    choose(id);
    return true;
  },
  projectWizard: (id, step) => projectWizard.open(id, step),
  projectSlot: () => projectWizard.slot(),
  setThinking: (on, listening) => projectWizard.setThinking(on, listening),
  takeDraft: (tur, id) => drafts.take(tur, id),
  onChats: (state, listening) => {
    objectWindow.update(state, listening);
    studioHint(listening);
  },
  note,
}).start();
/* ---------- İncele: scene review ---------- */
const review = createReview($("inceleme"), {
  path: () => state.path,
  episode: () => state.draft,
  format: () => state.format,
  dirty: () => !!state.draft && dirty(),
  outputsUrl: () => state.outputsUrl || "",
  goTo: (shotId, msg) => (msg ? goToMessage(shotId, msg) : choose(shotId)),
  api,
});
/* ---------- Claude'a yaz: requests to the session; reload when Claude changes the file ---------- */
const requests = createRequests($("claude"), {
  path: () => state.path,
  episode: () => state.draft,
  current: () => (state.draft ? current() : null),
  sel: () => state.sel,
  labelOf,
  now: () => (state.draft ? Math.round(stage.now() * 100) / 100 : null),
  version: () => state.version,
  dirty: () => !!state.draft && dirty(),
  saving: () => saving,
  storyVersion: (v) => story.diskVersion(v),
  draftsVersion: (v) => drafts.onSignature(v),
  reload: () => open(state.path),
  note,
  api,
});
/** Start with the episode in the address, else the one the panel was started with, else the home page. */
async function start() {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get("b");
  let first = fromHash;
  if (!first) {
    try {
      first = (await api("/api/bolumler")).initial || null;
    } catch (err) {
      say(`bölümler alınamadı: ${err.message}`);
    }
  }
  if (first) {
    try {
      return await open(first);
    } catch (err) {
      say(`açılamadı: ${err.message}`);
    }
  }
  return projects.show();
}

$("save").addEventListener("click", save);
$("home-btn").addEventListener("click", () => projects.show());
$("revert").addEventListener("click", () => {
  state.draft = structuredClone(state.saved);
  // A row index may point at something that is gone: keep the shot, drop the row.
  state.sel = { shot: find(state.sel.shot) ? state.sel.shot : allShots()[0]?.shot.shot_id ?? null, kind: null, index: -1 };
  changed(true);
});
/* ---------- shot operations and undo ---------- */
const viewOf = (id) => state.vocab.rigs.find((r) => r.id === rigOf(id))?.view || "front";
function shotOp(kind) {
  const f = current();
  if (!f) return say("Önce bir shot seç.");
  let next;
  if (kind === "add") next = addShotAfter(state.draft, f.scene, f.shot, state.vocab, viewOf).shot_id;
  else if (kind === "dup") next = duplicateShot(state.draft, f.scene, f.shot).shot_id;
  else {
    next = deleteShot(f.scene, f.shot);
    if (!next) return say("Sahnenin tek shot'ı silinemez.");
  }
  state.sel = { shot: next, kind: null, index: -1 };
  changed(true);
  if (kind === "del") note(`${f.shot.shot_id} silindi · geri almak için Ctrl+Z`);
  if (kind === "dup" && f.shot.utterances?.length) note(`${next}: replikler kopyalanmadı (senaryodan gelir)`);
}
/** Alt+←/→: move the selected shot one place within its scene (the keyboard way to reorder). */
function nudgeShot(dir) {
  const f = current();
  if (!f) return;
  const i = f.scene.shots.indexOf(f.shot);
  if (moveShot(f.scene, f.shot.shot_id, i + dir)) changed(true);
}
function travel(dir) {
  const snap = dir < 0 ? steps.undo() : steps.redo();
  if (snap === null) return;
  state.draft = JSON.parse(snap);
  if (!find(state.sel.shot)) state.sel = { shot: allShots()[0]?.shot.shot_id ?? null, kind: null, index: -1 };
  else state.sel = { ...state.sel, kind: null, index: -1 }; // an index may point at a removed row
  changed(true);
}
/** Delete: the selected cast member, prop or effect; with none selected, the shot. */
function removeSelected() {
  const m = state.sel.kind === "cast" ? current()?.shot.cast[state.sel.index] : null;
  if (m && state.sel.seg > 0) {
    // an action of the sequence, not the actor
    if (removeSegment(m, state.sel.seg, isLoop, shotLen(current().shot))) {
      state.sel = { ...state.sel, seg: undefined };
      changed(true);
    }
    return;
  }
  if (state.sel.kind) {
    if (!inspector.removeSelected()) say("Shot'ın tek oyuncusu silinemez.");
  } else shotOp("del");
}
/* ---------- view choices (left pane, timeline, frame, safe areas, hidden layers) ---------- */
const views = installViews({
  timeline,
  editor,
  library,
  tree,
  format: () => state.format,
  setFormat: (format) => {
    state.format = format;
    stage.setFormat(format);
    if (state.draft) {
      clearTimeout(timer);
      refreshPreview(); // compiled again for the new frame
    }
  },
  look: () => state.look,
  setLook: (look) => {
    state.look = look;
    $("stage").dataset.look = look; // 3D: the stage says it is for watching
    stage.setFormat(state.format); // the next preview replaces this one: no positions read from it meanwhile
    if (state.draft) {
      clearTimeout(timer);
      refreshPreview();
    }
  },
});

$("mixer").addEventListener("click", () => { if (state.draft) select("mix"); });
$("ep-settings").addEventListener("click", () => { if (state.draft) select("mix"); });
$("shot-add").addEventListener("click", () => shotOp("add"));
$("shot-dup").addEventListener("click", () => shotOp("dup"));
$("shot-del").addEventListener("click", () => shotOp("del"));
$("undo").addEventListener("click", () => travel(-1));
$("redo").addEventListener("click", () => travel(1));

window.addEventListener("beforeunload", (e) => { if ((state.draft && dirty()) || story.dirty()) e.preventDefault(); });
installKeys({
  // dialogs handle their own keys
  blocked: () => projects.shown() || ["uretim", "inceleme", "hikaye"].some((id) => $(id).open) || !state.draft,
  save,
  canSave: () => !$("save").disabled,
  travel,
  duplicate: () => shotOp("dup"),
  nudge: nudgeShot,
  toggle: () => stage.toggle(),
  step: (frames) => stage.step(frames),
  remove: removeSelected,
});
start();
