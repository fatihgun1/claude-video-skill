// Bölüm ayarları: the right panel's view of what belongs to the whole episode, not to a shot:
// track levels (episode.mix), the background music (episode.music) and the captions (off, or
// edged with the speaker's colour). Opened from the top bar, the timeline's Mikser or its
// music clip; "← Shot'a dön" goes back to the selected shot.
import { el, select, number, field, setKey } from "./dom.js";
import { listen } from "./dinle.js";
import { MUSIC_DEFAULTS } from "./muzik.mjs";
import { episodeCaption } from "./altyazi-ayar.js";

/** The looks a 3D render can take (schema: stil3d); the first is the default (no key). */
const LOOKS_3D = [
  { id: "toon", label: "Toon + kontur" }, { id: "yumusak", label: "Yumuşak gölgeli" },
  { id: "pastel", label: "Pastel" }, { id: "golge", label: "Toon + gölge, kontursuz" },
];

/** A slider for a voice setting (chatterbox): its value beside it; onSet when let go. */
function voiceSlider(value, min, max, label, onSet) {
  const r = el("input", { type: "range", min, max, step: 0.05, value, "aria-label": label });
  const out = el("span", { class: "muted small", text: Number(value).toFixed(2) });
  r.addEventListener("input", () => { out.textContent = Number(r.value).toFixed(2); });
  r.addEventListener("change", () => onSet(Number(r.value)));
  return el("div", { class: "row-inline" }, r, out);
}

/** Each speaker's voice settings (characters[].voice, narrator_voice) and a sample to hear them. */
function voices(ep, ctx) {
  const speakers = [...ep.characters.map((c) => ({ id: c.id, label: ctx.labelOf(c.id), obj: c, key: "voice" }))];
  const narrates = ep.scenes.some((s) => s.shots.some((sh) => (sh.utterances || []).some((u) => u.speaker === "anlatici")));
  if (narrates || ep.narrator_voice) speakers.push({ id: "anlatici", label: "Anlatıcı", obj: ep, key: "narrator_voice" });
  return speakers.map((sp) => {
    const v = sp.obj[sp.key] || {};
    const set = (k, x, def) => {
      const next = { ...(sp.obj[sp.key] || {}), [k]: x };
      if (x === def) delete next[k];
      setKey(sp.obj, sp.key, Object.keys(next).length ? next : undefined);
      ctx.changed(true);
    };
    const status = el("span", { class: "muted small" });
    return el("div", { class: "voice-row" },
      el("b", { text: sp.label }),
      field("İfade", voiceSlider(v.exaggeration ?? 0.5, 0.25, 1.5, `${sp.label}: ifade gücü`, (x) => set("exaggeration", x, 0.5))),
      field("Düzgünlük", voiceSlider(v.cfg ?? 0.5, 0.4, 1, `${sp.label}: cfg`, (x) => set("cfg", x, 0.5))),
      v.ref ? el("p", { class: "muted small", text: `Örnek kayıt: ${v.ref}` }) : null,
      el("div", { class: "row-inline" },
        el("button", { class: "btn small", type: "button", disabled: !ctx.sample, on: { click: () => ctx.sample(sp.id, (t) => { status.textContent = t; }) } }, "▶ Örnek dinle"),
        status));
  });
}

/** A 0..1 slider with its percentage; onSet when let go. */
function slider(value, label, onSet) {
  const r = el("input", { type: "range", min: 0, max: 1, step: 0.05, value, "aria-label": label });
  const out = el("span", { class: "muted small", text: `${Math.round(value * 100)}%` });
  r.addEventListener("input", () => { out.textContent = `${Math.round(Number(r.value) * 100)}%`; });
  r.addEventListener("change", () => onSet(Number(r.value)));
  return el("div", { class: "row-inline" }, r, out);
}

/**
 * @param {{episode:() => object, vocab:() => object, labelOf:(id:string) => string,
 *          changed:(structural?:boolean) => void, select:(kind:string|null) => void}} ctx
 */
