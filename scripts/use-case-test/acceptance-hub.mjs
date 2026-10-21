// Acceptance of the use case hub on its local harness (docs/use-case/PIANO-LAVORI.md H6a, H7;
// docs/use-case/DESIGN.md §2.3, §2.4, §6.5, §10.4, §10.9). H6a: the dossier entries («ingressi»
// of the Casi d'uso C13 note «Cambia con Use case»). H7 adds the 8 criteria of §12.5.
//
//   export UC_TEST_ROOT=/private/tmp/<dir>/hub
//   export UC_TEST_PG_PORT=55479 UC_TEST_PG_DB=hub_<id>
//   export UC_TEST_APP_PORT=53120 UC_TEST_AUTH_PORT=59119 UC_TEST_LOGIN_PORT=53122
//   node scripts/uc-test/start-app.mjs --flag USE_CASE_HUB_WORKSPACES=<id of «a»> > app.log &
//   node scripts/uc-test/browser-login.mjs &
//   node scripts/use-case-test/acceptance-hub.mjs
//
// Workspace «a» of the fixtures has the area on, «b» off. Checks, each one printed:
// - casi-duso/loading.tsx is there (the 307s below must not come from a page under it);
// - /casi-duso: 307 to /use-cases?vista=roadmap when dossierLinksReady is true for «a» (read
//   here from the database: the unique index and no complete dossier without a card), otherwise
//   the list stays (no redirect); with the area off it never goes to the hub;
// - /casi-duso/nuovo without useCaseId: 307 to /use-cases?vista=priorita (src/proxy.ts), and an
//   empty or invalid useCaseId too; with the area off it stays;
// - /casi-duso/nuovo?useCaseId=<a uuid not in the workspace>: the page sends to «Priorità» (under
//   loading.tsx: 200 with a meta refresh, judged by the content);
// - the e-mail links /casi-duso/<caseId> answer 200;
// - with dossierLinksReady, no complete dossier of «a» without its card (the seed and
//   `use-case-admin dossier-links` leave none).
// Read-only: one read-only transaction on the database, GET requests to the app. Exit 1 on any failure.
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { UC_TEST_APP_PORT, UC_TEST_DB, UC_TEST_HOST, UC_TEST_LOGIN_PORT, UC_TEST_PORT, UC_TEST_USER, ucTestRoot } from "../uc-test/config.mjs";

if (process.argv.length > 2) throw new Error(`Unknown option ${process.argv[2]} (none)`);
if ([53100, 53110, 53130].includes(UC_TEST_APP_PORT) || [53102, 53112].includes(UC_TEST_LOGIN_PORT)) {
  throw new Error(`App ${UC_TEST_APP_PORT} / login ${UC_TEST_LOGIN_PORT} are not the hub's: set UC_TEST_APP_PORT=53120 UC_TEST_LOGIN_PORT=53122`);
}
if ([55439, 55449, 55469].includes(UC_TEST_PORT)) throw new Error(`Port ${UC_TEST_PORT} is not the hub's cluster (55479)`);

const manifestPath = join(ucTestRoot(), "uc-fixtures", "synthetic-fixtures.json");
if (!existsSync(manifestPath)) throw new Error(`No fixtures manifest at ${manifestPath}: run seed-fixtures.mjs and seed-hub.mjs first`);
const fixtures = JSON.parse(readFileSync(manifestPath, "utf8"));
const on = fixtures.workspaces?.[fixtures.hub?.areaOn ?? "a"]?.workspaceId;
const off = fixtures.workspaces?.[fixtures.hub?.areaOff ?? "b"]?.workspaceId;
const caseId = fixtures.exampleCase?.caseId ?? null;
if (!on || !off) throw new Error("The manifest needs workspaces «a» and «b» and the hub seed (seed-hub.mjs)");

const app = `http://${UC_TEST_HOST}:${UC_TEST_APP_PORT}`;
const login = `http://${UC_TEST_HOST}:${UC_TEST_LOGIN_PORT}`;

const results = [];
function record(name, failures) {
  results.push({ name, failures });
  console.log(`${failures.length ? "FAIL" : "ok  "} ${name}${failures.length ? `: ${failures.join("; ")}` : ""}`);
}

// ─── Database: dossierLinksReady of «a», read-only ──────────────────

