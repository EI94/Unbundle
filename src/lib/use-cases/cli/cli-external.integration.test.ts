import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import * as nodeModule from "node:module";
/** `module.registerHooks` di Node 24 (i tipi di @types/node del progetto non lo hanno ancora). */
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?(specifier: string, context: object, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult }): void;
};

// Chi costruisce da fuori Lateral Space (rilascio 8.0c, RILASCIO-8.0c-ESTERNI.md §9) sulle porte vere: le rotte della
// CLI, l'MCP del caso e le azioni della pagina, sul database del pacchetto.
// - D2: E non vede niente del workspace B. D3: fuori dal «Dove» E2 legge e non scrive; senza riga, non trovato.
// - D4: E costruisce davvero (CLI, MCP del caso, pagina). D5: mai per E approvare, riaprire, l'ok dell'AI Board, la
//   modifica, i compiti degli altri, i comandi del dossier, «Avvia la realizzazione», «Chi costruisce».
// - D6: le azioni di chi costruisce sono rifiutate a chi gestisce il workspace senza riga e a un osservatore senza
//   concessione.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su 127.0.0.1). Dati
//   sintetici, creati e cancellati qui. I token non si stampano mai.
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
let auth: typeof import("../../db/queries/use-case-cli-auth.ts");
let factoryActions: typeof import("../../actions/use-case-factory.ts");
const routes: Record<string, { GET?: Handler; POST?: Handler }> = {};

const suffix = randomBytes(3).toString("hex");
const SUFFIX = suffix.toUpperCase();
/**
 * Workspace A come Nardi, B come TopJet.
 * - lead: Lateral Space, responsabile dei casi di A e di B;
 * - e: esterno, Analista in A, gmail verificato, «in tutti i casi»: costruisce A1, A2, A3;
 * - e2: esterno, Responsabile della trasformazione in A, «solo in alcuni casi»: A2. In A1 osservatore dato a mano; gestisce
 *   il workspace, quindi negli altri casi è osservatore anche senza riga;
 * - e3: esterno, Analista in A, «solo in alcuni casi»: A2, con la sola riga di A2;
 * - p: Analista in A senza concessione, osservatore in A1; m: gestisce A (Responsabile della trasformazione), senza riga;
 * - b: esterno di B, Analista in B, costruisce B1. In A non c'è.
 */
const people = ["lead", "e", "e2", "e3", "p", "m", "b"] as const;
type Person = (typeof people)[number];
const ids = {
  org: randomUUID(),
  orgB: randomUUID(),
  wsA: randomUUID(),
  wsB: randomUUID(),
  template: randomUUID(),
  ucA1: randomUUID(),
  ucA2: randomUUID(),
  ucA3: randomUUID(),
  ucB1: randomUUID(),
  caseA1: randomUUID(),
  caseA2: randomUUID(),
  caseA3: randomUUID(),
  caseB1: randomUUID(),
  ...(Object.fromEntries(people.map((p) => [p, randomUUID()])) as Record<Person, string>),
};
const EMAIL: Record<Person, string> = {
  lead: `lead-${suffix}@ls.test`,
  e: `alessio-${suffix}@gmail.test`,
  e2: `e2-${suffix}@gmail.test`,
  e3: `e3-${suffix}@gmail.test`,
  p: `p-${suffix}@cliente.test`,
  m: `m-${suffix}@cliente.test`,
  b: `b-${suffix}@topjet.test`,
};
const NAME: Record<Person, string> = { lead: "Lucia Guida", e: "Ettore Esterno", e2: "Elena Seconda", e3: "Enzo Terzo", p: "Paolo Analisi", m: "Marta Gestione", b: "Bruno Altrove" };
const tokens: Partial<Record<Person, string>> = {};
let keySeq = 0;
const key = () => `ext-${suffix}-${++keySeq}`;

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
  const started = await auth.startCliLogin(exec, { clientLabel: `CLI di prova esterni ${suffix}` });
  const decided = await auth.decideCliLogin(exec, { userCode: started.userCode, userId: ids[person], workspaceId, confirm: true });
  assert.ok(decided.ok, decided.ok ? "" : decided.message);
  const delivered = await auth.deliverCliLogin(exec, started.deviceCode);
  assert.equal(delivered.status, "consegnato");
  return (delivered as { token: string }).token;
}

let rpcSeq = 0;
async function tool(token: string, name: string, args: Row): Promise<{ isError: boolean; data: Row; text: string }> {
  const handler = routes.mcp.POST!;
  const response = await handler(
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

/** L'esito di un'azione, quale che sia il suo dato: per le tabelle di azioni da provare insieme. */
type AnyResult = { ok: true } | { ok: false; code: string; message: string };

const sessionOf = (person: Person) => ({ user: { id: ids[person], email: EMAIL[person], emailVerified: true, name: NAME[person], image: null } });
function as<T>(person: Person, run: () => Promise<T>): Promise<T> {
  (globalThis as { __cliSession?: unknown }).__cliSession = sessionOf(person);
  return run().finally(() => {
    delete (globalThis as { __cliSession?: unknown }).__cliSession;
  });
}

before(async () => {
  if (!enabled) return;
  const stub = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
  const stubs: Record<string, string> = {
    "next/cache": stub("export function revalidatePath() {}\nexport function revalidateTag() {}\nexport function unstable_cache(fn) { return fn; }\nexport function unstable_noStore() {}"),
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
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  process.env.USE_CASE_HUB_WORKSPACES = `${ids.wsA},${ids.wsB}`;
  delete process.env.VERCEL_ENV;

  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Row[]>;
  await (await import("../../db/ensure-schema.ts")).ensureDbSchema();
  exec = (await import("../../db/uc-executor.ts")).ucExecutorForUrl(url!);
  auth = await import("../../db/queries/use-case-cli-auth.ts");
  factoryActions = await import("../../actions/use-case-factory.ts");
  for (const name of ["context", "setup", "pacchetto", "decisioni", "domande", "repository", "sessioni", "token-caso", "mcp", "compiti", "evals"]) {
    routes[name] = await import(`../../../app/api/cli/${name}/route.ts`);
  }

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione A di prova esterni', $2), ($3, 'Organizzazione B di prova esterni', $4)`, [ids.org, `org-ext-a-${suffix}`, ids.orgB, `org-ext-b-${suffix}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Cliente A di prova'), ($3, $4, 'Cliente B di prova')`, [ids.wsA, ids.org, ids.wsB, ids.orgB]);
  const wsRole: Record<Person, string> = { lead: "transformation_lead", e: "analyst", e2: "transformation_lead", e3: "analyst", p: "analyst", m: "transformation_lead", b: "analyst" };
  for (const person of people) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, $3, now())`, [ids[person], EMAIL[person], NAME[person]]);
    if (person !== "b") await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ids.wsA, ids[person], wsRole[person]]);
  }
  await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'transformation_lead'::member_role), ($1::uuid, $3::uuid, 'analyst'::member_role)`, [ids.wsB, ids.lead, ids.b]);
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, code) VALUES ($1, $5, 'Esploso di prova', 'NM-0001'), ($2, $5, 'Ricambi di prova', 'NM-0002'), ($3, $5, 'Tempi di prova', 'NM-0003'), ($4, $6, 'Quotazioni di prova', 'TB-0001')`,
    [ids.ucA1, ids.ucA2, ids.ucA3, ids.ucB1, ids.wsA, ids.wsB],
  );
  await q(
    `INSERT INTO uc_templates (id, key, version, name, archetype, definition, definition_hash)
     VALUES ($1::uuid, $2, '1.0.0', 'Template di prova esterni', 'prova', '{"confidential": false}'::jsonb, $3)`,
    [ids.template, `prova.ext_${suffix}`, randomBytes(32).toString("hex")],
  );
  const dossiers: [string, string, string, string, string][] = [
    [ids.caseA1, ids.wsA, ids.org, ids.ucA1, `XA1-${SUFFIX}`],
    [ids.caseA2, ids.wsA, ids.org, ids.ucA2, `XA2-${SUFFIX}`],
    [ids.caseA3, ids.wsA, ids.org, ids.ucA3, `XA3-${SUFFIX}`],
    [ids.caseB1, ids.wsB, ids.orgB, ids.ucB1, `XB1-${SUFFIX}`],
  ];
  for (const [caseId, ws, org, uc, code] of dossiers) {
    await q(
      `INSERT INTO uc_cases (id, workspace_id, organization_id, portfolio_use_case_id, template_id, template_version, code, title, status, setup_completed_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, '1.0.0', $6, 'Dossier di prova esterni', 'pronto_sviluppo', now())`,
      [caseId, ws, org, uc, ids.template, code],
    );
    await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, 'ls_lead')`, [caseId, ids.lead]);
  }
  const member = (caseId: string, person: Person, role = "osservatore") => q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, $3)`, [caseId, ids[person], role]);
  for (const caseId of [ids.caseA1, ids.caseA2, ids.caseA3]) await member(caseId, "e");
  await member(ids.caseA1, "e2");
  await member(ids.caseA2, "e2");
  await member(ids.caseA2, "e3");
  await member(ids.caseA1, "p");
  const grant = (person: Person, useCaseId: string | null) =>
    q(`INSERT INTO use_case_external_builders (workspace_id, user_id, use_case_id, added_by_user_id) VALUES ($1, $2, $3, $4)`, [ids.wsA, ids[person], useCaseId, ids.lead]);
  await grant("e", null);
  await grant("e2", ids.ucA2);
  await grant("e3", ids.ucA2);
  await member(ids.caseB1, "b");
  await q(`INSERT INTO use_case_external_builders (workspace_id, user_id, added_by_user_id) VALUES ($1, $2, $3)`, [ids.wsB, ids.b, ids.lead]);
  // M (gestisce A, nessun caso) non collega la CLI: in A non costruisce niente.
  for (const person of ["lead", "e", "e2", "e3", "p"] as const) tokens[person] = await tokenFor(person);
});

