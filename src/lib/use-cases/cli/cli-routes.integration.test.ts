import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import * as nodeModule from "node:module";
/** `module.registerHooks` di Node 24 (i tipi di @types/node del progetto non lo hanno ancora). */
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?(specifier: string, context: object, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult }): void;
};

// Le rotte vere della CLI (rilascio 8.0b) sul database del pacchetto: login dal browser fino al token, contesto,
// impostazione guidata, decisioni, domande proposte, repository, sessioni, token di un caso solo, logout. Ogni
// richiesta con il suo ruolo nel caso: il team di Lateral Space scrive, il responsabile del cliente legge, chi non
// è nel team non vede il caso. Le scritture ripetute rispondono come la prima. Mai un nome nel contesto.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su 127.0.0.1).
//   Dati sintetici, creati e cancellati qui. I token non si stampano mai.
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
const ids = {
  org: randomUUID(),
  ws: randomUUID(),
  template: randomUUID(),
  useCase: randomUUID(),
  bare: randomUUID(),
  dossier: randomUUID(),
  lead: randomUUID(),
  analyst: randomUUID(),
  owner: randomUUID(),
  outsider: randomUUID(),
};
type Person = "lead" | "analyst" | "owner" | "outsider";
const EMAIL: Record<Person, string> = {
  lead: `lead-${suffix}@ls.test`,
  analyst: `analista-${suffix}@ls.test`,
  owner: `owner-${suffix}@cliente.test`,
  outsider: `estraneo-${suffix}@cliente.test`,
};
const NAME: Record<Person, string> = { lead: "Lucia Guida", analyst: "Andrea Analisi", owner: "Olga Cliente", outsider: "Ettore Esterno" };
const tokens: Partial<Record<Person, string>> = {};
let keySeq = 0;
const key = () => `cli-${suffix}-${++keySeq}`;

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

async function tokenFor(person: Person): Promise<string> {
  const started = await auth.startCliLogin(exec, { clientLabel: `CLI di prova ${suffix}` });
  const decided = await auth.decideCliLogin(exec, { userCode: started.userCode, userId: ids[person], workspaceId: ids.ws, confirm: true });
  assert.ok(decided.ok);
  const delivered = await auth.deliverCliLogin(exec, started.deviceCode);
  assert.equal(delivered.status, "consegnato");
  return (delivered as { token: string }).token;
}

