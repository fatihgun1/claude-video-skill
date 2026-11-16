// Bölüm ayarları: the right panel's view of what belongs to the whole episode, not to a shot:
// track levels (episode.mix), the background music (episode.music) and the captions (off, or
// edged with the speaker's colour). Opened from the top bar, the timeline's Mikser or its
// music clip; "← Shot'a dön" goes back to the selected shot.
import { el, select, number, field, setKey } from "./dom.js";
import { listen } from "./dinle.js";
import { MUSIC_DEFAULTS } from "./muzik.mjs";
import { episodeCaption } from "./altyazi-ayar.js";

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
    el("h3", { text: "Altyazı" }),
    episodeCaption(ep, ctx.labelOf, () => ctx.changed(true)));
}