after(async () => {
  if (!enabled) return;
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.wsA, ids.wsB]]);
  await q(`DELETE FROM uc_templates WHERE id = $1`, [ids.template]);
  await q(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [[ids.org, ids.orgB]]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [people.map((p) => ids[p])]);
});

/** Le 10 scelte dell'impostazione di un caso, con la CLI, e l'invio in approvazione. */
async function setUp(token: string, code: string): Promise<{ status: number; json: Row }> {
  assert.equal((await post("setup", token, { caso: code, azione: "apri" })).status, 200);
  const guide = await call(`setup?caso=${code}`, { token });
  assert.equal(guide.status, 200);
  for (const topic of guide.json.argomenti as Row[]) {
    const saved = await post("setup", token, { caso: code, azione: "scelta", argomento: topic.chiave, scelta: `Scelta per ${String(topic.chiave)}`, perche: "Il consiglio della guida" });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
  }
  assert.equal((await post("setup", token, { caso: code, azione: "dettagli", strumentiNuovi: [], ore: 30, euroAlMese: 15 })).status, 200);
  const revision = ((await call(`setup?caso=${code}`, { token })).json.progetto as Row).revisione;
  return post("setup", token, { caso: code, azione: "invia", revisione: revision });
}

test("D4: E costruisce dalla CLI: il contesto dice builder_esterno e scrive; impostazione, decisioni, domande, repository, sessioni, evals", opts, async () => {
  const context = await call("context?caso=NM-0001", { token: tokens.e });
  assert.equal(context.status, 200);
  assert.deepEqual((context.json.dati as Row).ruoli, ["osservatore", "builder_esterno"]);
  assert.equal((context.json.dati as Row).scrive, true);
  // Leo non cambia: i ruoli di oggi, e scrive.
  const lead = await call("context?caso=NM-0001", { token: tokens.lead });
  assert.deepEqual([(lead.json.dati as Row).ruoli, (lead.json.dati as Row).scrive], [["ls_lead"], true]);

  assert.equal((await call("pacchetto?caso=NM-0001", { token: tokens.e })).status, 404, "la guida e il pacchetto: E li legge (nessun pacchetto ancora)");
  assert.equal(codeOf(await call("pacchetto?caso=NM-0001", { token: tokens.e })), "senza_pacchetto");
  const sent = await setUp(tokens.e!, "NM-0001");
  assert.equal(sent.status, 200, JSON.stringify(sent.json));
  const [project] = await q(`SELECT status FROM use_case_projects WHERE use_case_id = $1`, [ids.ucA1]);
  assert.equal(project.status, "da_approvare");

  const decided = await post("decisioni", tokens.e!, { caso: "NM-0001", argomento: "Lingua", decisione: "Le risposte in italiano", perche: "I tecnici leggono l'italiano" });
  assert.equal(decided.status, 200, JSON.stringify(decided.json));
  assert.equal((await post("domande", tokens.e!, { caso: "NM-0001", domanda: "Chi aggiorna l'esploso dei ricambi?" })).status, 200);
  // La famiglia la crea e la registra Lateral Space; chi costruisce da fuori ci aggiunge i suoi casi.
  const family = `Prova/nardi-esploso-${suffix}`;
  assert.equal((await post("repository", tokens.lead!, { caso: "NM-0002", repository: family, cartella: "casi/nm-0002", profilo: "codice" })).status, 200);
  const repo = await post("repository", tokens.e!, { caso: "NM-0001", repository: family, cartella: "casi/nm-0001", profilo: "codice" });
  assert.equal(repo.status, 200, JSON.stringify(repo.json));
  const session = { caso: "NM-0001", chiaveSessione: "e".repeat(64), harness: "claude_code", modello: "claude-sonnet-4-5", tokenIngresso: 1000, tokenUscita: 200, durataSecondi: 600, esito: "commit", finitaIl: new Date().toISOString() };
  assert.equal((await post("sessioni", tokens.e!, session, null)).status, 200);
  const sonnet = "anthropic/claude-sonnet-5-5";
  const evals = await post("evals", tokens.e!, {
    caso: "NM-0001",
    tipo: "evals",
    livello: "pull_request",
    ramo: "main",
    commit: "a1b2c3d4",
    versioneModello: "1.5.0",
    modelliFinti: true,
    inCostruzione: true,
    modelli: { lettura: sonnet },
    risultati: [{ modello: sonnet, attuale: true, superati: 9, totali: 10, soglieRispettate: true, gruppi: { regole: { passati: 9, totali: 10, soglia: 0.9, ok: true } }, errori: 0 }],
  });
  assert.equal(evals.status, 200, JSON.stringify(evals.json));
});

test("D4: E crea il token del caso e scrive dall'MCP del caso: decisione, domanda, sessione", opts, async () => {
  const created = await post("token-caso", tokens.e!, { caso: "NM-0001" });
  assert.equal(created.status, 200, JSON.stringify(created.json));
  const scoped = String(created.json.token);
  const brief = await tool(scoped, "get_case_context", {});
  assert.equal(brief.isError, false);
  assert.deepEqual([(brief.data.dati as Row).ruoli, (brief.data.dati as Row).scrive], [["osservatore", "builder_esterno"], true]);
  const decision = await tool(scoped, "record_decision", { topic: "Formato", choice: "Le risposte in tabella", idempotencyKey: `mcp-${suffix}-e1`, confirmedByUser: true });
  assert.equal(decision.isError, false, decision.text);
  const question = await tool(scoped, "propose_question", { question: "Quali codici ricambio sono obsoleti?", idempotencyKey: `mcp-${suffix}-e2` });
  assert.equal(question.isError, false, question.text);
  const report = await tool(scoped, "report_session", { sessionId: `sessione-${suffix}-e`, harness: "codex", durationSeconds: 300, outcome: "commit", endedAt: new Date().toISOString() });
  assert.equal(report.isError, false, report.text);
});

test("D5: E non approva, non riapre, non dà l'ok dell'AI Board né chiede modifiche; il responsabile approva come prima", opts, async () => {
  const [project] = await q(`SELECT revision FROM use_case_projects WHERE use_case_id = $1 AND status = 'da_approvare'`, [ids.ucA1]);
  const denied: [string, () => Promise<AnyResult>][] = [
    ["approva", () => factoryActions.approveProjectAction(ids.wsA, ids.caseA1, { revision: project.revision })],
    ["riapri", () => factoryActions.reopenProjectAction(ids.wsA, ids.caseA1, { revision: project.revision })],
    ["ok dell'AI Board", () => factoryActions.recordAiBoardOkAction(ids.wsA, ids.caseA1, { revision: project.revision, note: "Ok dato dal board il 15/11" })],
    ["modifica", () => factoryActions.requestProjectChangeAction(ids.wsA, ids.caseA1, { revision: project.revision, note: "Cambiate lo strumento" })],
  ];
  for (const [label, run] of denied) {
    const r = await as("e", run);
    assert.deepEqual([r.ok, !r.ok && r.code], [false, "non_trovato"], label);
  }
  const approved = await as("lead", () => factoryActions.approveProjectAction(ids.wsA, ids.caseA1, { revision: project.revision }));
  assert.equal(approved.ok, true, approved.ok ? "" : approved.message);
});

test("D4: E costruisce dalla pagina: pacchetto, apri, scelte, «Manda in approvazione», decisione, proposta di compito", opts, async () => {
  const pkg = await as("e", () => factoryActions.generatePackageAction(ids.wsA, ids.caseA2));
  assert.equal(pkg.ok, true, pkg.ok ? "" : pkg.message);
  assert.equal(((await call("pacchetto?caso=NM-0002", { token: tokens.e })).json.versione as number) >= 1, true, "E legge il pacchetto dalla CLI");
  assert.equal((await as("e", () => factoryActions.startProjectAction(ids.wsA, ids.caseA2))).ok, true);
  const { SETUP_TOPICS } = await import("../../db/use-case-hub-factory-ddl.ts");
  for (const topic of SETUP_TOPICS) {
    const saved = await as("e", () => factoryActions.saveProjectTopicAction(ids.wsA, ids.caseA2, { topic, scelta: `Dalla pagina: ${topic}` }));
    assert.equal(saved.ok, true, saved.ok ? "" : saved.message);
  }
  assert.equal((await as("e", () => factoryActions.saveProjectDetailsAction(ids.wsA, ids.caseA2, { estimateHours: 12 }))).ok, true);
  const [open] = await q(`SELECT revision FROM use_case_projects WHERE use_case_id = $1 AND status = 'in_corso'`, [ids.ucA2]);
  const submitted = await as("e", () => factoryActions.submitProjectAction(ids.wsA, ids.caseA2, { revision: open.revision }));
  assert.equal(submitted.ok, true, submitted.ok ? "" : submitted.message);
  assert.equal((await as("e", () => factoryActions.addDecisionAction(ids.wsA, ids.caseA2, { topic: "Dati", choice: "Solo dati sintetici" }))).ok, true);
  // Una proposta di compito da GitHub: E la scarta (accettarla vuole il progetto approvato).
  const [proposal] = await q(
    `INSERT INTO use_case_task_proposals (use_case_id, workspace_id, source, external_key, title) VALUES ($1, $2, 'github', $3, 'Leggere il catalogo ricambi') RETURNING id`,
    [ids.ucA1, ids.wsA, `issue-${suffix}-1`],
  );
  const decided = await as("e", () => factoryActions.decideTaskProposalAction(ids.wsA, ids.caseA1, String(proposal.id), "accetta"));
  assert.equal(decided.ok, true, decided.ok ? "" : decided.message);
});

