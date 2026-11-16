// Drafts of the project library, under the library's Mekân, Nesne, Karakter and Hareket panels: what Claude drew and
// is waiting for the person. A good draft can be looked at and taken in ("Kütüphaneye al"), after
// which it is an ordinary card; one the person does not want is put aside ("Reddet", kept in
// kutuphane/taslak/_reddedilen). Below them, a form to ask Claude for a new drawing. Under Ses:
// the project's sound effects left out (no source written, a name taken…) and a form to ask Claude
// for a missing effect (a CC0 source it suggests and downloads only after the person says yes).
import { el } from "./dom.js";
import { tr } from "./tr.js";

const KIND_TEXT = { mekan: "mekân", nesne: "nesne", karakter: "karakter", hareket: "hareket", ses: "efekt" };
const PLACEHOLDER = {
  mekan: "Örnek: akşamüstü bir sahil; uzakta ada, önde kumdan kale",
  nesne: "Örnek: kırmızı bir top (elde tutulur)",
  karakter: "Örnek: iri yapılı, sakallı, bereli bir sokak adamı; yandan görünüş",
  hareket: "Örnek: bankta oturur, sonra kalkar (yandan görünüş için)",
  ses: "Örnek: kuş cıvıltısı, kısa",
};
const TABS = Object.keys(KIND_TEXT);
const good = (list) => list.filter((d) => d.ok).length;
const blank = () => Object.fromEntries(TABS.map((t) => [t, ""]));
// where Claude writes each kind of draft, and what it is made of
const DRAFT_AT = {
  mekan: { dir: "backgrounds\\<ad>\\", what: "mekan.json ve her katman için bir SVG" },
  nesne: { dir: "props\\<ad>.svg", what: "data-grip ve data-base ile" },
  karakter: { dir: "characters\\<ad>\\", what: "rig.svg ve character.json, docs/RIG-SPEC.md'ye göre; önce bana bir konsept göster" },
  hareket: { dir: "actions\\<ad>.json", what: "karakterin görünüşüne uygun views ile, eklem sınırları içinde" },
};

/**
 * @param {{api:(path:string, body?:object) => Promise<any>, path:() => string|null, title:() => string,
 *          setVocab:(vocab:object) => void, rerender:() => void, note:(text:string) => void}} ctx
 */
