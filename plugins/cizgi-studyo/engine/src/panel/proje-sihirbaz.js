// The project wizard: the person collects their wishes for an episode here, step by step, before
// Claude builds it (or to change an existing one). The wishes live in the story
// (bolumler/<id>/hikaye.json: baslik, istekler, karakterler, kartlar with mekan/saat/nesneler), so an
// episode can be "being made" before it has a bolum.json. "Oluştur" sends it to Claude (panel-yapim.mjs).
//
// Layout (a full-screen work page, not a box over the editor): the steps on the left, the form in a
// narrow column in the middle, Claude on the right. The person fills the fields; each field has a
// "Claude'a sor" button that asks Claude for suggestions about it (POST /api/kanal/iste); Claude's
// question then shows in the right column, never over the form.
import { el, confirmInPage } from "./dom.js";
import { mergeStory } from "./hikaye-birlestir.js";

const STEPS = [
  ["hikaye", "Hikâye", "Ne anlatıyoruz? Başlık ve fikir yeter; gerisini sonra netleştirirsin."],
  ["kararlar", "Temel kararlar", "Videonun biçimi: format, süre, 2B ya da 3B."],
  ["karakterler", "Karakterler", "Kütüphanede uygun çizim varsa seç; yoksa tarif et, Claude önce konsept gösterir."],
  ["sahneler", "Sahneler", "Her sahnede ne olduğu, kim olduğu ve nerede geçtiği. Çekimleri ve kamerayı Claude önerir."],
  ["ses", "Ses ve müzik", "Karakter sesleri senaryodan sonra seçilir."],
  ["ozet", "Özet", "Kontrol et ve Claude'a gönder."],
];
const TIMES = [["", "—"], ["sabah", "Sabah"], ["ogle", "Öğle"], ["aksam", "Akşam"], ["gece", "Gece"]];
const LOOKS = [["toon", "Toon (düz ışık, çizgi)"], ["yumusak", "Yumuşak gölgeli"], ["pastel", "Pastel"], ["golge", "Gölgeli, çizgisiz"]];
const NEW_PLACE = "__yeni";
const MAX_PROPS = 12;
const SUGGESTIONS = 8;
const newStory = () => ({ baslik: "", fikir: "", yas: "", istekler: {}, karakterler: [], kartlar: [] });

/**
 * @param {{api:(path:string, body?:object) => Promise<any>, note:(text:string) => void, slug:(text:string) => string,
 *          onClose?:() => void}} ctx   onClose: the wizard closed (the home page lists episodes being made again)
 */
