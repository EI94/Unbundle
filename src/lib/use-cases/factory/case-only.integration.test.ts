import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import * as nodeModule from "node:module";
/** `module.registerHooks` di Node 24 (i tipi di @types/node del progetto non lo hanno ancora). */
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?(specifier: string, context: object, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult }): void;
};

// «Solo questo use case» (rilascio 8.0d-1 «Porte», RILASCIO-8.0d-ESTERNI-FASE-2.md §2.10) sulle porte vere, sul database
// del pacchetto: la matrice di sicurezza B1-B15 per quello che la 8.0d-1 porta (niente invito da creare: le righe
// `esterno_caso` le scrivono solo le prove).
// - B12: la 0043 due volte, con scritture in corso su `workspace_memberships`, sotto il lock_timeout; la sonda; il valore.
// - U1 sul database e B15: le porte per ruolo; E3 «Solo questo use case» in A e Contributore in B.
// - B5, B6: la riga non basta, «tutti» non vale; un membro dell'organizzazione mai.
// - B2, B4: CLI e MCP del caso: su A1 come chi costruisce da fuori, su A2 e su B come un caso che non esiste.
// - B3: le 7 azioni di chi costruisce su A1 sì, su A2 «non trovato»; approvare, riaprire, AI Board, modifica mai.
// - B7: elenchi di persone. B8: il repository suo. U5: la campanella. D7: il contesto del caso, mai quello dell'azienda.
// - B9: le uscite. B10, B11, B13: l'accettazione e la salita. «Da fare per te».
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su 127.0.0.1). Dati
//   sintetici («Cliente Demo», XO*-…, e-mail `.test`), creati e cancellati qui. I token non si stampano mai.
const url = process.env.DATABASE_URL;
const enabled = process.env.HUB_TEST_ISOLATED === "true" && Boolean(url);
if (enabled) {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || process.env.UC_TEST_DATABASE_URL !== url) throw new Error("Hub DB tests need a loopback DATABASE_URL equal to UC_TEST_DATABASE_URL");
  if (!/^\/hub_[a-z0-9][a-z0-9_]{0,39}$/.test(parsed.pathname)) throw new Error("Run this suite only on a package database hub_<id>");
}
const opts = { skip: !enabled };

type Row = Record<string, unknown>;
type Handler = (request: Request) => Promise<Response>;
let q: (text: string, params?: unknown[]) => Promise<Row[]>;
let exec: import("../../db/uc-executor.ts").UcExecutor;
let cliAuth: typeof import("../../db/queries/use-case-cli-auth.ts");
let factoryActions: typeof import("../../actions/use-case-factory.ts");
let builders: typeof import("../../db/queries/use-case-builders.ts");
let team: typeof import("../../db/queries/use-case-workspace-team.ts");
let ucCases: typeof import("../../db/queries/uc-cases.ts");
let ensure: typeof import("../../db/ensure-schema.ts");
const routes: Record<string, { GET?: Handler; POST?: Handler }> = {};

const LS = "ls.test";
const suffix = randomBytes(3).toString("hex");
const SUFFIX = suffix.toUpperCase();
/**
 * Due clienti: il workspace A (organizzazione A) e il workspace B (organizzazione B).
 * - lead: Lateral Space, responsabile di A1, A2, A3 e B1;
 * - e3: «Solo questo use case» in A per A1 (concessione per A1, riga `osservatore` in A1); in A2 una riga `osservatore`
 *   scritta a mano, senza concessione (B5); Contributore in B (B15);
 * - e6: «Solo questo use case» in A con una concessione «tutti» scritta a mano e la riga in A1 (B6);
 * - oe: membro dell'organizzazione A (Contributore) e `esterno_caso` nel workspace, concessione per A1 e riga: mai;
 * - e: chi costruisce da fuori nella 8.0c (Analista, concessione per A1, riga in A1): niente cambia per lui;
 * - c: Contributore in A; p: segue un corso in A;
 * - e4: nessun accesso (l'invito); e5: «Solo questo use case» con la concessione per A2 e senza riga.
 */
const people = ["lead", "e3", "e6", "oe", "e", "c", "p", "e4", "e5"] as const;
type Person = (typeof people)[number];
const ids = {
  orgA: randomUUID(),
  orgB: randomUUID(),
  wsA: randomUUID(),
  wsB: randomUUID(),
  template: randomUUID(),
  ucA1: randomUUID(),
  ucA2: randomUUID(),
  ucA3: randomUUID(),
  ucA4: randomUUID(),
  ucB1: randomUUID(),
  caseA1: randomUUID(),
  caseA2: randomUUID(),
  caseA3: randomUUID(),
  caseA4: randomUUID(),
  caseB1: randomUUID(),
  ...(Object.fromEntries(people.map((p) => [p, randomUUID()])) as Record<Person, string>),
};
const EMAIL: Record<Person, string> = Object.fromEntries(people.map((p) => [p, p === "lead" ? `lead-${suffix}@${LS}` : `${p}-${suffix}@altra.test`])) as Record<Person, string>;
// I codici della scheda: `^[A-Z]{2,4}-[0-9]{4,5}$` (il CHECK di use_cases); i workspace sono nuovi a ogni giro.
const CODE = { A1: "XO-0012", A2: "XO-0013", A3: "XO-0014", A4: "XO-0015", B1: "XB-0012" };
const tokens: Partial<Record<Person, string>> = {};
let keySeq = 0;
const key = () => `solo-${suffix}-${++keySeq}`;
let probeBefore: boolean | null = null;
const lockTimes: number[] = [];

