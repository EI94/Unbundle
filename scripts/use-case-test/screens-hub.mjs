// Screenshots and automatic page checks of the use case hub on its local harness
// (docs/use-case/PIANO-LAVORI.md §5.1, §5.4, §5.7; package H2d). It uses
// scripts/uc-test/cdp.mjs (Casi d'uso C0) as a library, without editing it, and signs in
// through scripts/uc-test/browser-login.mjs. Evidence goes to
// $UC_TEST_ROOT/hub-evidence/<label>/<account>/<width>/<ws>-<page>.png (<ws> is «a» or «b», so
// the same page in both workspaces keeps two files), never to Git.
//
// The hub's ports (PIANO-LAVORI §2.7): app 53120, Auth emulator 59119, login helper 53122,
// cluster 55479. Fixtures from scripts/uc-test/seed-fixtures.mjs and
// scripts/use-case-test/seed-hub.mjs (sponsor-cliente, the synthetic use cases).
//
//   export UC_TEST_ROOT=/private/tmp/<dir>/hub
//   export UC_TEST_PG_PORT=55479 UC_TEST_PG_DB=hub_<id>
//   export UC_TEST_APP_PORT=53120 UC_TEST_AUTH_PORT=59119 UC_TEST_LOGIN_PORT=53122
//
//   # the pages of a package (§5.1)
//   node scripts/use-case-test/screens-hub.mjs --routes scripts/use-case-test/screens/hub.routes.mjs \
//     --as ls-lead,function-lead,osservatore,sponsor-cliente --widths 1440,400 --label h4a
//
//   # wave H2 gate, D4 on today's pages of workspace «b» (area off), contributor and non-member
//   node scripts/use-case-test/screens-hub.mjs --label h2 --workspace b --as ls-lead,osservatore,anonimo \
//     --path "/dashboard/{ws}/portfolio" --path "/dashboard/{ws}/use-cases" --path "/dashboard/{ws}/plan" \
//     --path "/dashboard/{ws}/intelligence" --path "/share/portfolio/{ws}/{uc}"
//
//   # forward merges from H4: every page under use-cases/ for ls-lead and osservatore
//   node scripts/use-case-test/screens-hub.mjs --smoke --label merge-s4
//
//   # only print what would be opened (no browser, no app)
//   node scripts/use-case-test/screens-hub.mjs --routes <file.mjs> --dry-run
//
// Options: --routes <file.mjs> (repeatable), --path <p> (repeatable), --smoke, --as <a,b>,
// --widths <w,h> (default 1440,400), --workspace a|b (default «a»), --copy-guard area|vecchio_nome|off
// (for routes that do not say; without it the scope comes from the path, see below), --label <name>
// (default «adhoc»), --theme dark|light, --warn-only, --dry-run.
//
// Route modules: `export default [{ name?, path, as?, workspace?, copyGuard?, absent?, present? }]`.
// - `as`: only these accounts open the route; `workspace`: «a» or «b», the workspace of {ws}
//   and of the role checks (default: the {ws:x} in the path, then --workspace);
// - `copyGuard`: «area» for the pages of the area (src/lib/use-cases/copy-guard.ts), «vecchio_nome»
//   for the pages outside it that once named it, false for none. Without it (and without
//   --copy-guard) the path decides: «area» for /dashboard/{ws}/use-cases… in workspace «a», where
//   the area is on (§5.1; in «b» those are today's pages), «vecchio_nome» for /share/portfolio/…,
//   none otherwise. So --smoke checks every area page;
// - `absent` / `present`: texts that must not / must be in the page (placeholders allowed), e.g.
//   `absent: ["{code:r01}"]` on the share link opened without a session (D14).
// Placeholders: {ws} (the route's workspace), {ws:a}, {ws:b}, {uc} (the first use case seeded in
// the route's workspace), {uc:<key>} and {code:<key>} (a use case of seed-hub.mjs by its key,
// e.g. r01 or osservatore-email), {case} (the example dossier of seed-fixtures.mjs).
// Accounts: those of the manifest, plus `anonimo`, who opens the pages without a session.
//
// Checks on every page (failures, also with --smoke): status below 500, no «Application error»,
// no uncaught exception, no horizontal scroll (scrollWidth ≤ innerWidth); for contributors and
// non-members of the route's workspace (art. 15.4, D4, D14): no [data-figure] element and no «€»
// in the visible text; `absent` and `present`. Strict checks (failures, warnings with --smoke or
// --warn-only): at most one filled button outside dialogs; every cost shown
// ([data-figure="costo"]) has its source ([data-source]) unless it is «da stimare» or a short
// «Benefici e costi» cost (data-cost-source="stima"); for
// contributors and non-members no «€» in the page's payload (inline RSC data included); the hub
// copy guard of the page's scope, and on area pages for client accounts (not of the Lateral Space
// domain, and «anonimo») also the dossier copy guard of docs/casi-duso/DESIGN.md §6.2
// (src/lib/uc/views/copy-guard.ts), which DESIGN §14.5 extends with the hub words. A 404 for a role
// is reported, not failed: the strict checks skip it, the D4 checks do not. Two pages with the same
// name in the same workspace for one account stop the run (set `name`). Exit code 1 on any failure.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { UC_TEST_APP_PORT, UC_TEST_HOST, UC_TEST_LOGIN_PORT, UC_TEST_LS_DOMAIN, ucTestRoot } from "../uc-test/config.mjs";
import { clearCookies, closePage, evaluate, launchBrowser, loginAs, navigate, newPage, pageReport, screenshot, setViewport } from "../uc-test/cdp.mjs";

