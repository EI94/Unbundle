import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import * as nodeModule from "node:module";
/** `module.registerHooks` di Node 24 (i tipi di @types/node del progetto non lo hanno ancora). */
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?(specifier: string, context: object, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult }): void;
};

// Il contesto del cliente nella CLI e nel pacchetto (rilascio 9b, RILASCIO-9b-COSTRUZIONE.md §2.4, §2.5, D1) sul
// database del pacchetto, con le rotte vere: lo strato `contesto` e la riga del brief, `CONTESTO.md` nel pacchetto e in
// `unbundle start`, `impara`, `nota` e la domanda `contesto`. Agli agenti solo i fatti «Per tutti», anche a Lateral Space;
// i nomi che Unbundle conosce diventano «una persona». Il workspace non ha l'ok ai fornitori di AI: nessun modello.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su 127.0.0.1). Dati
//   sintetici e inventati (il caso XX-0012, persone «Prova …»), creati e cancellati qui. I token non si stampano mai.
const url = process.env.DATABASE_URL;
const enabled = process.env.HUB_TEST_ISOLATED === "true" && Boolean(url);
if (enabled) {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || process.env.UC_TEST_DATABASE_URL !== url) {
    throw new Error("Hub DB tests need a loopback DATABASE_URL equal to UC_TEST_DATABASE_URL");
  }
  if (!/^\/hub_[a-z0-9][a-z0-9_]{0,39}$/.test(parsed.pathname)) {
    throw new Error("Run this suite only on a package database hub_<id>");
  }
}
const opts = { skip: !enabled };

type Row = Record<string, unknown>;
type Handler = (request: Request) => Promise<Response>;
let q: (text: string, params?: unknown[]) => Promise<Row[]>;
let exec: import("../../db/uc-executor.ts").UcExecutor;
let auth: typeof import("../../db/queries/use-case-cli-auth.ts");
let factory: typeof import("../../db/queries/use-case-factory.ts");
const routes: Record<string, { GET?: Handler; POST?: Handler }> = {};

const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), template: randomUUID(), useCase: randomUUID(), dossier: randomUUID(), lead: randomUUID(), owner: randomUUID(), source: randomUUID() };
type Person = "lead" | "owner";
const EMAIL: Record<Person, string> = { lead: `lead-${suffix}@ls.test`, owner: `owner-${suffix}@cliente.test` };
const NAME: Record<Person, string> = { lead: "Prova Guida", owner: "Prova Cliente" };
const tokens: Partial<Record<Person, string>> = {};
let keySeq = 0;
const key = () => `cli-${suffix}-ctx-${++keySeq}`;
const queuedAfter = () => ((globalThis as { __cliContestoAfter?: (() => Promise<void>)[] }).__cliContestoAfter ??= []);