async function call(path: string, init: { method?: "GET" | "POST"; token?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<{ status: number; json: Row }> {
  const [route, query] = path.split("?");
  const handler = routes[route]?.[init.method ?? "GET"];
  assert.ok(handler, `rotta ${route} ${init.method ?? "GET"}`);
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const response = await handler(new Request(`http://127.0.0.1:53110/api/cli/${route}${query ? `?${query}` : ""}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) }));
  return { status: response.status, json: (await response.json()) as Row };
}
const post = (route: string, token: string, body: unknown, idempotencyKey: string | null = key()) =>
  call(route, { method: "POST", token, body, headers: idempotencyKey ? { "idempotency-key": idempotencyKey } : {} });
const codeOf = (r: { json: Row }) => (r.json.errore as Row | undefined)?.codice;

async function tokenFor(person: Person, workspaceId = ids.wsA): Promise<string> {
  const started = await cliAuth.startCliLogin(exec, { clientLabel: `CLI di prova solo caso ${suffix}` });
  const decided = await cliAuth.decideCliLogin(exec, { userCode: started.userCode, userId: ids[person], workspaceId, confirm: true });
  assert.ok(decided.ok, decided.ok ? "" : decided.message);
  const delivered = await cliAuth.deliverCliLogin(exec, started.deviceCode);
  assert.equal(delivered.status, "consegnato");
  return (delivered as { token: string }).token;
}

let rpcSeq = 0;
async function tool(token: string, name: string, args: Row): Promise<{ isError: boolean; data: Row; text: string }> {
  const response = await routes.mcp.POST!(
    new Request("http://127.0.0.1:53110/api/cli/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcSeq, method: "tools/call", params: { name, arguments: args } }),
    }),
  );
  assert.equal(response.status, 200, `${name}: HTTP ${response.status}`);
  const result = ((await response.json()) as Row).result as { isError?: boolean; structuredContent: Row; content: Array<{ text: string }> };
  return { isError: result.isError === true, data: result.structuredContent, text: result.content[0].text };
}

const sessionOf = (person: Person) => ({ user: { id: ids[person], email: EMAIL[person], emailVerified: true, name: `Prova ${person}`, image: null } });
function as<T>(person: Person, run: () => Promise<T>): Promise<T> {
  (globalThis as { __cliSession?: unknown }).__cliSession = sessionOf(person);
  return run().finally(() => {
    delete (globalThis as { __cliSession?: unknown }).__cliSession;
  });
}

const probe = async () => (await q(`SELECT ${(await import("../../db/use-case-hub-case-only-ddl.ts")).CASE_ONLY_PROBE_SQL} AS ok`))[0]?.ok === true;

/** Il contesto di un comando del dossier per chi agisce, con i suoi ruoli in quel caso adesso. */
async function ctxFor(person: Person, caseId: string): Promise<import("../../db/queries/uc-cases.ts").UcCommandContext> {
  const user = await ucCases.loadUserContext(exec, ids[person], [LS]);
  assert.ok(user);
  const roles = await ucCases.loadCaseRoles(exec, caseId, user, [LS]);
  return { workspaceId: ids.wsA, caseId, actor: { type: "utente", userId: ids[person], roles: roles.effective }, user, lsDomains: [LS] };
}

before(async () => {
  if (!enabled) return;
  const stub = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
  const stubs: Record<string, string> = {
    "next/cache": stub("export function revalidatePath() {}\nexport function revalidateTag() {}\nexport function unstable_cache(fn) { return fn; }\nexport function unstable_noStore() {}\nexport function refresh() {}"),
    "next/server": stub("export function after(task) { (globalThis.__cliAfter ??= []).push(task); }"),
    "@/lib/auth": stub("export async function auth() { return globalThis.__cliSession ?? null; }"),
  };
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (Object.hasOwn(stubs, specifier)) return { url: stubs[specifier], shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  process.env.UC_ENABLED = "true";
  process.env.UC_WORKSPACE_IDS = `${ids.wsA},${ids.wsB}`;
  process.env.UC_LS_EMAIL_DOMAINS = LS;
  process.env.USE_CASE_HUB_WORKSPACES = `${ids.wsA},${ids.wsB}`;
  delete process.env.VERCEL_ENV;

  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Row[]>;
  ensure = await import("../../db/ensure-schema.ts");

  // B12, prima di tutto il resto: la sonda com'era, poi la 0043 mentre un'altra transazione scrive in
  // `workspace_memberships` (una riga di prova, tenuta fino alla fine). La 0043 non tocca quella tabella: nessuna attesa.
  probeBefore = await probe();
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Cliente Demo A', $2), ($3, 'Cliente Demo B', $4)`, [ids.orgA, `org-solo-a-${suffix}`, ids.orgB, `org-solo-b-${suffix}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Cliente Demo A'), ($3, $4, 'Cliente Demo B')`, [ids.wsA, ids.orgA, ids.wsB, ids.orgB]);
  for (const person of people) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, $3, now())`, [ids[person], EMAIL[person], `Prova ${person}`]);
  }
  await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'transformation_lead'::member_role)`, [ids.wsA, ids.lead]);
  const pg = (await import("pg")).default;
  const blocker = new pg.Client({ connectionString: url });
  await blocker.connect();
  try {
    await blocker.query("BEGIN");
    await blocker.query("UPDATE workspace_memberships SET updated_at = now() WHERE workspace_id = $1", [ids.wsA]);
    await blocker.query("SELECT count(*) FROM workspace_memberships WHERE workspace_id = $1", [ids.wsA]);
    for (let i = 0; i < 2; i++) {
      const started = Date.now();
      await ensure.runCaseOnlyDdl();
      lockTimes.push(Date.now() - started);
    }
  } finally {
    await blocker.query("COMMIT");
    await blocker.end();
  }
  await ensure.ensureDbSchema();

  exec = (await import("../../db/uc-executor.ts")).ucExecutorForUrl(url!);
  cliAuth = await import("../../db/queries/use-case-cli-auth.ts");
  factoryActions = await import("../../actions/use-case-factory.ts");
  builders = await import("../../db/queries/use-case-builders.ts");
  team = await import("../../db/queries/use-case-workspace-team.ts");
  ucCases = await import("../../db/queries/uc-cases.ts");
  for (const name of ["context", "setup", "pacchetto", "decisioni", "domande", "repository", "sessioni", "token-caso", "mcp", "compiti", "evals", "contesto", "whoami"]) {
    routes[name] = await import(`../../../app/api/cli/${name}/route.ts`);
  }

  // Il valore dell'enum si usa dopo il commit della 0043.
  void SUFFIX;
  const wsRole: Partial<Record<Person, string>> = { e3: "esterno_caso", e6: "esterno_caso", oe: "esterno_caso", e: "analyst", c: "contributor", p: "learner", e5: "esterno_caso" };
  for (const [person, role] of Object.entries(wsRole) as [Person, string][]) {
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ids.wsA, ids[person], role]);
  }
  await q(`INSERT INTO memberships (organization_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'contributor'::member_role)`, [ids.orgA, ids.oe]);
  await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'transformation_lead'::member_role), ($1::uuid, $3::uuid, 'contributor'::member_role)`, [ids.wsB, ids.lead, ids.e3]);
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, code) VALUES ($1, $6, 'Quotazioni di prova', $7), ($2, $6, 'Ricambi di prova', $8), ($3, $6, 'Tempi di prova', $9), ($4, $6, 'Turni di prova', $10), ($5, $11, 'Fatture di prova', $12)`,
    [ids.ucA1, ids.ucA2, ids.ucA3, ids.ucA4, ids.ucB1, ids.wsA, CODE.A1, CODE.A2, CODE.A3, CODE.A4, ids.wsB, CODE.B1],
  );
  await q(
    `INSERT INTO uc_templates (id, key, version, name, archetype, definition, definition_hash)
     VALUES ($1::uuid, $2, '1.0.0', 'Template di prova solo caso', 'prova', '{"confidential": false}'::jsonb, $3)`,
    [ids.template, `prova.solo_${suffix}`, randomBytes(32).toString("hex")],
  );
  const dossiers: [string, string, string, string, string][] = [
    [ids.caseA1, ids.wsA, ids.orgA, ids.ucA1, `XD1-${SUFFIX}`],
    [ids.caseA2, ids.wsA, ids.orgA, ids.ucA2, `XD2-${SUFFIX}`],
    [ids.caseA3, ids.wsA, ids.orgA, ids.ucA3, `XD3-${SUFFIX}`],
    [ids.caseA4, ids.wsA, ids.orgA, ids.ucA4, `XD4-${SUFFIX}`],
    [ids.caseB1, ids.wsB, ids.orgB, ids.ucB1, `XDB-${SUFFIX}`],
  ];
  for (const [caseId, ws, org, uc, code] of dossiers) {
    await q(
      `INSERT INTO uc_cases (id, workspace_id, organization_id, portfolio_use_case_id, template_id, template_version, code, title, status, setup_completed_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, '1.0.0', $6, 'Dossier di prova solo caso', 'pronto_sviluppo', now())`,
      [caseId, ws, org, uc, ids.template, code],
    );
    await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, 'ls_lead')`, [caseId, ids.lead]);
  }
  const member = (caseId: string, person: Person, role = "osservatore") => q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, $3)`, [caseId, ids[person], role]);
  const grant = (person: Person, useCaseId: string | null) =>
    q(`INSERT INTO use_case_external_builders (workspace_id, user_id, use_case_id, added_by_user_id) VALUES ($1, $2, $3, $4)`, [ids.wsA, ids[person], useCaseId, ids.lead]);
  for (const person of ["e3", "e6", "oe", "e"] as const) await member(ids.caseA1, person);
  await member(ids.caseA2, "e3"); // B5: la riga senza concessione, scritta a mano.
  await grant("e3", ids.ucA1);
  await grant("e6", null); // B6: «tutti», scritta a mano.
  await grant("oe", ids.ucA1);
  await grant("e", ids.ucA1);
  await grant("e5", ids.ucA2);
  for (const person of ["lead", "e3", "e"] as const) tokens[person] = await tokenFor(person);
});