before(async () => {
  if (!enabled) return;
  const stub = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
  const stubs: Record<string, string> = {
    "next/cache": stub("export function revalidatePath() {}\nexport function revalidateTag() {}\nexport function unstable_cache(fn) { return fn; }\nexport function unstable_noStore() {}"),
    "next/server": stub("export function after(task) { (globalThis.__cliAfter ??= []).push(task); }"),
    // La sessione della prova per le action della scheda («Proposte dei coding agent»).
    "@/lib/auth": stub("export async function auth() { return globalThis.__cliSession ?? null; }"),
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
  for (const name of ["login", "login/token", "whoami", "logout", "context", "setup", "pacchetto", "decisioni", "domande", "repository", "sessioni", "token-caso", "mcp"]) {
    routes[name] = await import(`../../../app/api/cli/${name}/route.ts`);
  }

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova CLI', $2)`, [ids.org, `org-cli-r-${suffix}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Workspace di prova CLI')`, [ids.ws, ids.org]);
  const role: Record<Person, string> = { lead: "transformation_lead", analyst: "analyst", owner: "contributor", outsider: "contributor" };
  for (const person of Object.keys(EMAIL) as Person[]) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, $3, now())`, [ids[person], EMAIL[person], NAME[person]]);
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ids.ws, ids[person], role[person]]);
  }
  await q(`INSERT INTO use_cases (id, workspace_id, title, code) VALUES ($1, $3, 'Smistamento di prova', 'PX-0042'), ($2, $3, 'Scheda senza dossier', 'PX-0043')`, [ids.useCase, ids.bare, ids.ws]);
  await q(
    `INSERT INTO uc_templates (id, key, version, name, archetype, definition, definition_hash, restricted_to_workspace_id)
     VALUES ($1::uuid, $2, '1.0.0', 'Template di prova CLI', 'prova', '{"confidential": false}'::jsonb, $3, $4::uuid)`,
    [ids.template, `prova.cli_${suffix}`, randomBytes(32).toString("hex"), ids.ws],
  );
  await q(
    `INSERT INTO uc_cases (id, workspace_id, organization_id, portfolio_use_case_id, template_id, template_version, code, title, status, setup_completed_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, '1.0.0', $6, 'Dossier di prova CLI', 'pronto_sviluppo', now())`,
    [ids.dossier, ids.ws, ids.org, ids.useCase, ids.template, `CLI-${suffix.toUpperCase()}`],
  );
  for (const [person, caseRole] of [["lead", "ls_lead"], ["analyst", "ls_analista"], ["owner", "owner_cliente"]] as const) {
    await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, $3)`, [ids.dossier, ids[person], caseRole]);
  }
});

after(async () => {
  if (!enabled) return;
  await q(`DELETE FROM use_case_cli_logins WHERE client_label LIKE $1`, [`%${suffix}%`]);
  await q(`DELETE FROM workspaces WHERE id = $1`, [ids.ws]);
  await q(`DELETE FROM uc_templates WHERE id = $1`, [ids.template]);
  await q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.lead, ids.analyst, ids.owner, ids.outsider]]);
});

test("il login vero: codice, conferma, token una volta; difese su indirizzo e browser", opts, async () => {
  const started = await call("login", { method: "POST", body: { etichetta: `CLI di prova ${suffix} · macOS` } });
  assert.equal(started.status, 200);
  assert.match(String(started.json.codice), /^[A-Z]{4}-[A-Z]{4}$/);
  assert.equal(started.json.url, `http://127.0.0.1:53110/cli/collega?codice=${started.json.codice}`);
  assert.equal((await call("login/token", { method: "POST", body: { codiceDispositivo: started.json.codiceDispositivo } })).json.stato, "in_attesa");
  assert.ok((await auth.decideCliLogin(exec, { userCode: started.json.codice, userId: ids.lead, workspaceId: ids.ws, confirm: true })).ok);
  const got = await call("login/token", { method: "POST", body: { codiceDispositivo: started.json.codiceDispositivo } });
  assert.equal(got.json.stato, "consegnato");
  tokens.lead = String(got.json.token);
  assert.equal((await call("login/token", { method: "POST", body: { codiceDispositivo: started.json.codiceDispositivo } })).json.stato, "gia_consegnato");
  const me = await call("whoami", { token: tokens.lead });
  assert.deepEqual([me.status, (me.json.persona as Row).nome, me.json.ruolo, me.json.caso], [200, NAME.lead, "transformation_lead", null]);
  assert.ok(!JSON.stringify(me.json).includes("@"), "mai l'e-mail");
  // Un browser non chiama la CLI; un token nell'indirizzo si blocca e non vale più.
  const browser = await routes.whoami.GET!(new Request("http://127.0.0.1:53110/api/cli/whoami", { headers: { authorization: `Bearer ${tokens.lead}`, origin: "https://esempio.test" } }));
  assert.equal(browser.status, 403);
  const leaked = await tokenFor("lead");
  const inUrl = await routes.whoami.GET!(new Request(`http://127.0.0.1:53110/api/cli/whoami?token=${leaked}`, { headers: { authorization: `Bearer ${leaked}` } }));
  assert.equal(inUrl.status, 400);
  assert.equal((await call("whoami", { token: leaked })).status, 401, "esposto: non vale più");
  assert.equal((await call("whoami")).status, 401);
});

