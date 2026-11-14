import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
/** `module.registerHooks` di Node 24 (i tipi di @types/node del progetto non lo hanno ancora). */
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?(specifier: string, context: object, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult }): void;
};

// Il banco di prova e le evals (rilascio 8.2a, docs/rilascio-8/BANCO-DI-PROVA.md) sul database del pacchetto, dalla
// rotta vera `/api/cli/evals` con i token veri della CLI:
// - lo schema della 0036: il file due volte e il self-heal due volte non cambiano niente; i CHECK rifiutano la riga
//   sbagliata; da zero, in una transazione annullata, il self-heal la crea; senza la 0035 si ferma;
// - chi scrive (il team che costruisce), chi legge (il team del caso), chi non vede il caso; la chiave di idempotenza;
//   i 400 con il messaggio;
// - il banco «cambia» avvisa il team che costruisce tranne chi l'ha lanciato, una volta al giorno; «resta» e i modelli
//   finti no; le evals di main sotto soglia o giù di 5 punti avvisano, in costruzione, finte o su un altro ramo no;
// - la panoramica per la CLI e per la pagina (l'andamento dalla più vecchia, lo stesso ramo, main prima), la pagina
//   «Agent Factory» (i fatti e «Da fare per te»), le evals insieme una alla volta, la ripresa con lo stesso id;
// - mai un nome o un indirizzo in una risposta, mai una colonna sulla persona.
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
let evals: typeof import("../../db/queries/use-case-evals.ts");
let ddl: typeof import("../../db/use-case-hub-evals-ddl.ts");
let ensure: typeof import("../../db/ensure-schema.ts");
let route: { GET: Handler; POST: Handler };

const migration = readFileSync(new URL("../../../../drizzle/0036_evals.sql", import.meta.url), "utf8");
const suffix = randomBytes(3).toString("hex");
const ids = {
  org: randomUUID(),
  ws: randomUUID(),
  template: randomUUID(),
  useCase: randomUUID(),
  other: randomUUID(),
  third: randomUUID(),
  fourth: randomUUID(),
  dossier: randomUUID(),
  dossierOther: randomUUID(),
  dossierThird: randomUUID(),
  dossierFourth: randomUUID(),
  lead: randomUUID(),
  analyst: randomUUID(),
  dev: randomUUID(),
  owner: randomUUID(),
  outsider: randomUUID(),
};
type Person = "lead" | "analyst" | "dev" | "owner" | "outsider";
const PEOPLE: Person[] = ["lead", "analyst", "dev", "owner", "outsider"];
const EMAIL: Record<Person, string> = {
  lead: `lead-${suffix}@ls.test`,
  analyst: `analista-${suffix}@ls.test`,
  dev: `sviluppo-${suffix}@ls.test`,
  owner: `owner-${suffix}@cliente.test`,
  outsider: `estraneo-${suffix}@cliente.test`,
};
const NAME: Record<Person, string> = { lead: "Lucia Guida", analyst: "Andrea Analisi", dev: "Sara Sviluppo", owner: "Olga Cliente", outsider: "Ettore Esterno" };
const tokens: Partial<Record<Person, string>> = {};
let keySeq = 0;
const key = () => `ev-${suffix}-${++keySeq}`;
const CODE = "EV-0001";

const HAIKU = "anthropic/claude-haiku-5-5";
const SONNET = "anthropic/claude-sonnet-5-5";
const OPUS = "anthropic/claude-opus-5-5";