const ANONYMOUS = "anonimo";
const REVIEWER_ROLES = new Set(["exec_sponsor", "transformation_lead", "function_lead", "analyst"]);
const COPY_SCOPES = ["area", "vecchio_nome"];
/** The fixture workspaces with the area on (PIANO-LAVORI §5.1: «a» on, «b» off). */
const AREA_ON_WORKSPACES = new Set(["a"]);

// ─── Options ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const opts = {
  smoke: false,
  warnOnly: false,
  dryRun: false,
  paths: [],
  routes: [],
  as: null,
  widths: null,
  workspace: "a",
  copyGuard: null,
  label: "adhoc",
  theme: "dark",
};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const value = () => {
    const v = args[++i];
    if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
    return v;
  };
  if (a === "--smoke") opts.smoke = true;
  else if (a === "--warn-only") opts.warnOnly = true;
  else if (a === "--dry-run") opts.dryRun = true;
  else if (a === "--path") opts.paths.push(value());
  else if (a === "--routes") opts.routes.push(value());
  else if (a === "--as") opts.as = value().split(",").map((s) => s.trim()).filter(Boolean);
  else if (a === "--widths") opts.widths = value().split(",").map((s) => Number(s.trim()));
  else if (a === "--workspace") opts.workspace = value();
  else if (a === "--copy-guard") opts.copyGuard = value();
  else if (a === "--label") opts.label = value();
  else if (a === "--theme") opts.theme = value();
  else throw new Error(`Unknown option ${a}`);
}
if (!/^[A-Za-z0-9._-]{1,40}$/.test(opts.label)) throw new Error("--label: letters, digits, dot, dash or underscore");
if (!["dark", "light"].includes(opts.theme)) throw new Error("--theme is dark or light");
if (!["a", "b"].includes(opts.workspace)) throw new Error("--workspace is a or b");
if (opts.copyGuard !== null && ![...COPY_SCOPES, "off"].includes(opts.copyGuard)) throw new Error("--copy-guard is area, vecchio_nome or off");
if (!opts.smoke && !opts.routes.length && !opts.paths.length) throw new Error("Nothing to open: use --smoke, --path or --routes");
const widths = opts.widths ?? [1440, 400];
if (widths.some((w) => !Number.isInteger(w) || w < 320 || w > 3840)) throw new Error("--widths: integers between 320 and 3840");