after(async () => {
  if (!enabled) return;
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.wsA, ids.wsB]]);
  await q(`DELETE FROM uc_templates WHERE id = $1`, [ids.template]);
  await q(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [[ids.orgA, ids.orgB]]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [people.map((p) => ids[p])]);
});

test("B12: la 0043 due volte con scritture in corso su workspace_memberships, senza attese; la sonda vera dopo, falsa senza un pezzo", opts, async () => {
  assert.equal(typeof probeBefore, "boolean");
  assert.equal(lockTimes.length, 2);
  for (const ms of lockTimes) assert.ok(ms < 3000, `${ms} ms: sotto il lock_timeout di 3 s`);
  assert.equal(await probe(), true);
  // Ancora due volte: idempotente.
  await ensure.runCaseOnlyDdl();
  await ensure.runCaseOnlyDdl();
  assert.equal(await probe(), true);
  // La sonda è falsa se manca un pezzo: il valore, la tabella, l'indice, la chiave.
  const { CASE_ONLY_PROBE_SQL } = await import("../../db/use-case-hub-case-only-ddl.ts");
  for (const [from, to] of [
    ["'esterno_caso'", "'valore_che_non_c_e'"],
    ["public.use_case_builder_invites')", "public.tabella_che_non_c_e')"],
    ["use_case_builder_invites_use_case_idx", "indice_che_non_c_e"],
    ["'use_case_builder_invites_pkey'", "'chiave_che_non_c_e'"],
  ]) {
    assert.equal((await q(`SELECT ${CASE_ONLY_PROBE_SQL.split(from).join(to)} AS ok`))[0]?.ok, false, from);
  }
  // Il valore è in coda all'enum, dopo `learner`.
  const labels = (await q(`SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'member_role' ORDER BY e.enumsortorder`)).map((r) => String(r.enumlabel));
  assert.deepEqual(labels.slice(-2), ["learner", "esterno_caso"]);
  const [row] = await q(`SELECT role::text AS role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2`, [ids.wsA, ids.e3]);
  assert.equal(row.role, "esterno_caso");
});

