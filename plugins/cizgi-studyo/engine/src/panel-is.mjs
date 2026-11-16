/**
 * Production jobs started from the panel: storyboard stills and draft videos. They run the
 * same `cizgi storyboard` / `cizgi render --taslak` commands as the terminal, in a child
 * process, so the panel stays responsive for the minutes a render takes. One job per
 * episode at a time. The panel never approves anything: approvals stay with the person.
 */
import { spawn as nodeSpawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep, dirname } from "node:path";

// sahne: stills of one scene for review (its scene id follows --sahne); ses: speak the lines
// (no format: the audio is the same for both)
export const JOB_KINDS = Object.freeze({ storyboard: ["storyboard"], taslak: ["render", "--taslak"], sahne: ["storyboard", "--sahne"], ses: ["ses"] });
const NO_FORMAT = new Set(["ses"]);
// `cizgi ses` exits 3 when some lines failed the listening check: still a finished job
const DONE_CODES = { ses: [0, 3] };
// "ilerleme {json}" lines on stderr: how far a step is (see ses.mjs)
const PROGRESS = /^ilerleme (\{.*\})\s*$/;
const PROGRESS_STEPS = new Set(["seslendirme", "kontrol", "agiz"]);

/** A progress line's {adim, bitti, toplam}, or null when it is not a well-formed one. */
function progressOf(line) {
  const m = PROGRESS.exec(line);
  if (!m) return null;
  try {
    const p = JSON.parse(m[1]);
    const count = (n) => Number.isInteger(n) && n >= 0 && n <= 100000;
    if (!PROGRESS_STEPS.has(p.adim) || !count(p.bitti) || !count(p.toplam) || p.bitti > p.toplam) return null;
    return { adim: p.adim, bitti: p.bitti, toplam: p.toplam };
  } catch {
    return null;
  }
}
const SCENE_ID = /^[a-z0-9]+([_-][a-z0-9]+)*$/;
export const JOB_FORMATS = new Set(["16:9", "9:16"]);
const LOG_TAIL = 4000; // characters of output kept for the panel
const MAX_OUT = 1_000_000; // the CLI's JSON answer is small; more than this is not an answer
const TIMEOUT_MS = 30 * 60 * 1000; // a job still running after this is stuck
// speech may first download its models (several GB) and retries bad takes
const TIMEOUTS_MS = { ses: 90 * 60 * 1000 };

/** End a process and every process it started (on Windows kill() would leave the children running). */
function defaultKillTree(pid) {
  if (process.platform === "win32") {
    nodeSpawn("taskkill", ["/T", "/F", "/PID", String(pid)], { windowsHide: true, stdio: "ignore" }).on("error", () => {});
  } else {
    process.kill(pid, "SIGTERM");
  }
}

/**
 * @param {{cli:string, library?:string, spawn?:typeof nodeSpawn, now?:() => number, timeoutMs?:number}} opts
 */
