import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import * as nodeModule from "node:module";
/** `module.registerHooks` di Node 24 (i tipi di @types/node del progetto non lo hanno ancora). */
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?(specifier: string, context: object, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult }): void;
};

// L'API della CI sul database del pacchetto (rilascio 8.2b, RILASCIO-8.2b-SPEC.md §2.2, §2.3, §2.9, §3.2), dalle rotte
// vere `/api/ci/casi` e `/api/ci/evals` con le chiavi vere della CI (create dal modulo delle chiavi):
// - i casi del repository della chiave nel suo workspace, con il perché di chi non è aperto; l'area spenta: nessun caso;
// - 401 per una chiave mancante, inventata, di un altro tipo, revocata, scaduta, esposta o del workspace cancellato;
//   404 per un caso di un altro repository o workspace; 403 per un ramo che non è main; 409 per un caso chiuso, in
//   pausa o senza realizzazione; 400 per le regole del corpo; mai niente scritto;
// - le difese: la chiave nell'indirizzo revocata (anche con il metodo sbagliato), Origin, JSON, corpo, limiti per chiave;
// - la riga dell'esecuzione: fonte `ci`, la chiave, il link; nessuna persona; la risposta della CLI; la versione del
//   modello del repository presa da main (e `unbundle start` di una persona non la cambia); `fonte` e `ci` nella CLI;
// - gli avvisi delle evals di main dalla CI a tutto il team che costruisce, chi viene da fuori compreso (con l'ok ai
//   sub-responsabili), con la fonte e il commit nella coda dell'e-mail;
// - l'idempotenza (lo stesso invio «ripetuto», anche da un job rilanciato; un altro corpo 409) e due invii insieme dello
//   stesso caso scritti uno alla volta;
// - 503 con la 0042 non pronta, e il ritorno indietro: le istruzioni del codice di prima su un database con la 0042 e
//   righe `ci` (pagine, CLI ed evals funzionano);
// - mai `ub_ci_` nei log né nelle risposte.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su 127.0.0.1).
//   Dati sintetici, creati e cancellati qui. Le chiavi e i token non si stampano mai.
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
type Answer = { status: number; json: Row; text: string; headers: Headers };
let q: (text: string, params?: unknown[]) => Promise<Row[]>;
let exec: import("../../db/uc-executor.ts").UcExecutor;
let store: typeof import("../../db/queries/use-case-ci-keys.ts");
let auth: typeof import("../../db/queries/use-case-cli-auth.ts");
let evals: typeof import("../../db/queries/use-case-evals.ts");
let line: typeof import("../../db/queries/use-case-factory-line.ts");
let dispatch: typeof import("../../db/queries/uc-notifications-dispatch.ts");
let ciCasi: { GET: Handler; POST: Handler };
let ciEvals: { GET: Handler; POST: Handler };
let cliEvals: { GET: Handler; POST: Handler };
let cliRepository: { POST: Handler };

const suffix = randomBytes(3).toString("hex");
const SUFFIX = suffix.toUpperCase();
const LS = ["ls.test"];
const REPO = `Voltaen/esempio-rosa-${suffix}`;
const OTHER_REPO = `Voltaen/esempio-blu-${suffix}`;
const GONE_REPO = `Voltaen/esempio-verde-${suffix}`;
const ORIGIN = "http://127.0.0.1:53130";
const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const SHA2 = "0fedcba9876543210fedcba9876543210fedcba9";
const HAIKU = "anthropic/claude-haiku-5-5";
const ids = {
  org: randomUUID(),
  ws: randomUUID(),
  wsB: randomUUID(),
  wsGone: randomUUID(),
  template: randomUUID(),
  uc1: randomUUID(),
  uc2: randomUUID(),
  uc3: randomUUID(),
  uc4: randomUUID(),
  uc5: randomUUID(),
  uc6: randomUUID(),
  ucB: randomUUID(),
  ucGone: randomUUID(),
  case1: randomUUID(),
  case2: randomUUID(),
  case3: randomUUID(),
  case4: randomUUID(),
  case6: randomUUID(),
  caseB: randomUUID(),
  caseGone: randomUUID(),
  manager: randomUUID(),
  lead: randomUUID(),
  dev: randomUUID(),
  outside: randomUUID(),
  client: randomUUID(),
};
type Person = "manager" | "lead" | "dev" | "outside" | "client";
const PEOPLE: readonly Person[] = ["manager", "lead", "dev", "outside", "client"];
const EMAIL: Record<Person, string> = {
  manager: `gestione-${suffix}@ls.test`,
  lead: `responsabile-${suffix}@ls.test`,
  dev: `sviluppo-${suffix}@ls.test`,
  outside: `da-fuori-${suffix}@esterni.test`,
  client: `cliente-${suffix}@cliente.test`,
};
const NAME: Record<Person, string> = { manager: "Marta Gestione", lead: "Luca Guida", dev: "Sara Sviluppo", outside: "Elio Esterno", client: "Olga Cliente" };
/** Il ruolo nel workspace: chi gestisce il workspace è revisore; chi costruisce da fuori almeno Analista. Il responsabile e lo
 * sviluppatore di Lateral Space no: così gestisce le chiavi solo chi gestisce il workspace e il responsabile del caso (D6). */
const ROLE: Record<Person, string> = { manager: "transformation_lead", lead: "contributor", dev: "contributor", outside: "analyst", client: "contributor" };
/** Le chiavi create dalla suite, per togliere i loro secchi dei limiti alla fine. */
const issuedKeyIds: string[] = [];
const tokens: Partial<Record<Person, string>> = {};

const logged: string[] = [];
const consoleBefore = { log: console.log, warn: console.warn, error: console.error, info: console.info };
const afterQueue = () => ((globalThis as { __ciAfter?: (() => Promise<void>)[] }).__ciAfter ??= []);

let runSeq = 0;
/** Un'esecuzione nuova di GitHub Actions (11 cifre, come quelle vere). */
const newRun = () => String(70_000_000_000 + Date.now() % 1_000_000_000 + ++runSeq);
const runUrl = (run: string, repo = REPO) => `https://github.com/${repo}/actions/runs/${run}`;
const result = (over: Record<string, unknown> = {}) => ({ modello: HAIKU, attuale: true, superati: 27, totali: 28, soglieRispettate: true, ...over });
/** Il corpo del §2.9: le evals di main con i modelli finti (D3), per il caso dato e un'esecuzione nuova. */
function ciBody(over: Record<string, unknown> = {}, run = newRun()): Row {
  return {
    caso: "XX-0001",
    tipo: "evals",
    livello: "pull_request",
    ramo: "main",
    commit: SHA,
    versioneModello: "1.7.0",
    modelliFinti: true,
    inCostruzione: false,
    modelli: { lettura: HAIKU },
    risultati: [result()],
    ci: { esecuzione: run, tentativo: 1, url: runUrl(run) },
    ...over,
  };
}
/** Le evals di main con i modelli veri (dopo D3): `superati` su 100, la soglia 85. */
const realBody = (passed: number, over: Record<string, unknown> = {}) =>
  ciBody({ modelliFinti: false, risultati: [result({ superati: passed, totali: 100, soglieRispettate: passed >= 85 })], ...over });