test("U1 sul database e B15: le porte per ruolo; E3 in A solo con allowCaseOnly, in B Contributore come oggi", opts, async () => {
  const { getCollaboratorAccess, getWorkspaceAccessForUser } = await import("../../workspace-access.ts");
  assert.equal(await getCollaboratorAccess(ids.e3, ids.wsA), null);
  assert.equal((await getCollaboratorAccess(ids.e3, ids.wsA, { allowCaseOnly: true }))?.role, "esterno_caso");
  assert.equal((await getCollaboratorAccess(ids.e3, ids.wsB))?.role, "contributor", "in B come oggi");
  assert.equal(await getCollaboratorAccess(ids.p, ids.wsA, { allowCaseOnly: true }), null, "chi segue un corso mai");
  assert.equal((await getCollaboratorAccess(ids.c, ids.wsA))?.role, "contributor");
  // Un membro dell'organizzazione con `esterno_caso` nel workspace: vale il ruolo dell'organizzazione.
  assert.equal((await getWorkspaceAccessForUser(ids.oe, ids.wsA))?.role, "contributor");
  // La CLI: A e B per E3 (in B è nel workspace ma in nessun caso: B non c'è).
  const ws = await cliAuth.cliCaseWorkspaceIds(exec, ids.e3);
  assert.ok(ws.has(ids.wsA.toLowerCase()));
  assert.ok(!ws.has(ids.wsB.toLowerCase()));
});

test("B5, B6: la riga non basta e «tutti» non vale; un membro dell'organizzazione mai; la 8.0c non cambia", opts, async () => {
  const builds = (person: Person, caseId: string) => builders.isExternalBuilderOfCase(exec, { caseId, userId: ids[person], lsDomains: [LS] });
  assert.equal(await builds("e3", ids.caseA1), true, "E3 costruisce A1");
  assert.equal(await builds("e3", ids.caseA2), false, "B5: la riga di A2 senza concessione");
  assert.equal(await builds("e3", ids.caseA3), false);
  assert.equal(await builds("e6", ids.caseA1), false, "B6: «tutti» non vale per «Solo questo use case»");
  assert.equal(await builds("oe", ids.caseA1), false, "un membro dell'organizzazione non è mai «Solo questo use case»");
  assert.equal(await builds("e", ids.caseA1), true, "la 8.0c: l'Analista con la concessione costruisce come prima");
  const { caseAccessPrecheck } = await import("../../db/queries/uc-access.ts");
  const pre = (person: Person, caseId: string, role: string) => caseAccessPrecheck({ workspaceId: ids.wsA, caseId, userId: ids[person], workspaceRole: role });
  assert.equal(await pre("e3", ids.caseA1, "esterno_caso"), true);
  assert.equal(await pre("e3", ids.caseA2, "esterno_caso"), false, "B5: 404 anche in lettura");
  assert.equal(await pre("e6", ids.caseA1, "esterno_caso"), false);
  assert.equal(await pre("p", ids.caseA1, "learner"), false);
  assert.equal(await pre("c", ids.caseA1, "inventato"), false, "un ruolo sconosciuto non apre il dossier");
  assert.deepEqual(await builders.builtUseCaseIds(exec, { workspaceId: ids.wsA, userId: ids.e3, lsDomains: [LS] }), [ids.ucA1.toLowerCase()]);
});

test("B4, B2: E3 costruisce A1 dalla CLI come chi costruisce da fuori; A2, B e un caso che non c'è rispondono uguale", opts, async () => {
  const context = await call(`context?caso=${CODE.A1}`, { token: tokens.e3 });
  assert.equal(context.status, 200, JSON.stringify(context.json));
  assert.deepEqual([(context.json.dati as Row).ruoli, (context.json.dati as Row).scrive], [["osservatore", "builder_esterno"], true]);
  const missing = await call("context?caso=XO-0099", { token: tokens.e3 });
  const outside = await call(`context?caso=${CODE.A2}`, { token: tokens.e3 });
  const noDossier = await call(`context?caso=${CODE.B1}`, { token: tokens.e3 });
  assert.deepEqual([missing.status, codeOf(missing)], [404, "non_trovato"]);
  assert.deepEqual([outside.status, codeOf(outside), (outside.json.errore as Row).messaggio], [404, "non_trovato", (missing.json.errore as Row).messaggio], "B5: come un caso che non esiste");
  assert.deepEqual([noDossier.status, codeOf(noDossier)], [404, "non_trovato"], "un caso di B con il token di A");
  // Le scritture su A1: l'impostazione, una decisione, una domanda, una sessione, il token del caso.
  assert.equal((await post("setup", tokens.e3!, { caso: CODE.A1, azione: "apri" })).status, 200);
  const decided = await post("decisioni", tokens.e3!, { caso: CODE.A1, argomento: "Lingua", decisione: "Le risposte in italiano", perche: "Le leggono i tecnici" });
  assert.equal(decided.status, 200, JSON.stringify(decided.json));
  assert.equal((await post("domande", tokens.e3!, { caso: CODE.A1, domanda: "Chi firma le quotazioni sopra soglia?" })).status, 200);
  const session = { caso: CODE.A1, chiaveSessione: "a".repeat(64), harness: "claude_code", modello: "claude-sonnet-4-5", tokenIngresso: 100, tokenUscita: 20, durataSecondi: 60, esito: "commit", finitaIl: new Date().toISOString() };
  assert.equal((await post("sessioni", tokens.e3!, session, null)).status, 200);
  assert.equal((await post("decisioni", tokens.e3!, { caso: CODE.A2, argomento: "Lingua", decisione: "No" })).status, 404, "su A2 niente");
  const created = await post("token-caso", tokens.e3!, { caso: CODE.A1 });
  assert.equal(created.status, 200, JSON.stringify(created.json));
  assert.equal((await post("token-caso", tokens.e3!, { caso: CODE.A2 })).status, 404);
  const scoped = String(created.json.token);
  const brief = await tool(scoped, "get_case_context", {});
  assert.equal(brief.isError, false, brief.text);
  assert.equal(((brief.data.dati as Row).scrive), true);
  const decision = await tool(scoped, "record_decision", { topic: "Formato", choice: "Le risposte in tabella", idempotencyKey: `mcp-${suffix}-1`, confirmedByUser: true });
  assert.equal(decision.isError, false, decision.text);
  // Le domande sulla memoria del cliente no (D7): i fatti del caso li legge con lo strato `contesto`.
  const asked = await post("contesto", tokens.e3!, { caso: CODE.A1, domanda: "Chi sono i clienti più grandi?" }, null);
  assert.deepEqual([asked.status, codeOf(asked)], [403, "solo_questo_caso"]);
  // whoami: il suo ruolo, niente di più.
  assert.equal((await call("whoami", { token: tokens.e3 })).status, 200);
});

