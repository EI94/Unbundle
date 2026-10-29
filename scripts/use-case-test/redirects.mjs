// Redirect harness of the use case hub (docs/use-case/PIANO-LAVORI.md §5.5, package H4i;
// docs/use-case/DESIGN.md §2.1, §2.3, §2.4, §12.5 criteria 1 and 2). Plain `fetch` with
// `redirect: "manual"` and the session of `ls-lead`, against the hub's app on its harness:
//
//   export UC_TEST_ROOT=/private/tmp/<dir>/hub
//   export UC_TEST_PG_PORT=55479 UC_TEST_PG_DB=hub_<id>
//   export UC_TEST_APP_PORT=53120 UC_TEST_AUTH_PORT=59119 UC_TEST_LOGIN_PORT=53122
//   node scripts/uc-test/start-app.mjs --flag USE_CASE_HUB_WORKSPACES=<id of «a»> > app.log &
//   node scripts/uc-test/browser-login.mjs &
//   node scripts/use-case-test/redirects.mjs [--app-log app.log]
//
// Workspace «a» of the fixtures has the area on, «b» has it off (§5.1; scripts/use-case-test/
// seed-hub.mjs gives ls-lead a role in both). Checks, each one printed:
// - area on: every old address answers 307 with the exact Location, query included (?joined=,
//   ?thanks=, ?created= pass, anything else drops), never 308, and the Location answers 200;
// - area off: the same addresses answer 200 with today's page;
// - still reachable with the area on: /portfolio/export, /share/portfolio/** (members go to
//   the card), /casi-duso/<caseId>, /r/<token>, /api/r/** (the route's own 4xx for an unknown
//   token); /casi-duso itself goes to the Panoramica only with dossierLinksReady (H6a);
// - not-found under use-cases/loading.tsx (/use-cases/nuovo with the area off): 200, judged by
//   the content (the noindex meta, and the area's not-found page as Chrome shows it, through
//   scripts/uc-test/cdp.mjs), never by the status;
// - the sidebar in the HTML: one «Use case» entry instead of four with the area on, active on
//   the pages it replaces; today's entries with the area off;
// - with --app-log <file> (the app's stdout): one stub line {area, op, from} per redirect,
//   without ids or query.
// Read-only: no database access, no writes. Exit code 1 on any failure.
// The 307s need no loading.tsx above the old pages (DESIGN §2.4): none of /portfolio/** and /plan
// has one, and a page-level redirect under a loading boundary would answer 200 here.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UC_TEST_APP_PORT, UC_TEST_HOST, UC_TEST_LOGIN_PORT, ucTestRoot } from "../uc-test/config.mjs";

const args = process.argv.slice(2);
let appLog = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--app-log") appLog = args[++i] ?? null;
  else throw new Error(`Unknown option ${args[i]} (only --app-log <file>)`);
}
if (args.includes("--app-log") && !appLog) throw new Error("--app-log needs a file");

// The hub has its own app and login helper (PIANO-LAVORI §2.7): never the Casi d'uso, Learning or connector ones.
if ([53100, 53110, 53130].includes(UC_TEST_APP_PORT) || [53102, 53112].includes(UC_TEST_LOGIN_PORT)) {
  throw new Error(`App ${UC_TEST_APP_PORT} / login ${UC_TEST_LOGIN_PORT} are not the hub's: set UC_TEST_APP_PORT=53120 UC_TEST_LOGIN_PORT=53122`);
}

const manifestPath = join(ucTestRoot(), "uc-fixtures", "synthetic-fixtures.json");
if (!existsSync(manifestPath)) throw new Error(`No fixtures manifest at ${manifestPath}: run seed-fixtures.mjs and seed-hub.mjs first`);
const fixtures = JSON.parse(readFileSync(manifestPath, "utf8"));
const on = fixtures.workspaces?.[fixtures.hub?.areaOn ?? "a"]?.workspaceId;
const off = fixtures.workspaces?.[fixtures.hub?.areaOff ?? "b"]?.workspaceId;
const onCard = fixtures.hub?.useCases?.a?.[0]?.id;
const offCard = fixtures.hub?.useCases?.b?.[0]?.id;
const caseId = fixtures.exampleCase?.caseId ?? null;
if (!on || !off || !onCard || !offCard) throw new Error("The manifest needs workspaces «a» and «b» and the hub seed (seed-hub.mjs)");

