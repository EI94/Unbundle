// Read budget of the Casi d'uso pages on the local harness (DESIGN §7.1 P0-5 e).
// App on 127.0.0.1:53110 (better: start-app.mjs --production after --build), login helper on
// 53112, fixtures from seed-fixtures.mjs. Measures, per route and account:
//
//   - first load: GET of the HTML document, time to the first byte of the body (TTFB; with
//     streaming the headers come at once, so they do not count), whole time and size;
//   - navigation: GET with the RSC header (the payload of a client navigation), same measures;
//   - with --round-trips: database round-trips of one navigation, read from
//     pg_stat_database.xact_commit before and after (each Neon HTTP query or batch is one
//     transaction on the harness). Approximate: the app must be otherwise idle, and each
//     reading waits for Postgres to flush its statistics (about 11 s).
//
// Budgets: TTFB p95 < 800 ms on first load and < 500 ms on navigation; HTML < 300 KB;
// RSC payload < 200 KB; at most 4 round-trips per navigation. A route that answers 404 (not
// visible to the account) or a redirect is skipped; any other status than 200, on the first
// request or on a measured one, fails, and so does a round-trip reading below 1 (the statistics
// did not see the app) or a --db missing from pg_stat_database. Exit code 1 on a failure,
// unless --no-fail. Evidence goes to $UC_TEST_ROOT/uc-evidence/perf/<label>-<time>.json,
// never to Git. A first request per route warms up the server and is not counted.
//
//   UC_TEST_ROOT=/private/tmp/<dir> node --no-warnings scripts/uc-test/perf-smoke.mjs
//   UC_TEST_ROOT=… node --no-warnings scripts/uc-test/perf-smoke.mjs --as ls-lead,owner-cliente --runs 10 --round-trips
//   UC_TEST_ROOT=… node --no-warnings scripts/uc-test/perf-smoke.mjs --path "/dashboard/{ws}/casi-duso/{case}" --label C13
//   UC_TEST_ROOT=… node --no-warnings scripts/uc-test/perf-smoke.mjs --routes <file.mjs>   # export default [{ path, as? }]
//
// Options: --as <a,b> (default ls-lead), --runs <n> (default 5), --path <p> (repeatable),
// --routes <file.mjs>, --case <uuid>, --label <name>, --round-trips, --db <name> (database of
// the app for --round-trips, default unbundle_uc_test), --app <origin>, --login <origin>
// (loopback only; for another harness, e.g. the hub on 53120/53122), --no-fail.
// Placeholders: {ws}, {case}. Without --path and --routes the routes are every page.tsx under
// casi-duso/ without dynamic segments other than the case, read from disk.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { UC_TEST_APP_PORT, UC_TEST_DB, UC_TEST_HOST, UC_TEST_LOGIN_PORT, UC_TEST_PORT, UC_TEST_USER, ucTestRoot } from "./config.mjs";

export const BUDGET = Object.freeze({ firstLoadTtfbP95Ms: 800, navigationTtfbP95Ms: 500, htmlBytes: 300 * 1024, rscBytes: 200 * 1024, roundTrips: 4 });
const STATS_FLUSH_MS = 11_500;

const args = process.argv.slice(2);
const opts = { as: ["ls-lead"], runs: 5, paths: [], routes: null, caseId: null, label: "adhoc", roundTrips: false, db: UC_TEST_DB, app: null, login: null, fail: true };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const value = () => {
    const v = args[++i];
    if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
    return v;
  };
  if (a === "--as") opts.as = value().split(",").map((s) => s.trim()).filter(Boolean);
  else if (a === "--runs") opts.runs = Number(value());
  else if (a === "--path") opts.paths.push(value());
  else if (a === "--routes") opts.routes = value();
  else if (a === "--case") opts.caseId = value();
  else if (a === "--label") opts.label = value();
  else if (a === "--round-trips") opts.roundTrips = true;
  else if (a === "--db") opts.db = value();
  else if (a === "--app") opts.app = value();
  else if (a === "--login") opts.login = value();
  else if (a === "--no-fail") opts.fail = false;
  else throw new Error(`Unknown option ${a}`);
}
if (!Number.isInteger(opts.runs) || opts.runs < 1 || opts.runs > 50) throw new Error("--runs: an integer from 1 to 50");
if (!/^[A-Za-z0-9._-]{1,40}$/.test(opts.label)) throw new Error("--label: letters, digits, dot, dash or underscore");
if (!/^[a-z0-9_]{1,63}$/.test(opts.db)) throw new Error("--db: a plain database name");

