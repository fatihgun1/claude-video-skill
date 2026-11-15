/**
 * Control panel: a local web page where a person edits shots with library dropdowns,
 * sees the change in a live preview and saves it back to bolum.json.
 *
 *   GET  /                 the panel page
 *   GET  /api/bolum        episode + version + vocabulary + validation + status
 *   POST /api/onizle       {episode}          validate, compile the unsaved edit into the preview
 *   POST /api/kaydet       {episode, version} validate, write bolum.json (refused on errors or a stale version)
 *   GET  /onizleme/...     files of the compiled preview
 *
 * Bound to 127.0.0.1 only. Requests whose Host is not the panel's own address are refused
 * (DNS rebinding), and POSTs need a JSON body from the panel's own origin (CSRF).
 */
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, existsSync, statSync } from "node:fs";
import { dirname, resolve, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { readText } from "./util.mjs";
import { validateEpisode } from "./validate.mjs";
import { compileEpisode, safeJoin } from "./compile.mjs";

const PAGE = fileURLToPath(new URL("./panel/index.html", import.meta.url));
const MAX_BODY = 1024 * 1024;
const PREVIEW_FORMAT = "16:9";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".wav": "audio/wav", ".png": "image/png", ".svg": "image/svg+xml" };
// Only the panel itself may frame its pages (its preview iframe); no MIME sniffing.
const SECURITY = { "x-content-type-options": "nosniff", "content-security-policy": "frame-ancestors 'self'", "x-frame-options": "SAMEORIGIN" };

const label = (x, id) => x?.label?.tr || x?.name?.tr || id;

/**
 * Everything the dropdowns may offer: only library words, never free text.
 * @param {ReturnType<import("./library.mjs").loadLibrary>} lib
 */
export function vocabulary(lib) {
  const list = (map, get = (v) => v) => [...map].map(([id, v]) => ({ id, label: label(get(v), id) }));
  return {
    actions: list(lib.actions),
    framings: Object.entries(lib.cameras.framings).map(([id, v]) => ({ id, label: label(v, id) })),
    moves: Object.entries(lib.cameras.moves).map(([id, v]) => ({ id, label: label(v, id) })),
    marks: Object.keys(lib.world.marks),
    facings: ["sag", "sol"],
    rigs: list(lib.characters, (c) => c.meta),
    backgrounds: [...lib.backgrounds.keys()].map((id) => ({ id, label: id })),
    props: [...lib.props.keys()].map((id) => ({ id, label: id })),
    profiles: [...lib.profiles.keys()],
  };
}

/** Content hash of the file on disk: a save is refused when someone else changed it meanwhile. */
export function versionOf(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** 2-space JSON with a final newline, the same shape the rest of the tools write. */
export function serialize(episode) {
  return `${JSON.stringify(episode, null, 2)}\n`;
}

class HttpError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * The request handler (exported for tests, no socket needed).
 * @param {{episodePath:string, loadLib:() => object, status?:(path:string, lib:object) => object, compile?:typeof compileEpisode, host?:() => string}} opts
 */
export function createPanel(opts) {
  const episodePath = resolve(opts.episodePath);
  const episodeDir = dirname(episodePath);
  const previewDir = join(episodeDir, ".cizgi", "panel-16x9");
  const compile = opts.compile || compileEpisode;

  function preview(episode, lib) {
    try {
      const out = compile(episodePath, lib, previewDir, { format: PREVIEW_FORMAT, episode });
      const timing = JSON.parse(readFileSync(join(previewDir, "timing.json"), "utf8"));
      return { ok: true, duration: out.duration, shots: timing.shots.map((s) => ({ shot_id: s.shot_id, start: s.start, end: s.end })) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  function check(body, lib) {
    const episode = body && typeof body === "object" ? body.episode : undefined;
    if (!episode || typeof episode !== "object" || Array.isArray(episode)) throw new HttpError(400, "episode must be an object");
    return validateEpisode(episode, lib);
  }

  /** Write via a temp file and rename, so a crash never leaves half a bolum.json. */
  function writeEpisode(text) {
    const tmp = `${episodePath}.panel-tmp`;
    writeFileSync(tmp, text);
    renameSync(tmp, episodePath);
  }

  const routes = {
    "GET /api/bolum": () => {
      const lib = opts.loadLib();
      const text = readText(episodePath);
      const episode = JSON.parse(text);
      const validation = validateEpisode(episode, lib);
      return {
        file: episodePath,
        version: versionOf(text),
        episode,
        vocab: vocabulary(lib),
        validation,
        status: opts.status && validation.ok ? opts.status(episodePath, lib) : null,
        preview: validation.ok ? preview(episode, lib) : { ok: false, error: "fix the errors first" },
      };
    },
    "POST /api/onizle": (body) => {
      const lib = opts.loadLib();
      const validation = check(body, lib);
      return { validation, preview: validation.ok ? preview(body.episode, lib) : { ok: false, error: "fix the errors first" } };
    },
    "POST /api/kaydet": (body) => {
      const lib = opts.loadLib();
      const validation = check(body, lib);
      if (!validation.ok) return { saved: false, validation };
      const current = versionOf(readText(episodePath));
      if (body.version !== current) throw new HttpError(409, "bolum.json changed on disk since the panel loaded it; reload the panel");
      const text = serialize(body.episode);
      writeEpisode(text);
      return {
        saved: true,
        version: versionOf(text),
        validation,
        status: opts.status ? opts.status(episodePath, lib) : null,
        preview: preview(body.episode, lib),
      };
    },
  };

  function sendFile(res, file) {
    if (!existsSync(file) || !statSync(file).isFile()) throw new HttpError(404, "not found");
    res.writeHead(200, { ...SECURITY, "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(readFileSync(file));
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

  return async function handle(req, res) {
    try {
      const host = opts.host ? opts.host() : null;
      if (host && req.headers.host !== host) throw new HttpError(403, "wrong host");
      const url = new URL(req.url, "http://panel");
      if (req.method === "GET" && url.pathname === "/") return sendFile(res, PAGE);
      if (req.method === "GET" && url.pathname.startsWith("/onizleme/")) {
        let rel;
        try {
          rel = decodeURIComponent(url.pathname.slice("/onizleme/".length));
        } catch {
          throw new HttpError(400, "bad path");
        }
        return sendFile(res, safeJoin(previewDir, rel));
      }
      const route = routes[`${req.method} ${url.pathname}`];
      if (!route) throw new HttpError(404, "not found");
      let body;
      if (req.method === "POST") {
        if (host && req.headers.origin !== `http://${host}`) throw new HttpError(403, "wrong origin");
        body = await readBody(req);
      }
      const result = route(body);
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
 * @param {{episodePath:string, loadLib:() => object, status?:Function, port?:number}} opts
 * @returns {Promise<{url:string, close:() => Promise<void>}>}
 */
export function startPanel(opts) {
  let address = "";
  const server = createServer(createPanel({ ...opts, host: () => address }));
  return new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(opts.port ?? 4810, "127.0.0.1", () => {
      address = `127.0.0.1:${server.address().port}`;
      ok({ url: `http://${address}/`, close: () => new Promise((done) => server.close(() => done())) });
    });
  });
}
