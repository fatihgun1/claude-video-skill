// Stage: the compiled preview scaled into the stage, the transport (play, time, frame steps)
// and the preview's sound. The composition lists its sounds as <audio data-start …> (lines
// and effects, exactly what the render plays); the panel plays copies of them in step with
// the clock, so what is heard matches what is seen.
import { seconds } from "./dom.js";

const FRAME = 1 / 30;
/** Which track a sound of the composition belongs to, by the id the compiler gives it. */
export const trackOf = (id) => (id === "muzik" ? "music" : id.startsWith("efekt-") ? "sfx" : "lines");
const VIEWPORTS = { "16:9": { width: 1920, height: 1080 }, "9:16": { width: 1080, height: 1920 } };
const DRIFT_S = 0.25; // resync a sound that drifted further than this from the clock

/** Which shot a validation message is about ("shot s1_sh2: …" or "film: shot s1_sh2: …"). */
export function shotOfMessage(msg) {
  const m = /(?:^|: )shot ([a-z0-9_-]+)/.exec(msg);
  return m ? m[1] : null;
}

/**
 * @param {Record<string, HTMLElement>} els frame, stage, over, play, time, clock, mute
 * @param {{onTime:(t:number, playing:boolean) => void, onLoad?:(doc:Document) => void, onFit?:() => void}} ctx
 */
