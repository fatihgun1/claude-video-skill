#!/usr/bin/env node
/**
 * cizgi — command line for the engine. Output is JSON (easy for an agent to read).
 *
 *   cizgi dogrula    <bolum.json>                    schema + library + profile warnings
 *   cizgi durum      <bolum.json>                    gates, audio state, next step
 *   cizgi senaryo    <bolum.json>                    the script table to show at the senaryo gate
 *   cizgi onayla     senaryo|storyboard <bolum.json> record a human approval (only after a yes)
 *   cizgi ses        <bolum.json> [--hepsi]          speak (Edge TTS, internet) and time changed lines
 *   cizgi ses        <bolum.json> <shot>-<n>         speak that one line again
 *   cizgi ses-ornek  <bolum.json> <karakter> [--metin "…"]  one sentence in that voice (cikti/ses-ornegi-<id>.wav), no approval
 *   cizgi kabul      <bolum.json> <line-key>         keep a take that failed the listening check (only after a yes)
 *   cizgi storyboard <bolum.json> [--format 16:9]    stills of every shot for review
 *   cizgi storyboard <bolum.json> --sahne <id>        stills of one scene (panel's scene review; no gate)
 *   cizgi render     <bolum.json> [--taslak] [--3b] [--format 9:16]
 *   cizgi qa         <video.mp4>                     review pages (4 fps) of a RENDERED video; look at every page
 *   cizgi derle      <bolum.json> <out-dir> [16:9|9:16]
 *   cizgi panel      <klasör|bolum.json> [--port 4810] local control panel (127.0.0.1): pick an episode, edit shots with a live preview
 *   cizgi taslaklar  <klasör>                         drafts of the project library (kutuphane/taslak) and their problems
 *   cizgi taslak-al  <klasör> <tur>/<id>... [--onaylandi]  take the drafts you drew (and checked) into the project library
 *                    (an update of a drawing an approved episode uses needs --onaylandi, after the person's yes)
 *   cizgi seri-ozet  <seriler/<id>.json>              a series and its episodes in order: read before writing a new one
 *   cizgi uyari-kabul <bolum.json> <kod>... --neden "…"  keep warnings the person accepted (only after their yes)
 *   cizgi istek-bekle <klasör> [dakika]              in the background while idle: exits when the panel leaves a request
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
import { GATES, readApprovals, gateStatus, scriptFingerprint, storyboardFingerprint, libraryFingerprint } from "./onay.mjs";
import { runAudio, readManifest, linesOf, planAudio, fingerprintsOf, failedLines, acceptLine, voiceSample } from "./ses.mjs";
import { storyboard, sceneStills, render, qaPages } from "./uretim.mjs";
import { loadTools, run } from "./tools.mjs";
import { lockHolder, pidAlive, defaultLockPath } from "./ses-kilit.mjs";
import { openPanel } from "./panel-baslat.mjs";
import { projectLibraryOf, listDrafts, approveDraft } from "./proje-kutuphane.mjs";
import { decisionProblems } from "./kararlar.mjs";
import { approveEpisode } from "./onayla.mjs";
import { queueOf, markWatcher } from "./istekler.mjs";
import { waitForRequest } from "./istek-bekle.mjs";
import { openWarnings, acceptWarnings } from "./uyari-kabul.mjs";
import { readStory } from "./hikaye.mjs";
import { seriesSummary } from "./seri.mjs";
import { contextWarnings } from "./baglam.mjs";
import { scriptTable } from "./senaryo-tablo.mjs";
import { checkLibrary, integrityErrors } from "./icerik.mjs";

const DEFAULT_LIBRARY = fileURLToPath(new URL("../../library", import.meta.url));
const FLAGS = new Set(["--hepsi", "--taslak", "--3b", "--onaylandi"]);
const NEEDS = { "seri-ozet": 1, "uyari-kabul": 2, "ses-ornek": 2, dogrula: 1, durum: 1, senaryo: 1, ses: 1, storyboard: 1, render: 1, onayla: 2, derle: 2, kabul: 2, qa: 1, panel: 1, taslaklar: 1, "taslak-al": 2 };
const USAGE =
  "usage: cizgi dogrula|durum|senaryo|ses|storyboard|render <bolum.json> · cizgi panel <klasör|bolum.json> · cizgi onayla senaryo|storyboard <bolum.json> · cizgi kabul <bolum.json> <line> · cizgi ses-ornek <bolum.json> <karakter> · cizgi derle <bolum.json> <dir> [format]\n";

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
  let text;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--kutuphane" || a === "--format" || a === "--port" || a === "--sahne" || a === "--proje-kutuphane" || a === "--metin" || a === "--neden") {
      const value = argv[++i];
      if (!value) throw new Error(`${a} needs a value`);
      if (a === "--sahne") scene = value;
      else if (a === "--metin" || a === "--neden") text = value;
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
  return { args, flags, library, port, scene, project, text, formats: formats.length ? formats : undefined };
}

/**
 * Everything a person (or agent) needs to know about where an episode stands.
 * @param {string} episodePath
 * @param {ReturnType<typeof loadLibrary>} lib
 * @returns {object}
 */