export function createJobs(opts) {
  const spawn = opts.spawn || nodeSpawn;
  const now = opts.now || Date.now;
  const killTree = opts.killTree || defaultKillTree;
  const jobs = new Map(); // episode path → job

  /** End a running job: kill its process and record why. */
  function stop(job, why) {
    if (job.status !== "running") return false;
    job.status = "failed";
    job.error = why;
    job.ended = now();
    clearTimeout(job.timer);
    try {
      // the CLI runs Python, Rhubarb, HyperFrames as its own children: they must stop too
      if (job.child.pid) killTree(job.child.pid);
      else job.child.kill();
    } catch {
      /* already gone */
    }
    return true;
  }

  const view = (j) => j && {
    kind: j.kind, format: j.format, scene: j.scene ?? null, status: j.status, started: j.started, ended: j.ended ?? null,
    error: j.error ?? null, result: j.result ?? null, log: j.log.slice(-LOG_TAIL), progress: j.progress,
  };

  return {
    /** Start a job; refused while another runs for the same episode. */
    start(episodePath, kind, format, scene) {
      if (!Object.hasOwn(JOB_KINDS, kind)) throw Object.assign(new Error(`unknown job "${kind}"`), { code: 400 });
      if (!JOB_FORMATS.has(format)) throw Object.assign(new Error(`format must be ${[...JOB_FORMATS].join(" or ")}`), { code: 400 });
      if (kind === "sahne" && !SCENE_ID.test(scene || "")) throw Object.assign(new Error("a scene id is needed"), { code: 400 });
      if (jobs.get(episodePath)?.status === "running") throw Object.assign(new Error("a job is already running for this episode"), { code: 409 });
      // the panel's own project library, so a job sees exactly the drawings the panel validated against
      const args = [opts.cli, ...JOB_KINDS[kind], ...(kind === "sahne" ? [scene] : []), episodePath,
        ...(NO_FORMAT.has(kind) ? [] : ["--format", format]),
        ...(opts.library ? ["--kutuphane", opts.library] : []), ...(opts.project ? ["--proje-kutuphane", opts.project] : [])];
      const job = { kind, format, ...(kind === "sahne" ? { scene } : {}), status: "running", started: now(), log: "", out: "", partial: "", progress: null };
      jobs.set(episodePath, job);
      const child = spawn(process.execPath, args, { cwd: dirname(episodePath), windowsHide: true });
      job.child = child;
      const timeoutMs = opts.timeoutMs ?? (TIMEOUTS_MS[kind] || TIMEOUT_MS);
      job.timer = setTimeout(() => stop(job, `zaman aşımı: ${Math.round(timeoutMs / 60000)} dakikadan uzun sürdü, durduruldu`), timeoutMs);
      job.timer.unref?.(); // the watch alone never keeps the panel's process running
      child.stdout.on("data", (d) => {
        if (job.out.length < MAX_OUT) job.out += d;
      });
      child.stderr.on("data", (d) => {
        job.log = (job.log + d).slice(-LOG_TAIL * 2);
        // whole lines only: a progress line may arrive in two pieces
        const lines = (job.partial + d).split(/\r?\n|\r/); // progress bars redraw with a bare \r
        job.partial = lines.pop().slice(-LOG_TAIL);
        for (const line of lines) job.progress = progressOf(line) || job.progress;
      });
      child.on("error", (err) => {
        clearTimeout(job.timer);
        if (job.status !== "running") return;
        job.status = "failed";
        job.error = err.message;
        job.ended = now();
      });
      child.on("close", (code) => {
        clearTimeout(job.timer);
        if (job.status !== "running") return;
        job.ended = now();
        try {
          job.result = JSON.parse(job.out);
        } catch {
          job.result = null;
        }
        if ((DONE_CODES[kind] || [0]).includes(code) && job.result) job.status = "done";
        else {
          job.status = "failed";
          job.error = lastError(job.log) || `exit code ${code}`;
        }
      });
      return view(job);
    },
    get: (episodePath) => view(jobs.get(episodePath)) || null,
    /** Stop the running job of an episode. @returns {boolean} whether one was running */
    cancel: (episodePath) => {
      const j = jobs.get(episodePath);
      return j ? stop(j, "panelden durduruldu") : false;
    },
    /** Stop every running job (the panel is closing). */
    stopAll: () => {
      for (const j of jobs.values()) stop(j, "panel kapandı, durduruldu");
    },
  };
}

/**
 * The CLI's "error: …" message, which says why (an approval missing, a tool not installed…).
 * It can run over several lines: "npx exited with 1:" is followed by the lines that say what
 * failed, so a few lines under it are kept too (the cause comes first).
 */
const ERROR_LINES = 8;
function lastError(log) {
  // the CLI's own line starts with "error: "; a tool's message under it may say "error: " mid-line
  const at = [...log.matchAll(/^error: /gm)].at(-1)?.index ?? -1;
  if (at === -1) return log.trim().split("\n").at(-1) || "";
  return log.slice(at + "error: ".length).split("\n").map((l) => l.trimEnd()).filter(Boolean).slice(0, ERROR_LINES).join("\n");
}

/**
 * What the production steps left next to an episode, as paths relative to its folder:
 * storyboard contact sheets and rendered videos (newest first).
 */
export function outputsOf(episodePath) {
  const dir = dirname(episodePath);
  const list = (sub, test) => {
    const base = join(dir, sub);
    if (!existsSync(base)) return [];
    const out = [];
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (test(e.name)) out.push({ path: relative(dir, p).split(sep).join("/"), time: statSync(p).mtimeMs });
      }
    };
    walk(base);
    return out.sort((a, b) => b.time - a.time).map((o) => o.path);
  };
  return {
    sheets: list("storyboard", (n) => /^contact-sheet.*\.(png|jpg)$/.test(n)),
    videos: list("cikti", (n) => n.endsWith(".mp4")),
    review: list("inceleme", (n) => /^contact-sheet.*\.(png|jpg)$/.test(n)), // inceleme/<scene>/<format>/…
  };
}

/** Folders of an episode the panel may serve production files from. */
export const OUTPUT_DIRS = Object.freeze(["storyboard", "cikti", "inceleme"]);