async function call(path: string, init: { method?: "GET" | "POST"; token?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<{ status: number; json: Row; headers: Headers }> {
  const [route, query] = path.split("?");
  const handler = routes[route]?.[init.method ?? "GET"];
  assert.ok(handler, `rotta ${route} ${init.method ?? "GET"}`);
  // La CLI 1.6.0, come in produzione: le novità del contesto nel brief sono solo per lei (`cliKnowsContextLayer`).
  const headers: Record<string, string> = { "user-agent": "unbundle-cli/1.6.0", ...(init.headers ?? {}) };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const response = await handler(new Request(`http://127.0.0.1:53110/api/cli/${route}${query ? `?${query}` : ""}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) }));
  return { status: response.status, json: (await response.json()) as Row, headers: response.headers };
}
const post = (route: string, token: string, body: unknown, idempotencyKey: string | null = key()) =>
  call(route, { method: "POST", token, body, headers: idempotencyKey ? { "idempotency-key": idempotencyKey } : {} });

let rpcSeq = 0;
/** Uno strumento dell'MCP del caso, con il token di un caso solo: il risultato com'è. */
async function caseTool(token: string, name: string, args: Row): Promise<{ isError: boolean; data: Row; text: string }> {
  const handler = (routes.mcp as Record<string, Handler>).POST;
  const response = await handler(
    new Request("http://127.0.0.1:53110/api/cli/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcSeq, method: "tools/call", params: { name, arguments: args } }),
    }),
  );
  assert.equal(response.status, 200, `${name}: HTTP ${response.status}`);
  const result = ((await response.json()) as { result: { isError?: boolean; structuredContent: Row; content: Array<{ text: string }> } }).result;
  return { isError: result.isError === true, data: result.structuredContent, text: result.content[0].text };
}

async function tokenFor(person: Person): Promise<string> {
  const started = await auth.startCliLogin(exec, { clientLabel: `CLI di prova contesto ${suffix}` });
  const decided = await auth.decideCliLogin(exec, { userCode: started.userCode, userId: ids[person], workspaceId: ids.ws, confirm: true });
  assert.ok(decided.ok);
  const delivered = await auth.deliverCliLogin(exec, started.deviceCode);
  assert.equal(delivered.status, "consegnato");
  return (delivered as { token: string }).token;
}

/** Un fatto attivo di prova, legato o no allo use case. */
async function insertFact(f: { statement: string; section?: string; visibility?: "tutti" | "ls"; linked?: boolean; withSource?: boolean }): Promise<string> {
  const id = randomUUID();
  await q(
    `INSERT INTO context_facts (id, workspace_id, section, statement, basis, visibility, status, origin, source_id)
     VALUES ($1::uuid, $2::uuid, $3, $4, 'detto', $5, 'attivo', $6, $7::uuid)`,
    [id, ids.ws, f.section ?? "sistemi", f.statement, f.visibility ?? "tutti", f.withSource === false ? "manuale" : "fonte", f.withSource === false ? null : ids.source],
  );
  if (f.linked !== false) await q(`INSERT INTO context_fact_links (workspace_id, fact_id, use_case_id) VALUES ($1::uuid, $2::uuid, $3::uuid)`, [ids.ws, id, ids.useCase]);
  return id;
}

const SHARED = "Il gestionale esporta i preventivi solo in CSV, ogni notte.";
const SECRET = "Il margine sui preventivi charter resta riservato al team.";
let sharedFact = "";

before(async () => {
  if (!enabled) return;
  const stub = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
  const stubs: Record<string, string> = {
    "next/cache": stub("export function revalidatePath() {}\nexport function revalidateTag() {}\nexport function unstable_cache(fn) { return fn; }\nexport function unstable_noStore() {}"),
    "next/server": stub("export function after(task) { (globalThis.__cliContestoAfter ??= []).push(task); }"),
  };
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (Object.hasOwn(stubs, specifier)) return { url: stubs[specifier], shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  process.env.UC_ENABLED = "true";
  process.env.UC_WORKSPACE_IDS = ids.ws;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  process.env.USE_CASE_HUB_WORKSPACES = ids.ws;
  delete process.env.VERCEL_ENV;

  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Row[]>;
  const ensure = await import("../../db/ensure-schema.ts");
  await ensure.ensureDbSchema();
  exec = (await import("../../db/uc-executor.ts")).ucExecutorForUrl(url!);
  auth = await import("../../db/queries/use-case-cli-auth.ts");
  factory = await import("../../db/queries/use-case-factory.ts");
  for (const name of ["context", "pacchetto", "contesto", "nota", "impara", "token-caso", "mcp"]) routes[name] = await import(`../../../app/api/cli/${name}/route.ts`);

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova contesto CLI', $2)`, [ids.org, `org-cli-ctx-${suffix}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Workspace di prova contesto CLI')`, [ids.ws, ids.org]);
  const role: Record<Person, string> = { lead: "transformation_lead", owner: "contributor" };
  for (const person of Object.keys(EMAIL) as Person[]) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, $3, now())`, [ids[person], EMAIL[person], NAME[person]]);
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ids.ws, ids[person], role[person]]);
  }
  await q(`INSERT INTO use_cases (id, workspace_id, title, code) VALUES ($1, $2, 'Preventivi dal portale', 'XX-0012')`, [ids.useCase, ids.ws]);
  await q(
    `INSERT INTO uc_templates (id, key, version, name, archetype, definition, definition_hash, restricted_to_workspace_id)
     VALUES ($1::uuid, $2, '1.0.0', 'Template di prova contesto CLI', 'prova', '{"confidential": false}'::jsonb, $3, $4::uuid)`,
    [ids.template, `prova.cli_ctx_${suffix}`, randomBytes(32).toString("hex"), ids.ws],
  );
  await q(
    `INSERT INTO uc_cases (id, workspace_id, organization_id, portfolio_use_case_id, template_id, template_version, code, title, status, setup_completed_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, '1.0.0', $6, 'Dossier di prova contesto CLI', 'pronto_sviluppo', now())`,
    [ids.dossier, ids.ws, ids.org, ids.useCase, ids.template, `CTX-${suffix.toUpperCase()}`],
  );
  await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, 'ls_lead'), ($1, $3, 'owner_cliente')`, [ids.dossier, ids.lead, ids.owner]);

  // La memoria del cliente: una call con i suoi appunti (solo Lateral Space), due fatti «Per tutti» e uno «Solo Lateral
  // Space», un impegno per parte, una domanda. Gli appunti nominano i preventivi e il margine: non escono mai agli agenti.
  await q(
    `INSERT INTO context_sources (id, workspace_id, kind, origin, title, occurred_on, body, body_chars, visibility, read_status, parts_read)
     VALUES ($1::uuid, $2::uuid, 'appunti', 'web', 'Call di prova', '2026-11-14', 'Appunti della call: i preventivi e il margine riservato.', 55, 'ls', 'letto', 1)`,
    [ids.source, ids.ws],
  );
  sharedFact = await insertFact({ statement: SHARED });
  await insertFact({ statement: SECRET, section: "regole", visibility: "ls" });
  await insertFact({ statement: "Le eccezioni sui preventivi le approva Prova Guida.", section: "regole", linked: false, withSource: false });
  await q(
    `INSERT INTO context_commitments (workspace_id, statement, party, role_label, due_on, visibility, origin, use_case_ids) VALUES
       ($1::uuid, 'Inviare l''esportazione dei preventivi', 'cliente', 'Responsabile commerciale', '2026-11-25', 'tutti', 'manuale', $2::uuid[]),
       ($1::uuid, 'Rivedere il margine riservato', 'nostra', NULL, NULL, 'ls', 'manuale', $2::uuid[])`,
    [ids.ws, `{${ids.useCase}}`],
  );
  await q(`INSERT INTO context_questions (workspace_id, question, ask_whom, visibility, origin, use_case_ids) VALUES ($1::uuid, 'Chi approva gli sconti sopra soglia?', 'Direzione commerciale', 'tutti', 'manuale', $2::uuid[])`, [
    ids.ws,
    `{${ids.useCase}}`,
  ]);
  tokens.lead = await tokenFor("lead");
  tokens.owner = await tokenFor("owner");
});

after(async () => {
  if (!enabled) return;
  await q(`DELETE FROM use_case_cli_logins WHERE client_label LIKE $1`, [`%${suffix}%`]);
  await q(`DELETE FROM connector_rate_limits WHERE bucket LIKE $1 OR bucket LIKE $2 OR bucket LIKE $3`, [`%${ids.ws}%`, `%${ids.lead}%`, `%${ids.owner}%`]);
  await q(`DELETE FROM workspaces WHERE id = $1`, [ids.ws]);
  await q(`DELETE FROM uc_templates WHERE id = $1`, [ids.template]);
  await q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.lead, ids.owner]]);
});