async function call(path: string, init: { method?: "GET" | "POST"; token?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<{ status: number; json: Row; text: string }> {
  const method = init.method ?? "GET";
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const response = await route[method](new Request(`http://127.0.0.1:53110/api/cli/${path}`, { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) }));
  const text = await response.text();
  // Mai un nome o un indirizzo di una persona, in nessuna risposta.
  for (const person of PEOPLE) {
    assert.ok(!text.includes(NAME[person]) && !text.includes(EMAIL[person]), `${path}: nessuna persona nella risposta`);
  }
  return { status: response.status, json: JSON.parse(text) as Row, text };
}

const post = (token: string, body: unknown, idempotencyKey: string | null = key()) =>
  call("evals", { method: "POST", token, body, headers: idempotencyKey ? { "idempotency-key": idempotencyKey } : {} });
const overview = (token: string, code = CODE) => call(`evals?caso=${encodeURIComponent(code)}`, { token });

async function tokenFor(person: Person): Promise<string> {
  const started = await auth.startCliLogin(exec, { clientLabel: `CLI di prova evals ${suffix}` });
  const decided = await auth.decideCliLogin(exec, { userCode: started.userCode, userId: ids[person], workspaceId: ids.ws, confirm: true });
  assert.ok(decided.ok);
  const delivered = await auth.deliverCliLogin(exec, started.deviceCode);
  assert.equal(delivered.status, "consegnato");
  return (delivered as { token: string }).token;
}

const result = (over: Record<string, unknown> = {}) => ({
  modello: HAIKU,
  attuale: true,
  superati: 27,
  totali: 28,
  soglieRispettate: true,
  gruppi: { regole: { passati: 9, totali: 9, soglia: 1, ok: true } },
  costoPer1000Usd: 0.12,
  latenzaP50Ms: 1200,
  latenzaP95Ms: 2600,
  tokenIngressoMedi: 1900,
  tokenUscitaMedi: 220,
  errori: 0,
  ...over,
});

/** Il banco «lettura»: Sonnet di oggi, Haiku con la stessa qualità costa il 93% in meno → «cambia». */
const banco = (over: Record<string, unknown> = {}) => ({
  caso: CODE,
  tipo: "banco",
  ruolo: "lettura",
  livello: "pull_request",
  ramo: "main",
  commit: "a1b2c3d",
  versioneModello: "1.4.0",
  modelliFinti: false,
  inCostruzione: false,
  modelli: { lettura: SONNET, scrittura: HAIKU },
  risultati: [result({ modello: SONNET, costoPer1000Usd: 1.8, latenzaP95Ms: 4100 }), result({ modello: HAIKU, attuale: false })],
  ...over,
});

/** I modelli di oggi per ruolo, come in agent.yaml: la CLI li manda con le evals (dicono se un banco è stato seguito). */
const TODAY = { lettura: SONNET, riassunto: SONNET, scrittura: HAIKU, verifica: SONNET };

/** Le evals con i modelli di oggi: `superati` su 100; la soglia è 85. */
const evalsBody = (passed: number, over: Record<string, unknown> = {}) => ({
  caso: CODE,
  tipo: "evals",
  livello: "pull_request",
  ramo: "main",
  commit: "a1b2c3d4",
  versioneModello: "1.4.0",
  modelliFinti: false,
  inCostruzione: false,
  modelli: TODAY,
  risultati: [result({ superati: passed, totali: 100, soglieRispettate: passed >= 85, costoPer1000Usd: 0.12 })],
  ...over,
});

const bell = async (kind: string, useCaseId = ids.useCase) =>
  (await q(`SELECT recipient_user_id FROM use_case_notifications WHERE use_case_id = $1 AND kind = $2 ORDER BY recipient_user_id`, [useCaseId, kind])).map((r) => String(r.recipient_user_id));
const mails = async (template: string, caseId = ids.dossier) =>
  q(`SELECT recipient_user_id, payload, status, hold_reason FROM uc_notifications WHERE case_id = $1 AND template_key = $2 ORDER BY recipient_user_id`, [caseId, template]);
const clearNotices = async (kind: string) => {
  await q(`DELETE FROM use_case_notifications WHERE use_case_id = ANY($1::uuid[]) AND kind = $2`, [[ids.useCase, ids.other, ids.third, ids.fourth], kind]);
  await q(`DELETE FROM uc_notifications WHERE case_id = ANY($1::uuid[]) AND template_key = $2`, [[ids.dossier, ids.dossierOther, ids.dossierThird, ids.dossierFourth], kind]);
};
const sorted = (...people: Person[]) => people.map((p) => ids[p]).sort();
const afterQueue = () => ((globalThis as { __evalsAfter?: (() => Promise<void>)[] }).__evalsAfter ??= []);

async function rejects(sqlText: string, params: unknown[], constraint: string) {
  await assert.rejects(q(sqlText, params), (error: unknown) => {
    const text = String((error as { message?: unknown })?.message ?? error);
    assert.ok(text.includes(constraint), `atteso ${constraint}, ricevuto: ${text}`);
    return true;
  });
}

async function schemaSnapshot(): Promise<string> {
  const tables = ["use_case_eval_runs", "use_case_eval_results", "use_case_notifications"];
  const list = tables.map((x) => `'${x}'`).join(", ");
  const columns = await q(`SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN (${list}) ORDER BY table_name, ordinal_position`);
  const constraints = await q(`SELECT conrelid::regclass::text AS t, conname, pg_get_constraintdef(oid) AS def, convalidated FROM pg_constraint WHERE conrelid IN (${tables.map((x) => `'public.${x}'::regclass`).join(", ")}) ORDER BY 1, 2`);
  const indexes = await q(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename IN (${list}) ORDER BY 1`);
  return JSON.stringify({ columns, constraints, indexes });
}

before(async () => {
  if (!enabled) return;
  const stub = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
  const stubs: Record<string, string> = {
    "next/cache": stub("export function revalidatePath() {}\nexport function revalidateTag() {}\nexport function unstable_cache(fn) { return fn; }\nexport function unstable_noStore() {}"),
    "next/server": stub("export function after(task) { (globalThis.__evalsAfter ??= []).push(task); }"),
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
  ensure = await import("../../db/ensure-schema.ts");
  await ensure.ensureDbSchema();
  exec = (await import("../../db/uc-executor.ts")).ucExecutorForUrl(url!);
  auth = await import("../../db/queries/use-case-cli-auth.ts");
  evals = await import("../../db/queries/use-case-evals.ts");
  ddl = await import("../../db/use-case-hub-evals-ddl.ts");
  route = (await import("../../../app/api/cli/evals/route.ts")) as unknown as { GET: Handler; POST: Handler };

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova evals', $2)`, [ids.org, `org-evals-${suffix}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Workspace di prova evals')`, [ids.ws, ids.org]);
  const role: Record<Person, string> = { lead: "transformation_lead", analyst: "analyst", dev: "analyst", owner: "contributor", outsider: "contributor" };
  for (const person of PEOPLE) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, $3, now())`, [ids[person], EMAIL[person], NAME[person]]);
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ids.ws, ids[person], role[person]]);
  }
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, code) VALUES ($1, $4, 'Smistamento di prova', 'EV-0001'), ($2, $4, 'Lettura dei contratti', 'EV-0002'),
       ($3, $4, 'Risposte ai fornitori', 'EV-0003'), ($5, $4, 'Note spese', 'EV-0004')`,
    [ids.useCase, ids.other, ids.third, ids.ws, ids.fourth],
  );
  await q(
    `INSERT INTO uc_templates (id, key, version, name, archetype, definition, definition_hash, restricted_to_workspace_id)
     VALUES ($1::uuid, $2, '1.0.0', 'Template di prova evals', 'prova', '{"confidential": false}'::jsonb, $3, $4::uuid)`,
    [ids.template, `prova.evals_${suffix}`, randomBytes(32).toString("hex"), ids.ws],
  );
  for (const [dossier, useCase, code] of [
    [ids.dossier, ids.useCase, "1"],
    [ids.dossierOther, ids.other, "2"],
    [ids.dossierThird, ids.third, "3"],
    [ids.dossierFourth, ids.fourth, "4"],
  ] as const) {
    await q(
      `INSERT INTO uc_cases (id, workspace_id, organization_id, portfolio_use_case_id, template_id, template_version, code, title, status, setup_completed_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, '1.0.0', $6, 'Dossier di prova evals', 'pronto_sviluppo', now())`,
      [dossier, ids.ws, ids.org, useCase, ids.template, `EVD${code}-${suffix.toUpperCase()}`],
    );
    for (const [person, caseRole] of [["lead", "ls_lead"], ["analyst", "ls_analista"], ["dev", "ls_sviluppatore"], ["owner", "owner_cliente"]] as const) {
      await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, $3)`, [dossier, ids[person], caseRole]);
    }
  }
  for (const person of PEOPLE) tokens[person] = await tokenFor(person);
});

after(async () => {
  if (!enabled) return;
  await q(`DELETE FROM use_case_cli_logins WHERE client_label LIKE $1`, [`%${suffix}%`]);
  await q(`DELETE FROM workspaces WHERE id = $1`, [ids.ws]);
  await q(`DELETE FROM uc_templates WHERE id = $1`, [ids.template]);
  await q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [PEOPLE.map((p) => ids[p])]);
});

test("lo schema della 0036 c'è; il file due volte e il self-heal due volte non cambiano niente; i CHECK tengono", opts, async () => {
  assert.equal((await q(`SELECT ${ddl.EVALS_PROBE_SQL} AS ok`))[0].ok, true);
  assert.equal(await evals.evalsStoreReady(exec), true);
  const first = await schemaSnapshot();
  await q(migration);
  await q(migration);
  await ensure.runEvalsDdl();
  await ensure.runEvalsDdl();
  assert.equal(await schemaSnapshot(), first);
  const [kinds] = await q(`SELECT pg_get_constraintdef(oid) AS def, convalidated FROM pg_constraint WHERE conname = 'use_case_notifications_kind_check'`);
  assert.match(String(kinds.def), /'compito_proposto'[\s\S]*'banco_consiglio'[\s\S]*'evals_in_calo'/);
  assert.equal(kinds.convalidated, true);
  // Nessuna colonna sulla persona (art. 15.4).
  const columns = (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('use_case_eval_runs', 'use_case_eval_results')`)).map((r) => String(r.column_name));
  assert.ok(columns.length === 32 && !columns.some((c) => /user|author|actor|_by|email|login|person/.test(c)), columns.join(", "));

  const run = `INSERT INTO use_case_eval_runs (use_case_id, workspace_id, kind, role, level, branch, commit_sha, template_version, models, cases_total)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10) RETURNING id`;
  const ok = [ids.other, ids.ws, "banco", "lettura", "pull_request", "main", "a1b2c3d", "1.4.0", "{}", 28];
  const runWith = (i: number, v: unknown) => ok.map((x, j) => (j === i ? v : x));
  await rejects(run, runWith(2, "altro"), "use_case_eval_runs_kind_check");
  await rejects(run, runWith(3, "Lettura"), "use_case_eval_runs_role_check");
  await rejects(run, runWith(4, "PR"), "use_case_eval_runs_level_check");
  await rejects(run, runWith(5, "ramo con spazi"), "use_case_eval_runs_branch_check");
  await rejects(run, runWith(6, "XYZ1234"), "use_case_eval_runs_commit_check");
  await rejects(run, runWith(7, "1.4"), "use_case_eval_runs_version_check");
  await rejects(run, runWith(8, "[]"), "use_case_eval_runs_models_check");
  await rejects(run, runWith(9, 0), "use_case_eval_runs_cases_check");
  await rejects(run, runWith(3, null), "use_case_eval_runs_role_kind_check");
  await rejects(run, [ids.other, ids.ws, "evals", "lettura", "pull_request", "main", null, null, "{}", 28], "use_case_eval_runs_role_kind_check");
  const [valid] = await q(run, ok);
  const [elsewhere] = await q(run, [ids.third, ids.ws, "evals", null, "pull_request", "main", null, null, "{}", 28]);
  try {
    const result = `INSERT INTO use_case_eval_results (run_id, use_case_id, workspace_id, model, current, quality, passed, total, thresholds_met, groups, cost_per_1000_usd,
      latency_p50_ms, latency_p95_ms, tokens_in_avg, tokens_out_avg, errors) VALUES ($1, $2, $3, $4, true, $5, $6, $7, true, $8::jsonb, $9, $10, $11, $12, $13, $14)`;
    const good = [valid.id, ids.other, ids.ws, HAIKU, 0.5, 14, 28, "{}", 0.12, 1000, 2000, 1900, 220, 0];
    const resultWith = (i: number, v: unknown) => good.map((x, j) => (j === i ? v : x));
    await rejects(result, resultWith(3, "modello con spazi"), "use_case_eval_results_model_check");
    await rejects(result, resultWith(4, 1.5), "use_case_eval_results_quality_check");
    await rejects(result, resultWith(4, -0.1), "use_case_eval_results_quality_check");
    await rejects(result, good.map((x, j) => (j === 5 || j === 6 ? 0 : x)), "use_case_eval_results_total_check");
    await rejects(result, resultWith(5, 29), "use_case_eval_results_passed_check");
    await rejects(result, resultWith(5, -1), "use_case_eval_results_passed_check");
    await rejects(result, resultWith(7, "[]"), "use_case_eval_results_groups_check");
    await rejects(result, resultWith(8, -1), "use_case_eval_results_cost_check");
    await rejects(result, resultWith(9, -1), "use_case_eval_results_p50_check");
    await rejects(result, resultWith(10, 86_400_001), "use_case_eval_results_p95_check");
    await rejects(result, resultWith(9, 3000), "use_case_eval_results_latency_check");
    await rejects(result, resultWith(11, -1), "use_case_eval_results_tokens_in_check");
    await rejects(result, resultWith(12, 10_000_001), "use_case_eval_results_tokens_out_check");
    await rejects(result, resultWith(13, -1), "use_case_eval_results_errors_check");
    // Un risultato resta nel caso della sua esecuzione: un'esecuzione di un altro caso non si può usare.
    await rejects(result, resultWith(0, elsewhere.id), "use_case_eval_results_run_fkey");
    await q(result, good);
    await rejects(result, good, "use_case_eval_results_unique");
    // Si cancella con l'esecuzione.
    await q(`DELETE FROM use_case_eval_runs WHERE id = $1`, [valid.id]);
    assert.equal((await q(`SELECT count(*)::int AS n FROM use_case_eval_results WHERE run_id = $1`, [valid.id]))[0].n, 0);
  } finally {
    await q(`DELETE FROM use_case_eval_runs WHERE id = ANY($1::uuid[])`, [[valid.id, elsewhere.id]]);
  }
});

