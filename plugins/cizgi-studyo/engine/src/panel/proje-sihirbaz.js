// The project wizard: the person collects their wishes for an episode here, step by step, before
// Claude builds it (or to change an existing one). The wishes live in the story
// (bolumler/<id>/hikaye.json: baslik, istekler, karakterler, kartlar with mekan/saat/nesneler), so an
// episode can be "being made" before it has a bolum.json. "Oluştur" sends it to Claude (panel-yapim.mjs).
import { el } from "./dom.js";

const STEPS = [
  ["hikaye", "Hikâye"],
  ["kararlar", "Temel kararlar"],
  ["karakterler", "Karakterler"],
  ["sahneler", "Sahneler"],
  ["ses", "Ses ve müzik"],
  ["ozet", "Özet"],
];
const TIMES = [["", "—"], ["sabah", "Sabah"], ["ogle", "Öğle"], ["aksam", "Akşam"], ["gece", "Gece"]];
const LOOKS = [["toon", "Toon (düz ışık, çizgi)"], ["yumusak", "Yumuşak gölgeli"], ["pastel", "Pastel"], ["golge", "Gölgeli, çizgisiz"]];
const NEW_PLACE = "__yeni";
const newStory = () => ({ baslik: "", fikir: "", yas: "", istekler: {}, karakterler: [], kartlar: [] });

/**
 * @param {{api:(path:string, body?:object) => Promise<any>, note:(text:string) => void, slug:(text:string) => string,
 *          onClose?:() => void}} ctx   onClose: the wizard closed (the home page lists episodes being made again)
 */
