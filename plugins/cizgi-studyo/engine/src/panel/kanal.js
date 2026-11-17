// Claude's side of the panel (MCP panel_git and panel_sor, see panel-kanal.mjs): the panel moves to
// what Claude wants the person to look at, and Claude's questions show here as option cards instead
// of in chat. Everything shown comes from Claude's tool call: it is drawn as text, never as HTML, and
// pictures are only the panel's own drawings (checked on the server).
import { $, el } from "./dom.js";
import { createWizard } from "./sihirbaz.js";

const POLL_MS = 1500;
const HIGHLIGHT_MS = 6000;
const FRESH_MS = 60_000; // a page opened just after panel_git still follows it
const RAIL_TITLE = { sahneler: "Sahneler", karakter: "Karakter", hareket: "Hareket", mekan: "Mekân", nesne: "Nesne", ses: "Ses", muzik: "Müzik", kamera: "Kamera" };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{api:(path:string, body?:object) => Promise<any>, current:() => string|null,
 *          home:() => Promise<void>, openEpisode:(rel:string) => Promise<void>, story:() => void,
 *          selectShot:(id:string) => boolean, note:(text:string) => void,
 *          projectWizard?:(id:string, step?:string) => Promise<void>, projectSlot?:() => HTMLElement|null,
 *          setThinking?:(on:boolean, listening:boolean) => void,
 *          takeDraft?:(tur:string, id:string) => Promise<string>,
 *          onChats?:(state:object, listening:boolean) => void}} ctx
 */