function loopbackOrigin(raw, fallback) {
  const url = new URL(raw ?? fallback);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error(`${raw}: only a loopback http origin`);
  return url.origin;
}
const app = loopbackOrigin(opts.app, `http://${UC_TEST_HOST}:${UC_TEST_APP_PORT}`);
const login = loopbackOrigin(opts.login, `http://${UC_TEST_HOST}:${UC_TEST_LOGIN_PORT}`);

const root = ucTestRoot();
const fixtures = JSON.parse(readFileSync(join(root, "uc-fixtures", "synthetic-fixtures.json"), "utf8"));
for (const name of opts.as) if (!fixtures.accounts[name]) throw new Error(`Unknown account ${name}: see the manifest of seed-fixtures.mjs`);
const caseId = opts.caseId ?? fixtures.exampleCase?.caseId;
if (!caseId) throw new Error("No case: run seed-fixtures.mjs (it creates the example case) or pass --case <uuid>");
const workspaceId = fixtures.workspaces[fixtures.exampleCase?.workspace ?? "a"].workspaceId;

/** Every page.tsx under casi-duso/ whose only dynamic segment is the case. */
function discoverRoutes() {
  const base = resolve("src/app/(dashboard)/dashboard/[workspaceId]/casi-duso");
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "page.tsx") {
        const segments = relative(base, dir).split(/[\\/]/).filter(Boolean).filter((s) => !/^\(.*\)$/.test(s));
        const mapped = segments.map((s) => (s === "[caseId]" ? "{case}" : s));
        if (mapped.some((s) => /^\[.*\]$/.test(s)) || mapped.includes("nuovo")) continue;
        out.push({ path: ["/dashboard/{ws}/casi-duso", ...mapped].join("/") });
      }
    }
  };
  walk(base);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

async function loadRoutes() {
  const list = opts.paths.map((path) => ({ path }));
  if (opts.routes) {
    const mod = await import(pathToFileURL(resolve(opts.routes)).href);
    const extra = mod.default ?? mod.routes;
    if (!Array.isArray(extra)) throw new Error("--routes: the module must export an array of { path }");
    list.push(...extra);
  }
  return list.length > 0 ? list : discoverRoutes();
}

const fill = (path) => path.replaceAll("{ws}", workspaceId).replaceAll("{case}", caseId);

/** Session cookie of a synthetic account, from the login helper (never printed). */
async function sessionCookie(account) {
  const res = await fetch(`${login}/as/${account}?to=${encodeURIComponent(`/dashboard/${workspaceId}/casi-duso`)}`, { redirect: "manual" });
  const cookie = res.headers.get("set-cookie");
  const m = cookie ? /(?:^|,\s*)(__session=[^;]+)/.exec(cookie) : null;
  if (res.status !== 302 || !m) throw new Error(`Login for ${account} failed (${res.status}): is browser-login.mjs running?`);
  return m[1];
}

/**
 * TTFB is the first byte of the body, not the headers: with streaming, Next sends the
 * headers at once and the page later. `total` is the whole response.
 */
async function timed(url, headers) {
  const started = performance.now();
  const res = await fetch(url, { headers, redirect: "manual", cache: "no-store" });
  let ttfb = null;
  let bytes = 0;
  if (res.body) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (ttfb === null && value.byteLength > 0) ttfb = performance.now() - started;
      bytes += value.byteLength;
    }
  }
  const total = performance.now() - started;
  return { status: res.status, ttfb: ttfb ?? total, bytes, total };
}

/**
 * The URL of an RSC request. Since Next 16.3 `next start` checks that `_rsc` matches the router
 * headers of an RSC request (experimental.validateRSCRequestHeaders, now on by default) and
 * otherwise answers 307 with an empty body, which `redirect: "manual"` would measure. With only
 * `RSC: 1` (no router headers) the expected value is empty: a bare `_rsc`. The pages are dynamic
 * and fetched with `no-store`, so there is no cache to bust.
 */
const rscUrlOf = (url) => `${url}${url.includes("?") ? "&" : "?"}_rsc`;

function p95(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)];
}