export function createProjectWizard(ctx) {
  const dialog = el("dialog", { class: "projects psih", "aria-label": "Proje sihirbazı" });
  document.body.append(dialog);
  dialog.addEventListener("close", () => ctx.onClose?.());
  let s = null; // {id, idFixed, story, version, bolum, step, choices, error, info}

  const choiceList = (key) => s.choices?.[key] || [];
  const w = () => s.story.istekler;

  async function open(id = null) {
    const res = await ctx.api("/api/bolumler").catch(() => ({}));
    s = { id: id || "", idFixed: !!id, story: newStory(), version: null, bolum: null, step: 0, choices: res.secenekler || {}, error: "", info: "" };
    if (id) {
      try {
        const r = await ctx.api(`/api/yapim/oku?${new URLSearchParams({ id })}`);
        s.story = { ...newStory(), ...r.story, istekler: { ...(r.story.istekler || {}) } };
        s.version = r.version;
        s.bolum = r.bolum;
        if (r.errors?.length) s.error = `hikaye.json'da düzeltilecekler: ${r.errors.join("; ")}`;
      } catch (err) {
        s.error = err.message;
      }
    }
    render();
    if (!dialog.open) dialog.showModal();
  }

  /** Write the story; the first save of a new episode claims its id. */
  async function save() {
    s.error = "";
    if (!s.idFixed) {
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.id)) throw new Error("Kimlik yalnızca küçük harf, rakam ve tire olabilir (örnek: park-gunu).");
      const r = await ctx.api(`/api/yapim/oku?${new URLSearchParams({ id: s.id })}`);
      if (r.exists || r.bolum) throw new Error(`“${s.id}” kimliği kullanılıyor: başka bir kimlik seç.`);
      s.version = r.version;
    }
    const res = await ctx.api("/api/yapim", { id: s.id, story: s.story, version: s.version });
    s.version = res.version;
    s.idFixed = true;
  }

  async function go(step) {
    try {
      if (s.step === 0 && !s.idFixed && !s.id) s.id = ctx.slug(s.story.baslik || "");
      await save();
      s.step = step;
      s.info = "Kaydedildi.";
    } catch (err) {
      s.error = err.message;
    }
    render();
  }

  async function build() {
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

  /* ---------- small form helpers (every change goes straight into the story) ---------- */
  const field = (label, input, hint) => el("label", { class: "field" }, el("span", { text: label }), hint ? el("div", {}, input, el("span", { class: "muted small", text: hint })) : input);
  const textIn = (value, set, attrs = {}) => {
    const i = el(attrs.rows ? "textarea" : "input", { type: attrs.rows ? null : "text", ...attrs });
    i.value = value ?? "";
    i.addEventListener("input", () => set(i.value));
    i.addEventListener("keydown", (e) => e.stopPropagation()); // the editor's keys stay out
    return i;
  };
  const select = (value, options, set, label) => {
    const sel = el("select", { "aria-label": label }, options.map(([v, t]) => el("option", { value: v, text: t })));
    sel.value = value ?? "";
    sel.addEventListener("change", () => set(sel.value));
    return sel;
  };
  const radios = (name, value, options, set) => el("div", { class: "psecim", role: "radiogroup" }, options.map(([v, t]) => {
    const r = el("input", { type: "radio", name, value: v, checked: value === v });
    r.addEventListener("change", () => { set(v); render(); });
    return el("label", { class: "pradio" }, r, el("span", { text: t }));
  }));
  const setWish = (k, v) => {
    if (v === undefined || v === "") delete w()[k];
    else w()[k] = v;
  };

  /* ---------- the steps ---------- */
  let idBox = null; // the id field, filled from the title until the first save
  function stepStory() {
    return [
      field("Başlık", textIn(s.story.baslik, (v) => { s.story.baslik = v; if (!s.idFixed) { s.id = ctx.slug(v); idBox.value = s.id; } }, { maxlength: "120", placeholder: "Örnek: Sokaktan kurtuluş" })),
      field("Kimlik", idBox = textIn(s.id, (v) => { s.id = v.trim(); }, { maxlength: "60", disabled: s.idFixed, placeholder: "sokaktan-kurtulus" }), "Klasör adı: bolumler/<kimlik>/"),
      field("Fikir", textIn(s.story.fikir, (v) => { s.story.fikir = v; }, { rows: 4, maxlength: "1000", placeholder: "Kim? Sorunu ne? Ne değişiyor? Nasıl bitiyor?" })),
      field("İzleyici", textIn(s.story.yas, (v) => { s.story.yas = v; }, { maxlength: "80", placeholder: "Örnek: genel, 4-6 yaş" })),
    ];
  }

  function stepDecisions() {
    return [
      field("Format", radios("pfmt", w().format, [["9:16", "Dikey 9:16 (Reels)"], ["16:9", "Yatay 16:9"]], (v) => setWish("format", v))),
      field("Süre (sn)", (() => {
        const i = el("input", { type: "number", min: "5", max: "600", step: "5", placeholder: "40" });
        i.value = w().sure ?? "";
        i.addEventListener("input", () => setWish("sure", i.value === "" ? undefined : Number(i.value)));
        return i;
      })()),
      field("Boyut", radios("pboy", w().boyut, [["2b", "2B"], ["3b", "3B (yalnız 3B tarifi olan karakter ve mekânlarla)"]], (v) => { setWish("boyut", v); if (v !== "3b") setWish("stil3d"); })),
      w().boyut === "3b" ? field("3B görünüm", select(w().stil3d, [["", "Seç…"], ...LOOKS], (v) => setWish("stil3d", v), "3B görünüm")) : null,
    ];
  }

  function stepCharacters() {
    const rigs = [["", "— yeni çizilecek —"], ...choiceList("rigs").map((r) => [r.id, `${r.label} (${r.id})`])];
    const rows = s.story.karakterler.map((c, i) => el("div", { class: "psatir" },
      field("Ad", textIn(c.ad, (v) => { renameCharacter(c.ad, v); c.ad = v; }, { maxlength: "80" })),
      field("Çizim", select(c.rig, rigs, (v) => { if (v) c.rig = v; else delete c.rig; }, "Çizim")),
      field("Tarif", textIn(c.not, (v) => { c.not = v; }, { rows: 2, maxlength: "1000", placeholder: "Yaş, görünüş, kıyafet, kişilik; yeni çizilecekse ayrıntılı yaz" })),
      el("button", { class: "btn small danger", type: "button", text: "Sil", on: { click: () => { removeCharacter(c.ad); s.story.karakterler.splice(i, 1); render(); } } })));
    return [
      el("p", { class: "muted", text: "Karakterleri sen belirle. Kütüphanede uygun çizim varsa seç; yoksa “yeni çizilecek” bırak ve tarif et, Claude önce konsept gösterir." }),
      ...rows,
      el("button", { class: "btn small", type: "button", disabled: s.story.karakterler.length >= 20, text: "+ Karakter", on: { click: () => { s.story.karakterler.push({ ad: `Karakter ${s.story.karakterler.length + 1}` }); render(); } } }),
    ];
  }
  function renameCharacter(from, to) {
    for (const k of s.story.kartlar) if (k.kim) k.kim = k.kim.map((n) => (n === from ? to : n));
  }
  function removeCharacter(name) {
    for (const k of s.story.kartlar) if (k.kim) k.kim = k.kim.filter((n) => n !== name);
  }

  function stepScenes() {
    const places = [["", "Seç…"], ...choiceList("backgrounds").map((b) => [b.id, b.label === b.id ? b.id : `${b.label} (${b.id})`]), [NEW_PLACE, "— yeni mekân çizilecek —"]];
    const isLib = (m) => choiceList("backgrounds").some((b) => b.id === m);
    const propsList = el("datalist", { id: "psih-nesneler" }, choiceList("props").map((p) => el("option", { value: p.id })));
    const cards = s.story.kartlar.map((k, i) => {
      const custom = k.mekan && !isLib(k.mekan);
      const placeText = textIn(custom ? k.mekan : "", (v) => { k.mekan = v; }, { maxlength: "200", placeholder: "Yeni mekânı tarif et: ör. yağmurlu eski İstanbul ara sokağı" });
      placeText.hidden = !custom;
      return el("div", { class: "psatir pkart" },
        el("div", { class: "pkart-ust" },
          el("b", { text: `Sahne ${i + 1}` }),
          el("button", { class: "btn small", type: "button", disabled: i === 0, text: "↑", "aria-label": "Yukarı", on: { click: () => { move(i, -1); } } }),
          el("button", { class: "btn small", type: "button", disabled: i === s.story.kartlar.length - 1, text: "↓", "aria-label": "Aşağı", on: { click: () => { move(i, 1); } } }),
          el("button", { class: "btn small danger", type: "button", text: "Sil", on: { click: () => { s.story.kartlar.splice(i, 1); render(); } } })),
        field("Başlık", textIn(k.baslik, (v) => { k.baslik = v; }, { maxlength: "80" })),
        field("Ne olur", textIn(k.olay, (v) => { k.olay = v; }, { rows: 2, maxlength: "1000" })),
        field("Kim var", el("div", { class: "psecim" }, s.story.karakterler.map((c) => {
          const box = el("input", { type: "checkbox", checked: (k.kim || []).includes(c.ad) });
          box.addEventListener("change", () => {
            const set = new Set(k.kim || []);
            if (box.checked) set.add(c.ad);
            else set.delete(c.ad);
            k.kim = [...set];
          });
          return el("label", { class: "pradio" }, box, el("span", { text: c.ad }));
        }))),
        field("Mekân", el("div", {}, select(custom ? NEW_PLACE : k.mekan, places, (v) => {
          placeText.hidden = v !== NEW_PLACE;
          if (v === NEW_PLACE) k.mekan = placeText.value;
          else if (v) k.mekan = v;
          else delete k.mekan;
        }, "Mekân"), placeText)),
        field("Saat", select(k.saat, TIMES, (v) => { if (v) k.saat = v; else delete k.saat; }, "Saat")),
        field("Nesneler", (() => {
          const i = textIn((k.nesneler || []).join(", "), (v) => {
            const list = v.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 12);
            if (list.length) k.nesneler = list;
            else delete k.nesneler;
          }, { list: "psih-nesneler", maxlength: "600", placeholder: "Virgülle: bank, plastik-sise, eski el arabası" });
          return i;
        })(), "Kütüphanedekiler önerilir; olmayan bir nesneyi kelimeyle yazarsan çizilecek."),
        field("Süre (sn)", (() => {
          const i = el("input", { type: "number", min: "1", max: "120", placeholder: "10" });
          i.value = k.sure ?? "";
          i.addEventListener("input", () => { if (i.value === "") delete k.sure; else k.sure = Number(i.value); });
          return i;
        })()));
    });
    return [
      propsList,
      el("p", { class: "muted", text: "Her sahne için ne olduğunu, kimin olduğunu, mekânı, saati ve sahnedeki nesneleri yaz. Çekimleri ve kamerayı Claude önerir, sen panelde düzeltirsin." }),
      ...cards,
      el("button", { class: "btn small", type: "button", disabled: s.story.kartlar.length >= 40, text: "+ Sahne", on: { click: addCard } }),
    ];
  }
  function addCard() {
    const taken = new Set(s.story.kartlar.map((k) => k.id));
    let n = s.story.kartlar.length + 1;
    while (taken.has(`k${n}`)) n++;
    s.story.kartlar.push({ id: `k${n}`, baslik: "", olay: "" });
    render();
  }
  function move(i, by) {
    const list = s.story.kartlar;
    [list[i], list[i + by]] = [list[i + by], list[i]];
    render();
  }

  function stepSound() {
    return [
      field("Müzik", select(w().muzik, [["", "Seç…"], ["yok", "Müzik yok"], ...choiceList("muzik").map((m) => [m.id, m.label])], (v) => setWish("muzik", v), "Müzik"), "Parçaları paneldeki Müzik bölümünde dinleyebilirsin."),
      field("Ses efektleri", radios("pefekt", w().efekt === undefined ? undefined : String(w().efekt), [["true", "Olsun (kütüphaneden)"], ["false", "Olmasın"]], (v) => setWish("efekt", v === "true"))),
      field("Altyazı", radios("palt", w().altyazi, [["var", "Açık"], ["renkli", "Açık, konuşana göre renkli"], ["yok", "Kapalı"]], (v) => setWish("altyazi", v))),
      el("p", { class: "muted small", text: "Karakterlerin sesleri senaryodan sonra seçilir." }),
    ];
  }

  function stepSummary() {
    const st = s.story;
    const missing = [
      !st.fikir?.trim() && "fikir", !st.karakterler.length && "en az bir karakter", !st.kartlar.length && "en az bir sahne",
      !w().format && "format", !w().boyut && "2B/3B",
    ].filter(Boolean);
    const line = (k, v) => el("div", { class: "pozet" }, el("span", { class: "muted", text: k }), el("span", { text: v || "—" }));
    return [
      line("Başlık", st.baslik), line("Fikir", st.fikir), line("İzleyici", st.yas),
      line("Format / süre", [w().format, w().sure ? `${w().sure} sn` : ""].filter(Boolean).join(" · ")),
      line("Boyut", w().boyut ? `${w().boyut.toUpperCase()}${w().stil3d ? ` (${w().stil3d})` : ""}` : ""),
      line("Karakterler", st.karakterler.map((c) => `${c.ad}${c.rig ? "" : " (çizilecek)"}`).join(", ")),
      line("Sahneler", st.kartlar.map((k, i) => `${i + 1}. ${k.baslik || k.olay || "?"}${k.mekan ? ` · ${k.mekan}` : ""}${k.saat ? ` · ${k.saat}` : ""}`).join("\n")),
      line("Müzik / efekt / altyazı", [w().muzik, w().efekt === undefined ? "" : w().efekt ? "efekt var" : "efekt yok", w().altyazi ? `altyazı ${w().altyazi}` : ""].filter(Boolean).join(" · ")),
      missing.length ? el("p", { class: "err", text: `Oluşturmadan önce eksik: ${missing.join(", ")}` }) : el("p", { class: "ok-line", text: s.bolum ? "Hazır: Claude değişen istekleri bölüme uygular." : "Hazır: Claude bölümü bu isteklere göre kurar, adımları panelde görürsün." }),
    ];
  }

  function render() {
    if (!s) return;
    const [, title] = STEPS[s.step];
    const body = [stepStory, stepDecisions, stepCharacters, stepScenes, stepSound, stepSummary][s.step]();
    dialog.replaceChildren(...[
      el("div", { class: "phead" },
        el("div", {},
          el("h2", { text: s.bolum ? `Bölümü düzenle: ${s.story.baslik || s.id}` : s.idFixed ? `Yapım aşamasında: ${s.story.baslik || s.id}` : "Yeni bölüm" }),
          el("p", { class: "muted small", text: "İsteklerini adım adım topla; her adımda kaydedilir, yarıda bırakırsan kaldığın yerden açılır." })),
        el("button", { class: "btn", type: "button", text: "Kapat", on: { click: () => dialog.close() } })),
      el("ol", { class: "padimlar" }, STEPS.map(([, t], i) => el("li", {}, el("button", {
        class: `btn small${i === s.step ? " primary" : ""}`, type: "button", "aria-current": i === s.step ? "step" : null, text: `${i + 1}. ${t}`,
        on: { click: () => go(i) },
      })))),
      el("h3", { text: title }),
      el("div", { class: "pgovde" }, body),
      s.error ? el("p", { class: "err", text: s.error }) : null,
      el("div", { class: "row pnav" },
        el("button", { class: "btn", type: "button", disabled: s.step === 0, text: "← Geri", on: { click: () => go(s.step - 1) } }),
        s.step < STEPS.length - 1
          ? el("button", { class: "btn primary", type: "button", text: "Kaydet ve ileri →", on: { click: () => go(s.step + 1) } })
          : el("button", { class: "btn primary", type: "button", text: s.bolum ? "Değişiklikleri Claude'a gönder" : "Oluştur (Claude'a gönder)", on: { click: build } }),
        s.info && !s.error ? el("span", { class: "muted small", text: s.info }) : null),
    ].filter(Boolean));
    s.info = "";
  }

  return { open };
}
