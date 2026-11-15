#!/usr/bin/env node
/**
 * The plugin's MCP server (stdio, newline-delimited JSON-RPC 2.0). Claude Code starts it with the
 * session; it hosts the editor panel so the panel lives as long as the session does.
 *
 *   panel_ac    {klasor?, bolum?}  open the panel on a folder (default: the session's project) and list its episodes
 *   panel_kapat {}                 stop the panel
 *
 * stdout carries only protocol messages; anything else goes to stderr.
 * Engine modules load on first use, so a missing `npm install` is a readable tool error, not a dead server.
 */
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_INFO = { name: "cizgi-studyo", version: "0.2.0" };
const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const LIBRARY = fileURLToPath(new URL("../../library", import.meta.url));
const ENGINE = fileURLToPath(new URL("..", import.meta.url));

const TOOLS = [
  {
    name: "panel_ac",
    description:
      "Open the Çizgi Stüdyo editor panel (a local web page, 127.0.0.1) on a folder and list the episodes (bolum.json) under it. " +
      "Returns the URL to open in the browser and one line per episode: path, title, shots, length, validity, gates and next step. " +
      "Calling it again on the same folder returns the same panel; another folder moves the panel there.",
    inputSchema: {
      type: "object",
      properties: {
        klasor: { type: "string", description: "Folder to open (absolute, or relative to the project). Default: the project folder." },
        bolum: { type: "string", description: "Episode to open first: a path relative to the folder, as listed (e.g. bolumler/kus/bolum.json)." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "panel_kapat",
    description: "Stop the editor panel (and any storyboard or render job it started).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

let panel = null; // {url, root, loadLib, close}

const projectDir = () => process.env.CLAUDE_PROJECT_DIR || process.cwd();
const portOf = () => (process.env.CIZGI_PANEL_PORT ? Number(process.env.CIZGI_PANEL_PORT) : undefined);

async function engine() {
  try {
    const [{ openPanel, DEFAULT_PORT }, { findEpisodes, summarize, workspaceOf }, { status }] = await Promise.all([
      import("./panel-baslat.mjs"),
      import("./panel-proje.mjs"),
      import("./cli.mjs"),
    ]);
    return { openPanel, DEFAULT_PORT, findEpisodes, summarize, workspaceOf, status };
  } catch (err) {
    if (err.code === "ERR_MODULE_NOT_FOUND") throw new Error(`engine dependencies are missing: run npm install --prefix "${ENGINE}" (${err.message})`);
    throw err;
  }
}

async function closePanel() {
  if (!panel) return false;
  const old = panel;
  panel = null;
  await old.close();
  return true;
}

// `klasor` may be any folder on this machine, on purpose: the person keeps cartoons where they like,
// and Claude Code asks before each tool call. `bolum` must be one of the listed episodes.
async function panelAc({ klasor, bolum } = {}) {
  const e = await engine();
  // Everything that can be wrong with the request is checked before the open panel is touched.
  const space = e.workspaceOf(resolve(projectDir(), klasor || ".")); // a missing path or a stray file throws here
  const paths = e.findEpisodes(space.root);
  const first = bolum ?? space.initial;
  if (bolum !== undefined && !paths.includes(bolum)) throw new Error(`no such episode under ${space.root}: ${bolum} (listed: ${paths.join(", ") || "none"})`);
  if (!panel || panel.root !== space.root) {
    await closePanel(); // frees the port, so the panel stays at the same address
    panel = await e.openPanel({ target: space.root, library: LIBRARY, status: e.status, port: portOf() ?? e.DEFAULT_PORT, fallbackPort: true });
  }
  const lib = panel.loadLib();
  return {
    url: first ? `${panel.url}#b=${encodeURIComponent(first)}` : panel.url,
    klasor: panel.root,
    bolumler: paths.map((p) => e.summarize(panel.root, p, lib, e.status)),
  };
}

// Tool calls run one at a time: two panel_ac calls in flight would otherwise both start a server.
let queue = Promise.resolve();

function callTool(name, args) {
  const run = () => (name === "panel_ac" ? panelAc(args) : closePanel().then((kapandi) => ({ kapandi })));
  const result = queue.then(run);
  queue = result.catch(() => {}); // a failed call does not block the next one
  return result;
}

const text = (value) => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

/** @returns {Promise<object|undefined>} the result, or undefined for a notification */
async function handle(msg) {
  switch (msg.method) {
    case "initialize": {
      const asked = msg.params?.protocolVersion;
      return {
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call": {
      const name = msg.params?.name;
      if (!TOOLS.some((t) => t.name === name)) throw Object.assign(new Error(`unknown tool: ${name}`), { code: -32602 });
      try {
        return text(await callTool(name, msg.params?.arguments ?? {}));
      } catch (err) {
        return { ...text({ error: err.message }), isError: true };
      }
    }
    default:
      throw Object.assign(new Error(`method not found: ${msg.method}`), { code: -32601 });
  }
}

function reply(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

async function onLine(line) {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    reply({ id: null, error: { code: -32700, message: "parse error" } });
    return;
  }
  const isRequest = msg.id !== undefined && msg.id !== null;
  if (!isRequest) return; // notifications (initialized, cancelled, …) need no answer
  try {
    reply({ id: msg.id, result: await handle(msg) });
  } catch (err) {
    reply({ id: msg.id, error: { code: err.code ?? -32603, message: err.message } });
  }
}

// The session closing ends stdin: stop the panel and its jobs with it.
const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  onLine(line).catch((err) => process.stderr.write(`cizgi mcp: ${err.stack || err}\n`));
});
function shutDown() {
  closePanel().finally(() => process.exit(0)); // close() stops render jobs at once
  setTimeout(() => process.exit(0), 2000).unref(); // open browser connections must not keep it alive
}
input.on("close", shutDown);
process.once("SIGTERM", shutDown);
process.once("SIGINT", shutDown);
