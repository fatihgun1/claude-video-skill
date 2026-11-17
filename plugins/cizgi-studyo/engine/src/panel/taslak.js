// Drafts of the project library, under the library's Mekân, Nesne, Karakter and Hareket panels: what Claude drew and
// is waiting for the person. A good draft can be looked at and taken in ("Kütüphaneye al"), after
// which it is an ordinary card; one the person does not want is put aside ("Reddet", kept in
// kutuphane/taslak/_reddedilen). Below them, a form to ask Claude for a new drawing. Under Ses:
// the project's sound effects left out (no source written, a name taken…) and a form to ask Claude
// for a missing effect (a CC0 source it suggests and downloads only after the person says yes).
//
// The left panel is narrow (~300px), so drafts are a list, not a card grid: picture, name, badge,
// notes, then the actions. Comparing an update with the current drawing needs room, so it opens in
// one <dialog>; the reject question uses that same dialog, so a dialog never opens over another.
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
const nameOf = (d) => d.name || d.id;
// where Claude writes each kind of draft, and what it is made of
const DRAFT_AT = {
  mekan: { dir: "backgrounds\\<ad>\\", what: "mekan.json ve her katman için bir SVG" },
  nesne: { dir: "props\\<ad>.svg", what: "data-grip ve data-base ile" },
  karakter: { dir: "characters\\<ad>\\", what: "rig.svg ve character.json, docs/RIG-SPEC.md'ye göre; önce bana bir konsept göster" },
  hareket: { dir: "actions\\<ad>.json", what: "karakterin görünüşüne uygun views ile, eklem sınırları içinde" },
};
const ASK_HINT = {
  ses: "Hangi sesi istediğini kısaca yaz. Claude CC0 bir kaynak önerir, indirmeden önce sana sorar.",
  cizim: "Neyi, nasıl görünmesini istediğini yaz. Çizim bitince yukarıda taslak olarak görünür.",
};
const ASK_EMPTY = {
  ses: "Önce hangi efekti istediğini yaz; örneğin “kuş cıvıltısı, kısa”.",
  cizim: "Önce neyin çizilmesini istediğini yaz; kutudaki örnek gibi.",
};
const LOADER_DELAY_MS = 100; // quicker answers show no loader at all, so nothing flashes
const askId = (tur) => `tsl-iste-${tur}`;

/**
 * The drafts part of the library panels.
 * @param {{api:(path:string, body?:object) => Promise<any>, path:() => string|null, title:() => string,
 *          setVocab:(vocab:object) => void, rerender:() => void, note:(text:string) => void}} ctx
 * @returns {{section:(tab:string) => HTMLElement[], onSignature:(sig:string|undefined) => void}}
 */
