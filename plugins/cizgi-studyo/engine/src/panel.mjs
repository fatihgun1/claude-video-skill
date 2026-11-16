/**
 * Control panel: a local web page where a person picks an episode from a project folder,
 * edits its shots with the library, sees the change in a live preview and saves it back.
 *
 * Episodes are named by their path inside the opened folder (b=ornekler/sokak/bolum.json).
 *
 *   GET  /                 the panel page
 *   GET  /api/bolumler     every bolum.json in the folder: title, shots, duration, background, gates
 *   POST /api/yeni         {id, title}               new episode at bolumler/<id>/bolum.json from a minimal template
 *   GET  /api/bolum?b=     episode + version + vocabulary + validation + status
 *   POST /api/onizle       {b, episode}              validate, compile the unsaved edit into the preview
 *   POST /api/kaydet       {b, episode, version}     validate, write bolum.json (refused on errors or a stale version)
 *   GET  /onizleme/<key>/...   files of an episode's compiled preview
 *   GET  /panel/<file>     the panel's own scripts and styles
 *   GET  /kutuphane/<kind>/<id>.<ext>   a library drawing or sound (karakter, mekan, nesne, ses)
 *   GET  /api/hareket?rig=&action=&bg=  compile a small preview of one character doing one action
 *   GET  /hareket-onizleme/...           files of those previews
 *   GET  /api/istekler?b=  ·  POST /api/istek   requests to the Claude session (panel-istek.mjs)
 *   POST /api/incele       {b, episode, format, sahne}   scene review checks on the unsaved draft (inceleme.mjs)
 *   GET  /api/hikaye?b=  ·  POST /api/hikaye   story cards, hikaye.json next to the episode (panel-hikaye.mjs)
 *   GET  /api/taslaklar  ·  POST /api/taslak  ·  GET /kutuphane-taslak/…   project library drafts (panel-taslak.mjs)
 *
 * Bound to 127.0.0.1 only. Requests whose Host is not the panel's own address are refused
 * (DNS rebinding), and POSTs need a JSON body from the panel's own origin (CSRF).
 */
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream";
import { readFileSync, writeFileSync, renameSync, existsSync, statSync, rmSync, createReadStream } from "node:fs";
import { dirname, resolve, join, extname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { readText } from "./util.mjs";
import { validateEpisode, profileOf } from "./validate.mjs";
import { compileEpisode, safeJoin, propLayer, VIEWPORTS } from "./compile.mjs";
import { compileEpisode3d } from "./compile3d.mjs";
import { reviewScene } from "./inceleme.mjs";
import { vocabulary, libraryFile, actionPreview } from "./panel-kutuphane.mjs";
import { readManifest, failedLines } from "./ses.mjs";
import { outputsOf, OUTPUT_DIRS } from "./panel-is.mjs";
import { HttpError, MAX_EPISODES, findEpisodes, episodePathOf, summarize, createEpisode, newEpisodeChoices, workspaceOf, insideReally } from "./panel-proje.mjs";
import { requestRoutes } from "./panel-istek.mjs";
import { storyRoutes } from "./panel-hikaye.mjs";
import { draftRoutes, draftFile } from "./panel-taslak.mjs";

export { vocabulary };

const PANEL_DIR = fileURLToPath(new URL("./panel/", import.meta.url));
const PAGE = join(PANEL_DIR, "index.html");
/** The only files /panel/ serves. */
const PANEL_FILES = new Set(["panel.css", "app.js", "dom.js", "kutuphane.js", "sahne.js", "denetleyici.js", "projeler.js", "zaman.js", "kurgu.js", "dinle.js", "duzen.js", "uretim.js", "agac.js", "istek.js", "inceleme.js", "hikaye.js", "klavye.js", "gorunum.js", "katman.js", "taslak.js", "dekor.js", "isik.js", "altyazi-ayar.js", "serit.js", "bolum-ayar.js", "ayirici.js", "cekmece.js", "birak.js", "tr.js"]);
/** Engine modules the panel uses as they are (pure code): the music envelope, so the timeline draws what the render plays. */
const SHARED_FILES = {
  "muzik.mjs": fileURLToPath(new URL("./muzik.mjs", import.meta.url)),
  "altyazi.mjs": fileURLToPath(new URL("./altyazi.mjs", import.meta.url)), // caption rules: the track shows what renders
};
const MAX_BODY = 1024 * 1024;
const PREVIEW_FORMAT = "16:9";
const PREVIEW_FORMATS = new Set(["16:9", "9:16"]);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".wav": "audio/wav", ".mp4": "video/mp4", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".css": "text/css; charset=utf-8" };
// Only the panel itself may frame its pages (its preview iframe); no MIME sniffing.
const SECURITY = { "x-content-type-options": "nosniff", "content-security-policy": "frame-ancestors 'self'", "x-frame-options": "SAMEORIGIN" };
const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox; frame-ancestors 'self'";