/** La chiave di idempotenza della CI: `gh-<esecuzione>-<caso>`. */
const idemOf = (body: Row) => `gh-${String((body.ci as Row | undefined)?.esecuzione ?? newRun())}-${String(body.caso ?? "x")}`;

async function call(handler: Handler, path: string, init: { method?: string; key?: string | null; body?: unknown; headers?: Record<string, string> } = {}): Promise<Answer> {
  const method = init.method ?? "GET";
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.key) headers.authorization = `Bearer ${init.key}`;
  if (init.body !== undefined && !Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) headers["content-type"] = "application/json";
  const body = init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body);
  const response = await handler(new Request(`${ORIGIN}/api/${path}`, { method, headers, body }));
  const text = await response.text();
  // Mai una persona, mai una chiave, in nessuna risposta.
  for (const person of PEOPLE) assert.ok(!text.includes(NAME[person]) && !text.includes(EMAIL[person]), `${path}: nessuna persona nella risposta`);
  assert.ok(!text.includes("ub_ci_"), `${path}: mai una chiave nella risposta`);
  return { status: response.status, json: text ? (JSON.parse(text) as Row) : {}, text, headers: response.headers };
}

const cases = (key: string | null, extra: { query?: string; headers?: Record<string, string> } = {}) => call(ciCasi.GET, `ci/casi${extra.query ?? ""}`, { key, headers: extra.headers });
const send = (key: string | null, body: Row, idempotencyKey: string | null = idemOf(body), extra: { query?: string; headers?: Record<string, string> } = {}) =>
  call(ciEvals.POST, `ci/evals${extra.query ?? ""}`, { method: "POST", key, body, headers: { ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}), ...(extra.headers ?? {}) } });
const cliOverview = (person: Person, code = "XX-0001") => call(cliEvals.GET, `cli/evals?caso=${code}`, { key: tokens[person]! });
const codeOf = (a: Answer) => (a.json.errore as Row | undefined)?.codice;
const messageOf = (a: Answer) => (a.json.errore as Row | undefined)?.messaggio;

async function issue(workspaceId = ids.ws, repo = REPO): Promise<{ key: string; keyId: string; expiresAt: Date }> {
  const r = await store.createCiKey(exec, { workspaceId, repo, actor: { userId: ids.manager }, lsDomains: LS });
  if (!r.ok) assert.fail(`chiave non creata: ${r.code}`);
  issuedKeyIds.push(r.value.keyId);
  return { key: r.value.key, keyId: r.value.keyId, expiresAt: r.value.expiresAt };
}
async function clearKeys(): Promise<void> {
  await q(`DELETE FROM uc_notifications WHERE workspace_id = ANY($1::uuid[]) AND template_key LIKE 'chiave_ci_%'`, [[ids.ws, ids.wsB, ids.wsGone]]);
  await q(`DELETE FROM use_case_ci_keys WHERE workspace_id = ANY($1::uuid[])`, [[ids.ws, ids.wsB, ids.wsGone]]);
  afterQueue().splice(0);
}
const keyRow = async (keyId: string) => (await q(`SELECT revoked_at, revoked_reason, last_used_at FROM use_case_ci_keys WHERE id = $1`, [keyId]))[0];
const ciRuns = async (useCaseId: string) => (await q(`SELECT count(*)::int AS n FROM use_case_eval_runs WHERE use_case_id = $1 AND source = 'ci'`, [useCaseId]))[0].n as number;
const factoryRepo = async (repo = REPO) =>
  (await q(`SELECT template_version, common_version, reported_at FROM use_case_factory_repos WHERE workspace_id = $1 AND lower(repo) = lower($2)`, [ids.ws, repo]))[0];

async function tokenFor(person: Person): Promise<string> {
  const started = await auth.startCliLogin(exec, { clientLabel: `CLI di prova CI ${suffix}` });
  const decided = await auth.decideCliLogin(exec, { userCode: started.userCode, userId: ids[person], workspaceId: ids.ws, confirm: true });
  assert.ok(decided.ok);
  const delivered = await auth.deliverCliLogin(exec, started.deviceCode);
  assert.equal(delivered.status, "consegnato");
  return (delivered as { token: string }).token;
}

