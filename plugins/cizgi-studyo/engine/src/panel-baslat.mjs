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

export const DEFAULT_PORT = 4810;
const CLI = fileURLToPath(new URL("./cli.mjs", import.meta.url));

/**
 * @param {{target:string, library:string, status:Function, port?:number, fallbackPort?:boolean, requests?:string}} opts
 *   fallbackPort: when the port is taken (another panel is open), take any free port instead of failing.
 *   requests: the session's request queue file (only when a Claude session listens: the MCP server).
 * @returns {Promise<{url:string, root:string, initial:string|null, loadLib:() => object, close:() => Promise<void>}>}
 */
export async function openPanel({ target, library, status, port = DEFAULT_PORT, fallbackPort = false, requests = null }) {
  const space = workspaceOf(resolve(target));
  // The project's library: the nearest kutuphane at or above the folder, else where one would go.
  const project = projectLibraryOf(space.root) ?? join(space.root, PROJECT_LIBRARY);
  const jobs = createJobs({ cli: CLI, library: resolve(library), project });
  // The libraries are reloaded when one of their files changes, so an edited rig or a new drawing shows up without a restart.
  const loadLib = cachedLibrary([library, project], (dir) => loadLibrary(dir, { project }));
  const start = (p) => startPanel({ ...space, loadLib, status, port: p, jobs, requests, project });
  let panel;
  try {
    panel = await start(port);
  } catch (err) {
    if (!fallbackPort || err.code !== "EADDRINUSE") throw err;
    panel = await start(0);
  }
  return { ...panel, root: space.root, initial: space.initial, loadLib };
}