export function status(episodePath, lib) {
  const episode = readJson(episodePath);
  const { ok, errors, warnings: own } = validateEpisode(episode, lib);
  if (!ok) return { valid: false, errors, next: "fix the episode (cizgi dogrula)" };
  const warnings = [...own, ...contextWarnings(episodePath, episode, lib)];
  const approvals = readApprovals(episodePath);
  const manifest = readManifest(episodePath);
  const dir = dirname(resolve(episodePath));
  const lines = linesOf(episode);
  const plan = planAudio(lines, manifest, fingerprintsOf(episode, lib), (p) => existsSync(safeJoin(dir, p)));
  const failed = failedLines(manifest);
  const gates = {
    senaryo: gateStatus(approvals, "senaryo", scriptFingerprint(episode)),
    storyboard: gateStatus(approvals, "storyboard", storyboardFingerprint(episode, manifest, libraryFingerprint(episode, lib))),
  };
  let next;
  const kararlar = decisionProblems(episode, lib, readStory(episodePath));
  if (gates.senaryo !== "onayli" && kararlar.eksik.length) next = `ask the person the open decisions (kararlar: ${kararlar.eksik.length}), record them in bolum.json, show the script, then: cizgi onayla senaryo`;
  else if (gates.senaryo !== "onayli") next = "show the script to the person, then: cizgi onayla senaryo";
  else if (plan.todo.length) next = `cizgi ses (${plan.todo.length} line(s) to speak)`;
  else if (gates.storyboard !== "onayli") next = "cizgi storyboard, show the stills, then: cizgi onayla storyboard";
  else next = "cizgi render";
  // a voice job running right now (the panel's or another `cizgi ses`): never start a second one
  const held = lockHolder(defaultLockPath());
  const running = held && pidAlive(held.pid) ? { bolum: held.bolum, pid: held.pid, since: held.since } : null;
  return { valid: true, warnings, kararlar, gates, audio: { lines: lines.length, todo: plan.todo.map((l) => l.key), failed, running }, next };
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function main(argv) {
  const { args, flags, library, formats, port, scene, project, text } = parseArgs(argv);
  const [command, a1, a2, a3] = args;
  if (!NEEDS[command] || args.length - 1 < NEEDS[command] || (command === "onayla" && !GATES.includes(a1))) {
    process.stderr.write(USAGE);
    return 2;
  }
  // The project's own library (<project>/kutuphane, the nearest above the episode) joins the plugin's.
  const episodeArg = command === "onayla" ? a2 : ["qa", "panel", "taslaklar", "taslak-al", "seri-ozet"].includes(command) ? null : a1;
  // (--proje-kutuphane names it: the panel's jobs pass the one the panel uses)
  const lib = loadLibrary(library, { project: project ? resolve(project) : episodeArg ? projectLibraryOf(dirname(resolve(episodeArg))) : null });
  const deps = { run, formats, log: (m) => process.stderr.write(`${m}\n`) };

  switch (command) {
    case "dogrula": {
      const episode = readJson(a1);
      const own = validateEpisode(episode, lib);
      if (!own.ok) {
        print(own);
        return 1;
      }
      const res = { ...own, warnings: [...own.warnings, ...contextWarnings(a1, episode, lib)] };
      // files added to or changed in this installed copy of the plugin library: lost on the next update
      const check = checkLibrary(library);
      const errors = integrityErrors(episode, check);
      const local = check.eklenen.length || check.degisen.length ? { eklenti_kutuphanesi: { eklenen: check.eklenen, degisen: check.degisen } } : {};
      // every warning with its code: an open one holds the approvals until fixed or accepted by the person
      print({ ...res, ok: !errors.length, errors, acik_uyarilar: openWarnings(episode, res.warnings), ...local, kararlar: decisionProblems(episode, lib, readStory(a1)) });
      return errors.length ? 1 : 0;
    }
    case "durum":
      print(status(a1, lib));
      return 0;
    case "seri-ozet":
      // what a new episode of a series reads first: the series file, then each episode in order
      print(seriesSummary(a1));
      return 0;
    case "senaryo": {
      const episode = readJson(a1);
      const { ok, errors } = validateEpisode(episode, lib);
      if (!ok) throw new Error(`episode is invalid:\n- ${errors.join("\n- ")}`);
      print(scriptTable(episode));
      return 0;
    }
    case "uyari-kabul": {
      // only after the person said yes to keeping these warnings, with their reason
      print({ kabul: acceptWarnings(a1, args.slice(2), text) });
      return 0;
    }
    case "onayla": {
      print(approveEpisode(a2, a1, lib)); // the same checks as the panel's approval buttons
      return 0;
    }
    case "ses": {
      // one line spoken again, the other lines stay as they are
      const one = a2 ? { only: a2 } : {};
      const res = runAudio(a1, lib, loadTools(), { ...deps, force: flags.has("--hepsi"), ...one });
      print(res);
      return res.failed.length ? 3 : 0;
    }
    case "ses-ornek":
      print(voiceSample(a1, lib, loadTools(), deps, { karakter: a2, metin: text }));
      return 0;
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
    case "taslak-al": {
      // Claude takes in what it drew for this episode, once its own checks pass: a separate
      // "Kütüphaneye al" click per drawing made the person wait (Köşe Başı: "direkt alsın").
      // Only the named drafts: leftovers of other episodes stay where they are.
      const proj = projectLibraryOf(resolve(a1));
      if (!proj) throw new Error(`no project library (kutuphane/) at or above ${a1}`);
      const alinan = [];
      const hatalar = [];
      for (const name of args.slice(2)) {
        const [tur, id] = name.split("/");
        try {
          alinan.push(approveDraft(proj, tur, id, loadLibrary(library, { project: proj }), { onaylandi: flags.has("--onaylandi") }));
        } catch (err) {
          hatalar.push({ taslak: name, hata: err.message });
        }
      }
      print({ kutuphane: proj, alinan, hatalar });
      return hatalar.length ? 1 : 0;
    }
    case "derle":
      print(compileEpisode(a1, lib, a2, { format: a3 }));
      return 0;
    default:
      return 2;
  }
}

/**
 * cizgi istek-bekle <proje klasörü> [dakika]: runs in the background while the session is idle and
 * exits as soon as the panel leaves a request, so the finished command brings the session back.
 */
const SINCE_SLACK_MS = 5000; // a request sent in the seconds the turn was ending still counts
async function waitForPanel([given, minutes = "60"]) {
  // the session's project folder by default: the queue the MCP server and the hooks use
  const folder = given || process.env.CLAUDE_PROJECT_DIR;
  const limit = Number(minutes);
  if (!folder || !Number.isFinite(limit) || limit <= 0 || limit > 600) {
    process.stderr.write("usage: cizgi istek-bekle [proje klasörü] [dakika, 1-600]\n");
    return 2;
  }
  markWatcher(folder, process.pid); // the Stop hook sees someone is listening
  const unmark = () => markWatcher(folder, null);
  process.on("exit", unmark);
  const found = await waitForRequest(queueOf(folder), { since: new Date(Date.now() - SINCE_SLACK_MS), timeoutMs: limit * 60_000 });
  // what to do next, for the session this wakes (the request texts come through panel_istekleri)
  print(found
    ? { istek: found.length, sonraki: "panel_istekleri ile al, yap, panel_yanitla ile cevapla; sonra panel_dinle (tur biterken istek-bekle'yi yeniden başlat)" }
    : { istek: 0, sonraki: `${limit} dakikada panelden istek gelmedi; panel açıksa istek-bekle'yi yeniden başlat` });
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv[2] === "istek-bekle") {
    waitForPanel(process.argv.slice(3)).then((code) => {
      process.exitCode = code;
    }, (err) => {
      process.stderr.write(`error: ${err.message}\n`);
      process.exitCode = 1;
    });
  } else try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`error: ${err.message}\n`);
    process.exitCode = 1;
  }
}