const { Client } = createRequire(resolve("package.json"))("pg");
const client = new Client({ host: UC_TEST_HOST, port: UC_TEST_PORT, user: UC_TEST_USER, database: UC_TEST_DB });
await client.connect();
let links;
try {
  await client.query("BEGIN READ ONLY");
  const { rows } = await client.query(
    `SELECT to_regclass('public.uc_cases_portfolio_use_case_unique_idx') IS NOT NULL AS index_ok,
            (SELECT count(*)::int FROM uc_cases c WHERE c.workspace_id = $1::uuid AND c.setup_completed_at IS NOT NULL AND c.portfolio_use_case_id IS NULL) AS orphans,
            (SELECT count(*)::int FROM uc_cases c WHERE c.workspace_id = $1::uuid AND c.setup_completed_at IS NOT NULL) AS dossiers`,
    [on],
  );
  links = rows[0];
  await client.query("ROLLBACK");
} finally {
  await client.end();
}
const ready = links.index_ok === true && links.orphans === 0;
console.log(`dossierLinksReady(«a») = ${ready} (index ${links.index_ok ? "present" : "missing"}, ${links.dossiers} complete dossier(s), ${links.orphans} without a card)`);
if (!ready) console.log("  To check the /casi-duso redirect too: use-case-admin dossier-links --workspace <«a»> --apply on this harness database.");

// ─── Session and requests ────────────────────────────────────────────

async function sessionCookie(account) {
  const response = await fetch(`${login}/as/${account}?to=${encodeURIComponent(`/dashboard/${on}`)}`, { redirect: "manual" });
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
  if (response.status !== 302 || !cookie.startsWith("__session=")) throw new Error(`The login helper did not sign in ${account} (status ${response.status})`);
  return cookie;
}
const cookie = await sessionCookie("ls-lead");

async function get(path) {
  const response = await fetch(`${app}${path}`, { headers: { cookie }, redirect: "manual", signal: AbortSignal.timeout(180_000) });
  const raw = response.headers.get("location");
  const location = raw === null ? null : (() => {
    const target = new URL(raw, app);
    return target.origin === app ? `${target.pathname}${target.search}` : target.href;
  })();
  return { status: response.status, location, body: await response.text() };
}

// ─── Checks ──────────────────────────────────────────────────────────

const loading = "src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/loading.tsx";
record("casi-duso/loading.tsx is there", existsSync(resolve(loading)) ? [] : [`${loading} missing`]);

const roadmap = (ws) => `/dashboard/${ws}/use-cases?vista=roadmap`;
const priorita = (ws) => `/dashboard/${ws}/use-cases?vista=priorita`;

{
  const res = await get(`/dashboard/${on}/casi-duso`);
  const failures = [];
  if (ready) {
    if (res.status !== 307) failures.push(`status ${res.status}, expected 307`);
    if (res.location !== roadmap(on)) failures.push(`Location ${res.location}, expected ${roadmap(on)}`);
  } else if (res.location) failures.push(`redirected to ${res.location} without dossierLinksReady`);
  record(`area on   ${res.status} /casi-duso ${ready ? "→ Roadmap" : "stays (dossierLinksReady false)"}`, failures);
}
for (const query of ["", "?useCaseId=", "?useCaseId=non-valido", "?altro=1"]) {
  const res = await get(`/dashboard/${on}/casi-duso/nuovo${query}`);
  const failures = [];
  if (res.status !== 307) failures.push(`status ${res.status}, expected 307`);
  if (res.location !== priorita(on)) failures.push(`Location ${res.location}, expected ${priorita(on)}`);
  record(`area on   ${res.status} /casi-duso/nuovo${query} → Priorità`, failures);
}
{
  const res = await get(`/dashboard/${on}/casi-duso/nuovo?useCaseId=${randomUUID()}`);
  const failures = [];
  if (res.location && res.location !== priorita(on)) failures.push(`Location ${res.location}`);
  if (!res.location && !res.body.replace(/&amp;/g, "&").includes(priorita(on))) failures.push(`status ${res.status} without a redirect to ${priorita(on)}`);
  record(`area on   ${res.status} /casi-duso/nuovo?useCaseId=<not in the workspace> → Priorità`, failures);
}
for (const path of [`/dashboard/${off}/casi-duso`, `/dashboard/${off}/casi-duso/nuovo`]) {
  const res = await get(path);
  const failures = [];
  if (res.location?.includes("/use-cases")) failures.push(`redirected to ${res.location} with the area off`);
  if (res.status >= 500) failures.push(`status ${res.status}`);
  record(`area off  ${res.status} ${path.replace(off, "{ws}")} stays`, failures);
}
if (caseId) {
  for (const rest of ["", "/domande"]) {
    const res = await get(`/dashboard/${on}/casi-duso/${caseId}${rest}`);
    record(`area on   ${res.status} /casi-duso/{caseId}${rest} (e-mail link)`, res.status === 200 ? [] : [`status ${res.status}${res.location ? ` → ${res.location}` : ""}`]);
  }
}
if (ready) record("no complete dossier of «a» without its card", links.orphans === 0 ? [] : [`${links.orphans} orphan(s)`]);

const failed = results.filter((r) => r.failures.length);
console.log(`\n${results.length - failed.length}/${results.length} checks green`);
process.exit(failed.length ? 1 : 0);