test("D4: E prende i compiti, li lascia, li chiede, ne crea, li segna e li importa; i compiti degli altri no (D5)", opts, async () => {
  const act = (person: Person, azione: string, extra: Record<string, unknown>) => post("compiti", tokens[person]!, { caso: "NM-0001", azione, ...extra });
  const file = ["# NM-0001 · Compiti", "", "- [ ] T-2 Lettura dell'esploso · 8 h · aree: casi/nm-0001/src/esploso.ts", "- [ ] T-3 Ricerca del ricambio · 6 h · aree: casi/nm-0001/src/ricerca.ts"].join("\n");
  const imported = await post("compiti", tokens.e!, { caso: "NM-0001", azione: "importa", testo: file, cartella: "casi/nm-0001" });
  assert.equal(imported.status, 200, JSON.stringify(imported.json));
  const taken = await act("e", "prendi", { compito: "T-2" });
  assert.equal(taken.status, 200, JSON.stringify(taken.json));
  assert.equal((await act("e", "lascia", { compito: "T-2", nota: "Fatto: la lettura. Da fare: i casi limite. Dubbi: nessuno." })).status, 200);
  assert.equal((await act("lead", "prendi", { compito: "T-3" })).status, 200);
  assert.equal((await act("e", "chiedi", { compito: "T-3" })).status, 200);
  // I compiti degli altri: lasciare o segnare quello del responsabile no.
  assert.deepEqual(await act("e", "lascia", { compito: "T-3", nota: "Lo lascio io" }).then((r) => [r.status, codeOf(r)]), [403, "permesso_negato"]);
  assert.deepEqual(await act("e", "segna", { compito: "T-3", stato: "fatto" }).then((r) => [r.status, codeOf(r)]), [403, "permesso_negato"]);
  const created = await act("e", "nuovo", { titolo: "Casi d'oro dei ricambi", aree: ["casi/nm-0001/evals/"], ore: 3 });
  assert.equal(created.status, 200, JSON.stringify(created.json));
  assert.equal((await act("e", "segna", { compito: String(created.json.ref), stato: "annullato" })).status, 200);
});

test("D5: mai per E i comandi del dossier, le Impostazioni del dossier, il token dell'MCP dei dossier, «Avvia la realizzazione», «Chi costruisce»", opts, async () => {
  const ucActions = await import("../../actions/uc-cases.ts");
  const integrations = await import("../../actions/uc-integrations.ts");
  const realization = await import("../../actions/uc-realization.ts");
  const team = await import("../../actions/use-case-workspace-team.ts");
  const member = await as("e", () => ucActions.addMemberAction(ids.wsA, ids.caseA1, { userId: ids.p, role: "osservatore" }));
  assert.equal(member.ok, false, "i membri del dossier li gestisce il responsabile");
  const settings = await as("e", () => ucActions.updateCaseSettingsAction(ids.wsA, ids.caseA1, { title: "Cambiato da fuori" }));
  assert.equal(settings.ok, false);
  const readToken = await as("e", () => integrations.createCaseReadTokenAction(ids.wsA, ids.caseA1, { scopes: ["catalogo"] }));
  assert.equal(readToken.ok, false, "il token dell'MCP dei dossier no");
  const started = await as("e", () => realization.startRealizationAction(ids.wsA, { useCaseId: ids.ucA3 }));
  assert.equal(started.ok, false, "«Avvia la realizzazione» no");
  const added = await as("e", () => team.addBuilderAction(ids.wsA, { userId: ids.p, role: "builder_esterno", where: "tutti" }));
  assert.deepEqual([added.ok, !added.ok && added.code], [false, "permesso_negato"], "«Chi costruisce» no");
  // Impostazioni del dossier: la pagina vuole il responsabile, per E «non trovato» (404).
  const { assertCaseRole } = await import("../../db/queries/uc-access.ts");
  const { UC_SHELL_PAGE_ROLES } = await import("../../uc/views/case-shell.ts");
  await assert.rejects(assertCaseRole({ workspaceId: ids.wsA, caseId: ids.caseA1, userId: ids.e, workspaceRole: "analyst", allow: UC_SHELL_PAGE_ROLES.impostazioni }), /non trovato/i);
});

test("D2: il workspace B non esiste per E: le rotte con il token di A rispondono 404, le azioni su B si fermano", opts, async () => {
  for (const path of ["context?caso=TB-0001", "compiti?caso=TB-0001", `context?caso=${ids.ucB1}`]) {
    assert.deepEqual(await call(path, { token: tokens.e }).then((r) => [r.status, codeOf(r)]), [404, "non_trovato"], path);
  }
  assert.equal((await post("setup", tokens.e!, { caso: "TB-0001", azione: "apri" })).status, 404);
  assert.equal((await post("decisioni", tokens.e!, { caso: "TB-0001", argomento: "Prova", decisione: "Non dovrebbe passare" })).status, 404);
  // Il dossier di B passato a un'azione di A: non trovato. Un'azione su B: E non ha accesso al workspace.
  const crossed = await as("e", () => factoryActions.startProjectAction(ids.wsA, ids.caseB1));
  assert.deepEqual([crossed.ok, !crossed.ok && crossed.code], [false, "non_trovato"]);
  await assert.rejects(as("e", () => factoryActions.startProjectAction(ids.wsB, ids.caseB1)), /Workspace non trovato/);
});

test("D2: la concessione «tutti» di B nel workspace B non lo fa costruire nel workspace A, anche da Analista e osservatore in A", opts, async () => {
  const builders = await import("../../db/queries/use-case-builders.ts");
  const { toStatement, ucSql, cast } = await import("../../uc/sql/statement.ts");
  await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'analyst'::member_role)`, [ids.wsA, ids.b]);
  await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, 'osservatore')`, [ids.caseA3, ids.b]);
  try {
    const facts = { caseId: ids.caseA3, userId: ids.b, lsDomains: ["ls.test"] };
    assert.equal(await builders.isExternalBuilderOfCase(exec, facts), false, "il predicato");
    assert.deepEqual(await builders.externalBuilderGate(exec, facts), { builds: false, blocked: null }, "la porta");
    const scope = await builders.loadBuilderScope(exec, ["ls.test"]);
    const [listed] = await exec.batch([toStatement(ucSql`SELECT r.user_id FROM uc_cases c CROSS JOIN LATERAL ${builders.builderMembersSql(scope)} r WHERE c.id = ${cast(ids.caseA3, "uuid")}`)]);
    assert.ok(!listed.some((r) => r.user_id === ids.b), "gli elenchi");
    const tokenA = await tokenFor("b", ids.wsA);
    const ctx = await call("context?caso=NM-0003", { token: tokenA });
    assert.deepEqual([ctx.status, (ctx.json.dati as Row).ruoli, (ctx.json.dati as Row).scrive], [200, ["osservatore"], false]);
    const write = await post("decisioni", tokenA, { caso: "NM-0003", argomento: "Prova", decisione: "Non dovrebbe passare" });
    assert.deepEqual([write.status, codeOf(write)], [403, "permesso_negato"]);
  } finally {
    await q(`DELETE FROM uc_case_members WHERE case_id = $1 AND user_id = $2`, [ids.caseA3, ids.b]);
    await q(`DELETE FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2`, [ids.wsA, ids.b]);
  }
});

