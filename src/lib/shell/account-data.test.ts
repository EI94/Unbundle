import test from "node:test";
import assert from "node:assert/strict";
import { installAppModules } from "../ai/claude-test-kit.ts";

// (Rilascio 10, ondata 2a «Cornice», docs/ui-10/PROPOSTA-10.md §3.10) Che cosa il foglio «Il tuo account» riceve, per
// chi guarda: le stesse letture dei blocchi di Impostazioni, solo la parte personale. Letture finte, dati inventati.

type Prova = {
  bell: { seenAt: null; referentEmails: boolean; hasRequested: boolean } | Error;
  team: Record<string, unknown> | null;
  cli: { tokens: unknown[] } | null | Error;
  granola: Record<string, unknown>;
  asked: string[];
};
const prova: Prova = { bell: { seenAt: null, referentEmails: false, hasRequested: true }, team: null, cli: null, granola: {}, asked: [] };
(globalThis as { __accountProva?: Prova }).__accountProva = prova;

await installAppModules({
  "@/lib/db/queries/bell-state": `export async function getBellState(ws, user) {
    const p = globalThis.__accountProva; p.asked.push("bell:" + ws + ":" + user);
    if (p.bell instanceof Error) throw p.bell; return p.bell; }`,
  "@/lib/db/queries/team-mcp-tokens": `export async function loadTeamMcpCard(i) {
    const p = globalThis.__accountProva; p.asked.push("team:" + i.role); return p.team; }`,
  "@/lib/db/queries/use-case-cli-auth": `export async function loadCliCard(executor, i) {
    const p = globalThis.__accountProva; p.asked.push("cli:" + i.lateralSpace); if (p.cli instanceof Error) throw p.cli; return p.cli; }`,
  "@/lib/db/queries/context-granola": `export async function loadGranolaStatus(i) {
    const p = globalThis.__accountProva; p.asked.push("granola:" + i.userId); return p.granola; }`,
  "@/lib/db/queries/uc-access": `export function ucLsDomains() { return ["ls.test"]; }`,
  "@/lib/db/ensure-schema": `export async function ensureDbSchema() {}`,
  "@/lib/db/uc-executor": `export async function getAppUcExecutor() { return {}; }`,
  "@/lib/log/safe-error": `export function logSafeError(scope, op) { globalThis.__accountProva.asked.push("log:" + scope + ":" + op); }`,
  "@/lib/context/server/actor": `export function contextActorFor(user, access, workspaceId) {
    return { workspaceId, userId: user.id, role: access.role, isLateralSpace: user.emailVerified === true && String(user.email).endsWith("@ls.test"), channel: "web" }; }`,
});
const { loadAccountSheet } = await import("./account-data.ts");

const WS = "00000000-0000-4000-8000-0000000000f1";
const ENV = { USE_CASE_HUB_WORKSPACES: "*" };
const LS = { id: "00000000-0000-4000-8000-0000000000a1", email: "persona@ls.test", emailVerified: true };
const CLIENT = { id: "00000000-0000-4000-8000-0000000000a2", email: "persona@cliente.test", emailVerified: true };

const TEAM = {
  status: "pronta",
  tokens: [{ id: "t1", label: "Claude Code", active: true }],
  workspaceActiveCount: 7,
  canRevokeAll: true,
  routeEnabled: true,
  ttlDays: 90,
  warningDays: 14,
  defaultLabel: "Claude Code",
  url: "https://esempio.test/api/mcp/team",
  connectorName: "Unbundle Use case",
  claudeCodeName: "unbundle-use-case",
  skillName: "registra-ai-lab",
};

function reset(over: Partial<Prova> = {}) {
  Object.assign(prova, { bell: { seenAt: null, referentEmails: false, hasRequested: true }, team: null, cli: null, granola: {}, asked: [] }, over);
}

