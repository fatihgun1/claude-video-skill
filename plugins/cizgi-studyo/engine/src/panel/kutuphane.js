// Library browser: one tab per kind of asset, cards with real thumbnails, hover previews
// for actions, listening for sounds, and framing diagrams for the camera. A click hands the
// choice to the app (ctx.pick), which decides what it changes; the browser never edits.
import { el, svg } from "./dom.js";
import { listen, stop as stopSound, isPlaying, rebind } from "./dinle.js";

const TABS = [
  ["karakter", "Karakter"], ["hareket", "Hareket"], ["mekan", "Mekân"],
  ["nesne", "Nesne"], ["ses", "Ses"], ["kamera", "Kamera"],
];
/** Every action a cast member plays in its shot (its own, then its sequence). */
const segmentActions = (m) => [m.action, ...(m.actions || []).map((x) => x.action)];
const VIEW_TEXT = {
  front: "önden", "profile-right": "profil", "three-quarter-right": "önden 3/4", "back-three-quarter-right": "arkadan 3/4",
};

/* ---------- character thumbnails cropped to the drawing ---------- */
const thumbCache = new Map();
export function rigThumb(id) {
  if (!thumbCache.has(id)) thumbCache.set(id, cropRig(id).catch(() => `/kutuphane/karakter/${id}.svg`));
  return thumbCache.get(id);
}
async function cropRig(id) {
  const text = await (await fetch(`/kutuphane/karakter/${id}.svg`)).text();
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = doc.documentElement;
  if (root.nodeName !== "svg") throw new Error("not an svg");
  // Measure the drawn shapes once, off screen, then crop the viewBox to them.
  const host = el("div", { style: { position: "absolute", left: "-10000px", top: "0", width: "1000px", height: "1000px" } });
  const live = document.importNode(root, true);
  live.setAttribute("width", "1000");
  live.setAttribute("height", "1000");
  host.append(live);
  document.body.append(host);
  try {
    const box = (live.querySelector("#root") || live).getBBox();
    const pad = 24;
    const w = box.width + 2 * pad, h = box.height + 2 * pad;
    root.setAttribute("viewBox", `${box.x - pad} ${box.y - pad} ${w} ${h}`);
    // An <img> needs the intrinsic size too, or it guesses 300×150 and crops the figure.
    root.setAttribute("width", String(Math.round(w)));
    root.setAttribute("height", String(Math.round(h)));
  } finally {
    host.remove();
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(root))}`;
}

/* ---------- camera diagrams ---------- */
function framingDiagram(f) {
  const W = 160, H = 90;
  const zoom = f.zoom || 1;
  const cy = f.anchor === "face" ? 34 : f.anchor === "chest" ? 44 : 50;
  const w = W / zoom, h = H / zoom;
  return svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "diagram", "aria-hidden": "true" },
    svg("rect", { x: 0, y: 0, width: W, height: H, fill: "#2c303a" }),
    svg("line", { x1: 0, y1: 78, x2: W, y2: 78, stroke: "#4a5060", "stroke-width": 2 }),
    svg("circle", { cx: 80, cy: 30, r: 9, fill: "#e9eaef" }),
    svg("path", { d: "M80 40 L80 62 M68 48 L92 48 M80 62 L72 78 M80 62 L88 78", stroke: "#e9eaef", "stroke-width": 4, "stroke-linecap": "round", fill: "none" }),
    svg("rect", { x: 80 - w / 2, y: Math.max(0, Math.min(H - h, cy - h / 2)), width: w, height: h, fill: "none", stroke: "#f2a541", "stroke-width": 3, rx: 3 }),
  );
}
function moveDiagram(m) {
  const W = 160, H = 90;
  const box = (z, dx, dash) => svg("rect", {
    x: 80 - W / z / 2 * 0.86 + dx, y: 45 - H / z / 2 * 0.86, width: W / z * 0.86, height: H / z * 0.86,
    fill: "none", stroke: dash ? "#979dab" : "#f2a541", "stroke-width": 3, "stroke-dasharray": dash ? "6 5" : null, rx: 3,
  });
  const z0 = m.zoom_from ?? 1, z1 = m.zoom_to ?? (m.dolly_to ? 1.5 : z0);
  const p0 = (m.pan_from ?? 0) * 500, p1 = (m.pan_to ?? 0) * 500;
  const kids = [svg("rect", { x: 0, y: 0, width: W, height: H, fill: "#2c303a" })];
  if (z0 === z1 && p0 === p1) kids.push(box(1.12, 0, false));
  else kids.push(box(z0, p0, true), box(z1, p1, false));
  if (p0 !== p1) kids.push(svg("path", { d: `M${80 + p0 / 2} 45 L${80 + p1 / 2} 45`, stroke: "#4fb8a0", "stroke-width": 3, "marker-end": "url(#ok)" }));
  return svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "diagram", "aria-hidden": "true" },
    svg("defs", {}, svg("marker", { id: "ok", viewBox: "0 0 10 10", refX: 5, refY: 5, markerWidth: 4, markerHeight: 4, orient: "auto" },
      svg("path", { d: "M0 0 L10 5 L0 10 Z", fill: "#4fb8a0" }))),
    kids);
}

/* ---------- action hover previews ---------- */
/** Compiled action previews by query, for this page's life (the server also keeps them). */
const previewCache = new Map();

function attachActionPreview(card, thumb, q, onFit) {
  let timer = 0, raf = 0, frame = null;
  let hover = 0; // bumped on every enter and leave: an answer for an earlier hover is dropped
  const stop = () => {
    hover++;
    clearTimeout(timer);
    cancelAnimationFrame(raf);
    frame?.remove();
    frame = null;
  };
  const start = () => {
    stop();
    const mine = ++hover;
    timer = setTimeout(async () => {
      const key = new URLSearchParams(q).toString();
      let res = previewCache.get(key);
      if (!res) {
        res = await fetch(`/api/hareket?${key}`).then((r) => r.json()).catch((e) => ({ ok: false, error: e.message }));
        if (res.ok) previewCache.set(key, res);
      }
      onFit(res);
      if (!res.ok || mine !== hover) return; // left (or re-entered) while it compiled
      frame = el("iframe", { src: res.url, title: "Hareket önizlemesi", tabindex: "-1" });
      // The 16:9 preview fills the card's width and sits in the middle of its height.
      const k = thumb.clientWidth / 1920;
      frame.style.transform = `translateY(${(thumb.clientHeight - 1080 * k) / 2}px) scale(${k})`;
      thumb.append(frame);
      frame.addEventListener("load", () => {
        const t0 = performance.now();
        const step = (now) => {
          const p = frame?.contentWindow?.__hfAnime?.[0];
          if (!p) return;
          const t = ((now - t0) / 1000) % Math.max(0.1, res.duration);
          p.seek(t * 1000);
          raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
      });
    }, 250);
  };
  card.addEventListener("mouseenter", start);
  card.addEventListener("focus", start);
  card.addEventListener("mouseleave", stop);
  card.addEventListener("blur", stop);
}

/* ---------- the browser ---------- */
/**
 * @param {{tabs:HTMLElement, cards:HTMLElement, search:HTMLInputElement, hint:HTMLElement}} els
 * @param {{vocab:() => object, context:() => object, pick:(kind:string, id:string, how?:string) => void}} ctx
 */
export function createLibrary(els, ctx) {
  let tab = "karakter";
  let query = "";
  const fits = new Map(); // "rig|action" -> {ok, error}

  els.search.addEventListener("input", () => {
    query = els.search.value.trim().toLocaleLowerCase("tr");
    render();
  });

  function renderTabs() {
    els.tabs.replaceChildren(...TABS.map(([id, text]) =>
      el("button", { class: "tab", role: "tab", "aria-selected": String(id === tab), on: { click: () => {
        if (id !== tab) stopSound(); // a sound from the Ses tab does not play on under another tab
        tab = id;
        render();
      } } }, text)));
  }

  const matches = (o) => !query || `${o.label} ${o.id}`.toLocaleLowerCase("tr").includes(query);

  function card(o, { thumb, current, onClick, extra, wide }) {
    const t = el("div", { class: `thumb${wide ? " wide" : ""}` }, thumb);
    const c = el("button", { class: `card${current ? " current" : ""}`, title: o.id, "aria-pressed": String(!!current), on: { click: onClick } },
      t, el("span", { class: "name", text: o.label }), extra);
    return { c, t };
  }

  function characters(v, cx) {
    const people = new Map();
    for (const r of v.rigs.filter(matches)) people.set(r.person, [...(people.get(r.person) || []), r]);
    const out = [];
    for (const [person, rigs] of people) {
      out.push(el("div", { class: "group-title", text: rigs.find((r) => r.id === person)?.label.replace(/\s*\(.*\)$/, "") || person }));
      for (const r of rigs) {
        const img = el("img", { alt: "", loading: "lazy" });
        rigThumb(r.id).then((src) => { img.src = src; });
        out.push(card(r, {
          thumb: img, current: cx.member && cx.rigOf(cx.member.id) === r.id,
          extra: el("span", { class: "meta", text: VIEW_TEXT[r.view] || r.view }),
          onClick: () => ctx.pick("karakter", r.id),
        }).c);
      }
    }
    return out;
  }

  function actions(v, cx) {
    const rig = cx.actor ? cx.rigOf(cx.actor.id) : null;
    const view = rig ? v.rigs.find((r) => r.id === rig)?.view || "front" : null;
    // Only actions drawn for this view; the one the actor already has stays visible (the
    // validator warns about it) so the card can still show what is set.
    const forView = (a) => !view || !a.views || a.views.includes(view) || (cx.actor && segmentActions(cx.actor).includes(a.id));
    return v.actions.filter(matches).filter(forView).map((a) => {
      const key = `${rig}|${a.id}`;
      const fit = fits.get(key);
      const img = el("img", { alt: "" });
      if (rig) rigThumb(rig).then((src) => { img.src = src; });
      const why = el("span", { class: "why", text: fit && !fit.ok ? fit.error : "" });
      const add = el("button", {
        class: "btn small add", type: "button", disabled: !rig,
        title: "Oynatma kafasının olduğu anda bu hareketi başlat (öncekinden sonra)",
        on: { click: (e) => { e.stopPropagation(); ctx.pick("hareket-ekle", a.id); } },
      }, "+ Ekle");
      const { c, t } = card(a, {
        thumb: [img, el("span", { class: "badge", text: `${a.duration}s${a.loop ? " ↻" : ""}` })],
        current: cx.actor && segmentActions(cx.actor).includes(a.id),
        extra: why,
        onClick: () => ctx.pick("hareket", a.id),
      });
      const wrap = el("div", { class: "card-wrap" }, c, add); // a button cannot sit inside the card's button
      if (fit && !fit.ok) c.classList.add("unfit");
      const wrongView = view && a.views && !a.views.includes(view) ? `${VIEW_TEXT[view] || view} çizime uymuyor` : "";
      if (wrongView) {
        c.classList.add("unfit");
        why.textContent = wrongView;
      }
      if (rig) attachActionPreview(c, t, { rig, action: a.id, bg: cx.scene?.bg || "" }, (res) => {
        fits.set(key, res);
        c.classList.toggle("unfit", !res.ok || !!wrongView);
        why.textContent = res.ok ? wrongView : res.error;
      });
      return wrap;
    });
  }

  function backgrounds(v, cx) {
    return v.backgrounds.filter(matches).map((b) => card(b, {
      wide: true,
      thumb: el("img", { alt: "", loading: "lazy", src: `/kutuphane/mekan/${b.id}.svg` }),
      current: cx.scene?.bg === b.id,
      extra: el("span", { class: "meta", text: b.depth ? "derinlikli (ileri dolly)" : "yandan" }),
      onClick: () => ctx.pick("mekan", b.id),
    }).c);
  }

  function props(v, cx) {
    return v.props.filter(matches).map((p) => {
      const { c } = card(p, {
        thumb: el("img", { alt: "", loading: "lazy", src: `/kutuphane/nesne/${p.id}.svg` }),
        current: cx.prop?.prop === p.id,
        extra: el("span", { class: "meta", text: p.holdable ? "elde tutulabilir" : "dekor" }),
        onClick: () => ctx.pick("nesne", p.id),
      });
      // decor: stands in the scene for all its shots, behind the characters
      const add = el("button", {
        class: "btn small add", type: "button", disabled: !cx.scene, title: "Sahneye dekor olarak koy (bütün shot'larında, karakterlerin arkasında)",
        on: { click: (e) => { e.stopPropagation(); ctx.pick("dekor", p.id); } },
      }, "+ Dekor");
      return el("div", { class: "card-wrap" }, c, add); // a button cannot sit inside the card's button
    });
  }

  const soundUrl = (id) => `/kutuphane/ses/${id}.wav`;
  const showPlaying = (btn, on) => {
    btn.textContent = on ? "■" : "▶";
    btn.setAttribute("aria-pressed", String(on));
  };

  function playUrl(url, btn) {
    if (isPlaying(url)) return stopSound();
    listen(url, () => showPlaying(btn, false));
    showPlaying(btn, true);
  }

  /** A ▶/■ button for one library sound, still right after the list is redrawn. */
  function playButton(url, label) {
    const btn = el("button", { class: "play", "aria-label": `${label} dinle`, text: "▶" });
    if (isPlaying(url)) {
      showPlaying(btn, true); // the list was redrawn while this sound plays
      rebind(url, () => showPlaying(btn, false));
    }
    btn.addEventListener("click", () => playUrl(url, btn));
    return btn;
  }

  function sounds(v, cx) {
    const fx = v.sfx.filter(matches).map((s) => el("div", { class: "card sound" },
      playButton(soundUrl(s.id), s.label),
      el("div", {}, el("div", { class: "name", text: s.label }), el("div", { class: "meta", text: `${s.id} · ${s.duration}s` })),
      el("button", { class: "btn small", disabled: !cx.shot, title: "Oynatma kafasının olduğu ana ekle", on: { click: () => ctx.pick("ses", s.id) } }, "+ Ekle")));
    const current = cx.musicTrack;
    const music = v.music.filter(matches).map((m) => el("div", { class: `card sound${current === m.id ? " current" : ""}` },
      playButton(`/kutuphane/muzik/${m.id}.wav`, m.label),
      el("div", {}, el("div", { class: "name", text: m.label }), el("div", { class: "meta", text: `müzik · ${m.duration}s` })),
      el("button", { class: "btn small", title: "Bölümün arka plan müziği yap", disabled: current === m.id, on: { click: () => ctx.pick("muzik", m.id) } }, current === m.id ? "Kullanılıyor" : "Kullan")));
    return [
      el("div", { class: "group-title", text: "Müzik" }),
      ...(music.length ? music : [el("p", { class: "muted small", text: "Kütüphanede müzik yok (library/muzik)." })]),
      el("div", { class: "group-title", text: "Efektler" }),
      ...fx,
    ];
  }

  function camera(v, cx) {
    const cam = cx.shot?.camera || {};
    return [
      el("div", { class: "group-title", text: "Plan" }),
      ...v.framings.filter(matches).map((f) => card(f, {
        wide: true, thumb: framingDiagram(f), current: cam.framing === f.id,
        extra: el("span", { class: "meta", text: `yakınlık ${f.zoom}×` }),
        onClick: () => ctx.pick("kamera-plan", f.id),
      }).c),
      el("div", { class: "group-title", text: "Hareket" }),
      ...v.moves.filter(matches).map((m) => card(m, {
        wide: true, thumb: moveDiagram(m), current: (cam.move || "static") === m.id,
        onClick: () => ctx.pick("kamera-hareket", m.id),
      }).c),
    ];
  }

  function hint(cx) {
    const who = cx.member ? cx.labelOf(cx.member.id) : null;
    const actor = cx.actor ? cx.labelOf(cx.actor.id) : null;
    switch (tab) {
      case "karakter": return who ? `${who} yerine konacak karakteri seç.` : "Tıklanan karakter seçili shot'a eklenir.";
      case "hareket": return actor
        ? `${actor} için. Tıkla: seçili hareketi değiştir · + Ekle: oynatma kafasında yeni hareket başlat. Önizlemek için üzerine gel.`
        : "Önce sağdan bir oyuncu seç.";
      case "mekan": return cx.scene ? `"${cx.scene.scene_id}" sahnesinin bütün shot'larına uygulanır.` : "";
      case "nesne": return cx.prop ? `"${cx.prop.id}" yerine konacak nesneyi seç.` : "Tıklanan nesne seçili shot'a eklenir · + Dekor: sahnenin bütün shot'larında, karakterlerin arkasında durur.";
      case "ses": return "▶ dinle. Müzik: Kullan ile bütün bölümün altına. Efekt: + Ekle ile oynatma kafasının olduğu ana.";
      case "kamera": return cx.shot ? `${cx.shot.shot_id} shot'ının kamerası.` : "";
      default: return "";
    }
  }

  function render() {
    const v = ctx.vocab();
    if (!v) return;
    const cx = ctx.context();
    renderTabs();
    els.hint.textContent = hint(cx);
    const build = { karakter: characters, hareket: actions, mekan: backgrounds, nesne: props, ses: sounds, kamera: camera }[tab];
    const list = [...build(v, cx), ...(ctx.extra ? ctx.extra(tab) : [])]; // drafts under Mekân and Nesne, the effect request under Ses
    els.cards.className = `cards${["mekan", "ses", "kamera"].includes(tab) ? " wide" : ""}`;
    els.cards.replaceChildren(...(list.length ? list : [el("p", { class: "empty", text: "Sonuç yok." })]));
  }

  return { render, show(name) { tab = name; render(); } };
}
