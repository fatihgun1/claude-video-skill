/**
 * One voice job at a time on this computer: the panel's audio job and a `cizgi ses` Claude starts
 * must not run together (two ran at once and froze the machine). The lock is a file
 * ~/.cizgi-studyo/ses.lock holding {pid, bolum, since}; a lock whose process is gone is stale.
 * A second job waits for the first, then gives up with a clear message.
 */
import { openSync, writeSync, closeSync, readFileSync, unlinkSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const LOCK_WAIT_MS = 10 * 60 * 1000;
const POLL_MS = 500;

export const defaultLockPath = () => join(homedir(), ".cizgi-studyo", "ses.lock");

/** Whether a process is still running (EPERM: it runs, under another user). */
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** The lock's holder, or null when there is none or it is unreadable. */
export function lockHolder(lockPath) {
  try {
    const held = JSON.parse(readFileSync(lockPath, "utf8"));
    return held && typeof held === "object" ? held : null;
  } catch {
    return null;
  }
}

function tryTake(lockPath, bolum) {
  try {
    const fd = openSync(lockPath, "wx");
    writeSync(fd, JSON.stringify({ pid: process.pid, bolum, since: new Date().toISOString() }));
    closeSync(fd);
    return true;
  } catch (err) {
    if (err.code === "EEXIST") return false;
    throw err;
  }
}

/**
 * Run fn while holding the voice lock.
 * @param {string} bolum the episode, said to whoever waits
 * @param {() => T} fn
 * @param {{lockPath?: string, waitMs?: number, isAlive?: (pid:number) => boolean, log?: (msg:string) => void}} [opts]
 * @returns {T}
 * @template T
 */
export function withVoiceLock(bolum, fn, opts = {}) {
  const lockPath = opts.lockPath || defaultLockPath();
  const isAlive = opts.isAlive || pidAlive;
  const waitMs = opts.waitMs ?? LOCK_WAIT_MS;
  const log = opts.log || (() => {});
  mkdirSync(dirname(lockPath), { recursive: true });
  const until = Date.now() + waitMs;
  let told = false;
  while (!tryTake(lockPath, bolum)) {
    const held = lockHolder(lockPath);
    if (!held || !isAlive(held.pid)) {
      try {
        unlinkSync(lockPath); // stale: its process is gone (or the file is broken)
      } catch {
        /* another waiter removed it first */
      }
      continue;
    }
    const what = `başka bir seslendirme sürüyor (bölüm: ${held.bolum || "?"}, süreç ${held.pid})`;
    if (Date.now() >= until) throw new Error(`${what}; bitmesini bekleyip yeniden dene`);
    if (!told) log(`${what}; bitmesi bekleniyor`);
    told = true;
    sleep(POLL_MS);
  }
  try {
    return fn();
  } finally {
    if (lockHolder(lockPath)?.pid === process.pid) unlinkSync(lockPath);
  }
}
