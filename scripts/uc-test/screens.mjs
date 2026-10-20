// Screenshots and automatic page checks for Casi d'uso on the local harness
// (DESIGN §8.1 c and d). App on 127.0.0.1:53110, login helper on 53112, fixtures from
// seed-fixtures.mjs (synthetic accounts and the example case). Evidence goes to
// $UC_TEST_ROOT/uc-evidence/screens/<label>/, never to Git.
//
//   # every page of the case for ls-lead and owner-cliente, 1440 and 400 px: no regression
//   UC_TEST_ROOT=/private/tmp/<dir> node --no-warnings scripts/uc-test/screens.mjs --smoke --label C1
//
//   # the pages of a package, strict checks
//   UC_TEST_ROOT=… node --no-warnings scripts/uc-test/screens.mjs --label C2 \
//     --path "/dashboard/{ws}/casi-duso/{case}" --path "/dashboard/{ws}/casi-duso/{case}/via" \
//     --as ls-lead,ls-analista,owner-cliente,osservatore --widths 1440,400
//
//   # routes from a module: export default [{ name?, path, as?: [account…] }]
//   UC_TEST_ROOT=… node --no-warnings scripts/uc-test/screens.mjs --routes <file.mjs> --label C3
//
// Options: --smoke, --path <p> (repeatable), --routes <file.mjs>, --as <a,b>, --widths <w,h>,
// --case <uuid> (default: the example case of the manifest), --label <name> (default «adhoc»),
// --theme dark|light, --warn-only. Placeholders in paths: {ws}, {case}, {item} (first question
// of the case). With --smoke the routes are every page.tsx under casi-duso/, read from disk,
// so the list follows the routes of each package without editing this script.
//
// Checks on every page: status below 500, no «Application error», no uncaught exception,
// no horizontal scroll (scrollWidth ≤ innerWidth). Strict checks (failures without
// --smoke, warnings with it): at most one filled button outside dialogs, no copy-guard
// match for client accounts, and on dossier pages (under /casi-duso/<case>) at 1440 px or
// more the header plus tabs ≤ 260 px. The dossier layout marks that block with
// [data-uc-case-head] (C1 puts it on the element that wraps header and tabs); a dossier page
// without the marker is «header marker missing», not a pass. A 404 for a role is reported,
// not failed: some pages are not for every role, so the strict checks skip it. Exit code 1
// on any failure.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { UC_TEST_APP_PORT, UC_TEST_DB, UC_TEST_HOST, UC_TEST_PORT, UC_TEST_USER, ucTestRoot } from "./config.mjs";
import { closePage, launchBrowser, loginAs, navigate, newPage, pageReport, screenshot, setViewport } from "./cdp.mjs";

const HEAD_MAX = 260;
const args = process.argv.slice(2);
const opts = { smoke: false, warnOnly: false, paths: [], routes: null, as: null, widths: null, caseId: null, label: "adhoc", theme: "dark" };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const value = () => {
    const v = args[++i];
    if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
    return v;
  };
  if (a === "--smoke") opts.smoke = true;
  else if (a === "--warn-only") opts.warnOnly = true;
  else if (a === "--path") opts.paths.push(value());
  else if (a === "--routes") opts.routes = value();
  else if (a === "--as") opts.as = value().split(",").map((s) => s.trim()).filter(Boolean);
  else if (a === "--widths") opts.widths = value().split(",").map((s) => Number(s.trim()));
  else if (a === "--case") opts.caseId = value();
  else if (a === "--label") opts.label = value();
  else if (a === "--theme") opts.theme = value();
  else throw new Error(`Unknown option ${a}`);
}
if (!/^[A-Za-z0-9._-]{1,40}$/.test(opts.label)) throw new Error("--label: letters, digits, dot, dash or underscore");
if (!["dark", "light"].includes(opts.theme)) throw new Error("--theme is dark or light");
if (!opts.smoke && !opts.routes && opts.paths.length === 0) throw new Error("Nothing to open: use --smoke, --path or --routes");
const widths = opts.widths ?? [1440, 400];
if (widths.some((w) => !Number.isInteger(w) || w < 320 || w > 3840)) throw new Error("--widths: integers between 320 and 3840");