before(async () => {
  if (!enabled) return;
  // Ogni riga dei log della suite, per l'ultima prova: mai una chiave.
  for (const level of ["log", "warn", "error", "info"] as const) {
    console[level] = (...args: unknown[]) => {
      logged.push(args.map((a) => (a instanceof Error ? `${a.name} ${a.message} ${a.stack ?? ""}` : typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      consoleBefore[level](...args);
    };
  }
  const stub = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
  const stubs: Record<string, string> = {
    "next/cache": stub("export function revalidatePath() {}\nexport function revalidateTag() {}\nexport function unstable_cache(fn) { return fn; }\nexport function unstable_noStore() {}"),
    "next/server": stub("export function after(task) { (globalThis.__ciAfter ??= []).push(task); }"),
  };
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (Object.hasOwn(stubs, specifier)) return { url: stubs[specifier], shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  const areas = `${ids.ws},${ids.wsB},${ids.wsGone}`;
  process.env.UC_ENABLED = "true";
  process.env.UC_WORKSPACE_IDS = areas;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  process.env.USE_CASE_HUB_WORKSPACES = areas;
  delete process.env.USE_CASE_HUB_EXCLUDE;
  delete process.env.VERCEL_ENV;
  delete process.env.NEXT_PUBLIC_APP_URL;

  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Row[]>;
  await (await import("../../db/ensure-schema.ts")).ensureDbSchema();
  exec = (await import("../../db/uc-executor.ts")).ucExecutorForUrl(url!);
  store = await import("../../db/queries/use-case-ci-keys.ts");
  auth = await import("../../db/queries/use-case-cli-auth.ts");
  evals = await import("../../db/queries/use-case-evals.ts");
  line = await import("../../db/queries/use-case-factory-line.ts");
  dispatch = await import("../../db/queries/uc-notifications-dispatch.ts");
  ciCasi = (await import("../../../app/api/ci/casi/route.ts")) as unknown as typeof ciCasi;
  ciEvals = (await import("../../../app/api/ci/evals/route.ts")) as unknown as typeof ciEvals;
  cliEvals = (await import("../../../app/api/cli/evals/route.ts")) as unknown as typeof cliEvals;
  cliRepository = (await import("../../../app/api/cli/repository/route.ts")) as unknown as typeof cliRepository;
  assert.equal(await store.ciKeysStoreReady(exec), true, "la 0042 c'è");

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova API CI', $2)`, [ids.org, `org-ci-api-${suffix}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $4, 'Cliente di prova API CI'), ($2, $4, 'Altro cliente di prova API CI'), ($3, $4, 'Cliente che se ne va')`, [
    ids.ws,
    ids.wsB,
    ids.wsGone,
    ids.org,
  ]);
  for (const person of PEOPLE) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, $3, now())`, [ids[person], EMAIL[person], NAME[person]]);
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ids.ws, ids[person], ROLE[person]]);
  }
  for (const ws of [ids.wsB, ids.wsGone]) await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'transformation_lead'::member_role)`, [ws, ids.manager]);
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, code) VALUES
       ($1, $9, 'Rosa aperto', 'XX-0001'), ($2, $9, 'Rosa chiuso', 'XX-0002'), ($3, $9, 'Rosa in pausa', 'XX-0003'), ($4, $9, 'Blu aperto', 'XX-0004'),
       ($5, $9, 'Rosa senza dossier', 'XX-0005'), ($6, $9, 'Rosa in fila', 'XX-0006'), ($7, $10, 'Rosa di un altro cliente', 'XX-0101'), ($8, $11, 'Verde che se ne va', 'XX-0201')`,
    [ids.uc1, ids.uc2, ids.uc3, ids.uc4, ids.uc5, ids.uc6, ids.ucB, ids.ucGone, ids.ws, ids.wsB, ids.wsGone],
  );
  await q(
    `INSERT INTO uc_templates (id, key, version, name, archetype, definition, definition_hash)
     VALUES ($1::uuid, $2, '1.0.0', 'Template di prova API CI', 'prova', '{"confidential": false}'::jsonb, $3)`,
    [ids.template, `prova.ci_api_${suffix}`, randomBytes(32).toString("hex")],
  );
  const dossiers: [string, string, string, string][] = [
    [ids.case1, ids.ws, ids.uc1, "pronto_sviluppo"],
    [ids.case2, ids.ws, ids.uc2, "chiuso"],
    [ids.case3, ids.ws, ids.uc3, "sospeso"],
    [ids.case4, ids.ws, ids.uc4, "in_sviluppo"],
    [ids.case6, ids.ws, ids.uc6, "in_sviluppo"],
    [ids.caseB, ids.wsB, ids.ucB, "in_sviluppo"],
    [ids.caseGone, ids.wsGone, ids.ucGone, "in_sviluppo"],
  ];
  for (const [caseId, ws, uc, status] of dossiers) {
    await q(
      `INSERT INTO uc_cases (id, workspace_id, organization_id, portfolio_use_case_id, template_id, template_version, code, title, status, status_before_suspension, setup_completed_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, '1.0.0', $6, 'Dossier di prova API CI', $7, CASE WHEN $7 = 'sospeso' THEN 'in_sviluppo' END, now())`,
      [caseId, ws, ids.org, uc, ids.template, `XA-${SUFFIX}-${caseId.slice(0, 4).toUpperCase()}`, status],
    );
  }
  // Il team del caso aperto: il responsabile, lo sviluppatore di Lateral Space, il cliente, e chi costruisce da fuori
  // (osservatore nel dossier, con la concessione).
  await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, 'ls_lead'), ($1, $3, 'ls_sviluppatore'), ($1, $4, 'owner_cliente'), ($1, $5, 'osservatore')`, [
    ids.case1,
    ids.lead,
    ids.dev,
    ids.client,
    ids.outside,
  ]);
  await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, 'ls_lead')`, [ids.case6, ids.lead]);
  await q(`INSERT INTO use_case_external_builders (workspace_id, user_id, use_case_id, added_by_user_id) VALUES ($1, $2, $3, $4)`, [ids.ws, ids.outside, ids.uc1, ids.manager]);
  const register = (uc: string, ws: string, repo: string, folder: string) => q(`INSERT INTO use_case_repos (use_case_id, workspace_id, repo, folder) VALUES ($1, $2, $3, $4)`, [uc, ws, repo, folder]);
  await register(ids.uc1, ids.ws, REPO, "casi/xx-0001");
  await register(ids.uc2, ids.ws, REPO, "casi/xx-0002");
  await register(ids.uc3, ids.ws, REPO, "casi/xx-0003");
  await register(ids.uc5, ids.ws, REPO, "casi/xx-0005");
  await register(ids.uc6, ids.ws, REPO, "casi/xx-0006");
  await register(ids.uc4, ids.ws, OTHER_REPO, "casi/xx-0004");
  await register(ids.ucB, ids.wsB, REPO, "casi/xx-0101");
  await register(ids.ucGone, ids.wsGone, GONE_REPO, "casi/xx-0201");
  for (const person of ["lead", "outside", "client"] as const) tokens[person] = await tokenFor(person);
});

after(async () => {
  for (const level of ["log", "warn", "error", "info"] as const) console[level] = consoleBefore[level];
  if (!enabled) return;
  await q(`DELETE FROM use_case_cli_logins WHERE client_label LIKE $1`, [`%${suffix}%`]);
  await q(`DELETE FROM connector_rate_limits WHERE bucket = ANY($1::text[])`, [issuedKeyIds.flatMap((id) => [`ci:r:${id}`, `ci:w:${id}`])]);
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.ws, ids.wsB, ids.wsGone]]);
  await q(`DELETE FROM uc_templates WHERE id = $1`, [ids.template]);
  await q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [PEOPLE.map((p) => ids[p])]);
});

test("GET /api/ci/casi: i casi del repository della chiave come nel §2.9, con il perché; mai quelli di un altro workspace", opts, async () => {
  await clearKeys();
  const { key, keyId, expiresAt } = await issue();
  const r = await cases(key);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json, {
    repository: REPO,
    casi: [
      { caso: "XX-0001", cartella: "casi/xx-0001", aperto: true },
      { caso: "XX-0002", cartella: "casi/xx-0002", aperto: false, perche: "chiuso" },
      { caso: "XX-0003", cartella: "casi/xx-0003", aperto: false, perche: "sospeso" },
      { caso: "XX-0005", cartella: "casi/xx-0005", aperto: false, perche: "senza_dossier" },
      { caso: "XX-0006", cartella: "casi/xx-0006", aperto: true },
    ],
    soloMain: true,
    scade: expiresAt.toISOString(),
  });
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.ok((await keyRow(keyId)).last_used_at, "l'ultimo uso");
  // La chiave dell'altro cliente, sullo stesso repository: solo il suo caso.
  const other = await issue(ids.wsB);
  assert.deepEqual(((await cases(other.key)).json.casi as Row[]).map((c) => c.caso), ["XX-0101"]);
  // Una rotazione: il primo uso della chiave nuova, anche una lettura, revoca la vecchia (`ruotata`).
  const rotated = await store.rotateCiKey(exec, { workspaceId: ids.ws, repo: REPO, actor: { userId: ids.manager }, lsDomains: LS });
  assert.ok(rotated.ok);
  if (!rotated.ok) return;
  assert.equal((await cases(key)).status, 200, "la vecchia vale finché la nuova non arriva");
  assert.equal((await cases(rotated.value.key)).status, 200);
  assert.equal((await keyRow(keyId)).revoked_reason, "ruotata");
  assert.deepEqual([(await cases(key)).status, codeOf(await cases(key))], [401, "chiave"]);
});

test("401 chiave: mancante, inventata, di un altro tipo, revocata, scaduta, del workspace cancellato; e una chiave della CI non entra nella CLI", opts, async () => {
  await clearKeys();
  const message = "Chiave della CI mancante, scaduta o revocata: ruotala dall'Agent Factory e aggiorna il segreto UNBUNDLE_CI_TOKEN.";
  const refused = async (key: string | null, label: string) => {
    for (const r of [await cases(key), await send(key, ciBody())]) {
      assert.deepEqual([r.status, codeOf(r), messageOf(r)], [401, "chiave", message], label);
    }
  };
  await refused(null, "senza chiave");
  await refused(`ub_ci_${randomBytes(32).toString("base64url")}`, "inventata");
  await refused(tokens.lead!, "il token della CLI di una persona");
  const revoked = await issue();
  const done = await store.revokeCiKeys(exec, { workspaceId: ids.ws, repo: REPO, actor: { userId: ids.manager }, lsDomains: LS });
  assert.ok(done.ok);
  await refused(revoked.key, "revocata");
  await clearKeys();
  const expired = await issue();
  await q(`UPDATE use_case_ci_keys SET created_at = now() - interval '181 days', expires_at = now() - interval '1 second' WHERE id = $1`, [expired.keyId]);
  await refused(expired.key, "scaduta");
  // Il workspace cancellato: la chiave va con lui (cascade).
  const gone = await issue(ids.wsGone, GONE_REPO);
  assert.equal((await cases(gone.key)).status, 200);
  await q(`DELETE FROM workspaces WHERE id = $1`, [ids.wsGone]);
  await refused(gone.key, "del workspace cancellato");
  // Una chiave della CI non entra in /api/cli/*: prefissi e tabelle diversi.
  await clearKeys();
  const live = await issue();
  const cli = await call(cliEvals.GET, "cli/evals?caso=XX-0001", { key: live.key });
  assert.deepEqual([cli.status, codeOf(cli)], [401, "token"]);
  assert.equal(await ciRuns(ids.uc1), 0, "niente scritto");
});

test("la chiave nell'indirizzo: 400 chiave_nell_indirizzo, revocata subito (esposta) con l'e-mail, a ogni metodo; un token della CLI si segna esposto", opts, async () => {
  for (const [label, attempt] of [
    ["GET /api/ci/casi?token=", (key: string) => cases(key, { query: `?token=${key}` })],
    ["POST /api/ci/evals?x=", (key: string) => send(key, ciBody(), undefined, { query: `?x=${encodeURIComponent(key)}` })],
    ["GET /api/ci/evals (il metodo che non c'è)", (key: string) => call(ciEvals.GET, `ci/evals?q=${key}`, { key })],
    ["POST /api/ci/casi (il metodo che non c'è)", (key: string) => call(ciCasi.POST, `ci/casi?q=${key}`, { method: "POST", key, body: {} })],
  ] as [string, (key: string) => Promise<Answer>][]) {
    await clearKeys();
    const { key, keyId } = await issue();
    const r = await attempt(key);
    assert.deepEqual([r.status, codeOf(r), messageOf(r)], [400, "chiave_nell_indirizzo", "La chiave non va mai nell'indirizzo: è stata bloccata. Creane una nuova dall'Agent Factory."], label);
    assert.equal((await keyRow(keyId)).revoked_reason, "esposta", label);
    const mails = await q(`SELECT recipient_user_id::text AS user_id FROM uc_notifications WHERE template_key = 'chiave_ci_bloccata' AND payload->>'keyId' = $1 ORDER BY 1`, [keyId]);
    assert.deepEqual(mails.map((m) => m.user_id), [ids.manager, ids.lead].sort(), `${label}: a chi gestisce le chiavi`);
    assert.ok(afterQueue().length > 0, `${label}: l'e-mail parte dopo la risposta`);
    afterQueue().splice(0);
    assert.deepEqual([(await cases(key)).status, (await send(key, ciBody())).status], [401, 401], `${label}: non vale più`);
  }
  // Un token della CLI nell'indirizzo della CI: 400, e il token si segna esposto (come nella CLI).
  const spare = await tokenFor("dev");
  const r = await cases(null, { query: `?t=${spare}` });
  assert.deepEqual([r.status, codeOf(r)], [400, "chiave_nell_indirizzo"]);
  const [token] = await q(`SELECT exposed_at FROM workspace_integration_tokens WHERE token_hash = $1`, [createHash("sha256").update(spare, "utf8").digest("hex")]);
  assert.ok(token?.exposed_at, "il token della CLI è segnato esposto");
});