const requireFromApp = createRequire(resolve("package.json"));
let stats = null;
async function statsClient() {
  if (stats) return stats;
  const { Client } = requireFromApp("pg");
  stats = new Client({ host: UC_TEST_HOST, port: UC_TEST_PORT, user: UC_TEST_USER, database: opts.db });
  await stats.connect();
  return stats;
}
async function commits() {
  const c = await statsClient();
  const r = await c.query("SELECT xact_commit + xact_rollback AS n FROM pg_stat_database WHERE datname = $1", [opts.db]);
  // A wrong --db (or another cluster) would read 0 before and after and pass any budget.
  if (r.rows.length === 0) throw new Error(`--db ${opts.db}: no such database in pg_stat_database of ${UC_TEST_HOST}:${UC_TEST_PORT}`);
  return Number(r.rows[0].n);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Round-trips of one navigation: transactions of the app database, minus this reader's own.
 * null when the reading is not valid: a signed-in navigation reads the database at least once,
 * so fewer than 1 means the statistics did not see the app (wrong database, stats not flushed).
 */
async function roundTrips(url, headers) {
  await sleep(STATS_FLUSH_MS);
  const before = await commits();
  const res = await fetch(rscUrlOf(url), { headers, redirect: "manual", cache: "no-store" });
  await res.arrayBuffer();
  await sleep(STATS_FLUSH_MS);
  const after = await commits();
  const n = after - before - 1;
  return n >= 1 ? n : null;
}

const routes = await loadRoutes();
const results = [];
let failures = 0;
for (const account of opts.as) {
  const cookie = await sessionCookie(account);
  for (const route of routes) {
    if (route.as && !route.as.includes(account)) continue;
    const url = `${app}${fill(route.path)}`;
    const html = { cookie, accept: "text/html" };
    const rsc = { cookie, rsc: "1", accept: "text/x-component" };
    const warm = await timed(url, html);
    // Not for this account (404) or a redirect: nothing to measure. Any other error status fails.
    if (warm.status === 404 || (warm.status >= 300 && warm.status < 400)) {
      results.push({ account, path: route.path, status: warm.status, skipped: true });
      console.log(`SKIP  ${account}  ${route.path}  (${warm.status})`);
      continue;
    }
    if (warm.status !== 200) {
      failures++;
      results.push({ account, path: route.path, status: warm.status, over: [`stato ${warm.status}`] });
      console.log(`FAIL  ${account}  ${route.path}  (stato ${warm.status})`);
      continue;
    }
    await timed(rscUrlOf(url), rsc);
    const first = [];
    const nav = [];
    for (let i = 0; i < opts.runs; i++) {
      first.push(await timed(url, html));
      nav.push(await timed(rscUrlOf(url), rsc));
    }
    const row = {
      account,
      path: route.path,
      status: first[0].status,
      firstLoadTtfbP95Ms: Math.round(p95(first.map((r) => r.ttfb))),
      navigationTtfbP95Ms: Math.round(p95(nav.map((r) => r.ttfb))),
      firstLoadTotalP95Ms: Math.round(p95(first.map((r) => r.total))),
      navigationTotalP95Ms: Math.round(p95(nav.map((r) => r.total))),
      htmlBytes: Math.max(...first.map((r) => r.bytes)),
      rscBytes: Math.max(...nav.map((r) => r.bytes)),
      roundTrips: opts.roundTrips ? await roundTrips(url, rsc) : null,
    };
    const over = [];
    const statuses = [...new Set([...first, ...nav].map((r) => r.status))].filter((status) => status !== 200);
    if (statuses.length > 0) over.push(`stato ${statuses.join("/")}`);
    if (opts.roundTrips && row.roundTrips === null) over.push("round-trip non misurati");
    if (row.firstLoadTtfbP95Ms >= BUDGET.firstLoadTtfbP95Ms) over.push("ttfb primo caricamento");
    if (row.navigationTtfbP95Ms >= BUDGET.navigationTtfbP95Ms) over.push("ttfb navigazione");
    if (row.htmlBytes >= BUDGET.htmlBytes) over.push("html");
    if (row.rscBytes >= BUDGET.rscBytes) over.push("rsc");
    if (row.roundTrips !== null && row.roundTrips > BUDGET.roundTrips) over.push("round-trip");
    row.over = over;
    if (over.length > 0) failures++;
    results.push(row);
    console.log(
      `${over.length ? "FAIL" : "PASS"}  ${account}  ${route.path}  first ${row.firstLoadTtfbP95Ms} ms (all ${row.firstLoadTotalP95Ms})  nav ${row.navigationTtfbP95Ms} ms (all ${row.navigationTotalP95Ms})  html ${Math.round(row.htmlBytes / 1024)} KB  rsc ${Math.round(row.rscBytes / 1024)} KB${row.roundTrips === null ? "" : `  db ${row.roundTrips}`}${over.length ? `  (oltre: ${over.join(", ")})` : ""}`,
    );
  }
}
if (stats) await stats.end();

const dir = join(root, "uc-evidence", "perf");
mkdirSync(dir, { recursive: true });
const file = join(dir, `${opts.label}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(file, `${JSON.stringify({ app, runs: opts.runs, budget: BUDGET, results }, null, 2)}\n`);
console.log(`\n${results.filter((r) => !r.skipped).length} measured, ${failures} over budget. Evidence: ${file}`);
process.exit(failures > 0 && opts.fail ? 1 : 0);
