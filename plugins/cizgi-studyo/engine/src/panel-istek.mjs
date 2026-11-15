/**
 * The panel's side of the request queue (see istekler.mjs):
 *
 *   GET  /api/istekler?b=   {oturum, istekler (this episode's, newest first), surum (the file's version now)}
 *   POST /api/istek         {b, hedef, metin, zaman}   queue a request for the Claude session
 *
 * Requests exist only when the panel was opened by the plugin's MCP server (a session to send
 * to); a panel started from the command line says so instead. The same poll tells the page
 * when bolum.json changed on disk (Claude edited it), so it can reload.
 */
import { readText } from "./util.mjs";
import { addRequest, readRequests, isStale } from "./istekler.mjs";
import { HttpError } from "./panel-proje.mjs";

const SHOWN = 12;

/**
 * @param {{requests?:string|null, root:string, episodeOf:(rel:string) => {rel:string, path:string},
 *          versionOf:(text:string) => string}} opts  requests: the queue file, when a session is listening
 */
export function requestRoutes({ requests, root, episodeOf, versionOf }) {
  const versionNow = (ep) => {
    try {
      return versionOf(readText(ep.path));
    } catch {
      return null; // gone or unreadable: the page keeps what it has
    }
  };
  return {
    "GET /api/istekler": (_, url) => {
      const ep = episodeOf(url.searchParams.get("b"));
      const mine = requests ? readRequests(requests).filter((r) => r.root === root && r.b === ep.rel) : [];
      return {
        oturum: !!requests,
        // taken long ago and never answered: shown as such (and no longer counted as open)
        istekler: mine.slice(-SHOWN).reverse().map((r) => (isStale(r) ? { ...r, bayat: true } : r)),
        surum: versionNow(ep),
      };
    },
    "POST /api/istek": (body) => {
      if (!requests) throw new HttpError(409, "Bu panel bir Claude oturumuna bağlı değil: /cizgi-studyo ile aç");
      const ep = episodeOf(body?.b);
      try {
        return { istek: addRequest(requests, { root, b: ep.rel, hedef: body?.hedef, metin: body?.metin, zaman: body?.zaman }) };
      } catch (err) {
        throw new HttpError(400, err.message);
      }
    },
  };
}
