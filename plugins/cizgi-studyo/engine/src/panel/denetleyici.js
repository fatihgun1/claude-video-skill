// Inspector (the right panel) shows what is selected, its settings first:
//   a cast member, prop, effect, line or decor: only that, with "← shot" back;
//   nothing: the shot (camera and its rows, a click opens one), then its scene in a closed section;
//   the episode (Bölüm ayarları, the timeline's Ses düzeyleri): bolum-ayar.js.
// Every control only offers library words and commits through ctx.changed().
// Look: a header naming the selection, titled sections, labels above controls (denetleyici-alan.js).
import { el, select, number, setKey } from "./dom.js";
import { header, section, quietSection, folded, labelled, segment, valueSlider, percent, withUnit, check, dangerButton } from "./denetleyici-alan.js";
import { rigThumb } from "./kutuphane.js";
import { listen } from "./dinle.js";
import { segmentSpans, replaceSegmentAction, moveSegmentStart, removeSegment, addLine, removeLine, rowOfMessage } from "./kurgu.js";
import { sceneLayers } from "./katman.js";
import { sceneDecor } from "./dekor.js";
import { sceneLight } from "./isik.js";
import { sceneCaption, lineCaption } from "./altyazi-ayar.js";
import { episodeSettings } from "./bolum-ayar.js";

/** Short state of a line's audio (ses/manifest.json); a failed check can only come from the old engine. */
function listenText(check) {
  if (!check) return "seslendirilmedi";
  if (check.ok) return "seslendirildi ✓";
  return check.accepted ? "dinleme ✗ (kabul edildi)" : "dinleme ✗";
}
function listenDetail(check) {
  if (!check) return "Bu replik henüz seslendirilmedi (cizgi ses).";
  if (check.ok) return "Seslendirildi: Edge metni yazıldığı gibi okur.";
  const how = check.accepted ? "geçmedi ama kabul edildi" : "geçmedi: dinleyip karar ver (cizgi kabul ya da yeniden seslendir)";
  return `Dinleme kontrolü ${how}. Duyulan: “${check.heard}”${check.cer != null ? ` (fark ${Math.round(check.cer * 100)}%)` : ""}`;
}

const MARK_TEXT = { sol: "sol", orta: "orta", sag: "sağ" };
const FACING_TEXT = { sag: "sağa", sol: "sola" };
/** Words on buttons start with a capital; the same words inside a sentence do not. */
const cap = (s) => s.charAt(0).toLocaleUpperCase("tr") + s.slice(1);
const markOptions = (marks) => marks.map((k) => ({ id: k, label: cap(MARK_TEXT[k] || k) }));
const twoDecimals = (x) => x.toFixed(2);

/**
 * @param {HTMLElement} box
 * @param {{episode:() => object, vocab:() => object, find:(id:string) => {shot:object, scene:object}|null,
 *          sel:() => {shot:string|null, kind:string|null, index:number}, select:(kind:string|null, index?:number) => void,
 *          changed:(structural?:boolean) => void, rigOf:(id:string) => string, labelOf:(id:string) => string,
 *          shotTime:(id:string) => {start:number, end:number}|null}} ctx
 */
/** Put another character in a cast member's place: the camera and held props follow. */
export function renameMember(shot, member, id) {
  const old = member.id;
  member.id = id;
  if (shot.camera.target === old) shot.camera.target = id;
  for (const p of shot.props || []) if (p.holder === old) p.holder = id;
}

