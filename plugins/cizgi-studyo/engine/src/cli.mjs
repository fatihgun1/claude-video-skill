#!/usr/bin/env node
/**
 * cizgi — command line for the engine. Output is JSON (easy for an agent to read).
 *
 *   cizgi dogrula    <bolum.json>                    schema + library + profile warnings
 *   cizgi durum      <bolum.json>                    gates, audio state, next step
 *   cizgi onayla     senaryo|storyboard <bolum.json> record a human approval (only after a yes)
 *   cizgi ses        <bolum.json> [--hepsi]          speak, check and time changed lines
 *   cizgi kabul      <bolum.json> <line-key>         keep a take that failed the listening check (only after a yes)
 *   cizgi storyboard <bolum.json> [--format 16:9]    stills of every shot for review
 *   cizgi render     <bolum.json> [--taslak] [--format 9:16]
 *   cizgi qa         <video.mp4>                     review pages (4 fps) of a RENDERED video; look at every page
 *   cizgi derle      <bolum.json> <out-dir> [16:9|9:16]
 *   cizgi panel      <klasör|bolum.json> [--port 4810] local control panel (127.0.0.1): pick an episode, edit shots with a live preview
 *
 * Options: --kutuphane <dir> (default: ../library next to the engine)
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLibrary } from "./library.mjs";
import { validateEpisode, profileOf } from "./validate.mjs";
import { compileEpisode, safeJoin } from "./compile.mjs";
import { readJson } from "./util.mjs";
import { GATES, approve, readApprovals, gateStatus, scriptFingerprint, storyboardFingerprint, libraryFingerprint } from "./onay.mjs";
import { runAudio, readManifest, linesOf, planAudio, lineFingerprint, failedLines, acceptLine } from "./ses.mjs";
import { storyboard, render, qaPages } from "./uretim.mjs";
import { loadTools, run } from "./tools.mjs";
import { startPanel } from "./panel.mjs";
import { workspaceOf } from "./panel-proje.mjs";
import { cachedLibrary } from "./panel-kutuphane.mjs";
import { createJobs } from "./panel-is.mjs";

const DEFAULT_LIBRARY = fileURLToPath(new URL("../../library", import.meta.url));
const FLAGS = new Set(["--hepsi", "--taslak"]);
const NEEDS = { dogrula: 1, durum: 1, ses: 1, storyboard: 1, render: 1, onayla: 2, derle: 2, kabul: 2, qa: 1, panel: 1 };
const USAGE =
  "usage: cizgi dogrula|durum|ses|storyboard|render <bolum.json> · cizgi panel <klasör|bolum.json> · cizgi onayla senaryo|storyboard <bolum.json> · cizgi kabul <bolum.json> <line> · cizgi derle <bolum.json> <dir> [format]\n";

/**
 * @param {string[]} argv
 * @returns {{args: string[], flags: Set<string>, library: string, formats?: string[], port?: number}}
 */
export function parseArgs(argv) {
  const args = [];
  const flags = new Set();
  const formats = [];
  let library = DEFAULT_LIBRARY;
  let port;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--kutuphane" || a === "--format" || a === "--port") {
      const value = argv[++i];
      if (!value) throw new Error(`${a} needs a value`);
      if (a === "--port") {
        port = Number(value);
        if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port needs a whole number 0-65535");
      } else if (a === "--kutuphane") library = value;
      else formats.push(value);
    } else if (FLAGS.has(a)) flags.add(a);
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else args.push(a);
  }
  return { args, flags, library, port, formats: formats.length ? formats : undefined };
}

/**
 * Everything a person (or agent) needs to know about where an episode stands.
 * @param {string} episodePath
 * @param {ReturnType<typeof loadLibrary>} lib
 * @returns {object}
 */