const app = `http://${UC_TEST_HOST}:${UC_TEST_APP_PORT}`;
const login = `http://${UC_TEST_HOST}:${UC_TEST_LOGIN_PORT}`;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// ─── Session and requests ────────────────────────────────────────────

async function sessionCookie(account) {
  const response = await fetch(`${login}/as/${account}?to=${encodeURIComponent(`/dashboard/${on}`)}`, { redirect: "manual" });
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
  if (response.status !== 302 || !cookie.startsWith("__session=")) throw new Error(`The login helper did not sign in ${account} (status ${response.status})`);
  return cookie;
}

const cookie = await sessionCookie("ls-lead");

/** One request without following redirects: status, Location as path and query, body. */
async function get(path, method = "GET") {
  const response = await fetch(`${app}${path}`, { method, headers: { cookie }, redirect: "manual", signal: AbortSignal.timeout(180_000) });
  const raw = response.headers.get("location");
  const location = raw === null ? null : (() => {
    const target = new URL(raw, app);
    return target.origin === app ? `${target.pathname}${target.search}` : target.href;
  })();
  return { status: response.status, location, type: response.headers.get("content-type") ?? "", body: await response.text() };
}

const results = [];
function record(name, failures) {
  results.push({ name, failures });
  console.log(`${failures.length ? "FAIL" : "ok  "} ${name}${failures.length ? `: ${failures.join("; ")}` : ""}`);
}

/** The visible text of an HTML page, roughly: no scripts, styles or tags. */
function textOf(html) {
  return html
    .replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ");
}

// ─── 1. Area on: 307 with the exact Location (§2.3) ──────────────────

const hub = (ws) => `/dashboard/${ws}/use-cases`;
const created = "00000000-0000-4000-8000-0000000000c1";
const REDIRECTS = [
  { from: "/portfolio", path: `/dashboard/${on}/portfolio`, to: `${hub(on)}?vista=da-decidere` },
  {
    from: "/portfolio",
    path: `/dashboard/${on}/portfolio?joined=1&waveBudget=50000&thanks=1&created=${created}&waveDurationMonths=6`,
    to: `${hub(on)}?vista=da-decidere&joined=1&thanks=1&created=${created}`,
  },
  { from: "/portfolio", path: `/dashboard/${on}/portfolio?joined=upgraded`, to: `${hub(on)}?vista=da-decidere&joined=upgraded` },
  { from: "/portfolio/review", path: `/dashboard/${on}/portfolio/review/${onCard}`, to: `${hub(on)}/${onCard}` },
  { from: "/portfolio/review", path: `/dashboard/${on}/portfolio/review/${onCard}?x=1`, to: `${hub(on)}/${onCard}` },
  { from: "/portfolio/submit", path: `/dashboard/${on}/portfolio/submit`, to: `${hub(on)}/nuovo` },
  { from: "/plan", path: `/dashboard/${on}/plan`, to: `${hub(on)}?vista=panoramica` },
  { from: "/plan", path: `/dashboard/${on}/plan?vista=x`, to: `${hub(on)}?vista=panoramica` },
];
for (const { path, to } of REDIRECTS) {
  const res = await get(path);
  const failures = [];
  if (res.status === 308) failures.push("308: a permanent redirect the browser would remember");
  else if (res.status !== 307) failures.push(`status ${res.status}, expected 307`);
  if (res.location !== to) failures.push(`Location ${res.location}, expected ${to}`);
  if (res.status === 307 && res.location === to) {
    const next = await get(to);
    if (next.status !== 200) failures.push(`the Location answers ${next.status}`);
  }
  record(`area on   307 ${path.replace(on, "{a}").replace(onCard, "{uc}")}`, failures);
}