export function createStage(els, ctx) {
  let timing = null; // the last good preview: {duration, shots, rules}
  let playing = false;
  let muted = false;
  let clips = []; // {audio, start, end}
  let audioBatch = 0;

  const duration = () => timing?.duration || 0;
  const player = () => {
    try {
      return els.frame.contentWindow?.__hfAnime?.[0] || null;
    } catch {
      return null;
    }
  };

  let viewport = VIEWPORTS["16:9"];
  let loading = false; // a new preview is on its way: positions read from the old one would be wrong

  /** Page pixels per preview pixel (the preview is drawn at full size and scaled down). */
  const scale = () => els.stage.clientWidth / viewport.width;

  function fit() {
    els.frame.style.width = `${viewport.width}px`;
    els.frame.style.height = `${viewport.height}px`;
    els.frame.style.transform = `scale(${scale()})`;
    ctx.onFit?.();
  }

  /** Show the stage in another format (the next preview is compiled for it). */
  function setFormat(format) {
    loading = true; // the document on screen is still the other format until the next preview loads
    viewport = VIEWPORTS[format] || VIEWPORTS["16:9"];
    els.stage.dataset.format = format;
    fit();
  }

  function now() {
    return Number(els.time.value) / 1000;
  }

  /** Start, stop or re-align every sound for time t. */
  /** Mute and solo per track, for listening only (the episode does not change). */
  const tracks = { muted: new Set(), solo: new Set() };
  const audible = (track) => !tracks.muted.has(track) && (!tracks.solo.size || tracks.solo.has(track));

  function syncAudio(t) {
    for (const c of clips) {
      const want = t - c.start;
      // The file may be a little shorter than its listed length: an ended sound is not restarted.
      if (playing && !muted && audible(c.track) && t >= c.start && t < c.end && want < (c.audio.duration || Infinity)) {
        if (c.audio.paused) {
          c.audio.currentTime = want;
          c.audio.play().catch(() => {}); // a blocked play stays silent, the picture goes on
        } else if (Math.abs(c.audio.currentTime - want) > DRIFT_S) c.audio.currentTime = want;
      } else if (!c.audio.paused) c.audio.pause();
    }
  }

  function seek(t) {
    const s = Math.min(Math.max(0, t), duration());
    els.time.value = String(Math.round(s * 1000));
    els.clock.textContent = seconds(s);
    player()?.seek(s * 1000);
    syncAudio(s);
    ctx.onTime(s, playing);
  }

  /**
   * Copy the composition's sounds. Each file is loaded whole into memory first: the panel's
   * server sends files without byte ranges, and a sound streamed that way cannot be
   * moved to a time, it would restart from zero on every resync.
   */
  function takeAudio(doc) {
    const batch = ++audioBatch;
    for (const c of clips) {
      c.audio.pause();
      if (c.audio.src.startsWith("blob:")) URL.revokeObjectURL(c.audio.src);
    }
    clips = [];
    for (const a of doc.querySelectorAll("audio[data-start]")) {
      const start = Number(a.dataset.start);
      const clip = { audio: new Audio(), start, end: start + Number(a.dataset.duration), track: trackOf(a.id) };
      clip.audio.volume = Math.min(1, Math.max(0, Number(a.dataset.volume ?? 1)));
      fetch(a.src)
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((blob) => {
          if (batch !== audioBatch) return; // a newer preview replaced these sounds
          clip.audio.src = URL.createObjectURL(blob);
          clips.push(clip);
          syncAudio(now());
        })
        .catch(() => {}); // a missing sound stays silent; the validator reports missing audio
    }
  }

  function load(preview) {
    if (!preview?.ok) {
      els.over.hidden = false;
      els.over.textContent = preview?.error ? `Önizleme yok: ${preview.error}` : "Önizleme yok.";
      // Nothing of a previously open episode may stay on the stage or the timeline.
      timing = null;
      toggle(false);
      takeAudio(document.implementation.createHTMLDocument(""));
      els.frame.onload = null;
      els.frame.src = "about:blank";
      els.time.max = "0";
      seek(0);
      return;
    }
    els.over.hidden = true;
    timing = { duration: preview.duration, shots: preview.shots, rules: preview.rules };
    els.time.max = String(Math.round(preview.duration * 1000));
    loading = true;
    els.frame.onload = () => {
      loading = false;
      // The composition takes its size from the renderer; outside it, give the page the video's size.
      const doc = els.frame.contentDocument;
      doc.head.append(Object.assign(doc.createElement("style"), { textContent: `html, body { width: ${viewport.width}px; height: ${viewport.height}px; }` }));
      takeAudio(doc);
      ctx.onLoad?.(doc);
      seek(now()); // the clock may have run on while the new preview loaded
    };
    els.frame.src = `${preview.url}?v=${Date.now()}`;
  }

  function shotTime(id) {
    return timing?.shots.find((t) => t.shot_id === id) || null;
  }

  function tick(prev) {
    if (!playing) return;
    requestAnimationFrame(() => {
      if (!playing) return;
      const t = performance.now(); // the same clock the sounds run on, not the frame's start
      const next = now() + (t - prev) / 1000;
      if (next >= duration()) {
        seek(duration());
        toggle(false);
        return;
      }
      seek(next);
      tick(t);
    });
  }

  function toggle(on = !playing) {
    playing = on && duration() > 0;
    els.play.textContent = playing ? "❚❚" : "▶";
    els.play.setAttribute("aria-label", playing ? "Durdur" : "Oynat");
    if (playing) {
      if (now() >= duration()) seek(0);
      tick(performance.now());
    }
    syncAudio(now());
    ctx.onTime(now(), playing);
  }

  function setMuted(on) {
    muted = on;
    els.mute.textContent = muted ? "🔇" : "🔊";
    els.mute.setAttribute("aria-label", muted ? "Sesi aç" : "Sesi kapat");
    els.mute.setAttribute("aria-pressed", String(muted));
    syncAudio(now());
  }

  els.time.addEventListener("input", () => { toggle(false); seek(now()); });
  els.play.addEventListener("click", () => toggle());
  els.mute.addEventListener("click", () => setMuted(!muted));
  new ResizeObserver(fit).observe(els.stage);
  fit();

  return {
    load, seek, now, toggle, shotTime, setFormat, scale,
    /** Mute or solo a track ("lines", "sfx", "music") in the preview. */
    setTrack(track, { mute, solo }) {
      for (const [set, on] of [[tracks.muted, mute], [tracks.solo, solo]]) {
        if (on === undefined) continue;
        if (on) set.add(track);
        else set.delete(track);
      }
      syncAudio(now());
    },
    trackState: (track) => ({ mute: tracks.muted.has(track), solo: tracks.solo.has(track) }),
    /** The preview's own copy of a sound (a line: "ses-<shot>-<n>"), for listening to it alone. */
    soundUrl: (id) => {
      const a = els.frame.contentDocument?.getElementById(id);
      return a?.src || null;
    },
    /** The preview's document once loaded (same origin), else null. */
    doc: () => {
      if (loading) return null;
      try {
        const d = els.frame.contentDocument;
        return d && d.getElementById("kamera") ? d : null;
      } catch {
        return null;
      }
    },
    timing: () => timing,
    playing: () => playing,
    step: (frames) => { toggle(false); seek(now() + frames * FRAME); },
  };
}
