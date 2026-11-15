// Story cards ("Hikâye" in the top bar): the idea, the audience, the characters and one card per
// scene, saved to hikaye.json next to the episode. A draft, not a gate: it never changes bolum.json.
// Claude can suggest cards and turn them into the script (requests through "Claude'a yaz"); when
// Claude edits hikaye.json the open window follows (or asks first when there are unsaved edits).
import { el } from "./dom.js";

const SHORT = 80;
const TEXT = 1000;
const MAX_CARDS = 40;
const MAX_CHARACTERS = 20;
const DRAG = "application/x-cizgi-kart";

/**
 * @param {HTMLDialogElement} dialog
 * @param {{path:() => string|null, title:() => string, scenes:() => {scene_id:string, title?:string}[],
 *          rigs:() => {id:string, label:string}[], goToScene:(sceneId:string) => void, note:(text:string) => void,
 *          api:(path:string, body?:object) => Promise<any>}} ctx
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

  const dirty = () => !!story && JSON.stringify(story) !== savedText;
  const cut = (s, n) => String(s ?? "").slice(0, n);

  /** The shape the window can draw: an object with the two lists of objects (the rest is the validator's). */
  const drawable = (s) => !!s && typeof s === "object" && !Array.isArray(s)
    && [s.karakterler, s.kartlar].every((list) => Array.isArray(list) && list.every((x) => x && typeof x === "object" && !Array.isArray(x)))
    && s.kartlar.every((k) => k.kim === undefined || (Array.isArray(k.kim) && k.kim.every((n) => typeof n === "string")))
    && s.karakterler.every((c) => typeof (c.ad ?? "") === "string");

  async function load() {
    error = "";
    try {
      const res = await ctx.api(`/api/hikaye?${new URLSearchParams({ b: ctx.path() })}`);
      if (!drawable(res.story)) throw new Error(`hikaye.json bu pencerede açılamayacak biçimde: ${res.errors.join("; ") || "karakterler ve kartlar liste olmalı"}. Dosyayı düzelt ya da Claude'dan düzeltmesini iste.`);
      story = res.story;
      savedText = JSON.stringify(story);
      version = res.version;
      loadedFor = ctx.path();
      diskChanged = false;
      if (res.errors.length) error = `hikaye.json'da düzeltilecekler (kaydetmeden önce): ${res.errors.join("; ")}`;
    } catch (err) {
      story = null;
      error = err.message;
    }
    render();
  }

  async function save() {
    error = "";
    const sent = JSON.stringify(story); // what goes to disk; typing meanwhile stays unsaved
    try {
      version = (await ctx.api("/api/hikaye", { b: ctx.path(), story: JSON.parse(sent), version })).version;
      savedText = sent;
      info = "Kaydedildi (hikaye.json).";
      diskChanged = false;
      return true;
    } catch (err) {
      error = err.message;
      return false;
    } finally {
      render();
    }
  }

  /** A request to Claude through the session queue (Claude'a yaz). */
  async function ask(metin) {
    error = "";
    info = "";
    try {
      await ctx.api("/api/istek", { b: ctx.path(), hedef: { tur: "bolum", etiket: cut(ctx.title(), 100) }, metin });
      info = "Claude'a gönderildi: durumunu sahnenin altındaki “Claude'a yaz” kutusunda görürsün. Claude hikaye.json'u değiştirince bu pencere yenilenir.";
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
  const toScript = () => ask([
    `Hikâye kartlarından senaryo yaz: bölümün yanındaki hikaye.json'daki ${story.kartlar.length} kart.`,
    "Her kart bolum.json'da bir sahne olsun, kart sırasıyla. Kartın sahne alanı doluysa o sahneyi güncelle; boşsa yeni sahne ekle ve sahne kimliğini kartın sahne alanına yaz.",
    "Shot'ları, hareketleri ve replikleri cizgi-senaryo ve cizgi-sinema kurallarıyla yaz; yalnızca kütüphane; her değişiklikten sonra cizgi dogrula.",
    "Kütüphanede olmayan bir karakter ya da mekân gerekiyorsa önce bana sor.",
    "Bitince senaryoyu bana sohbette göster; senaryo onayını ben veririm.",
  ].join("\n"));

  /* ---------- edits ---------- */
  function addCard() {
    if (story.kartlar.length >= MAX_CARDS) return;
    const taken = new Set(story.kartlar.map((k) => k.id));
    let n = story.kartlar.length + 1;
    while (taken.has(`k${n}`)) n++;
    story.kartlar.push({ id: `k${n}`, baslik: "", olay: "" });
    render();
  }
  function moveCard(i, to) {
    if (to < 0 || to >= story.kartlar.length || to === i) return;
    const [k] = story.kartlar.splice(i, 1);
    story.kartlar.splice(to, 0, k);
    render();
  }
  function addCharacter() {
    if (story.karakterler.length >= MAX_CHARACTERS) return;
    story.karakterler.push({ ad: "" });
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

  /** A text field bound to obj[key]: typing edits the copy without redrawing (focus stays). */
  function field(obj, key, { max = SHORT, area = false, label, placeholder = "" } = {}) {
    const input = el(area ? "textarea" : "input", {
      ...(area ? { rows: "3" } : { type: "text" }), maxlength: String(max), placeholder, "aria-label": label,
      on: {
        input: () => {
          if (input.value) obj[key] = input.value;
          else delete obj[key];
          renderHead();
        },
        keydown: (e) => { if (!e.ctrlKey && !e.metaKey) e.stopPropagation(); },
      },
    });
    input.value = obj[key] ?? "";
    return input;
  }

  function characterRow(c, i) {
    const name = el("input", { type: "text", maxlength: String(SHORT), placeholder: "Ad", "aria-label": "Karakter adı" });
    name.value = c.ad;
    name.addEventListener("change", () => {
      const clean = cut(name.value, SHORT);
      if (clean && story.karakterler.some((x) => x !== c && x.ad === clean)) {
        error = `“${clean}” adında bir karakter zaten var: kartlar karakterleri adla tanır, başka bir ad seç.`;
        name.value = c.ad;
      } else {
        error = "";
        renameCharacter(c, clean);
      }
      render();
    });
    name.addEventListener("keydown", (e) => { if (!e.ctrlKey && !e.metaKey) e.stopPropagation(); });
    const rig = el("select", { "aria-label": "Kütüphanedeki çizimi" },
      el("option", { value: "", text: "— çizilecek (kütüphanede yok) —" }),
      ctx.rigs().map((r) => el("option", { value: r.id, text: r.label })),
      // a drawing written by hand or by Claude that the library does not have: shown, so it can be changed
      c.rig && !ctx.rigs().some((r) => r.id === c.rig) ? el("option", { value: c.rig, text: `${c.rig} (kütüphanede yok)` }) : null);
    rig.value = c.rig || "";
    rig.addEventListener("change", () => {
      if (rig.value) c.rig = rig.value;
      else delete c.rig;
      render();
    });
    return el("li", { class: "schar" },
      name, rig, field(c, "not", { max: TEXT, label: "Not", placeholder: "Not (huyu, görünüşü…)" }),
      el("button", { class: "btn icon small danger", type: "button", "aria-label": `${c.ad || "karakteri"} sil`, text: "✕", on: { click: () => removeCharacter(i) } }));
  }

  function card(k, i) {
    const scenes = ctx.scenes();
    const scene = k.sahne ? scenes.find((s) => s.scene_id === k.sahne) : null;
    const who = el("div", { class: "swho" }, story.karakterler.filter((c) => c.ad).map((c) => {
      const box = el("input", { type: "checkbox", checked: !!k.kim?.includes(c.ad) });
      box.addEventListener("change", () => {
        const set = new Set(k.kim || []);
        if (box.checked) set.add(c.ad);
        else set.delete(c.ad);
        if (set.size) k.kim = story.karakterler.map((x) => x.ad).filter((n) => set.has(n));
        else delete k.kim;
        renderHead();
      });
      return el("label", {}, box, c.ad);
    }));
    const sure = el("input", { type: "number", min: "1", max: "120", step: "1", placeholder: "sn", "aria-label": "Süre (saniye)" });
    sure.value = k.sure ?? "";
    sure.addEventListener("change", () => {
      const v = Math.round(Number(sure.value));
      if (sure.value === "" || !Number.isFinite(v)) delete k.sure;
      else k.sure = Math.min(120, Math.max(1, v));
      sure.value = k.sure ?? "";
      renderHead();
    });
    // only the number is a drag handle: a draggable card would keep the mouse from selecting text in its fields
    const handle = el("span", { class: "snum", draggable: "true", title: "Sürükle: kartın sırası", text: String(i + 1) });
    const node = el("li", { class: "scard" },
      el("div", { class: "scard-head" },
        handle,
        field(k, "baslik", { label: `Kart ${i + 1} başlığı`, placeholder: "Başlık" }),
        el("button", { class: "btn icon small", type: "button", "aria-label": "Öne al", disabled: i === 0, text: "←", on: { click: () => moveCard(i, i - 1) } }),
        el("button", { class: "btn icon small", type: "button", "aria-label": "Sona doğru al", disabled: i === story.kartlar.length - 1, text: "→", on: { click: () => moveCard(i, i + 1) } }),
        el("button", { class: "btn icon small danger", type: "button", "aria-label": `Kart ${i + 1} sil`, text: "✕", on: { click: () => { story.kartlar.splice(i, 1); render(); } } })),
      field(k, "olay", { max: TEXT, area: true, label: "Ne olur", placeholder: "Ne olur? (kim ne yapar, ne olur, nasıl biter)" }),
      story.karakterler.length ? who : el("p", { class: "muted small", text: "Kim: önce karakter ekle." }),
      el("div", { class: "srow" }, field(k, "duygu", { label: "Duygu", placeholder: "Duygu (merak, sevinç…)" }), sure),
      k.sahne
        ? (scene
          ? el("button", { class: "linkish small", type: "button", text: `→ ${scene.title || `Sahne ${scene.scene_id}`}`, title: "Bu kartın sahnesini aç", on: { click: () => { dialog.close(); ctx.goToScene(scene.scene_id); } } })
          : el("span", { class: "muted small", text: `sahne ${k.sahne} (bölümde yok)` }))
        : el("span", { class: "muted small", text: "henüz sahne değil" }));
    handle.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData(DRAG, String(i));
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setDragImage(node, 20, 20);
      node.classList.add("dragging");
    });
    handle.addEventListener("dragend", () => node.classList.remove("dragging"));
    node.addEventListener("dragover", (e) => {
      if (!e.dataTransfer.types.includes(DRAG)) return;
      e.preventDefault();
      node.classList.add("drop");
    });
    node.addEventListener("dragleave", () => node.classList.remove("drop"));
    node.addEventListener("drop", (e) => {
      node.classList.remove("drop");
      const from = Number(e.dataTransfer.getData(DRAG));
      if (!Number.isInteger(from)) return;
      e.preventDefault();
      moveCard(from, i);
    });
    return node;
  }

  /* ---------- drawing ---------- */
  let head = null;
  function renderHead() {
    if (!head || !story) return;
    const d = dirty();
    head.save.disabled = !d;
    head.state.textContent = d ? "kaydedilmemiş değişiklik var" : "kayıtlı";
    for (const b of head.claude) {
      b.disabled = d;
      b.title = d ? "Önce kaydet: Claude kayıtlı hikaye.json'u okur" : "";
    }
    head.script.disabled = d || !story.kartlar.length;
  }

  function closeBar() {
    if (!closing) return null;
    return el("div", { class: "confirm", role: "alert" },
      el("span", { text: "Hikâyede kaydedilmemiş değişiklikler var." }),
      el("button", { class: "btn primary small", type: "button", text: "Kaydet ve kapat", on: { click: async () => { if (await save()) { closing = false; dialog.close(); } } } }),
      el("button", { class: "btn danger small", type: "button", text: "At ve kapat", on: { click: () => { closing = false; story = JSON.parse(savedText); dialog.close(); } } }),
      el("button", { class: "btn small", type: "button", text: "Vazgeç", on: { click: () => { closing = false; render(); } } }));
  }

  function render() {
    const save_ = el("button", { class: "btn primary", type: "button", text: "Kaydet", on: { click: save } });
    const state = el("span", { class: "muted small" });
    const suggestBtn = el("button", { class: "btn", type: "button", text: "Claude kartları önersin", on: { click: suggest } });
    const scriptBtn = el("button", { class: "btn", type: "button", text: "Senaryoya dönüştür", on: { click: toScript } });
    head = { save: save_, state, claude: [suggestBtn, scriptBtn], script: scriptBtn };
    const body = !story
      ? el("p", { class: error ? "err" : "muted", text: error || "Yükleniyor…" })
      : el("div", { class: "story" },
        el("section", { class: "sidea" },
          el("label", { class: "field" }, el("span", { text: "Fikir" }), field(story, "fikir", { max: TEXT, area: true, label: "Fikir", placeholder: "Bir iki cümle: ne anlatıyor?" })),
          el("label", { class: "field" }, el("span", { text: "Yaş" }), field(story, "yas", { label: "Yaş", placeholder: "örneğin 0-3, 4-6" }))),
        el("section", {},
          el("h3", {}, `Karakterler (${story.karakterler.length})`,
            el("button", { class: "btn small", type: "button", disabled: story.karakterler.length >= MAX_CHARACTERS, text: "+ Karakter", on: { click: addCharacter } })),
          story.karakterler.length ? el("ol", { class: "schars" }, story.karakterler.map(characterRow)) : el("p", { class: "muted small", text: "Henüz karakter yok." })),
        el("section", {},
          el("h3", {}, `Kartlar (${story.kartlar.length})`,
            el("button", { class: "btn small", type: "button", disabled: story.kartlar.length >= MAX_CARDS, text: "+ Kart", on: { click: addCard } })),
          story.kartlar.length
            ? el("ol", { class: "scards" }, story.kartlar.map(card))
            : el("p", { class: "muted small", text: "Kart yok. Fikri yazıp “Claude kartları önersin” diyebilir ya da “+ Kart” ile kendin ekleyebilirsin." })));
    dialog.replaceChildren(el("div", {},
      el("div", { class: "phead" },
        el("div", {}, el("h2", { text: `Hikâye · ${ctx.title()}` }),
          el("p", { class: "muted small", text: "Taslak: onay kapısı değil, bolum.json'u değiştirmez. Senaryo bu kartlardan Claude'la yazılır." })),
        el("button", { class: "btn icon", type: "button", "aria-label": "Kapat", text: "✕", on: { click: tryClose } })),
      closeBar(),
      diskChanged ? el("div", { class: "confirm", role: "alert" },
        el("span", { text: "hikaye.json diskte değişti (Claude düzenlemiş olabilir)." }),
        el("button", { class: "btn danger small", type: "button", text: "Değişikliklerimi at, yeniden yükle", on: { click: load } })) : null,
      story ? el("div", { class: "row stools" }, save_, state, el("span", { class: "spacer" }), suggestBtn, scriptBtn) : null,
      error && story ? el("p", { class: "err small", text: error }) : null,
      info ? el("p", { class: "ok-line small", text: info }) : null,
      body));
    renderHead();
  }

  function tryClose() {
    if (dirty()) {
      closing = true;
      render();
      return;
    }
    dialog.close();
  }
  dialog.addEventListener("cancel", (e) => {
    if (!dirty()) return;
    e.preventDefault(); // Esc with unsaved edits asks first
    tryClose();
  });

  return {
    async show() {
      if (!ctx.path()) return;
      info = "";
      closing = false;
      if (!dialog.open) dialog.showModal();
      // the copy survives closing the window (unsaved edits too) until another episode is opened
      if (loadedFor !== ctx.path() || !story) {
        story = null;
        render();
        await load();
      } else render();
    },
    /** The poll saw hikaye.json's version: follow Claude's edits. */
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
    },
    dirty,
  };
}