// ─── 2. Area off: today's pages (§12.1, §12.3) ───────────────────────

const TODAY = [
  { path: `/dashboard/${off}/portfolio?joined=1`, has: ["Raccolta & Ranking", "Benvenuto in"] },
  { path: `/dashboard/${off}/portfolio/review/${offCard}`, has: [] },
  { path: `/dashboard/${off}/portfolio/submit`, has: ["Nuovo contributo"] },
  { path: `/dashboard/${off}/plan`, has: ["Unbundle Plan"] },
];
for (const { path, has } of TODAY) {
  const res = await get(path);
  const failures = [];
  if (res.status !== 200) failures.push(`status ${res.status}${res.location ? ` → ${res.location}` : ""}, expected 200`);
  const text = textOf(res.body);
  for (const t of has) if (!text.includes(t)) failures.push(`«${t}» missing`);
  record(`area off  200 ${path.replace(off, "{b}").replace(offCard, "{uc}")}`, failures);
}

// ─── 3. Still reachable with the area on (§2.3, D1) ──────────────────

{
  const res = await get(`/dashboard/${on}/portfolio/export`);
  const failures = [];
  if (res.status !== 200) failures.push(`status ${res.status}`);
  if (!/spreadsheet|excel|octet-stream/i.test(res.type)) failures.push(`content-type ${res.type}`);
  record("area on   200 /portfolio/export", failures);
}
for (const [ws, card, to, label] of [
  [on, onCard, `${hub(on)}/${onCard}`, "area on "],
  [off, offCard, `/dashboard/${off}/portfolio/review/${offCard}`, "area off"],
]) {
  // A member of the workspace: straight to the card, whatever the token (D14).
  const res = await get(`/share/portfolio/${ws}/${card}?token=0.x`);
  const failures = [];
  if (res.status !== 307) failures.push(`status ${res.status}, expected 307`);
  if (res.location !== to) failures.push(`Location ${res.location}, expected ${to}`);
  record(`${label}  307 /share/portfolio/{ws}/{uc} for a member`, failures);
}
if (caseId) {
  const res = await get(`/dashboard/${on}/casi-duso/${caseId}`);
  record("area on   200 /casi-duso/{caseId}", res.status === 200 ? [] : [`status ${res.status}${res.location ? ` → ${res.location}` : ""}`]);
}
{
  // /casi-duso itself redirects only with dossierLinksReady, from the workspace layout (H6a):
  // 307 to the Panoramica when every dossier has its card, otherwise the list stays. This script
  // has no database: either answer is right, never a 308 or another Location (acceptance-hub.mjs
  // checks the 307 on a harness where dossierLinksReady is true).
  const res = await get(`/dashboard/${on}/casi-duso`);
  const failures = [];
  const panoramica = `/dashboard/${on}/use-cases?vista=panoramica`;
  if (res.status === 307 && res.location !== panoramica) failures.push(`Location ${res.location}, expected ${panoramica}`);
  if (res.status !== 307 && res.location) failures.push(`status ${res.status} → ${res.location}`);
  if (res.status >= 500) failures.push(`status ${res.status}`);
  record(`area on   ${res.status} /casi-duso (307 to the Panoramica only with dossierLinksReady)`, failures);
}
{
  const res = await get("/r/0000000000000000000000");
  const failures = [];
  if (res.status >= 500) failures.push(`status ${res.status}`);
  if (res.location?.includes("/use-cases")) failures.push(`redirected to ${res.location}`);
  record(`any       ${res.status} /r/<token> stays its own page`, failures);
}
// The referent's API (/api/r/**: answers, uploads, opened…) is not under the area: an unknown
// token gets the route's own JSON error (src/app/api/r/[token]/handler.ts), never a redirect.
// The token has the real shape, so the handler reads it: the GET answers «link_non_valido» (404);
// the POST has no Origin, so it stops at «origine_non_ammessa» (403) before any database write
// and the harness stays read-only. With the Casi d'uso section off both answer «link_non_valido».
const unknownToken = `ucr_${"0".repeat(32)}`;
for (const [method, suffix, codes] of [
  ["GET", "", ["link_non_valido"]],
  ["POST", "/opened", ["origine_non_ammessa", "link_non_valido"]],
]) {
  const res = await get(`/api/r/${unknownToken}${suffix}`, method);
  const failures = [];
  if (res.status === 307 || res.status === 308) failures.push(`${res.status} → ${res.location}`);
  else if (res.status < 400 || res.status >= 500) failures.push(`status ${res.status}, expected the route's 4xx`);
  if (res.location !== null) failures.push(`Location ${res.location}`);
  let body = null;
  try {
    body = JSON.parse(res.body);
  } catch {
    failures.push(`not the route's JSON (${res.type || "no content-type"})`);
  }
  if (body && (body.ok !== false || !codes.includes(body.error))) failures.push(`body ${res.body.slice(0, 120)}, expected error ${codes.join(" or ")}`);
  record(`any       ${res.status} ${method === "GET" ? "" : `${method} `}/api/r/<token>${suffix} stays its own route`, failures);
}

