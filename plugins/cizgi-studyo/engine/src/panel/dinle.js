// One player for every "listen" button in the panel: starting a sound stops the one before,
// and whoever started a sound is told when it stops (ended, replaced or stopped).

let audio = null;
let current = null; // the url playing
let onStop = null;

/** Stop whatever is playing. */
export function stop() {
  audio?.pause();
  audio = null;
  current = null;
  const done = onStop;
  onStop = null;
  done?.();
}

/**
 * Play a sound; `stopped` runs once when it ends or is stopped.
 * @param {string} url
 * @param {() => void} [stopped]
 */
export function listen(url, stopped) {
  stop();
  const a = new Audio(url);
  audio = a;
  current = url;
  onStop = stopped || null;
  a.addEventListener("ended", () => { if (audio === a) stop(); });
  a.play().catch(() => { if (audio === a) stop(); });
}

/** Whether this url is the one playing (a re-drawn button can show ■ again). */
export const isPlaying = (url) => current === url;

/** Let a re-drawn button take over the "stopped" callback of the sound it shows. */
export function rebind(url, stopped) {
  if (current === url) onStop = stopped;
}