test("B3: le 7 azioni di chi costruisce su A1 sì, su A2 «non trovato»; approvare, riaprire, AI Board e modifica mai, nemmeno su A1", opts, async () => {
  const opened = await as("e3", () => factoryActions.startProjectAction(ids.wsA, ids.caseA1));
  assert.equal(opened.ok, true, opened.ok ? "" : opened.message);
  assert.equal((await as("e3", () => factoryActions.addDecisionAction(ids.wsA, ids.caseA1, { topic: "Dati", choice: "Solo dati sintetici" }))).ok, true);
  const pkg = await as("e3", () => factoryActions.generatePackageAction(ids.wsA, ids.caseA1));
  assert.equal(pkg.ok, true, pkg.ok ? "" : pkg.message);
  const outside = await as("e3", () => factoryActions.startProjectAction(ids.wsA, ids.caseA2));
  assert.deepEqual([outside.ok, !outside.ok && outside.code], [false, "non_trovato"]);
  for (const [label, run] of [
    ["approva", () => factoryActions.approveProjectAction(ids.wsA, ids.caseA1, { revision: 1 })],
    ["riapri", () => factoryActions.reopenProjectAction(ids.wsA, ids.caseA1, { revision: 1 })],
    ["ok dell'AI Board", () => factoryActions.recordAiBoardOkAction(ids.wsA, ids.caseA1, { revision: 1, note: "Ok dato dal board il 20/11" })],
    ["modifica", () => factoryActions.requestProjectChangeAction(ids.wsA, ids.caseA1, { revision: 1, note: "Cambiate lo strumento" })],
  ] as const) {
    await assert.rejects(as("e3", run as () => Promise<unknown>), /Workspace non trovato o non accessibile/, label);
  }
  // Il pacchetto lo legge dalla CLI: CONTESTO.md, se c'è, con i soli fatti del suo caso.
  const read = await call(`pacchetto?caso=${CODE.A1}`, { token: tokens.e3 });
  assert.equal(read.status, 200, JSON.stringify(read.json));
});

test("B7: E3 mai tra i candidati del team di un altro caso, tra i referenti, «A chi»; nel team solo osservatore del suo caso", opts, async () => {
  const { loadMemberCandidates } = await import("../../db/queries/uc-shell.ts");
  const candidates = (await loadMemberCandidates(exec, { workspaceId: ids.wsA, lsDomains: [LS] })).map((c) => c.userId);
  assert.ok(!candidates.includes(ids.e3) && !candidates.includes(ids.e6) && !candidates.includes(ids.p));
  assert.ok(candidates.includes(ids.c) && candidates.includes(ids.e));
  const { workspaceMembersSql } = await import("../referent/people.ts");
  const [picker] = await exec.batch([workspaceMembersSql(ids.wsA, null, { learners: true })]);
  const pickable = picker.map((r) => String(r.user_id));
  assert.ok(!pickable.includes(ids.e3) && !pickable.includes(ids.e5), "il selettore dei referenti");
  assert.ok(pickable.includes(ids.p), "chi segue un corso sì, con l'opzione");
  // Il team del dossier: in A2 (senza concessione) no; in A1 un altro ruolo no.
  const ctx = await ctxFor("lead", ids.caseA3);
  const other = await ucCases.addCaseMember(exec, ctx, { userId: ids.e3, role: "osservatore" });
  assert.deepEqual([other.ok, !other.ok && other.code], [false, "non_collaboratore"]);
  const client = await ucCases.addCaseMember(exec, await ctxFor("lead", ids.caseA1), { userId: ids.e3, role: "ai_board" });
  assert.deepEqual([client.ok, !client.ok && client.code], [false, "solo_osservatore"]);
  // «Chi costruisce»: E3 c'è, e costruisce (nessun blocco); la sua concessione è per A1.
  const rows = await team.listBuilders(exec, ids.wsA, [LS]);
  const row = rows.find((r) => r.userId === ids.e3);
  assert.ok(row);
  assert.deepEqual([row.blocked, row.where.all], [null, false]);
  // «Aggiungi» (la 8.0c) non vale per «Solo questo use case».
  const added = await team.addExternalBuilder(exec, { workspaceId: ids.wsA, actorUserId: ids.lead, userId: ids.e3, where: "tutti", lsDomains: [LS] });
  assert.deepEqual([added.ok, !added.ok && added.code], [false, "solo_questo_use_case"]);
});

