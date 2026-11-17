/**
 * External tools (Python environments, Rhubarb, ffmpeg, HyperFrames) and a process runner.
 *
 * Paths come from environment variables, else from ~/.cizgi-studyo/config.json:
 *   CIZGI_PYTHON_TTS    python of the environment with edge-tts         (python_tts)
 *   CIZGI_RHUBARB       rhubarb executable                              (rhubarb)
 *   CIZGI_FFMPEG        ffmpeg executable, default "ffmpeg"              (ffmpeg)
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { readJson } from "./util.mjs";

export const HYPERFRAMES = "hyperframes@0.8.229";

const KEYS = {
  pythonTts: ["CIZGI_PYTHON_TTS", "python_tts"],
  rhubarb: ["CIZGI_RHUBARB", "rhubarb"],
  ffmpeg: ["CIZGI_FFMPEG", "ffmpeg"],
};

/**
 * @param {Record<string,string|undefined>} [env]
 * @param {string} [home]
 * @returns {{pythonTts?:string, rhubarb?:string, ffmpeg:string, configPath:string}}
 */
export function loadTools(env = process.env, home = homedir()) {
  const configPath = join(home, ".cizgi-studyo", "config.json");
  const file = existsSync(configPath) ? readJson(configPath) : {};
  const tools = { configPath };
  for (const [name, [envKey, fileKey]] of Object.entries(KEYS)) tools[name] = env[envKey] || file[fileKey];
  tools.ffmpeg = tools.ffmpeg || "ffmpeg";
  return tools;
}

/**
 * Throw a helpful error when a tool the step needs is not configured.
 * @param {ReturnType<typeof loadTools>} tools
 * @param {string[]} names keys of tools
 */
export function requireTools(tools, names) {
  const missing = names.filter((n) => !tools[n]);
  if (!missing.length) return;
  const lines = missing.map((n) => `  ${KEYS[n][0]}  (or "${KEYS[n][1]}" in ${tools.configPath})`);
  throw new Error(`these tools are not configured:\n${lines.join("\n")}`);
}

function quote(arg) {
  return /^[\w@.:/\\=,+-]+$/.test(arg) ? arg : `"${String(arg).replace(/"/g, '\\"')}"`;
}

/**
 * Run a command and return stdout; throw with the stderr tail on failure.
 * npm/npx are .cmd shims on Windows and need a shell.
 * @param {string} cmd
 * @param {string[]} args
 * liveStderr: the command's stderr goes straight to ours as it comes (progress lines a panel
 * job reads while the step runs); its tail is then not in the error, it is already above.
 * @param {{cwd?: string, liveStderr?: boolean}} [opts]
 * @returns {string}
 */
export function run(cmd, args, opts = {}) {
  const shell = process.platform === "win32" && /^(npx|npm)$/.test(cmd);
  const stdio = opts.liveStderr ? ["ignore", "pipe", "inherit"] : undefined;
  const res = shell
    ? spawnSync([cmd, ...args].map(quote).join(" "), { cwd: opts.cwd, shell: true, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio })
    : spawnSync(cmd, args, { cwd: opts.cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  if (res.error) throw new Error(`${cmd}: ${res.error.message}`);
  if (res.status !== 0 && opts.liveStderr) throw new Error(`${cmd} exited with ${res.status} (its messages are above)`);
  if (res.status !== 0) {
    const lines = `${res.stderr || ""}${res.stdout || ""}`.trim().split("\n");
    // Lines flagged as errors (HyperFrames marks them with ✗) first, then the tail.
    const flagged = lines.filter((l) => /✗|error:|Error:/.test(l)).slice(0, 10);
    const tail = lines.slice(-15).filter((l) => !flagged.includes(l));
    throw new Error(`${cmd} exited with ${res.status}:\n${[...flagged, ...tail].join("\n")}`);
  }
  return res.stdout;
}
