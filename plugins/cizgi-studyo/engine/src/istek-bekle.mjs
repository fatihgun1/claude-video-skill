/**
 * Waiting for the panel while the session is idle (`cizgi istek-bekle`).
 *
 * A Claude session that ends its turn cannot be woken by the panel: the hooks run only when a turn
 * ends or the person writes in the chat, so a request sent from the panel sat "Sırada" until then
 * (Hurda Kralı 1 and 2). The session therefore leaves this command running in the background when it
 * ends a turn with the panel open. It exits as soon as a request waits in the queue, and the finished
 * background command brings the session back to take it (panel_istekleri).
 */
import { readRequests, forSession } from "./istekler.mjs";

const POLL_MS = 1000;
const defaultSleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/**
 * The waiting requests of the queue as soon as there is one, or null when none came within timeoutMs.
 * @param {string} file the queue file (istekler.mjs queueOf)
 * @param {{session?:string, timeoutMs?:number, intervalMs?:number, now?:() => number, sleep?:(ms:number) => Promise<void>}} [opts]
 * @returns {Promise<object[]|null>}
 */
export async function waitForRequest(file, { session, since, timeoutMs = 3_600_000, intervalMs = POLL_MS, now = Date.now, sleep = defaultSleep } = {}) {
  const until = now() + timeoutMs;
  // only what comes after `since`: an old request still waiting (another day, another session) would
  // wake the session again and again; the Stop hook already tells it what waited when its turn ended
  const after = since ? since.getTime() : -Infinity;
  const fresh = (r) => Date.parse(r.at) >= after;
  for (;;) {
    const waiting = readRequests(file).filter((r) => r.durum === "bekliyor" && forSession(r, session) && fresh(r));
    if (waiting.length) return waiting;
    if (now() >= until) return null;
    await sleep(intervalMs);
  }
}