test("B8: il repository suo; nessun caso entra nel suo, il suo non entra in una famiglia, E3 non ne registra uno nuovo", opts, async () => {
  const own = `Prova/solo-${suffix}`;
  const family = `Prova/famiglia-${suffix}`;
  const repo = (person: Person, caso: string, repository: string) => post("repository", tokens[person]!, { caso, repository, cartella: `casi/${caso.toLowerCase()}`, profilo: "codice" });
  const fresh = await repo("e3", CODE.A1, own);
  assert.deepEqual([fresh.status, codeOf(fresh)], [403, "repo_non_del_cliente"], "un repository nuovo lo registra Lateral Space");
  assert.equal((await repo("lead", CODE.A1, own)).status, 200);
  const again = await repo("e3", CODE.A1, own);
  assert.equal(again.status, 200, JSON.stringify(again.json));
  const shared = await repo("lead", CODE.A3, own);
  assert.deepEqual([shared.status, codeOf(shared)], [409, "repo_condiviso"], "nessuno aggiunge un caso al suo repository");
  assert.equal((await repo("lead", CODE.A4, family)).status, 200);
  assert.equal((await repo("lead", CODE.A3, family)).status, 200);
  const intoFamily = await repo("lead", CODE.A1, family);
  assert.deepEqual([intoFamily.status, codeOf(intoFamily)], [409, "repo_condiviso"], "il suo caso non entra in un repository con altri casi");
  const [n] = await q(`SELECT count(*)::int AS n FROM use_case_repos WHERE lower(repo) = lower($1)`, [own]);
  assert.equal(n.n, 1);
});

test("U5: la campanella di E3: solo i tipi di chi costruisce dei suoi casi, anche con segnali e righe di altri casi", opts, async () => {
  await q(`INSERT INTO weekly_signals (workspace_id, signal_type, title) VALUES ($1::uuid, 'risk_alert', $2), ($1::uuid, 'new_portfolio_item', $2)`, [ids.wsA, `SEGNALE-${suffix}`]);
  for (const [uc, kind] of [
    [ids.ucA1, "pacchetto_nuovo"],
    [ids.ucA2, "pacchetto_nuovo"],
    [ids.ucA1, "progetto_appr"],
  ] as const) {
    await q(`INSERT INTO use_case_notifications (workspace_id, use_case_id, recipient_user_id, kind, rome_day) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, current_date)`, [ids.wsA, uc, ids.e3, kind]);
  }
  const { loadBellPayload } = await import("../../notifications/bell-data.ts");
  const payload = await loadBellPayload({ workspaceId: ids.wsA, userId: ids.e3, role: "esterno_caso", useCaseHub: true });
  const text = JSON.stringify(payload);
  assert.doesNotMatch(text, new RegExp(`SEGNALE-${suffix}`), "niente segnali del workspace");
  assert.ok(text.includes(CODE.A1), "la riga del suo caso");
  assert.doesNotMatch(text, new RegExp(CODE.A2), "niente righe degli altri casi");
  const contributor = await loadBellPayload({ workspaceId: ids.wsA, userId: ids.c, role: "contributor", useCaseHub: true });
  assert.match(JSON.stringify(contributor), new RegExp(`SEGNALE-${suffix}`), "il Contributore come prima");
  const unknown = await loadBellPayload({ workspaceId: ids.wsA, userId: ids.e3, role: "inventato", useCaseHub: true });
  assert.doesNotMatch(JSON.stringify(unknown), new RegExp(`SEGNALE-${suffix}|${CODE.A1}`), "un ruolo sconosciuto: niente");
});

test("D7: il contesto e il pacchetto di E3 hanno i fatti del suo caso, mai «In breve», regole e parole dell'azienda", opts, async () => {
  const fact = async (statement: string, section: string, linked: boolean) => {
    const id = randomUUID();
    await q(
      `INSERT INTO context_facts (id, workspace_id, section, statement, basis, visibility, status, origin) VALUES ($1::uuid, $2::uuid, $3, $4, 'detto', 'tutti', 'attivo', 'manuale')`,
      [id, ids.wsA, section, statement],
    );
    if (linked) await q(`INSERT INTO context_fact_links (workspace_id, fact_id, use_case_id) VALUES ($1::uuid, $2::uuid, $3::uuid)`, [ids.wsA, id, ids.ucA1]);
  };
  await fact("Il caso legge le quotazioni dal portale.", "sistemi", true);
  await fact("Nessun dato esce dall'Unione europea.", "regole", false);
  await fact("«Commessa» vuol dire ordine del cliente.", "parole", false);
  await q(`INSERT INTO context_briefs (workspace_id, lines, facts_hash) VALUES ($1::uuid, $2::jsonb, $3)`, [ids.wsA, JSON.stringify(["Cliente Demo fa logistica per l'industria."]), "0".repeat(64)]);
  const COMPANY = /Unione europea|Commessa|fa logistica/;

  const { loadAgentContext } = await import("../../db/queries/context-work.ts");
  const all = await loadAgentContext({ workspaceId: ids.wsA, useCaseId: ids.ucA1 });
  const mine = await loadAgentContext({ workspaceId: ids.wsA, useCaseId: ids.ucA1, caseOnly: true });
  assert.ok(all && mine);
  assert.match(JSON.stringify(all), COMPANY, "per chi non è «Solo questo use case» come prima");
  assert.deepEqual([mine.brief, mine.rules, mine.words], [[], [], []]);
  assert.deepEqual(mine.caseFacts.map((f) => f.statement), ["Il caso legge le quotazioni dal portale."]);
  // La CLI: lo strato `contesto` e la riga del brief.
  const layer = await call(`context?caso=${CODE.A1}&strato=contesto`, { token: tokens.e3 });
  assert.equal(layer.status, 200, JSON.stringify(layer.json));
  assert.match(String(layer.json.testo), /quotazioni dal portale/);
  assert.doesNotMatch(JSON.stringify(layer.json), COMPANY);
  assert.match(JSON.stringify((await call(`context?caso=${CODE.A1}&strato=contesto`, { token: tokens.lead })).json), COMPANY, "Lateral Space come prima");
  // Il pacchetto: generato da Lateral Space con tutto il contesto «Per tutti»; E3 lo legge con i soli fatti del caso.
  const pkg = await as("lead", () => factoryActions.generatePackageAction(ids.wsA, ids.caseA1));
  assert.equal(pkg.ok, true, pkg.ok ? "" : pkg.message);
  const forLead = await call(`pacchetto?caso=${CODE.A1}`, { token: tokens.lead });
  assert.match(String((forLead.json.file as Row)["CONTESTO.md"]), COMPANY);
  const forE3 = await call(`pacchetto?caso=${CODE.A1}`, { token: tokens.e3 });
  assert.equal(forE3.status, 200);
  assert.match(String((forE3.json.file as Row)["CONTESTO.md"]), /quotazioni dal portale/);
  assert.doesNotMatch(JSON.stringify(forE3.json), COMPANY);
  // L'MCP del caso: lo stesso strato.
  const scoped = String((await post("token-caso", tokens.e3!, { caso: CODE.A1 })).json.token);
  const viaMcp = await tool(scoped, "get_case_context", { layer: "contesto" });
  assert.equal(viaMcp.isError, false, viaMcp.text);
  assert.doesNotMatch(viaMcp.text, COMPANY);
});