test("le altre difese: Origin, JSON, corpo grande, metodo; i limiti per chiave, letture e scritture a parte", opts, async () => {
  await clearKeys();
  const { key, keyId } = await issue();
  const origin = await cases(key, { headers: { origin: "https://evil.example" } });
  assert.deepEqual([origin.status, codeOf(origin)], [403, "origine"]);
  const notJson = await call(ciEvals.POST, "ci/evals", { method: "POST", key, body: "caso=XX-0001", headers: { "content-type": "text/plain", "idempotency-key": "gh-1-XX-0001" } });
  assert.deepEqual([notJson.status, codeOf(notJson)], [415, "json"]);
  const broken = await call(ciEvals.POST, "ci/evals", { method: "POST", key, body: "{non è json", headers: { "idempotency-key": "gh-2-XX-0001" } });
  assert.deepEqual([broken.status, codeOf(broken)], [400, "json"]);
  const large = await send(key, ciBody({ nota: "x".repeat(70_000) }));
  assert.deepEqual([large.status, codeOf(large)], [413, "troppo_grande"]);
  const wrong = await call(ciEvals.GET, "ci/evals", { key });
  assert.deepEqual([wrong.status, codeOf(wrong), wrong.headers.get("allow")], [405, "metodo", "POST"]);
  const wrongCasi = await call(ciCasi.POST, "ci/casi", { method: "POST", key, body: {} });
  assert.deepEqual([wrongCasi.status, codeOf(wrongCasi), wrongCasi.headers.get("allow")], [405, "metodo", "GET"]);
  // I limiti: 120 scritture l'ora per chiave (il secchio pieno), poi 429; le letture restano.
  const fill = (kind: "r" | "w", n: number) =>
    q(
      `INSERT INTO connector_rate_limits (bucket, window_start, count) VALUES ($1, date_trunc('hour', now(), 'UTC'), $2)
       ON CONFLICT (bucket, window_start) DO UPDATE SET count = EXCLUDED.count`,
      [`ci:${kind}:${keyId}`, n],
    );
  try {
    await fill("w", 120);
    const limited = await send(key, ciBody());
    assert.deepEqual([limited.status, codeOf(limited), messageOf(limited)], [429, "troppe_richieste", "Troppe richieste: riprova tra poco."]);
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
    assert.equal((await cases(key)).status, 200, "le letture hanno il loro limite");
    await fill("r", 600);
    assert.deepEqual([(await cases(key)).status, codeOf(await cases(key))], [429, "troppe_richieste"]);
    // Un'altra chiave ha i suoi limiti.
    const other = await issue(ids.wsB);
    assert.equal((await cases(other.key)).status, 200);
  } finally {
    await q(`DELETE FROM connector_rate_limits WHERE bucket = ANY($1::text[])`, [[`ci:r:${keyId}`, `ci:w:${keyId}`]]);
  }
  assert.equal(await ciRuns(ids.uc1), 0, "niente scritto");
});