test("lo strato `contesto`: solo «Per tutti», anche a Lateral Space; i nomi coperti; lo legge anche il responsabile del cliente", opts, async () => {
  const lead = await call("context?caso=XX-0012&strato=contesto", { token: tokens.lead });
  assert.equal(lead.status, 200, JSON.stringify(lead.json));
  const text = String(lead.json.testo);
  assert.match(text, /^Contesto del cliente per XX-0012\n\n/);
  assert.match(text, /\nChe cosa tocca questo caso\n- Il gestionale esporta i preventivi solo in CSV, ogni notte\. \(call del 14\/11\/2026\)\n/);
  assert.match(text, /\nRegole e vincoli\n- Le eccezioni sui preventivi le approva una persona\. \(scritto a mano\)\n/);
  assert.match(text, /\nImpegni aperti\n- Inviare l'esportazione dei preventivi · del cliente · Responsabile commerciale · entro il 25\/11\/2026\n/);
  assert.match(text, /\nDomande aperte\n- Chi approva gli sconti sopra soglia\? · da chiedere a: Direzione commerciale\n/);
  assert.doesNotMatch(JSON.stringify(lead.json), /margine|Prova Guida|Guida/, "mai «Solo Lateral Space», mai un nome");
  assert.equal(((lead.json.dati as Row).contesto as { caseFacts: unknown[] }).caseFacts.length, 1);
  const owner = await call("context?caso=XX-0012&strato=contesto", { token: tokens.owner });
  assert.equal(owner.status, 200);
  assert.equal(owner.json.testo, lead.json.testo, "lo stesso testo per tutti");
  const since = await call("context?caso=XX-0012&strato=contesto&dal=2026-11-01", { token: tokens.lead });
  assert.match(String(since.json.testo), /\n\nDal 01\/11\/2026: 2 fatti nuovi\.\n/, "il fatto «Solo Lateral Space» non si conta");
  // L'MCP del caso: lo stesso testo e gli stessi dati con `layer: "contesto"`, anche con `since`.
  const scoped = String((await post("token-caso", tokens.lead!, { caso: "XX-0012" })).json.token);
  const layer = await caseTool(scoped, "get_case_context", { layer: "contesto" });
  assert.equal(layer.isError, false);
  assert.equal(layer.text, lead.json.testo);
  assert.deepEqual((layer.data.dati as Row).contesto, (lead.json.dati as Row).contesto);
  assert.equal((await caseTool(scoped, "get_case_context", { layer: "contesto", since: "2026-11-01" })).text, since.json.testo);
});

test("il brief e il pacchetto: quanti fatti senza pacchetto; CONTESTO.md senza «Solo Lateral Space» né nomi; le novità dopo il pacchetto", opts, async () => {
  const before = await call("context?caso=XX-0012", { token: tokens.lead });
  assert.match(String(before.json.testo), /\nContesto: 2 fatti sul cliente \(unbundle context XX-0012 --contesto\)\.\n/);
  // La CLI 1.5.0 non conosce `--contesto`: il suo brief non lo nomina.
  const old = await call("context?caso=XX-0012", { token: tokens.lead, headers: { "user-agent": "unbundle-cli/1.5.0" } });
  assert.doesNotMatch(String(old.json.testo), /\nContesto:|--contesto/);
  const target = { workspaceId: ids.ws, useCaseId: ids.useCase };
  const lead = { kind: "persona" as const, userId: ids.lead, roles: ["ls_lead" as const] };
  const card = { code: "XX-0012", title: "Preventivi dal portale", kindLabel: null, origin: null, targetQuarter: null, texts: { oggi: null, comeCambia: "Le quotazioni partono dal portale.", persone: null, limiti: null, dati: null }, benefits: [], costText: null };
  const k1 = await factory.savePackageVersion(exec, lead, target, { generated: await factory.packageSourceFor(exec, target, card, { canSeeNeeds: true }) });
  assert.deepEqual(k1, { ok: true, value: { version: 1, created: true } });
  const pack = await call("pacchetto?caso=XX-0012", { token: tokens.lead });
  assert.equal(pack.status, 200);
  const files = pack.json.file as Record<string, string>;
  assert.deepEqual(Object.keys(files).sort(), ["BRIEF.md", "CONTESTO.md", "PACCHETTO.md", "VERSIONE"], "unbundle start riceve anche CONTESTO.md");
  assert.match(files["CONTESTO.md"], /^# Contesto del cliente per XX-0012 \(k1\)\n/);
  assert.match(files["CONTESTO.md"], /\n- Il gestionale esporta i preventivi solo in CSV, ogni notte\. \(call del 14\/11\/2026\)\n/);
  assert.match(files["CONTESTO.md"], /\n- Le eccezioni sui preventivi le approva una persona\. \(scritto a mano\)\n/);
  assert.doesNotMatch(files["CONTESTO.md"], /margine|Guida|Inviare l'esportazione|Chi approva/, "niente «Solo Lateral Space», nomi, impegni o domande");
  // Subito dopo il pacchetto niente riga; un fatto nuovo la fa tornare, e fa nascere k2 al prossimo «Aggiorna il pacchetto».
  assert.doesNotMatch(String((await call("context?caso=XX-0012", { token: tokens.lead })).json.testo), /\nContesto:/);
  await insertFact({ statement: "I preventivi sopra 50.000 € li firma la direzione." });
  assert.match(String((await call("context?caso=XX-0012", { token: tokens.lead })).json.testo), /\nContesto: 1 novità dopo il pacchetto k1 \(unbundle context XX-0012 --contesto\)\.\n/);
  const k2 = await factory.savePackageVersion(exec, lead, target, { generated: await factory.packageSourceFor(exec, target, card, { canSeeNeeds: true }) });
  assert.deepEqual(k2, { ok: true, value: { version: 2, created: true } });
  const same = await factory.savePackageVersion(exec, lead, target, { generated: await factory.packageSourceFor(exec, target, card, { canSeeNeeds: true }) });
  assert.deepEqual(same, { ok: true, value: { version: 2, created: false } }, "lo stesso contesto non fa una versione");
  // Un fatto «Solo Lateral Space» nuovo non cambia il pacchetto.
  await insertFact({ statement: "Il listino riservato cambia a gennaio.", visibility: "ls" });
  assert.deepEqual(await factory.savePackageVersion(exec, lead, target, { generated: await factory.packageSourceFor(exec, target, card, { canSeeNeeds: true }) }), { ok: true, value: { version: 2, created: false } });
});

test("`impara`: una proposta «Solo Lateral Space» da chi costruisce, mai preselezionata; già proposta; riconferma; il cliente 403", opts, async () => {
  const body = { caso: "XX-0012", testo: "I preventivi urgenti partono entro due ore dalla richiesta.", sezione: "lavoro", confermato: true };
  const k = key();
  const learned = await post("impara", tokens.lead!, body, k);
  assert.equal(learned.status, 200, JSON.stringify(learned.json));
  assert.equal(learned.json.testo, "Salvato come proposta: Lateral Space la controlla prima che entri nella memoria del cliente.");
  const proposal = String((learned.json.dati as Row).proposta);
  const [row] = await q(
    `SELECT p.status, p.kind, p.basis, p.section, p.visibility, p.use_case_ids::text[] AS use_cases, s.origin, s.kind AS source_kind, s.read_status, s.external_id LIKE 'impara:%' AS learned
     FROM context_proposals p JOIN context_sources s ON s.id = p.source_id WHERE p.id = $1::uuid AND p.workspace_id = $2::uuid`,
    [proposal, ids.ws],
  );
  assert.deepEqual(row, { status: "aperta", kind: "nuovo", basis: "detto", section: "lavoro", visibility: "ls", use_cases: [ids.useCase], origin: "cli", source_kind: "appunti", read_status: "letto", learned: true });
  const repeated = await post("impara", tokens.lead!, body, k);
  assert.deepEqual([repeated.status, repeated.json.ripetuta, (repeated.json.dati as Row).proposta], [200, true, proposal], "la stessa richiesta risponde come la prima");
  const again = await post("impara", tokens.lead!, body);
  assert.deepEqual(again.json.dati, { esito: "gia_proposta", proposta: null });
  const known = await post("impara", tokens.lead!, { caso: "XX-0012", testo: SHARED, confermato: true });
  assert.equal(known.json.testo, "Lo sappiamo già: ho chiesto di riconfermarlo.");
  const [reconfirm] = await q(`SELECT kind, target_fact_id FROM context_proposals WHERE id = $1::uuid`, [(known.json.dati as Row).proposta]);
  assert.deepEqual(reconfirm, { kind: "conferma", target_fact_id: sharedFact });
  const client = await post("impara", tokens.owner!, { ...body, testo: "Le quotazioni si rifanno ogni lunedì mattina." });
  assert.equal(client.status, 403);
  const noYes = await post("impara", tokens.lead!, { ...body, confermato: false });
  assert.deepEqual([noYes.status, (noYes.json.errore as Row).codice], [400, "conferma"]);
  const named = await post("impara", tokens.lead!, { ...body, testo: "Le quotazioni le prepara lead@esempio.test ogni lunedì." });
  assert.equal(named.status, 422);
});

test("`nota`: solo Lateral Space; appunti con l'origine `cli`; senza l'ok nessuna lettura; gli stessi appunti ci sono già", opts, async () => {
  const note = { titolo: "Call di prova CLI", data: "2026-11-15", testo: "Appunti di prova: il portale manda le richieste di preventivo ogni mattina alle sette." };
  const client = await post("nota", tokens.owner!, note);
  assert.deepEqual([client.status, (client.json.errore as Row).codice], [403, "solo_lateral_space"]);
  const saved = await post("nota", tokens.lead!, note);
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(saved.json.testo, "Appunti salvati. Per leggerli con l'AI serve l'ok del cliente ai fornitori: si registra da Unbundle.");
  const dati = saved.json.dati as Row;
  assert.equal(dati.nuova, true);
  assert.equal(dati.link, `http://127.0.0.1:53110/dashboard/${ids.ws}/contesto?vista=appunti&fonte=${dati.fonte}`);
  assert.equal(queuedAfter().length, 0, "senza l'ok la lettura non parte");
  const [row] = await q(`SELECT kind, origin, visibility, read_status, title, occurred_on::text AS day, added_by_user_id FROM context_sources WHERE id = $1::uuid AND workspace_id = $2::uuid`, [dati.fonte, ids.ws]);
  assert.deepEqual(row, { kind: "appunti", origin: "cli", visibility: "ls", read_status: "da_leggere", title: "Call di prova CLI", day: "2026-11-15", added_by_user_id: ids.lead });
  const duplicate = await post("nota", tokens.lead!, { ...note, titolo: "Lo stesso testo, un altro titolo" });
  assert.equal(duplicate.json.testo, `Questi appunti ci sono già: http://127.0.0.1:53110/dashboard/${ids.ws}/contesto?vista=appunti&fonte=${dati.fonte}`);
  const tooBig = await post("nota", tokens.lead!, { ...note, testo: "a".repeat(600 * 1024 + 1) });
  assert.equal(tooBig.status, 413);
  assert.equal((await post("nota", tokens.lead!, note, null)).status, 400, "senza Idempotency-Key");
});

test("`contesto`: senza l'ok i brani, solo «Per tutti» anche a Lateral Space: niente appunti né fatti riservati", opts, async () => {
  const asked = await call("contesto", { method: "POST", token: tokens.lead, body: { caso: "XX-0012", domanda: "Come esportano i preventivi dal gestionale?" } });
  assert.equal(asked.status, 200, JSON.stringify(asked.json));
  const dati = asked.json.dati as { stato: string; fonti: Array<{ tipo: string; brano: string }> };
  assert.equal(dati.stato, "solo_ricerca");
  assert.match(String(asked.json.testo), /^Per una risposta scritta serve l'ok del cliente ai fornitori di AI\. Ecco che cosa ho trovato:\n\[1\] Fatto · /);
  // Un fatto dice la sua fonte come CONTESTO.md: «call del 14/11/2026», con l'anno.
  assert.match(String(asked.json.testo), /\n\[\d+\] Fatto · call del 14\/11\/2026 · Il gestionale esporta i preventivi solo in CSV, ogni notte\./);
  assert.ok(dati.fonti.some((f) => f.brano === SHARED));
  assert.ok(dati.fonti.every((f) => f.tipo !== "appunti"), "mai gli appunti");
  assert.doesNotMatch(JSON.stringify(asked.json), /margine|Guida/, "mai un fatto «Solo Lateral Space», mai un nome");
  const outside = await call("contesto", { method: "POST", token: tokens.lead, body: { caso: "XX-9999", domanda: "Come esportano i preventivi?" } });
  assert.equal(outside.status, 404);
});