// The hub has its own app and login helper (§2.7): never the Casi d'uso, Learning or connector ones.
if ([53100, 53110, 53130].includes(UC_TEST_APP_PORT) || [53102, 53112].includes(UC_TEST_LOGIN_PORT)) {
  throw new Error(`App ${UC_TEST_APP_PORT} / login ${UC_TEST_LOGIN_PORT} are not the hub's: set UC_TEST_APP_PORT=53120 UC_TEST_LOGIN_PORT=53122 (and UC_TEST_AUTH_PORT=59119)`);
}

// ─── Fixtures ────────────────────────────────────────────────────────

const root = ucTestRoot();
const manifestPath = join(root, "uc-fixtures", "synthetic-fixtures.json");
if (!existsSync(manifestPath)) throw new Error(`No fixtures manifest at ${manifestPath}: run scripts/uc-test/seed-fixtures.mjs and scripts/use-case-test/seed-hub.mjs first`);
const fixtures = JSON.parse(readFileSync(manifestPath, "utf8"));
const app = `http://${UC_TEST_HOST}:${UC_TEST_APP_PORT}`;
const accounts = opts.as ?? (opts.smoke ? ["ls-lead", "osservatore"] : ["ls-lead", "function-lead", "osservatore", "sponsor-cliente"]);
for (const name of accounts) {
  if (name !== ANONYMOUS && !fixtures.accounts?.[name]) {
    throw new Error(`Unknown account ${name}: see the manifest (sponsor-cliente comes from seed-hub.mjs), or use «${ANONYMOUS}»`);
  }
}
const workspaceIdOf = (letter) => {
  const id = fixtures.workspaces?.[letter]?.workspaceId;
  if (!id) throw new Error(`The manifest has no workspace «${letter}»`);
  return id;
};

/** The account's role in workspace `letter`: its own workspace from seed-fixtures, the others from seed-hub. */
function roleIn(account, letter) {
  if (account === ANONYMOUS) return null;
  const data = fixtures.accounts[account];
  if (data.workspace === letter) return data.workspaceRole ?? null;
  return fixtures.hub?.memberships?.[letter]?.[account] ?? null;
}

/** Reviewer, contributor, or non-member (no session, no membership, or `learner`) of the route's workspace. */
function audienceOf(account, letter) {
  const role = roleIn(account, letter);
  if (!role || role === "learner") return "non_membro";
  return REVIEWER_ROLES.has(role) ? "revisore" : "contributore";
}

/** A client of Lateral Space (the dossier copy guard's «cliente»): no session, or an email outside its domain. */
const lsDomain = String(fixtures.lsDomain ?? UC_TEST_LS_DOMAIN).toLowerCase();
function isClient(account) {
  if (account === ANONYMOUS) return true;
  const email = String(fixtures.accounts[account]?.email ?? "").toLowerCase();
  return !email.endsWith(`@${lsDomain}`);
}

function seededUseCase(key, letter) {
  const lists = fixtures.hub?.useCases;
  if (!lists) throw new Error(`{uc:${key}} needs the hub seed: run scripts/use-case-test/seed-hub.mjs`);
  const found = (lists[letter] ?? []).find((item) => item.key === key) ?? Object.values(lists).flat().find((item) => item.key === key);
  if (!found) throw new Error(`No use case with key «${key}» in the hub seed`);
  return found;
}

/** Fills the placeholders of a path or a text for a route of workspace `letter`. */
function fill(text, letter) {
  return text.replace(/\{([a-z]+)(?::([A-Za-z0-9_-]+))?\}/g, (_, name, arg) => {
    if (name === "ws") return workspaceIdOf(arg ?? letter);
    if (name === "uc" && !arg) {
      const first = fixtures.hub?.useCases?.[letter]?.[0];
      if (!first) throw new Error(`{uc} needs a use case seeded in workspace «${letter}» (seed-hub.mjs)`);
      return first.id;
    }
    if (name === "uc") return seededUseCase(arg, letter).id;
    if (name === "code") {
      if (!arg) throw new Error("{code} needs a key, e.g. {code:r01}");
      const code = seededUseCase(arg, letter).code;
      if (!code) throw new Error(`The use case «${arg}» has no code`);
      return code;
    }
    if (name === "case" && !arg) {
      const caseId = fixtures.exampleCase?.caseId;
      if (!caseId) throw new Error("{case} needs the example dossier of seed-fixtures.mjs");
      return caseId;
    }
    throw new Error(`Unknown placeholder {${name}${arg ? `:${arg}` : ""}}`);
  });
}