const root = ucTestRoot();
const fixtures = JSON.parse(readFileSync(join(root, "uc-fixtures", "synthetic-fixtures.json"), "utf8"));
const app = `http://${UC_TEST_HOST}:${UC_TEST_APP_PORT}`;
const accounts = opts.as ?? ["ls-lead", "owner-cliente"];
for (const name of accounts) if (!fixtures.accounts[name]) throw new Error(`Unknown account ${name}: see the manifest of seed-fixtures.mjs`);
const caseId = opts.caseId ?? fixtures.exampleCase?.caseId;
if (!caseId) throw new Error("No case: run seed-fixtures.mjs (it creates the example case) or pass --case <uuid>");
const workspaceLetter = fixtures.exampleCase?.workspace ?? "a";
const workspaceId = fixtures.workspaces[workspaceLetter].workspaceId;

// The copy guard is a pure module of the app: same rules as the unit tests.
const { findForbidden } = await import(new URL("../../src/lib/uc/views/copy-guard.ts", import.meta.url).href);

/** Every page.tsx under casi-duso/, as paths with placeholders; dynamic segments other than {item} are skipped. */
function discoverRoutes() {
  const base = resolve("src/app/(dashboard)/dashboard/[workspaceId]/casi-duso");
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "page.tsx") {
        const segments = relative(base, dir).split(/[\\/]/).filter(Boolean).filter((s) => !/^\(.*\)$/.test(s));
        const mapped = segments.map((s) => (s === "[caseId]" ? "{case}" : s === "[itemId]" ? "{item}" : s));
        if (mapped.some((s) => /^\[.*\]$/.test(s))) continue;
        out.push({ path: ["/dashboard/{ws}/casi-duso", ...mapped].join("/") });
      }
    }
  };
  walk(base);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

async function loadRoutes() {
  if (opts.smoke) return discoverRoutes();
  const list = opts.paths.map((path) => ({ path }));
  if (opts.routes) {
    const mod = await import(pathToFileURL(resolve(opts.routes)).href);
    const extra = mod.default ?? mod.routes;
    if (!Array.isArray(extra)) throw new Error("--routes: the module must export an array of { path }");
    list.push(...extra);
  }
  return list;
}

async function firstQuestionId() {
  const requireFromApp = createRequire(resolve("package.json"));
  const { Client } = requireFromApp("pg");
  const db = new Client({ host: UC_TEST_HOST, port: UC_TEST_PORT, user: UC_TEST_USER, database: UC_TEST_DB });
  await db.connect();
  try {
    const r = await db.query("SELECT id FROM uc_items WHERE case_id = $1::uuid AND kind = 'domanda' ORDER BY key LIMIT 1", [caseId]);
    return r.rows[0]?.id ?? null;
  } finally {
    await db.end();
  }
}

