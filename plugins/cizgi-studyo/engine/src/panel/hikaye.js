// Story cards ("Hikâye" in the top bar): the idea, the audience, the characters and one card per
// scene, saved to hikaye.json next to the episode. A draft, not a gate: it never changes bolum.json.
// Claude can suggest cards and turn them into the script (requests through "Claude'a yaz"); when
// Claude edits hikaye.json the open window follows (or asks first when there are unsaved edits).
//
// Layout: a full-screen work page like the project wizard (editing a whole story takes minutes, not a
// glance), one narrow column, labels above fields; scenes are an ordered list of folding cards
// (number · title · place · who), reordered with ↑/↓. The project wizard edits the same file, so the
// data model stays the wizard's: fields this page does not show (mekan, saat, nesneler, istekler…)
// are kept untouched.
import { el } from "./dom.js";
import { mergeStory } from "./hikaye-birlestir.js";

const SHORT = 80;
const TEXT = 1000;
const MAX_CARDS = 40;
const MAX_CHARACTERS = 20;

/**
 * The Hikâye page of the open episode.
 * @param {HTMLDialogElement} dialog
 * @param {{path:() => string|null, title:() => string, scenes:() => {scene_id:string, title?:string}[],
 *          rigs:() => {id:string, label:string}[], goToScene:(sceneId:string) => void, note:(text:string) => void,
 *          api:(path:string, body?:object) => Promise<any>}} ctx
 * @returns {{show:() => Promise<void>, diskVersion:(v:string) => Promise<void>, reset:() => void, dirty:() => boolean}}
 */