export function createProjectWizard(ctx) {
  const dialog = el("dialog", { class: "psih", "aria-label": "Proje sihirbazı" });
  document.body.append(dialog);
  dialog.addEventListener("close", () => ctx.onClose?.());
  dialog.addEventListener("cancel", (e) => { e.preventDefault(); close(); }); // Escape saves first, like Kapat
  dialog.addEventListener("input", () => showSaved());
  dialog.addEventListener("change", () => showSaved());
  let s = null; // {id, idFixed, story, version, bolum, step, choices, error, info, tried, sel}

  const choiceList = (key) => s.choices?.[key] || [];
  const w = () => s.story.istekler;

  let thinking = false; // Claude is working on the last answer: the steps wait for it
  let listening = false; // Claude waits for "Claude'a sor" (panel_dinle)
  const slot = el("div", { class: "psih-soru" }); // Claude's question (panel_sor) shows here while the wizard is open
  const claudeState = el("p", { class: "psih-durum", role: "status" });
  const savedState = el("span", { class: "psih-kayit muted small", role: "status" });
  const stepIndex = (id) => Math.max(0, STEPS.findIndex(([key]) => key === id));
  const unsaved = () => !!s && s.savedText !== undefined && JSON.stringify(s.story) !== s.savedText;

  /** The story from disk into the wizard (Claude writes it as the person answers in the panel). */
  function take(r) {
    s.story = { ...newStory(), ...r.story, istekler: { ...(r.story.istekler || {}) } };
    s.version = r.version;
    s.bolum = r.bolum;
    s.savedText = JSON.stringify(s.story);
    s.error = r.errors?.length ? `hikaye.json'da düzeltilecekler: ${r.errors.join("; ")}` : "";
  }

  /** Open the wizard: new (no id), or on bolumler/<id>/hikaye.json, at a step (proje_adim ids). */
  async function open(id = null, step = null) {
    const same = s && dialog.open && id && s.id === id && s.idFixed;
    if (!same) {
      const res = await ctx.api("/api/bolumler").catch(() => ({}));
      s = { id: id || "", idFixed: !!id, story: newStory(), version: null, bolum: null, step: 0, choices: res.secenekler || {}, error: "", info: "", tried: false, sel: undefined };
      if (id) {
        try {
          take(await ctx.api(`/api/yapim/oku?${new URLSearchParams({ id })}`));
        } catch (err) {
          s.error = err.message;
        }
      }
    }
    if (step) s.step = stepIndex(step);
    render();
    if (!dialog.open) dialog.showModal();
    follow();
  }

  /** The person is in a field of the wizard (or of Claude's question in it): redrawing now would close a list or lose the cursor. */
  const busy = () => {
    const a = document.activeElement;
    return !!a && dialog.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName);
  };

  /**
   * While open, follow the story on disk: Claude records answers there. Each new version on disk is
   * handled once; the person's unsaved typing is never overwritten, and nothing is redrawn while
   * they are in a field (it waits until they leave it).
   */
  let followTimer = 0;
  function follow() {
    clearTimeout(followTimer);
    followTimer = setTimeout(async () => {
      if (!dialog.open || !s?.idFixed) return;
      try {
        const r = await ctx.api(`/api/yapim/oku?${new URLSearchParams({ id: s.id })}`);
        if (r.version !== s.version && !busy()) {
          if (unsaved()) {
            // both wrote: Claude's answers join the person's unsaved edits (theirs stay unsaved, over the new base)
            const mine = s.story;
            const before = JSON.parse(s.savedText); // what both edits started from
            take(r); // the new base: what is on disk now
            s.story = { ...newStory(), ...mergeStory(before, mine, s.story) };
            s.info = "Claude da yazdı: ikinizinki de korundu.";
          } else {
            take(r);
            s.info = "Claude güncelledi.";
          }
          render();
        }
      } catch {
        /* the server is busy or the file is being written: look again */
      }
      follow();
    }, 1500);
  }

  /** Write the story; the first save of a new episode claims its id. */
  async function save() {
    s.error = "";
    if (!s.idFixed) {
      if (!s.id) s.id = ctx.slug(s.story.baslik || "");
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.id)) throw new Error("Önce bir başlık yaz: klasör adı ondan çıkar (ya da kimliği küçük harf, rakam ve tireyle yaz).");
      const r = await ctx.api(`/api/yapim/oku?${new URLSearchParams({ id: s.id })}`);
      if (r.exists || r.bolum) throw new Error(`“${s.id}” kimliği kullanılıyor: başlığı ya da kimliği değiştir.`);
      s.version = r.version;
    }
    let res;
    try {
      res = await ctx.api("/api/yapim", { id: s.id, story: s.story, version: s.version });
    } catch (err) {
      if (!s.idFixed || !/diskte değişti/.test(err.message)) throw err;
      // Claude wrote meanwhile: merge its version with the person's edit and save that
      const r = await ctx.api(`/api/yapim/oku?${new URLSearchParams({ id: s.id })}`);
      const mine = s.story;
      const before = s.savedText ? JSON.parse(s.savedText) : newStory();
      take(r);
      s.story = { ...newStory(), ...mergeStory(before, mine, s.story) };
      res = await ctx.api("/api/yapim", { id: s.id, story: s.story, version: s.version });
    }
    s.version = res.version;
    s.savedText = JSON.stringify(s.story);
    if (!s.idFixed) {
      s.idFixed = true;
      follow();
    }
  }

  async function go(step) {
    try {
      if (unsaved() || !s.idFixed) await save();
      s.step = step;
    } catch (err) {
      s.error = err.message;
    }
    render();
    dialog.querySelector(".psih-form")?.scrollTo({ top: 0 });
  }

  async function close() {
    if (s && unsaved() && s.idFixed) {
      try {
        await save();
      } catch (err) {
        s.error = `Kapatmadan önce kaydedilemedi: ${err.message}`;
        render();
        return;
      }
    }
    dialog.close();
  }

  /** What is still missing before Claude can build, with the step and field to fix it in. */
  function missing() {
    const st = s.story;
    return [
      !st.baslik?.trim() && ["hikaye", "baslik", "Başlık yaz."],
      !st.fikir?.trim() && ["hikaye", "fikir", "Fikri bir iki cümleyle yaz ya da Claude'a sor."],
      !w().format && ["kararlar", "istekler.format", "Format seç."],
      !w().boyut && ["kararlar", "istekler.boyut", "2B ya da 3B seç."],
      !st.karakterler.length && ["karakterler", "karakterler", "En az bir karakter ekle."],
      !st.kartlar.length && ["sahneler", "kartlar", "En az bir sahne ekle."],
    ].filter(Boolean);
  }
  const errorOf = (alan) => (s.tried ? missing().find(([, a]) => a === alan)?.[2] : undefined);
  const stepDone = (key) => {
    const st = s.story;
    if (key === "hikaye") return !!(st.baslik?.trim() && st.fikir?.trim());
    if (key === "kararlar") return !!(w().format && w().boyut);
    if (key === "karakterler") return st.karakterler.length > 0;
    if (key === "sahneler") return st.kartlar.length > 0;
    if (key === "ses") return w().muzik !== undefined && w().altyazi !== undefined;
    return false;
  };

  async function build() {
    const left = missing();
    if (left.length) {
      // the button stays clickable: it shows what is missing, at the first place to fix it
      s.tried = true;
      s.step = stepIndex(left[0][0]);
      render();
      requestAnimationFrame(() => dialog.querySelector(`[data-alan="${left[0][1]}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
      return;
    }
    try {
      await save();
      await ctx.api("/api/yapim/olustur", { id: s.id });
      dialog.close();
      ctx.note(s.bolum ? "İstekler Claude'a gitti: bölümü güncelliyor." : "İstekler Claude'a gitti: bölümü oluşturuyor, adımları panelde göreceksin.");
    } catch (err) {
      s.error = err.message;
      render();
    }
  }

  /** "Claude'a sor": save what is typed (Claude reads the file), then hand the field to Claude. */
  async function ask(alan, etiket) {
    try {
      if (unsaved() || !s.idFixed) await save();
      const r = await ctx.api("/api/kanal/iste", { proje: s.id, adim: STEPS[s.step][0], ...(alan ? { alan } : {}), ...(etiket ? { etiket } : {}) });
      s.asked = alan || STEPS[s.step][0];
      s.info = r.dinliyor ? "" : "Claude şu an başka bir işte: sorun sıraya girdi, işi bitince sorar. Beklemeden kendin de doldurabilirsin.";
    } catch (err) {
      s.error = err.message;
    }
    render();
  }

  /* ---------- small form helpers (every change goes straight into the story) ---------- */
  const askButton = (alan, etiket, text = "Claude'a sor") => el("button", {
    class: `btn small ghost psih-sor${s.asked === alan ? " soruldu" : ""}`, type: "button", disabled: thinking,
    title: `${etiket} için Claude'dan öneri iste`, on: { click: () => ask(alan, etiket) },
  }, el("span", { class: "yildiz", "aria-hidden": "true", text: "✦" }), text);

  /** A field: label above the control, its "Claude'a sor" on the label's line, a hint or the error under it. */
  function field(label, input, { alan, hint, optional, ask: canAsk = true } = {}) {
    const error = alan ? errorOf(alan) : undefined;
    return el("div", { class: `pfield${error ? " hatali" : ""}`, "data-alan": alan },
      el("div", { class: "pfield-ust" },
        el("span", { class: "pfield-ad", text: label }, optional ? el("span", { class: "muted", text: " (isteğe bağlı)" }) : null),
        alan && canAsk ? askButton(alan, label) : null),
      input,
      error ? el("p", { class: "pfield-hata", role: "alert", text: error }) : hint ? el("p", { class: "pfield-ipucu", text: hint }) : null);
  }
  const textIn = (value, set, attrs = {}) => {
    const i = el(attrs.rows ? "textarea" : "input", { type: attrs.rows ? null : "text", ...attrs });
    i.value = value ?? "";
    i.addEventListener("input", () => set(i.value));
    i.addEventListener("keydown", (e) => e.stopPropagation()); // the editor's keys stay out
    return i;
  };
  const numberIn = (value, set, attrs) => {
    const i = el("input", { type: "number", inputmode: "numeric", ...attrs });
    i.value = value ?? "";
    i.addEventListener("input", () => set(i.value === "" ? undefined : Number(i.value)));
    i.addEventListener("keydown", (e) => e.stopPropagation());
    return i;
  };
  const select = (value, options, set, label) => {
    const sel = el("select", { "aria-label": label }, options.map(([v, t]) => el("option", { value: v, text: t })));
    sel.value = value ?? "";
    sel.addEventListener("change", () => set(sel.value));
    return sel;
  };
  /** Choices as segmented buttons: every option visible, one click. */
  const segments = (value, options, set, label) => el("div", { class: "psegment", role: "radiogroup", "aria-label": label }, options.map(([v, t, sub]) => el("button", {
    type: "button", role: "radio", "aria-checked": String(value === v), class: value === v ? "secili" : "",
    on: { click: () => { set(value === v ? undefined : v); render(); } },
  }, el("span", { text: t }), sub ? el("small", { text: sub }) : null)));
  const setWish = (k, v) => {
    if (v === undefined || v === "") delete w()[k];
    else w()[k] = v;
  };

  /* ---------- the steps ---------- */
  let idBox = null; // the id field, filled from the title until the first save
  function stepStory() {
    return [
      field("Başlık", textIn(s.story.baslik, (v) => { s.story.baslik = v; if (!s.idFixed) { s.id = ctx.slug(v); idBox.value = s.id; } }, { maxlength: "120", placeholder: "Örnek: Sokaktan kurtuluş" }), { alan: "baslik" }),
      field("Fikir", textIn(s.story.fikir, (v) => { s.story.fikir = v; }, { rows: 4, maxlength: "1000", placeholder: "Kim? Sorunu ne? Ne değişiyor? Nasıl bitiyor?" }), { alan: "fikir", hint: "Birkaç cümle yeter. Emin değilsen Claude'a sor: yön önerir." }),
      field("İzleyici", textIn(s.story.yas, (v) => { s.story.yas = v; }, { maxlength: "80", placeholder: "Örnek: genel, 4-6 yaş, yetişkin" }), { alan: "yas", optional: true }),
      el("details", { class: "pek" },
        el("summary", { text: "Klasör adı" }),
        field("Kimlik", idBox = textIn(s.id, (v) => { s.id = v.trim(); }, { maxlength: "60", disabled: s.idFixed, placeholder: "sokaktan-kurtulus" }), { hint: s.idFixed ? `bolumler/${s.id}/ (değişmez)` : "Başlıktan çıkar; istersen değiştir." })),
    ];
  }

  function stepDecisions() {
    return [
      field("Format", segments(w().format, [["9:16", "Dikey 9:16", "Reels, Shorts"], ["16:9", "Yatay 16:9", "YouTube"]], (v) => setWish("format", v), "Format"), { alan: "istekler.format" }),
      field("Süre (saniye)", numberIn(w().sure, (v) => setWish("sure", v), { min: "5", max: "600", step: "5", placeholder: "60" }), { alan: "istekler.sure", optional: true, hint: "Boş kalırsa sahnelere göre Claude belirler." }),
      field("Boyut", segments(w().boyut, [["2b", "2B", "çizgi film"], ["3b", "3B", "yalnız 3B tarifi olanlarla"]], (v) => { setWish("boyut", v); if (v !== "3b") setWish("stil3d"); }, "Boyut"), { alan: "istekler.boyut" }),
      w().boyut === "3b" ? field("3B görünüm", select(w().stil3d, [["", "Seç…"], ...LOOKS], (v) => setWish("stil3d", v), "3B görünüm"), { alan: "istekler.stil3d" }) : null,
    ];
  }

  function stepCharacters() {
    const rigs = [["", "Yeni çizilecek"], ...choiceList("rigs").map((r) => [r.id, r.label])];
    const rows = s.story.karakterler.map((c, i) => el("div", { class: "pitem" },
      el("div", { class: "pitem-ust" },
        el("b", { text: c.ad || `Karakter ${i + 1}` }),
        el("button", { class: "btn small ghost danger", type: "button", text: "Sil", on: { click: async () => {
          if (!(await confirmInPage(`“${c.ad || `Karakter ${i + 1}`}” karakteri silinsin mi?`, { detail: "Sahnelerden de çıkar.", yes: "Karakteri sil" }))) return;
          removeCharacter(c.ad); s.story.karakterler.splice(i, 1); render();
        } } })),
      el("div", { class: "pikili" },
        field("Ad", textIn(c.ad, (v) => { renameCharacter(c.ad, v); c.ad = v; }, { maxlength: "80" }), { alan: `karakterler.${i}.ad`, ask: false }),
        field("Çizim", select(c.rig, rigs, (v) => { if (v) c.rig = v; else delete c.rig; render(); }, "Çizim"), { alan: `karakterler.${i}.rig` })),
      field("Tarif", textIn(c.not, (v) => { c.not = v; }, { rows: 2, maxlength: "1000", placeholder: "Yaş, görünüş, kıyafet, kişilik" }), {
        alan: `karakterler.${i}.not`, optional: !!c.rig, hint: c.rig ? "Kütüphane çiziminden farklı bir şey istiyorsan yaz." : "Yeni çizilecek: ne kadar ayrıntılı, o kadar iyi.",
      })));
    return [
      ...(rows.length ? rows : [el("div", { class: "pbos", "data-alan": "karakterler" },
        el("p", { text: "Henüz karakter yok." }),
        errorOf("karakterler") ? el("p", { class: "pfield-hata", role: "alert", text: errorOf("karakterler") }) : null)]),
      el("div", { class: "row pekle" },
        el("button", { class: "btn", type: "button", disabled: s.story.karakterler.length >= 20, text: "+ Karakter ekle", on: { click: () => { s.story.karakterler.push({ ad: `Karakter ${s.story.karakterler.length + 1}` }); render(); } } }),
        askButton("karakterler", "Karakterler", "Claude karakter önersin")),
    ];
  }
  function renameCharacter(from, to) {
    for (const k of s.story.kartlar) if (k.kim) k.kim = k.kim.map((n) => (n === from ? to : n));
  }
  function removeCharacter(name) {
    for (const k of s.story.kartlar) if (k.kim) k.kim = k.kim.filter((n) => n !== name);
  }

  /** The scene's props as chips: library props suggested as you type, any other word is drawn new. */
  function propsPicker(k) {
    const chosen = k.nesneler || [];
    const set = (list) => { if (list.length) k.nesneler = list.slice(0, MAX_PROPS); else delete k.nesneler; };
    const input = el("input", { type: "text", maxlength: "60", placeholder: chosen.length >= MAX_PROPS ? "En çok 12 nesne" : "Nesne yaz ya da aşağıdan seç", "aria-label": "Nesne ekle", "data-odak": `nesne-${k.id}`, disabled: chosen.length >= MAX_PROPS });
    const add = (word) => {
      const v = word.trim();
      if (!v || chosen.includes(v)) return;
      set([...chosen, v]);
      render();
      requestAnimationFrame(() => dialog.querySelector(`[data-odak="nesne-${k.id}"]`)?.focus());
    };
    const library = choiceList("props");
    const suggest = el("div", { class: "poneri" });
    const fill = () => {
      const q = input.value.trim().toLocaleLowerCase("tr");
      const hits = library.filter((p) => !chosen.includes(p.id) && (!q || p.id.includes(q) || (p.label || "").toLocaleLowerCase("tr").includes(q))).slice(0, SUGGESTIONS);
      suggest.replaceChildren(...hits.map((p) => el("button", { class: "pcip-oneri", type: "button", text: `+ ${p.label || p.id}`, on: { click: () => add(p.id) } })));
    };
    input.addEventListener("input", fill);
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(input.value); }
      else if (e.key === "Backspace" && !input.value && chosen.length) { set(chosen.slice(0, -1)); render(); requestAnimationFrame(() => dialog.querySelector(`[data-odak="nesne-${k.id}"]`)?.focus()); }
    });
    fill();
    const isLib = (id) => library.some((p) => p.id === id);
    return el("div", { class: "pnesne" },
      el("div", { class: "pcipler" },
        chosen.map((n) => el("span", { class: `pcip${isLib(n) ? "" : " yeni"}`, title: isLib(n) ? "Kütüphanede var" : "Kütüphanede yok: çizilecek" },
          n, isLib(n) ? null : el("small", { text: " · çizilecek" }),
          el("button", { type: "button", "aria-label": `${n} çıkar`, text: "×", on: { click: () => { set(chosen.filter((x) => x !== n)); render(); } } }))),
        input),
      suggest);
  }

  /**
   * Scenes: tiles on top (one per scene: number, title, place, time, who), and below them, in its
   * own section, the one scene picked. A list of open forms one under another was hard to follow.
   */
  function stepScenes() {
    const list = s.story.kartlar;
    const places = [["", "Seç…"], ...choiceList("backgrounds").map((b) => [b.id, b.label || b.id]), [NEW_PLACE, "Yeni mekân çizilecek…"]];
    const isLib = (m) => choiceList("backgrounds").some((b) => b.id === m);
    const placeName = (m) => choiceList("backgrounds").find((b) => b.id === m)?.label || m;
    const timeName = (t) => TIMES.find(([v]) => v === t)?.[1];
    if (!list.some((k) => k.id === s.sel)) s.sel = list[0]?.id;
    const tiles = el("div", { class: "pkaro-liste", role: "listbox", "aria-label": "Sahneler" },
      list.map((k, i) => el("button", {
        type: "button", role: "option", "aria-selected": String(k.id === s.sel), class: `pkaro${k.id === s.sel ? " secili" : ""}`,
        on: { click: () => { s.sel = k.id; render(); } },
      },
      el("span", { class: "pkaro-ust" }, el("span", { class: "pkart-no", text: String(i + 1) }), el("b", { text: k.baslik || "Başlıksız" })),
      el("span", { class: "pkaro-satir", text: [k.mekan ? placeName(k.mekan) : "mekân yok", timeName(k.saat)].filter(Boolean).join(" · ") }),
      el("span", { class: "pkaro-satir muted", text: k.kim?.length ? k.kim.join(", ") : "kimse seçilmedi" }))),
      el("button", { type: "button", class: "pkaro pkaro-ekle", disabled: list.length >= 40, on: { click: addCard } }, el("span", { text: "+ Sahne ekle" })));
    const i = list.findIndex((k) => k.id === s.sel);
    return [
      list.length ? tiles : el("div", { class: "pbos", "data-alan": "kartlar" },
        el("p", { text: "Henüz sahne yok. Kendin ekle ya da Claude'a önerdir." }),
        errorOf("kartlar") ? el("p", { class: "pfield-hata", role: "alert", text: errorOf("kartlar") }) : null,
        el("button", { class: "btn", type: "button", text: "+ Sahne ekle", on: { click: addCard } })),
      el("div", { class: "row pekle" }, askButton("kartlar", "Sahneler", "Claude sahne önersin")),
      i >= 0 ? sceneEditor(list[i], i, { places, isLib }) : null,
    ];
  }

  /** The picked scene, in its own section under the tiles. */
  function sceneEditor(k, i, { places, isLib }) {
    const list = s.story.kartlar;
    const custom = k.mekan !== undefined && !isLib(k.mekan);
    const placeText = textIn(custom ? k.mekan : "", (v) => { k.mekan = v; }, { maxlength: "200", placeholder: "Yeni mekânı tarif et: ör. yağmurlu eski bir ara sokak" });
    placeText.hidden = !custom;
    return el("section", { class: "pitem psahne", "aria-label": `Sahne ${i + 1}` },
      el("div", { class: "pitem-ust" },
        el("h4", { text: `Sahne ${i + 1}${k.baslik ? `: ${k.baslik}` : ""}` }),
        el("span", { class: "pkart-arac" },
          el("button", { class: "btn small ghost", type: "button", disabled: i === 0, text: "← Öne al", on: { click: () => move(i, -1) } }),
          el("button", { class: "btn small ghost", type: "button", disabled: i === list.length - 1, text: "Sona al →", on: { click: () => move(i, 1) } }),
          el("button", { class: "btn small ghost danger", type: "button", text: "Sil", on: { click: async () => {
            if (!(await confirmInPage(`Sahne ${i + 1} (“${k.baslik || "başlıksız"}”) silinsin mi?`, { yes: "Sahneyi sil" }))) return;
            list.splice(i, 1);
            s.sel = list[Math.min(i, list.length - 1)]?.id;
            render();
          } } }))),
      field("Başlık", textIn(k.baslik, (v) => { k.baslik = v; }, { maxlength: "80", placeholder: "Örnek: Soğuk gece" }), { alan: `kartlar.${k.id}.baslik`, ask: false }),
      field("Ne olur", textIn(k.olay, (v) => { k.olay = v; }, { rows: 3, maxlength: "1000", placeholder: "Bu sahnede ne oluyor? Kim ne yapıyor, ne söylüyor?" }), { alan: `kartlar.${k.id}.olay` }),
      field("Kim var", s.story.karakterler.length
        ? el("div", { class: "psegment coklu" }, s.story.karakterler.map((c) => {
          const on = (k.kim || []).includes(c.ad);
          return el("button", { type: "button", role: "checkbox", "aria-checked": String(on), class: on ? "secili" : "", text: c.ad, on: { click: () => {
            const who = new Set(k.kim || []);
            if (on) who.delete(c.ad); else who.add(c.ad);
            k.kim = [...who];
            render();
          } } });
        }))
        : el("p", { class: "muted small", text: "Önce Karakterler adımında karakter ekle." }), { alan: `kartlar.${k.id}.kim`, ask: false }),
      el("div", { class: "pikili" },
        field("Mekân", el("div", { class: "pyigin" }, select(custom ? NEW_PLACE : k.mekan, places, (v) => {
          placeText.hidden = v !== NEW_PLACE;
          if (v === NEW_PLACE) k.mekan = placeText.value;
          else if (v) k.mekan = v;
          else delete k.mekan;
          render(); // the tile above shows the place
        }, "Mekân"), placeText), { alan: `kartlar.${k.id}.mekan` }),
        field("Saat", select(k.saat, TIMES, (v) => { if (v) k.saat = v; else delete k.saat; render(); }, "Saat"), { alan: `kartlar.${k.id}.saat`, ask: false, optional: true })),
      field("Nesneler", propsPicker(k), { alan: `kartlar.${k.id}.nesneler`, optional: true, hint: "Kütüphanede olmayan bir nesneyi yazarsan yeni çizilir." }),
      field("Süre (saniye)", numberIn(k.sure, (v) => { if (v === undefined) delete k.sure; else k.sure = v; }, { min: "1", max: "120", placeholder: "10" }), { alan: `kartlar.${k.id}.sure`, ask: false, optional: true }));
  }
  function addCard() {
    const taken = new Set(s.story.kartlar.map((k) => k.id));
    let n = s.story.kartlar.length + 1;
    while (taken.has(`k${n}`)) n++;
    s.story.kartlar.push({ id: `k${n}`, baslik: "", olay: "" });
    s.sel = `k${n}`; // the new scene is the one shown
    render();
  }
  function move(i, by) {
    const list = s.story.kartlar;
    [list[i], list[i + by]] = [list[i + by], list[i]];
    render();
  }

  function stepSound() {
    return [
      field("Müzik", select(w().muzik, [["", "Seç…"], ["yok", "Müzik yok"], ...choiceList("muzik").map((m) => [m.id, m.label])], (v) => setWish("muzik", v), "Müzik"), { alan: "istekler.muzik", hint: "Parçaları paneldeki Müzik bölümünde dinleyebilirsin." }),
      field("Ses efektleri", segments(w().efekt === undefined ? undefined : String(w().efekt), [["true", "Olsun", "kütüphaneden"], ["false", "Olmasın"]], (v) => setWish("efekt", v === undefined ? undefined : v === "true"), "Ses efektleri"), { alan: "istekler.efekt" }),
      field("Altyazı", segments(w().altyazi, [["var", "Açık"], ["renkli", "Renkli", "konuşana göre"], ["yok", "Kapalı"]], (v) => setWish("altyazi", v), "Altyazı"), { alan: "istekler.altyazi" }),
    ];
  }

  function stepSummary() {
    const st = s.story;
    const left = missing();
    const line = (k, v, step) => el("div", { class: "pozet" },
      el("span", { class: "muted", text: k }),
      el("span", { text: v || "—" }),
      el("button", { class: "btn small ghost", type: "button", text: "Düzenle", disabled: thinking, on: { click: () => go(stepIndex(step)) } }));
    return [
      line("Başlık", st.baslik, "hikaye"), line("Fikir", st.fikir, "hikaye"), line("İzleyici", st.yas, "hikaye"),
      line("Format / süre", [w().format, w().sure ? `${w().sure} sn` : ""].filter(Boolean).join(" · "), "kararlar"),
      line("Boyut", w().boyut ? `${w().boyut.toUpperCase()}${w().stil3d ? ` (${w().stil3d})` : ""}` : "", "kararlar"),
      line("Karakterler", st.karakterler.map((c) => `${c.ad}${c.rig ? "" : " (çizilecek)"}`).join(", "), "karakterler"),
      line("Sahneler", st.kartlar.map((k, i) => `${i + 1}. ${k.baslik || k.olay || "?"}${k.mekan ? ` · ${k.mekan}` : ""}${k.saat ? ` · ${k.saat}` : ""}`).join("\n"), "sahneler"),
      line("Müzik / efekt / altyazı", [w().muzik, w().efekt === undefined ? "" : w().efekt ? "efekt var" : "efekt yok", w().altyazi ? `altyazı ${w().altyazi}` : ""].filter(Boolean).join(" · "), "ses"),
      left.length
        ? el("p", { class: "pfield-ipucu", text: `Oluşturmadan önce: ${left.map(([, , t]) => t).join(" ")}` })
        : el("p", { class: "ok-line", text: s.bolum ? "Hazır: Claude değişen istekleri bölüme uygular." : "Hazır: Claude bölümü bu isteklere göre kurar, adımları panelde görürsün." }),
    ];
  }

  /* ---------- the page ---------- */
  function showSaved() {
    if (!s) return;
    savedState.textContent = !s.idFixed ? "Henüz kaydedilmedi" : unsaved() ? "Kaydedilmemiş değişiklik" : "Kaydedildi ✓";
  }
  function showClaude() {
    const asking = !!slot.querySelector(".kanal-soru:not([hidden])");
    claudeState.replaceChildren(...(thinking
      ? [el("span", { class: "cark", "aria-hidden": "true" }), "Claude düşünüyor…"]
      : asking ? [el("span", { class: "nokta acik", "aria-hidden": "true" }), "Claude cevabını bekliyor."]
      : listening ? [el("span", { class: "nokta acik", "aria-hidden": "true" }), "Claude dinliyor: bir alanda “Claude'a sor”a bas."]
        : [el("span", { class: "nokta", "aria-hidden": "true" }), "Claude şu an başka bir işte. Sorarsan sıraya girer."]));
    claudeState.classList.toggle("dusunuyor", thinking);
  }

  function render() {
    if (!s) return;
    const [key, title, about] = STEPS[s.step];
    const body = [stepStory, stepDecisions, stepCharacters, stepScenes, stepSound, stepSummary][s.step]();
    const last = s.step === STEPS.length - 1;
    showSaved();
    showClaude();
    dialog.replaceChildren(
      el("header", { class: "psih-bas" },
        el("div", { class: "psih-baslik" },
          el("h2", { text: s.bolum ? `Bölümü düzenle: ${s.story.baslik || s.id}` : s.story.baslik ? s.story.baslik : "Yeni bölüm" }),
          savedState),
        el("button", { class: "btn", type: "button", text: "Kapat", on: { click: close } })),
      el("div", { class: "psih-alan" },
        el("nav", { class: "psih-adimlar", "aria-label": "Adımlar" }, el("ol", {}, STEPS.map(([k, t], i) => el("li", {}, el("button", {
          type: "button", class: `${i === s.step ? "simdi" : ""}${stepDone(k) ? " tamam" : ""}`, "aria-current": i === s.step ? "step" : null,
          disabled: thinking, on: { click: () => go(i) },
        }, el("span", { class: "padim-no", "aria-hidden": "true", text: stepDone(k) && i !== s.step ? "✓" : String(i + 1) }), el("span", { text: t })))))),
        el("main", { class: "psih-form" },
          el("div", { class: "psih-sutun" },
            el("h3", { text: title }),
            el("p", { class: "psih-aciklama", text: about }),
            s.error ? el("p", { class: "pfield-hata", role: "alert", text: s.error }) : null,
            s.info && !s.error ? el("p", { class: "psih-bilgi", role: "status", text: s.info }) : null,
            el("div", { class: "pgovde", "data-adim": key }, body)),
          el("footer", { class: "psih-alt" },
            el("div", { class: "psih-sutun row" },
              el("button", { class: "btn", type: "button", disabled: s.step === 0 || thinking, text: "← Geri", on: { click: () => go(s.step - 1) } }),
              el("span", { class: "bosluk" }),
              last
                ? el("button", { class: "btn primary", type: "button", disabled: thinking, text: s.bolum ? "Değişiklikleri Claude'a gönder" : "Oluştur: Claude'a gönder", on: { click: build } })
                : el("button", { class: "btn primary", type: "button", disabled: thinking, text: `İleri: ${STEPS[s.step + 1][1]} →`, on: { click: () => go(s.step + 1) } })))),
        el("aside", { class: "psih-claude", "aria-label": "Claude" },
          el("h3", { text: "Claude" }),
          claudeState,
          slot, // Claude's question shows here, beside the form, never over it
          el("div", { class: "psih-claude-bos" },
            el("p", { class: "muted small", text: "Alanları kendin doldur. Takıldığın yerde alanın yanındaki “✦ Claude'a sor”a bas: Claude seçenekler sunar, seçtiğini alana yazar." }),
            key !== "ozet" ? askButton(key, `${title} adımı`, "Bu adımı Claude'la doldur") : null))));
    s.info = "";
  }

  return {
    open,
    /** Where Claude's question goes while the wizard is open (it is a modal: nothing behind it can be clicked). */
    slot: () => (dialog.open ? slot : null),
    /** Claude is (no longer) working on an answer, or listening for "Claude'a sor": lock or free the steps. */
    setThinking(on, isListening = listening) {
      const changed = on !== thinking;
      thinking = on;
      listening = isListening;
      if (!s || !dialog.open) return;
      if (changed && !on) s.asked = undefined; // Claude has answered (or given up): the field is no longer "asked"
      if (changed && !busy()) render();
      else showClaude();
    },
  };
}