// ─── Routes ──────────────────────────────────────────────────────────

/** Every page.tsx under use-cases/ as a path with placeholders; dynamic segments other than [useCaseId] are skipped. */
function discoverRoutes() {
  const base = resolve("src/app/(dashboard)/dashboard/[workspaceId]/use-cases");
  if (!existsSync(base)) return [];
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "page.tsx") {
        const segments = relative(base, dir).split(/[\\/]/).filter(Boolean).filter((s) => !/^\(.*\)$/.test(s));
        const mapped = segments.map((s) => (s === "[useCaseId]" ? "{uc}" : s));
        if (mapped.some((s) => /^\[.*\]$/.test(s))) continue;
        out.push({ path: ["/dashboard/{ws}/use-cases", ...mapped].join("/") });
      }
    }
  };
  walk(base);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

async function loadRoutes() {
  const list = opts.smoke ? discoverRoutes() : [];
  list.push(...opts.paths.map((path) => ({ path })));
  for (const file of opts.routes) {
    const mod = await import(pathToFileURL(resolve(file)).href);
    const extra = mod.default ?? mod.routes;
    if (!Array.isArray(extra)) throw new Error(`--routes ${file}: the module must export an array of { path }`);
    list.push(...extra);
  }
  for (const route of list) {
    if (typeof route?.path !== "string" || !route.path.startsWith("/")) throw new Error(`Route without a path starting with «/»: ${JSON.stringify(route)}`);
    if (route.workspace !== undefined && !["a", "b"].includes(route.workspace)) throw new Error(`${route.path}: workspace is a or b`);
    if (route.copyGuard !== undefined && route.copyGuard !== false && !COPY_SCOPES.includes(route.copyGuard)) {
      throw new Error(`${route.path}: copyGuard is "area", "vecchio_nome" or false`);
    }
    for (const key of ["absent", "present"]) {
      if (route[key] !== undefined && (!Array.isArray(route[key]) || route[key].some((t) => typeof t !== "string" || !t))) {
        throw new Error(`${route.path}: ${key} is a list of texts`);
      }
    }
  }
  return list;
}