test("su un database senza la 0036 il self-heal la crea (in una transazione annullata); senza la 0035 si ferma", opts, async () => {
  const marker = `prova-0036-annullata-${suffix}`;
  const kinds0034 = (await import("../../db/use-case-hub-proposals-ddl.ts")).USE_CASE_NOTIFICATION_KINDS_0034;
  const text = [
    `DROP TABLE use_case_eval_results, use_case_eval_runs;`,
    `DELETE FROM use_case_notifications WHERE kind IN (${ddl.EVAL_NOTICE_KINDS.map((k) => `'${k}'`).join(", ")});`,
    `ALTER TABLE use_case_notifications DROP CONSTRAINT use_case_notifications_kind_check;`,
    `ALTER TABLE use_case_notifications ADD CONSTRAINT use_case_notifications_kind_check CHECK (kind IN (${kinds0034.map((k) => `'${k}'`).join(", ")}));`,
    `DO $$ BEGIN IF ${ddl.EVALS_PROBE_SQL} THEN RAISE EXCEPTION 'sonda ancora vera'; END IF; END $$;`,
    ...ddl.EVALS_DDL,
    `DO $$ BEGIN IF NOT ${ddl.EVALS_PROBE_SQL} THEN RAISE EXCEPTION 'sonda ancora falsa'; END IF; END $$;`,
    `DO $$ BEGIN IF NOT (SELECT convalidated FROM pg_constraint WHERE conname = 'use_case_notifications_kind_check') THEN RAISE EXCEPTION 'tipi non validati'; END IF; END $$;`,
    `DO $$ BEGIN RAISE EXCEPTION '${marker}'; END $$;`,
  ].join("\n");
  await assert.rejects(q(text), (error: unknown) => String((error as { message?: unknown })?.message ?? error).includes(marker));
  assert.equal((await q(`SELECT ${ddl.EVALS_PROBE_SQL} AS ok`))[0].ok, true, "annullata: tutto come prima");
  const withoutTeam = [`DROP TABLE use_case_workspace_team;`, ddl.EVALS_DDL[0]].join("\n");
  await assert.rejects(q(withoutTeam), (error: unknown) => String((error as { message?: unknown })?.message ?? error).includes(ddl.MISSING_TEAM_FOR_EVALS_MESSAGE));
  assert.equal((await q(`SELECT to_regclass('public.use_case_workspace_team') IS NOT NULL AS ok`))[0].ok, true);
});

test("chi scrive e chi legge: il team che costruisce scrive, il cliente legge soltanto, chi non è nel team non vede il caso", opts, async () => {
  const denied = await post(tokens.owner!, banco());
  assert.deepEqual([denied.status, (denied.json.errore as Row).codice], [403, "permesso_negato"]);
  assert.equal((await overview(tokens.owner!)).status, 200, "il responsabile del cliente legge");
  for (const response of [await post(tokens.outsider!, banco()), await overview(tokens.outsider!)]) {
    assert.deepEqual([response.status, (response.json.errore as Row).codice], [404, "non_trovato"]);
  }
  assert.equal((await post(tokens.lead!, banco(), null)).status, 400, "senza la chiave di idempotenza");
  assert.equal((await call("evals", { method: "POST", body: banco(), headers: { "idempotency-key": key() } })).status, 401, "senza token");
  assert.equal((await overview(tokens.lead!, "EV-9999")).status, 404);
  assert.equal((await q(`SELECT count(*)::int AS n FROM use_case_eval_runs WHERE use_case_id = $1`, [ids.useCase]))[0].n, 0, "niente scritto");
});

test("i corpi sbagliati: 400 con il messaggio; la chiave resta libera per la richiesta giusta", opts, async () => {
  const k = key();
  const cases: [unknown, RegExp][] = [
    [banco({ tipo: "altro" }), /^tipo:/],
    [banco({ ruolo: undefined }), /^ruolo:/],
    [banco({ modelliFinti: undefined }), /^modelliFinti:/],
    [evalsBody(95, { inCostruzione: undefined }), /^inCostruzione:/],
    [banco({ risultati: [] }), /^risultati: da 1 a 12/],
    [banco({ risultati: [result({ modello: SONNET }), result({ modello: HAIKU })] }), /esattamente un modello «attuale»/],
    [banco({ risultati: [result({ superati: 29 })] }), /superate non possono essere più delle totali/],
    [evalsBody(95, { risultati: [result(), result({ modello: SONNET, attuale: false })] }), /un solo risultato/],
    [banco({ commit: "XYZ" }), /^commit:/],
  ];
  for (const [body, message] of cases) {
    const r = await post(tokens.lead!, body, k);
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 120));
    assert.equal((r.json.errore as Row).codice, "dati_non_validi");
    assert.match(String((r.json.errore as Row).messaggio), message);
  }
  assert.equal((await post(tokens.lead!, { ...banco(), caso: undefined }, k)).status, 400, "senza il caso");
  const fine = await post(tokens.lead!, evalsBody(95, { ramo: "ev-0001/prova-chiave" }), k);
  assert.equal(fine.status, 200, "la chiave dei 400 si usa ancora");
  await q(`DELETE FROM use_case_eval_runs WHERE id = $1`, [fine.json.id]);
});