test("D3: fuori dal «Dove» E (Analista) non trova il caso (404); E2 (gestisce il workspace) legge ma non scrive (403); nel suo caso costruisce", opts, async () => {
  for (const code of ["NM-0001", "NM-0003"]) {
    assert.deepEqual(await call(`context?caso=${code}`, { token: tokens.e3 }).then((r) => [r.status, codeOf(r)]), [404, "non_trovato"], code);
    assert.deepEqual(await post("setup", tokens.e3!, { caso: code, azione: "apri" }).then((r) => [r.status, codeOf(r)]), [404, "non_trovato"], code);
  }
  const ctx = await call("context?caso=NM-0001", { token: tokens.e2 });
  assert.equal(ctx.status, 200, "da osservatore legge");
  assert.deepEqual([(ctx.json.dati as Row).ruoli, (ctx.json.dati as Row).scrive], [["osservatore"], false]);
  for (const [route, body] of [
    ["setup", { caso: "NM-0001", azione: "apri" }],
    ["decisioni", { caso: "NM-0001", argomento: "Prova", decisione: "Non dovrebbe passare" }],
    ["compiti", { caso: "NM-0001", azione: "nuovo", titolo: "Non dovrebbe nascere" }],
    ["token-caso", { caso: "NM-0001" }],
  ] as const) {
    const r = await post(route, tokens.e2!, body);
    assert.deepEqual([r.status, codeOf(r)], [403, "permesso_negato"], route);
  }
  const denied = await post("setup", tokens.e2!, { caso: "NM-0001", azione: "apri" });
  assert.equal((denied.json.errore as Row).messaggio, "Nel team del caso non hai un ruolo che costruisce: te lo dà il responsabile del caso.");
  const implicit = await call("context?caso=NM-0003", { token: tokens.e2 });
  assert.deepEqual([implicit.status, (implicit.json.dati as Row).scrive], [200, false], "senza riga, da chi gestisce il workspace: legge");
  assert.deepEqual(await post("setup", tokens.e2!, { caso: "NM-0003", azione: "apri" }).then((r) => [r.status, codeOf(r)]), [403, "permesso_negato"]);
  const own = await call("context?caso=NM-0002", { token: tokens.e2 });
  assert.deepEqual([(own.json.dati as Row).ruoli, (own.json.dati as Row).scrive], [["osservatore", "builder_esterno"], true]);
  const third = await call("context?caso=NM-0002", { token: tokens.e3 });
  assert.deepEqual([(third.json.dati as Row).ruoli, (third.json.dati as Row).scrive], [["osservatore", "builder_esterno"], true]);
});

test("D6: le azioni di chi costruisce sono rifiutate a chi gestisce il workspace senza riga e a un osservatore senza concessione", opts, async () => {
  const builderActions: [string, () => Promise<AnyResult>][] = [
    ["pacchetto", () => factoryActions.generatePackageAction(ids.wsA, ids.caseA1)],
    ["apri", () => factoryActions.startProjectAction(ids.wsA, ids.caseA1)],
    ["scelta", () => factoryActions.saveProjectTopicAction(ids.wsA, ids.caseA1, { topic: "dati", scelta: "No" })],
    ["dettagli", () => factoryActions.saveProjectDetailsAction(ids.wsA, ids.caseA1, { estimateHours: 1 })],
    ["invia", () => factoryActions.submitProjectAction(ids.wsA, ids.caseA1, { revision: 1 })],
    ["decisione", () => factoryActions.addDecisionAction(ids.wsA, ids.caseA1, { topic: "Prova", choice: "No" })],
    ["proposta", () => factoryActions.decideTaskProposalAction(ids.wsA, ids.caseA1, randomUUID(), "scarta")],
  ];
  for (const person of ["m", "p"] as const) {
    for (const [label, run] of builderActions) {
      const r = await as(person, run);
      assert.deepEqual([r.ok, !r.ok && r.code], [false, "non_trovato"], `${person}: ${label}`);
    }
  }
  // Dalla CLI l'osservatore senza concessione legge e non scrive.
  const ctx = await call("context?caso=NM-0001", { token: tokens.p });
  assert.deepEqual([ctx.status, (ctx.json.dati as Row).ruoli, (ctx.json.dati as Row).scrive], [200, ["osservatore"], false]);
  assert.deepEqual(await post("decisioni", tokens.p!, { caso: "NM-0001", argomento: "Prova", decisione: "No" }).then((r) => [r.status, codeOf(r)]), [403, "permesso_negato"]);
});

test("con la 0037 non intera, chi costruisce da fuori riceve «riprova» (503) dalla CLI e dalla pagina, mai «non hai un ruolo»; gli altri come prima", opts, async () => {
  // La tabella c'è, un indice unico no: la sonda è falsa (come una 0037 a metà).
  await q(`ALTER INDEX use_case_external_builders_all_unique RENAME TO use_case_external_builders_all_unique_prova`);
  try {
    const unavailable = "Unbundle non risponde per questo caso: riprova tra qualche minuto.";
    const ctx = await call("context?caso=NM-0001", { token: tokens.e });
    assert.deepEqual([ctx.status, codeOf(ctx), (ctx.json.errore as Row | undefined)?.messaggio], [503, "non_disponibile", unavailable], "E: il contesto");
    const write = await post("decisioni", tokens.e!, { caso: "NM-0001", argomento: "Prova", decisione: "Non adesso" });
    assert.deepEqual([write.status, codeOf(write)], [503, "non_disponibile"], "E: una scrittura");
    const web = await as("e", () => factoryActions.addDecisionAction(ids.wsA, ids.caseA1, { topic: "Prova", choice: "Non adesso" }));
    assert.deepEqual([web.ok, !web.ok && web.code], [false, "non_disponibile"], "E: dalla pagina");
    // Chi non ha una concessione: come sempre, legge e non scrive. Lateral Space scrive.
    const p = await call("context?caso=NM-0001", { token: tokens.p });
    assert.deepEqual([p.status, (p.json.dati as Row).scrive], [200, false]);
    assert.deepEqual(await post("decisioni", tokens.p!, { caso: "NM-0001", argomento: "Prova", decisione: "No" }).then((r) => [r.status, codeOf(r)]), [403, "permesso_negato"]);
    assert.equal((await call("context?caso=NM-0001", { token: tokens.lead })).status, 200);
  } finally {
    await q(`ALTER INDEX use_case_external_builders_all_unique_prova RENAME TO use_case_external_builders_all_unique`);
  }
  assert.equal((await call("context?caso=NM-0001", { token: tokens.e })).status, 200, "con la 0037 intera E torna a costruire");
});

// ─── Gli elenchi ─────────────────────────────────────────────────────

test("D11: «passa» a chi costruisce il caso adesso: L→E, E→L, E→E2; a P o a chi costruisce in B, non trovato", opts, async () => {
  const [open] = await q(`SELECT revision FROM use_case_projects WHERE use_case_id = $1 AND status = 'da_approvare'`, [ids.ucA2]);
  const approved = await as("lead", () => factoryActions.approveProjectAction(ids.wsA, ids.caseA2, { revision: open.revision }));
  assert.equal(approved.ok, true, approved.ok ? "" : approved.message);
  const file = ["# NM-0002 · Compiti", "", "- [ ] T-1 Catalogo dei ricambi · 4 h · aree: casi/nm-0002/src/catalogo.ts"].join("\n");
  assert.equal((await post("compiti", tokens.lead!, { caso: "NM-0002", azione: "importa", testo: file, cartella: "casi/nm-0002" })).status, 200);
  const act = (person: Person, azione: string, extra: Record<string, unknown>) => post("compiti", tokens[person]!, { caso: "NM-0002", azione, ...extra });
  const nota = "Fatto: lo schema. Da fare: i test. Dubbi: nessuno. Riprendi dal ramo.";
  assert.equal((await act("lead", "prendi", { compito: "T-1" })).status, 200);
  assert.equal((await act("lead", "passa", { compito: "T-1", a: EMAIL.e, nota })).status, 200, "L→E");
  assert.equal((await act("e", "passa", { compito: "T-1", a: EMAIL.lead, nota })).status, 200, "E→L");
  assert.equal((await act("lead", "passa", { compito: "T-1", a: EMAIL.e, nota })).status, 200);
  assert.equal((await act("e", "passa", { compito: "T-1", a: EMAIL.e2.toUpperCase(), nota })).status, 200, "E→E2");
  const [held] = await q(`SELECT holder_user_id FROM use_case_tasks WHERE use_case_id = $1 AND ref = 'T-1'`, [ids.ucA2]);
  assert.equal(held.holder_user_id, ids.e2);
  for (const to of [EMAIL.p, EMAIL.b, EMAIL.e3.replace("@", "-non-esiste@")]) {
    const r = await act("e2", "passa", { compito: "T-1", a: to, nota });
    assert.deepEqual([r.status, codeOf(r)], [404, "non_trovato"], to);
    assert.equal((r.json.errore as Row).messaggio, "Questa persona non costruisce questo caso: la aggiunge Lateral Space.");
  }
  // Chi riceve il compito lo sa: campanella ed e-mail «ti hanno passato il compito», anche da fuori.
  const passed = await q(`SELECT DISTINCT recipient_user_id FROM use_case_notifications WHERE use_case_id = $1 AND kind = 'compito_passato'`, [ids.ucA2]);
  assert.deepEqual(passed.map((r) => r.recipient_user_id).sort(), [ids.e, ids.e2, ids.lead].sort());
  const mails = await q(`SELECT DISTINCT recipient_user_id FROM uc_notifications WHERE case_id = $1 AND template_key = 'compito_passato'`, [ids.caseA2]);
  assert.deepEqual(mails.map((r) => r.recipient_user_id).sort(), [ids.e, ids.e2, ids.lead].sort());
});

/** Quante righe della campanella (e quante e-mail in coda) ha la persona per un tipo, nei casi di A. */
async function received(person: Person, kind: string, template = kind): Promise<{ bell: number; mail: number }> {
  const [bell] = await q(`SELECT count(*)::int AS n FROM use_case_notifications WHERE workspace_id = $1 AND recipient_user_id = $2 AND kind = $3`, [ids.wsA, ids[person], kind]);
  const [mail] = await q(`SELECT count(*)::int AS n FROM uc_notifications WHERE workspace_id = $1 AND recipient_user_id = $2 AND template_key = $3`, [ids.wsA, ids[person], template]);
  return { bell: Number(bell.n), mail: Number(mail.n) };
}