export function createInspector(box, ctx) {
  const hear = (id) => listen(`/kutuphane/ses/${id}.wav`);
  const labelIn = (list, id) => (list.find((x) => x.id === id) || { label: id }).label;

  function row({ key, img, title, meta, onPick, onDelete, deleteText, deleteQuestion, badge }) {
    const del = onDelete ? dangerButton("Sil", deleteQuestion, onDelete, { title: deleteText }) : null;
    if (del) del.setAttribute("aria-label", deleteText);
    return el("div", { class: "item", role: "button", tabindex: "0", "data-row": key,
      on: { click: onPick, keydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(); } } } },
    img, el("div", { class: "grow" }, el("div", { text: title }), el("div", { class: "meta", text: meta })), badge || null, del);
  }

  /** This shot's messages, each with the row it is about (if one can be told from it). */
  let shotMessages = [];
  function messagesOf(shot) {
    return ctx.messages(shot.shot_id).map((m) => ({ ...m, row: rowOfMessage(m.text, shot) }));
  }

  /** A "!" on a row that has errors (red) or warnings (yellow); its title lists them. */
  function badgeFor(kind, index) {
    const mine = shotMessages.filter((m) => m.row && m.row.kind === kind && m.row.index === index);
    if (!mine.length) return null;
    const bad = mine.some((m) => m.level === "err");
    return el("span", { class: `rowbadge ${bad ? "err" : "warn"}`, title: mine.map((m) => m.text).join("\n"), "aria-label": `${mine.length} ${bad ? "hata" : "uyarı"}`, text: "!" });
  }

  /** The list at the top of the shot: click one to open the row it is about. */
  function problemList(only = () => true) {
    const list = shotMessages.filter(only); // a selected row shows only its own
    if (!list.length) return null;
    return el("ul", { class: "problems" }, list.map((m) => el("li", { class: m.level },
      m.row
        ? el("a", { href: "#", on: { click: (e) => { e.preventDefault(); ctx.select(m.row.kind, m.row.index); } } }, m.text.replace(/^(film: )?shot [^:]+: /, ""))
        : m.text.replace(/^(film: )?shot [^:]+: /, ""))));
  }

  /** 0 = front ground line, 1 = as far back as it goes (higher and smaller). */
  function depth(m) {
    return valueSlider(m.back ?? 0, { label: "Derinlik", show: twoDecimals, onSet: (x) => { setKey(m, "back", x || undefined); ctx.changed(true); } });
  }

  /**
   * The member's actions in order: its own first, then the listed ones, each with when it
   * starts and how far into it; the selected one is the one the library and Delete act on.
   */
  function sequence(shot, m) {
    const v = ctx.vocab();
    const t = ctx.shotTime(shot.shot_id);
    const len = t ? t.end - t.start : Infinity;
    const selSeg = ctx.sel().seg ?? 0;
    const setFrom = (index, val) => {
      if (index === 0) setKey(m, "from", val);
      else m.actions = m.actions.map((x, i) => (i === index - 1 ? (val === undefined ? (({ from, ...rest }) => rest)(x) : { ...x, from: val }) : x));
      ctx.changed(true);
    };
    const rows = segmentSpans(m, len).map((s) => el("div", {
      class: `seg-row${selSeg === s.index ? " sel" : ""}`,
      on: { click: (e) => { if (e.target === e.currentTarget) ctx.select("cast", shot.cast.indexOf(m), s.index); } },
    },
    el("span", { class: "seg-n", text: `${s.index + 1}.` }),
    el("div", { class: "seg-act" }, select(s.action, v.actions, (val) => { replaceSegmentAction(m, s.index, val, ctx.isLoop, t && len); ctx.changed(true); })),
    el("label", { class: "seg-num", title: "Shot'ın başından kaç saniye sonra başlar" }, el("span", { text: "başlar (s)" }),
      s.index
        ? number(s.start, (val) => { moveSegmentStart(m, s.index, val ?? s.start, len, ctx.isLoop); ctx.changed(true); }, { min: 0.05, step: 0.05 })
        : el("b", { class: "muted small", text: "baştan" })),
    el("label", { class: "seg-num", title: "Hareketin kaçıncı saniyesinden oynar" }, el("span", { text: "içinden (s)" }),
      number(s.from || undefined, (val) => setFrom(s.index, val), { min: 0, step: 0.05 })),
    s.index
      ? dangerButton("Sil", `${s.index + 1}. hareket (“${labelIn(v.actions, s.action)}”) diziden çıkarılsın mı?`,
        () => { removeSegment(m, s.index, ctx.isLoop, t && len); ctx.select("cast", shot.cast.indexOf(m)); ctx.changed(true); },
        { title: "Bu hareketi diziden çıkar" })
      : el("span")));
    return el("div", { class: "seq" },
      el("div", { class: "seg-head", text: "Hareketler (sırayla)" }),
      rows,
      el("p", { class: "field-hint", text: "Yeni hareket: soldaki Hareket panelinde + Ekle (oynatma kafasının olduğu anda başlar)." }));
  }

  /** Turkish names of the rigs' colour variables (others show as they are). */
  const COLOUR_NAMES = {
    skin: "ten", "skin-dark": "ten (gölge)", hair: "saç", top: "üst", "top-dark": "üst (gölge)", collar: "yaka",
    pants: "pantolon", "pants-dark": "pantolon (gölge)", shoe: "ayakkabı", accent: "vurgu", line: "çizgi",
    fur: "tüy", belly: "karın", bag: "çanta",
  };

  /**
   * The character's colours (episode.characters[].palette): every colour its rig lets an
   * episode change, starting from the drawing's own. They apply in every shot.
   */
  function colours(m) {
    const ch = ctx.episode().characters.find((c) => c.id === m.id);
    const rig = ctx.vocab().rigs.find((r) => r.id === ch?.rig);
    const vars = Object.entries(rig?.palette || {});
    if (!ch || !vars.length) return null;
    const set = (key, value) => {
      const palette = { ...(ch.palette || {}) };
      if (value === undefined) delete palette[key];
      else palette[key] = value;
      setKey(ch, "palette", Object.keys(palette).length ? palette : undefined);
      ctx.changed(true);
    };
    return el("div", { class: "colours" },
      vars.map(([key, base]) => {
        const own = ch.palette?.[key];
        const pick = el("input", { type: "color", value: own || base || "#000000", "aria-label": `${COLOUR_NAMES[key] || key} rengi` });
        pick.addEventListener("change", () => set(key, pick.value));
        return el("div", { class: "colour" },
          pick,
          el("span", { text: COLOUR_NAMES[key] || key }),
          own ? el("button", { class: "btn small ghost", type: "button", title: "Çizimdeki renge dön", "aria-label": `${COLOUR_NAMES[key] || key}: çizimdeki renge dön`, on: { click: () => set(key, undefined) } }, "↺") : null);
      }));
  }

  function castDetail(shot, m) {
    const v = ctx.vocab();
    const chars = ctx.episode().characters.map((c) => ({ id: c.id, label: c.name || c.id }));
    const walk = m.walk;
    // a costume variant of the drawing for this shot (cast[].varyant), when the drawing has any
    const variants = v.rigs.find((r) => r.id === ctx.episode().characters.find((c) => c.id === m.id)?.rig)?.varyantlar || [];
    const palette = colours(m);
    // most used first: who and what they do, then where, then walking, then looks; colours folded
    return el("div", { class: "detail" },
      section("Oyuncu", null,
        labelled("Karakter", select(m.id, chars, (val) => {
          if (val !== m.id && shot.cast.some((x) => x.id === val)) {
            ctx.say(`${ctx.labelOf(val)} bu shot'ta zaten var.`);
            return render(); // put the dropdown back
          }
          renameMember(shot, m, val);
          ctx.changed(true);
        })),
        sequence(shot, m)),
      section("Yer", null,
        labelled("Konum", segment(m.mark, markOptions(v.marks), (val) => { m.mark = val; ctx.changed(); }, { label: "Konum" })),
        labelled("Yön", segment(m.facing, v.facings.map((k) => ({ id: k, label: cap(FACING_TEXT[k] || k) })), (val) => { setKey(m, "facing", val); ctx.changed(); }, { empty: "Çizimdeki", label: "Yön" })),
        labelled("Kaydırma", withUnit(number(m.dx, (val) => { setKey(m, "dx", val || undefined); ctx.changed(true); }, { min: -900, max: 900, step: 10 }), "px", "Kaydırma (piksel)")),
        labelled("Derinlik", depth(m), "0 önde; 1 en arkada (daha yukarıda ve küçük).")),
      section("Yürüme", null,
        labelled("Mesafe", withUnit(number(walk?.dx, (val) => {
          if (val === undefined) delete m.walk;
          else m.walk = { ...(m.walk || {}), dx: val };
          ctx.changed(true);
        }, { min: -1500, max: 1500, step: 10 }), "px", "Yürüme mesafesi (piksel)"), "Boşsa yürümez."),
        walk ? labelled("Süre", withUnit(number(walk.time, (val) => { setKey(m.walk, "time", val); ctx.changed(); }, { min: 0.1, step: 0.1 }), "s", "Yürüme süresi (saniye)")) : null,
        walk ? check("Gelip dursun", !!walk.arrive, (on) => { setKey(m.walk, "arrive", on || undefined); ctx.changed(); }) : null),
      section("Görünüm", null,
        // the face outside speech (cast[].ifade); moments within the shot are edited in bolum.json
        labelled("İfade", Array.isArray(m.ifade)
          ? el("span", { class: "muted small", text: `shot içinde değişiyor: ${m.ifade.map((f) => `${f.at} s ${f.ifade === "gulumse" ? "gülümser" : "nötr"}`).join(", ")}` })
          : segment(m.ifade === "gulumse" ? "gulumse" : undefined, [{ id: "gulumse", label: "Gülümsüyor" }], (val) => { setKey(m, "ifade", val || undefined); ctx.changed(); }, { empty: "Nötr", label: "İfade" })),
        variants.length
          ? labelled("Kıyafet", select(m.varyant, variants, (val) => { setKey(m, "varyant", val || undefined); ctx.changed(); }, { empty: "çizimdeki gibi" }))
          : null),
      palette ? folded("Renkler", `${ctx.labelOf(m.id)} bütün shot'larda bu renklerle çizilir.`, palette) : null);
  }

  function propDetail(shot, p) {
    const v = ctx.vocab();
    return el("div", { class: "detail" },
      section("Nesne", null,
        labelled("Nesne", select(p.prop, v.props, (val) => { p.prop = val; ctx.changed(true); })),
        labelled("Tutan", segment(p.holder, shot.cast.map((c) => ({ id: c.id, label: ctx.labelOf(c.id) })), (val) => { setKey(p, "holder", val); ctx.changed(); }, { empty: "Kimse (yerde)", label: "Tutan" }))),
      section("Yer", null,
        p.depth
          ? el("p", { class: "field-hint", text: `Derinlikte: x ${p.depth.x}, y ${p.depth.y}, ölçek ${p.depth.scale}` })
          : [
              labelled("Konum", segment(p.mark, markOptions(v.marks), (val) => { setKey(p, "mark", val); ctx.changed(); }, { empty: "Yok", label: "Konum" })),
              labelled("Kaydırma", withUnit(number(p.dx, (val) => { setKey(p, "dx", val); ctx.changed(); }, { min: -600, max: 600, step: 1 }), "px", "Kaydırma (piksel)")),
            ]));
  }

  function sfxDetail(shot, s) {
    const t = ctx.shotTime(shot.shot_id);
    return el("div", { class: "detail" },
      labelled("Efekt", select(s.sfx, ctx.vocab().sfx, (val) => { s.sfx = val; ctx.changed(true); })),
      labelled("Zaman", withUnit(number(s.at, (val) => {
        // A typed value ignores the box's max: keep the effect inside its shot.
        const last = t ? Math.max(0, Math.floor((t.end - t.start - 0.05) * 100) / 100) : Infinity;
        s.at = Math.min(Math.max(0, val ?? 0), last);
        ctx.changed(true);
      }, { min: 0, max: t ? t.end - t.start : undefined, step: 0.05 }), "s", "Zaman (saniye)"), "Shot'ın başından sonra."),
      labelled("Ses düzeyi", valueSlider(s.volume ?? 1, { label: "Ses düzeyi", onSet: (x) => { setKey(s, "volume", x === 1 ? undefined : x); ctx.changed(); } })),
      el("button", { class: "btn small", on: { click: () => hear(s.sfx) } }, "▶ Dinle"));
  }

  function removeCast(shot, i) {
    const [gone] = shot.cast.splice(i, 1);
    if (shot.camera.target === gone.id) delete shot.camera.target;
    for (const p of shot.props || []) if (p.holder === gone.id) delete p.holder;
    ctx.select(null);
    ctx.changed(true);
  }

  function removeFrom(shot, key, i) {
    shot[key].splice(i, 1);
    if (!shot[key].length) delete shot[key];
    ctx.select(null);
    ctx.changed(true);
  }

  /** A line: its pause before, its loudness, listening to it, and its listening check. */
  /** Who may speak in a shot: its cast and the narrator. */
  const speakersOf = (shot) => [...shot.cast.map((m) => ({ id: m.id, label: ctx.labelOf(m.id) })), { id: "anlatici", label: "Anlatıcı" }];

  /**
   * Changing the words or the speaker changes the script. When the script is approved the
   * person first ticks that they know the approval will go (the panel never approves).
   */
  function scriptGuard() {
    if (!ctx.scriptApproved() || ctx.scriptAck()) return null;
    const box = el("input", { type: "checkbox" });
    box.addEventListener("change", () => { if (box.checked) { ctx.setScriptAck(true); render(); } });
    return el("label", { class: "guard" }, box,
      el("span", { text: "Senaryo onaylı. Replikleri değiştirirsem senaryo onayının düşeceğini, sesin yeniden üretilmesi ve senaryonun yeniden onaylanması gerektiğini biliyorum." }));
  }

  /** What the line's audio is: none yet, outdated by an edit, or as recorded. */
  function audioNote(shot, u, i) {
    if (ctx.unspoken(`${shot.shot_id}-${i}`)) return "Ses yok: önizlemede tahmini sürede sessiz geçer. Kaydettikten sonra seslendir (cizgi ses).";
    const was = ctx.savedLine(shot.shot_id, i);
    if (was && (was.text !== u.text || was.speaker !== u.speaker)) return "Metin değişti: önizlemede eski kayıt çalar. Kaydettikten sonra yeniden seslendir (cizgi ses).";
    return null;
  }

  function lineDetail(shot, u, i) {
    const heard = ctx.listening(`${shot.shot_id}-${i}`);
    const url = ctx.soundUrl(`ses-${shot.shot_id}-${i}`);
    const locked = ctx.scriptApproved() && !ctx.scriptAck();
    const text = el("textarea", { "aria-label": "Replik", rows: 2, disabled: locked, maxlength: 400 });
    text.value = u.text;
    text.addEventListener("change", () => {
      const t = text.value.trim();
      if (!t) {
        text.value = u.text; // an empty line is not a line: delete it instead
        return;
      }
      u.text = t;
      ctx.changed(true);
    });
    const who = select(u.speaker, speakersOf(shot), (val) => { u.speaker = val; ctx.changed(true); });
    who.disabled = locked;
    const note = audioNote(shot, u, i);
    return el("div", { class: "detail" },
      scriptGuard(),
      section("Söz", null,
        labelled("Konuşan", who),
        labelled("Söz", text),
        note ? el("p", { class: "small warn", text: note }) : null),
      section("Zamanlama ve ses", null,
        labelled("Önce bekle", withUnit(number(u.delay, (val) => { setKey(u, "delay", val || undefined); ctx.changed(true); }, { min: 0, max: 5, step: 0.05 }), "s", "Önce bekle (saniye)")),
        labelled("Ses düzeyi", valueSlider(u.volume ?? 1, { max: 2, label: "Replik ses düzeyi", onSet: (x) => { setKey(u, "volume", x === 1 ? undefined : x); ctx.changed(); } })),
        lineCaption(ctx.episode(), u, () => ctx.changed(true))),
      section("Dinleme", null,
        el("p", { class: `small ${heard && !heard.ok && !heard.accepted ? "err" : "muted"}`, text: listenDetail(heard) }),
        el("button", { class: "btn small", type: "button", disabled: !url, title: url ? "" : "Bu repliğin kaydı yok", on: { click: () => url && listen(url) } }, "▶ Dinle")),
      el("div", { class: "idanger" },
        dangerButton("Repliği sil", `${ctx.labelOf(u.speaker)}: “${u.text}” silinsin mi? Senaryo değişir.`,
          () => { removeLine(shot, i); ctx.select(null); ctx.changed(true); },
          { disabled: locked, title: "Repliği sil (senaryo değişir)" })));
  }

  /** A small form for a new line at the end of the shot. */
  function newLine(shot) {
    const locked = ctx.scriptApproved() && !ctx.scriptAck();
    const who = select(shot.cast[0]?.id, speakersOf(shot), () => {});
    const text = el("input", { type: "text", placeholder: "Yeni replik", "aria-label": "Yeni replik", maxlength: 400 });
    const form = el("form", { class: "newline", on: { submit: (e) => {
      e.preventDefault();
      const i = addLine(shot, who.value, text.value);
      if (i === null) return text.focus();
      ctx.select("line", i);
      return ctx.changed(true);
    } } }, who, text, el("button", { class: "btn small", type: "submit", text: "Ekle" }));
    for (const c of [who, text, ...form.querySelectorAll("button")]) c.disabled = locked;
    return form;
  }

  /** The Sahne section stays open or closed as the person left it (a view choice, in the browser). */
  const SCENE_KEY = "cizgi.sahne-acik";
  function sceneOpen() {
    try {
      return localStorage.getItem(SCENE_KEY) === "1";
    } catch {
      return false; // storage off: closed, as at first
    }
  }

  const decorList = (scene, sel) => sceneDecor(scene, {
    selected: sel.kind === "dekor" ? sel.index : -1,
    select: (i) => ctx.select(i < 0 ? null : "dekor", i),
    changed: () => ctx.changed(true),
  });

  /**
   * What belongs to the whole scene (every shot of it): background layers, light, where captions
   * sit, decor. A closed <details> by default, so the shot's own settings come first.
   */
  function sceneSection(scene, sel) {
    const v = ctx.vocab();
    const box = el("details", { class: "scene-box", open: sceneOpen() },
      el("summary", {}, el("span", { text: `Sahne: ${scene.title || scene.scene_id}` }), el("span", { class: "muted small", text: "bütün shot'ları" })),
      section("Mekân katmanları", null, sceneLayers(scene, v.backgrounds.find((b) => b.id === scene.bg)?.layers, () => ctx.changed(true))),
      section("Işık", "Bütün shot'lara gün saatinin rengi; altyazılar değişmez.", sceneLight(scene, () => ctx.changed(true))),
      section("Altyazının yeri", null, sceneCaption(scene, ctx.format(), () => ctx.changed(true))),
      section("Dekor", null, decorList(scene, sel)));
    box.addEventListener("toggle", () => {
      try {
        localStorage.setItem(SCENE_KEY, box.open ? "1" : "0");
      } catch {
        /* storage off: lasts until the next redraw */
      }
    });
    return box;
  }

  /** The selected thing alone, its settings first; "← shot" goes back to the whole shot. */
  function itemView(scene, shot, sel) {
    const v = ctx.vocab();
    const i = sel.index;
    const back = { text: `← ${shot.shot_id}`, onClick: () => ctx.select(null) };
    const head = (kind, title, meta) => [header({ back, kind, title, meta }),
      problemList((m) => m.row && m.row.kind === sel.kind && m.row.index === i)];
    // the destructive action sits last, apart from the settings, and asks first
    const drop = (text, question, fn) => el("div", { class: "idanger" }, dangerButton(text, question, fn));
    if (sel.kind === "cast" && shot.cast[i]) {
      const m = shot.cast[i];
      return [...head("Oyuncu", ctx.labelOf(m.id), `shot ${shot.shot_id}`), castDetail(shot, m),
        shot.cast.length > 1 ? drop("Oyuncuyu shot'tan çıkar", `“${ctx.labelOf(m.id)}” bu shot'tan çıkarılsın mı?`, () => removeCast(shot, i)) : null];
    }
    if (sel.kind === "prop" && shot.props?.[i]) {
      const p = shot.props[i];
      return [...head("Nesne", p.id, `${p.prop} · shot ${shot.shot_id}`), propDetail(shot, p),
        drop("Nesneyi shot'tan çıkar", `“${p.id}” nesnesi bu shot'tan çıkarılsın mı?`, () => removeFrom(shot, "props", i))];
    }
    if (sel.kind === "sfx" && shot.sfx?.[i]) {
      const s = shot.sfx[i];
      const name = labelIn(v.sfx, s.sfx);
      return [...head("Efekt", name, `${s.at.toFixed(2)} s · shot ${shot.shot_id}`), sfxDetail(shot, s),
        drop("Efekti sil", `“${name}” efekti silinsin mi?`, () => removeFrom(shot, "sfx", i))];
    }
    if (sel.kind === "line" && shot.utterances?.[i]) {
      const u = shot.utterances[i];
      return [...head("Replik", `${ctx.labelOf(u.speaker)}: “${u.text}”`, `replik ${i + 1} · shot ${shot.shot_id}`), lineDetail(shot, u, i)];
    }
    if (sel.kind === "dekor" && scene.dekor?.[i]) {
      return [...head("Dekor", "Dekor", `sahne ${scene.scene_id}: bütün shot'larında`), decorList(scene, sel)];
    }
    return null; // the selection points at nothing any more: show the shot
  }

  /** Nothing selected: the shot, its rows (a click opens one), then its scene's section. */
  function shotView(scene, shot, sel) {
    const v = ctx.vocab();
    const t = ctx.shotTime(shot.shot_id);
    const targets = [...shot.cast.map((c) => ({ id: c.id, label: ctx.labelOf(c.id) })), ...(shot.props || []).map((p) => ({ id: p.id, label: `${p.id} (nesne)` }))];
    const cast = shot.cast.map((m, i) => {
      const img = el("img", { alt: "" });
      rigThumb(ctx.rigOf(m.id)).then((src) => { img.src = src; });
      return row({
        key: `cast:${i}`, img, title: ctx.labelOf(m.id),
        meta: `${labelIn(v.actions, m.action)} · ${MARK_TEXT[m.mark] || m.mark}${m.walk ? " · yürüyor" : ""}`,
        onPick: () => ctx.select("cast", i),
        onDelete: shot.cast.length > 1 ? () => removeCast(shot, i) : null, deleteText: "Oyuncuyu shot'tan çıkar",
        deleteQuestion: `“${ctx.labelOf(m.id)}” bu shot'tan çıkarılsın mı?`, badge: badgeFor("cast", i),
      });
    });
    const props = (shot.props || []).map((p, i) => row({
      key: `prop:${i}`, img: el("img", { alt: "", src: `/kutuphane/nesne/${p.prop}.svg` }), title: p.id,
      meta: `${p.prop}${p.holder ? ` · ${ctx.labelOf(p.holder)} tutuyor` : ""}`,
      onPick: () => ctx.select("prop", i),
      onDelete: () => removeFrom(shot, "props", i), deleteText: "Nesneyi shot'tan çıkar",
      deleteQuestion: `“${p.id}” nesnesi bu shot'tan çıkarılsın mı?`, badge: badgeFor("prop", i),
    }));
    const sounds = (shot.sfx || []).map((s, i) => row({
      key: `sfx:${i}`, img: el("span", { class: "btn icon", "aria-hidden": "true", text: "♪" }), title: labelIn(v.sfx, s.sfx),
      meta: `${s.at.toFixed(2)} s${s.volume !== undefined ? ` · düzey ${percent(s.volume)}` : ""}`,
      onPick: () => ctx.select("sfx", i),
      onDelete: () => removeFrom(shot, "sfx", i), deleteText: "Efekti sil",
      deleteQuestion: `“${labelIn(v.sfx, s.sfx)}” efekti silinsin mi?`, badge: badgeFor("sfx", i),
    }));
    const lines = (shot.utterances || []).map((u, i) => {
      const key = `${shot.shot_id}-${i}`;
      return row({
        key: `line:${i}`, img: el("span", { class: "btn icon", "aria-hidden": "true", text: "❝" }),
        title: `${ctx.labelOf(u.speaker)}: “${u.text}”`,
        meta: [ctx.unspoken(key) ? "ses yok" : listenText(ctx.listening(key)), u.delay ? `önce ${u.delay.toFixed(2)} s bekler` : "", u.volume !== undefined ? `düzey ${percent(u.volume)}` : ""].filter(Boolean).join(" · "),
        onPick: () => ctx.select("line", i),
        badge: badgeFor("line", i),
      });
    });
    const notes = el("textarea", { "aria-label": "Notlar" });
    notes.value = shot.notes || "";
    notes.addEventListener("change", () => { setKey(shot, "notes", notes.value || undefined); ctx.changed(); });
    // a section's hint is its title's tooltip: the list stays quiet (empty ones say how to add)
    return [
      header({ kind: "Shot", title: shot.shot_id, meta: `${scene.title || `sahne ${scene.scene_id}`} · ${scene.bg}${t ? ` · ${t.start.toFixed(2)}–${t.end.toFixed(2)} s` : ""}` }),
      problemList(),
      quietSection("Kamera", null,
        labelled("Plan", segment(shot.camera.framing, v.framings, (val) => { shot.camera.framing = val; ctx.changed(true); }, { label: "Plan" })),
        labelled("Hareket", segment(shot.camera.move, v.moves, (val) => { setKey(shot.camera, "move", val); ctx.changed(); }, { empty: "Sabit", label: "Kamera hareketi" })),
        labelled("Hedef", segment(shot.camera.target, targets, (val) => { setKey(shot.camera, "target", val); ctx.changed(); }, { empty: "Otomatik", label: "Kameranın hedefi" })),
        labelled("Bekleme", withUnit(number(shot.hold, (val) => { setKey(shot, "hold", val); ctx.changed(true); }, { min: 0, max: 10, step: 0.05 }), "s", "Bekleme (saniye)"))),
      quietSection("Oyuncular", "Eklemek: soldaki Karakter paneli", cast),
      quietSection("Nesneler", "Eklemek: soldaki Nesne paneli",
        props.length ? props : el("p", { class: "isec-empty", text: "Bu shot'ta nesne yok. Eklemek için soldaki Nesne paneli." })),
      quietSection("Efektler", "Eklemek: soldaki Ses paneli",
        sounds.length ? sounds : el("p", { class: "isec-empty", text: "Bu shot'ta efekt yok. Eklemek için soldaki Ses paneli." })),
      quietSection("Replikler", "Bir replik değişirse senaryo onayı düşer", lines, newLine(shot)),
      quietSection("Notlar", null, notes),
      sceneSection(scene, sel),
    ];
  }

  /** Which view is on show: "shot", "mix" or the open row ("cast:0"…), to tell a switch from a redraw. */
  let shown = "";
  let shotScroll = 0; // where the shot view was scrolled when a row opened
  const scroller = () => box.closest(".inspector") || box;

  /** After a switch: an item starts at its top, the shot view comes back where it was, the keyboard stays here. */
  function settle(view, hadFocus) {
    if (view === shown) return;
    const was = shown;
    shown = view;
    if (view === "shot") {
      scroller().scrollTop = shotScroll;
      if (hadFocus) (box.querySelector(`[data-row="${was}"]`) || box.querySelector("h2"))?.focus({ preventScroll: true });
      return;
    }
    scroller().scrollTop = 0;
    if (hadFocus) box.querySelector(".back")?.focus({ preventScroll: true });
  }

  function render() {
    const sel = ctx.sel();
    const hadFocus = box.contains(document.activeElement);
    if (shown === "shot") shotScroll = scroller().scrollTop;
    if (sel.kind === "mix") {
      box.replaceChildren(episodeSettings({ episode: ctx.episode, vocab: ctx.vocab, labelOf: ctx.labelOf, changed: ctx.changed, select: ctx.select, sample: ctx.sample }));
      return settle("mix", hadFocus);
    }
    const found = sel.shot && ctx.find(sel.shot);
    if (!found) {
      box.replaceChildren(el("p", { class: "empty", text: "Aşağıdaki şeritten bir shot seç." }));
      return settle("", hadFocus);
    }
    const { scene, shot } = found;
    shotMessages = messagesOf(shot);
    const item = sel.kind ? itemView(scene, shot, sel) : null;
    // the selection points at something gone: clear it, so the stage and Delete agree with the panel
    if (sel.kind && !item) queueMicrotask(() => ctx.select(null));
    // el() flattens nested arrays and drops nulls; replaceChildren would not.
    box.replaceChildren(el("div", {}, item || shotView(scene, shot, sel)));
    return settle(item ? `${sel.kind}:${sel.index}` : "shot", hadFocus);
  }

  /** Remove the selected cast member, prop or effect (Delete key). false when nothing can go. */
  function removeSelected() {
    const sel = ctx.sel();
    const found = sel.shot && ctx.find(sel.shot);
    if (!found) return false;
    const { shot } = found;
    if (sel.kind === "cast" && shot.cast[sel.index] && shot.cast.length > 1) removeCast(shot, sel.index);
    else if (sel.kind === "prop" && shot.props?.[sel.index]) removeFrom(shot, "props", sel.index);
    else if (sel.kind === "sfx" && shot.sfx?.[sel.index]) removeFrom(shot, "sfx", sel.index);
    else if (sel.kind === "dekor" && found.scene.dekor?.[sel.index]) {
      const next = found.scene.dekor.filter((_, j) => j !== sel.index);
      if (next.length) found.scene.dekor = next;
      else delete found.scene.dekor;
      ctx.select(null);
      ctx.changed(true);
    } else return false;
    return true;
  }

  return { render, removeSelected };
}