test("il banco «cambia»: la raccomandazione con il modello; campanella ed e-mail al team che costruisce, mai a chi l'ha lanciato; una al giorno", opts, async () => {
  await clearNotices("banco_consiglio");
  const queued = afterQueue().length;
  const r = await post(tokens.lead!, banco());
  assert.equal(r.status, 200, r.text);
  assert.match(String(r.json.id), /^[0-9a-f-]{36}$/);
  const rec = r.json.raccomandazione as Row;
  assert.deepEqual([rec.tipo, rec.modello], ["cambia", HAIKU]);
  assert.match(String(rec.testo), /^Conviene Claude Haiku 5\.5 per «lettura»: 96,4%, 0,12\s?USD per 1\.000 esecuzioni, contro 96,4%, 1,80\s?USD per 1\.000 esecuzioni di Claude Sonnet 5\.5/);
  assert.equal(r.json.avviso, null);
  assert.equal(r.json.link, `http://127.0.0.1:53110/dashboard/${ids.ws}/use-cases/${ids.useCase}/progetto#banco`);
  assert.deepEqual(Object.keys(r.json).sort(), ["avviso", "id", "link", "raccomandazione"]);
  // Le righe: l'esecuzione e i due risultati, la qualità ricalcolata, nel caso giusto.
  const [run] = await q(`SELECT kind, role, level, branch, commit_sha, template_version, models, fake_models, in_construction, cases_total FROM use_case_eval_runs WHERE id = $1`, [r.json.id]);
  assert.deepEqual(run, { kind: "banco", role: "lettura", level: "pull_request", branch: "main", commit_sha: "a1b2c3d", template_version: "1.4.0", models: { lettura: SONNET, scrittura: HAIKU }, fake_models: false, in_construction: false, cases_total: 28 });
  const results = await q(`SELECT model, current, quality, passed, total, cost_per_1000_usd::text AS cost, use_case_id, workspace_id FROM use_case_eval_results WHERE run_id = $1 ORDER BY model`, [r.json.id]);
  assert.deepEqual(results.map((x) => [x.model, x.current, x.quality, x.passed, x.total, x.cost, x.use_case_id, x.workspace_id]), [
    [HAIKU, false, 27 / 28, 27, 28, "0.120000", ids.useCase, ids.ws],
    [SONNET, true, 27 / 28, 27, 28, "1.800000", ids.useCase, ids.ws],
  ]);
  // Al team che costruisce tranne chi l'ha lanciato; mai al cliente.
  assert.deepEqual(await bell("banco_consiglio"), sorted("analyst", "dev"));
  const queuedMails = await mails("banco_consiglio");
  assert.deepEqual(queuedMails.map((m) => String(m.recipient_user_id)), sorted("analyst", "dev"));
  assert.deepEqual(queuedMails[0].payload, { useCase: ids.useCase, role: "lettura", model: HAIKU, label: "Claude Haiku 5.5" });
  // Le e-mail partono dopo la risposta; qui senza Resend restano in coda con il motivo.
  assert.equal(afterQueue().length, queued + 1, "il giro delle e-mail dopo la risposta");
  await afterQueue().pop()!();
  assert.deepEqual((await mails("banco_consiglio")).map((m) => [m.status, m.hold_reason]), [
    ["in_coda", "email_non_configurata"],
    ["in_coda", "email_non_configurata"],
  ]);
  // Un altro consiglio lo stesso giorno (un altro ruolo, un'altra persona): una riga per persona, un'e-mail sola.
  const again = await post(tokens.analyst!, banco({ ruolo: "scrittura", modelli: { scrittura: SONNET } }));
  assert.equal(again.status, 200);
  assert.equal((again.json.raccomandazione as Row).tipo, "cambia");
  assert.deepEqual(await bell("banco_consiglio"), sorted("analyst", "dev", "lead"), "il lead ora sì: non l'ha lanciato lui");
  assert.equal((await mails("banco_consiglio")).length, 3, "una e-mail al giorno per caso e persona");
});

test("la stessa chiave: la stessa risposta («ripetuta»), un corpo diverso è un conflitto; nessun doppione, nessun avviso in più", opts, async () => {
  const k = key();
  const body = banco({ ruolo: "riassunto", modelli: { riassunto: SONNET } });
  const first = await post(tokens.dev!, body, k);
  assert.equal(first.status, 200);
  const runs = async () => (await q(`SELECT count(*)::int AS n FROM use_case_eval_runs WHERE use_case_id = $1 AND role = 'riassunto'`, [ids.useCase]))[0].n;
  const notices = async () => (await q(`SELECT count(*)::int AS n, max(last_event_at)::text AS at FROM use_case_notifications WHERE use_case_id = $1 AND kind = 'banco_consiglio'`, [ids.useCase]))[0];
  const before = await notices();
  const repeated = await post(tokens.dev!, body, k);
  assert.equal(repeated.status, 200);
  assert.equal(repeated.json.ripetuta, true);
  assert.deepEqual({ ...repeated.json, ripetuta: undefined }, { ...first.json, ripetuta: undefined });
  assert.equal(await runs(), 1);
  assert.deepEqual(await notices(), before, "una ripetizione non avvisa di nuovo");
  const conflict = await post(tokens.dev!, { ...body, risultati: [result({ modello: SONNET, costoPer1000Usd: 2 }), result({ modello: HAIKU, attuale: false })] }, k);
  assert.deepEqual([conflict.status, (conflict.json.errore as Row).codice], [409, "idempotenza"]);
  assert.equal(await runs(), 1);
});

test("il banco «resta» e il banco con i modelli finti: nessun avviso; con i finti nessuna raccomandazione", opts, async () => {
  await clearNotices("banco_consiglio");
  const stay = await post(tokens.lead!, banco({
    ruolo: "scrittura",
    modelli: { scrittura: HAIKU },
    risultati: [result({ modello: HAIKU }), result({ modello: OPUS, attuale: false, superati: 28, costoPer1000Usd: 3.6 })],
  }));
  assert.equal(stay.status, 200);
  assert.deepEqual([(stay.json.raccomandazione as Row).tipo, (stay.json.raccomandazione as Row).modello], ["resta", HAIKU]);
  const fake = await post(tokens.lead!, banco({ modelliFinti: true }));
  assert.equal(fake.status, 200);
  assert.equal(fake.json.raccomandazione, null, "modelli finti: nessuna raccomandazione");
  assert.equal(fake.json.avviso, null);
  const nobody = await post(tokens.lead!, banco({ ruolo: "verifica", modelli: {}, risultati: [result({ modello: SONNET, soglieRispettate: false }), result({ modello: HAIKU, attuale: false, soglieRispettate: false })] }));
  assert.equal((nobody.json.raccomandazione as Row).tipo, "nessuno");
  assert.ok(!("modello" in (nobody.json.raccomandazione as Row)));
  assert.deepEqual(await bell("banco_consiglio"), [], "resta, finti e nessuno: nessun avviso");
  assert.equal((await mails("banco_consiglio")).length, 0);
});