test("D12: E riceve la campanella e le e-mail in coda di chi costruisce; mai quelle del responsabile e dell'AI Board", opts, async () => {
  // Il pacchetto cambiato da L: a E campanella ed e-mail.
  assert.equal((await as("lead", () => factoryActions.generatePackageAction(ids.wsA, ids.caseA1))).ok, true);
  assert.deepEqual(await received("e", "pacchetto_nuovo", "pacchetto_aggiornato"), { bell: 1, mail: 1 });
  // Il progetto approvato (D5, D11): la campanella.
  assert.ok((await received("e", "progetto_ok")).bell >= 1);
  // I compiti da prendere (l'import di L dopo l'approvazione, D11).
  assert.ok((await received("e", "compiti_pronti")).bell >= 1 && (await received("e", "compiti_pronti")).mail >= 1);
  // Un compito suo chiesto da L.
  assert.equal((await post("compiti", tokens.e!, { caso: "NM-0001", azione: "prendi", compito: "T-2" })).status, 200);
  assert.equal((await post("compiti", tokens.lead!, { caso: "NM-0001", azione: "chiedi", compito: "T-2" })).status, 200);
  assert.deepEqual(await received("e", "compito_chiesto"), { bell: 1, mail: 1 });
  // Una proposta di compito da GitHub.
  const builders = await import("../../db/queries/use-case-builders.ts");
  const proposals = await import("../../db/queries/use-case-task-proposals.ts");
  const { raw } = await import("../../uc/sql/statement.ts");
  const scope = await builders.loadBuilderScope(exec, ["ls.test"]);
  await exec.batch(proposals.proposalStatements({ workspaceId: ids.wsA, useCaseId: ids.ucA1 }, { source: "github", externalKey: `gh:prova#${suffix}`, title: "Aggiungere i ricambi fuori produzione", link: null }, raw("true"), scope));
  assert.deepEqual(await received("e", "compito_proposto"), { bell: 1, mail: 1 });
  // Una PR pronta di un compito di L (dal webhook): a E, non a L che ha il compito.
  const github = await import("../../db/queries/use-case-github.ts");
  const at = new Date().toISOString();
  const pr = await github.applyGithubEvent(exec, {
    deliveryId: randomUUID(),
    event: "pull_request",
    parsed: { kind: "pr", repo: `Prova/nardi-esploso-${suffix}`, number: 7, branch: "nm-0001/t-3-ricerca", state: "aperta", draft: false, openedAt: at, mergedAt: null, closedAt: null, updatedAt: at, action: "opened", reopened: false, signal: true, ready: true },
  });
  assert.equal(pr.esito, "applicato");
  assert.deepEqual(await received("e", "pr_da_rivedere"), { bell: 1, mail: 1 });
  assert.equal((await received("lead", "pr_da_rivedere")).bell, 0, "mai a chi ha il compito");
  // Il banco consiglia un altro modello e le evals di main scendono sotto soglia (mandate da L).
  const sonnet = "anthropic/claude-sonnet-5-5";
  const haiku = "anthropic/claude-haiku-5-5";
  const result = (over: Record<string, unknown>) => ({ modello: haiku, attuale: true, superati: 27, totali: 28, soglieRispettate: true, gruppi: { regole: { passati: 9, totali: 9, soglia: 1, ok: true } }, costoPer1000Usd: 0.12, latenzaP50Ms: 1200, latenzaP95Ms: 2600, tokenIngressoMedi: 1900, tokenUscitaMedi: 220, errori: 0, ...over });
  const run = { caso: "NM-0001", livello: "pull_request", ramo: "main", commit: "a1b2c3d", versioneModello: "1.5.0", modelliFinti: false, inCostruzione: false };
  const bench = await post("evals", tokens.lead!, { ...run, tipo: "banco", ruolo: "lettura", modelli: { lettura: sonnet }, risultati: [result({ modello: sonnet, costoPer1000Usd: 1.8, latenzaP95Ms: 4100 }), result({ attuale: false })] });
  assert.equal(bench.status, 200, JSON.stringify(bench.json));
  assert.deepEqual(await received("e", "banco_consiglio"), { bell: 1, mail: 1 });
  const evals = await post("evals", tokens.lead!, { ...run, tipo: "evals", modelli: { lettura: sonnet }, risultati: [result({ modello: sonnet, superati: 60, totali: 100, soglieRispettate: false })] });
  assert.equal(evals.status, 200, JSON.stringify(evals.json));
  assert.deepEqual(await received("e", "evals_in_calo"), { bell: 1, mail: 1 });

  // Il caso A3 con uno strumento nuovo: «da approvare» al responsabile, «strumento nuovo» e «ok da rifare» all'AI Board
  // (P), «modifica chiesta» a chi costruisce.
  await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, 'ai_board')`, [ids.caseA3, ids.p]);
  assert.equal((await post("setup", tokens.e!, { caso: "NM-0003", azione: "apri" })).status, 200);
  for (const topic of ((await call("setup?caso=NM-0003", { token: tokens.e })).json.argomenti as Row[])) {
    assert.equal((await post("setup", tokens.e!, { caso: "NM-0003", azione: "scelta", argomento: topic.chiave, scelta: `Scelta per ${String(topic.chiave)}` })).status, 200);
  }
  assert.equal((await post("setup", tokens.e!, { caso: "NM-0003", azione: "dettagli", strumentiNuovi: [{ nome: "Database dei tempi", perche: "Serve allo storico" }] })).status, 200);
  const revision = ((await call("setup?caso=NM-0003", { token: tokens.e })).json.progetto as Row).revisione;
  assert.equal((await post("setup", tokens.e!, { caso: "NM-0003", azione: "invia", revisione: revision })).status, 200);
  const [pending] = await q(`SELECT revision FROM use_case_projects WHERE use_case_id = $1 AND status = 'da_approvare'`, [ids.ucA3]);
  const change = await as("p", () => factoryActions.requestProjectChangeAction(ids.wsA, ids.caseA3, { revision: pending.revision, note: "Serve un database già approvato dal cliente" }));
  assert.equal(change.ok, true, change.ok ? "" : change.message);
  assert.equal((await received("e", "modifica_chiesta")).bell, 1);
  assert.equal((await received("e", "modifica_chiesta", "modifica_richiesta")).mail, 0, "l'e-mail della modifica è del responsabile");
  const [asked] = await q(`SELECT revision FROM use_case_projects WHERE use_case_id = $1 AND status = 'da_approvare'`, [ids.ucA3]);
  assert.equal((await as("p", () => factoryActions.recordAiBoardOkAction(ids.wsA, ids.caseA3, { revision: asked.revision }))).ok, true);
  const [okd] = await q(`SELECT revision FROM use_case_projects WHERE use_case_id = $1 AND status = 'da_approvare'`, [ids.ucA3]);
  assert.equal((await as("lead", () => factoryActions.reopenProjectAction(ids.wsA, ids.caseA3, { revision: okd.revision }))).ok, true);
  assert.equal((await received("p", "ok_decaduto")).bell, 1, "l'AI Board sa che il suo ok va rifatto");
  assert.equal((await received("p", "strumento_nuovo")).bell, 1, "l'AI Board sa dello strumento nuovo");
  // Una domanda proposta da un coding agent di L: al responsabile e agli analisti di Lateral Space.
  assert.equal((await post("domande", tokens.lead!, { caso: "NM-0001", domanda: "Chi aggiorna i codici dei ricambi?" })).status, 200);
  // Mai per E: «da approvare», «domanda di un coding agent», «strumento nuovo», «ok da rifare».
  for (const [kind, template] of [
    ["progetto_appr", "progetto_da_approvare"],
    ["domanda_agente", "domanda_proposta"],
    ["strumento_nuovo", "strumento_da_approvare"],
    ["ok_decaduto", "ok_decaduto"],
  ] as const) {
    assert.deepEqual(await received("e", kind, template), { bell: 0, mail: 0 }, kind);
  }
  assert.ok((await received("lead", "progetto_appr")).bell >= 1, "il responsabile sì");
});

test("D12: senza la 0037 gli elenchi non hanno esterni", opts, async () => {
  const notices = await import("../../db/queries/use-case-tasks-notices.ts");
  const builders = await import("../../db/queries/use-case-builders.ts");
  const at = new Date("2026-12-01T10:00:00Z");
  await exec.batch(notices.notifyTask({ workspaceId: ids.wsA, useCaseId: ids.ucA1 }, "compiti_pronti", { builders: builders.NO_EXTERNAL_BUILDERS }, notices.NOBODY, at, null));
  const rows = await q(`SELECT recipient_user_id FROM use_case_notifications WHERE use_case_id = $1 AND kind = 'compiti_pronti' AND rome_day = '2026-12-01'`, [ids.ucA1]);
  assert.deepEqual(rows.map((r) => r.recipient_user_id), [ids.lead], "solo Lateral Space");
});

// ─── Le protezioni ───────────────────────────────────────────────────

test("D7: a chi costruisce il caso niente ruoli del cliente, niente referente, niente firma (designato o dal link)", opts, async () => {
  const ucActions = await import("../../actions/uc-cases.ts");
  const board = await as("lead", () => ucActions.addMemberAction(ids.wsA, ids.caseA1, { userId: ids.e, role: "ai_board" }));
  assert.deepEqual([board.ok, !board.ok && board.code, !board.ok && board.message], [false, "conflitto_ruoli", "Costruisce questo caso: non può avere anche un ruolo del cliente."]);
  // P (osservatore senza concessione) l'AI Board la può avere: la regola guarda la concessione.
  const pBoard = await as("lead", () => ucActions.addMemberAction(ids.wsA, ids.caseA1, { userId: ids.p, role: "ai_board" }));
  assert.equal(pBoard.ok, true, pBoard.ok ? "" : pBoard.message);
  await q(`DELETE FROM uc_case_members WHERE case_id = $1 AND user_id = $2 AND role = 'ai_board'`, [ids.caseA1, ids.p]);
  // Il referente del dossier con l'e-mail di chi costruisce.
  const { commandContextFor, loadCaseCore, loadSignatureContext } = await import("../../db/queries/uc-cases.ts");
  const requests = await import("../../db/queries/uc-requests.ts");
  const ctx = await commandContextFor(exec, { workspaceId: ids.wsA, caseId: ids.caseA1, userId: ids.lead, lsDomains: ["ls.test"] });
  assert.ok(ctx.ok);
  if (!ctx.ok) return;
  const contact = await requests.createContact(exec, ctx.value, { displayName: "Referente di prova", email: EMAIL.e.toUpperCase() });
  assert.deepEqual([contact.ok, !contact.ok && contact.code], [false, "referente_costruttore"]);
  // Il firmatario: designato o dal link, mai chi costruisce il caso.
  const core = await loadCaseCore(exec, ids.wsA, ids.caseA1);
  const sig = await loadSignatureContext(exec, core!, ["ls.test"]);
  assert.ok(sig.builderEmails?.includes(EMAIL.e), "chi ha una concessione che copre il caso");
  assert.ok(!sig.builderEmails?.includes(EMAIL.e2), "E2 costruisce solo A2");
  const { checkSignerDesignation, signatureRole } = await import("../../uc/permissions.ts");
  const designated = checkSignerDesignation({
    actor: { user: ctx.value.user!, roles: ["ls_lead"] },
    designation: "owner",
    contact: { id: randomUUID(), email: EMAIL.e, isActive: true, anonymized: false },
    evidenceFileId: randomUUID(),
    ctx: sig,
  });
  assert.equal(designated.ok ? "ok" : designated.code, "firmatario_costruttore");
  const fromLink = signatureRole({ kind: "link", contactId: "c-owner", designation: "owner", email: EMAIL.e }, "gate", { ...sig, designated: { owner: "c-owner", privacy: null } });
  assert.equal(fromLink.ok ? "ok" : fromLink.code, "firmatario_costruttore");
});

test("D7: nel caso che «Aggiungi» salta perché lì la persona firma o approva per il cliente, resta del cliente: firma dal link e può avere un altro ruolo del cliente", opts, async () => {
  const team = await import("../../db/queries/use-case-workspace-team.ts");
  const builders = await import("../../db/queries/use-case-builders.ts");
  const ucCases = await import("../../db/queries/uc-cases.ts");
  const perms = await import("../../uc/permissions.ts");
  const ucActions = await import("../../actions/uc-cases.ts");
  // P, Analista del cliente: responsabile del cliente in A3, poi «Sviluppatore esterno» in tutti i casi.
  await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, 'owner_cliente')`, [ids.caseA3, ids.p]);
  try {
    const added = await team.addExternalBuilder(exec, { workspaceId: ids.wsA, actorUserId: ids.lead, userId: ids.p, where: "tutti", lsDomains: ["ls.test"] });
    assert.ok(added.ok, added.ok ? "" : added.message);
    if (!added.ok) return;
    assert.deepEqual(added.value.skipped, [{ code: "NM-0003", reason: "ruolo_cliente" }]);
    const signer = async (caseId: string) => {
      const core = await ucCases.loadCaseCore(exec, ids.wsA, caseId);
      const sig = await ucCases.loadSignatureContext(exec, core!, ["ls.test"]);
      const checked = perms.checkSignerEmail(EMAIL.p.toUpperCase(), ["ls.test"], sig.lsMemberEmails, sig.builderEmails);
      return checked.ok ? "ok" : checked.code;
    };
    assert.equal(await signer(ids.caseA3), "ok", "in A3 firma per il cliente, anche dal link");
    assert.equal(await signer(ids.caseA2), "firmatario_costruttore", "in A2 costruisce: lì non firma");
    assert.ok(!(await builders.caseGrantUserIds(exec, ids.caseA3)).includes(ids.p), "in A3 il team non lo dice «costruisce»");
    assert.ok((await builders.caseGrantUserIds(exec, ids.caseA2)).includes(ids.p));
    const privacy = await as("lead", () => ucActions.addMemberAction(ids.wsA, ids.caseA3, { userId: ids.p, role: "approvatore_privacy" }));
    assert.equal(privacy.ok, true, privacy.ok ? "" : privacy.message);
    const board = await as("lead", () => ucActions.addMemberAction(ids.wsA, ids.caseA2, { userId: ids.p, role: "ai_board" }));
    assert.deepEqual([board.ok, !board.ok && board.code], [false, "conflitto_ruoli"], "dove costruisce, niente ruoli del cliente");
  } finally {
    await team.removeExternalBuilder(exec, { workspaceId: ids.wsA, actorUserId: ids.lead, userId: ids.p, lsDomains: ["ls.test"] });
    await q(`DELETE FROM uc_case_members WHERE case_id = $1 AND user_id = $2 AND role IN ('owner_cliente', 'approvatore_privacy')`, [ids.caseA3, ids.p]);
    // Come nel resto della prova: P osservatore in A1, senza concessione.
    await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, 'osservatore') ON CONFLICT DO NOTHING`, [ids.caseA1, ids.p]);
  }
});

test("D15: il repository di un altro cliente si rifiuta; nello stesso cliente un repository di famiglia vale per più casi", opts, async () => {
  const repo = `Prova/nardi-esploso-${suffix}`;
  const leadInB = await tokenFor("lead", ids.wsB);
  for (const name of [repo, repo.toUpperCase()]) {
    const r = await post("repository", leadInB, { caso: "TB-0001", repository: name, cartella: "casi/tb-0001" });
    assert.deepEqual([r.status, codeOf(r)], [409, "repo_di_altro_cliente"], name);
    assert.equal((r.json.errore as Row).messaggio, "Questo repository è già registrato per un altro cliente: ogni cliente ha i suoi.");
  }
  const [count] = await q(`SELECT count(*)::int AS n FROM use_case_repos WHERE workspace_id = $1`, [ids.wsB]);
  assert.equal(count.n, 0);
  const family = await post("repository", tokens.lead!, { caso: "NM-0003", repository: repo, cartella: "casi/nm-0003" });
  assert.equal(family.status, 200, "lo stesso cliente, un altro caso della famiglia");
});

test("D15: chi costruisce da fuori registra solo un repository dei casi del cliente; per uno nuovo o di un altro cliente la stessa risposta; il modello mai, per nessuno", opts, async () => {
  const github = await import("../../db/queries/use-case-github.ts");
  const family = `Prova/nardi-esploso-${suffix}`;
  const ofB = `Prova/quotazioni-${suffix}`;
  const fresh = `Prova/mai-registrato-${suffix}`;
  const leadInB = await tokenFor("lead", ids.wsB);
  assert.equal((await post("repository", leadInB, { caso: "TB-0001", repository: ofB, cartella: "casi/tb-0001" })).status, 200, "Lateral Space registra un repository nuovo");
  const refusal = { status: 403, code: "repo_non_del_cliente", message: "Questo repository non è tra quelli dei casi del cliente: uno nuovo lo registra Lateral Space. Chiedilo al responsabile del caso, poi rilancia lo stesso comando." };
  for (const repository of [fresh, ofB, ofB.toUpperCase()]) {
    const r = await post("repository", tokens.e!, { caso: "NM-0003", repository, cartella: "casi/nm-0003" });
    assert.deepEqual({ status: r.status, code: codeOf(r), message: (r.json.errore as Row | undefined)?.messaggio }, refusal, repository);
  }
  const [count] = await q(`SELECT count(*)::int AS n FROM use_case_repos WHERE workspace_id = $1 AND lower(repo) = ANY($2::text[])`, [ids.wsA, [fresh.toLowerCase(), ofB.toLowerCase()]]);
  assert.equal(count.n, 0, "niente registrato nel workspace A");
  // Il repository nuovo non porta niente nei casi di A: un'issue lì si ignora.
  const applied = await github.applyGithubEvent(exec, {
    deliveryId: `ext-${suffix}-repo-nuovo`,
    event: "issues",
    parsed: { kind: "proposta", repo: fresh, number: 7, commentId: null, title: "Ruotare la chiave interna", caseCodes: [], onPullRequest: false },
  });
  assert.deepEqual(applied, { esito: "ignorato", motivo: "repository_non_registrato" });
  // Il repository della famiglia di A: sì, anche per un altro caso.
  assert.equal((await post("repository", tokens.e!, { caso: "NM-0003", repository: family, cartella: "casi/nm-0003" })).status, 200);
  // Il repository modello: per nessuno, nemmeno per Lateral Space.
  for (const [who, token] of [["E", tokens.e!], ["Lateral Space", tokens.lead!]] as const) {
    for (const repository of ["Voltaen/agent-factory-modello", "voltaen/Agent-Factory-Modello.git"]) {
      const r = await post("repository", token, { caso: "NM-0003", repository, cartella: "casi/nm-0003" });
      assert.deepEqual([r.status, codeOf(r)], [400, "repo_modello"], `${who}: ${repository}`);
    }
  }
});

test("D2: «Collega questa CLI» propone solo dove si costruisce o si è nel team di un caso, e il server lo ricontrolla", opts, async () => {
  const cliAuth = await import("../../db/queries/use-case-cli-auth.ts");
  const login = await import("../../actions/cli-login.ts");
  assert.deepEqual([...(await cliAuth.cliCaseWorkspaceIds(exec, ids.e))], [ids.wsA.toLowerCase()], "E: solo A");
  assert.deepEqual([...(await cliAuth.cliCaseWorkspaceIds(exec, ids.b))], [ids.wsB.toLowerCase()], "B: solo B");
  assert.equal((await cliAuth.cliCaseWorkspaceIds(exec, ids.m)).size, 0, "chi gestisce A senza casi: nessuno");
  // M conferma su A: rifiutato; con una concessione (anche senza dossier) sì.
  const started = await cliAuth.startCliLogin(exec, { clientLabel: `CLI di prova login ${suffix}` });
  const refused = await as("m", () => login.confirmCliLoginAction(started.userCode, ids.wsA));
  assert.deepEqual(refused, { ok: false, message: "In questo workspace non costruisci nessun caso: qui la CLI non serve." });
  await q(`INSERT INTO use_case_external_builders (workspace_id, user_id, use_case_id) VALUES ($1, $2, $3)`, [ids.wsA, ids.m, ids.ucA3]);
  const card = await cliAuth.loadCliCard(exec, { userId: ids.m, workspaceId: ids.wsA, lateralSpace: false });
  assert.deepEqual(card, { tokens: [] }, "la scheda «CLI di Unbundle» anche a chi costruisce");
  assert.equal((await as("m", () => login.confirmCliLoginAction(started.userCode, ids.wsA))).ok, true);
  await q(`DELETE FROM use_case_external_builders WHERE workspace_id = $1 AND user_id = $2`, [ids.wsA, ids.m]);
  assert.equal(await cliAuth.loadCliCard(exec, { userId: ids.p, workspaceId: ids.wsB, lateralSpace: false }), null);
  // E su B: non è nel workspace. B su A: nemmeno.
  const other = await cliAuth.startCliLogin(exec, { clientLabel: `CLI di prova login ${suffix}` });
  await assert.rejects(as("e", () => login.confirmCliLoginAction(other.userCode, ids.wsB)), /Workspace non trovato/);
  await assert.rejects(as("b", () => login.confirmCliLoginAction(other.userCode, ids.wsA)), /Workspace non trovato/);
});

test("il responsabile toglie dal dossier la riga osservatore di chi costruisce: lì i suoi compiti tornano da prendere, negli altri casi restano suoi", opts, async () => {
  const ucActions = await import("../../actions/uc-cases.ts");
  const team = await import("../../db/queries/use-case-workspace-team.ts");
  // Un compito in A2 (la riga che si toglie), uno in A3 (costruisce ancora), uno in uno use case senza dossier (fuori).
  const ucA4 = randomUUID();
  await q(`INSERT INTO use_cases (id, workspace_id, title, code) VALUES ($1, $2, 'Senza dossier di prova', 'NM-0004')`, [ucA4, ids.wsA]);
  await q(
    `INSERT INTO use_case_tasks (use_case_id, workspace_id, ref, title, status, holder_user_id, taken_at, source)
     VALUES ($1, $4, 'T-90', 'Compito di prova in A2', 'in_corso', $5, now(), 'cli'), ($2, $4, 'T-91', 'Compito di prova in A3', 'in_revisione', $5, now(), 'cli'),
            ($3, $4, 'T-92', 'Compito di prova senza dossier', 'in_corso', $5, now(), 'cli')`,
    [ids.ucA2, ids.ucA3, ucA4, ids.wsA, ids.e],
  );
  try {
    const removed = await as("lead", () => ucActions.removeMemberAction(ids.wsA, ids.caseA2, { userId: ids.e, role: "osservatore" }));
    assert.equal(removed.ok, true, removed.ok ? "" : removed.message);
    const tasks = await q(`SELECT ref, status, holder_user_id FROM use_case_tasks WHERE workspace_id = $1 AND ref IN ('T-90', 'T-91', 'T-92') ORDER BY ref`, [ids.wsA]);
    assert.deepEqual(
      tasks.map((t) => [t.ref, t.status, t.holder_user_id]),
      [
        ["T-90", "da_fare", null],
        ["T-91", "in_revisione", ids.e],
        ["T-92", "in_corso", ids.e],
      ],
      "in A2 torna da prendere; in A3, dove costruisce ancora, resta suo; fuori da A2 la riga tolta non tocca niente",
    );
    const notes = await q(`SELECT n.body FROM use_case_task_notes n JOIN use_case_tasks t ON t.id = n.task_id WHERE t.use_case_id = $1 AND t.ref = 'T-90' AND n.kind = 'passaggio'`, [ids.ucA2]);
    assert.deepEqual(notes.map((n) => n.body), [team.RELEASED_TASK_NOTE]);
  } finally {
    await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, 'osservatore') ON CONFLICT DO NOTHING`, [ids.caseA2, ids.e]);
    await q(`DELETE FROM use_case_tasks WHERE workspace_id = $1 AND ref IN ('T-90', 'T-91', 'T-92')`, [ids.wsA]);
    await q(`DELETE FROM use_cases WHERE id = $1`, [ucA4]);
  }
});