test("l'area spenta per il workspace della chiave: nessun caso da mandare, un invio è 404", opts, async () => {
  await clearKeys();
  const { key } = await issue();
  const saved = { hub: process.env.USE_CASE_HUB_EXCLUDE, uc: process.env.UC_WORKSPACE_IDS };
  try {
    process.env.USE_CASE_HUB_EXCLUDE = ids.ws;
    const off = await cases(key);
    assert.deepEqual([off.status, off.json.repository, off.json.casi], [200, REPO, []]);
    const sent = await send(key, ciBody());
    assert.deepEqual([sent.status, codeOf(sent)], [404, "non_trovato"]);
    delete process.env.USE_CASE_HUB_EXCLUDE;
    // I dossier spenti per il workspace: lo stesso.
    process.env.UC_WORKSPACE_IDS = ids.wsB;
    assert.deepEqual((await cases(key)).json.casi, []);
    assert.equal((await send(key, ciBody())).status, 404);
  } finally {
    if (saved.hub === undefined) delete process.env.USE_CASE_HUB_EXCLUDE;
    else process.env.USE_CASE_HUB_EXCLUDE = saved.hub;
    process.env.UC_WORKSPACE_IDS = saved.uc;
  }
  assert.equal(((await cases(key)).json.casi as Row[]).length, 5, "riaccesa");
  assert.equal(await ciRuns(ids.uc1), 0, "niente scritto");
});

test("404 un caso di un altro repository o workspace; 409 chiuso, in pausa, senza realizzazione; 403 non main; 400 il corpo; niente scritto", opts, async () => {
  await clearKeys();
  const { key } = await issue();
  const expect = async (body: Row, status: number, code: string, label: string, message?: string | RegExp) => {
    const r = await send(key, body);
    assert.deepEqual([r.status, codeOf(r)], [status, code], `${label}: ${r.text}`);
    if (typeof message === "string") assert.equal(messageOf(r), message, label);
    else if (message) assert.match(String(messageOf(r)), message, label);
  };
  await expect(ciBody({ caso: "XX-0004" }), 404, "non_trovato", "un altro repository", "Questo caso non è tra quelli del repository della chiave.");
  await expect(ciBody({ caso: "XX-0101" }), 404, "non_trovato", "un altro workspace, lo stesso repository");
  await expect(ciBody({ caso: "XX-9999" }), 404, "non_trovato", "un caso che non c'è");
  await expect(ciBody({ caso: undefined }), 404, "non_trovato", "senza il caso");
  await expect(ciBody({ caso: "XX-0002" }), 409, "caso_chiuso", "chiuso", "Il caso è chiuso: il progetto si legge soltanto.");
  await expect(ciBody({ caso: "XX-0003" }), 409, "caso_sospeso", "in pausa", "Il caso è in pausa: si riprende da Impostazioni del caso.");
  await expect(ciBody({ caso: "XX-0005" }), 409, "senza_dossier", "senza realizzazione");
  await expect(ciBody({ ramo: "xx-0001/prova" }), 403, "solo_main", "un ramo", "La chiave della CI manda solo le evals di main.");
  await expect(ciBody({ commit: "a1b2c3d" }), 400, "dati_non_validi", "il commit corto", "commit: le 40 cifre del commit di main.");
  const run = newRun();
  await expect(ciBody({ ci: { esecuzione: run, url: runUrl(run, OTHER_REPO) } }, run), 400, "dati_non_validi", "l'esecuzione di un altro repository", "ci.url: l'indirizzo dell'esecuzione su GitHub di questo repository.");
  await expect(ciBody({ tipo: "altro" }), 400, "dati_non_validi", "le regole della 8.2a", /^tipo:/);
  await expect(ciBody({ modelliFinti: undefined }), 400, "dati_non_validi", "modelliFinti", /^modelliFinti:/);
  const noKey = await send(key, ciBody(), null);
  assert.deepEqual([noKey.status, codeOf(noKey)], [400, "idempotenza"]);
  assert.match(String(messageOf(noKey)), /Idempotency-Key/);
  for (const uc of [ids.uc1, ids.uc2, ids.uc3, ids.uc4, ids.uc5, ids.ucB]) assert.equal(await ciRuns(uc), 0, "niente scritto");
});

