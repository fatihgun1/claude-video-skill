import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { addRequest, claimQueue } from "../src/istekler.mjs";
import { waitForRequest } from "../src/istek-bekle.mjs";

const fresh = () => join(mkdtempSync(join(tmpdir(), "istek-bekle-")), "q.jsonl");
const req = (extra = {}) => ({ root: "C:\\x", b: "bolumler/a/bolum.json", hedef: { tur: "bolum" }, metin: "düzelt", ...extra });

test("waits until a request is written into the queue, then returns it", async () => {
  // Hurda Kralı 2: the session ended its turn on a chat question; the panel's fix sat "Sırada"
  const file = fresh();
  let ticks = 0;
  const sleep = async () => {
    ticks += 1;
    if (ticks === 3) addRequest(file, req());
  };
  const got = await waitForRequest(file, { timeoutMs: 60_000, sleep, now: () => ticks * 1000 });
  assert.equal(got.length, 1);
  assert.equal(got[0].metin, "düzelt");
});

test("a request already waiting returns at once; none within the time gives null", async () => {
  const file = fresh();
  assert.equal(await waitForRequest(file, { timeoutMs: 3000, sleep: async () => {}, now: (() => { let t = 0; return () => (t += 1000); })() }), null);
  addRequest(file, req());
  assert.equal((await waitForRequest(file, { timeoutMs: 0, sleep: async () => {} })).length, 1);
});

test("a request left waiting from before the wait started does not wake it (the Stop hook tells those)", async () => {
  const file = fresh();
  addRequest(file, req()); // an old one, from an earlier day or another session
  let t = 0;
  const got = await waitForRequest(file, { since: new Date(Date.now() + 60_000), timeoutMs: 2000, sleep: async () => {}, now: () => (t += 1000) });
  assert.equal(got, null);
});

test("another session's request does not wake this one", async () => {
  const file = fresh();
  claimQueue(file, "baska-oturum-123"); // the panel of another session writes into this queue
  addRequest(file, req());
  claimQueue(file, null);
  let t = 0;
  const got = await waitForRequest(file, { session: "bu-oturum-12345", timeoutMs: 2000, sleep: async () => {}, now: () => (t += 1000) });
  assert.equal(got, null);
});