// ─── 4. notFound() under use-cases/loading.tsx: judged by the content (§5.5) ───
// The response streams: 200, the noindex meta in the HTML, and the not-found page rendered in the
// browser in place of the loading boundary (the HTML carries only the skeleton and the 404
// marker). So the status and the meta come from `fetch`, what the page shows from the browser
// (scripts/uc-test/cdp.mjs, used as a library).

{
  const path = `/dashboard/${off}/use-cases/nuovo`;
  const res = await get(path);
  const failures = [];
  if (res.status >= 500) failures.push(`status ${res.status}`);
  if (!/<meta name="robots" content="noindex"/.test(res.body)) failures.push("no noindex meta");
  if (/<form\b/.test(res.body)) failures.push("a form in the HTML");
  const cdp = await import("../uc-test/cdp.mjs");
  const browser = await cdp.launchBrowser({ colorScheme: "dark" });
  try {
    const tab = await cdp.newPage(browser, { width: 1440 });
    await cdp.loginAs(tab, "ls-lead", { to: `/dashboard/${off}` });
    await cdp.navigate(tab, `${app}${path}`);
    const shown = await cdp.evaluate(tab, () => ({
      text: document.body.innerText,
      forms: document.querySelectorAll("form").length,
      noindex: Boolean(document.querySelector('meta[name="robots"][content*="noindex"]')),
    }));
    if (!shown.text.includes("Use case non trovato")) failures.push("the browser does not show the area's «Use case non trovato»");
    if (shown.text.includes("This page could not be found")) failures.push("Next's bare 404 page");
    if (!shown.text.includes("Raccolta & ranking")) failures.push("not inside the workspace bar");
    if (shown.forms) failures.push(`${shown.forms} form(s) on screen`);
    if (!shown.noindex) failures.push("no noindex meta in the browser");
    await cdp.closePage(tab);
  } finally {
    await browser.close();
  }
  record(`area off  ${res.status} /use-cases/nuovo shows «Use case non trovato» with noindex`, failures);
}
{
  const res = await get(`/dashboard/${on}/use-cases/nuovo`);
  const failures = [];
  if (res.status !== 200) failures.push(`status ${res.status}`);
  if (/<meta name="robots" content="noindex"/.test(res.body)) failures.push("noindex on the real form");
  if (!textOf(res.body).includes("Nuovo use case")) failures.push("«Nuovo use case» missing");
  record("area on   200 /use-cases/nuovo is the form", failures);
}

// ─── 5. The sidebar in the HTML (§2.1, §12.5 criterion 1) ────────────