test("le evals: sotto soglia su main avvisano il team; in costruzione, con i modelli finti o su un altro ramo no; giù di 5 punti sì", opts, async () => {
  await clearNotices("evals_in_calo");
  const send = async (passed: number, over: Record<string, unknown> = {}, token = tokens.analyst!) => {
    const r = await post(token, evalsBody(passed, over));
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.raccomandazione, null, "le evals non hanno una raccomandazione");
    return r.json.avviso;
  };
  // In costruzione: sotto soglia, nessun avviso (né nella risposta né al team).
  assert.equal(await send(80, { inCostruzione: true }), null);
  // Su un altro ramo: l'avviso a chi le manda, non al team.
  assert.equal(await send(80, { ramo: "ev-0001/t-1-lettura" }), "sotto_soglia");
  // Con i modelli finti: lo stesso.
  assert.equal(await send(50, { modelliFinti: true }), "sotto_soglia");
  assert.deepEqual(await bell("evals_in_calo"), [], "nessun avviso al team finora");
  // Main, modelli veri, non in costruzione, sotto soglia: il team che costruisce, tranne chi le ha mandate.
  assert.equal(await send(80), "sotto_soglia");
  assert.deepEqual(await bell("evals_in_calo"), sorted("dev", "lead"));
  const [below] = await mails("evals_in_calo");
  assert.deepEqual(below.payload, { useCase: ids.useCase, alert: "sotto_soglia", qualityText: "80%" });
  // Sopra soglia e in salita: niente.
  assert.equal(await send(97), null);
  // Giù di 6 punti rispetto alle precedenti di main con i modelli veri: «in_calo», con il calo.
  await clearNotices("evals_in_calo");
  assert.equal(await send(91, {}, tokens.lead!), "in_calo");
  assert.deepEqual(await bell("evals_in_calo"), sorted("analyst", "dev"));
  const [down] = await mails("evals_in_calo");
  assert.equal((down.payload as Row).alert, "in_calo");
  assert.equal((down.payload as Row).qualityText, "91%");
  assert.ok(Math.abs(Number((down.payload as Row).drop) - 0.06) < 1e-9);
  // Giù di 2 punti: niente. Le finte di prima (50) non contano per le vere.
  assert.equal(await send(89), null);
  // Di nuovo sotto soglia: «sotto_soglia» vince sul calo.
  assert.equal(await send(80, {}, tokens.dev!), "sotto_soglia");
});

test("la panoramica: main prima, l'andamento dalla più vecchia della stessa serie (ultime 12), il banco per ruolo; senza main, l'ultimo ramo", opts, async () => {
  const cli = await overview(tokens.owner!);
  assert.equal(cli.status, 200);
  assert.equal(cli.json.caso, CODE);
  const ev = cli.json.evals as Row;
  const latest = ev.ultime as Row;
  assert.deepEqual([latest.tipo, latest.ramo, latest.ruolo, latest.modelliFinti, latest.inCostruzione, latest.prove], ["evals", "main", null, false, false, 100]);
  assert.equal((latest.risultati as Row[])[0].superati, 80, "le ultime di main");
  const trend = ev.andamento as Row[];
  // Quelle di main con i modelli veri, dalla più vecchia: le finte (50) sono un'altra serie.
  assert.deepEqual(trend.map((t) => Math.round(Number(t.qualita) * 100)), [80, 80, 97, 91, 89, 80], "le vere di main, dalla più vecchia, senza le finte");
  assert.ok(trend.every((t) => t.modelliFinti === false));
  const banchi = cli.json.banchi as Row[];
  assert.deepEqual(banchi.map((b) => b.ruolo), ["lettura", "riassunto", "scrittura", "verifica"], "l'ultimo banco di ogni ruolo, in ordine");
  const lettura = banchi[0];
  assert.equal(lettura.modelliFinti, true, "l'ultimo banco di «lettura» era con i modelli finti");
  assert.equal(lettura.raccomandazione, null);
  const scrittura = banchi.find((b) => b.ruolo === "scrittura")!;
  assert.deepEqual([(scrittura.raccomandazione as Row).tipo, scrittura.piuBravo, scrittura.piuEconomico], ["resta", OPUS, HAIKU]);
  assert.deepEqual(Object.keys((scrittura.risultati as Row[])[0]), ["modello", "attuale", "qualita", "superati", "totali", "soglieRispettate", "gruppi", "costoPer1000Usd", "latenzaP50Ms", "latenzaP95Ms", "tokenIngressoMedi", "tokenUscitaMedi", "errori"]);
  assert.equal((scrittura.risultati as Row[])[0].attuale, true, "l'attuale per primo");

  // La stessa cosa per la pagina; con 13 evals vere di main l'andamento tiene le ultime 12, l'ultima compresa.
  const target = { workspaceId: ids.ws, useCaseId: ids.useCase };
  for (let i = 0; i < 7; i++) {
    const parsed = (await import("./benchmark-input.ts")).parseEvalRun(evalsBody(90 + i));
    assert.ok(parsed.ok);
    if (parsed.ok) assert.ok((await evals.recordEvalRun(exec, target, parsed.value, { actorUserId: ids.lead })).ok);
  }
  const page = await evals.loadEvalOverview(exec, target);
  assert.ok(page);
  if (!page) return;
  assert.equal(page.evals.trend.length, evals.EVALS_TREND_MAX);
  assert.deepEqual(page.evals.trend.map((t) => Math.round(t.quality * 100)), [80, 97, 91, 89, 80, 90, 91, 92, 93, 94, 95, 96]);
  assert.ok(page.evals.trend.every((t, i, all) => i === 0 || t.at >= all[i - 1].at), "dalla più vecchia");
  assert.equal(page.evals.latest?.results[0].passed, 96);
  assert.equal(page.evals.trend.at(-1)?.at, page.evals.latest?.createdAt, "l'andamento finisce con le ultime");
  // Gli istanti con i millesimi del database, non arrotondati al secondo.
  const [exact] = await q(`SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at FROM use_case_eval_runs WHERE id = $1`, [page.evals.latest?.id]);
  assert.equal(page.evals.latest?.createdAt, exact.at);
  assert.deepEqual(page.benches.map((b) => [b.role, b.analysis.verdict.kind]), [["lettura", "finti"], ["riassunto", "cambia"], ["scrittura", "resta"], ["verifica", "nessuno"]]);
  // Un ramo più recente non prende il posto di main.
  const branch = (await import("./benchmark-input.ts")).parseEvalRun(evalsBody(70, { ramo: "ev-0001/t-9" }));
  assert.ok(branch.ok && (await evals.recordEvalRun(exec, target, branch.value, { actorUserId: ids.lead })).ok);
  assert.equal((await evals.loadEvalOverview(exec, target))?.evals.latest?.branch, "main");
  // Un caso senza evals di main: le ultime, e l'andamento del loro ramo.
  const other = { workspaceId: ids.ws, useCaseId: ids.other };
  for (const [passed, ramo] of [[60, "ev-0002/t-1"], [70, "ev-0002/t-2"], [75, "ev-0002/t-1"]] as const) {
    const parsed = (await import("./benchmark-input.ts")).parseEvalRun({ ...evalsBody(passed, { ramo }), caso: "EV-0002" });
    assert.ok(parsed.ok && (await evals.recordEvalRun(exec, other, parsed.value, { actorUserId: ids.lead })).ok);
  }
  const noMain = await evals.loadEvalOverview(exec, other);
  assert.deepEqual([noMain?.evals.latest?.branch, noMain?.evals.trend.map((t) => Math.round(t.quality * 100))], ["ev-0002/t-1", [60, 75]]);
  assert.deepEqual(noMain?.benches, []);
  // Un caso senza niente: tutto vuoto.
  const empty = await overview(tokens.lead!, "EV-0003");
  assert.deepEqual(empty.json, { caso: "EV-0003", evals: { ultime: null, andamento: [] }, banchi: [] });
});