test("contesto: il brief prima dell'impostazione, poi il giro guidato fino all'invio, con le ripetizioni", opts, async () => {
  tokens.analyst = await tokenFor("analyst");
  const first = await call("context?caso=px-0042", { token: tokens.analyst });
  assert.equal(first.status, 200);
  assert.match(String(first.json.testo), /^PX-0042 · Smistamento di prova\nDossier: Pronto per lo sviluppo\. Progetto: non ancora impostato\.\nProssimo passo: impostare il caso/);
  assert.equal((await call("context?caso=PX-9999", { token: tokens.analyst })).status, 404);
  assert.equal((await call("context?caso=PX-0043", { token: tokens.analyst })).json.errore && (await call("context?caso=PX-0043", { token: tokens.analyst })).status, 409, "senza dossier");
  const k = key();
  const opened = await post("setup", tokens.analyst, { caso: "PX-0042", azione: "apri" }, k);
  assert.deepEqual([opened.status, opened.json.versione, opened.json.creata], [200, 1, true]);
  assert.equal((await post("setup", tokens.analyst, { caso: "PX-0042", azione: "apri" }, k)).json.ripetuta, true, "la stessa richiesta risponde come la prima");
  assert.equal((await post("setup", tokens.analyst, { caso: "PX-0042", azione: "scelta", argomento: "dati", scelta: "x" }, k)).status, 409, "stessa chiave, corpo diverso");
  assert.equal((await post("setup", tokens.analyst, { caso: "PX-0042", azione: "apri" }, null)).status, 400, "senza chiave");
  const guide = await call("setup?caso=PX-0042", { token: tokens.analyst });
  assert.equal((guide.json.argomenti as Row[]).length, 10);
  assert.ok((guide.json.argomenti as Row[]).every((a) => typeof a.guida === "string" && a.scelta === null));
  for (const a of guide.json.argomenti as Row[]) {
    const saved = await post("setup", tokens.analyst, { caso: "PX-0042", azione: "scelta", argomento: a.chiave, scelta: `Scelta per ${a.chiave}`, perche: "Il consiglio della guida" });
    assert.equal(saved.status, 200, String(a.chiave));
  }
  assert.equal((await post("setup", tokens.analyst, { caso: "PX-0042", azione: "dettagli", strumentiNuovi: [], ore: 40, euroAlMese: 20 })).status, 200);
  const before = await call("setup?caso=PX-0042", { token: tokens.analyst });
  const revision = (before.json.progetto as Row).revisione;
  assert.equal((await post("setup", tokens.analyst, { caso: "PX-0042", azione: "invia", revisione: Number(revision) - 1 })).status, 409, "una revisione vecchia no");
  const sent = await post("setup", tokens.analyst, { caso: "PX-0042", azione: "invia", revisione: revision });
  assert.deepEqual([sent.status, sent.json.versione], [200, 1]);
  const bell = await q(`SELECT recipient_user_id FROM use_case_notifications WHERE use_case_id = $1 AND kind = 'progetto_appr'`, [ids.useCase]);
  assert.deepEqual(bell.map((r) => r.recipient_user_id), [ids.lead]);
  const after = await call("context?caso=PX-0042", { token: tokens.analyst });
  assert.match(String(after.json.testo), /Prossimo passo: aspettare l'approvazione del responsabile del caso\./);
  const layer = await call("context?caso=PX-0042&strato=progetto", { token: tokens.analyst });
  assert.match(String(layer.json.testo), /## Evals e autonomia\nScelta per evals_autonomia/);
  assert.equal((await call("context?caso=PX-0042&strato=altro", { token: tokens.analyst })).status, 400);
});

test("decisioni, domande proposte, repository, sessioni: scrive il team; la campanella al responsabile; mai un nome", opts, async () => {
  const named = await post("decisioni", tokens.analyst!, { caso: "PX-0042", argomento: "Lingua", decisione: `Le bozze le rilegge ${NAME.owner} prima dell'invio`, perche: "Serve un controllo" });
  assert.equal(named.status, 400, "un nome in un testo del team si ferma prima");
  const decided = await post("decisioni", tokens.analyst!, { caso: "PX-0042", argomento: "Lingua", decisione: "Le bozze le rilegge il commerciale prima dell'invio", perche: "Serve un controllo" });
  assert.equal(decided.status, 200);
  // Un testo con un nome arrivato da un import di prima: il brief lo copre comunque.
  await q(`INSERT INTO use_case_decisions (use_case_id, workspace_id, decided_on, topic, choice, source, author_role) VALUES ($1, $2, current_date, 'Revisione', $3, 'importata', 'prova')`, [
    ids.useCase,
    ids.ws,
    `Le eccezioni le decide ${NAME.owner}`,
  ]);
  const brief = String((await call("context?caso=PX-0042", { token: tokens.analyst })).json.testo);
  assert.match(brief, /Lingua · Le bozze le rilegge il commerciale prima dell'invio/);
  assert.match(brief, /Revisione · Le eccezioni le decide una persona/);
  for (const person of Object.values(NAME)) assert.ok(!brief.includes(person) && !brief.includes(person.split(" ")[0]), person);
  const asked = await post("domande", tokens.analyst!, { caso: "PX-0042", domanda: "Chi approva le eccezioni di prezzo?", perche: "Serve per la regola 4" });
  assert.equal(asked.status, 200);
  const [question] = await q(`SELECT status, channel, author_user_id FROM use_case_agent_questions WHERE id = $1`, [asked.json.id]);
  assert.deepEqual([question.status, question.channel, question.author_user_id], ["proposta", "cli", ids.analyst]);
  const notice = await q(`SELECT recipient_user_id FROM use_case_notifications WHERE use_case_id = $1 AND kind = 'domanda_agente'`, [ids.useCase]);
  assert.deepEqual(notice.map((r) => r.recipient_user_id), [ids.lead], "al responsabile, non a chi l'ha proposta");
  assert.match(String((await call("context?caso=PX-0042&strato=domande", { token: tokens.analyst })).json.testo), /Chi approva le eccezioni di prezzo\?/);
  const repo = await post("repository", tokens.analyst!, { caso: "PX-0042", repository: "Prova/repo-di-prova", cartella: "casi/px-0042", profilo: "codice" });
  assert.deepEqual([repo.status, repo.json.nuovo], [200, true]);
  assert.equal((await post("repository", tokens.analyst!, { caso: "PX-0042", repository: "Prova/repo-di-prova", cartella: "casi/px-0042", progettoVercel: "px-0042-agente" })).json.nuovo, false);
  assert.equal((await post("repository", tokens.analyst!, { caso: "PX-0042", repository: "nome-senza-owner", cartella: "casi/px-0042" })).status, 400);
  const ctx = await call("context?caso=PX-0042", { token: tokens.analyst });
  assert.deepEqual((ctx.json.dati as Row).repository, [{ repo: "Prova/repo-di-prova", folder: "casi/px-0042", profile: "codice", vercelProject: "px-0042-agente" }]);
  const session = { caso: "PX-0042", chiaveSessione: "c".repeat(64), compito: "T-1", harness: "claude_code", modello: "claude-sonnet-4-5", tokenIngresso: 1000, tokenUscita: 200, durataSecondi: 600, esito: "commit", finitaIl: new Date().toISOString() };
  assert.deepEqual((await post("sessioni", tokens.analyst!, session, null)).json, { registrata: true, ripetuta: false });
  assert.deepEqual((await post("sessioni", tokens.analyst!, session, null)).json, { registrata: false, ripetuta: true });
  assert.equal((await post("sessioni", tokens.analyst!, { ...session, harness: "vim" }, null)).status, 400);
  const [row] = await q(`SELECT * FROM use_case_build_sessions WHERE use_case_id = $1`, [ids.useCase]);
  assert.ok(!Object.keys(row).some((k) => /user|author|actor/.test(k)), "nessuna colonna sulla persona");
});

test("il responsabile del cliente legge e non scrive; chi non è nel team non vede il caso; il pacchetto solo al team di Lateral Space", opts, async () => {
  tokens.owner = await tokenFor("owner");
  tokens.outsider = await tokenFor("outsider");
  assert.equal((await call("context?caso=PX-0042", { token: tokens.owner })).status, 200);
  const denied = await post("decisioni", tokens.owner, { caso: "PX-0042", argomento: "Prova", decisione: "Non dovrebbe passare" });
  assert.equal(denied.status, 403);
  assert.equal((await call("pacchetto?caso=PX-0042", { token: tokens.owner })).status, 403);
  assert.equal((await call("context?caso=PX-0042", { token: tokens.outsider })).status, 404);
  assert.equal((await call("pacchetto?caso=PX-0042", { token: tokens.analyst })).json.errore && (await call("pacchetto?caso=PX-0042", { token: tokens.analyst })).status, 404, "nessun pacchetto ancora");
  const actor = { kind: "script" as const, authorRole: "prova" };
  await factory.savePackageVersion(exec, actor, { workspaceId: ids.ws, useCaseId: ids.useCase }, { imported: { "PACCHETTO.md": "# Pacchetto di prova", "BRIEF.md": "Brief di prova", VERSIONE: "k1 · prova" } });
  const pkg = await call("pacchetto?caso=PX-0042", { token: tokens.analyst });
  assert.deepEqual([pkg.status, pkg.json.versione, Object.keys(pkg.json.file as Row).sort()], [200, 1, ["BRIEF.md", "PACCHETTO.md", "VERSIONE"]]);
});

test("il token di un caso solo: lo crea un token di tutti i casi; apre solo quel caso; non ne crea altri; logout", opts, async () => {
  const created = await post("token-caso", tokens.lead!, { caso: "PX-0042" });
  assert.equal(created.status, 200);
  const scoped = String(created.json.token);
  assert.equal((await call("context?caso=PX-0042", { token: scoped })).status, 200);
  assert.equal((await call("whoami", { token: scoped })).json.caso, "PX-0042");
  assert.equal((await call("context?caso=PX-0043", { token: scoped })).status, 404, "un altro caso no");
  assert.equal((await post("token-caso", scoped, { caso: "PX-0042" })).status, 403, "non si moltiplica");
  assert.equal((await post("token-caso", tokens.owner!, { caso: "PX-0042" })).status, 403, "solo il team di Lateral Space");
  assert.deepEqual((await post("logout", scoped, {})).json, { revocato: true });
  assert.equal((await call("whoami", { token: scoped })).status, 401);
  assert.equal((await call("whoami", { token: tokens.lead })).status, 200, "il token di tutti i casi resta");
});

const sessionOf = (person: Person) => ({ user: { id: ids[person], email: EMAIL[person], emailVerified: true, name: NAME[person], image: null } });

test("le proposte nella scheda: «Aggiungi a Cosa serve» crea un requisito da chiedere, una volta sola; «Lascia stare»; e-mail una al giorno", opts, async () => {
  const actions = await import("../../actions/use-case-agent-questions.ts");
  const reads = await import("../../db/queries/use-case-agent-questions.ts");
  const first = await post("domande", tokens.analyst!, { caso: "PX-0042", domanda: "Chi firma le quotazioni oltre i 50.000 €?" });
  const second = await post("domande", tokens.analyst!, { caso: "PX-0042", domanda: "Le richieste del sabato vanno lette subito?" });
  assert.deepEqual([first.status, second.status], [200, 200]);
  const emails = await q(`SELECT recipient_user_id FROM uc_notifications WHERE case_id = $1 AND template_key = 'domanda_proposta'`, [ids.dossier]);
  assert.deepEqual(emails.map((r) => r.recipient_user_id), [ids.lead], "al responsabile, una al giorno anche con più proposte");
  const listed = await reads.listAgentProposals(exec, { workspaceId: ids.ws, useCaseId: ids.useCase });
  assert.ok(listed.some((p) => p.id === first.json.id) && listed.some((p) => p.id === second.json.id));
  (globalThis as { __cliSession?: unknown }).__cliSession = sessionOf("owner");
  assert.equal((await actions.addAgentQuestionAction(ids.ws, ids.useCase, String(first.json.id))).ok, false, "il responsabile del cliente non decide");
  (globalThis as { __cliSession?: unknown }).__cliSession = sessionOf("analyst");
  const added = await actions.addAgentQuestionAction(ids.ws, ids.useCase, String(first.json.id));
  assert.ok(added.ok, added.ok ? "" : added.message);
  const [row] = await q(`SELECT q.status, q.need_id, n.title, n.type, n.status AS need_status, n.owner_side,
      EXISTS (SELECT 1 FROM use_case_need_links l WHERE l.need_id = n.id AND l.use_case_id = $2) AS linked
    FROM use_case_agent_questions q JOIN use_case_needs n ON n.id = q.need_id WHERE q.id = $1`, [first.json.id, ids.useCase]);
  assert.deepEqual([row.status, row.title, row.type, row.need_status, row.owner_side, row.linked], ["aggiunta", "Chi firma le quotazioni oltre i 50.000 €?", "requisito", "da_chiedere", "cliente", true]);
  assert.equal((await actions.addAgentQuestionAction(ids.ws, ids.useCase, String(first.json.id))).ok, false, "una volta sola");
  const [needs] = [await q(`SELECT count(*)::int AS n FROM use_case_needs WHERE title = 'Chi firma le quotazioni oltre i 50.000 €?'`)];
  assert.equal(needs[0].n, 1);
  assert.ok((await actions.dismissAgentQuestionAction(ids.ws, ids.useCase, String(second.json.id))).ok);
  const after = await reads.listAgentProposals(exec, { workspaceId: ids.ws, useCaseId: ids.useCase });
  assert.ok(!after.some((p) => p.id === first.json.id || p.id === second.json.id), "decise: non sono più da decidere");
  delete (globalThis as { __cliSession?: unknown }).__cliSession;
});

// ─── L'MCP del caso ──────────────────────────────────────────────────

let rpcSeq = 0;
async function mcp(token: string | null, message: unknown, init: { headers?: Record<string, string>; method?: string; target?: string } = {}): Promise<{ status: number; json: Row }> {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream", ...(init.headers ?? {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  const method = init.method ?? "POST";
  const handler = (routes.mcp as Record<string, Handler>)[method];
  const response = await handler(new Request(init.target ?? "http://127.0.0.1:53110/api/cli/mcp", { method, headers, body: method === "POST" ? JSON.stringify(message) : undefined }));
  const text = await response.text();
  return { status: response.status, json: text ? (JSON.parse(text) as Row) : {} };
}
const rpc = (method: string, params: Row = {}) => ({ jsonrpc: "2.0", id: ++rpcSeq, method, params });
async function tool(token: string, name: string, args: Row): Promise<{ isError: boolean; data: Row; text: string }> {
  const r = await mcp(token, rpc("tools/call", { name, arguments: args }));
  assert.equal(r.status, 200, `${name}: HTTP ${r.status}`);
  const result = r.json.result as { isError?: boolean; structuredContent: Row; content: Array<{ text: string }> };
  return { isError: result.isError === true, data: result.structuredContent, text: result.content[0].text };
}

test("l'MCP del caso: solo il token di un caso; contesto e decisioni; scritture con il sì e la chiave; la sessione una volta; chi esce dal team non entra", opts, async () => {
  const scoped = String((await post("token-caso", tokens.lead!, { caso: "PX-0042" })).json.token);
  const init = rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "prova", version: "1.0.0" } });

  // Ingresso: il token di tutti i casi no, il browser no, il token nell'indirizzo no, solo POST.
  assert.equal((await mcp(tokens.analyst!, init)).status, 403, "serve il token di un caso solo");
  assert.equal((await mcp(null, init)).status, 401);
  assert.equal((await mcp(scoped, init, { headers: { origin: "https://esempio.test" } })).status, 403);
  assert.equal((await mcp(null, init, { method: "GET" })).status, 405);
  const started = await mcp(scoped, init);
  assert.equal(started.status, 200);
  const server = started.json.result as Row;
  assert.equal((server.serverInfo as Row).name, "unbundle-caso");
  assert.match(String(server.instructions), /il caso PX-0042/);
  const listed = await mcp(scoped, rpc("tools/list"));
  assert.deepEqual(((listed.json.result as Row).tools as Row[]).map((t) => t.name), ["get_case_context", "list_decisions", "record_decision", "propose_question", "report_session"]);

  // Letture: il brief e le decisioni, mai un nome né un'e-mail.
  const brief = await tool(scoped, "get_case_context", {});
  assert.equal(brief.isError, false);
  assert.match(brief.text, /^PX-0042 · Smistamento di prova/);
  assert.equal(brief.data.caso, "PX-0042");
  const layer = await tool(scoped, "get_case_context", { layer: "progetto" });
  assert.match(layer.text, /PX-0042/);
  assert.equal((await tool(scoped, "get_case_context", { layer: "tutto" })).data.error, "invalid_payload");

  // La decisione: senza il sì no; con il sì e la chiave una volta sola; la stessa chiave per un'altra cosa no.
  const choice = { topic: "Lingua delle risposte", choice: "Le risposte in inglese", reason: "Gli ospiti sono esteri", idempotencyKey: `mcp-${suffix}-d1` };
  assert.equal((await tool(scoped, "record_decision", choice)).data.error, "conferma_mancante");
  const logged: string[] = [];
  const realInfo = console.info;
  console.info = (...parts: unknown[]) => void logged.push(parts.map(String).join(" "));
  let saved: Awaited<ReturnType<typeof tool>>;
  try {
    saved = await tool(scoped, "record_decision", { ...choice, confirmedByUser: true });
  } finally {
    console.info = realInfo;
  }
  assert.equal(saved.isError, false, saved.text);
  assert.deepEqual([saved.data.registrata, saved.data.ripetuta], [true, false]);
  const again = await tool(scoped, "record_decision", { ...choice, confirmedByUser: true });
  assert.deepEqual([again.data.id, again.data.ripetuta], [saved.data.id, true], "la stessa richiesta risponde come la prima");
  assert.equal((await tool(scoped, "record_decision", { ...choice, choice: "In italiano", confirmedByUser: true })).data.error, "idempotenza");
  const [decided] = await q(`SELECT source, author_user_id, choice FROM use_case_decisions WHERE id = $1`, [saved.data.id]);
  assert.deepEqual([decided.source, decided.author_user_id, decided.choice], ["team", ids.lead, "Le risposte in inglese"]);
  const line = logged.find((l) => l.includes('"case-mcp"') && l.includes("record_decision"));
  assert.ok(line, "una riga di log per la chiamata");
  assert.ok(!logged.some((l) => l.includes(scoped) || l.includes("inglese") || l.includes("@")), "mai token, testi o e-mail nel log");
  const decisions = await tool(scoped, "list_decisions", {});
  assert.match(decisions.text, /Lingua delle risposte · Le risposte in inglese/);
  assert.ok(![...Object.values(NAME), ...Object.values(EMAIL)].some((n) => decisions.text.includes(n) || brief.text.includes(n)));

  // La domanda proposta: dal canale mcp, da decidere in Unbundle.
  const asked = await tool(scoped, "propose_question", { question: "Le quotazioni del weekend partono lunedì?", reason: "Per il calendario degli invii", idempotencyKey: `mcp-${suffix}-q1` });
  assert.equal(asked.isError, false, asked.text);
  const [question] = await q(`SELECT channel, status, author_user_id FROM use_case_agent_questions WHERE id = $1`, [asked.data.id]);
  assert.deepEqual([question.channel, question.status, question.author_user_id], ["mcp", "proposta", ids.lead]);

  // La sintesi della sessione: solo l'impronta dell'id, una volta sola.
  const session = { sessionId: `sessione-${suffix}-mcp`, harness: "codex", durationSeconds: 900, outcome: "commit", endedAt: new Date().toISOString(), outputTokens: 4000 };
  assert.deepEqual((await tool(scoped, "report_session", session)).data, { registrata: true, ripetuta: false });
  assert.deepEqual((await tool(scoped, "report_session", session)).data, { registrata: false, ripetuta: true });
  const sessions = await q(`SELECT session_key, output_tokens::int AS out FROM use_case_build_sessions WHERE use_case_id = $1 AND harness = 'codex'`, [ids.useCase]);
  assert.deepEqual(sessions.map((r) => [r.session_key, r.out]), [[createHash("sha256").update(session.sessionId).digest("hex"), 4000]]);
  assert.equal((await tool(scoped, "report_session", { ...session, pr: "https://example.test/pull/1" })).data.error, "invalid_payload");

  // Il responsabile del cliente con un token del caso (non lo crea la rotta, qui a mano): legge, non scrive.
  const ownerPrincipal = await auth.authenticateCli(exec, `Bearer ${tokens.owner}`);
  assert.ok(ownerPrincipal);
  const ownerCase = await auth.createCaseCliToken(exec, ownerPrincipal, { useCaseId: ids.useCase, label: `MCP di prova ${suffix}` });
  assert.ok(ownerCase.ok);
  if (ownerCase.ok) {
    assert.equal((await tool(ownerCase.value.token, "get_case_context", {})).isError, false);
    assert.equal((await tool(ownerCase.value.token, "propose_question", { question: "Va bene così?", idempotencyKey: `mcp-${suffix}-o1` })).data.error, "permesso_negato");
  }

  // Un token nell'indirizzo si blocca; chi esce dal team del caso non entra più, anche con il token.
  const leaked = String((await post("token-caso", tokens.lead!, { caso: "PX-0042" })).json.token);
  assert.equal((await mcp(leaked, init, { target: `http://127.0.0.1:53110/api/cli/mcp?token=${leaked}` })).status, 400);
  assert.equal((await mcp(leaked, init)).status, 401, "esposto: non vale più");
  const analystScoped = String((await post("token-caso", tokens.analyst!, { caso: "PX-0042" })).json.token);
  await q(`DELETE FROM uc_case_members WHERE case_id = $1 AND user_id = ANY($2::uuid[])`, [ids.dossier, [ids.lead, ids.analyst]]);
  try {
    assert.equal((await mcp(analystScoped, init)).status, 404, "fuori dal team: il caso non c'è più");
    assert.equal((await tool(scoped, "get_case_context", {})).isError, false, "chi gestisce il workspace resta osservatore del dossier");
    assert.equal((await tool(scoped, "propose_question", { question: "Si può?", idempotencyKey: `mcp-${suffix}-l2` })).data.error, "permesso_negato", "osservatore: non scrive");
  } finally {
    await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, 'ls_lead'), ($1, $3, 'ls_analista')`, [ids.dossier, ids.lead, ids.analyst]);
  }
});