test("la riga dell'esecuzione: fonte ci, la chiave, il link, nessuna persona; la versione del modello da main; fonte e ci nella CLI", opts, async () => {
  await clearKeys();
  const { key, keyId } = await issue();
  const run = newRun();
  const body = ciBody({}, run);
  const r = await send(key, body);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(Object.keys(r.json).sort(), ["avviso", "id", "link", "raccomandazione"], "la risposta della CLI");
  assert.equal(r.json.raccomandazione, null);
  assert.equal(r.json.link, `${ORIGIN}/dashboard/${ids.ws}/use-cases/${ids.uc1}/progetto#banco`);
  const [row] = await q(`SELECT use_case_id, workspace_id, kind, branch, commit_sha, template_version, fake_models, source, ci_key_id, ci_run_url FROM use_case_eval_runs WHERE id = $1`, [r.json.id]);
  assert.deepEqual(row, {
    use_case_id: ids.uc1,
    workspace_id: ids.ws,
    kind: "evals",
    branch: "main",
    commit_sha: SHA,
    template_version: "1.7.0",
    fake_models: true,
    source: "ci",
    ci_key_id: keyId,
    ci_run_url: runUrl(run),
  });
  // Nessuna colonna sulla persona: la chiave è del repository.
  const columns = (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'use_case_eval_runs'`)).map((c) => String(c.column_name));
  assert.ok(!columns.some((c) => /user|author|actor|_by|email|login|person/.test(c)), columns.join(", "));
  // Il registro dell'idempotenza: la chiave della CI, mai una persona.
  const [request] = await q(`SELECT principal_key, tool, status FROM use_case_mcp_requests WHERE workspace_id = $1 AND idempotency_key = $2`, [ids.ws, idemOf(body)]);
  // (Revisione) Il registro dell'idempotenza è del repository nel suo workspace, non della chiave.
  assert.deepEqual(request, { principal_key: `ci:${ids.ws}:${REPO.toLowerCase()}`, tool: "evals", status: "completed" });

  // La versione del modello del repository: quella di main.
  const repo = await factoryRepo();
  assert.equal(repo?.template_version, "1.7.0");
  assert.ok(repo?.reported_at);
  // `unbundle start` di una persona (magari da un ramo) non la cambia finché la CI manda; il comune sì.
  const report = (version: string) =>
    call(cliRepository.POST, "cli/repository", { method: "POST", key: tokens.lead!, body: { caso: "XX-0001", azione: "versione", repository: REPO, versioneModello: version, versioneComune: "1.1.0" } });
  assert.equal((await report("1.8.0")).status, 200);
  assert.deepEqual([(await factoryRepo())?.template_version, (await factoryRepo())?.common_version], ["1.7.0", "1.1.0"]);
  // Una CI ferma da più di un mese non tiene la versione bloccata.
  await q(`UPDATE use_case_eval_runs SET created_at = created_at - interval '31 days' WHERE workspace_id = $1 AND source = 'ci'`, [ids.ws]);
  try {
    assert.equal((await report("1.8.0")).status, 200);
    assert.equal((await factoryRepo())?.template_version, "1.8.0");
  } finally {
    await q(`UPDATE use_case_eval_runs SET created_at = created_at + interval '31 days' WHERE workspace_id = $1 AND source = 'ci'`, [ids.ws]);
  }
  // La CI la riscrive a ogni invio di main.
  assert.equal((await send(key, ciBody({ versioneModello: "1.7.1" }))).status, 200);
  assert.equal((await factoryRepo())?.template_version, "1.7.1");

  // La lettura della CLI: la fonte per tutti; il link a chi costruisce (anche da fuori), non al cliente.
  for (const person of ["lead", "outside", "client"] as const) {
    const overview = await cliOverview(person);
    assert.equal(overview.status, 200, `${person}: ${overview.text}`);
    const latest = (overview.json.evals as Row).ultime as Row;
    assert.equal(latest.fonte, "ci", person);
    assert.match(String(latest.commit), /^[0-9a-f]{40}$/);
    if (person === "client") assert.equal(latest.ci, null, "il cliente: «dalla CI» senza link");
    else assert.match(String(latest.ci), new RegExp(`^https://github\\.com/${REPO.replace("/", "\\/")}/actions/runs/[0-9]+$`), person);
  }
  // Le evals di una persona restano, con la fonte scritta (D5).
  const mine = await call(cliEvals.POST, "cli/evals", {
    method: "POST",
    key: tokens.lead!,
    body: { ...ciBody({ ramo: "xx-0001/prova", commit: "a1b2c3d" }), ci: undefined },
    headers: { "idempotency-key": `cli-${suffix}-ramo` },
  });
  assert.equal(mine.status, 200, mine.text);
  const [person] = await q(`SELECT source, ci_key_id, ci_run_url FROM use_case_eval_runs WHERE id = $1`, [mine.json.id]);
  assert.deepEqual(person, { source: "cli", ci_key_id: null, ci_run_url: null });
});