test("«Da fare per te»: al responsabile «Aggiungi … al team», al manager «Togli …» quando il caso è chiuso", opts, async () => {
  let chores = await builders.caseOnlyChores(exec, { workspaceId: ids.wsA, viewerUserId: ids.lead, lsManager: true });
  assert.deepEqual(chores.add.map((c) => [c.userId, c.code]), [[ids.e5, CODE.A2]], "E5 ha la concessione per A2 e non la riga");
  assert.ok(!chores.remove.some((c) => c.userId === ids.e3), "A1 è aperto");
  await q(`UPDATE uc_cases SET status = 'chiuso' WHERE id = $1`, [ids.caseA4]);
  await q(`INSERT INTO use_case_external_builders (workspace_id, user_id, use_case_id, added_by_user_id) VALUES ($1, $2, $3, $4)`, [ids.wsA, ids.e5, ids.ucA4, ids.lead]);
  chores = await builders.caseOnlyChores(exec, { workspaceId: ids.wsA, viewerUserId: ids.lead, lsManager: true });
  assert.ok(chores.remove.some((c) => c.userId === ids.e5 && c.code === CODE.A4), "XO4 è chiuso");
  const notManager = await builders.caseOnlyChores(exec, { workspaceId: ids.wsA, viewerUserId: ids.lead, lsManager: false });
  assert.equal(notManager.remove.length, 0, "«Togli» solo al manager");
  await q(`UPDATE uc_cases SET status = 'pronto_sviluppo' WHERE id = $1`, [ids.caseA4]);
  await q(`DELETE FROM use_case_external_builders WHERE user_id = $1 AND use_case_id = $2`, [ids.e5, ids.ucA4]);
});

/** Un invito di prova, con il token in memoria (mai nel database: solo l'impronta). */
async function invite(role: string, email: string | null, useCaseId: string | null, patch: { expired?: boolean; revoked?: boolean } = {}): Promise<string> {
  const { createInviteToken, hashInviteToken } = await import("../../workspace-invite-token.ts");
  const token = createInviteToken();
  const [row] = await q(
    `INSERT INTO workspace_invitations (workspace_id, organization_id, email, role, token_hash, max_uses, expires_at, revoked_at, created_by_user_id)
     VALUES ($1, $2, $3, $4::member_role, $5, 1, now() + ($6 || ' days')::interval, $7, $8) RETURNING id`,
    [ids.wsA, ids.orgA, email, role, hashInviteToken(token), patch.expired ? "-1" : "7", patch.revoked ? new Date() : null, ids.lead],
  );
  if (useCaseId) await q(`INSERT INTO use_case_builder_invites (invitation_id, workspace_id, use_case_id) VALUES ($1, $2, $3)`, [row.id, ids.wsA, useCaseId]);
  const [stored] = await q(`SELECT count(*)::int AS n FROM workspace_invitations WHERE token_hash = $1`, [token]);
  assert.equal(stored.n, 0, "B14: il token non è mai nel database");
  return token;
}

