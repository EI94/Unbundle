// Helpers of scripts/connettore-test/smoke-run.mjs (prompt WP10), apart so that unit tests can
// run them (src/lib/connector/smoke-support.test.ts):
//  - the `next start` child process: spawned and handed back at once, so the caller can always
//    stop it, even when it never listens; waited for; stopped (only this child, never by name);
//  - the values the server log must never contain, from the submission the smoke really sends;
//  - where the server log may be saved: only under a valid UC_TEST_ROOT (outside git).
import { spawn } from "node:child_process";
import { connect as netConnect } from "node:net";
import { dirname, join, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { ucTestRoot } from "../uc-test/config.mjs";

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** @returns {Promise<boolean>} whether something accepts TCP connections on host:port. */
export function isListening(host, port) {
  return new Promise((done) => {
    const socket = netConnect({ host, port });
    socket.setTimeout(2000);
    socket.once("connect", () => {
      socket.destroy();
      done(true);
    });
    socket.once("error", () => done(false));
    socket.once("timeout", () => {
      socket.destroy();
      done(false);
    });
  });
}

/**
 * @typedef {{ child: import("node:child_process").ChildProcess, output: string[], exited: string | number | null, stopped: boolean, startedAt: number, readyMs: number }} ServerHandle
 */

/**
 * Spawns the server as a child process and returns its handle at once (before it listens): the
 * caller keeps it and stops it in its `finally`, whatever happens while waiting.
 * @param {{ command: string, args: string[], cwd: string, env: Record<string, string> }} options
 * @returns {ServerHandle}
 */
export function spawnServer({ command, args, cwd, env }) {
  const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  /** @type {ServerHandle} */
  const handle = { child, output: [], exited: null, stopped: false, startedAt: performance.now(), readyMs: 0 };
  child.stdout?.on("data", (chunk) => handle.output.push(chunk.toString("utf8")));
  child.stderr?.on("data", (chunk) => handle.output.push(chunk.toString("utf8")));
  child.on("exit", (code, signal) => (handle.exited = code ?? signal ?? "exit"));
  child.on("error", () => (handle.exited = handle.exited ?? "spawn error"));
  return handle;
}

/**
 * Waits until host:port listens; throws if the child exits first or after `timeoutMs`. It never
 * stops the child: that is the caller's `stopServer`.
 * @param {ServerHandle} handle
 * @param {{ host: string, port: number, timeoutMs: number, label?: string }} options
 */
export async function waitUntilListening(handle, { host, port, timeoutMs, label = "next start" }) {
  while (!(await isListening(host, port))) {
    if (handle.exited !== null) throw new Error(`${label} exited before listening (${handle.exited})`);
    if (performance.now() - handle.startedAt > timeoutMs) throw new Error(`${label} did not listen on ${host}:${port} within ${Math.round(timeoutMs / 1000)} s (child process ${handle.child.pid})`);
    await sleep(100);
  }
  handle.readyMs = performance.now() - handle.startedAt;
  return handle.readyMs;
}

/**
 * Stops only this child (SIGTERM; start-app.mjs forwards it to Next) and waits until it has
 * exited and the port is free. Safe to call twice or with no handle.
 * @param {ServerHandle | null} handle
 * @param {{ host: string, port: number, waitMs?: number }} options
 * @returns {Promise<boolean>} true when the child has exited and the port no longer listens.
 */
export async function stopServer(handle, { host, port, waitMs = 15_000 }) {
  if (!handle) return true;
  if (!handle.stopped) {
    handle.stopped = true;
    if (handle.exited === null) handle.child.kill("SIGTERM");
  }
  const until = performance.now() + waitMs;
  while (performance.now() < until && (handle.exited === null || (await isListening(host, port)))) await sleep(100);
  return handle.exited !== null && !(await isListening(host, port));
}

/** Free-text fields of a submit_contribution input: what the server log must never contain. */
const TEXT_KEYS = new Set([
  "title",
  "problem",
  "flowDescription",
  "toolsOther",
  "humanInTheLoop",
  "guardrails",
  "expectedImpact",
  "dataRequirements",
  "sustainabilityImpact",
  "reasoning",
  "promptSnippet",
  "sourceConversation",
  "name",
  "email",
]);

/**
 * The values to look for in the server log: every non-empty free text of the submission the
 * smoke sends (problem, flow, guardrails, estimates, prompt, submitter name and email…, at any
 * depth), then `extras` (token, hash, run id, phone in every form). Enum values (area, tools,
 * kind…) are public values of the guide and are not searched.
 * @param {unknown} submission
 * @param {Array<string | null | undefined>} [extras]
 * @returns {string[]}
 */
export function forbiddenLogValues(submission, extras = []) {
  const out = new Set();
  const walk = (value, key) => {
    if (typeof value === "string") {
      if (TEXT_KEYS.has(key) && value.trim()) out.add(value.trim());
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item, key);
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(v, k);
    }
  };
  walk(submission, "");
  for (const value of extras) if (typeof value === "string" && value) out.add(value);
  return [...out];
}

/** A phone number as written and as bare digits (with and without the country prefix). */
export function phoneForms(phone) {
  const digits = phone.replace(/\D/g, "");
  const national = digits.startsWith("39") && digits.length > 10 ? digits.slice(2) : digits;
  const spaced = phone.replace(/^\+\d{2}\s*/, "");
  return [...new Set([phone, spaced, digits, national])];
}

/**
 * Where the server log of a run may be saved: `$UC_TEST_ROOT/conn-evidence/k10/next-start-<run>.log`,
 * only when UC_TEST_ROOT passes the guard of scripts/uc-test/config.mjs (/private/tmp/… or
 * /tmp/…) and is not inside this checkout (outside git); otherwise the reason it is not saved.
 * @param {string} runId
 * @returns {{ dir: string, file: string } | { reason: string }}
 */
export function serverLogTarget(runId) {
  if (!process.env.UC_TEST_ROOT?.trim()) return { reason: "UC_TEST_ROOT non impostata" };
  try {
    const root = resolve(ucTestRoot());
    // Anche dopo la normalizzazione («/tmp/../…» esce da /tmp) e mai dentro questa checkout.
    if (!/^\/(private\/)?tmp\/./.test(root)) throw new Error("outside the temporary directories");
    if (root === repoRoot || root.startsWith(`${repoRoot}${sep}`)) throw new Error("inside the checkout");
    const dir = join(root, "conn-evidence", "k10");
    return { dir, file: join(dir, `next-start-${runId}.log`) };
  } catch {
    return { reason: "UC_TEST_ROOT non è una cartella temporanea fuori da git (/private/tmp/… o /tmp/…)" };
  }
}