export function status(episodePath, lib) {
  const episode = readJson(episodePath);
  const { ok, errors, warnings } = validateEpisode(episode, lib);
  if (!ok) return { valid: false, errors, next: "fix the episode (cizgi dogrula)" };
  const approvals = readApprovals(episodePath);
  const manifest = readManifest(episodePath);
  const dir = dirname(resolve(episodePath));
  const tempo = profileOf(episode, lib).speech.tempo;
  const lines = linesOf(episode);
  const plan = planAudio(lines, manifest, (l) => lineFingerprint(l, episode.language, tempo), (p) => existsSync(safeJoin(dir, p)));
  const failed = failedLines(manifest);
  const gates = {
    senaryo: gateStatus(approvals, "senaryo", scriptFingerprint(episode)),
    storyboard: gateStatus(approvals, "storyboard", storyboardFingerprint(episode, manifest, libraryFingerprint(episode, lib))),
  };
  let next;
  if (gates.senaryo !== "onayli") next = "show the script to the person, then: cizgi onayla senaryo";
  else if (plan.todo.length) next = `cizgi ses (${plan.todo.length} line(s) to speak)`;
  else if (gates.storyboard !== "onayli") next = "cizgi storyboard, show the stills, then: cizgi onayla storyboard";
  else next = "cizgi render";
  return { valid: true, warnings, gates, audio: { lines: lines.length, todo: plan.todo.map((l) => l.key), failed }, next };
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function main(argv) {
  const { args, flags, library, formats, port } = parseArgs(argv);
  const [command, a1, a2, a3] = args;
  if (!NEEDS[command] || args.length - 1 < NEEDS[command] || (command === "onayla" && !GATES.includes(a1))) {
    process.stderr.write(USAGE);
    return 2;
  }
  const lib = loadLibrary(library);
  const deps = { run, formats, log: (m) => process.stderr.write(`${m}\n`) };

  switch (command) {
    case "dogrula": {
      const res = validateEpisode(readJson(a1), lib);
      print(res);
      return res.ok ? 0 : 1;
    }
    case "durum":
      print(status(a1, lib));
      return 0;
    case "onayla": {
      const episode = readJson(a2);
      const { ok, errors } = validateEpisode(episode, lib);
      if (!ok) throw new Error(`episode is invalid:\n- ${errors.join("\n- ")}`);
      const fp = a1 === "senaryo" ? scriptFingerprint(episode) : storyboardFingerprint(episode, readManifest(a2), libraryFingerprint(episode, lib));
      approve(a2, a1, fp);
      print({ approved: a1, fingerprint: fp });
      return 0;
    }
    case "ses": {
      const res = runAudio(a1, lib, loadTools(), { ...deps, force: flags.has("--hepsi") });
      print(res);
      return res.failed.length ? 3 : 0;
    }
    case "kabul":
      print({ accepted: a2, line: acceptLine(a1, a2) });
      return 0;
    case "storyboard":
      print(storyboard(a1, lib, deps));
      return 0;
    case "render":
      print({ videos: render(a1, lib, { ...deps, draft: flags.has("--taslak") }) });
      return 0;
    case "qa":
      print(qaPages(a1, { run, ffmpeg: loadTools().ffmpeg }));
      return 0;
    case "panel":
      // The library is reloaded when one of its files changes, so an edited rig or action shows up without a restart.
      // A folder lists every bolum.json under it; a bolum.json opens its own folder with that episode first.
      const space = workspaceOf(resolve(a1));
      // Storyboard and draft render jobs run this same CLI in a child process.
      const jobs = createJobs({ cli: fileURLToPath(import.meta.url), library: resolve(library) });
      process.once("SIGINT", () => {
        jobs.stopAll(); // Ctrl+C stops a storyboard or render started from the panel too
        process.exit(130);
      });
      startPanel({ ...space, loadLib: cachedLibrary(library, loadLibrary), status, port, jobs }).then(
        ({ url }) => print({ panel: url, folder: space.root, stop: "Ctrl+C" }),
        (err) => {
          process.stderr.write(`error: ${err.message}\n`);
          process.exitCode = 1;
        },
      );
      return 0;
    case "derle":
      print(compileEpisode(a1, lib, a2, { format: a3 }));
      return 0;
    default:
      return 2;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`error: ${err.message}\n`);
    process.exitCode = 1;
  }
}