test("B10, B13: l'accettazione «Solo questo use case»: membership e concessione insieme o niente; i rifiuti; la riga una volta", opts, async () => {
  const { acceptWorkspaceInvitation } = await import("../../db/queries/workspace-collaboration.ts");
  const accept = (token: string, person: Person, email = EMAIL[person], emailVerified = true) => acceptWorkspaceInvitation({ token, userId: ids[person], userEmail: email, emailVerified });
  const membership = async (person: Person) => (await q(`SELECT role::text AS role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2`, [ids.wsA, ids[person]]))[0]?.role ?? null;
  const grants = async (person: Person) => (await q(`SELECT use_case_id FROM use_case_external_builders WHERE workspace_id = $1 AND user_id = $2`, [ids.wsA, ids[person]])).map((r) => String(r.use_case_id));

  // Le prove che non scrivono niente.
  assert.deepEqual(await accept(await invite("esterno_caso", EMAIL.e4, ids.ucA2), "e4", `altro-${suffix}@altra.test`), { ok: false, reason: "email_mismatch" });
  assert.deepEqual(await accept(await invite("esterno_caso", EMAIL.e4, ids.ucA2), "e4", EMAIL.e4, false), { ok: false, reason: "email_unverified" });
  assert.deepEqual(await accept(await invite("esterno_caso", EMAIL.e4, ids.ucA2, { expired: true }), "e4"), { ok: false, reason: "expired" });
  assert.deepEqual(await accept(await invite("esterno_caso", EMAIL.e4, ids.ucA2, { revoked: true }), "e4"), { ok: false, reason: "revoked" });
  assert.deepEqual(await accept(await invite("esterno_caso", null, ids.ucA2), "e4"), { ok: false, reason: "case_only_email" });
  assert.deepEqual(await accept(await invite("esterno_caso", EMAIL.p, ids.ucA2), "p"), { ok: false, reason: "learner_case_only" });
  const forCollaborator = await accept(await invite("esterno_caso", EMAIL.c, ids.ucA2), "c");
  assert.deepEqual(forCollaborator, { ok: true, workspaceId: ids.wsA, outcome: "already_member", role: "contributor" });
  // Lo use case cancellato porta via il suo caso: «non c'è più», niente membership.
  await q(`INSERT INTO use_cases (id, workspace_id, title, code) VALUES ($1, $2, 'Da cancellare', 'XO-0098')`, [randomUUID(), ids.wsA]);
  const [gone] = await q(`SELECT id FROM use_cases WHERE code = 'XO-0098' AND workspace_id = $1`, [ids.wsA]);
  const goneToken = await invite("esterno_caso", EMAIL.e4, String(gone.id));
  await q(`DELETE FROM use_cases WHERE id = $1`, [gone.id]);
  assert.deepEqual(await accept(goneToken, "e4"), { ok: false, reason: "caso_assente" });
  assert.equal(await membership("e4"), null);
  assert.deepEqual(await grants("e4"), []);

  // L'invito giusto: la membership `esterno_caso` e la concessione per A2, insieme.
  const token = await invite("esterno_caso", EMAIL.e4, ids.ucA2);
  const accepted = await accept(token, "e4");
  assert.deepEqual(accepted, { ok: true, workspaceId: ids.wsA, outcome: "joined", role: "esterno_caso", caseOnlyUseCaseId: ids.ucA2 });
  assert.equal(await membership("e4"), "esterno_caso");
  assert.deepEqual(await grants("e4"), [ids.ucA2]);
  // Doppio clic: il link è già usato, niente di più.
  assert.deepEqual(await accept(token, "e4"), { ok: false, reason: "used" });
  assert.deepEqual(await grants("e4"), [ids.ucA2]);
  // La riga `osservatore`, con chi ha invitato (il responsabile) come attore: una volta sola, anche ripetendo.
  assert.equal(await team.joinCaseOnlyDossier(exec, { workspaceId: ids.wsA, userId: ids.e4, useCaseId: ids.ucA2, lsDomains: [LS] }), "aggiunto");
  assert.equal(await team.joinCaseOnlyDossier(exec, { workspaceId: ids.wsA, userId: ids.e4, useCaseId: ids.ucA2, lsDomains: [LS] }), "gia_dentro");
  const [rows] = await q(`SELECT count(*)::int AS n FROM uc_case_members WHERE case_id = $1 AND user_id = $2`, [ids.caseA2, ids.e4]);
  assert.equal(rows.n, 1);
  assert.equal(await builders.isExternalBuilderOfCase(exec, { caseId: ids.caseA2, userId: ids.e4, lsDomains: [LS] }), true, "costruisce A2");
});

test("B11: E3 accetta un invito da Analista e sale; la concessione vale con le regole della 8.0c", opts, async () => {
  const { acceptWorkspaceInvitation } = await import("../../db/queries/workspace-collaboration.ts");
  const token = await invite("analyst", EMAIL.e6, null);
  const result = await acceptWorkspaceInvitation({ token, userId: ids.e6, userEmail: EMAIL.e6, emailVerified: true });
  assert.deepEqual(result, { ok: true, workspaceId: ids.wsA, outcome: "upgraded", role: "analyst" });
  // La concessione «tutti» scritta a mano adesso vale (Analista, la 8.0c): costruisce A1, dove ha la riga.
  assert.equal(await builders.isExternalBuilderOfCase(exec, { caseId: ids.caseA1, userId: ids.e6, lsDomains: [LS] }), true);
});

test("B9: le uscite. La riga tolta dal team: esce dal caso e, senza altri casi, dal workspace; «Togli» pure; lo stesso token non scrive", opts, async () => {
  const membership = async (person: Person) => (await q(`SELECT role::text AS role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2`, [ids.wsA, ids[person]]))[0]?.role ?? null;
  // E3: il responsabile toglie la sua riga da A1, il suo unico caso.
  const removed = await team.removeCaseMemberReleasingTasks(exec, await ctxFor("lead", ids.caseA1), { userId: ids.e3, role: "osservatore" });
  assert.equal(removed.ok, true, removed.ok ? "" : removed.message);
  assert.equal(await membership("e3"), null, "fuori dal workspace");
  assert.deepEqual(await q(`SELECT 1 FROM use_case_external_builders WHERE user_id = $1 AND workspace_id = $2`, [ids.e3, ids.wsA]), []);
  const [live] = await q(`SELECT count(*)::int AS n FROM workspace_integration_tokens WHERE owner_user_id = $1 AND workspace_id = $2 AND revoked_at IS NULL`, [ids.e3, ids.wsA]);
  assert.equal(live.n, 0, "i token revocati");
  const after = await post("decisioni", tokens.e3!, { caso: CODE.A1, argomento: "Lingua", decisione: "Ancora?" });
  assert.ok([401, 403, 404].includes(after.status), `stesso token: ${after.status}`);
  // In B resta Contributore, come prima.
  assert.equal((await q(`SELECT role::text AS role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2`, [ids.wsB, ids.e3]))[0]?.role, "contributor");
  // E4 (dall'invito): «Togli» in «Chi costruisce» toglie anche la membership.
  const out = await team.removeExternalBuilder(exec, { workspaceId: ids.wsA, actorUserId: ids.lead, userId: ids.e4, lsDomains: [LS] });
  assert.equal(out.ok, true, out.ok ? "" : out.message);
  assert.equal(await membership("e4"), null);
  assert.deepEqual(out.ok && out.value.left, [CODE.A2]);
  // Chi costruisce da fuori nella 8.0c, con la riga tolta, resta nel workspace con la sua concessione.
  const keep = await team.removeCaseMemberReleasingTasks(exec, await ctxFor("lead", ids.caseA1), { userId: ids.e, role: "osservatore" });
  assert.equal(keep.ok, true);
  assert.equal(await membership("e"), "analyst");
  assert.equal((await q(`SELECT count(*)::int AS n FROM use_case_external_builders WHERE user_id = $1`, [ids.e]))[0].n, 1);
});