test("revisore di Lateral Space che ha chiesto al referente: email, Claude (solo la parte sua), terminale, Granola", async () => {
  reset({ team: TEAM, cli: { tokens: [{ id: "c1" }] }, granola: { available: true, connected: true, status: "attiva", accountEmail: "persona@ls.test", plan: "Business" } });
  const account = await loadAccountSheet({ workspaceId: WS, user: LS, role: "transformation_lead", env: ENV });
  assert.deepEqual(account.email, { on: false });
  // Mai il conto dei token degli altri né «Revoca tutti»: restano in Impostazioni › Collegamenti.
  assert.deepEqual(account.claude, {
    status: "pronta",
    tokens: [{ id: "t1", label: "Claude Code", active: true }],
    routeEnabled: true,
    ttlDays: 90,
    defaultLabel: "Claude Code",
    url: "https://esempio.test/api/mcp/team",
    connectorName: "Unbundle Use case",
    claudeCodeName: "unbundle-use-case",
    warningDays: 14,
    skillName: "registra-ai-lab",
  });
  assert.deepEqual(account.terminal, { links: [{ id: "c1" }] });
  assert.deepEqual(account.granola, { state: "collegato", accountEmail: "persona@ls.test", plan: "Business" });
  assert.ok(prova.asked.includes("cli:true"), "la CLI sa che chi guarda è di Lateral Space");
});

test("revisore del cliente: niente Granola (non la legge nemmeno), il resto come i blocchi di Impostazioni", async () => {
  reset({ team: TEAM });
  const account = await loadAccountSheet({ workspaceId: WS, user: CLIENT, role: "function_lead", env: ENV });
  assert.equal(account.granola, null);
  assert.ok(!prova.asked.some((entry) => entry.startsWith("granola:")));
  assert.equal(account.terminal, null);
  assert.deepEqual(account.email, { on: false });
  assert.ok(prova.asked.includes("cli:false"));
});

test("le email: solo a chi valuta, con l'area e le richieste accese, e dopo aver chiesto", async () => {
  reset({ bell: { seenAt: null, referentEmails: true, hasRequested: false } });
  assert.equal((await loadAccountSheet({ workspaceId: WS, user: CLIENT, role: "analyst", env: ENV })).email, null, "non ha mai chiesto");
  reset({ bell: { seenAt: null, referentEmails: true, hasRequested: true } });
  assert.equal((await loadAccountSheet({ workspaceId: WS, user: CLIENT, role: "contributor", env: ENV })).email, null, "contributore");
  assert.equal((await loadAccountSheet({ workspaceId: WS, user: CLIENT, role: "analyst", env: {} })).email, null, "area spenta");
  assert.equal((await loadAccountSheet({ workspaceId: WS, user: CLIENT, role: "analyst", env: { ...ENV, USE_CASE_REFERENTS: "off" } })).email, null, "richieste spente");
  assert.deepEqual((await loadAccountSheet({ workspaceId: WS, user: CLIENT, role: "analyst", env: ENV })).email, { on: true });
});

test("contributore senza accessi: ogni parte vuota, e il foglio mostra il solo tema", async () => {
  reset();
  const account = await loadAccountSheet({ workspaceId: WS, user: CLIENT, role: "contributor", env: ENV });
  assert.deepEqual(account, { email: null, claude: null, terminal: null, granola: null });
});

test("una parte che non si legge resta fuori, e il foglio non si ferma: niente testo dell'errore", async () => {
  reset({ bell: new Error("segreto"), cli: new Error("segreto"), team: { ...TEAM, status: "errore", tokens: [] } });
  const account = await loadAccountSheet({ workspaceId: WS, user: LS, role: "transformation_lead", env: ENV });
  assert.equal(account.email, null);
  assert.equal(account.terminal, null);
  assert.equal(account.claude?.status, "errore");
  assert.ok(prova.asked.includes("log:account:email_non_letta") && prova.asked.includes("log:account:cli_non_letta"));
  assert.doesNotMatch(JSON.stringify(account), /segreto/);
});