export function createDrafts(ctx) {
  let drafts = [];
  let problems = []; // drawings of the project library left out because they are broken
  let project = null;
  let signature = null;
  let error = "";
  const sent = blank(); // what the last request of each tab did
  const askError = blank();
  const sending = blank(); // "1" while that tab's request is on its way
  let loaded = false;
  let loading = false;
  let busy = null; // {key, islem} of the draft action running, so a second click does not repeat it
  const asks = blank(); // what was typed, kept across redraws
  let dialog = null;
  let returnTo = null;

  // redraw only if the work is still running after the delay: a fast answer never shows a loader
  const showSoon = (still) => setTimeout(() => { if (still()) ctx.rerender(); }, LOADER_DELAY_MS);

  async function refresh() {
    if (loading) return;
    loading = true;
    try {
      const res = await ctx.api("/api/taslaklar");
      drafts = res.taslaklar;
      project = res.kutuphane;
      problems = res.sorunlar || [];
      loaded = true;
      error = "";
    } catch (err) {
      error = `Taslaklar alınamadı: ${err.message}`;
    } finally {
      loading = false;
    }
    ctx.rerender();
  }

  async function act(islem, d) {
    if (busy) return;
    busy = { key: `${d.tur}/${d.id}`, islem };
    error = "";
    showSoon(() => busy);
    try {
      const res = await ctx.api("/api/taslak", { islem, tur: d.tur, id: d.id });
      drafts = res.taslaklar;
      if (islem === "al") {
        ctx.setVocab(res.vocab);
        ctx.note(`“${nameOf(d)}” kütüphaneye alındı: artık ${KIND_TEXT[d.tur]} kartlarında.`);
      } else ctx.note(`“${nameOf(d)}” reddedildi (kutuphane/taslak/_reddedilen içinde duruyor).`);
    } catch (err) {
      error = err.message;
    } finally {
      busy = null;
    }
    ctx.rerender();
  }

  async function ask(tur) {
    const what = asks[tur].trim();
    if (!what) {
      // the button stays clickable; an empty send says what to write instead of doing nothing
      askError[tur] = ASK_EMPTY[tur === "ses" ? "ses" : "cizim"];
      ctx.rerender();
      document.getElementById(askId(tur))?.focus();
      return;
    }
    if (sending[tur]) return;
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
    sending[tur] = "1";
    showSoon(() => sending[tur]);
    try {
      await ctx.api("/api/istek", { b: ctx.path(), hedef: { tur: "bolum", etiket: ctx.title().slice(0, 100) }, metin });
      asks[tur] = "";
      sent[tur] = tur === "ses" ? "Claude'a gönderildi: bir kaynak önerip indirmeden önce soracak." : "Claude'a gönderildi: çizim bitince burada taslak olarak görünür.";
    } catch (err) {
      askError[tur] = `Gönderilemedi: ${err.message}`;
    } finally {
      sending[tur] = "";
    }
    ctx.rerender();
  }

  /** Take in every good draft of one kind with one click (the views of one character, say). */
  async function takeAll(tur, count) {
    if (busy) return;
    busy = { key: `hepsi/${tur}`, islem: "al" };
    error = "";
    showSoon(() => busy);
    try {
      const res = await ctx.api("/api/taslak", { islem: "hepsini-al", tur });
      drafts = res.taslaklar;
      ctx.setVocab(res.vocab);
      const left = res.hatalar?.length ? ` ${res.hatalar.length} taslak hatalı olduğu için kaldı.` : "";
      ctx.note(`${res.alinan?.length ?? count} ${KIND_TEXT[tur]} kütüphaneye alındı.${left}`);
    } catch (err) {
      error = err.message;
    } finally {
      busy = null;
    }
    ctx.rerender();
  }

  /* ---------- the dialog: comparison of an update, and the reject question ---------- */

  function restoreFocus() {
    // the list is redrawn after an action, so the button that opened the dialog may be gone
    const back = returnTo?.isConnected ? returnTo : document.querySelector("#left .tsl-baslik");
    back?.focus();
    returnTo = null;
  }

  function openDialog(wide, content, focus) {
    if (!dialog) {
      dialog = el("dialog", {
        class: "tsl-dlg", "aria-labelledby": "tsl-dlg-baslik",
        on: {
          keydown: (e) => e.stopPropagation(), // the editor's shortcuts stay out of the dialog
          close: restoreFocus,
          click: (e) => { if (e.target === dialog) dialog.close(); }, // a click on the backdrop is "Vazgeç"
        },
      });
      document.body.append(dialog);
    }
    if (!dialog.open) returnTo = document.activeElement;
    dialog.classList.toggle("dar", !wide);
    dialog.replaceChildren(el("div", { class: "tsl-dlg-ic" }, content));
    if (!dialog.open) dialog.showModal();
    focus?.focus();
  }

  /** Run an action from the dialog: the button shows the wait, the dialog closes when it is done. */
  async function fromDialog(button, busyText, islem, d) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = busyText;
    await act(islem, d);
    dialog.close();
  }

  function confirmReject(d) {
    const cancel = el("button", { class: "btn small", type: "button", text: "Vazgeç", on: { click: () => dialog.close() } });
    const reject = el("button", { class: "btn small tsl-sil", type: "button", text: "Taslağı reddet" });
    reject.addEventListener("click", () => fromDialog(reject, "Reddediliyor…", "reddet", d));
    openDialog(false, [
      el("h2", { id: "tsl-dlg-baslik", text: `“${nameOf(d)}” taslağını reddet?` }),
      el("p", { text: `Bu ${KIND_TEXT[d.tur]} kütüphaneye girmez. Silinmez: kutuphane/taslak/_reddedilen klasörüne taşınır.` }),
      el("div", { class: "tsl-dlg-alt" }, cancel, reject),
    ], cancel); // Vazgeç has the focus, so Enter does not throw a drawing away
  }

  function figure(caption, d, src, isNew) {
    return el("figure", { class: isNew ? "yeni" : "" }, el("div", { class: "tsl-kare" }, thumbOf(d, src)), el("figcaption", { text: caption }));
  }

  function compare(d) {
    const close = el("button", { class: "btn small", type: "button", text: "Kapat", on: { click: () => dialog.close() } });
    const take = d.ok ? el("button", { class: "btn primary small", type: "button", text: "Yeni sürümü al" }) : null;
    take?.addEventListener("click", () => fromDialog(take, "Alınıyor…", "al", d));
    openDialog(true, [
      el("div", { class: "tsl-dlg-bas" },
        el("h2", { id: "tsl-dlg-baslik", text: `“${nameOf(d)}” · yeni sürüm` }),
        el("p", { class: "muted", text: "Solda kütüphanedeki çizim, sağda Claude'un yeni sürümü. Yeni sürümü alırsan eskisi kutuphane/taslak/_reddedilen içinde saklanır." })),
      el("div", { class: "tsl-split" },
        figure("Şimdiki", d, `/kutuphane/${d.tur}/${d.id}.svg?v=${signature || ""}`, false),
        figure("Yeni", d, freshSrc(d), true)),
      d.errors.length ? errorList(d) : null,
      el("div", { class: "tsl-dlg-alt" },
        close, el("span", { class: "bosluk" }),
        el("button", { class: "btn small", type: "button", text: "Reddet", on: { click: () => confirmReject(d) } }),
        take),
    ], take || close);
  }

  /* ---------- the list ---------- */

  const freshSrc = (d) => `/kutuphane-taslak/${d.tur}/${d.id}.svg?v=${signature || ""}`;

  const thumbOf = (d, src) => (d.ok && d.tur === "hareket"
    ? el("span", { class: "why", text: "kütüphaneye alınca kartında denenir" })
    : d.ok || src.startsWith("/kutuphane/")
      ? el("img", { alt: "", loading: "lazy", src })
      : el("span", { class: "why", text: "önizleme yok: hatalı" }));

  const errorList = (d) => el("ul", { class: "tsl-hatalar" }, d.errors.slice(0, 4).map((e) => el("li", { text: tr(e) })));

  function busyButton(cls, text, busyText, running, onClick, title) {
    return el("button", {
      class: cls, type: "button", title, disabled: running, "aria-busy": running ? "true" : null,
      text: running ? busyText : text, on: { click: onClick },
    });
  }

  function draftItem(d) {
    const tur = d.tur;
    const running = busy?.key === `${tur}/${d.id}` ? busy.islem : null;
    const canCompare = d.guncelleme && tur !== "hareket";
    const forEpisode = d.bolum ? d.bolum.replace(/\/bolum\.json$/, "").split("/").pop() : null;
    const take = d.ok
      ? busyButton("btn primary small", d.guncelleme ? "Yeni sürümü al" : "Kütüphaneye al", "Alınıyor…", running === "al", () => act("al", d),
        d.guncelleme ? "Şimdiki çizimin yerine geçer (eskisi kutuphane/taslak/_reddedilen içinde saklanır)" : "Bölümlerde kullanılabilir olur")
      : el("span", { class: "tsl-engel", text: "Alınamaz: önce Claude düzeltmeli" });
    return el("li", { class: `tsl-oge${d.ok ? "" : " hatali"}` },
      el("div", { class: `tsl-resim${tur === "mekan" ? " genis" : ""}` }, thumbOf(d, freshSrc(d))),
      el("div", { class: "tsl-govde" },
        el("div", { class: "tsl-ust" },
          el("span", { class: "tsl-ad", text: nameOf(d) }),
          el("span", { class: `tsl-rozet${d.guncelleme ? " guncelleme" : ""}`, text: d.guncelleme ? "Güncelleme" : "Taslak" })),
        d.name ? el("span", { class: "tsl-meta", text: d.id }) : null,
        forEpisode ? el("span", { class: "tsl-meta", text: `“${forEpisode}” bölümü için` }) : null,
        tur === "mekan" && d.layers.length ? el("span", { class: "tsl-meta", text: d.layers.map((l) => `${l.id} ${l.derinlik}`).join(" · ") }) : null,
        d.not ? el("p", { class: "tsl-not", text: d.not }) : null,
        d.errors.length ? errorList(d) : null),
      el("div", { class: "tsl-eylem" },
        take,
        canCompare ? el("button", { class: "btn ghost small", type: "button", text: "Karşılaştır", title: "Şimdiki çizimle yan yana gör", on: { click: () => compare(d) } }) : null,
        busyButton("btn small tsl-reddet", "Reddet", "Reddediliyor…", running === "reddet", () => confirmReject(d), "İstemiyorum: kenara koy (silinmez)")));
  }

  function askForm(tur) {
    const id = askId(tur);
    const hintId = `${id}-ipucu`;
    const kind = tur === "ses" ? "ses" : "cizim";
    const hint = el("p", { id: hintId, class: askError[tur] ? "pfield-hata" : "pfield-ipucu", text: askError[tur] || ASK_HINT[kind] });
    const form = el("div", { class: `pfield tsl-iste${askError[tur] ? " hatali" : ""}` });
    const box = el("textarea", { id, rows: "3", maxlength: "600", placeholder: PLACEHOLDER[tur], "aria-describedby": hintId, "aria-invalid": askError[tur] ? "true" : null });
    box.value = asks[tur];
    box.addEventListener("input", () => {
      asks[tur] = box.value;
      if (!askError[tur]) return;
      // the first corrective keystroke clears the error in place (a redraw would take the focus away)
      askError[tur] = "";
      hint.className = "pfield-ipucu";
      hint.textContent = ASK_HINT[kind];
      form.classList.remove("hatali");
      box.removeAttribute("aria-invalid");
    });
    box.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        e.stopPropagation();
        ask(tur);
      } else if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
    });
    form.append(
      el("label", { class: "pfield-ad", for: id, text: `Claude'dan yeni ${KIND_TEXT[tur]} iste` }),
      box, hint,
      el("div", { class: "tsl-iste-alt" },
        busyButton("btn small tsl-gonder", tur === "ses" ? "✦ Efekt iste" : "✦ Çizim iste", "Gönderiliyor…", !!sending[tur], () => ask(tur), "Claude'a gönder (Ctrl+Enter)")),
      sent[tur] ? el("p", { class: "tsl-durum tamam", role: "status" }, el("span", { class: "nokta", "aria-hidden": "true" }), sent[tur]) : null);
    return form;
  }

  const problemBox = (title, list) => (list.length
    ? el("div", { class: "tsl-sorun" }, el("b", { text: title }), el("ul", {}, list.slice(0, 6).map((p) => el("li", { text: tr(p) }))))
    : null);

  const errorLine = () => (error ? el("p", { class: "tsl-hata", role: "alert", text: error }) : null);

  /** Before the first list: a loader (only past the delay), or the error with a way to try again. */
  function notLoaded() {
    if (error) {
      return [el("p", { class: "tsl-hata", role: "alert", text: error }),
        el("button", { class: "btn small", type: "button", text: "Yeniden dene", on: { click: () => { error = ""; refresh(); ctx.rerender(); } } })];
    }
    if (!loading) refresh();
    return [el("p", { class: "tsl-durum tsl-gecikmeli", role: "status" }, el("span", { class: "cark", "aria-hidden": "true" }), "Taslaklar yükleniyor…")];
  }

  function emptyDrafts(tab) {
    return el("div", { class: "pbos tsl-bos" },
      el("p", { class: "tsl-bos-bas", text: `Onay bekleyen ${KIND_TEXT[tab]} taslağı yok` }),
      el("p", { text: "Claude'un çizdikleri burada bekler; bakıp kütüphaneye alırsın." }),
      el("button", { class: "btn ghost small tsl-claude", type: "button", text: `✦ Claude'dan ${KIND_TEXT[tab]} iste`, on: { click: () => document.getElementById(askId(tab))?.focus() } }));
  }

  return {
    /**
     * Take one draft in from elsewhere (the wizard's step page, which covers this panel).
     * @returns {Promise<string>} "" when taken, else the reason it was not
     */
    async take(tur, id) {
      try {
        const res = await ctx.api("/api/taslak", { islem: "al", tur, id });
        drafts = res.taslaklar;
        ctx.setVocab(res.vocab);
        return "";
      } catch (err) {
        return err.message;
      }
    },
    /** The drafts part of the Mekân, Nesne, Karakter or Hareket panel; under Ses, the project's sound problems and the ask form. */
    section(tab) {
      if (!TABS.includes(tab)) return [];
      const wrap = (...kids) => [el("section", { class: "span tsl", "aria-label": tab === "ses" ? "Eksik efektler" : "Taslaklar" }, ...kids)];
      if (!loaded) return wrap(notLoaded());
      const isSound = (p) => p.includes("sound effect");
      if (tab === "ses") {
        return wrap(problemBox("Proje kütüphanesinde kullanılamayan efektler:", problems.filter(isSound)), errorLine(), askForm("ses"));
      }
      const mine = drafts.filter((d) => d.tur === tab);
      const ready = good(mine);
      return wrap(
        problemBox("Proje kütüphanesinde kullanılamayan çizimler:", problems.filter((p) => !isSound(p))),
        el("div", { class: "tsl-bas" },
          el("h4", { class: "tsl-baslik", tabindex: "-1", text: `Taslaklar · onay bekliyor (${mine.length})` }),
          ready > 1
            ? busyButton("btn primary small", `${ready} taslağı al`, "Alınıyor…", busy?.key === `hepsi/${tab}`, () => takeAll(tab, ready), `Hatasız ${ready} ${KIND_TEXT[tab]} taslağını birlikte kütüphaneye al`)
            : null),
        errorLine(),
        mine.length ? el("ul", { class: "tsl-liste" }, mine.map(draftItem)) : emptyDrafts(tab),
        askForm(tab));
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