test("la riga osservatore tolta e i compiti liberati vanno insieme: se i compiti non si liberano, la riga resta", opts, async () => {
  const team = await import("../../db/queries/use-case-workspace-team.ts");
  const { commandContextFor } = await import("../../db/queries/uc-cases.ts");
  await q(`INSERT INTO use_case_tasks (use_case_id, workspace_id, ref, title, status, holder_user_id, taken_at, source) VALUES ($1, $2, 'T-93', 'Compito di prova in A2', 'in_corso', $3, now(), 'cli')`, [
    ids.ucA2,
    ids.wsA,
    ids.e,
  ]);
  try {
    const ctx = await commandContextFor(exec, { workspaceId: ids.wsA, caseId: ids.caseA2, userId: ids.lead, lsDomains: ["ls.test"] });
    assert.ok(ctx.ok);
    if (!ctx.ok) return;
    // Un guasto quando si liberano i compiti: tutta la transazione si annulla.
    const broken = {
      batch: (statements: Parameters<typeof exec.batch>[0]) => (statements.some((st) => st.text.includes("INSERT INTO use_case_task_notes")) ? Promise.reject(new Error("guasto")) : exec.batch(statements)),
    } as typeof exec;
    await assert.rejects(team.removeCaseMemberReleasingTasks(broken, ctx.value, { userId: ids.e, role: "osservatore" }), /guasto/);
    const rows = await q(`SELECT role FROM uc_case_members WHERE case_id = $1 AND user_id = $2`, [ids.caseA2, ids.e]);
    assert.deepEqual(rows.map((r) => r.role), ["osservatore"], "la riga resta");
    const [task] = await q(`SELECT status, holder_user_id FROM use_case_tasks WHERE use_case_id = $1 AND ref = 'T-93'`, [ids.ucA2]);
    assert.deepEqual([task.status, task.holder_user_id], ["in_corso", ids.e], "e il compito resta suo: si può riprovare");
    // Senza guasto: tutte e due.
    const removed = await team.removeCaseMemberReleasingTasks(exec, ctx.value, { userId: ids.e, role: "osservatore" });
    assert.equal(removed.ok, true);
    const [after] = await q(`SELECT status, holder_user_id FROM use_case_tasks WHERE use_case_id = $1 AND ref = 'T-93'`, [ids.ucA2]);
    assert.deepEqual([after.status, after.holder_user_id], ["da_fare", null]);
  } finally {
    await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, 'osservatore') ON CONFLICT DO NOTHING`, [ids.caseA2, ids.e]);
    await q(`DELETE FROM use_case_tasks WHERE workspace_id = $1 AND ref = 'T-93'`, [ids.wsA]);
  }
});

test("il responsabile toglie un ruolo di Lateral Space dal team del dossier: chi lì non costruisce più lascia i compiti di quel caso, chi tiene un altro ruolo con cui costruisce li tiene", opts, async () => {
  const ucActions = await import("../../actions/uc-cases.ts");
  const team = await import("../../db/queries/use-case-workspace-team.ts");
  // Due persone di Lateral Space: una sviluppa in A1 e in A2; l'altra in A1 è analista e sviluppatore.
  const dev = randomUUID();
  const both = randomUUID();
  await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $3, 'Dario Sviluppo', now()), ($2, $4, 'Bianca Doppia', now())`, [dev, both, `dev-${suffix}@ls.test`, `doppia-${suffix}@ls.test`]);
  await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'analyst'::member_role), ($1::uuid, $3::uuid, 'analyst'::member_role)`, [ids.wsA, dev, both]);
  await q(
    `INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $3, 'ls_sviluppatore'), ($2, $3, 'ls_sviluppatore'), ($1, $4, 'ls_analista'), ($1, $4, 'ls_sviluppatore')`,
    [ids.caseA1, ids.caseA2, dev, both],
  );
  await q(
    `INSERT INTO use_case_tasks (use_case_id, workspace_id, ref, title, status, holder_user_id, taken_at, source) VALUES
       ($1, $3, 'T-80', 'Compito in corso in A1', 'in_corso', $4, now(), 'cli'),
       ($1, $3, 'T-81', 'Compito in revisione in A1', 'in_revisione', $4, now(), 'cli'),
       ($2, $3, 'T-82', 'Compito in corso in A2', 'in_corso', $4, now(), 'cli'),
       ($1, $3, 'T-83', 'Compito di chi ha due ruoli', 'in_corso', $5, now(), 'cli')`,
    [ids.ucA1, ids.ucA2, ids.wsA, dev, both],
  );
  const tasks = async () =>
    (await q(`SELECT ref, status, holder_user_id FROM use_case_tasks WHERE workspace_id = $1 AND ref IN ('T-80', 'T-81', 'T-82', 'T-83') ORDER BY ref`, [ids.wsA])).map(
      (t) => `${t.ref}:${t.status}:${t.holder_user_id === dev ? "dev" : t.holder_user_id === both ? "doppia" : "nessuno"}`,
    );
  const remove = (userId: string, role: string) => as("lead", () => ucActions.removeMemberAction(ids.wsA, ids.caseA1, { userId, role }));
  try {
    // Tolto uno dei due ruoli: costruisce ancora il caso (è analista) e tiene il suo compito.
    const kept = await remove(both, "ls_sviluppatore");
    assert.equal(kept.ok, true, kept.ok ? "" : kept.message);
    assert.deepEqual(await tasks(), ["T-80:in_corso:dev", "T-81:in_revisione:dev", "T-82:in_corso:dev", "T-83:in_corso:doppia"]);
    // Tolto l'unico ruolo in A1: lì non costruisce più. Il compito in corso torna da fare, quello in revisione resta in
    // revisione senza nessuno; in A2, dove sviluppa ancora, il compito resta suo.
    const left = await remove(dev, "ls_sviluppatore");
    assert.equal(left.ok, true, left.ok ? "" : left.message);
    assert.deepEqual(await tasks(), ["T-80:da_fare:nessuno", "T-81:in_revisione:nessuno", "T-82:in_corso:dev", "T-83:in_corso:doppia"]);
    const notes = await q(`SELECT t.ref, n.body FROM use_case_task_notes n JOIN use_case_tasks t ON t.id = n.task_id WHERE t.workspace_id = $1 AND t.ref IN ('T-80', 'T-81', 'T-82', 'T-83') AND n.kind = 'passaggio' ORDER BY t.ref`, [ids.wsA]);
    assert.deepEqual(notes.map((n) => [n.ref, n.body]), [["T-80", team.RELEASED_TASK_NOTE], ["T-81", team.RELEASED_TASK_NOTE]], "la nota senza nomi, solo sui compiti tornati");
    // Tolto anche l'ultimo ruolo con cui costruiva: adesso il compito torna da prendere.
    const last = await remove(both, "ls_analista");
    assert.equal(last.ok, true, last.ok ? "" : last.message);
    assert.deepEqual(await tasks(), ["T-80:da_fare:nessuno", "T-81:in_revisione:nessuno", "T-82:in_corso:dev", "T-83:da_fare:nessuno"]);
  } finally {
    await q(`DELETE FROM use_case_tasks WHERE workspace_id = $1 AND ref IN ('T-80', 'T-81', 'T-82', 'T-83')`, [ids.wsA]);
    await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[dev, both]]);
  }
});

// ─── Togliere ────────────────────────────────────────────────────────

test("D9: la discesa a Contributore ferma le scritture subito, senza revoca, e il no dice che il ruolo si cambia da Impostazioni › Persone; tornato Analista ricomincia", opts, async () => {
  const role = "Per costruire serve almeno il ruolo di Analista nel workspace: lo cambia chi gestisce il workspace, da Impostazioni › Persone.";
  await q(`UPDATE workspace_memberships SET role = 'contributor' WHERE workspace_id = $1 AND user_id = $2`, [ids.wsA, ids.e3]);
  const denied = await post("decisioni", tokens.e3!, { caso: "NM-0002", argomento: "Prova", decisione: "Non dovrebbe passare" });
  assert.deepEqual([denied.status, codeOf(denied), (denied.json.errore as Row | undefined)?.messaggio], [403, "permesso_negato", role]);
  const ctx = await call("context?caso=NM-0002", { token: tokens.e3 });
  assert.deepEqual([(ctx.json.dati as Row).scrive, (ctx.json.dati as Row).perche], [false, role], "il contesto lo dice prima di toccare GitHub");
  for (const path of ["setup?caso=NM-0002", "pacchetto?caso=NM-0002"]) {
    const r = await call(path, { token: tokens.e3 });
    assert.deepEqual([r.status, (r.json.errore as Row | undefined)?.messaggio], [403, role], path);
  }
  // Un osservatore senza concessione: il no di sempre (un login nuovo: quello di prima l'ha revocato «Togli», in D7).
  const p = await call("context?caso=NM-0001", { token: await tokenFor("p") });
  assert.deepEqual([(p.json.dati as Row).scrive, (p.json.dati as Row).perche], [false, "Nel team del caso non hai un ruolo che costruisce: te lo dà il responsabile del caso."]);
  const line = await import("../../db/queries/use-case-factory-line.ts");
  assert.equal(await line.factoryNavVisible(exec, { workspaceId: ids.wsA, userId: ids.e3, lsManager: false, lsDomains: ["ls.test"] }), false, "la voce sparisce");
  await q(`UPDATE workspace_memberships SET role = 'analyst' WHERE workspace_id = $1 AND user_id = $2`, [ids.wsA, ids.e3]);
  assert.equal((await post("decisioni", tokens.e3!, { caso: "NM-0002", argomento: "Prova", decisione: "Di nuovo Analista" })).status, 200, "lo stesso token, mai revocato");
});

test("D9: dopo «Togli» lo stesso token non scrive più, i token sono revocati, i compiti tornano da prendere, la voce sparisce, le righe escono", opts, async () => {
  const team = await import("../../actions/use-case-workspace-team.ts");
  const caseToken = String((await post("token-caso", tokens.e!, { caso: "NM-0001" })).json.token);
  const [held] = await q(`SELECT ref FROM use_case_tasks WHERE use_case_id = $1 AND holder_user_id = $2 AND status = 'in_corso'`, [ids.ucA1, ids.e]);
  assert.ok(held, "E ha un compito in corso (T-2, D12)");
  const removed = await as("lead", () => team.removeBuilderAction(ids.wsA, ids.e));
  assert.equal(removed.ok, true, removed.ok ? "" : removed.message);
  assert.match(removed.ok ? (removed.message ?? "") : "", /^Non costruisce più: esce da 3 casi\. Ricorda GitHub \(Prova\/nardi-esploso-[0-9a-f]+\) e la sua chiave dell'AI Gateway\.$/);
  // Lo stesso token: revocato nella stessa transazione delle concessioni, ogni chiamata si ferma.
  for (const token of [tokens.e!, caseToken]) {
    const r = await post("decisioni", token, { caso: "NM-0001", argomento: "Prova", decisione: "Non dovrebbe passare" });
    assert.deepEqual([r.status, codeOf(r)], [401, "token"]);
  }
  const [live] = await q(`SELECT count(*)::int AS n FROM workspace_integration_tokens WHERE workspace_id = $1 AND owner_user_id = $2 AND revoked_at IS NULL`, [ids.wsA, ids.e]);
  assert.equal(live.n, 0);
  const [task] = await q(`SELECT status, holder_user_id FROM use_case_tasks WHERE use_case_id = $1 AND ref = $2`, [ids.ucA1, held.ref]);
  assert.deepEqual([task.status, task.holder_user_id], ["da_fare", null]);
  const line = await import("../../db/queries/use-case-factory-line.ts");
  assert.equal(await line.factoryNavVisible(exec, { workspaceId: ids.wsA, userId: ids.e, lsManager: false, lsDomains: ["ls.test"] }), false, "la voce sparisce");
  const rows = await q(`SELECT count(*)::int AS n FROM uc_case_members WHERE user_id = $1 AND case_id = ANY($2::uuid[])`, [ids.e, [ids.caseA1, ids.caseA2, ids.caseA3]]);
  assert.equal(rows[0].n, 0, "le righe osservatore sono tolte: il responsabile è chi ha agito");
  // Con un login nuovo E non scrive (non ha più la concessione) e non vede i casi (non ha più la riga).
  assert.deepEqual(await call("context?caso=NM-0001", { token: await tokenFor("e") }).then((r) => [r.status, codeOf(r)]), [404, "non_trovato"]);
});
