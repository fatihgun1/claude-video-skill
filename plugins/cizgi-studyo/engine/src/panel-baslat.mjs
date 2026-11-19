/**
 * Starting the editor panel, shared by `cizgi panel` and the plugin's MCP server: the workspace,
 * the cached library, storyboard/render jobs (this same CLI in a child process) and the HTTP server.
 */
import { join, resolve } from "node:path";
import { projectLibraryOf, PROJECT_LIBRARY } from "./proje-kutuphane.mjs";
import { fileURLToPath } from "node:url";
import { loadLibrary } from "./library.mjs";
import { startPanel } from "./panel.mjs";
import { workspaceOf } from "./panel-proje.mjs";
import { cachedLibrary } from "./panel-kutuphane.mjs";
import { createJobs } from "./panel-is.mjs";
import { createChannel } from "./panel-kanal.mjs";
import { addRequest, claimQueue } from "./istekler.mjs";

export const DEFAULT_PORT = 4810;
const CLI = fileURLToPath(new URL("./cli.mjs", import.meta.url));

/**
 * @param {{target:string, library:string, status:Function, port?:number, fallbackPort?:boolean, requests?:string}} opts
 *   fallbackPort: when the port is taken (another panel is open), take any free port instead of failing.
 *   requests: the session's request queue file (only when a Claude session listens: the MCP server).
 *   session: that Claude session's id: the requests written in this panel are for it alone.
 * @returns {Promise<{url:string, root:string, initial:string|null, loadLib:() => object, channel:object, close:() => Promise<void>}>}
 */
export async function openPanel({ target, library, status, port = DEFAULT_PORT, fallbackPort = false, requests = null, session = null }) {
  if (requests) claimQueue(requests, session);
  const space = workspaceOf(resolve(target));
  // The project's library: the nearest kutuphane at or above the folder, else where one would go.
  const project = projectLibraryOf(space.root) ?? join(space.root, PROJECT_LIBRARY);
  const jobs = createJobs({ cli: CLI, library: resolve(library), project });
  // The libraries are reloaded when one of their files changes, so an edited rig or a new drawing shows up without a restart.
  const loadLib = cachedLibrary([library, project], (dir) => loadLibrary(dir, { project }));
  // Claude moves the panel and asks in it (panel_git, panel_sor). An answer that comes after the tool
  // stopped waiting goes to the request queue, so the hooks hand it to Claude like a panel request.
  const channel = createChannel({
    // a message in an object window while Claude is not listening: the hooks hand it over after the turn
    onIdleChat: requests ? (item) => {
      const k = item.konu;
      try {
        addRequest(requests, {
          root: space.root, b: k.bolum || "", hedef: { tur: "bolum", etiket: `Nesne penceresi: ${k.ad || k.id}` },
          metin: `Nesne penceresinde (${k.tur} ${k.id}${k.shot ? `, shot ${k.shot}` : ""}${k.oyuncu ? `, oyuncu ${k.oyuncu}` : ""}): ${item.metin}
Yalnız bu şey üzerinde çalış; cevabı panel_sohbet {konu: "${k.tur}:${k.id}"} ile pencereye yaz, sonra panel_dinle ile dinlemeye dön.`.slice(0, 2000),
        }, { kisinin: true });
      } catch (err) {
        process.stderr.write(`cizgi panel: sohbet kuyruğa yazılamadı: ${err.message}
`);
      }
    } : undefined,
    // drafts the person took in (or put aside) while Claude was not listening: to the queue too
    onIdleDraft: requests ? (item) => {
      const list = (item.cizimler || []).map((c) => `${c.tur} ${c.id}`).join(", ");
      try {
        addRequest(requests, {
          root: space.root, b: "", hedef: { tur: "bolum", etiket: "Taslaklar" },
          metin: `Kişi panelde taslakları ${item.islem === "al" ? "kütüphaneye aldı" : "reddetti"}: ${list}. Onları bekleyen işe devam et (yeni çizimi bölüme koy).`.slice(0, 2000),
        }, { kisinin: true });
      } catch (err) {
        process.stderr.write(`cizgi panel: taslak haberi kuyruğa yazılamadı: ${err.message}\n`);
      }
    } : undefined,
    onLateAnswer: (a, bolum) => {
      if (!requests) return;
      const picked = a.secim.length ? a.secim.join(", ") : "(seçim yok)";
      try {
        addRequest(requests, {
          root: space.root, b: bolum || "", hedef: { tur: "bolum", etiket: "Panel sorusunun cevabı" },
          metin: `Panelde sorduğun soruya cevap (#${a.id}): "${a.soru}"
Seçim: ${picked}${a.metin ? `
Not: ${a.metin}` : ""}`.slice(0, 2000),
        }, { kisinin: true });
      } catch (err) {
        process.stderr.write(`cizgi panel: cevap kuyruğa yazılamadı: ${err.message}
`);
      }
    },
  });
  const start = (p) => startPanel({ ...space, loadLib, status, port: p, jobs, requests, project, channel });
  let panel;
  try {
    panel = await start(port);
  } catch (err) {
    if (!fallbackPort || err.code !== "EADDRINUSE") throw err;
    panel = await start(0);
  }
  return { ...panel, root: space.root, initial: space.initial, loadLib, channel };
}
