#!/usr/bin/env node
/**
 * cizgi — command line for the engine. Output is JSON (easy for an agent to read).
 *
 *   cizgi dogrula    <bolum.json>                    schema + library + profile warnings
 *   cizgi durum      <bolum.json>                    gates, audio state, next step
 *   cizgi senaryo    <bolum.json>                    the script table to show at the senaryo gate
 *   cizgi onayla     senaryo|storyboard <bolum.json> record a human approval (only after a yes)
 *   cizgi ses        <bolum.json> [--hepsi]          speak, check and time changed lines
 *   cizgi kabul      <bolum.json> <line-key>         keep a take that failed the listening check (only after a yes)
 *   cizgi storyboard <bolum.json> [--format 16:9]    stills of every shot for review
 *   cizgi storyboard <bolum.json> --sahne <id>        stills of one scene (panel's scene review; no gate)
 *   cizgi render     <bolum.json> [--taslak] [--3b] [--format 9:16]
 *   cizgi qa         <video.mp4>                     review pages (4 fps) of a RENDERED video; look at every page
 *   cizgi derle      <bolum.json> <out-dir> [16:9|9:16]
 *   cizgi panel      <klasör|bolum.json> [--port 4810] local control panel (127.0.0.1): pick an episode, edit shots with a live preview
 *   cizgi taslaklar  <klasör>                         drafts of the project library (kutuphane/taslak) and their problems
 *
 * Options: --kutuphane <dir> (default: ../library next to the engine)
 *          --proje-kutuphane <dir> (default: the nearest kutuphane/ above the episode, below the home folder)
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
import { storyboard, sceneStills, render, qaPages } from "./uretim.mjs";
import { loadTools, run } from "./tools.mjs";
import { openPanel } from "./panel-baslat.mjs";
import { projectLibraryOf, listDrafts } from "./proje-kutuphane.mjs";
import { decisionProblems, requireDecisions } from "./kararlar.mjs";
import { scriptTable } from "./senaryo-tablo.mjs";
import { checkLibrary, integrityErrors } from "./icerik.mjs";

const DEFAULT_LIBRARY = fileURLToPath(new URL("../../library", import.meta.url));
const FLAGS = new Set(["--hepsi", "--taslak", "--3b"]);
const NEEDS = { dogrula: 1, durum: 1, senaryo: 1, ses: 1, storyboard: 1, render: 1, onayla: 2, derle: 2, kabul: 2, qa: 1, panel: 1, taslaklar: 1 };
const USAGE =
  "usage: cizgi dogrula|durum|senaryo|ses|storyboard|render <bolum.json> · cizgi panel <klasör|bolum.json> · cizgi onayla senaryo|storyboard <bolum.json> · cizgi kabul <bolum.json> <line> · cizgi derle <bolum.json> <dir> [format]\n";

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
  let scene;
  let project;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--kutuphane" || a === "--format" || a === "--port" || a === "--sahne" || a === "--proje-kutuphane") {
      const value = argv[++i];
      if (!value) throw new Error(`${a} needs a value`);
      if (a === "--sahne") scene = value;
      else if (a === "--proje-kutuphane") project = value;
      else if (a === "--port") {
        port = Number(value);
        if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port needs a whole number 0-65535");
      } else if (a === "--kutuphane") library = value;
      else formats.push(value);
    } else if (FLAGS.has(a)) flags.add(a);
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else args.push(a);
  }
  return { args, flags, library, port, scene, project, formats: formats.length ? formats : undefined };
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
  const kararlar = decisionProblems(episode, lib);
  if (gates.senaryo !== "onayli" && kararlar.eksik.length) next = `ask the person the open decisions (kararlar: ${kararlar.eksik.length}), record them in bolum.json, show the script, then: cizgi onayla senaryo`;
  else if (gates.senaryo !== "onayli") next = "show the script to the person, then: cizgi onayla senaryo";
  else if (plan.todo.length) next = `cizgi ses (${plan.todo.length} line(s) to speak)`;
  else if (gates.storyboard !== "onayli") next = "cizgi storyboard, show the stills, then: cizgi onayla storyboard";
  else next = "cizgi render";
  return { valid: true, warnings, kararlar, gates, audio: { lines: lines.length, todo: plan.todo.map((l) => l.key), failed }, next };
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function main(argv) {
  const { args, flags, library, formats, port, scene, project } = parseArgs(argv);
  const [command, a1, a2, a3] = args;
  if (!NEEDS[command] || args.length - 1 < NEEDS[command] || (command === "onayla" && !GATES.includes(a1))) {
    process.stderr.write(USAGE);
    return 2;
  }
  // The project's own library (<project>/kutuphane, the nearest above the episode) joins the plugin's.
  const episodeArg = command === "onayla" ? a2 : ["qa", "panel", "taslaklar"].includes(command) ? null : a1;
  // (--proje-kutuphane names it: the panel's jobs pass the one the panel uses)
  const lib = loadLibrary(library, { project: project ? resolve(project) : episodeArg ? projectLibraryOf(dirname(resolve(episodeArg))) : null });
  const deps = { run, formats, log: (m) => process.stderr.write(`${m}\n`) };

  switch (command) {
    case "dogrula": {
      const episode = readJson(a1);
      const res = validateEpisode(episode, lib);
      if (!res.ok) {
        print(res);
        return 1;
      }
      // files added to or changed in this installed copy of the plugin library: lost on the next update
      const check = checkLibrary(library);
      const errors = integrityErrors(episode, check);
      const local = check.eklenen.length || check.degisen.length ? { eklenti_kutuphanesi: { eklenen: check.eklenen, degisen: check.degisen } } : {};
      print({ ...res, ok: !errors.length, errors, ...local, kararlar: decisionProblems(episode, lib) });
      return errors.length ? 1 : 0;
    }
    case "durum":
      print(status(a1, lib));
      return 0;
    case "senaryo": {
      const episode = readJson(a1);
      const { ok, errors } = validateEpisode(episode, lib);
      if (!ok) throw new Error(`episode is invalid:\n- ${errors.join("\n- ")}`);
      print(scriptTable(episode));
      return 0;
    }
    case "onayla": {
      const episode = readJson(a2);
      const { ok, errors } = validateEpisode(episode, lib);
      if (!ok) throw new Error(`episode is invalid:\n- ${errors.join("\n- ")}`);
      const local = integrityErrors(episode, checkLibrary(library));
      if (local.length) throw new Error(`episode uses library files that are not part of the plugin:\n- ${local.join("\n- ")}`);
      if (a1 === "senaryo") requireDecisions(episode, lib);
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
      // --sahne: stills of one scene for review (no approval needed, not the storyboard to approve)
      print(scene ? sceneStills(a1, lib, scene, deps) : storyboard(a1, lib, deps));
      return 0;
    case "render":
      print({ videos: render(a1, lib, { ...deps, draft: flags.has("--taslak"), d3: flags.has("--3b") }) });
      return 0;
    case "qa":
      print(qaPages(a1, { run, ffmpeg: loadTools().ffmpeg }));
      return 0;
    case "panel":
      // A folder lists every bolum.json under it; a bolum.json opens its own folder with that episode first.
      openPanel({ target: a1, library, status, port }).then(
        (panel) => {
          process.once("SIGINT", () => {
            // Ctrl+C stops a storyboard or render started from the panel too
            panel.close(); // stops the jobs at once; open connections need not drain
            process.exit(130);
          });
          print({ panel: panel.url, folder: panel.root, stop: "Ctrl+C" });
        },
        (err) => {
          process.stderr.write(`error: ${err.message}\n`);
          process.exitCode = 1;
        },
      );
      return 0;
    case "taslaklar": {
      // the drafts of the project library at or above the folder, each with what is wrong with it
      const proj = projectLibraryOf(resolve(a1));
      const plib = proj ? loadLibrary(library, { project: proj }) : null;
      print({ kutuphane: proj, taslaklar: plib ? listDrafts(proj, plib) : [], kutuphane_sorunlari: plib?.projectErrors || [] });
      return 0;
    }
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