export function createStory(dialog, ctx) {
  let story = null; // the working copy
  let savedText = ""; // as last read or saved, to tell unsaved edits
  let version = "";
  let loadedFor = null; // the episode path the copy belongs to
  let error = "";
  let info = "";
  let diskChanged = false; // hikaye.json changed on disk while there are unsaved edits here
  let closing = false; // "unsaved edits: save or discard?" is showing
  let saving = false;
  let focusKey = null; // after a redraw, focus the control with this data-odak (moves, adds)
  let uid = 0;
  const openCards = new Set(); // folded open, by card id: survives redraws
  const nameErrors = new Map(); // character object → "that name is taken"
  const savedState = el("span", { class: "hk-durum", role: "status" });

  const dirty = () => !!story && JSON.stringify(story) !== savedText;
  const cut = (s, n) => String(s ?? "").slice(0, n);
  const cardKey = (k, i) => k.id ?? `#${i}`;
  // the editor's single-key shortcuts must not fire while typing here (Ctrl/⌘ combinations still do)
  const keepKeys = (e) => { if (!e.ctrlKey && !e.metaKey) e.stopPropagation(); };

  /** The shape the window can draw: an object with the two lists of objects (the rest is the validator's). */
  const drawable = (s) => !!s && typeof s === "object" && !Array.isArray(s)
    && [s.karakterler, s.kartlar].every((list) => Array.isArray(list) && list.every((x) => x && typeof x === "object" && !Array.isArray(x)))
    && s.kartlar.every((k) => k.kim === undefined || (Array.isArray(k.kim) && k.kim.every((n) => typeof n === "string")))
    && s.karakterler.every((c) => typeof (c.ad ?? "") === "string");

  async function read() {
    const res = await ctx.api(`/api/hikaye?${new URLSearchParams({ b: ctx.path() })}`);
    if (!drawable(res.story)) throw new Error(`hikaye.json bu pencerede açılamayacak biçimde: ${res.errors.join("; ") || "karakterler ve kartlar liste olmalı"}. Dosyayı düzelt ya da Claude'dan düzeltmesini iste.`);
    return res;
  }

  async function load() {
    error = "";
    try {
      const res = await read();
      story = res.story;
      savedText = JSON.stringify(story);
      version = res.version;
      loadedFor = ctx.path();
      diskChanged = false;
      nameErrors.clear();
      if (res.errors.length) error = `hikaye.json'da düzeltilecekler (kaydetmeden önce): ${res.errors.join("; ")}`;
    } catch (err) {
      story = null;
      error = err.message;
    }
    render();
  }

  /** Both wrote: Claude's version on disk joins the person's unsaved edits (theirs stay unsaved, over the new base). */
  async function merge() {
    error = "";
    try {
      const res = await read();
      story = mergeStory(JSON.parse(savedText), story, res.story);
      savedText = JSON.stringify(res.story);
      version = res.version;
      diskChanged = false;
      info = "Claude'un değişiklikleri seninkilerle birleştirildi. Kontrol et ve kaydet.";
    } catch (err) {
      error = err.message;
    }
    render();
  }

  async function save() {
    error = "";
    if (saving) return false;
    if (!dirty()) {
      info = "Kaydedilecek değişiklik yok: hikaye.json güncel.";
      render();
      return true;
    }
    saving = true;
    render();
    const sent = JSON.stringify(story); // what goes to disk; typing meanwhile stays unsaved
    try {
      version = (await ctx.api("/api/hikaye", { b: ctx.path(), story: JSON.parse(sent), version })).version;
      savedText = sent;
      info = "Kaydedildi (hikaye.json).";
      diskChanged = false;
      return true;
    } catch (err) {
      error = err.message;
      if (/diskte değişti/.test(err.message)) diskChanged = true; // offer merge or reload, never overwrite Claude
      return false;
    } finally {
      saving = false;
      render();
    }
  }

  /** A request to Claude through the session queue (Claude'a yaz). Claude reads the saved file: save first. */
  async function ask(metin) {
    if (dirty() && !(await save())) return;
    error = "";
    info = "";
    try {
      await ctx.api("/api/istek", { b: ctx.path(), hedef: { tur: "bolum", etiket: cut(ctx.title(), 100) }, metin });
      info = "Claude'a gönderildi: durumunu sahnenin altındaki “Claude'a yaz” kutusunda görürsün. Claude hikaye.json'u değiştirince bu sayfa yenilenir.";
    } catch (err) {
      error = err.message;
    }
    render();
  }
  const suggest = () => ask([
    "Hikâye kartlarını öner: bölümün yanındaki hikaye.json dosyasındaki fikirden (ve varsa kartlardan) yola çıkarak karakterleri ve sahne kartlarını tamamla.",
    "Karakterler için kütüphanedeki çizimleri kullan (rig alanı); kütüphanede olmayan biri gerekiyorsa rig'siz yaz ve notunda neden gerektiğini söyle.",
    "Dosyayı hikâye biçiminde yaz (cizgi-studyo skill'indeki Hikâye kartları bölümü); bolum.json'a dokunma.",
    "Bitince neyi eklediğini kısaca panel_yanitla ile yaz.",
  ].join("\n"));
  function toScript() {
    if (!story.kartlar.length) {
      error = "Senaryo sahne kartlarından yazılır: önce en az bir sahne ekle (ya da Claude önersin).";
      info = "";
      return render();
    }
    return ask([
      `Hikâye kartlarından senaryo yaz: bölümün yanındaki hikaye.json'daki ${story.kartlar.length} kart.`,
      "Her kart bolum.json'da bir sahne olsun, kart sırasıyla. Kartın sahne alanı doluysa o sahneyi güncelle; boşsa yeni sahne ekle ve sahne kimliğini kartın sahne alanına yaz.",
      "Shot'ları, hareketleri ve replikleri cizgi-senaryo ve cizgi-sinema kurallarıyla yaz; yalnızca kütüphane; her değişiklikten sonra cizgi dogrula.",
      "Kütüphanede olmayan bir karakter ya da mekân gerekiyorsa önce bana sor.",
      "Bitince senaryoyu bana sohbette göster; senaryo onayını ben veririm.",
    ].join("\n"));
  }

  /* ---------- edits ---------- */
  function addCard() {
    if (story.kartlar.length >= MAX_CARDS) return refuse(`En çok ${MAX_CARDS} sahne kartı olabilir: birini silip yer aç.`);
    const taken = new Set(story.kartlar.map((k) => k.id));
    let n = story.kartlar.length + 1;
    while (taken.has(`k${n}`)) n++;
    story.kartlar.push({ id: `k${n}`, baslik: "", olay: "" });
    openCards.clear(); // the new scene opens, the others fold
    openCards.add(`k${n}`);
    focusKey = `baslik-k${n}`;
    render();
  }
  function moveCard(i, to, key) {
    if (to < 0 || to >= story.kartlar.length) return;
    const [k] = story.kartlar.splice(i, 1);
    story.kartlar.splice(to, 0, k);
    focusKey = key;
    render();
  }
  function addCharacter() {
    if (story.karakterler.length >= MAX_CHARACTERS) return refuse(`En çok ${MAX_CHARACTERS} karakter olabilir.`);
    const names = new Set(story.karakterler.map((c) => c.ad));
    let n = story.karakterler.length + 1;
    while (names.has(`Karakter ${n}`)) n++; // a unique name: cards know characters by name
    story.karakterler.push({ ad: `Karakter ${n}` });
    focusKey = `ad-${story.karakterler.length - 1}`;
    render();
  }
  /** A renamed character keeps its place in the cards' "kim" lists. */
  function renameCharacter(c, name) {
    const old = c.ad;
    c.ad = cut(name, SHORT);
    for (const k of story.kartlar) if (k.kim) k.kim = k.kim.map((n) => (n === old ? c.ad : n));
  }
  function removeCharacter(i) {
    const [c] = story.karakterler.splice(i, 1);
    for (const k of story.kartlar) {
      if (!k.kim) continue;
      k.kim = k.kim.filter((n) => n !== c.ad);
      if (!k.kim.length) delete k.kim;
    }
    render();
  }
  function refuse(text) {
    error = text;
    info = "";
    render();
  }

  /* ---------- form helpers ---------- */
  /** A field: its label above the control, "(isteğe bağlı)" when optional, a hint or the error under it. */
  function field(label, control, { optional, hint, error: problem, id } = {}) {
    return el("div", { class: `pfield${problem ? " hatali" : ""}` },
      el(id ? "label" : "span", { class: "pfield-ad", for: id }, label, optional ? el("span", { class: "muted", text: " (isteğe bağlı)" }) : null),
      control,
      problem ? el("p", { class: "pfield-hata", role: "alert", text: problem }) : hint ? el("p", { class: "pfield-ipucu", text: hint }) : null);
  }
  /** A text box bound to obj[key]: typing edits the copy without redrawing (focus stays). */
  function text(obj, key, { max = SHORT, rows, placeholder = "", after, odak } = {}) {
    const input = el(rows ? "textarea" : "input", {
      ...(rows ? { rows: String(rows) } : { type: "text" }), id: `hk-${++uid}`, maxlength: String(max), placeholder, "data-odak": odak,
      on: {
        input: () => {
          if (input.value) obj[key] = input.value;
          else delete obj[key];
          after?.();
          showState();
        },
        keydown: keepKeys,
      },
    });
    input.value = obj[key] ?? "";
    return input;
  }
  /** A labelled text field in one call. */
  const textField = (label, obj, key, opts = {}, fieldOpts = {}) => {
    const input = text(obj, key, opts);
    return field(label, input, { ...fieldOpts, id: input.id });
  };

  /* ---------- characters ---------- */
  function characterItem(c, i) {
    const name = el("input", { type: "text", id: `hk-${++uid}`, maxlength: String(SHORT), "data-odak": `ad-${i}`, on: { keydown: keepKeys } });
    name.value = c.ad ?? "";
    name.addEventListener("input", () => {
      if (!nameErrors.delete(c)) return; // an error clears on the first corrective keystroke
      name.closest(".pfield")?.classList.remove("hatali");
      name.closest(".pfield")?.querySelector(".pfield-hata")?.remove();
    });
    // names commit on leaving the box (blur-first): cards know characters by name, so a taken one is refused
    name.addEventListener("change", () => {
      const clean = cut(name.value, SHORT);
      if (clean && story.karakterler.some((x) => x !== c && x.ad === clean)) {
        nameErrors.set(c, `“${clean}” adında bir karakter zaten var: başka bir ad seç.`);
      } else renameCharacter(c, clean);
      render();
    });
    const rigs = ctx.rigs();
    const rig = el("select", { id: `hk-${++uid}` },
      el("option", { value: "", text: "Yeni çizilecek (kütüphanede yok)" }),
      rigs.map((r) => el("option", { value: r.id, text: r.label })),
      // a drawing written by hand or by Claude that the library does not have: shown, so it can be changed
      c.rig && !rigs.some((r) => r.id === c.rig) ? el("option", { value: c.rig, text: `${c.rig} (kütüphanede yok)` }) : null);
    rig.value = c.rig || "";
    rig.addEventListener("change", () => {
      if (rig.value) c.rig = rig.value;
      else delete c.rig;
      showState();
    });
    const shown = c.ad || `Karakter ${i + 1}`;
    return el("li", { class: "pitem hk-karakter" },
      el("div", { class: "pitem-ust" },
        el("b", { text: shown }),
        el("button", { class: "btn small ghost danger", type: "button", text: "Sil", "aria-label": `${shown} karakterini sil`, on: { click: () => {
          if (confirm(`“${shown}” karakteri silinsin mi? Sahne kartlarından da çıkar.`)) removeCharacter(i);
        } } })),
      el("div", { class: "pikili" },
        field("Ad", name, { id: name.id, error: nameErrors.get(c) }),
        field("Çizim", rig, { id: rig.id })),
      textField("Not", c, "not", { max: TEXT, rows: 2, placeholder: "Huyu, görünüşü, kıyafeti…" }, { optional: true }));
  }

  /* ---------- scene cards ---------- */
  function cardItem(k, i) {
    const key = cardKey(k, i);
    const n = i + 1;
    const last = i === story.kartlar.length - 1;
    const summaryText = () => [k.baslik || cut(k.olay, 50) || "Başlıksız", k.mekan, k.kim?.length ? k.kim.join(", ") : null].filter(Boolean).join(" · ");
    const summary = el("span", { class: "pkart-ozet", text: summaryText() });
    const after = () => { summary.textContent = summaryText(); };
    const tool = (label, aria, odak, disabled, act) => el("button", {
      class: "btn small ghost", type: "button", text: label, "aria-label": aria, "data-odak": odak, disabled,
      on: { click: (e) => { e.preventDefault(); act(); } }, // a button in <summary> must not also fold the card
    });

    const chars = story.karakterler.filter((c) => c.ad);
    const who = chars.length
      ? el("div", { class: "psegment coklu", role: "group", "aria-label": `Sahne ${n}: kim var` }, chars.map((c) => {
        const chip = el("button", { type: "button", role: "checkbox", text: c.ad });
        const paint = () => {
          const on = !!k.kim?.includes(c.ad);
          chip.setAttribute("aria-checked", String(on));
          chip.classList.toggle("secili", on);
        };
        // toggled in place (no redraw): the card stays open and focus stays on the chip
        chip.addEventListener("click", () => {
          const set = new Set(k.kim || []);
          if (set.has(c.ad)) set.delete(c.ad);
          else set.add(c.ad);
          if (set.size) k.kim = story.karakterler.map((x) => x.ad).filter((name) => set.has(name));
          else delete k.kim;
          paint();
          after();
          showState();
        });
        paint();
        return chip;
      }))
      : el("p", { class: "pfield-ipucu", text: "Önce yukarıdaki Karakterler bölümünde karakter ekle." });

    const sure = el("input", { type: "number", id: `hk-${++uid}`, inputmode: "numeric", min: "1", max: "120", step: "1", placeholder: "10", on: { keydown: keepKeys } });
    sure.value = k.sure ?? "";
    sure.addEventListener("change", () => {
      const v = Math.round(Number(sure.value));
      if (sure.value === "" || !Number.isFinite(v)) delete k.sure;
      else k.sure = Math.min(120, Math.max(1, v));
      sure.value = k.sure ?? "";
      showState();
    });

    const scene = k.sahne ? ctx.scenes().find((s) => s.scene_id === k.sahne) : null;
    const link = !k.sahne
      ? el("p", { class: "pfield-ipucu", text: "Henüz senaryoda yok: “Senaryoya dönüştür” bu kartı sahne yapar." })
      : scene
        ? el("button", { class: "linkish", type: "button", text: `→ ${scene.title || `Sahne ${scene.scene_id}`}`, title: "Bu kartın sahnesini editörde aç", on: { click: () => { dialog.close(); ctx.goToScene(scene.scene_id); } } })
        : el("p", { class: "pfield-ipucu", text: `Sahne ${k.sahne} bölümde yok (silinmiş olabilir).` });

    const box = el("details", { class: "pitem pkart", open: openCards.has(key) },
      el("summary", { "data-odak": `kart-${key}` },
        el("span", { class: "pkart-no", "aria-hidden": "true", text: String(n) }),
        summary,
        el("span", { class: "pkart-arac" },
          tool("↑", `Sahne ${n} yukarı`, `yukari-${key}`, i === 0, () => moveCard(i, i - 1, i - 1 === 0 ? `asagi-${key}` : `yukari-${key}`)),
          tool("↓", `Sahne ${n} aşağı`, `asagi-${key}`, last, () => moveCard(i, i + 1, i + 2 === story.kartlar.length ? `yukari-${key}` : `asagi-${key}`)),
          tool("Sil", `Sahne ${n} sil`, null, false, () => {
            if (!confirm(`Sahne ${n} (“${k.baslik || "başlıksız"}”) silinsin mi?`)) return;
            story.kartlar.splice(i, 1);
            render();
          }))),
      el("div", { class: "pkart-govde" },
        textField("Başlık", k, "baslik", { placeholder: "Örnek: Kayıp top", after, odak: `baslik-${key}` }),
        textField("Ne olur", k, "olay", { max: TEXT, rows: 3, placeholder: "Kim ne yapar, ne olur, nasıl biter?", after }),
        field("Kim var", who),
        el("div", { class: "pikili" },
          textField("Duygu", k, "duygu", { placeholder: "Merak, sevinç…" }, { optional: true }),
          field("Süre (saniye)", sure, { id: sure.id, optional: true })),
        field("Senaryodaki sahnesi", link)));
    box.addEventListener("toggle", () => { if (box.open) openCards.add(key); else openCards.delete(key); });
    return box;
  }

  /* ---------- the page ---------- */
  function showState() {
    const d = dirty();
    savedState.textContent = !story ? "" : d ? "Kaydedilmemiş değişiklik" : "Kaydedildi ✓";
    savedState.classList.toggle("degisti", d);
  }

  const claudeButton = (label, act) => el("button", { class: "btn ghost psih-sor", type: "button", disabled: saving, on: { click: act } },
    el("span", { class: "yildiz", "aria-hidden": "true", text: "✦" }), label);

  /** An empty list keeps its place and says what goes there and how to start. */
  const empty = (title, about, ...actions) => el("div", { class: "pbos" },
    el("h4", { text: title }), el("p", { text: about }), el("div", { class: "row hk-bos-arac" }, actions));

  function banners() {
    return [
      closing ? el("div", { class: "confirm", role: "alert" },
        el("span", { text: "Hikâyede kaydedilmemiş değişiklikler var." }),
        el("button", { class: "btn primary small", type: "button", "data-odak": "kapat-kaydet", text: "Kaydet ve kapat", on: { click: async () => { if (await save()) { closing = false; dialog.close(); } } } }),
        el("button", { class: "btn danger small", type: "button", text: "Değişiklikleri at ve kapat", on: { click: () => { closing = false; story = JSON.parse(savedText); dialog.close(); } } }),
        el("button", { class: "btn small", type: "button", text: "Vazgeç", on: { click: () => { closing = false; render(); } } })) : null,
      diskChanged ? el("div", { class: "confirm", role: "alert" },
        el("span", { text: "hikaye.json diskte değişti (Claude düzenlemiş olabilir), sende de kaydedilmemiş değişiklik var." }),
        el("button", { class: "btn primary small", type: "button", text: "Birleştir (ikisini de koru)", on: { click: merge } }),
        el("button", { class: "btn danger small", type: "button", text: "Benimkileri at, yeniden yükle", on: { click: load } })) : null,
    ];
  }

  function body() {
    if (!story) {
      return error
        ? [el("p", { class: "pfield-hata", role: "alert", text: error }), el("button", { class: "btn", type: "button", text: "Yeniden dene", on: { click: load } })]
        : [el("p", { class: "muted", role: "status", text: "Hikâye yükleniyor…" })];
    }
    const addCharBtn = () => el("button", { class: "btn", type: "button", text: "+ Karakter ekle", on: { click: addCharacter } });
    const addCardBtn = () => el("button", { class: "btn", type: "button", text: "+ Sahne ekle", on: { click: addCard } });
    return [
      el("section", { class: "hk-bolum", "aria-labelledby": "hk-b1" },
        el("h3", { id: "hk-b1", text: "Hikâye" }),
        textField("Fikir", story, "fikir", { max: TEXT, rows: 4, placeholder: "Kim? Sorunu ne? Ne değişiyor? Nasıl bitiyor?" }, { hint: "Birkaç cümle yeter; Claude kartları bundan önerir." }),
        textField("İzleyici", story, "yas", { placeholder: "Örnek: 0-3 yaş, 4-6 yaş, genel" }, { optional: true })),
      el("section", { class: "hk-bolum", "aria-labelledby": "hk-b2" },
        el("h3", { id: "hk-b2" }, "Karakterler", el("span", { class: "hk-sayi", text: ` ${story.karakterler.length}` })),
        story.karakterler.length
          ? [el("ol", { class: "hk-liste" }, story.karakterler.map(characterItem)), el("div", { class: "row" }, addCharBtn())]
          : empty("Henüz karakter yok", "Sahnelerde kimin olduğunu seçebilmek için önce karakterleri ekle.", addCharBtn())),
      el("section", { class: "hk-bolum", "aria-labelledby": "hk-b3" },
        el("h3", { id: "hk-b3" }, "Sahneler", el("span", { class: "hk-sayi", text: ` ${story.kartlar.length}` })),
        story.kartlar.length
          ? [el("ol", { class: "hk-liste" }, story.kartlar.map((k, i) => el("li", {}, cardItem(k, i)))),
            el("div", { class: "row" }, addCardBtn(), claudeButton("Claude kartları önersin", suggest))]
          : empty("Henüz sahne kartı yok", "Her kart senaryoda bir sahne olur. Kendin ekle ya da fikirden Claude önersin.", addCardBtn(), claudeButton("Claude kartları önersin", suggest))),
    ];
  }

  function render() {
    showState();
    dialog.replaceChildren(
      el("header", { class: "hk-bas" },
        el("div", { class: "hk-baslik" },
          el("h2", { text: "Hikâye" }),
          el("span", { class: "muted hk-bolum-adi", text: ctx.title() }),
          savedState),
        el("button", { class: "btn", type: "button", text: "Kapat", on: { click: tryClose } })),
      el("main", { class: "hk-ana" },
        el("div", { class: "hk-sutun" },
          banners(),
          el("p", { class: "hk-giris", text: "Taslak: onay kapısı değil, bolum.json'u değiştirmez. Senaryoyu Claude bu kartlardan yazar." }),
          body())),
      story ? el("footer", { class: "hk-alt" },
        el("div", { class: "hk-sutun" },
          error ? el("p", { class: "pfield-hata hk-mesaj", role: "alert", text: error }) : null,
          info && !error ? el("p", { class: "ok-line hk-mesaj", role: "status", text: info }) : null,
          el("div", { class: "hk-arac" },
            el("button", { class: "btn primary", type: "button", "aria-busy": saving ? "true" : null, text: saving ? "Kaydediliyor…" : "Kaydet", on: { click: save } }),
            el("span", { class: "spacer" }),
            claudeButton("Senaryoya dönüştür", toScript)))) : null);
    if (focusKey) {
      dialog.querySelector(`[data-odak="${focusKey}"]`)?.focus();
      focusKey = null;
    }
  }

  function tryClose() {
    if (!dirty()) return dialog.close();
    closing = true;
    focusKey = "kapat-kaydet";
    render();
    dialog.scrollTo({ top: 0 }); // the question sits at the top of the page
  }
  dialog.addEventListener("cancel", (e) => {
    if (!dirty()) return;
    e.preventDefault(); // Esc with unsaved edits asks first
    tryClose();
  });

  return {
    /** Open the page on the open episode's story (the copy survives closing until another episode is opened). */
    async show() {
      if (!ctx.path()) return;
      info = "";
      closing = false;
      if (!dialog.open) dialog.showModal();
      if (loadedFor !== ctx.path() || !story) {
        story = null;
        error = "";
        render();
        await load();
      } else render();
    },
    /** The poll saw hikaye.json's version: follow Claude's edits (ask first when there are unsaved edits). */
    async diskVersion(v) {
      if (!v || !story || loadedFor !== ctx.path() || v === version) return;
      if (!dirty()) {
        await load();
        if (dialog.open) ctx.note("Hikâye diskte değişti (Claude düzenledi): yeniden yüklendi.");
      } else if (!diskChanged) {
        diskChanged = true;
        if (dialog.open) render();
      }
    },
    /** Another episode was opened: its story is loaded on the next show. */
    reset() {
      story = null;
      loadedFor = null;
      diskChanged = false;
      openCards.clear();
      nameErrors.clear();
    },
    dirty,
  };
}