export function createDrafts(ctx) {
  let drafts = [];
  let problems = []; // drawings of the project library left out because they are broken
  let project = null;
  let signature = null;
  let error = "";
  const sent = blank(); // what the last request of each tab did
  const askError = blank();
  let loaded = false;
  const asks = blank(); // what was typed, kept across redraws

  async function refresh() {
    try {
      const res = await ctx.api("/api/taslaklar");
      drafts = res.taslaklar;
      project = res.kutuphane;
      problems = res.sorunlar || [];
      loaded = true;
      error = "";
    } catch (err) {
      error = `taslaklar alınamadı: ${err.message}`;
    }
    ctx.rerender();
  }

  async function act(islem, d) {
    error = "";
    try {
      const res = await ctx.api("/api/taslak", { islem, tur: d.tur, id: d.id });
      drafts = res.taslaklar;
      if (islem === "al") {
        ctx.setVocab(res.vocab);
        ctx.note(`“${d.name || d.id}” kütüphaneye alındı: artık ${KIND_TEXT[d.tur]} kartlarında.`);
      } else ctx.note(`“${d.name || d.id}” reddedildi (kutuphane/taslak/_reddedilen içinde duruyor).`);
    } catch (err) {
      error = err.message;
    }
    ctx.rerender();
  }

  async function ask(tur) {
    const what = asks[tur].trim();
    if (!what) return;
    const lib = project || "<proje>\\kutuphane";
    const at = DRAFT_AT[tur];
    const metin = tur === "ses" ? [
      `Kütüphanede bu efekt yok: ${what}`,
      "CC0 (kamu malı) bir kaynak öner: bağlantısı ve lisansıyla. İndirmeden önce bana sor.",
      `Onaylarsam ${lib}\\sfx\\<ad>.wav olarak koy (44.1 kHz mono WAV) ve kaynağını ${lib}\\sfx\\KAYNAKLAR.md'ye yaz (cizgi-studyo skill'indeki “Yeni efekt” bölümü). Bitince panel_yanitla ile yaz.`,
    ].join("\n") : [
      `Yeni bir ${tur === "mekan" ? "katmanlı mekân" : KIND_TEXT[tur]} çiz (taslak): ${what}`,
      `Taslak olarak ${lib}\\taslak\\${at.dir} yaz: ${at.what} (cizgi-studyo skill'indeki “Taslak çizim” bölümü).`,
      "Kütüphaneye kendin alma: panelde ben bakıp alacağım. Bitince adını ve neyi çizdiğini panel_yanitla ile yaz.",
    ].join("\n");
    askError[tur] = "";
    sent[tur] = "";
    try {
      await ctx.api("/api/istek", { b: ctx.path(), hedef: { tur: "bolum", etiket: ctx.title().slice(0, 100) }, metin });
      asks[tur] = "";
      sent[tur] = tur === "ses" ? "Claude'a gönderildi: bir kaynak önerip indirmeden önce soracak." : "Claude'a gönderildi: çizim bitince burada taslak olarak görünür.";
    } catch (err) {
      askError[tur] = err.message;
    }
    ctx.rerender();
  }

  /** Take in every good draft of one kind with one click (the views of one character, say). */
  async function takeAll(tur, count) {
    error = "";
    try {
      const res = await ctx.api("/api/taslak", { islem: "hepsini-al", tur });
      drafts = res.taslaklar;
      ctx.setVocab(res.vocab);
      const left = res.hatalar?.length ? ` ${res.hatalar.length} taslak hatalı olduğu için kaldı.` : "";
      ctx.note(`${res.alinan?.length ?? count} ${KIND_TEXT[tur]} kütüphaneye alındı.${left}`);
    } catch (err) {
      error = err.message;
    }
    ctx.rerender();
  }

  const thumbOf = (d, src) => (d.ok && d.tur === "hareket"
    ? el("span", { class: "why", text: "kütüphaneye alınca kartında denenir" })
    : d.ok || src.startsWith("/kutuphane/")
      ? el("img", { alt: "", loading: "lazy", src })
      : el("span", { class: "why", text: "önizleme yok: hatalı" }));

  function draftCard(d) {
    const tur = d.tur;
    const fresh = `/kutuphane-taslak/${tur}/${d.id}.svg?v=${signature || ""}`;
    // an update shows the drawing it replaces next to the new one
    const compare = d.guncelleme && tur !== "hareket";
    const thumb = compare
      ? el("div", { class: "dcompare" },
        el("figure", {}, thumbOf(d, `/kutuphane/${tur}/${d.id}.svg?v=${signature || ""}`), el("figcaption", { text: "Şimdiki" })),
        el("figure", {}, thumbOf(d, fresh), el("figcaption", { text: "Yeni" })))
      : thumbOf(d, fresh);
    const forEpisode = d.bolum ? d.bolum.replace(/\/bolum\.json$/, "").split("/").pop() : null;
    return el("div", { class: `card draft${compare ? " wide-card" : ""}` },
      el("div", { class: `thumb${tur === "mekan" || compare ? " wide" : ""}` }, thumb, el("span", { class: "badge", text: d.guncelleme ? "yeni sürüm" : "taslak" })),
      el("span", { class: "name", text: d.name ? `${d.name} (${d.id})` : d.id }),
      forEpisode ? el("span", { class: "meta", text: `“${forEpisode}” bölümü için` }) : null,
      d.not ? el("span", { class: "meta", text: d.not }) : null,
      tur === "mekan" && d.layers.length ? el("span", { class: "meta", text: d.layers.map((l) => `${l.id} ${l.derinlik}`).join(" · ") }) : null,
      d.errors.length ? el("ul", { class: "why derrs" }, d.errors.slice(0, 4).map((e) => el("li", { text: tr(e) }))) : null,
      el("div", { class: "row dacts" },
        el("button", {
          class: "btn primary small", type: "button", disabled: !d.ok,
          title: !d.ok ? "Önce sorunları Claude düzeltsin" : d.guncelleme ? "Şimdiki çizimin yerine geçer (eskisi kutuphane/taslak/_reddedilen içinde saklanır)" : "Kütüphaneye al: bölümlerde kullanılabilir olur",
          text: d.guncelleme ? "Yeni sürümü al" : "Kütüphaneye al", on: { click: () => act("al", d) },
        }),
        el("button", { class: "btn small danger", type: "button", title: "İstemiyorum: kenara koy (silinmez)", text: "Reddet", on: { click: () => act("reddet", d) } })));
  }

  function askForm(tur) {
    const box = el("textarea", { rows: "2", maxlength: "600", placeholder: PLACEHOLDER[tur], "aria-label": `Claude'dan ${KIND_TEXT[tur]} iste` });
    box.value = asks[tur];
    box.addEventListener("input", () => { asks[tur] = box.value; });
    box.addEventListener("keydown", (e) => { if (!e.ctrlKey && !e.metaKey) e.stopPropagation(); });
    return el("div", { class: "dask" },
      el("label", { class: "muted small", text: `Claude'dan yeni ${KIND_TEXT[tur]} iste` }),
      box,
      el("button", { class: "btn small", type: "button", text: "İste", on: { click: () => ask(tur) } }));
  }

  return {
    /** The drafts part of the Mekân, Nesne, Karakter or Hareket panel; under Ses, the project's sound problems and the ask form. */
    section(tab) {
      if (!TABS.includes(tab)) return [];
      if (!loaded) {
        refresh();
        return [];
      }
      const isSound = (p) => p.includes("sound effect");
      if (tab === "ses") {
        const mineBad = problems.filter(isSound);
        return [
          mineBad.length ? el("div", { class: "warn small span" }, el("b", { text: "Proje kütüphanesinde kullanılamayan efektler:" }),
            el("ul", { class: "derrs" }, mineBad.slice(0, 6).map((p) => el("li", { text: tr(p) })))) : null,
          error ? el("p", { class: "err small span", text: error }) : null,
          askError.ses ? el("p", { class: "err small span", text: askError.ses }) : null,
          sent.ses ? el("p", { class: "ok-line small span", text: sent.ses }) : null,
          askForm("ses"),
        ].filter(Boolean);
      }
      const mine = drafts.filter((d) => d.tur === tab);
      const drawings = problems.filter((p) => !isSound(p));
      return [
        drawings.length ? el("div", { class: "warn small span" }, el("b", { text: "Proje kütüphanesinde kullanılamayan çizimler:" }),
          el("ul", { class: "derrs" }, drawings.slice(0, 6).map((p) => el("li", { text: tr(p) })))) : null,
        el("h4", { class: "group-title", text: `Taslaklar · onay bekliyor (${mine.length})` }),
        good(mine) > 1
          ? el("button", { class: "btn primary small span", type: "button", text: `Hepsini kütüphaneye al (${good(mine)})`, title: "Hatasız bütün taslakları birlikte al", on: { click: () => takeAll(tab, good(mine)) } })
          : null,
        ...mine.map(draftCard),
        error ? el("p", { class: "err small span", text: error }) : null,
        askError[tab] ? el("p", { class: "err small span", text: askError[tab] }) : null,
        sent[tab] ? el("p", { class: "ok-line small span", text: sent[tab] }) : null,
        askForm(tab),
      ].filter(Boolean);
    },
    /** The poll saw the drafts folder change: list again. */
    onSignature(sig) {
      if (sig === undefined || sig === signature) return;
      const first = signature === null;
      signature = sig;
      if (!first || loaded) refresh();
    },
  };
}