const routeWorkspace = (route) => route.workspace ?? /\{ws:([ab])\}/.exec(route.path)?.[1] ?? opts.workspace;
/** The copy guard of a page: the route's `copyGuard`, then --copy-guard, then the path (see the header). */
const copyScopeOf = (route, letter) => {
  if (route.copyGuard !== undefined) return route.copyGuard || null;
  if (opts.copyGuard) return opts.copyGuard === "off" ? null : opts.copyGuard;
  if (/^\/dashboard\/\{ws(?::[ab])?\}\/use-cases(?:[/?#]|$)/.test(route.path)) return AREA_ON_WORKSPACES.has(letter) ? "area" : null;
  if (route.path.startsWith("/share/portfolio/")) return "vecchio_nome";
  return null;
};
const nameOf = (route) =>
  route.name ??
  (route.path
    .replace(/^\/dashboard\/\{ws(?::[ab])?\}\/?/, "")
    .replace(/[{}]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "overview");

// ─── Page checks ─────────────────────────────────────────────────────

/** The hub's own measures, in the page: figures, costs without a source, «€» anywhere in the document. */
function hubMeasures(page) {
  return evaluate(page, () => {
    const costs = [...document.querySelectorAll('[data-figure="costo"]')];
    // «Benefici e costi» («avvio 560 € · ricorrenti 600 €/anno», data-cost-source="stima") has no
    // source in the short form, as the spec writes it: the detail page says «stima del team».
    const withoutSource = costs.filter(
      (el) =>
        el.getAttribute("data-estimated") !== "true" &&
        el.getAttribute("data-cost-source") !== "stima" &&
        !(el.querySelector("[data-source]")?.textContent ?? "").trim(),
    );
    const html = document.documentElement.outerHTML;
    return {
      figures: document.querySelectorAll("[data-figure]").length,
      costs: costs.length,
      costsWithoutSource: withoutSource.length,
      costWithoutSourceText: withoutSource.slice(0, 3).map((el) => el.textContent.trim().slice(0, 60)),
      euroInDocument: html.includes("€") || /\\u20ac|&euro;/i.test(html),
    };
  });
}

// ─── Run ─────────────────────────────────────────────────────────────

const routes = await loadRoutes();
if (!routes.length) throw new Error("No route to open (with --smoke: no page.tsx under use-cases/)");

/** Every (account, route) pair to open, with the URL and the audience already resolved. */
const plan = [];
const evidenceNames = new Map();
for (const account of accounts) {
  for (const route of routes) {
    if (route.as && !route.as.includes(account)) continue;
    const letter = routeWorkspace(route);
    const name = nameOf(route);
    // One screenshot per (account, workspace, name): a second page with the same name would overwrite it.
    const key = `${account}\u0000${letter}\u0000${name}`;
    if (evidenceNames.has(key)) {
      throw new Error(`${route.path} and ${evidenceNames.get(key)} are both «${name}» in workspace «${letter}» for ${account}: set \`name\` on one of the routes`);
    }
    evidenceNames.set(key, route.path);
    const copyScope = copyScopeOf(route, letter);
    plan.push({
      account,
      route,
      letter,
      name,
      audience: audienceOf(account, letter),
      url: `${app}${fill(route.path, letter)}`,
      absent: (route.absent ?? []).map((text) => fill(text, letter)),
      present: (route.present ?? []).map((text) => fill(text, letter)),
      copyScope,
      // Dossier copy guard (casi-duso §6.2) for clients on the area's pages, where the dossier pieces are mounted.
      dossierGuard: copyScope === "area" && isClient(account),
    });
  }
}

if (opts.dryRun) {
  for (const item of plan) {
    const guard = item.copyScope ? `  [copy-guard ${item.copyScope}${item.dossierGuard ? " + dossier §6.2" : ""}]` : "";
    console.log(`${item.account.padEnd(18)} ${item.audience.padEnd(12)} ${item.letter}  ${item.name.padEnd(28)} ${item.url}${guard}`);
  }
  console.log(`\n${plan.length} pages × ${widths.length} widths (${widths.join(", ")}). Nothing opened (--dry-run).`);
  process.exit(0);
}

// The copy guards are pure modules of the app: the same rules as their unit tests.
const { findHubForbidden } = await import(new URL("../../src/lib/use-cases/copy-guard.ts", import.meta.url).href);
const { findForbidden } = await import(new URL("../../src/lib/uc/views/copy-guard.ts", import.meta.url).href);

const outDir = join(root, "hub-evidence", opts.label);
mkdirSync(outDir, { recursive: true });
const strictIsFailure = !opts.smoke && !opts.warnOnly;
const results = [];
const browser = await launchBrowser({ colorScheme: opts.theme });
try {
  for (const account of accounts) {
    const items = plan.filter((item) => item.account === account);
    if (!items.length) continue;
    for (const width of widths) {
      const page = await newPage(browser, { width, colorScheme: opts.theme });
      try {
        if (account === ANONYMOUS) await clearCookies(page);
        else await loginAs(page, account, { to: `/dashboard/${workspaceIdOf(fixtures.accounts[account].workspace)}` });
        for (const item of items) {
          await setViewport(page, { width, colorScheme: opts.theme });
          const started = Date.now();
          const nav = await navigate(page, item.url);
          const report = await pageReport(page);
          const hub = await hubMeasures(page);
          const file = await screenshot(page, join(outDir, account, String(width), `${item.letter}-${item.name}.png`));
          const failures = [];
          const warnings = [];
          const strict = (msg) => (strictIsFailure ? failures : warnings).push(msg);
          if (nav.status !== null && nav.status >= 500) failures.push(`status ${nav.status}`);
          if (report.applicationError) failures.push("Application error");
          for (const e of page.errors.filter((e) => e.kind === "exception")) failures.push(`exception: ${e.text.split("\n")[0]}`);
          if (report.horizontalOverflow) failures.push(`horizontal scroll (${report.scrollWidth} > ${report.innerWidth})`);
          if (!nav.idle) warnings.push("network not quiet within the timeout");
          // Art. 15.4 and D4: contributors and non-members never get a figure or a euro amount.
          const restricted = item.audience !== "revisore";
          if (restricted) {
            if (hub.figures > 0) failures.push(`${hub.figures} [data-figure] for a ${item.audience}`);
            if (report.text.includes("€")) failures.push(`«€» in the page of a ${item.audience}`);
            else if (hub.euroInDocument) strict(`«€» in the page payload of a ${item.audience}`);
          }
          for (const text of item.absent) if (report.text.includes(text)) failures.push(`«${text}» must not be in the page`);
          // A page that is not for this role: its own 404 text is not the page under test.
          const notForRole = nav.status === 404 || report.notFound;
          if (!notForRole) {
            for (const text of item.present) if (!report.text.includes(text)) failures.push(`«${text}» missing from the page`);
            if (report.filledButtons > 1) strict(`${report.filledButtons} filled buttons: ${report.filledButtonLabels.join(" | ")}`);
            if (hub.costsWithoutSource > 0) strict(`${hub.costsWithoutSource} costs without their source: ${hub.costWithoutSourceText.join(" | ")}`);
            if (item.copyScope) {
              const found = findHubForbidden(report.text, item.copyScope);
              if (found.length) strict(`copy-guard ${item.copyScope}: ${[...new Set(found.map((m) => `«${m.match}»`))].slice(0, 8).join(", ")}${found.length > 8 ? " …" : ""}`);
            }
            if (item.dossierGuard) {
              const found = findForbidden(report.text, "cliente");
              if (found.length) strict(`copy-guard dossier: ${[...new Set(found.map((m) => `${m.reason} «${m.match}»`))].slice(0, 8).join(", ")}${found.length > 8 ? " …" : ""}`);
            }
          }
          for (const e of page.errors.filter((e) => e.kind === "console")) warnings.push(`console: ${e.text.split("\n")[0].slice(0, 160)}`);
          results.push({
            account,
            audience: item.audience,
            workspace: item.letter,
            width,
            route: item.route.path,
            name: item.name,
            copyGuard: item.copyScope ? [item.copyScope, ...(item.dossierGuard ? ["dossier"] : [])] : [],
            status: nav.status,
            finalPath: new URL(nav.url).pathname,
            h1: report.h1,
            notForRole,
            filledButtons: report.filledButtons,
            figures: hub.figures,
            costs: hub.costs,
            ms: Date.now() - started,
            failures,
            warnings,
            file,
          });
          const mark = failures.length ? "FAIL" : notForRole ? "404 " : warnings.length ? "WARN" : "ok  ";
          console.log(`${mark} ${account.padEnd(18)} ${String(width).padEnd(5)} ${item.name.padEnd(28)} ${String(nav.status).padEnd(4)} ${[...failures, ...warnings].join("; ").slice(0, 220)}`);
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
  mode: opts.smoke ? "smoke" : opts.warnOnly ? "warn-only" : "strict",
  pages: results.length,
  failed: failed.length,
  warned: results.filter((r) => !r.failures.length && r.warnings.length).length,
  notForRole: results.filter((r) => r.notForRole).length,
};
writeFileSync(join(outDir, "report.json"), JSON.stringify({ summary, widths, accounts, results }, null, 2));
console.log(
  `\n${summary.pages} pages · ${summary.failed} failed · ${summary.warned} with warnings · ${summary.notForRole} not for the role. Report: ${join(outDir, "report.json")}`,
);
process.exit(failed.length ? 1 : 0);