test("la pagina «Agent Factory»: le evals e il consiglio del banco per caso; in «Da fare per te» solo a chi costruisce", opts, async () => {
  const line = await import("../../db/queries/use-case-factory-line.ts");
  const { benchFacts, evalsFact } = await import("./line.ts");
  // Le ultime evals di main sotto soglia.
  const below = (await import("./benchmark-input.ts")).parseEvalRun(evalsBody(84));
  assert.ok(below.ok && (await evals.recordEvalRun(exec, { workspaceId: ids.ws, useCaseId: ids.useCase }, below.value, { actorUserId: ids.lead })).ok);
  const view = await line.loadFactoryOverview(exec, { workspaceId: ids.ws, userId: ids.analyst, seeAll: false, canSeeNeeds: true });
  const ev = view.cases.find((c) => c.useCaseId === ids.useCase)!;
  assert.deepEqual([ev.evals?.quality, ev.evals?.thresholdsMet, ev.evals?.branch, ev.evals?.fakeModels], [0.84, false, "main", false]);
  assert.equal(evalsFact(ev.evals), "evals 84%, sotto soglia");
  assert.deepEqual(ev.benches.map((b) => [b.role, b.verdict.kind, b.superseded]), [["lettura", "finti", false], ["riassunto", "cambia", false], ["scrittura", "resta", false], ["verifica", "nessuno", false]]);
  assert.deepEqual(benchFacts(ev.benches), ["il banco consiglia Claude Haiku 5.5 per «riassunto»"]);
  const mine = view.todos.filter((t) => t.useCaseId === ids.useCase && (t.kind === "banco" || t.kind === "evals"));
  assert.deepEqual(mine.map((t) => t.kind), ["banco", "evals"]);
  assert.match(mine[0].text, /^Conviene Claude Haiku 5\.5 per «riassunto»/);
  assert.equal(mine[1].text, "Le evals di main sono sotto soglia (84%): guarda quali prove non passano.");
  assert.ok(view.todos.every((t) => PEOPLE.every((p) => !t.text.includes(NAME[p]))), "«Da fare per te» senza nomi");
  // L'altro caso: evals solo su un ramo, sotto soglia: si dicono, ma non sono «Da fare».
  const other = view.cases.find((c) => c.useCaseId === ids.other)!;
  assert.equal(evalsFact(other.evals), "evals 75%, sotto soglia");
  assert.ok(!view.todos.some((t) => t.useCaseId === ids.other && t.kind === "evals"), "non di main");
  // Il cliente è nel team ma non costruisce: vede i casi, non i «Da fare» del banco.
  const client = await line.loadFactoryOverview(exec, { workspaceId: ids.ws, userId: ids.owner, seeAll: false, canSeeNeeds: false });
  assert.ok(client.cases.some((c) => c.useCaseId === ids.useCase));
  assert.ok(!client.todos.some((t) => t.kind === "banco" || t.kind === "evals"));
  // In costruzione: niente «Da fare» per le evals.
  const building = (await import("./benchmark-input.ts")).parseEvalRun(evalsBody(84, { inCostruzione: true }));
  assert.ok(building.ok && (await evals.recordEvalRun(exec, { workspaceId: ids.ws, useCaseId: ids.useCase }, building.value, { actorUserId: ids.lead })).ok);
  const later = await line.loadFactoryOverview(exec, { workspaceId: ids.ws, userId: ids.analyst, seeAll: false, canSeeNeeds: true });
  assert.ok(!later.todos.some((t) => t.useCaseId === ids.useCase && t.kind === "evals"));
  assert.ok(later.todos.some((t) => t.useCaseId === ids.useCase && t.kind === "banco"));
});

test("le evals insieme dello stesso caso: una alla volta, ogni avviso rispetto alla precedente vera", opts, async () => {
  const target = { workspaceId: ids.ws, useCaseId: ids.third };
  const { parseEvalRun } = await import("./benchmark-input.ts");
  const { evalsAlert } = await import("./benchmark.ts");
  const inputs = [97, 90, 83, 76].map((passed) => {
    const parsed = parseEvalRun({ ...evalsBody(passed, { ramo: "main" }), caso: "EV-0003" });
    assert.ok(parsed.ok);
    return parsed.ok ? parsed.value : (undefined as never);
  });
  const recorded = await Promise.all(inputs.map((input) => evals.recordEvalRun(exec, target, input, { actorUserId: ids.dev })));
  assert.ok(recorded.every((r) => r.ok), JSON.stringify(recorded));
  const rows = await q(
    `SELECT r.id, x.passed FROM use_case_eval_runs r JOIN use_case_eval_results x ON x.run_id = r.id WHERE r.use_case_id = $1 AND r.kind = 'evals' ORDER BY r.created_at, r.id`,
    [ids.third],
  );
  assert.equal(rows.length, 4);
  // Nell'ordine in cui sono state scritte, ognuna confrontata con quella prima.
  rows.forEach((row, i) => {
    const r = recorded.find((x) => x.ok && x.value.id === row.id);
    assert.ok(r && r.ok);
    const point = (passed: number) => ({ quality: passed / 100, thresholdsMet: passed >= 85, fakeModels: false, inConstruction: false, branch: "main", level: "pull_request" });
    const expected = evalsAlert(i === 0 ? null : point(Number(rows[i - 1].passed)), point(Number(row.passed)));
    if (r && r.ok) assert.deepEqual(r.value.alert, expected, `esecuzione ${i}`);
  });
});

test("una ripresa con lo stesso id risponde come la prima volta e non avvisa di nuovo; senza la 0036, null e «non disponibile»", opts, async () => {
  const { parseEvalRun } = await import("./benchmark-input.ts");
  const target = { workspaceId: ids.ws, useCaseId: ids.useCase };
  const id = randomUUID();
  const parsed = parseEvalRun(evalsBody(70));
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  await clearNotices("evals_in_calo");
  const first = await evals.recordEvalRun(exec, target, parsed.value, { id, actorUserId: ids.lead });
  assert.ok(first.ok && first.value.notified && first.value.alert?.kind === "sotto_soglia");
  const before = await bell("evals_in_calo");
  const again = await evals.recordEvalRun(exec, target, parsed.value, { id, actorUserId: ids.lead });
  assert.ok(again.ok && first.ok);
  if (!again.ok || !first.ok) return;
  assert.deepEqual([again.value.id, again.value.alert, again.value.notified], [id, first.value.alert, false]);
  assert.equal((await q(`SELECT count(*)::int AS n FROM use_case_eval_runs WHERE id = $1`, [id]))[0].n, 1);
  assert.deepEqual(await bell("evals_in_calo"), before);
  // Lo stesso id per un altro caso: un conflitto, mai un'altra riga.
  const elsewhere = await evals.recordEvalRun(exec, { workspaceId: ids.ws, useCaseId: ids.other }, parsed.value, { id, actorUserId: ids.lead });
  assert.deepEqual(elsewhere.ok ? null : elsewhere.code, "conflitto");
  // Un banco ripreso: la stessa lettura.
  const bench = parseEvalRun(banco({ ruolo: "ripresa", modelli: {} }));
  assert.ok(bench.ok);
  if (!bench.ok) return;
  const benchId = randomUUID();
  const b1 = await evals.recordEvalRun(exec, target, bench.value, { id: benchId, actorUserId: ids.lead });
  const b2 = await evals.recordEvalRun(exec, target, bench.value, { id: benchId, actorUserId: ids.lead });
  assert.ok(b1.ok && b2.ok);
  if (b1.ok && b2.ok) assert.deepEqual([b2.value.analysis?.verdict, b2.value.notified], [b1.value.analysis?.verdict, false]);
  // Uno use case che non c'è: non trovato.
  assert.deepEqual(await evals.recordEvalRun(exec, { workspaceId: ids.ws, useCaseId: randomUUID() }, parsed.value, { actorUserId: ids.lead }).then((r) => (r.ok ? null : r.code)), "non_trovato");
  // Senza la 0036 (una sonda che dice di no): la pagina riceve null, la scrittura «non disponibile», la pagina della fabbrica niente.
  const missing = { batch: async () => [[{ ready: false }]] } as unknown as typeof exec;
  assert.equal(await evals.loadEvalOverview(missing, target), null);
  assert.deepEqual(await evals.recordEvalRun(missing, target, parsed.value, { actorUserId: ids.lead }).then((r) => (r.ok ? null : r.code)), "non_disponibile");
  assert.equal((await evals.loadEvalFacts(missing, ids.ws, [ids.useCase])).size, 0);
  assert.equal(await evals.evalsStoreReady({ batch: async () => Promise.reject(new Error("rete")) } as unknown as typeof exec), false);
});