/** The sidebar entries of a page: title, link, active (`data-active` of SidebarMenuButton). */
function sidebarOf(html) {
  return [...html.matchAll(/<a\b([^>]*data-sidebar="menu-button"[^>]*)>([\s\S]*?)<\/a>/g)].map(([, attributes, inner]) => ({
    title: textOf(inner).trim(),
    href: /\shref="([^"]*)"/.exec(attributes)?.[1] ?? "",
    active: /\sdata-active(?:="[^"]*")?(?=[\s>])/.test(attributes) && !/\sdata-active="false"/.test(attributes),
  }));
}
const HUB_BAR = ["Overview", "AI Readiness", "Formazione", "Use case", "Discovery", "Contesto", "Strategia", "Activity mapping", "Value map", "Report", "Blueprints", "Simulazione", "Intelligence", "Impostazioni"];
const TODAY_BAR = ["Overview", "AI Readiness", "Formazione", "Raccolta & ranking", "Discovery", "Contesto", "Strategia", "Activity mapping", "Value map", "Use cases", "Casi d'uso", "Piano", "Report", "Blueprints", "Simulazione", "Intelligence", "Impostazioni"];
/** Formazione and «Casi d'uso» depend on sections the harness may have off: the rest is fixed, in order. */
const OPTIONAL = new Set(["Formazione", "Casi d'uso"]);
const sameBar = (titles, expected) => {
  const kept = expected.filter((t) => !OPTIONAL.has(t) || titles.includes(t));
  return titles.length === kept.length && titles.every((t, i) => t === kept[i]);
};

{
  const bar = sidebarOf((await get(`/dashboard/${on}/settings`)).body);
  const titles = bar.map((entry) => entry.title);
  const failures = [];
  if (!sameBar(titles, HUB_BAR)) failures.push(`entries ${titles.join(" · ")}`);
  if (bar.find((entry) => entry.title === "Use case")?.href !== hub(on)) failures.push("«Use case» does not link /use-cases");
  record(`area on   sidebar: ${titles.length} entries, one «Use case»`, failures);
}
// `?vista=roadmap` is the old name of the Panoramica: it still opens the hub, under «Use case».
for (const rest of [`/use-cases?vista=panoramica`, `/use-cases?vista=roadmap`, `/use-cases/${onCard}`, `/use-cases/nuovo`, ...(caseId ? [`/casi-duso/${caseId}`] : [])]) {
  const res = await get(`/dashboard/${on}${rest}`);
  const active = sidebarOf(res.body).filter((entry) => entry.active).map((entry) => entry.title);
  record(`area on   sidebar active on ${rest.replace(onCard, "{uc}").replace(caseId ?? "-", "{caseId}")}: ${active.join(", ") || "none"}`, active.join() === "Use case" ? [] : [`expected «Use case»`]);
}
{
  const bar = sidebarOf((await get(`/dashboard/${off}/settings`)).body);
  const titles = bar.map((entry) => entry.title);
  record(`area off  sidebar: ${titles.length} entries, today's`, sameBar(titles, TODAY_BAR) ? [] : [`entries ${titles.join(" · ")}`]);
  const active = sidebarOf((await get(`/dashboard/${off}/portfolio/review/${offCard}`)).body).filter((entry) => entry.active).map((entry) => entry.title);
  record(`area off  sidebar active on /portfolio/review/{uc}: ${active.join(", ") || "none"} (exact match, as today)`, active.length ? [`expected none, got ${active.join(", ")}`] : []);
}

// ─── 6. Stub log lines (§2.4) ─────────────────────────────────────────

if (appLog) {
  const lines = readFileSync(appLog, "utf8")
    .split("\n")
    .filter((line) => line.includes('"use-case-hub"') && line.includes('"stub"'));
  const failures = [];
  const parsed = lines.map((line) => JSON.parse(line.slice(line.indexOf("{"))));
  for (const entry of parsed) {
    if (Object.keys(entry).sort().join() !== "area,from,op") failures.push(`extra keys in ${JSON.stringify(entry)}`);
  }
  for (const line of lines) if (UUID.test(line) || line.includes("?")) failures.push(`id or query in «${line.trim()}»`);
  for (const from of new Set(REDIRECTS.map((r) => r.from))) {
    if (!parsed.some((entry) => entry.from === from)) failures.push(`no stub line for ${from}`);
  }
  record(`stub log: ${lines.length} lines {area, op, from}, no ids, no query`, failures);
}

const failed = results.filter((r) => r.failures.length);
console.log(`\n${results.length} checks · ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