export function episodeSettings(ctx) {
  const ep = ctx.episode();
  const v = ctx.vocab();
  const setMix = (key, val) => {
    const mix = { ...(ep.mix || {}), [key]: val };
    if (val === 1) delete mix[key];
    setKey(ep, "mix", Object.keys(mix).length ? mix : undefined);
    ctx.changed(true);
  };
  const m = ep.music;
  const setMusic = (key, val) => { setKey(ep.music, key, val); ctx.changed(true); };
  const musicPart = m
    ? [
      field("Parça", select(m.track, v.music, (val) => setMusic("track", val))),
      field("Düzey", slider(m.volume ?? MUSIC_DEFAULTS.volume, "Müzik düzeyi", (x) => setMusic("volume", x))),
      field("Giriş (s)", number(m.fade_in ?? MUSIC_DEFAULTS.fade_in, (x) => setMusic("fade_in", x), { min: 0, max: 10, step: 0.1 })),
      field("Çıkış (s)", number(m.fade_out ?? MUSIC_DEFAULTS.fade_out, (x) => setMusic("fade_out", x), { min: 0, max: 10, step: 0.1 })),
      field("Konuşurken", slider(m.duck ?? MUSIC_DEFAULTS.duck, "Konuşma sırasında kalan müzik düzeyi", (x) => setMusic("duck", x))),
      field("Döngü", (() => {
        const c = el("input", { type: "checkbox" });
        c.checked = m.loop ?? MUSIC_DEFAULTS.loop;
        c.addEventListener("change", () => setMusic("loop", c.checked ? undefined : false));
        return c;
      })()),
      el("div", { class: "row-inline" },
        el("button", { class: "btn small", type: "button", on: { click: () => listen(`/kutuphane/muzik/${m.track}.wav`) } }, "▶ Parçayı dinle"),
        el("button", { class: "btn small danger", type: "button", on: { click: () => { delete ep.music; ctx.changed(true); } } }, "Müziği kaldır")),
    ]
    : [el("p", { class: "muted small", text: v.music.length ? "Müzik yok. Soldaki Müzik panelinde bir parçanın yanındaki “Kullan” ile ekle." : "Kütüphanede müzik yok (library/muzik)." })];
  return el("div", {},
    el("button", { class: "btn small back", type: "button", on: { click: () => ctx.select(null) } }, "← Shot'a dön"),
    el("h2", { text: "Bölüm ayarları" }),
    el("p", { class: "muted small", text: "Bütün bölüm için: her shot'ta geçerli." }),
    el("h3", { text: "Ses düzeyleri", title: "Dinlerken sessize almak ya da tek başına dinlemek için zaman çizelgesindeki M / S düğmeleri." }),
    field("Replikler", slider(ep.mix?.lines ?? 1, "Repliklerin düzeyi", (x) => setMix("lines", x))),
    field("Efektler", slider(ep.mix?.sfx ?? 1, "Efektlerin düzeyi", (x) => setMix("sfx", x))),
    el("h3", { text: "Müzik" }),
    musicPart,
    el("h3", { text: "Sesler", title: "Değişen ses ayarı o karakterin repliklerini yeniden seslendirmeyi gerektirir" }),
    el("p", { class: "muted small", text: "İfade: sesin canlılığı. Düzgünlük: düşükse kelimeler bozulabilir. Örnek, kayıtlı ayarlarla tek bir cümle seslendirir; onay gerekmez." }),
    voices(ep, ctx),
    el("h3", { text: "Altyazı" }),
    episodeCaption(ep, ctx.labelOf, () => ctx.changed(true)),
    el("h3", { text: "3B görünüm", title: "Yalnız 3B render ve 3B önizleme için; 2B'yi etkilemez" }),
    field("Stil", select(ep.stil3d, LOOKS_3D.slice(1), (val) => { setKey(ep, "stil3d", val === "toon" ? undefined : val); ctx.changed(true); }, { empty: "Toon + kontur (varsayılan)" })));
}