export function createChannel(ctx) {
  let seenSeq = -1; // the last command applied
  let started = false;
  let question = null; // the open question, as the server sent it
  let picked = new Set();
  let later = false; // the person put the question aside for now
  const box = el("div", { class: "kanal-soru", role: "dialog", "aria-modal": "false", "aria-labelledby": "kanal-soru-baslik", hidden: true });
  const chip = el("button", { class: "kanal-cip", type: "button", hidden: true, text: "Claude bir şey soruyor", on: { click: () => { later = false; render(); } } });
  document.body.append(box, chip);
  const wizard = createWizard({ takeDraft: ctx.takeDraft }); // panel_adim: the steps of a longer job; a question shows inside it

  function openRail(id) {
    const button = $("rail")?.querySelector(`button[title="${RAIL_TITLE[id]}"]`);
    if (button && button.getAttribute("aria-pressed") !== "true") button.click();
  }

  function scrollToDrafts() {
    const heading = [...document.querySelectorAll("#left h4")].find((h) => /^Taslaklar/.test(h.textContent));
    heading?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function highlight(text) {
    const want = text.toLocaleLowerCase("tr");
    const hits = [...document.querySelectorAll("button")].filter((b) => !b.closest(".kanal-soru, .sihirbaz") && b.offsetParent && b.textContent.trim().toLocaleLowerCase("tr").startsWith(want));
    hits[0]?.scrollIntoView({ block: "center", behavior: "smooth" });
    for (const b of hits) b.classList.add("kanal-vurgu");
    setTimeout(() => hits.forEach((b) => b.classList.remove("kanal-vurgu")), HIGHLIGHT_MS);
    if (!hits.length) ctx.note(`Claude “${text}” düğmesini göstermek istedi ama şu an ekranda yok.`);
  }

  /** Apply one navigation command, in order: episode, panel, shot, scroll, highlight. */
  async function go(cmd) {
    if (cmd.proje) {
      await ctx.projectWizard?.(cmd.proje, cmd.proje_adim);
      render();
      return;
    }
    if (cmd.bolum || cmd.shot || cmd.kaydir || cmd.vurgula) { // an episode opening is something to watch too
      wizard.shrink(); // the person must see what Claude points at
      render();
    }
    if (cmd.sekme === "projeler") await ctx.home();
    if (cmd.bolum && cmd.bolum !== ctx.current()) {
      await ctx.openEpisode(cmd.bolum);
      await wait(300); // the editor draws the new episode first
    }
    if (cmd.sekme === "hikaye") ctx.story();
    else if (cmd.sekme === "uretim") document.querySelector("#steps button")?.click(); // the production wizard
    else if (RAIL_TITLE[cmd.sekme]) openRail(cmd.sekme);
    if (cmd.shot && !ctx.selectShot(cmd.shot)) ctx.note(`Claude ${cmd.shot} shot'ını göstermek istedi ama bu bölümde yok.`);
    if (cmd.kaydir || cmd.vurgula) await wait(500); // the left panel and its drafts list load
    if (cmd.kaydir === "taslaklar") scrollToDrafts();
    if (cmd.vurgula) highlight(cmd.vurgula);
  }

  async function answer() {
    const metin = box.querySelector("textarea")?.value.trim() || "";
    const status = box.querySelector(".kanal-durum");
    try {
      await ctx.api("/api/kanal/cevap", { id: question.id, secim: [...picked], metin });
      question = null;
      render();
      ctx.note("Cevabın Claude'a gitti.");
    } catch (err) {
      status.textContent = err.message;
    }
  }

  function card(o) {
    const on = picked.has(o.etiket);
    return el("button", {
      class: `kanal-kart${on ? " secili" : ""}`, type: "button", "aria-pressed": String(on),
      on: {
        click: () => {
          if (question.coklu) {
            if (picked.has(o.etiket)) picked.delete(o.etiket);
            else picked.add(o.etiket);
          } else picked = new Set(picked.has(o.etiket) ? [] : [o.etiket]);
          render();
        },
      },
    },
    o.gorsel ? el("img", { src: o.gorsel, alt: "", loading: "lazy" }) : null,
    el("span", { class: "kanal-etiket", text: o.etiket }),
    o.aciklama ? el("span", { class: "kanal-aciklama", text: o.aciklama }) : null);
  }

  function render() {
    const show = !!question && !later;
    box.hidden = !show;
    chip.hidden = !(question && later);
    // a modal dialog (the project wizard) hides everything behind it: the chip goes inside it then
    const modal = ctx.projectSlot?.() || document.querySelector("#uretim[open]"); // Üretim is a modal page too
    if (modal && chip.parentElement !== modal) modal.append(chip);
    else if (!modal && chip.parentElement !== document.body) document.body.append(chip);
    if (!show) return;
    // inside the open wizard when there is one, else floating over the editor
    const home = ctx.projectSlot?.() || wizard.slot();
    box.classList.toggle("docked", !!home);
    if (home && box.parentElement !== home) {
      home.append(box);
      requestAnimationFrame(() => box.scrollIntoView({ block: "nearest", behavior: "smooth" })); // the steps can be long
    }
    else if (!home && box.parentElement !== document.body) document.body.append(box);
    const typed = box.querySelector("textarea")?.value || "";
    const note = question.serbest
      ? el("textarea", { rows: "2", maxlength: "1000", placeholder: "İstersen kendi cevabını ya da notunu yaz", "aria-label": "Kendi cevabın" })
      : null;
    if (note) {
      note.value = typed;
      note.addEventListener("keydown", (e) => e.stopPropagation()); // the editor's keys stay out of the box
    }
    box.replaceChildren(...[
      el("div", { class: "kanal-ust" },
        el("span", { class: "kanal-kim", text: "Claude soruyor" }),
        el("button", { class: "btn small", type: "button", text: "Sonra", title: "Soruyu kenara koy; üstteki düğmeyle geri gelir", on: { click: () => { later = true; render(); } } })),
      el("h3", { id: "kanal-soru-baslik", text: question.soru }),
      // a spoken line to judge: played right here, so the person listens where they answer
      question.ses ? el("audio", { class: "kanal-ses", controls: "", preload: "auto", src: `/satir-ses/${question.ses.split("/").map(encodeURIComponent).join("/")}`, "aria-label": "Repliği dinle" }) : null,
      question.coklu ? el("p", { class: "muted small", text: "Birden çok seçebilirsin." }) : null,
      el("div", { class: "kanal-kartlar" }, question.secenekler.map(card)),
      note,
      el("div", { class: "row" },
        el("button", { class: "btn primary", type: "button", text: "Gönder", on: { click: answer } }),
        el("span", { class: "kanal-durum why" })),
    ].filter(Boolean)); // replaceChildren would write "null" for a part left out
  }

  async function poll() {
    try {
      const res = await ctx.api("/api/kanal");
      const nav = res.yon;
      if (nav && nav.seq !== seenSeq) {
        const fresh = started || Date.now() - (nav.at || 0) < FRESH_MS;
        seenSeq = nav.seq;
        if (fresh) await go(nav);
      }
      started = true;
      ctx.setThinking?.(!!res.dusunuyor, !!res.dinliyor);
      ctx.onChats?.(res.sohbet, res.dinliyor); // the object windows' conversations
      wizard.set(res.sihirbaz || null);
      wizard.setThinking(!!res.dusunuyor);
      const q = res.soru;
      if ((q?.id || null) !== (question?.id || null)) {
        question = q;
        picked = new Set();
        later = false;
        if (q) wizard.grow(); // a question in a wizard is asked where its steps are
        box.querySelector("textarea")?.remove();
        render();
        wizard.refresh(); // its Claude column says "waiting for your answer" or goes back to working
      } else if (question && !later && (ctx.projectSlot?.() || wizard.slot()) !== (box.classList.contains("docked") ? box.parentElement : null)) {
        render(); // the wizard opened, grew or closed: the question follows it
      }
    } catch {
      /* the panel's server is gone or busy: try again */
    }
    setTimeout(poll, POLL_MS);
  }

  return { start: () => poll() };
}