test("gli avvisi delle evals di main dalla CI: a tutto il team che costruisce, chi viene da fuori compreso; mai al cliente; l'e-mail con l'ok ai sub-responsabili", opts, async () => {
  await clearKeys();
  const { key } = await issue();
  const clearAlerts = async () => {
    await q(`DELETE FROM use_case_notifications WHERE use_case_id = $1 AND kind = 'evals_in_calo'`, [ids.uc1]);
    await q(`DELETE FROM uc_notifications WHERE case_id = $1 AND template_key = 'evals_in_calo'`, [ids.case1]);
  };
  await clearAlerts();
  const bell = async () => (await q(`SELECT recipient_user_id::text AS u FROM use_case_notifications WHERE use_case_id = $1 AND kind = 'evals_in_calo' ORDER BY 1`, [ids.uc1])).map((r) => r.u);
  const queue = async () => q(`SELECT recipient_user_id::text AS u, payload, status, hold_reason, error FROM uc_notifications WHERE case_id = $1 AND template_key = 'evals_in_calo' ORDER BY 1`, [ids.case1]);
  const team = [ids.lead, ids.dev, ids.outside].sort();
  // Con i modelli finti (D3) nessun avviso: le regole della 8.2a.
  const fake = await send(key, ciBody({ risultati: [result({ superati: 10, totali: 100, soglieRispettate: false })] }));
  assert.deepEqual([fake.status, fake.json.avviso], [200, "sotto_soglia"], "chi manda vede l'avviso");
  assert.deepEqual(await bell(), [], "finti: il team non è avvisato");
  // Con i modelli veri, sotto soglia: tutto il team che costruisce (nessuno «ha lanciato»), mai il cliente né chi
  // gestisce il workspace senza costruire.
  assert.equal((await send(key, realBody(95))).status, 200);
  const below = await send(key, realBody(60, { commit: SHA2 }));
  assert.deepEqual([below.status, below.json.avviso], [200, "sotto_soglia"], below.text);
  assert.deepEqual(await bell(), team);
  const queued = await queue();
  assert.deepEqual(queued.map((m) => m.u), team);
  // Nella coda la fonte e il commit intero (`fromCi`): l'e-mail dice «Le ha mandate la CI di main, commit 0fedcba.».
  for (const m of queued) assert.deepEqual(m.payload, { useCase: ids.uc1, alert: "sotto_soglia", qualityText: "60%", source: "ci", commit: SHA2 });
  // Le e-mail: a Lateral Space partono; a chi costruisce da fuori solo con l'ok ai sub-responsabili del cliente.
  afterQueue().splice(0);
  const sent: { to: string; subject: string; text: string }[] = [];
  const mailer = { send: async (email: { to: string; subject: string; text: string; html: string }) => (sent.push(email), { ok: true as const }) };
  const env = { UC_ENABLED: "true", RESEND_API_KEY: "re_prova", UC_EMAIL_FROM: "Unbundle <notifiche@example.test>", NEXT_PUBLIC_APP_URL: "https://app.example.test", UC_LS_EMAIL_DOMAINS: "ls.test" };
  await dispatch.dispatchDue({ caseId: ids.case1, executor: exec, env, mailer });
  assert.deepEqual(sent.map((m) => m.to).sort(), [EMAIL.dev, EMAIL.lead].sort());
  const withoutAck = (await queue()).find((m) => m.u === ids.outside);
  assert.deepEqual([withoutAck?.status, withoutAck?.error], ["annullata", "sub_responsabili_mancanti"]);
  const { SUBPROCESSORS_VERSION } = await import("../../uc/legal/subprocessors.ts");
  await q(`INSERT INTO uc_subprocessor_acks (workspace_id, list_version, statement_text, declared_by_user_id, declared_by_role) VALUES ($1::uuid, $2, 'Autorizzazione di prova', $3::uuid, 'function_lead')`, [
    ids.ws,
    SUBPROCESSORS_VERSION,
    ids.client,
  ]);
  await clearAlerts();
  sent.splice(0);
  const again = await send(key, realBody(55, { commit: SHA2 }));
  assert.deepEqual([again.status, again.json.avviso], [200, "sotto_soglia"]);
  await dispatch.dispatchDue({ caseId: ids.case1, executor: exec, env, mailer });
  assert.deepEqual(sent.map((m) => m.to).sort(), [EMAIL.dev, EMAIL.lead, EMAIL.outside].sort(), "con l'ok anche a chi costruisce da fuori");
  for (const m of sent) assert.ok(!m.text.includes("ub_ci_") && !m.text.includes(NAME.client), "mai una chiave o il cliente nell'e-mail");
  // Il giro delle e-mail parte subito dopo la risposta.
  assert.ok(afterQueue().length > 0);
  afterQueue().splice(0);
  await clearAlerts();
});

test("il banco dalla CI: la raccomandazione della CLI, la riga con la fonte ci, il consiglio a tutto il team che costruisce", opts, async () => {
  await clearKeys();
  const { key, keyId } = await issue();
  const SONNET = "anthropic/claude-sonnet-5-5";
  await q(`DELETE FROM use_case_notifications WHERE use_case_id = $1 AND kind = 'banco_consiglio'`, [ids.uc1]);
  await q(`DELETE FROM uc_notifications WHERE case_id = $1 AND template_key = 'banco_consiglio'`, [ids.case1]);
  const run = newRun();
  const body = ciBody(
    {
      tipo: "banco",
      ruolo: "lettura",
      modelliFinti: false,
      modelli: { lettura: SONNET },
      risultati: [result({ modello: SONNET, costoPer1000Usd: 1.8 }), result({ attuale: false, costoPer1000Usd: 0.12 })],
    },
    run,
  );
  // Il banco: la chiave d'idempotenza con il ruolo.
  const r = await send(key, body, `gh-${run}-XX-0001-lettura`);
  assert.equal(r.status, 200, r.text);
  const advice = r.json.raccomandazione as Row;
  assert.deepEqual([advice.tipo, advice.modello, r.json.avviso], ["cambia", HAIKU, null]);
  assert.deepEqual((await q(`SELECT kind, role, source, ci_key_id, ci_run_url FROM use_case_eval_runs WHERE id = $1`, [r.json.id]))[0], {
    kind: "banco",
    role: "lettura",
    source: "ci",
    ci_key_id: keyId,
    ci_run_url: runUrl(run),
  });
  const bell = (await q(`SELECT recipient_user_id::text AS u FROM use_case_notifications WHERE use_case_id = $1 AND kind = 'banco_consiglio' ORDER BY 1`, [ids.uc1])).map((x) => x.u);
  assert.deepEqual(bell, [ids.lead, ids.dev, ids.outside].sort(), "nessuno l'ha lanciato: tutto il team che costruisce");
  afterQueue().splice(0);
});

test("l'idempotenza: lo stesso invio «ripetuto» (anche da un job rilanciato), un altro corpo con la stessa chiave 409, nessun doppione", opts, async () => {
  await clearKeys();
  const { key } = await issue();
  const run = newRun();
  const body = ciBody({ caso: "XX-0006" }, run);
  const before = await ciRuns(ids.uc6);
  const first = await send(key, body);
  assert.equal(first.status, 200, first.text);
  const repeated = await send(key, body);
  assert.equal(repeated.status, 200);
  assert.equal(repeated.json.ripetuta, true);
  assert.deepEqual({ ...repeated.json, ripetuta: undefined }, { ...first.json, ripetuta: undefined });
  // Il job rilanciato (tentativo 2) con le stesse evals: la stessa richiesta.
  const rerun = await send(key, { ...body, ci: { esecuzione: run, tentativo: 2, url: runUrl(run) } });
  assert.deepEqual([rerun.status, rerun.json.ripetuta, rerun.json.id], [200, true, first.json.id]);
  assert.equal(await ciRuns(ids.uc6), before + 1);
  // (Revisione) Il job rilanciato dopo una rotazione, con la chiave nuova: è lo stesso invio, nessuna seconda riga.
  const rotated = await store.rotateCiKey(exec, { workspaceId: ids.ws, repo: REPO, actor: { userId: ids.manager }, lsDomains: LS });
  if (!rotated.ok) assert.fail(`rotazione non riuscita: ${rotated.code}`);
  issuedKeyIds.push(rotated.value.keyId);
  const afterRotation = await send(rotated.value.key, { ...body, ci: { esecuzione: run, tentativo: 3, url: runUrl(run) } });
  assert.deepEqual([afterRotation.status, afterRotation.json.ripetuta, afterRotation.json.id], [200, true, first.json.id], afterRotation.text);
  assert.equal(await ciRuns(ids.uc6), before + 1, "la stessa esecuzione, una riga sola");
  // La stessa chiave d'idempotenza con altri numeri: 409, con il testo della CLI (la vecchia chiave ora è revocata: la nuova).
  const conflict = await send(rotated.value.key, { ...body, risultati: [result({ superati: 20 })] });
  assert.deepEqual([conflict.status, codeOf(conflict), messageOf(conflict)], [409, "idempotenza", "La stessa chiave con una richiesta diversa: usa una chiave nuova."]);
  assert.equal(await ciRuns(ids.uc6), before + 1, "nessun doppione");
});

