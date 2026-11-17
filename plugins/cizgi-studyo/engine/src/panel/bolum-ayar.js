// Bölüm ayarları: the right panel's view of what belongs to the whole episode, not to a shot:
// track levels (episode.mix), the background music (episode.music), the captions (off, or
// edged with the speaker's colour), the voices and the 3D look. A settings page: titled
// sections with one line each, most used first, the rare one folded. Opened from the top bar,
// the timeline's Ses düzeyleri or its music clip; "← Shot'a dön" goes back to the selected shot.
import { el, select, number, setKey } from "./dom.js";
import { listen } from "./dinle.js";
import { MUSIC_DEFAULTS } from "./muzik.mjs";
import { episodeCaption } from "./altyazi-ayar.js";
import { header, section, folded, labelled, valueSlider, withUnit, check, dangerButton } from "./denetleyici-alan.js";

/** The looks a 3D render can take (schema: stil3d); the first is the default (no key). */
const LOOKS_3D = [
  { id: "toon", label: "Toon + kontur" }, { id: "yumusak", label: "Yumuşak gölgeli" },
  { id: "pastel", label: "Pastel" }, { id: "golge", label: "Toon + gölge, kontursuz" },
];

const twoDecimals = (x) => x.toFixed(2);

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
    const status = el("span", { class: "muted small", role: "status" });
    return el("div", { class: "voice-row" },
      el("b", { text: sp.label }),
      labelled("İfade", valueSlider(v.exaggeration ?? 0.5, { min: 0.25, max: 1.5, label: `${sp.label}: ifade gücü`, show: twoDecimals, onSet: (x) => set("exaggeration", x, 0.5) })),
      labelled("Düzgünlük", valueSlider(v.cfg ?? 0.5, { min: 0.4, max: 1, label: `${sp.label}: düzgünlük`, show: twoDecimals, onSet: (x) => set("cfg", x, 0.5) })),
      v.ref ? el("p", { class: "field-hint", text: `Örnek kayıt: ${v.ref}` }) : null,
      el("div", { class: "row-inline" },
        el("button", { class: "btn small", type: "button", disabled: !ctx.sample, on: { click: () => ctx.sample(sp.id, (t) => { status.textContent = t; }) } }, "▶ Örnek dinle"),
        status));
  });
}

/** The music section's controls, or how to add music when there is none. */
function musicPart(ep, v, changed) {
  const m = ep.music;
  if (!m) {
    return [el("p", { class: "isec-empty", text: v.music.length ? "Müzik yok. Soldaki Müzik panelinde bir parçanın yanındaki “Kullan” ile ekle." : "Kütüphanede müzik yok (library/muzik)." })];
  }
  const setMusic = (key, val) => { setKey(ep.music, key, val); changed(); };
  const trackName = v.music.find((x) => (x.id ?? x) === m.track)?.label || m.track;
  const fade = (key, label) => withUnit(number(m[key] ?? MUSIC_DEFAULTS[key], (x) => setMusic(key, x), { min: 0, max: 10, step: 0.1 }), "s", label);
  return [
    labelled("Parça", select(m.track, v.music, (val) => setMusic("track", val))),
    labelled("Düzey", valueSlider(m.volume ?? MUSIC_DEFAULTS.volume, { label: "Müzik düzeyi", onSet: (x) => setMusic("volume", x) })),
    labelled("Konuşurken", valueSlider(m.duck ?? MUSIC_DEFAULTS.duck, { label: "Konuşma sırasında kalan müzik düzeyi", onSet: (x) => setMusic("duck", x) }), "Biri konuşurken müziğin kalan düzeyi."),
    el("div", { class: "ipair" },
      labelled("Giriş", fade("fade_in", "Müziğin girişi (saniye)")),
      labelled("Çıkış", fade("fade_out", "Müziğin çıkışı (saniye)"))),
    check("Bitince baştan çal", m.loop ?? MUSIC_DEFAULTS.loop, (on) => setMusic("loop", on ? undefined : false)),
    el("div", { class: "row-inline" },
      el("button", { class: "btn small", type: "button", on: { click: () => listen(`/kutuphane/muzik/${m.track}.wav`) } }, "▶ Parçayı dinle"),
      el("span", { class: "spacer" }),
      dangerButton("Müziği kaldır", `“${trackName}” bölümden kaldırılsın mı?`, () => { delete ep.music; changed(); })),
  ];
}

/**
 * @param {{episode:() => object, vocab:() => object, labelOf:(id:string) => string,
 *          changed:(structural?:boolean) => void, select:(kind:string|null) => void,
 *          sample?:(speaker:string, status:(text:string) => void) => void}} ctx
 * @returns {HTMLElement}
 */
export function episodeSettings(ctx) {
  const ep = ctx.episode();
  const v = ctx.vocab();
  const changed = () => ctx.changed(true);
  const setMix = (key, val) => {
    const mix = { ...(ep.mix || {}), [key]: val };
    if (val === 1) delete mix[key];
    setKey(ep, "mix", Object.keys(mix).length ? mix : undefined);
    changed();
  };
  return el("div", { class: "iview" },
    header({ back: { text: "← Shot'a dön", onClick: () => ctx.select(null) }, kind: "Bölüm", title: "Bölüm ayarları", meta: "Bütün bölüm için: her shot'ta geçerli." }),
    section("Ses düzeyleri", "Bütün repliklerin ve efektlerin düzeyi. Dinlerken susturmak için zaman çizelgesindeki M / S.",
      labelled("Replikler", valueSlider(ep.mix?.lines ?? 1, { max: 2, label: "Repliklerin düzeyi", onSet: (x) => setMix("lines", x) })),
      labelled("Efektler", valueSlider(ep.mix?.sfx ?? 1, { label: "Efektlerin düzeyi", onSet: (x) => setMix("sfx", x) }))),
    section("Müzik", "Bölümün arkasında çalan parça.", musicPart(ep, v, changed)),
    section("Altyazı", "Bütün bölümün altyazıları. Yeri ve boyutu sahnenin ayarlarında.",
      episodeCaption(ep, ctx.labelOf, changed)),
    section("Sesler", "Bir ses ayarı değişirse o karakterin replikleri yeniden seslendirilmeli.",
      el("p", { class: "field-hint", text: "İfade: sesin canlılığı. Düzgünlük: düşükse kelimeler bozulabilir. Örnek, kayıtlı ayarlarla tek bir cümle seslendirir; onay gerekmez." }),
      voices(ep, ctx)),
    folded("3B görünüm", "Yalnız 3B render ve 3B önizleme için; 2B'yi etkilemez.",
      labelled("Stil", select(ep.stil3d, LOOKS_3D.slice(1), (val) => { setKey(ep, "stil3d", val === "toon" ? undefined : val); changed(); }, { empty: "Toon + kontur (varsayılan)" }))));
}
