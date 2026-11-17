// "Yeni bölüm", in one screen: the person writes the story in their own words and picks the format
// and the length; Claude makes the characters, the scenes and a first episode from it (the six-step
// project wizard stays one click away for those who want to decide everything first).
import { el } from "./dom.js";

const FORMATS = [["9:16", "Dikey", "telefon, 9:16"], ["16:9", "Yatay", "ekran, 16:9"]];
const LENGTHS = [[30, "30 sn"], [60, "1 dk"], [120, "2 dk"]];
const MIN_STORY = 20; // characters: a story, not a word
const MAX_NAME_TRIES = 20;

/** A folder id from the title: lowercase ASCII with hyphens ("Kpss Ajanı" → "kpss-ajani"). */
export function idFromTitle(title) {
  const map = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };
  const ascii = title.toLocaleLowerCase("tr").replace(/[çğıöşüâîû]/g, (c) => map[c]).normalize("NFKD").replace(/[^\x00-\x7f]/g, "");
  return ascii.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-").slice(0, 5).join("-") || "bolum";
}

/** A short title from the story's first words (the person can rename it later). */
export function titleFromStory(story) {
  const first = story.trim().split(/[.!?\n]/)[0].split(/\s+/).slice(0, 5).join(" ");
  return first.length > 60 ? `${first.slice(0, 57)}…` : first;
}

/**
 * @param {{api:(path:string, body?:object) => Promise<any>, wizard:() => void, done:(id:string) => void}} ctx
 */
export function createQuickStart(ctx) {
  const box = el("dialog", { class: "hizli", "aria-labelledby": "hizli-baslik" });
  document.body.append(box);
  const story = el("textarea", { id: "hizli-hikaye", rows: "6", maxlength: "2000", placeholder: "Örnek: KPSS'ye hazırlanan bir öğrenci kütüphanede bir kızla tanışır. Kız aslında gizli bir ajandır…", "aria-describedby": "hizli-hikaye-not" });
  story.addEventListener("keydown", (e) => e.stopPropagation()); // the editor's shortcuts stay out
  let format = "9:16";
  let length = 60;
  let error = "";
  let sending = false;

  async function create() {
    const text = story.value.trim();
    if (text.length < MIN_STORY) {
      error = "Hikâyeni birkaç cümleyle yaz: kim, ne yaşıyor, sonunda ne oluyor.";
      render();
      story.focus();
      return;
    }
    if (sending) return;
    sending = true;
    error = "";
    render();
    const baslik = titleFromStory(text);
    const base = idFromTitle(baslik);
    try {
      // a folder of the same name (a story or an episode already there): the next free one
      let id = base;
      let found = await ctx.api(`/api/yapim/oku?${new URLSearchParams({ id })}`);
      for (let n = 2; found.exists || found.bolum; n++) {
        if (n > MAX_NAME_TRIES) throw new Error("bu adla çok bölüm var: hikâyenin başını değiştir");
        id = `${base}-${n}`;
        found = await ctx.api(`/api/yapim/oku?${new URLSearchParams({ id })}`);
      }
      const newStory = { baslik, fikir: text, yas: "genel", istekler: { format, sure: length, boyut: "2b" }, karakterler: [], kartlar: [] };
      await ctx.api("/api/yapim", { id, story: newStory, version: found.version }); // the version of "no file yet"
      await ctx.api("/api/yapim/olustur", { id, hizli: true });
      box.close();
      story.value = "";
      ctx.done(id);
    } catch (err) {
      error = /bağlı değil/.test(err.message)
        ? "Bu panel bir Claude oturumuna bağlı değil: Claude Code'da /cizgi-studyo yaz, sonra yeniden dene."
        : `Olmadı: ${err.message}`;
    } finally {
      sending = false;
    }
    render();
  }

  const segment = (label, options, now, pick) => el("div", { class: "pfield" },
    el("span", { class: "pfield-ad", text: label }),
    el("div", { class: "psegment", role: "radiogroup", "aria-label": label }, options.map(([v, t, sub]) => el("button", {
      class: `btn small${v === now ? " primary" : ""}`, type: "button", role: "radio", "aria-checked": String(v === now), title: sub || null, text: t,
      on: { click: () => { pick(v); render(); } },
    }))));

  function render() {
    const typed = story.value;
    box.replaceChildren(...[
      el("header", { class: "vcikar-bas" },
        el("h2", { id: "hizli-baslik", text: "Yeni bölüm" }),
        el("button", { class: "btn icon", type: "button", "aria-label": "Kapat", text: "✕", on: { click: () => box.close() } })),
      el("label", { class: "pfield-ad", for: "hizli-hikaye", text: "Hikâyen" }),
      story,
      el("p", { id: "hizli-hikaye-not", class: "muted small", text: "Kendi sözlerinle: kim, ne yaşıyor, sonunda ne oluyor. Karakterleri ve sahneleri Claude çıkarır; sonra sahnede her şeye tıklayıp birlikte düzeltirsiniz." }),
      segment("Format", FORMATS, format, (v) => { format = v; }),
      segment("Süre", LENGTHS, length, (v) => { length = v; }),
      error ? el("p", { class: "npencere-hata", role: "alert", text: error }) : null,
      el("div", { class: "row hizli-alt" },
        el("button", { class: "btn primary", type: "button", "aria-busy": sending ? "true" : null, text: sending ? "Gönderiliyor…" : "Oluştur", on: { click: create } }),
        el("button", { class: "btn ghost small", type: "button", text: "Her şeyi kendim seçeyim (ayrıntılı sihirbaz)", on: { click: () => { box.close(); ctx.wizard(); } } })),
    ].filter(Boolean));
    story.value = typed;
  }

  return {
    open() {
      error = "";
      render();
      if (!box.open) box.showModal();
      story.focus();
    },
  };
}