test("due invii insieme dello stesso caso si scrivono uno alla volta (il lock della 8.2a); la stessa chiave insieme, una riga", opts, async () => {
  await clearKeys();
  const { key } = await issue();
  await q(`DELETE FROM use_case_eval_runs WHERE use_case_id = $1`, [ids.uc6]);
  const quality = new Map<string, number>([["X", 95], ["Y", 88]]);
  const bodies = [...quality].map(([, passed]) => ciBody({ caso: "XX-0006", risultati: [result({ superati: passed, totali: 100, soglieRispettate: true })] }));
  const [a, b] = await Promise.all(bodies.map((body) => send(key, body)));
  assert.deepEqual([a.status, b.status], [200, 200], `${a.text} ${b.text}`);
  const rows = await q(`SELECT r.id::text AS id, x.passed FROM use_case_eval_runs r JOIN use_case_eval_results x ON x.run_id = r.id WHERE r.use_case_id = $1 ORDER BY r.created_at, r.id`, [ids.uc6]);
  assert.equal(rows.length, 2, "tutte e due scritte");
  // La seconda scritta è confrontata con la prima: giù di 7 punti è «in_calo», su è niente; la prima non ha precedenti.
  const answers = new Map([[String(a.json.id), a.json.avviso], [String(b.json.id), b.json.avviso]]);
  const [first, second] = rows;
  assert.equal(answers.get(String(first.id)), null, "la prima non ha precedenti");
  assert.equal(answers.get(String(second.id)), Number(second.passed) < Number(first.passed) ? "in_calo" : null, "la seconda confrontata con la prima");
  // Lo stesso invio due volte insieme: una riga sola; l'altro risponde «ripetuta» o «in corso».
  const same = ciBody({ caso: "XX-0006", risultati: [result({ superati: 90, totali: 100 })] });
  const pair = await Promise.all([send(key, same), send(key, same)]);
  assert.ok(pair.some((p) => p.status === 200 && p.json.ripetuta === undefined), pair.map((p) => p.text).join(" | "));
  for (const p of pair) assert.ok((p.status === 200) || (p.status === 409 && codeOf(p) === "in_corso"), p.text);
  assert.equal(await ciRuns(ids.uc6), 3);
});

test("la 0042 non pronta: /api/ci/* 503; il ritorno indietro: le istruzioni del codice di prima su un database con la 0042 e righe ci", opts, async () => {
  await clearKeys();
  const { key } = await issue();
  assert.ok((await ciRuns(ids.uc1)) > 0, "ci sono righe della CI");
  // Senza un indice della 0042 la sonda è falsa (come durante il self-heal): l'app non chiede le colonne nuove. Sono le
  // stesse istruzioni del codice di prima della 8.2b: letture senza la fonte, scritture con la fonte di default.
  await q(`ALTER INDEX use_case_eval_runs_ci_key_idx RENAME TO use_case_eval_runs_ci_key_idx_prova`);
  try {
    assert.equal(await store.ciKeysStoreReady(exec), false);
    for (const r of [await cases(key), await send(key, ciBody())]) {
      assert.deepEqual([r.status, codeOf(r), messageOf(r)], [503, "non_disponibile", "Unbundle non riceve ancora le evals dalla CI: riprova tra qualche minuto."]);
      assert.equal(r.headers.get("retry-after"), "60");
    }
    // La CLI: la panoramica si legge, tutto «dalla CLI» e senza link (le colonne nuove non si chiedono).
    const overview = await cliOverview("lead");
    assert.equal(overview.status, 200, overview.text);
    assert.deepEqual([((overview.json.evals as Row).ultime as Row).fonte, ((overview.json.evals as Row).ultime as Row).ci], ["cli", null]);
    // Le evals di una persona si scrivono, con la fonte di default.
    const mine = await call(cliEvals.POST, "cli/evals", {
      method: "POST",
      key: tokens.lead!,
      body: { ...ciBody({ commit: "b1b2c3d", modelliFinti: true }), ci: undefined },
      headers: { "idempotency-key": `cli-${suffix}-senza-0042` },
    });
    assert.equal(mine.status, 200, mine.text);
    assert.deepEqual((await q(`SELECT source, ci_key_id FROM use_case_eval_runs WHERE id = $1`, [mine.json.id]))[0], { source: "cli", ci_key_id: null });
    // Le pagine: «Agent Factory» e «Evals e banco di prova» leggono le righe della CI senza le colonne nuove.
    const facts = await evals.loadEvalFacts(exec, ids.ws, [ids.uc1, ids.uc6]);
    assert.ok(facts.get(ids.uc1)?.evals);
    const factory = await line.loadFactoryOverview(exec, { workspaceId: ids.ws, userId: ids.lead, seeAll: false, canSeeNeeds: true, lsDomains: LS });
    assert.ok(factory.cases.some((c) => c.useCaseId === ids.uc1 && c.evals !== null));
    const page = await evals.loadEvalOverview(exec, { workspaceId: ids.ws, useCaseId: ids.uc1 });
    assert.ok(page?.evals.latest);
    assert.ok([page!.evals.latest!, ...page!.benches.map((b) => b.run)].every((run) => run.source === "cli" && run.ciRunUrl === null));
    // `unbundle start` di una persona come prima: senza la 0042 la versione la dice lei.
    const report = await call(cliRepository.POST, "cli/repository", { method: "POST", key: tokens.lead!, body: { caso: "XX-0001", azione: "versione", repository: REPO, versioneModello: "1.6.9" } });
    assert.equal(report.status, 200, report.text);
    assert.equal((await factoryRepo())?.template_version, "1.6.9");
  } finally {
    await q(`ALTER INDEX use_case_eval_runs_ci_key_idx_prova RENAME TO use_case_eval_runs_ci_key_idx`);
  }
  assert.equal(await store.ciKeysStoreReady(exec), true);
  // Di nuovo pronta: la CI manda, e la pagina dice «dalla CI».
  assert.equal((await send(key, ciBody())).status, 200);
  const page = await evals.loadEvalOverview(exec, { workspaceId: ids.ws, useCaseId: ids.uc1 });
  assert.equal(page?.evals.latest?.source, "ci");
  assert.match(String(page?.evals.latest?.ciRunUrl), /^https:\/\/github\.com\//);
});

test("mai una chiave della CI nei log della suite", opts, async () => {
  assert.ok(logged.every((line) => !line.includes("ub_ci_")), "nessuna chiave nei log");
});