/** Le evals di EV-0004: `passed` su `total`, la soglia è 85%. */
const fourthEvals = (passed: number, total: number, over: Record<string, unknown> = {}) => ({
  ...evalsBody(passed, over),
  caso: "EV-0004",
  risultati: [result({ superati: passed, totali: total, soglieRispettate: passed / total >= 0.85 })],
});

test("le evals si confrontano solo con quelle dello stesso livello: da «veloce» a «pull_request» non è un calo, e l'andamento non le mescola", opts, async () => {
  await clearNotices("evals_in_calo");
  const target = { workspaceId: ids.ws, useCaseId: ids.fourth };
  const { parseEvalRun } = await import("./benchmark-input.ts");
  // «veloce»: le regole, gli avversari e i primi 20 casi d'oro, tutte passate.
  const fast = await post(tokens.analyst!, fourthEvals(35, 35, { livello: "veloce" }));
  assert.deepEqual([fast.status, fast.json.avviso], [200, null]);
  // Poi tutte le prove: 7 punti sotto le veloci, ma non sono le stesse prove. Nessun calo, nessun avviso al team.
  const full = parseEvalRun(fourthEvals(107, 115));
  assert.ok(full.ok);
  if (!full.ok) return;
  const id = randomUUID();
  const first = await evals.recordEvalRun(exec, target, full.value, { id, actorUserId: ids.analyst });
  assert.ok(first.ok);
  if (!first.ok) return;
  assert.deepEqual([first.value.alert, first.value.notified], [null, false]);
  // La ripresa con lo stesso id confronta allo stesso modo.
  const again = await evals.recordEvalRun(exec, target, full.value, { id, actorUserId: ids.analyst });
  assert.ok(again.ok && again.value.alert === null);
  assert.deepEqual(await bell("evals_in_calo", ids.fourth), []);
  let page = await evals.loadEvalOverview(exec, target);
  assert.deepEqual([page?.evals.latest?.level, page?.evals.trend.map((t) => Math.round(t.quality * 1000))], ["pull_request", [930]], "un punto: le veloci non sono nell'andamento");
  // Lo stesso livello sì: sotto soglia, 8,4 punti sotto le precedenti complete; il team lo sa.
  const below = await post(tokens.analyst!, fourthEvals(55, 65));
  assert.deepEqual([below.status, below.json.avviso], [200, "sotto_soglia"]);
  assert.deepEqual(await bell("evals_in_calo", ids.fourth), sorted("dev", "lead"));
  const [mail] = await mails("evals_in_calo", ids.dossierFourth);
  assert.deepEqual(mail.payload, { useCase: ids.fourth, alert: "sotto_soglia", qualityText: "84,6%" });
  page = await evals.loadEvalOverview(exec, target);
  assert.deepEqual(page?.evals.trend.map((t) => Math.round(t.quality * 1000)), [930, 846]);
  // Di nuovo veloci, tutte passate: rispetto alle veloci di prima niente; nell'andamento delle complete non entrano.
  const fastAgain = await post(tokens.analyst!, fourthEvals(35, 35, { livello: "veloce" }));
  assert.deepEqual([fastAgain.status, fastAgain.json.avviso], [200, null]);
});

test("lo stato delle evals del caso: le vere e complete di main, anche se dopo arrivano evals «veloce» o con i modelli finti", opts, async () => {
  // EV-0004 (dal test di prima): le complete di main, vere, sotto soglia (55 su 65); poi le veloci, tutte passate.
  const target = { workspaceId: ids.ws, useCaseId: ids.fourth };
  const fake = await post(tokens.analyst!, fourthEvals(65, 65, { modelliFinti: true }));
  assert.deepEqual([fake.status, fake.json.avviso], [200, null]);
  // La pagina: le complete vere, con il loro andamento; né le veloci né le finte, che sono più recenti.
  const page = await evals.loadEvalOverview(exec, target);
  assert.deepEqual([page?.evals.latest?.level, page?.evals.latest?.fakeModels, page?.evals.latest?.results[0].passed], ["pull_request", false, 55]);
  assert.deepEqual(page?.evals.trend.map((t) => [Math.round(t.quality * 1000), t.fakeModels]), [[930, false], [846, false]]);
  assert.equal(page?.evals.trend.at(-1)?.at, page?.evals.latest?.createdAt, "l'ultimo punto è lo stato");
  // La CLI legge la stessa cosa.
  const cli = await overview(tokens.lead!, "EV-0004");
  const latest = (cli.json.evals as Row).ultime as Row;
  assert.deepEqual([latest.livello, latest.modelliFinti, (latest.risultati as Row[])[0].superati], ["pull_request", false, 55]);
  assert.equal(((cli.json.evals as Row).andamento as Row[]).length, 2);
  // L'Agent Factory e «Da fare per te»: sotto soglia resta da fare.
  const line = await import("../../db/queries/use-case-factory-line.ts");
  const view = await line.loadFactoryOverview(exec, { workspaceId: ids.ws, userId: ids.analyst, seeAll: false, canSeeNeeds: true });
  const row = view.cases.find((c) => c.useCaseId === ids.fourth)!;
  assert.deepEqual([row.evals?.quality, row.evals?.thresholdsMet, row.evals?.fakeModels, row.evals?.branch], [55 / 65, false, false, "main"]);
  assert.deepEqual(view.todos.filter((t) => t.useCaseId === ids.fourth).map((t) => t.kind), ["evals"]);
  // Senza evals vere di main, le finte di main vengono prima di quelle vere di un ramo (main prima di tutto).
  const onlyFake = { workspaceId: ids.ws, useCaseId: ids.third };
  const { parseEvalRun } = await import("./benchmark-input.ts");
  await q(`DELETE FROM use_case_eval_runs WHERE use_case_id = $1 AND kind = 'evals'`, [ids.third]);
  for (const body of [fourthEvals(60, 100, { ramo: "ev-0003/t-1" }), fourthEvals(99, 100, { modelliFinti: true })]) {
    const parsed = parseEvalRun({ ...body, caso: "EV-0003" });
    assert.ok(parsed.ok && (await evals.recordEvalRun(exec, onlyFake, parsed.value, { actorUserId: ids.lead })).ok);
  }
  const third = await evals.loadEvalOverview(exec, onlyFake);
  assert.deepEqual([third?.evals.latest?.branch, third?.evals.latest?.fakeModels, third?.evals.trend.length], ["main", true, 1]);
  await q(`DELETE FROM use_case_eval_runs WHERE use_case_id = $1 AND kind = 'evals'`, [ids.third]);
});