/** Content hash of the file on disk: a save is refused when someone else changed it meanwhile. */
export function versionOf(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/**
 * The listening check of each spoken line (ses/manifest.json), by line key "<shot>-<n>":
 * whether the recognised text matched, what was heard, and whether the person accepted a miss.
 * @returns {Record<string, {ok:boolean, accepted:boolean, heard:string, cer:number}>}
 */
export function listeningOf(episodePath) {
  let manifest = null;
  try {
    manifest = readManifest(episodePath);
  } catch {
    return {}; // an unreadable manifest: the audio step will rewrite it
  }
  return Object.fromEntries(Object.entries(manifest?.lines || {}).map(([key, v]) => [key, {
    ok: !!v.ok, accepted: !!v.accepted, heard: typeof v.heard === "string" ? v.heard : "", cer: typeof v.cer === "number" ? v.cer : null,
  }]));
}

/** 2-space JSON with a final newline, the same shape the rest of the tools write. */
export function serialize(episode) {
  return `${JSON.stringify(episode, null, 2)}\n`;
}

/**
 * The request handler (exported for tests, no socket needed).
 * @param {{root?:string, initial?:string|null, episodePath?:string, loadLib:() => object,
 *          status?:(path:string, lib:object) => object, compile?:typeof compileEpisode, host?:() => string}} opts
 *   root: the project folder; episodePath (instead of root): open the folder of that bolum.json.
 */
export function createPanel(opts) {
  const space = opts.root ? { root: resolve(opts.root), initial: opts.initial ?? null } : workspaceOf(resolve(opts.episodePath));
  const root = resolve(space.root);
  const actionDir = join(tmpdir(), "cizgi-panel", versionOf(root), "hareket");
  rmSync(actionDir, { recursive: true, force: true }); // previews of an earlier run may show an older library
  /** Action previews already compiled, by folder name, with the library they were made from. */
  const actionCache = new Map();
  const compile = opts.compile || compileEpisode;
  /** Preview folders by key (a hash of the episode's path), filled as episodes are opened. */
  const previews = new Map();
  /** Episode folders by key (a hash of the relative path), for their production outputs. */
  const episodeDirs = new Map();

  /** An episode by its relative path, with the preview folder for one format, in 2D or 3D (look "3b"). */
  function episodeOf(rel, format = PREVIEW_FORMAT, look = "") {
    if (!PREVIEW_FORMATS.has(format)) throw new HttpError(400, `format must be ${[...PREVIEW_FORMATS].join(" or ")}`);
    const d3 = look === "3b";
    const path = episodePathOf(root, rel);
    const key = versionOf(`${rel}|${format}${d3 ? "|3b" : ""}`);
    const previewDir = join(dirname(path), ".cizgi", `panel-${format.replace(":", "x")}${d3 ? "-3b" : ""}`);
    previews.set(key, previewDir);
    episodeDirs.set(versionOf(rel), dirname(path));
    return { rel, path, key, previewDir, format, d3 };
  }

  function preview(ep, episode, lib) {
    try {
      // A line not spoken yet (new or just written) plays silent with a guessed length, so it
      // can be placed and saved; the audio step comes after saving. Renders stay strict.
      const out = (ep.d3 ? compileEpisode3d : compile)(ep.path, lib, ep.previewDir, { format: ep.format, episode, missingAudio: "estimate", silentTrack: false }); // a silent track is for the video file only
      const timing = JSON.parse(readFileSync(join(ep.previewDir, "timing.json"), "utf8"));
      const { lead, tail, min_shot, default_hold } = profileOf(episode, lib).timing;
      return {
        ok: true,
        url: `/onizleme/${ep.key}/index.html`,
        format: ep.format,
        duration: out.duration,
        unspoken: out.estimated || [], // line keys "<shot>-<n>" with no audio yet
        // The timeline needs where speech ends: a shot is speech + hold + tail, so its
        // edge can be dragged to change hold but never cut into the lines.
        rules: { lead, tail, min_shot, default_hold },
        shots: timing.shots.map((s) => ({
          shot_id: s.shot_id,
          start: s.start,
          end: s.end,
          speech_end: s.utterances.length ? s.utterances.at(-1).end : Math.round((s.start + lead) * 1000) / 1000,
          utterances: s.utterances.map((u) => ({ speaker: u.speaker, text: u.text, start: u.start, end: u.end })),
        })),
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  function check(body, lib) {
    const episode = body && typeof body === "object" ? body.episode : undefined;
    if (!episode || typeof episode !== "object" || Array.isArray(episode)) throw new HttpError(400, "episode must be an object");
    return validateEpisode(episode, lib);
  }

  const jobs = opts.jobs ?? null;
  /** Gates and audio state of the saved file, or null when it does not validate. */
  function statusOf(ep) {
    try {
      const lib = opts.loadLib();
      const episode = JSON.parse(readText(ep.path));
      return validateEpisode(episode, lib).ok ? opts.status(ep.path, lib) : null;
    } catch {
      return null;
    }
  }

  /** Write via a temp file and rename, so a crash never leaves half a bolum.json. */
  function writeEpisode(path, text) {
    const tmp = `${path}.panel-tmp`;
    writeFileSync(tmp, text);
    renameSync(tmp, path);
  }

  const routes = {
    "GET /api/bolumler": () => {
      const lib = opts.loadLib();
      const list = findEpisodes(root);
      return {
        root,
        initial: space.initial,
        truncated: list.length >= MAX_EPISODES, // the picker says so instead of silently dropping episodes
        episodes: list.map((rel) => summarize(root, rel, lib, opts.status)),
        secenekler: newEpisodeChoices(lib), // "Yeni bölüm": the person picks its character and place
      };
    },
    "POST /api/yeni": (body) => ({ path: createEpisode(root, opts.loadLib(), body, serialize) }),
    "GET /api/bolum": (_, url) => {
      const ep = episodeOf(url.searchParams.get("b"), url.searchParams.get("f") || undefined, url.searchParams.get("g") || "");
      const lib = opts.loadLib();
      const text = readText(ep.path);
      let episode;
      try {
        episode = JSON.parse(text);
      } catch (err) {
        throw new HttpError(422, `${ep.rel} is not valid JSON: ${err.message}`);
      }
      const validation = validateEpisode(episode, lib);
      return {
        path: ep.rel,
        version: versionOf(text),
        episode,
        vocab: vocabulary(lib),
        validation,
        status: opts.status && validation.ok ? opts.status(ep.path, lib) : null,
        listening: listeningOf(ep.path),
        outputs: outputsOf(ep.path),
        outputsUrl: `/uretim/${versionOf(ep.rel)}/`, // + an outputs path
        job: jobs?.get(ep.path) || null,
        preview: validation.ok ? preview(ep, episode, lib) : { ok: false, error: "fix the errors first" },
      };
    },
    "GET /api/hareket": (_, url) =>
      actionPreview(opts.loadLib(), Object.fromEntries(url.searchParams), { episodePath: join(root, "bolum.json"), dir: actionDir, compile, cache: actionCache }),
    // Production steps on the saved episode (storyboard stills, a draft video).
    "POST /api/is": (body) => {
      if (!jobs) throw new HttpError(501, "production jobs are not available here");
      const ep = episodeOf(body?.b);
      try {
        return { job: jobs.start(ep.path, body?.kind, body?.format, body?.sahne) };
      } catch (err) {
        throw new HttpError(err.code || 500, err.message);
      }
    },
    "POST /api/is/durdur": (body) => {
      const ep = episodeOf(body?.b);
      return { stopped: !!jobs?.cancel(ep.path), job: jobs?.get(ep.path) || null };
    },
    "GET /api/is": (_, url) => {
      const ep = episodeOf(url.searchParams.get("b"));
      return { job: jobs?.get(ep.path) || null, outputs: outputsOf(ep.path), status: opts.status ? statusOf(ep) : null };
    },
    "POST /api/onizle": (body) => {
      const ep = episodeOf(body?.b, body?.format ?? undefined, body?.gorunum ?? "");
      const lib = opts.loadLib();
      const validation = check(body, lib);
      return { validation, preview: validation.ok ? preview(ep, body.episode, lib) : { ok: false, error: "fix the errors first" } };
    },
    "POST /api/kaydet": (body) => {
      const ep = episodeOf(body?.b, body?.format ?? undefined);
      const lib = opts.loadLib();
      const validation = check(body, lib);
      if (!validation.ok) return { saved: false, validation };
      const current = versionOf(readText(ep.path));
      if (body.version !== current) throw new HttpError(409, "bolum.json changed on disk since the panel loaded it; reload the panel");
      // Valid is not enough: some limits only show when compiling (an effect after the shot's end).
      const compiled = preview(ep, body.episode, lib);
      if (!compiled.ok) return { saved: false, validation, preview: compiled };
      const text = serialize(body.episode);
      writeEpisode(ep.path, text);
      return {
        saved: true,
        version: versionOf(text),
        validation,
        status: opts.status ? opts.status(ep.path, lib) : null,
        preview: compiled,
      };
    },
    // Scene review (İncele): the checks of inceleme.mjs on one scene of the unsaved draft.
    "POST /api/incele": (body) => {
      const ep = episodeOf(body?.b, body?.format ?? undefined);
      const lib = opts.loadLib();
      const validation = check(body, lib);
      const base = { episode: body.episode, sceneId: body?.sahne, lib, format: ep.format, validation, failed: failedLines(readManifest(ep.path)) };
      // without a compiled draft only the rules that need no picture run (validator, captions, audio)
      const compiled = validation.ok ? preview(ep, body.episode, lib) : { ok: false, error: "fix the errors first" };
      let timing = { shots: [] };
      let anchors = [];
      if (compiled.ok) {
        timing = JSON.parse(readFileSync(join(ep.previewDir, "timing.json"), "utf8"));
        anchors = propLayer(timing, body.episode, lib, VIEWPORTS[ep.format]).anchors;
      }
      try {
        return { inceleme: reviewScene({ ...base, timing, anchors, unspoken: compiled.unspoken || [] }), resim: compiled.ok, error: compiled.ok ? null : compiled.error };
      } catch (err) {
        throw new HttpError(400, err.message);
      }
    },
    // Requests to the Claude session, and "did the file change on disk?"
    ...requestRoutes({ requests: opts.requests ?? null, root, episodeOf, versionOf, project: opts.project ?? null }),
    // Story cards (hikaye.json): a draft next to the episode
    ...storyRoutes({ episodeOf, loadLib: () => opts.loadLib() }),
    // Drafts in the project library (kutuphane/taslak): look, take in, put aside
    ...draftRoutes({ project: opts.project ?? null, loadLib: (fresh) => opts.loadLib(fresh) }),
  };

  /** Both senders return true: "the request has been answered". */
  function send(res, body, type) {
    // A drawing opened on its own (a library or draft SVG in a tab) may never run anything on the
    // panel's origin, whatever slipped past the safety check: no scripts, sandboxed.
    const svg = type.startsWith("image/svg+xml") ? { "content-security-policy": SVG_CSP } : {};
    res.writeHead(200, { ...SECURITY, ...svg, "content-type": type, "cache-control": "no-store" });
    res.end(body);
    return true;
  }

  /**
   * A production output, streamed with byte ranges so a video can be seeked (and is not
   * read whole into memory). It may be cached but is checked again on every use.
   * pipeline closes the file when the browser drops the request (a video player seeking does
   * that all the time): a file left open cannot be replaced on Windows, and the next render
   * would fail renaming its new video over it (EPERM).
   */
  function sendRanged(req, res, file) {
    const size = statSync(file).size;
    const type = TYPES[extname(file)] || "application/octet-stream";
    const head = { ...SECURITY, "content-type": type, "accept-ranges": "bytes", "cache-control": "private, max-age=0, must-revalidate" };
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
    if (!m || (m[1] === "" && m[2] === "")) {
      res.writeHead(200, { ...head, "content-length": size });
      pipeline(createReadStream(file), res, dropped);
      return true;
    }
    // "bytes=a-b", "bytes=a-" or the last n bytes "bytes=-n"
    const start = m[1] === "" ? Math.max(0, size - Number(m[2])) : Number(m[1]);
    const end = m[1] === "" || m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
    if (start >= size || start > end) {
      res.writeHead(416, { ...SECURITY, "content-range": `bytes */${size}` });
      res.end();
      return true;
    }
    res.writeHead(206, { ...head, "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
    pipeline(createReadStream(file, { start, end }), res, dropped);
    return true;
  }

  /** A streamed file stopped early: the browser went away (normal), or the file could not be read mid-way (the response is already cut). */
  function dropped(err) {
    if (err && !["ERR_STREAM_PREMATURE_CLOSE", "ECONNRESET", "EPIPE"].includes(err.code)) console.error(`panel: dosya gönderilemedi: ${err.message}`);
  }

  function sendFile(res, file) {
    if (!existsSync(file) || !statSync(file).isFile()) throw new HttpError(404, "not found");
    return send(res, readFileSync(file), TYPES[extname(file)] || "application/octet-stream");
  }

  async function readBody(req) {
    if (!/^application\/json\b/.test(req.headers["content-type"] || "")) throw new HttpError(415, "send JSON");
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw new HttpError(413, "body too large");
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new HttpError(400, "body is not valid JSON");
    }
  }

  const decode = (rel) => {
    try {
      return decodeURIComponent(rel);
    } catch {
      throw new HttpError(400, "bad path");
    }
  };

  /** Static files: compiled previews, the panel's own files and library assets. undefined = not static. */
  function serveStatic(path, res, req) {
    const shown = /^\/onizleme\/([0-9a-f]{16})\/(.+)$/.exec(path);
    if (shown) {
      const dir = previews.get(shown[1]);
      if (!dir) throw new HttpError(404, "open the episode first");
      return sendFile(res, safeJoin(dir, decode(shown[2])));
    }
    if (path.startsWith("/hareket-onizleme/")) return sendFile(res, safeJoin(actionDir, decode(path.slice(18))));
    // Production outputs: /uretim/<key>/storyboard/... or /uretim/<key>/cikti/... of an opened episode.
    const made = /^\/uretim\/([0-9a-f]{16})\/((?:storyboard|cikti|inceleme)\/.+)$/.exec(path);
    if (made) {
      const dir = episodeDirs.get(made[1]);
      if (!dir) throw new HttpError(404, "open the episode first");
      const rel = decode(made[2]);
      if (!OUTPUT_DIRS.includes(rel.split("/")[0]) || !/\.(png|jpg|mp4)$/.test(rel)) throw new HttpError(404, "not found");
      const file = safeJoin(dir, rel);
      if (!existsSync(file) || !statSync(file).isFile()) throw new HttpError(404, "not found");
      insideReally(dir, file); // a link under storyboard/ or cikti/ must not lead elsewhere
      return sendRanged(req, res, file);
    }
    if (path.startsWith("/panel/")) {
      const name = path.slice(7);
      if (Object.hasOwn(SHARED_FILES, name)) return sendFile(res, SHARED_FILES[name]);
      if (!PANEL_FILES.has(name)) throw new HttpError(404, "not found");
      return sendFile(res, join(PANEL_DIR, name));
    }
    const draft = draftFile(path, { project: opts.project ?? null, loadLib: () => opts.loadLib() });
    if (draft !== undefined) return send(res, draft, TYPES[".svg"]);
    const m = /^\/kutuphane\/([a-z]+)\/([^/]+)$/.exec(path);
    if (m) {
      const file = libraryFile(opts.loadLib(), m[1], decode(m[2]));
      if (!file) throw new HttpError(404, "not in the library");
      return send(res, file.body, file.type);
    }
    return undefined;
  }

  return async function handle(req, res) {
    try {
      const host = opts.host ? opts.host() : null;
      if (host && req.headers.host !== host) throw new HttpError(403, "wrong host");
      const url = new URL(req.url, "http://panel");
      if (req.method === "GET" && url.pathname === "/") return sendFile(res, PAGE);
      if (req.method === "GET") {
        const served = serveStatic(url.pathname, res, req);
        if (served !== undefined) return served;
      }
      const route = routes[`${req.method} ${url.pathname}`];
      if (!route) throw new HttpError(404, "not found");
      // API GETs compile and write files: another site may not trigger them (an <img> pointing here, say).
      // Browsers send Sec-Fetch-Site; tools that do not send it are not web pages.
      const site = req.headers["sec-fetch-site"];
      if (site && site !== "same-origin" && site !== "none") throw new HttpError(403, "cross-site request");
      let body;
      if (req.method === "POST") {
        if (host && req.headers.origin !== `http://${host}`) throw new HttpError(403, "wrong origin");
        body = await readBody(req);
      }
      const result = route(body, url);
      res.writeHead(200, { ...SECURITY, "content-type": TYPES[".json"], "cache-control": "no-store" });
      res.end(JSON.stringify(result));
    } catch (err) {
      const code = err instanceof HttpError ? err.code : /escapes the episode folder/.test(err.message) ? 403 : 500;
      res.writeHead(code, { ...SECURITY, "content-type": TYPES[".json"] });
      res.end(JSON.stringify({ error: err.message }));
    }
  };
}

/**
 * Start the panel on 127.0.0.1.
 * @param {{root?:string, initial?:string|null, episodePath?:string, loadLib:() => object, status?:Function, port?:number}} opts
 * @returns {Promise<{url:string, close:() => Promise<void>}>}
 */
export function startPanel(opts) {
  let address = "";
  const server = createServer(createPanel({ ...opts, host: () => address }));
  return new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(opts.port ?? 4810, "127.0.0.1", () => {
      address = `127.0.0.1:${server.address().port}`;
      ok({
        url: `http://${address}/`,
        close: () => {
          opts.jobs?.stopAll?.(); // no render left running after the panel
          return new Promise((done) => server.close(() => done()));
        },
      });
    });
  });
}
