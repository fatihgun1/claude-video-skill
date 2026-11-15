#!/usr/bin/env node
/**
 * cizgi — command line for the engine.
 *   cizgi dogrula <episode.json>                 validate against schema + library
 *   cizgi derle <episode.json> <out-dir> [9:16]  compile to a HyperFrames project
 * Library folder: --kutuphane <dir> (default: ../library next to the engine)
 */
import { fileURLToPath } from "node:url";
import { loadLibrary } from "./library.mjs";
import { validateEpisode } from "./validate.mjs";
import { compileEpisode } from "./compile.mjs";
import { readJson } from "./util.mjs";

const DEFAULT_LIBRARY = fileURLToPath(new URL("../../library", import.meta.url));

function parseArgs(argv) {
  const args = [];
  let library = DEFAULT_LIBRARY;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--kutuphane") {
      library = argv[++i];
      if (!library) throw new Error("--kutuphane needs a folder");
    } else args.push(argv[i]);
  }
  return { args, library };
}

function main(argv) {
  const { args, library } = parseArgs(argv);
  const [command, episodePath, outDir, format] = args;
  const lib = loadLibrary(library);

  if (command === "dogrula" && episodePath) {
    const { ok, errors } = validateEpisode(readJson(episodePath), lib);
    process.stdout.write(ok ? "OK\n" : `${errors.map((e) => `- ${e}`).join("\n")}\n`);
    return ok ? 0 : 1;
  }
  if (command === "derle" && episodePath && outDir) {
    const res = compileEpisode(episodePath, lib, outDir, { format });
    process.stdout.write(`${JSON.stringify(res)}\n`);
    return 0;
  }
  process.stderr.write("usage: cizgi dogrula <episode.json> | cizgi derle <episode.json> <out-dir> [16:9|9:16]\n");
  return 2;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  process.stderr.write(`error: ${err.message}\n`);
  process.exitCode = 1;
}