test("un banco superato non consiglia più: evals vere di main con il nuovo modello, o senza il ruolo; con lo stesso modello resta da fare", opts, async () => {
  // EV-0002: finora solo evals su dei rami, nessun banco.
  const target = { workspaceId: ids.ws, useCaseId: ids.other };
  const line = await import("../../db/queries/use-case-factory-line.ts");
  const { benchFacts } = await import("./line.ts");
  const { benchSuperseded } = await import("./benchmark.ts");
  const evalsOf = (modelli: Record<string, string>, over: Record<string, unknown> = {}) => ({ ...evalsBody(95, { modelli, ...over }), caso: "EV-0002" });
  const state = async () => {
    const view = await line.loadFactoryOverview(exec, { workspaceId: ids.ws, userId: ids.analyst, seeAll: false, canSeeNeeds: true });
    const row = view.cases.find((c) => c.useCaseId === ids.other)!;
    return { row, todos: view.todos.filter((t) => t.useCaseId === ids.other && t.kind === "banco").map((t) => t.text), facts: benchFacts(row.benches) };
  };
  const advice = "il banco consiglia Claude Haiku 5.5 per «lettura»";
  // Il banco «lettura» consiglia Haiku al posto di Sonnet.
  const bench = await post(tokens.lead!, { ...banco(), caso: "EV-0002" });
  assert.equal((bench.json.raccomandazione as Row).tipo, "cambia");
  let now = await state();
  assert.deepEqual([now.facts, now.todos.length, now.row.benches[0].superseded], [[advice], 1, false], "le evals del caso sono di un ramo: il consiglio resta");
  assert.deepEqual([now.row.benches[0].currentModel, now.row.benches[0].at.length > 0], [SONNET, true]);
  // Evals vere di main con lo stesso modello per «lettura»: il consiglio resta da fare.
  assert.equal((await post(tokens.lead!, evalsOf({ lettura: SONNET, scrittura: HAIKU }))).status, 200);
  now = await state();
  assert.deepEqual([now.facts, now.todos.length, now.row.benches[0].superseded], [[advice], 1, false], "stesso modello");
  // Con il nuovo modello, ma finte o su un altro ramo: non fanno lo stato del caso, il consiglio resta.
  assert.equal((await post(tokens.lead!, evalsOf({ lettura: HAIKU }, { modelliFinti: true }))).status, 200);
  assert.equal((await post(tokens.lead!, evalsOf({ lettura: HAIKU }, { ramo: "ev-0002/t-3-haiku" }))).status, 200);
  now = await state();
  assert.deepEqual([now.facts, now.todos.length], [[advice], 1], "finte o di un ramo");
  // Evals vere di main con Haiku per «lettura»: il consiglio è stato seguito. Niente «Da fare», niente fatto.
  assert.equal((await post(tokens.lead!, evalsOf({ lettura: HAIKU, scrittura: HAIKU }))).status, 200);
  now = await state();
  assert.deepEqual([now.facts, now.todos, now.row.benches[0].superseded, now.row.benches[0].verdict.kind], [[], [], true, "cambia"]);
  assert.deepEqual(now.row.evals?.models, { lettura: HAIKU, scrittura: HAIKU });
  // La pagina ha quello che serve per dirlo: le evals che fanno lo stato e il banco, con i loro istanti e modelli.
  const page = await evals.loadEvalOverview(exec, target);
  const latest = page?.evals.latest ?? null;
  const pageBench = page?.benches.find((b) => b.role === "lettura");
  assert.ok(latest && pageBench);
  if (!latest || !pageBench) return;
  const superseded = (models: Record<string, string>) =>
    benchSuperseded(
      { role: pageBench.role, at: pageBench.run.createdAt, currentModel: pageBench.run.results.find((r) => r.current)?.model ?? null },
      { at: latest.createdAt, branch: latest.branch, fakeModels: latest.fakeModels, models },
    );
  assert.equal(superseded(latest.models), true);
  // Il ruolo tolto da agent.yaml: lo stesso, il consiglio non è più da fare.
  assert.equal((await post(tokens.lead!, evalsOf({ scrittura: HAIKU }))).status, 200);
  now = await state();
  assert.deepEqual([now.facts, now.todos, now.row.benches[0].superseded], [[], [], true]);
  // Un banco nuovo, dopo le evals: il suo consiglio torna da fare.
  assert.equal((await post(tokens.lead!, { ...banco(), caso: "EV-0002" })).status, 200);
  now = await state();
  assert.deepEqual([now.facts, now.todos.length, now.row.benches[0].superseded], [[advice], 1, false]);
});

test("il consiglio verso un modello fuori dal catalogo: in coda senza nome, e l'e-mail non scrive mai l'id", opts, async () => {
  await clearNotices("banco_consiglio");
  const { planDelivery } = await import("../../uc/notify/dispatch.ts");
  const { renderEmail } = await import("../../uc/notify/email-templates.ts");
  const evil = "https://evil.example/";
  // Il banco di EV-0003: un «modello» scelto da chi manda, che costa il 94% in meno con la stessa qualità.
  const r = await post(tokens.lead!, { ...banco({ risultati: [result({ modello: SONNET, costoPer1000Usd: 1.8 }), result({ modello: evil, attuale: false, costoPer1000Usd: 0.1 })] }), caso: "EV-0003" });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([(r.json.raccomandazione as Row).tipo, (r.json.raccomandazione as Row).modello], ["cambia", evil]);
  const queued = await mails("banco_consiglio", ids.dossierThird);
  assert.deepEqual(queued.map((m) => String(m.recipient_user_id)), sorted("analyst", "dev"));
  assert.deepEqual(queued[0].payload, { useCase: ids.third, role: "lettura", model: evil }, "nessun nome da scrivere");
  // L'e-mail dalla riga vera della coda.
  const plan = planDelivery(
    {
      id: randomUUID(),
      workspaceId: ids.ws,
      caseId: ids.dossierThird,
      requestId: null,
      recipientContactId: null,
      recipientUserId: ids.analyst,
      templateKey: "banco_consiglio",
      payload: queued[0].payload as Record<string, string | boolean>,
      attempts: 0,
      dedupeKey: `banco_consiglio:${ids.dossierThird}:${ids.analyst}`,
    },
    {
      clientName: "Cliente prova",
      case: { id: ids.dossierThird, code: "EV-0003", title: "Risposte ai fornitori", status: "pronto_sviluppo", ownerContactId: null, designated: { owner: null, privacy: null } },
      recipient: { kind: "user", id: ids.analyst, email: EMAIL.analyst, reachable: true, digestOptOut: false, lateralSpace: true },
      request: null,
    },
    { origin: "https://app.unbundle.test", lsDomains: ["ls.test"], now: new Date() },
  );
  assert.equal(plan.action, "send");
  if (plan.action !== "send") return;
  const email = renderEmail(plan.build(null));
  assert.match(email.text, /il banco di prova consiglia un altro modello: il confronto è nel progetto\./);
  assert.ok(!email.text.includes("evil") && !email.html.includes("evil") && !email.subject.includes("evil"));
  await clearNotices("banco_consiglio");
  await q(`DELETE FROM use_case_eval_runs WHERE use_case_id = $1 AND kind = 'banco'`, [ids.third]);
});