const routes = await loadRoutes();
const itemId = routes.some((r) => r.path.includes("{item}")) ? await firstQuestionId() : null;
const fill = (path) => path.replaceAll("{ws}", workspaceId).replaceAll("{case}", caseId).replaceAll("{item}", itemId ?? "");
const nameOf = (route) =>
  route.name ??
  (route.path
    .replace("/dashboard/{ws}/casi-duso", "casi-duso")
    .replace(/[{}]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "root");

/** A page of the dossier (under /casi-duso/<case>), where the header and its tabs live. */
const isDossierPath = (pathname) => pathname.startsWith(`/dashboard/${workspaceId}/casi-duso/${caseId}`);

const outDir = join(root, "uc-evidence", "screens", opts.label);
mkdirSync(outDir, { recursive: true });
const strictIsFailure = !opts.smoke && !opts.warnOnly;
const results = [];
const browser = await launchBrowser({ colorScheme: opts.theme });
try {
  for (const account of accounts) {
    const audience = fixtures.accounts[account].email.endsWith(`@${fixtures.lsDomain}`) ? "ls" : "cliente";
    for (const width of widths) {
      const page = await newPage(browser, { width, colorScheme: opts.theme });
      try {
        await loginAs(page, account, { to: `/dashboard/${workspaceId}` });
        for (const route of routes) {
          if (route.as && !route.as.includes(account)) continue;
          if (route.path.includes("{item}") && !itemId) continue;
          await setViewport(page, { width, colorScheme: opts.theme });
          const url = `${app}${fill(route.path)}`;
          const name = nameOf(route);
          const started = Date.now();
          const nav = await navigate(page, url);
          const report = await pageReport(page);
          const file = await screenshot(page, join(outDir, account, String(width), `${name}.png`));
          const failures = [];
          const warnings = [];
          const strict = (msg) => (strictIsFailure ? failures : warnings).push(msg);
          if (nav.status !== null && nav.status >= 500) failures.push(`status ${nav.status}`);
          if (report.applicationError) failures.push("Application error");
          for (const e of page.errors.filter((e) => e.kind === "exception")) failures.push(`exception: ${e.text.split("\n")[0]}`);
          if (report.horizontalOverflow) failures.push(`horizontal scroll (${report.scrollWidth} > ${report.innerWidth})`);
          if (!nav.idle) warnings.push("network not quiet within the timeout");
          // A page that is not for this role: its own 404 text is not the package's copy.
          const notForRole = nav.status === 404 || report.notFound;
          const finalPath = new URL(nav.url).pathname;
          if (!notForRole) {
            if (report.filledButtons > 1) strict(`${report.filledButtons} filled buttons: ${report.filledButtonLabels.join(" | ")}`);
            if (audience === "cliente") {
              const found = findForbidden(report.text, "cliente");
              if (found.length) strict(`copy-guard: ${[...new Set(found.map((m) => `${m.reason} «${m.match}»`))].slice(0, 8).join(", ")}${found.length > 8 ? " …" : ""}`);
            }
            if (width >= 1440 && isDossierPath(finalPath)) {
              if (report.headHeight === null) strict("header marker missing: no [data-uc-case-head] around the dossier header and tabs");
              else if (report.headHeight > HEAD_MAX) strict(`header and tabs ${report.headHeight} px > ${HEAD_MAX}`);
            }
          }
          for (const e of page.errors.filter((e) => e.kind === "console")) warnings.push(`console: ${e.text.split("\n")[0].slice(0, 160)}`);
          results.push({
            account,
            audience,
            width,
            route: route.path,
            name,
            status: nav.status,
            finalPath,
            h1: report.h1,
            notForRole,
            filledButtons: report.filledButtons,
            headHeight: report.headHeight,
            ms: Date.now() - started,
            failures,
            warnings,
            file,
          });
          const mark = failures.length ? "FAIL" : notForRole ? "404 " : warnings.length ? "WARN" : "ok  ";
          console.log(`${mark} ${account.padEnd(20)} ${String(width).padEnd(5)} ${name.padEnd(28)} ${String(nav.status).padEnd(4)} ${[...failures, ...warnings].join("; ").slice(0, 200)}`);
        }
      } finally {
        await closePage(page);
      }
    }
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => r.failures.length);
const summary = {
  label: opts.label,
  mode: opts.smoke ? "smoke" : "strict",
  pages: results.length,
  failed: failed.length,
  warned: results.filter((r) => !r.failures.length && r.warnings.length).length,
  notForRole: results.filter((r) => r.notForRole).length,
};
writeFileSync(join(outDir, "report.json"), JSON.stringify({ summary, caseId, workspaceId, widths, accounts, results }, null, 2));
console.log(`\n${summary.pages} pages · ${summary.failed} failed · ${summary.warned} with warnings · ${summary.notForRole} not for the role. Report: ${join(outDir, "report.json")}`);
process.exit(failed.length ? 1 : 0);
