import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Client } from "pg";

// Script dell'operatore `scripts/use-case-admin.ts` e riga di config dei workspace nuovi
// (docs/use-case/PIANO-LAVORI.md H2c; docs/use-case/DESIGN.md §10.4-10.9).
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database del pacchetto
//   hub_<id> su 127.0.0.1) gira sul database di prova. Dentro `npm run check` si salta: in testa
//   solo moduli di Node; i moduli dell'app arrivano con `await import()` dentro `before()`.
// - Lo script gira in un processo figlio, come lo lancia l'operatore, con il trasporto locale
//   (scripts/uc-test/local-neon.cjs) e un ambiente pulito: `USE_CASE_ADMIN_DATABASE_URL` e, come
//   trappole, `DATABASE_URL` e le variabili PG* verso un altro database. Il trasporto rifiuta
//   ogni database diverso da quello di prova: se lo script le usasse, fallirebbe.
// - `dossier-dups` si prova su una copia senza la 0020 (0000-0019, `<db>_pre20`), creata e
//   cancellata qui. Alcune prove rinominano per un momento una tabella o una colonna, sempre in
//   un `finally` che la rimette: solo sui database del pacchetto, mai sul modello.
// Dati sintetici, indirizzi .test, creati e cancellati qui.
const url = process.env.DATABASE_URL;
const enabled = process.env.HUB_TEST_ISOLATED === "true" && Boolean(url);
if (enabled) {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || process.env.UC_TEST_DATABASE_URL !== url) {
    throw new Error("Hub DB tests need a loopback DATABASE_URL equal to UC_TEST_DATABASE_URL");
  }
  if (!/^\/hub_[a-z0-9][a-z0-9_]{0,39}$/.test(parsed.pathname)) {
    throw new Error("This suite creates databases and renames tables: run it only on a package database hub_<id>");
  }
  if ((globalThis.fetch as { name?: string }).name !== "localNeonFetch") {
    throw new Error("Preload scripts/uc-test/local-neon.cjs to reach the local test database");
  }
}
const opts = { skip: !enabled };

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const parsedUrl = enabled ? new URL(url!) : null;
const port = parsedUrl?.port ?? "";
const packageDb = parsedUrl?.pathname.slice(1) ?? "";
const scratchDb = `${packageDb}_pre20`;
const dbUrl = (db: string) => `postgresql://uc_test@127.0.0.1:${port}/${db}`;
const TRAP_DB = "hub_trappola_h2c";

type PgClient = Client;
let pg: { Client: new (config: { connectionString: string }) => PgClient };
let main: PgClient;
let admin: PgClient;
let scratch: PgClient | null = null;
let workspacesModule: typeof import("../../db/queries/workspaces.ts");
let prefixModule: typeof import("../prefix.ts");
let fileDir = "";

const suffix = randomBytes(3).toString("hex");
const SUFFIX = suffix.toUpperCase();
const ids = {
  org: randomUUID(),
  lsUser: randomUUID(),
  clientUser: randomUUID(),
  wsA: randomUUID(),
  wsB: randomUUID(),
  wsC: randomUUID(),
  wsD: randomUUID(),
  wsE: randomUUID(),
  wsF: randomUUID(),
  wsG: randomUUID(),
  template: randomUUID(),
  orphan: randomUUID(),
  orphanIncomplete: randomUUID(),
  ucOverflow: randomUUID(),
};
/** Use case del workspace A, in ordine di codice atteso. */
const uc = Array.from({ length: 9 }, () => randomUUID());
const drafts = { sent: randomUUID(), drafting: randomUUID(), abandoned: randomUUID(), justSent: randomUUID() };
/** Schede del workspace G, dove l'area è accesa: due scritte dal servizio dell'hub, una di prima della 0020. */
const hub = { am: randomUUID(), web: randomUUID(), legacyWeb: randomUUID() };
const created: string[] = [];
const NAME_AB = `Acme Industrie Prova H2c ${SUFFIX}`;
const LONG_TITLE = "Classificazione automatica delle richieste di assistenza in arrivo dai clienti";

// ─── Processo figlio e «dump» ────────────────────────────────────────

interface AdminRun {
  status: number;
  docs: Array<Record<string, unknown>>;
  last: Record<string, unknown>;
  stdout: string;
  stderr: string;
}

function parseDocs(stdout: string): Array<Record<string, unknown>> {
  return stdout
    .split(/^\}$/m)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => JSON.parse(`${chunk}\n}`) as Record<string, unknown>);
}

function runAdmin(args: string[], options: { db?: string; adminUrl?: string | null; env?: Record<string, string | undefined> } = {}): AdminRun {
  const db = options.db ?? packageDb;
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "/private/tmp",
    UC_TEST_DATABASE_URL: dbUrl(db),
    UC_TEST_PG_PORT: port,
    UC_TEST_PG_DB: db,
    UC_LS_EMAIL_DOMAINS: "ls.test",
    // Trappole: un altro database. Il trasporto locale lo rifiuterebbe.
    DATABASE_URL: dbUrl(TRAP_DB),
    POSTGRES_URL: dbUrl(TRAP_DB),
    NEON_DATABASE_URL: dbUrl(TRAP_DB),
    PGDATABASE: TRAP_DB,
    // Il CSV del prima/dopo di scoring-v2 va in una cartella temporanea: qui quella della prova.
    TMPDIR: fileDir,
  };
  if (options.adminUrl !== null) env.USE_CASE_ADMIN_DATABASE_URL = options.adminUrl ?? dbUrl(db);
  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  const result = spawnSync(process.execPath, ["--no-warnings", "--require", "./scripts/uc-test/local-neon.cjs", "scripts/use-case-admin.ts", ...args], {
    cwd: ROOT,
    // Solo queste variabili, senza NODE_ENV (che i tipi di Next vogliono in ProcessEnv).
    env: env as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
    timeout: 120_000,
  });
  const docs = parseDocs(result.stdout);
  return { status: result.status ?? -1, docs, last: docs.at(-1) ?? {}, stdout: result.stdout, stderr: result.stderr };
}

const confirm = (db = packageDb) => ["--apply", "--confirm-authorized", "--confirm-database", `127.0.0.1:${port}/${db}`, "--environment", "local"];

/** Contenuto di ogni tabella e schema: uguali prima e dopo una prova a secco. */
async function fingerprint(client: PgClient): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const { rows: tables } = await client.query<{ tablename: string }>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`);
  for (const { tablename } of tables) {
    const { rows } = await client.query<{ n: number; h: string }>(
      `SELECT count(*)::int AS n, md5(coalesce(string_agg(t::text, E'\\n' ORDER BY t::text), '')) AS h FROM public."${tablename}" t`,
    );
    out[tablename] = `${rows[0].n}:${rows[0].h}`;
  }
  const { rows } = await client.query<{ h: string }>(`SELECT md5(string_agg(x, E'\\n' ORDER BY x)) AS h FROM (
      SELECT table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '')
        FROM information_schema.columns WHERE table_schema = 'public'
      UNION ALL SELECT indexdef FROM pg_indexes WHERE schemaname = 'public'
      UNION ALL SELECT conname || ':' || pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace = 'public'::regnamespace
      UNION ALL SELECT tgname || ':' || pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal
    ) s(x)`);
  out["(schema)"] = rows[0].h;
  return out;
}

async function one<T = Record<string, unknown>>(client: PgClient, text: string, params: unknown[] = []): Promise<T> {
  const { rows } = await client.query(text, params);
  return rows[0] as T;
}

function jsonFile(name: string, value: unknown): string {
  const path = join(fileDir, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

const migrations = enabled ? readdirSync(join(ROOT, "drizzle")).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort() : [];
const migration = (prefix: string) => readFileSync(join(ROOT, "drizzle", migrations.find((n) => n.startsWith(prefix))!), "utf8");

async function applyFile(client: PgClient, sql: string): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

/** Esegue `fn` con la tabella (o colonna) rinominata, poi la rimette. */
async function renamed<T>(client: PgClient, ddl: [string, string], fn: () => T | Promise<T>): Promise<T> {
  await client.query(ddl[0]);
  try {
    return await fn();
  } finally {
    await client.query(ddl[1]);
  }
}

// ─── Dati ────────────────────────────────────────────────────────────

before(async () => {
  if (!enabled) return;
  pg = createRequire(join(ROOT, "package.json"))("pg");
  main = new pg.Client({ connectionString: dbUrl(packageDb) });
  await main.connect();
  admin = new pg.Client({ connectionString: dbUrl("postgres") });
  await admin.connect();
  workspacesModule = await import("../../db/queries/workspaces.ts");
  prefixModule = await import("../prefix.ts");
  fileDir = mkdtempSync(join(tmpdir(), "h2c-admin-"));

  await main.query(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova H2c', $2)`, [ids.org, `hub-h2c-${ids.org}`]);
  await main.query(`INSERT INTO users (id, email, name) VALUES ($1, $2, 'Revisore di prova'), ($3, $4, 'Cliente di prova')`, [
    ids.lsUser,
    `revisore.h2c.${suffix}@ls.test`,
    ids.clientUser,
    `ada.h2c.${suffix}@cliente.test`,
  ]);
  await main.query(
    `INSERT INTO workspaces (id, organization_id, name, ai_transformation_team_name, created_at) VALUES
       ($1, $7, $8, 'CoE AI', '2026-09-01 08:00'),
       ($2, $7, $8, NULL, '2026-09-01 08:01'),
       ($3, $7, 'Workspace esistente H2c', ' ai  transformation ', '2026-09-01 08:02'),
       ($4, $7, 'Senza config H2c', 'AI Transformation Team', '2026-09-01 08:03'),
       ($5, $7, 'Occupa slug H2c', NULL, '2026-09-01 08:04'),
       ($6, $7, 'Pieno H2c', NULL, '2026-09-01 08:05'),
       ($9, $7, 'Area accesa H2c', NULL, '2026-09-01 08:06')`,
    [ids.wsA, ids.wsB, ids.wsC, ids.wsD, ids.wsE, ids.wsF, ids.org, NAME_AB, ids.wsG],
  );
  await main.query(
    `INSERT INTO workspace_connector_configs (workspace_id, slug, code_prefix, enabled, next_code_seq) VALUES
       ($1, $2, 'PE', true, 7),
       ($3, $4, 'PI', false, 99999)`,
    [ids.wsC, `esistente-h2c-${suffix}`, ids.wsF, `pieno-h2c-${suffix}`],
  );
  // Use case del workspace A (D: data di invio, che vale prima della creazione).
  const rows: Array<[string, string | null, string | null, string, string | null, string]> = [
    [uc[0], null, null, "2026-09-02 08:00", null, "Bozza da Activity mapping"],
    [uc[1], "web_proposed", `Revisore.H2c.${suffix}@LS.test`, "2026-09-02 09:00", "2026-09-02 08:10", "Proposta di Lateral Space via email"],
    [uc[2], "web_proposed", ids.lsUser, "2026-09-02 08:20", null, "Proposta di Lateral Space via id"],
    [uc[3], "web_proposed", ids.clientUser, "2026-09-02 08:30", null, "Proposta del cliente via id"],
    [uc[4], "web_proposed", "U0123SLACK", "2026-09-02 08:40", null, "Proposta con id di Slack"],
    [uc[5], "web_proposed", "AI Readiness respondent", "2026-09-02 08:50", null, "Proposta con etichetta"],
    [uc[6], "slack_proposed", "U0999SLACK", "2026-09-02 09:10", null, "Proposta da Slack"],
    [uc[7], "web_proposed", `ada.h2c.${suffix}@cliente.test`, "2026-09-02 09:20", null, "Proposta del cliente via email"],
    [uc[8], null, null, "2026-09-02 09:30", null, LONG_TITLE],
  ];
  for (const [id, source, author, createdAt, submittedAt, title] of rows) {
    await main.query(
      `INSERT INTO use_cases (id, workspace_id, title, source, proposed_by, created_at, submitted_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, ids.wsA, title, source, author, createdAt, submittedAt],
    );
  }
  // Da Slack: l'origine non va decisa, così il workspace pieno arriva al limite dei codici.
  await main.query(`INSERT INTO use_cases (id, workspace_id, title, source) VALUES ($1, $2, 'Scheda oltre il massimo', 'slack_proposed')`, [ids.ucOverflow, ids.wsF]);
  // Workspace G: come le scrive il servizio dell'hub (origine scelta), più una proposta dal web di
  // prima della 0020 (senza la riga «creato», che nasce col trigger della 0020).
  await main.query(
    `INSERT INTO use_cases (id, workspace_id, title, source, origin, proposed_by) VALUES
       ($1, $4, 'Da Activity mapping, scelta adoption', 'activity_mapping', 'adoption', NULL),
       ($2, $4, 'Modulo completo di chi non rivede', 'web_proposed', 'adoption', $5),
       ($3, $4, 'Proposta dal web di prima', 'web_proposed', 'adoption', $5)`,
    [hub.am, hub.web, hub.legacyWeb, ids.wsG, `revisore.h2c.${suffix}@ls.test`],
  );
  await main.query(`DELETE FROM use_case_events WHERE use_case_id = $1`, [hub.legacyWeb]);
  // Dossier del workspace A: uno completo senza scheda, uno incompleto senza scheda.
  await main.query(
    `INSERT INTO uc_templates (id, key, version, name, archetype, definition, definition_hash, restricted_to_workspace_id)
     VALUES ($1, $2, '1.0.0', 'Template di prova H2c', 'prova', '{"confidential": false}'::jsonb, $3, $4)`,
    [ids.template, `prova.hub_h2c_${suffix}`, randomBytes(32).toString("hex"), ids.wsA],
  );
  await main.query(
    `INSERT INTO uc_cases (id, workspace_id, organization_id, portfolio_use_case_id, template_id, template_version, code, title, one_liner, status, setup_completed_at, created_at)
     VALUES ($1, $3, $4, NULL, $5, '1.0.0', $6, 'Dossier orfano di prova', 'Una frase breve di prova.', 'raccolta', now(), now() - interval '2 days'),
            ($2, $3, $4, NULL, $5, '1.0.0', $7, 'Dossier incompleto di prova', NULL, 'raccolta', NULL, now() - interval '1 day')`,
    [ids.orphan, ids.orphanIncomplete, ids.wsA, ids.org, ids.template, `XO${SUFFIX}1`, `XO${SUFFIX}2`],
  );
  // Bozze di Slack del workspace A.
  await main.query(
    `INSERT INTO slack_use_case_drafts (id, workspace_id, slack_user_id, slack_team_id, status, title, problem, guardrails, urgency, submitted_at, updated_at)
     VALUES ($1, $5, 'U0001', 'T0001', 'submitted', 'Bozza inviata', 'Problema inviato', 'Limiti', 'alta', now() - interval '1 hour', now() - interval '1 hour'),
            ($2, $5, 'U0001', 'T0001', 'drafting', 'Bozza in corso', 'Problema in corso', NULL, NULL, NULL, now()),
            ($3, $5, 'U0001', 'T0001', 'abandoned', 'Bozza abbandonata', 'Problema abbandonato', NULL, NULL, NULL, now() - interval '3 days'),
            ($4, $5, 'U0001', 'T0001', 'submitted', 'Bozza appena inviata', 'Problema appena inviato', NULL, NULL, now(), now())`,
    [drafts.sent, drafts.drafting, drafts.abandoned, drafts.justSent, ids.wsA],
  );
});

after(async () => {
  if (!enabled) return;
  try {
    // I workspace portano via use case, config, Storia, dossier, template ristretto e bozze.
    await main.query(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.wsA, ids.wsB, ids.wsC, ids.wsD, ids.wsE, ids.wsF, ids.wsG, ...created]]);
    await main.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.lsUser, ids.clientUser]]);
    await main.query(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
  } finally {
    await scratch?.end();
    await admin.query(`DROP DATABASE IF EXISTS ${scratchDb} WITH (FORCE)`);
    await main.end();
    await admin.end();
    if (fileDir) rmSync(fileDir, { recursive: true, force: true });
  }
});

// ─── Database e prova a secco ────────────────────────────────────────

test("senza USE_CASE_ADMIN_DATABASE_URL lo script si ferma, anche a secco, e non usa DATABASE_URL", opts, async () => {
  const before = await fingerprint(main);
  // DATABASE_URL è il vero database di prova: se lo script lo usasse, il comando passerebbe.
  const run = runAdmin(["doctor", "--all"], { adminUrl: null, env: { DATABASE_URL: dbUrl(packageDb) } });
  assert.equal(run.status, 1);
  assert.equal(run.last.status, "ERROR");
  assert.equal(run.last.code, "database");
  assert.match(String(run.last.message), /USE_CASE_ADMIN_DATABASE_URL/);
  assert.deepEqual(await fingerprint(main), before);
});

test("ogni comando a secco non scrive: contenuto e schema uguali prima e dopo", opts, async () => {
  const expected: Record<string, string> = {
    "dossier-dups": "NOTHING_TO_DO",
    configs: "DRY_RUN",
    "team-name": "REPORT",
    origin: "DRY_RUN",
    codes: "DRY_RUN",
    "dossier-links": "DRY_RUN",
    "slack-drafts": "DRY_RUN",
    // Con --all ci sono workspace in v1: il prima/dopo, senza scrivere.
    "scoring-v2": "DRY_RUN",
    doctor: "RED",
  };
  for (const [command, status] of Object.entries(expected)) {
    const before = await fingerprint(main);
    const run = runAdmin([command, "--all"]);
    assert.equal(run.last.status, status, `${command}: ${run.stdout}${run.stderr}`);
    assert.equal(run.docs.length, 1, `${command}: un solo documento a secco`);
    assert.deepEqual(await fingerprint(main), before, `${command} a secco ha scritto`);
  }
});

test("scoring-v2 (da H3a) a secco su un workspace: un documento, il CSV nella cartella temporanea, niente scritto", opts, async () => {
  const before = await fingerprint(main);
  const run = runAdmin(["scoring-v2", "--workspace", ids.wsA]);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal(run.last.status, "DRY_RUN");
  assert.equal(run.docs.length, 1, "un solo documento a secco");
  assert.ok(String(run.last.csv).startsWith(fileDir), "il CSV nella cartella temporanea della prova");
  assert.deepEqual(await fingerprint(main), before, "scoring-v2 a secco ha scritto");
});

test("--apply scrive solo con la conferma esatta del database di USE_CASE_ADMIN_DATABASE_URL", opts, async () => {
  const before = await fingerprint(main);
  const authorized = ["--apply", "--confirm-authorized", "--environment", "local"];
  for (const extra of [authorized, [...authorized, "--confirm-database", `127.0.0.1:${port}/${TRAP_DB}`], [...authorized, "--confirm-database", `localhost:${port}/${packageDb}`]]) {
    const run = runAdmin(["configs", "--workspace", ids.wsA, ...extra]);
    assert.equal(run.status, 1, extra.join(" "));
    assert.equal(run.last.code, "database");
  }
  // L'URL dello script è un altro database: la conferma del database di prova non basta.
  const other = runAdmin(["configs", "--workspace", ids.wsA, ...confirm()], { adminUrl: dbUrl(TRAP_DB) });
  assert.equal(other.status, 1);
  assert.equal(other.last.code, "database");
  assert.deepEqual(await fingerprint(main), before);
});

test("--apply vuole --confirm-authorized e l'ambiente giusto per l'host, come uc-case-admin", opts, async () => {
  const before = await fingerprint(main);
  const database = ["--confirm-database", `127.0.0.1:${port}/${packageDb}`];
  const cases: Array<[string[], string]> = [
    [["--apply", ...database, "--environment", "local"], "conferma"],
    [["--apply", "--confirm-authorized", ...database], "ambiente"],
    [["--apply", "--confirm-authorized", ...database, "--environment", "preview"], "ambiente"],
    [["--apply", "--confirm-authorized", ...database, "--environment", "production"], "ambiente"],
    [["--apply", "--confirm-authorized", ...database, "--environment", "production", "--production-approved"], "ambiente"],
    [["--confirm-authorized"], "opzioni"],
  ];
  for (const [extra, code] of cases) {
    const run = runAdmin(["configs", "--workspace", ids.wsA, ...extra]);
    assert.deepEqual([run.status, run.last.status, run.last.code], [1, "ERROR", code], extra.join(" "));
  }
  assert.deepEqual(await fingerprint(main), before);
});

test("un URL che neon() rifiuta dà l'errore JSON, senza traccia né password", opts, () => {
  const run = runAdmin(["team-name", "--all"], { adminUrl: `postgresql://:segreto@127.0.0.1:${port}/${packageDb}` });
  assert.equal(run.status, 1);
  assert.deepEqual([run.last.status, run.last.code], ["ERROR", "database"]);
  assert.equal(run.stderr, "");
  assert.equal(run.stdout.includes("segreto"), false);
});

// ─── configs ─────────────────────────────────────────────────────────

test("configs: a secco il piano; le righe esistenti non si toccano; --prefixes", opts, async () => {
  const existingBefore = await one(main, `SELECT * FROM workspace_connector_configs WHERE workspace_id = $1`, [ids.wsC]);
  const dry = runAdmin(["configs", "--all"]);
  assert.equal(dry.last.status, "DRY_RUN");
  const plan = dry.last.daCreare as Array<{ workspace: string; prefisso: string; slug: string; da: string }>;
  const a = plan.find((row) => row.workspace === ids.wsA);
  const b = plan.find((row) => row.workspace === ids.wsB);
  assert.ok(a && b, "A e B senza riga");
  assert.equal(a.prefisso, prefixModule.proposePrefix(NAME_AB));
  assert.notEqual(a.slug, b.slug, "stesso nome, slug diversi");
  assert.ok(prefixModule.isValidWorkspaceSlug(a.slug) && prefixModule.isValidWorkspaceSlug(b.slug));
  assert.ok((dry.last.esistenti as Array<{ workspace: string }>).some((row) => row.workspace === ids.wsC));

  // Un prefisso per un workspace che ha già la riga ferma il comando.
  const refused = runAdmin(["configs", "--all", "--prefixes", jsonFile("prefissi-c.json", { [ids.wsC]: "ZZ" })]);
  assert.equal(refused.status, 1);
  assert.equal(refused.last.code, "prefixes");

  const applyA = runAdmin(["configs", "--workspace", ids.wsA, ...confirm()]);
  assert.equal(applyA.status, 0, applyA.stdout);
  assert.deepEqual(applyA.docs.map((doc) => doc.status), ["PLAN", "APPLIED"], "il piano prima di scrivere");
  for (const doc of applyA.docs) {
    assert.deepEqual([doc.database, doc.ambiente], [`127.0.0.1:${port}/${packageDb}`, "local"], "piano e risultato dicono dove si scrive");
  }
  assert.equal(dry.last.ambiente, undefined, "a secco non c'è ambiente");
  const applyB = runAdmin(["configs", "--workspace", ids.wsB, "--prefixes", jsonFile("prefissi-b.json", { [ids.wsB]: "BX" }), ...confirm()]);
  assert.equal(applyB.last.status, "APPLIED", applyB.stdout);

  const rowA = await one(main, `SELECT slug, code_prefix, enabled, next_code_seq FROM workspace_connector_configs WHERE workspace_id = $1`, [ids.wsA]);
  assert.deepEqual(rowA, { slug: a.slug, code_prefix: a.prefisso, enabled: false, next_code_seq: 0 });
  const rowB = await one(main, `SELECT code_prefix, enabled FROM workspace_connector_configs WHERE workspace_id = $1`, [ids.wsB]);
  assert.deepEqual(rowB, { code_prefix: "BX", enabled: false });

  const again = runAdmin(["configs", "--workspace", ids.wsC, ...confirm()]);
  assert.equal(again.last.status, "NOTHING_TO_DO");
  assert.deepEqual(await one(main, `SELECT * FROM workspace_connector_configs WHERE workspace_id = $1`, [ids.wsC]), existingBefore);
});

// ─── team-name ───────────────────────────────────────────────────────

test("team-name: elenca solo «AI Transformation» e non scrive", opts, () => {
  const run = runAdmin(["team-name", "--all"]);
  assert.equal(run.last.status, "REPORT");
  const listed = (run.last.workspaces as Array<{ workspace: string }>).map((row) => row.workspace);
  assert.ok(listed.includes(ids.wsC));
  assert.ok(!listed.includes(ids.wsA) && !listed.includes(ids.wsD), "«CoE AI» e «AI Transformation Team» non collidono");
  const write = runAdmin(["team-name", "--all", ...confirm()]);
  assert.equal(write.status, 1);
  assert.equal(write.last.code, "sola_lettura");
});

// ─── origin ──────────────────────────────────────────────────────────

test("origin: codice, titolo troncato, canale e «sì / no / non risolto», mai email o nomi", opts, () => {
  const run = runAdmin(["origin", "--workspace", ids.wsA]);
  assert.equal(run.last.status, "DRY_RUN", run.stdout);
  const items = run.last.schede as Array<Record<string, unknown>>;
  const byId = new Map(items.map((item) => [item.id, item]));
  const pick = (n: number) => {
    const item = byId.get(uc[n]);
    return item && [item.canale, item.autoreLateralSpace, item.proposta, item.conferma, item.azione];
  };
  assert.deepEqual(pick(0), ["activity_mapping", "non risolto", "transformation", "no", "cambia"]);
  assert.deepEqual(pick(1), ["web", "sì", "transformation", "serve", "attende_conferma"], "email di Lateral Space, maiuscole comprese");
  assert.deepEqual(pick(2), ["web", "sì", "transformation", "serve", "attende_conferma"], "id di un utente di Lateral Space");
  assert.deepEqual(pick(4), ["web", "non risolto", "adoption", "serve", "attende_conferma"], "id di Slack");
  assert.deepEqual(pick(5), ["web", "non risolto", "adoption", "serve", "attende_conferma"], "etichetta");
  assert.equal(byId.has(uc[3]), false, "cliente via id: resta adoption senza conferma");
  assert.equal(byId.has(uc[6]), false);
  assert.equal(byId.has(uc[7]), false);
  assert.deepEqual(run.last.riepilogo, { cambiano: 2, confermeRegistrate: 0, daConfermare: 4, invariate: 3 });
  const long = byId.get(uc[8]);
  assert.equal(String(long?.titolo).length, 60);
  assert.ok(String(long?.titolo).endsWith("…"));
  // Mai email, nomi o id di Slack nell'uscita.
  for (const forbidden of ["@", "Revisore", "Cliente di prova", "U0123SLACK", "respondent"]) {
    assert.equal(run.stdout.includes(forbidden), false, forbidden);
  }
});

test("origin: senza UC_LS_EMAIL_DOMAINS si ferma", opts, () => {
  const run = runAdmin(["origin", "--workspace", ids.wsA], { env: { UC_LS_EMAIL_DOMAINS: undefined } });
  assert.equal(run.status, 1);
  assert.equal(run.last.code, "uc_ls_email_domains");
});

test("origin --apply: transformation nasconde con la Storia senza persona; la conferma di adoption non va nella Storia", opts, async () => {
  const versionBefore = await one<{ version: number }>(main, `SELECT version FROM use_cases WHERE id = $1`, [uc[0]]);
  const confirmedBefore = await one<{ updated_at: Date }>(main, `SELECT updated_at FROM use_cases WHERE id = $1`, [uc[4]]);
  const decisions = jsonFile("origin.json", { [uc[1]]: "transformation", [uc[4]]: "adoption" });
  const run = runAdmin(["origin", "--workspace", ids.wsA, "--decisions", decisions, ...confirm()]);
  assert.equal(run.status, 0, run.stdout);
  assert.deepEqual(run.docs.map((doc) => doc.status), ["PLAN", "APPLIED"]);
  assert.equal(run.last.cambiate, 3);
  assert.equal(run.last.confermeRegistrate, 1);

  const { rows } = await main.query(
    `SELECT id, origin, coalesce(intake -> 'hiddenFromSearch' = 'true'::jsonb, false) AS hidden FROM use_cases WHERE workspace_id = $1`,
    [ids.wsA],
  );
  const state = new Map(rows.map((row) => [row.id, `${row.origin}${row.hidden ? "+nascosta" : ""}`]));
  assert.equal(state.get(uc[0]), "transformation+nascosta");
  assert.equal(state.get(uc[1]), "transformation+nascosta");
  assert.equal(state.get(uc[8]), "transformation+nascosta");
  assert.equal(state.get(uc[4]), "adoption");
  assert.equal(state.get(uc[2]), "adoption", "senza decisione resta da confermare");
  const versionAfter = await one<{ version: number }>(main, `SELECT version FROM use_cases WHERE id = $1`, [uc[0]]);
  assert.equal(versionAfter.version, versionBefore.version + 1, "origine e visibilità sono campi di una persona");

  const { rows: events } = await main.query(
    `SELECT use_case_id, actor_user_id, actor_kind, channel, action, fields FROM use_case_events WHERE use_case_id = ANY($1::uuid[]) AND channel = 'script' ORDER BY use_case_id`,
    [[uc[0], uc[1], uc[4]]],
  );
  assert.equal(events.length, 2, "una riga per ogni cambio, nessuna per la conferma");
  for (const event of events) {
    assert.equal(event.actor_user_id, null);
    assert.equal(event.actor_kind, "sistema");
    assert.equal(event.action, "modificato");
  }
  const fields = new Map(events.map((event) => [event.use_case_id, event.fields]));
  assert.deepEqual(fields.get(uc[0]), ["origine", "visibilita"]);
  assert.deepEqual(fields.get(uc[1]), ["origine", "visibilita"]);
  assert.equal(fields.has(uc[4]), false, "la Storia non mostra «Modificato: Origine» per una modifica mai avvenuta");
  const confirmed = await one<{ intake: unknown; updated_at: Date; n: number }>(
    main,
    `SELECT intake, updated_at, (SELECT count(*)::int FROM use_case_events e WHERE e.use_case_id = u.id) AS n FROM use_cases u WHERE id = $1`,
    [uc[4]],
  );
  assert.deepEqual(confirmed.intake, { originConfirmed: true });
  assert.equal(confirmed.updated_at.getTime(), confirmedBefore.updated_at.getTime());
  assert.equal(confirmed.n, 1, "solo la riga «creato»");

  // Di nuovo a secco: restano le due da confermare; una decisione su una scheda già decisa si rifiuta.
  const again = runAdmin(["origin", "--workspace", ids.wsA]);
  assert.deepEqual(
    (again.last.schede as Array<{ id: string }>).map((item) => item.id).sort(),
    [uc[2], uc[5]].sort(),
  );
  const nothing = runAdmin(["origin", "--workspace", ids.wsA, ...confirm()]);
  assert.deepEqual([nothing.status, nothing.docs.length, nothing.last.status], [0, 1, "NOTHING_TO_DO"]);
  assert.match(String(nothing.last.message), /2 schede aspettano la conferma/);
  const refused = runAdmin(["origin", "--workspace", ids.wsA, "--decisions", jsonFile("origin-2.json", { [uc[0]]: "adoption" })]);
  assert.equal(refused.status, 1);
  assert.equal(refused.last.code, "decisions");
  const confirmedOnce = runAdmin(["origin", "--workspace", ids.wsA, "--decisions", jsonFile("origin-3.json", { [uc[4]]: "transformation" })]);
  assert.deepEqual([confirmedOnce.status, confirmedOnce.last.code], [1, "decisions"], "la conferma in intake conta come decisione");
});

test("origin: le schede che il servizio dell'hub ha già deciso non si toccano", opts, async () => {
  const listed = (run: AdminRun) => ((run.last.schede ?? []) as Array<{ id: string; azione: string }>).map((item) => `${item.id}:${item.azione}`).sort();
  const plain = runAdmin(["origin", "--workspace", ids.wsG]);
  assert.equal(plain.last.status, "DRY_RUN", plain.stdout);
  assert.deepEqual(
    listed(plain),
    [`${hub.web}:attende_conferma`, `${hub.legacyWeb}:attende_conferma`].sort(),
    "activity_mapping fuori dalla lista; senza USE_CASE_HUB_WORKSPACES la proposta dal web resta da confermare, mai cambiata in silenzio",
  );
  const env = { USE_CASE_HUB_WORKSPACES: `${randomUUID()}, ${ids.wsG.toUpperCase()}` };
  const switchedOn = runAdmin(["origin", "--workspace", ids.wsG], { env });
  assert.deepEqual(listed(switchedOn), [`${hub.legacyWeb}:attende_conferma`], "con l'area accesa resta solo la proposta di prima della 0020");
  const outside = runAdmin(["origin", "--workspace", ids.wsG, "--decisions", jsonFile("origin-hub.json", { [hub.am]: "transformation" })], { env });
  assert.deepEqual([outside.status, outside.last.code], [1, "decisions"], "una scheda del servizio non si decide di nuovo");

  const before = await fingerprint(main);
  const applied = runAdmin(["origin", "--workspace", ids.wsG, ...confirm()], { env });
  assert.deepEqual([applied.status, applied.docs.length, applied.last.status], [0, 1, "NOTHING_TO_DO"], applied.stdout);
  assert.match(String(applied.last.message), /^Niente da scrivere: 1 scheda aspetta la conferma/);
  assert.deepEqual(await fingerprint(main), before, "activity_mapping resta adoption e cercabile, senza righe di Storia nuove");
  const am = await one(main, `SELECT origin, intake FROM use_cases WHERE id = $1`, [hub.am]);
  assert.deepEqual(am, { origin: "adoption", intake: null });

  const doctor = runAdmin(["doctor", "--workspace", ids.wsG], { env });
  assert.equal((doctor.last.workspaces as Array<{ origineDaDecidere: number }>)[0].origineDaDecidere, 1);
});

// ─── codes ───────────────────────────────────────────────────────────

test("codes vuole prima origin: una proposta di Lateral Space che aspetta la conferma resta senza codice", opts, async () => {
  const codesOf = async () => (await main.query(`SELECT code FROM use_cases WHERE workspace_id = $1 AND code IS NOT NULL`, [ids.wsA])).rows;
  // uc[2] (di Lateral Space, via id) e uc[5] (etichetta) aspettano ancora la conferma di origin.
  const dry = runAdmin(["codes", "--workspace", ids.wsA]);
  assert.equal(dry.last.status, "DRY_RUN", dry.stdout);
  const [planned] = dry.last.workspaces as Array<{ origineDaDecidere: number; stop: string }>;
  assert.deepEqual([planned.origineDaDecidere, planned.stop], [2, "origine_da_decidere"]);

  const before = await fingerprint(main);
  const refused = runAdmin(["codes", "--workspace", ids.wsA, ...confirm()]);
  assert.equal(refused.status, 1, refused.stdout);
  assert.deepEqual(refused.last.fermi, [{ workspace: ids.wsA, motivo: "origine da decidere: esegui prima origin" }]);
  assert.deepEqual(refused.last.assegnati, []);
  assert.deepEqual(await codesOf(), [], "nessuna scheda diventa cercabile dal connettore");
  assert.equal((await one<{ code: string | null }>(main, `SELECT code FROM use_cases WHERE id = $1`, [uc[2]])).code, null);
  assert.deepEqual(await fingerprint(main), before);

  const doctor = runAdmin(["doctor", "--workspace", ids.wsA]);
  assert.equal((doctor.last.workspaces as Array<{ origineDaDecidere: number }>)[0].origineDaDecidere, 2);
  assert.ok((doctor.last.controlli as Array<{ controllo: string; ok: boolean }>).some((c) => c.controllo === "origine" && !c.ok));

  const noDomains = runAdmin(["codes", "--workspace", ids.wsA], { env: { UC_LS_EMAIL_DOMAINS: undefined } });
  assert.deepEqual([noDomains.status, noDomains.last.code], [1, "uc_ls_email_domains"], "senza domini non sa chi è di Lateral Space");

  // Pierpaolo decide le due: ora i codici possono partire.
  const decided = runAdmin(["origin", "--workspace", ids.wsA, "--decisions", jsonFile("origin-4.json", { [uc[2]]: "transformation", [uc[5]]: "adoption" }), ...confirm()]);
  assert.equal(decided.status, 0, decided.stdout);
  const after = runAdmin(["codes", "--workspace", ids.wsA]);
  assert.equal((after.last.workspaces as Array<{ stop: string | null }>)[0].stop, null);
});

test("codes riprende dopo un'interruzione: codici consecutivi, nell'ordine di invio o creazione", opts, async () => {
  const prefix = prefixModule.proposePrefix(NAME_AB);
  const first = runAdmin(["codes", "--workspace", ids.wsA, "--limit", "3", ...confirm()]);
  assert.equal(first.status, 0, first.stdout);
  assert.equal((first.last.assegnati as unknown[]).length, 3);
  assert.equal(first.last.senzaCodice, 6);
  const second = runAdmin(["codes", "--workspace", ids.wsA, ...confirm()]);
  assert.equal(second.status, 0, second.stdout);
  assert.equal(second.last.senzaCodice, 0);

  const { rows } = await main.query(`SELECT id, code FROM use_cases WHERE workspace_id = $1 ORDER BY code`, [ids.wsA]);
  // uc[1] è stato creato alle 9:00 ma inviato alle 8:10: conta l'invio (coalesce).
  const expected = [uc[0], uc[1], uc[2], uc[3], uc[4], uc[5], uc[6], uc[7], uc[8]];
  const byCreationOnly = [uc[0], uc[2], uc[3], uc[4], uc[5], uc[1], uc[6], uc[7], uc[8]];
  assert.notDeepEqual(expected, byCreationOnly);
  assert.deepEqual(
    rows.map((row) => row.id),
    expected,
  );
  assert.deepEqual(
    rows.map((row) => row.code),
    expected.map((_, i) => `${prefix}-${String(i + 1).padStart(4, "0")}`),
  );
  const nothing = runAdmin(["codes", "--workspace", ids.wsA]);
  assert.equal(nothing.last.status, "NOTHING_TO_DO");
});

test("codes: senza riga di config si salta, oltre 99.999 si ferma, e lo dice", opts, async () => {
  await main.query(`INSERT INTO use_cases (id, workspace_id, title) VALUES ($1, $2, 'Scheda senza config')`, [randomUUID(), ids.wsD]);
  const noConfig = runAdmin(["codes", "--workspace", ids.wsD, ...confirm()]);
  assert.equal(noConfig.status, 1);
  assert.deepEqual(noConfig.last.fermi, [{ workspace: ids.wsD, motivo: "manca la riga di config: esegui prima configs" }]);
  const full = runAdmin(["codes", "--workspace", ids.wsF, ...confirm()]);
  assert.equal(full.status, 1, full.stdout);
  assert.match(JSON.stringify(full.last.fermi), /oltre 99\.999/);
  assert.equal((await one<{ code: string | null }>(main, `SELECT code FROM use_cases WHERE id = $1`, [ids.ucOverflow])).code, null);
});

// ─── dossier-links ───────────────────────────────────────────────────

test("dossier-links crea la scheda madre con il codice; il dossier tiene il suo", opts, async () => {
  const dry = runAdmin(["dossier-links", "--workspace", ids.wsA]);
  assert.equal(dry.last.status, "DRY_RUN");
  assert.deepEqual((dry.last.dossier as Array<{ id: string }>).map((row) => row.id), [ids.orphan], "l'incompleto non conta");
  assert.match(String(dry.last.message), /una scheda «AI Transformation · dall'alto», approvata/, "l'etichetta di labels.ts");
  const run = runAdmin(["dossier-links", "--workspace", ids.wsA, ...confirm()]);
  assert.equal(run.status, 0, run.stdout);
  assert.equal(run.last.message, "Creata 1 scheda madre.");
  const link = await one<{ portfolio_use_case_id: string | null; code: string }>(main, `SELECT portfolio_use_case_id, code FROM uc_cases WHERE id = $1`, [ids.orphan]);
  assert.ok(link.portfolio_use_case_id);
  assert.equal(link.code, `XO${SUFFIX}1`);
  const card = await one(
    main,
    `SELECT title, description, portfolio_kind, status::text AS status, origin, source, intake, proposed_by, code FROM use_cases WHERE id = $1`,
    [link.portfolio_use_case_id],
  );
  assert.deepEqual(card, {
    title: "Dossier orfano di prova",
    description: "Una frase breve di prova.",
    portfolio_kind: "use_case_ai",
    status: "accepted",
    origin: "transformation",
    source: "manual",
    intake: { hiddenFromSearch: true },
    proposed_by: null,
    code: `${prefixModule.proposePrefix(NAME_AB)}-0010`,
  });
  const incomplete = await one<{ portfolio_use_case_id: string | null }>(main, `SELECT portfolio_use_case_id FROM uc_cases WHERE id = $1`, [ids.orphanIncomplete]);
  assert.equal(incomplete.portfolio_use_case_id, null);
  const again = runAdmin(["dossier-links", "--workspace", ids.wsA, ...confirm()]);
  assert.equal(again.last.status, "NOTHING_TO_DO");
});

// ─── slack-drafts ────────────────────────────────────────────────────

test("slack-drafts porta a NULL i testi delle bozze inviate e non tocca quelle in corso", opts, async () => {
  const dry = runAdmin(["slack-drafts", "--workspace", ids.wsA]);
  assert.equal(dry.last.status, "DRY_RUN");
  assert.equal(dry.last.bozze, 1);
  assert.equal(dry.stdout.includes("Bozza"), false, "nessun testo nell'uscita");
  const run = runAdmin(["slack-drafts", "--workspace", ids.wsA, ...confirm()]);
  assert.equal(run.last.status, "APPLIED", run.stdout);
  assert.equal(run.last.message, "Testi tolti da 1 bozza inviata.");
  const { rows } = await main.query(`SELECT id, status, title, problem, guardrails, urgency, submitted_at IS NOT NULL AS sent FROM slack_use_case_drafts WHERE workspace_id = $1`, [ids.wsA]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  assert.deepEqual(
    { ...byId.get(drafts.sent), id: undefined },
    { id: undefined, status: "submitted", title: null, problem: null, guardrails: null, urgency: null, sent: true },
  );
  assert.equal(byId.get(drafts.drafting)?.title, "Bozza in corso");
  assert.equal(byId.get(drafts.abandoned)?.title, "Bozza abbandonata");
  assert.equal(byId.get(drafts.justSent)?.title, "Bozza appena inviata", "un invio di meno di 10 minuti fa può ancora tornare in corso");
});

// ─── doctor ──────────────────────────────────────────────────────────

test("doctor: sola lettura, verde solo quando il workspace è pronto", opts, async () => {
  const before = await fingerprint(main);
  const red = runAdmin(["doctor", "--workspace", ids.wsA]);
  assert.equal(red.status, 1);
  assert.equal(red.last.status, "RED");
  const failing = (red.last.controlli as Array<{ controllo: string; ok: boolean }>).filter((c) => !c.ok).map((c) => c.controllo);
  assert.deepEqual(failing, ["scoring_v2"], "origin, codes e dossier-links fatti");
  const [wsA] = red.last.workspaces as Array<Record<string, unknown>>;
  assert.deepEqual(wsA, { workspace: ids.wsA, nome: NAME_AB, rigaConfig: true, senzaCodice: 0, origineDaDecidere: 0, dossierLinksReady: true, scoringVersion: 1, areaAccesa: false });
  // Con l'interruttore di produzione («*») l'area è accesa anche per lui; l'esclusione la spegne.
  const star = runAdmin(["doctor", "--workspace", ids.wsA], { env: { USE_CASE_HUB_WORKSPACES: "*" } });
  assert.equal((star.last.workspaces as Array<Record<string, unknown>>)[0].areaAccesa, true);
  const out = runAdmin(["doctor", "--workspace", ids.wsA], { env: { USE_CASE_HUB_WORKSPACES: "*", USE_CASE_HUB_EXCLUDE: ids.wsA } });
  assert.equal((out.last.workspaces as Array<Record<string, unknown>>)[0].areaAccesa, false);
  const noConfig = runAdmin(["doctor", "--workspace", ids.wsD]);
  assert.ok((noConfig.last.controlli as Array<{ controllo: string; ok: boolean }>).some((c) => c.controllo === "righe_config" && !c.ok));
  assert.deepEqual(await fingerprint(main), before, "doctor non scrive");
  assert.equal(runAdmin(["doctor", "--workspace", ids.wsA, ...confirm()]).last.code, "sola_lettura");

  await main.query(`INSERT INTO workspace_scoring_models (workspace_id, config) VALUES ($1, '{"scoringVersion": 2}'::jsonb)`, [ids.wsB]);
  const green = runAdmin(["doctor", "--workspace", ids.wsB]);
  assert.equal(green.status, 0, green.stdout);
  assert.equal(green.last.status, "GREEN");
  const lsMissing = runAdmin(["doctor", "--workspace", ids.wsB], { env: { UC_LS_EMAIL_DOMAINS: undefined } });
  assert.equal(lsMissing.last.status, "RED");
});

// ─── dossier-dups e schema mancante, su un database senza la 0020 ───────

async function seedScratch(client: PgClient) {
  const s = {
    org: randomUUID(),
    ws: randomUUID(),
    template: randomUUID(),
    cardX: randomUUID(),
    cardY: randomUUID(),
    cardZ: randomUUID(),
    caseA: randomUUID(),
    caseB: randomUUID(),
    caseC: randomUUID(),
    caseD: randomUUID(),
    caseF: randomUUID(),
    caseG: randomUUID(),
  };
  await client.query(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione pre-0020', $2)`, [s.org, `pre20-${s.org}`]);
  await client.query(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Workspace pre-0020')`, [s.ws, s.org]);
  await client.query(`INSERT INTO use_cases (id, workspace_id, title) VALUES ($1, $4, 'Scheda X'), ($2, $4, 'Scheda Y'), ($3, $4, 'Scheda Z')`, [
    s.cardX,
    s.cardY,
    s.cardZ,
    s.ws,
  ]);
  await client.query(
    `INSERT INTO uc_templates (id, key, version, name, archetype, definition, definition_hash, restricted_to_workspace_id)
     VALUES ($1, 'prova.pre20', '1.0.0', 'Template pre-0020', 'prova', '{"confidential": false}'::jsonb, $2, $3)`,
    [s.template, randomBytes(32).toString("hex"), s.ws],
  );
  const insert = (id: string, card: string, code: string, complete: boolean, age: string) =>
    client.query(
      `INSERT INTO uc_cases (id, workspace_id, organization_id, portfolio_use_case_id, template_id, template_version, code, title, status, setup_completed_at, created_at)
       VALUES ($1, $2, $3, $4, $5, '1.0.0', $6, 'Dossier pre-0020', 'raccolta', CASE WHEN $7 THEN now() END, now() - $8::interval)`,
      [id, s.ws, s.org, card, s.template, code, complete, age],
    );
  await insert(s.caseA, s.cardX, "PRE-A", true, "2 hours");
  await insert(s.caseB, s.cardX, "PRE-B", false, "1 hour");
  await insert(s.caseC, s.cardY, "PRE-C", true, "2 hours");
  await insert(s.caseD, s.cardY, "PRE-D", true, "1 hour");
  await insert(s.caseF, s.cardZ, "PRE-F", true, "2 hours");
  await insert(s.caseG, s.cardZ, "PRE-G", false, "1 minute");
  return s;
}

let pre: Awaited<ReturnType<typeof seedScratch>>;

test("database con 0018 e 0019 soltanto: lo schema c'è fino alla 0019", opts, async () => {
  await admin.query(`DROP DATABASE IF EXISTS ${scratchDb} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${scratchDb}`);
  scratch = new pg.Client({ connectionString: dbUrl(scratchDb) });
  await scratch.connect();
  for (const name of migrations.filter((n) => n.slice(0, 4) <= "0019")) await applyFile(scratch, readFileSync(join(ROOT, "drizzle", name), "utf8"));
  // La 0018 di C11b crea l'indice unico dei dossier su uc_cases ancora vuota. In produzione c'è
  // una 0018 di prima: lo si toglie per seminare i doppioni come lì (prima di C11b non fa nulla).
  await scratch.query(`DROP INDEX IF EXISTS uc_cases_portfolio_use_case_unique_idx`);
  pre = await seedScratch(scratch);
  const doctor = runAdmin(["doctor", "--all"], { db: scratchDb });
  const checks = Object.fromEntries((doctor.last.controlli as Array<{ controllo: string; ok: boolean; dettaglio: string }>).map((c) => [c.controllo, c]));
  assert.equal(checks.migrazione_0020.ok, false);
  assert.equal(checks.doppioni.dettaglio, "3 schede con più dossier: dossier-dups", "la condizione della 0020: complete e incomplete");
  assert.equal(checks.righe_config.dettaglio.startsWith("1 workspace"), true, "la 0019 c'è: la riga manca");
  await assert.rejects(applyFile(scratch, migration("0020")), /piu dossier sulla stessa scheda/);
});

test("ogni comando si ferma con un messaggio se manca lo schema che gli serve", opts, async () => {
  const client = scratch!;
  const before = await fingerprint(client);
  for (const command of ["origin", "dossier-links", "scoring-v2"]) {
    const run = runAdmin([command, "--all"], { db: scratchDb });
    assert.equal(run.status, 1, command);
    assert.deepEqual([run.last.status, run.last.needs], ["SCHEMA_MISSING", "0020"], command);
  }
  await renamed(client, ["ALTER TABLE workspace_connector_configs RENAME TO wcc_h2c_assente", "ALTER TABLE wcc_h2c_assente RENAME TO workspace_connector_configs"], () => {
    for (const command of ["configs", "codes"]) {
      const run = runAdmin([command, "--all"], { db: scratchDb });
      assert.deepEqual([run.status, run.last.status, run.last.needs], [1, "SCHEMA_MISSING", "0019"], command);
    }
  });
  await renamed(
    client,
    ["ALTER TABLE workspaces RENAME COLUMN ai_transformation_team_name TO team_h2c_assente", "ALTER TABLE workspaces RENAME COLUMN team_h2c_assente TO ai_transformation_team_name"],
    () => {
      const run = runAdmin(["team-name", "--all"], { db: scratchDb });
      assert.deepEqual([run.status, run.last.status], [1, "SCHEMA_MISSING"]);
    },
  );
  await renamed(client, ["ALTER TABLE slack_use_case_drafts RENAME TO sud_h2c_assente", "ALTER TABLE sud_h2c_assente RENAME TO slack_use_case_drafts"], () => {
    const run = runAdmin(["slack-drafts", "--all"], { db: scratchDb });
    assert.deepEqual([run.status, run.last.status], [1, "SCHEMA_MISSING"]);
  });
  await renamed(client, ["ALTER TABLE uc_cases RENAME TO uc_cases_h2c_assente", "ALTER TABLE uc_cases_h2c_assente RENAME TO uc_cases"], () => {
    const run = runAdmin(["dossier-dups", "--all"], { db: scratchDb });
    assert.deepEqual([run.status, run.last.status], [0, "NOTHING_TO_DO"], "senza tabelle uc non fa nulla");
    assert.match(String(run.last.message), /Tabelle dei Casi d'uso assenti/);
  });
  assert.deepEqual(await fingerprint(client), before);
});

test("dossier-dups: a secco i gruppi; --apply cancella le incomplete ferme e stacca con --detach; poi la 0020 passa", opts, async () => {
  const client = scratch!;
  const before = await fingerprint(client);
  const dry = runAdmin(["dossier-dups", "--all", "--detach", pre.caseD], { db: scratchDb });
  assert.equal(dry.last.status, "DRY_RUN", dry.stdout);
  assert.deepEqual(dry.last.riepilogo, { gruppi: 3, daCancellare: 1, daStaccare: 1, gruppiCheRestano: 1 });
  const actions = Object.fromEntries(
    (dry.last.gruppi as Array<{ dossier: Array<{ codice: string; stato: string; azione: string }> }>).flatMap((g) => g.dossier.map((d) => [d.codice, `${d.stato}:${d.azione}`])),
  );
  assert.deepEqual(actions, {
    "PRE-A": "completo:resta",
    "PRE-B": "incompleto:cancella",
    "PRE-C": "completo:resta",
    "PRE-D": "completo:stacca",
    "PRE-F": "completo:resta",
    "PRE-G": "incompleto:attende",
  });
  assert.deepEqual(await fingerprint(client), before, "a secco non scrive");

  const refused = runAdmin(["dossier-dups", "--all", "--detach", `${pre.caseC},${pre.caseD}`, ...confirm(scratchDb)], { db: scratchDb });
  assert.equal(refused.status, 1, "la scheda Y resterebbe senza dossier");
  const onlyIncomplete = runAdmin(["dossier-dups", "--all", "--detach", pre.caseF, ...confirm(scratchDb)], { db: scratchDb });
  assert.deepEqual([onlyIncomplete.status, onlyIncomplete.last.code], [1, "detach"], "la Z terrebbe solo un'incompleta in creazione");
  assert.deepEqual(await fingerprint(client), before);

  const applied = runAdmin(["dossier-dups", "--all", "--detach", pre.caseD, ...confirm(scratchDb)], { db: scratchDb });
  assert.equal(applied.status, 0, applied.stdout);
  assert.deepEqual(applied.docs.map((doc) => doc.status), ["PLAN", "APPLIED"]);
  assert.deepEqual(applied.last.cancellati, [pre.caseB]);
  assert.deepEqual(applied.last.staccati, [pre.caseD]);
  assert.equal(applied.last.gruppiRimasti, 1, "la Z ha un dossier in creazione");
  const detached = await one<{ portfolio_use_case_id: string | null }>(client, `SELECT portfolio_use_case_id FROM uc_cases WHERE id = $1`, [pre.caseD]);
  assert.equal(detached.portfolio_use_case_id, null);

  // Con la sola incompleta recente non c'è niente da scrivere, e lo dice.
  const waiting = await fingerprint(client);
  const nothing = runAdmin(["dossier-dups", "--all", ...confirm(scratchDb)], { db: scratchDb });
  assert.deepEqual([nothing.status, nothing.docs.length, nothing.last.status], [0, 1, "NOTHING_TO_DO"]);
  assert.match(String(nothing.last.message), /Resta 1 scheda con più dossier/);
  assert.deepEqual(await fingerprint(client), waiting);

  // L'incompleta della Z si ferma: il giro dopo la cancella.
  await client.query(`UPDATE uc_cases SET created_at = now() - interval '11 minutes' WHERE id = $1`, [pre.caseG]);
  const last = runAdmin(["dossier-dups", "--all", ...confirm(scratchDb)], { db: scratchDb });
  assert.deepEqual(last.last.cancellati, [pre.caseG]);
  assert.equal(last.last.gruppiRimasti, 0);
  const doctor = runAdmin(["doctor", "--all"], { db: scratchDb });
  assert.equal((doctor.last.controlli as Array<{ controllo: string; ok: boolean }>).find((c) => c.controllo === "doppioni")?.ok, true);

  await applyFile(client, migration("0020"));
  const index = await one<{ present: boolean }>(client, `SELECT to_regclass('public.uc_cases_portfolio_use_case_unique_idx') IS NOT NULL AS present`);
  assert.equal(index.present, true);
  // Dopo la 0020 il dossier staccato riceve la sua scheda madre.
  const links = runAdmin(["dossier-links", "--all", ...confirm(scratchDb)], { db: scratchDb });
  assert.equal(links.status, 0, links.stdout);
  assert.deepEqual((links.last.collegati as Array<{ dossier: string }>).map((row) => row.dossier), [pre.caseD]);
});

// ─── createWorkspace ─────────────────────────────────────────────────

async function configOf(workspaceId: string) {
  const { rows } = await main.query(`SELECT slug, code_prefix, enabled, next_code_seq FROM workspace_connector_configs WHERE workspace_id = $1`, [workspaceId]);
  return rows[0] ?? null;
}

test("createWorkspace: ogni workspace nuovo nasce con la sua riga di config, anche con lo stesso nome", opts, async () => {
  const name = `Società Città Prova ${SUFFIX}`;
  const first = await workspacesModule.createWorkspace({ organizationId: ids.org, name });
  const second = await workspacesModule.createWorkspace({ organizationId: ids.org, name });
  created.push(first.id, second.id);
  assert.notEqual(first.id, second.id);
  assert.equal(first.name, name);
  const [a, b] = [await configOf(first.id), await configOf(second.id)];
  // Prefisso come `configs`; slug dal nome più l'id (`slugForNewWorkspace`): quello «pulito» resta all'operatore.
  assert.deepEqual(a, { slug: prefixModule.slugForNewWorkspace(name, first.id), code_prefix: "SCP", enabled: false, next_code_seq: 0 });
  assert.deepEqual(b, { slug: prefixModule.slugForNewWorkspace(name, second.id), code_prefix: "SCP", enabled: false, next_code_seq: 0 });
  assert.notEqual(a?.slug, b?.slug);
  assert.match(String(a?.slug), new RegExp(`^societa-citta-prova-${suffix}-${first.id.replace(/-/g, "").slice(0, 8)}$`));
  // Nessuna riga da creare per configs.
  const dry = runAdmin(["configs", "--workspace", first.id]);
  assert.equal(dry.last.status, "NOTHING_TO_DO", dry.stdout);
});

test("createWorkspace: nomi di soli simboli, accentati o lunghissimi danno uno slug valido", opts, async () => {
  const cases = [
    { name: "!!! ??? …", prefix: "UC", slug: /^ws-[0-9a-f]{8}$/ },
    { name: "Ærø Ñandú Ü", prefix: "ANU", slug: /^aero-nandu-u-[0-9a-f]{8}$/ },
    { name: "Un nome di workspace davvero molto lungo che supera di gran lunga i quaranta caratteri", prefix: "UNW", slug: /^[a-z0-9-]{3,40}$/ },
  ];
  for (const c of cases) {
    const ws = await workspacesModule.createWorkspace({ organizationId: ids.org, name: c.name });
    created.push(ws.id);
    const config = await configOf(ws.id);
    assert.equal(config?.code_prefix, c.prefix, c.name);
    assert.match(String(config?.slug), c.slug, c.name);
    assert.ok(prefixModule.isValidWorkspaceSlug(config?.slug), c.name);
  }
});

test("createWorkspace: il workspace nasce sempre, anche se la riga non si può scrivere", opts, async (t) => {
  const log = t.mock.method(console, "error", () => {});
  // Lo slug «pulito» già preso da un altro workspace non conta: quello dell'app ha l'id.
  const id = randomUUID();
  const name = `Slug occupato ${SUFFIX}`;
  await main.query(`INSERT INTO workspace_connector_configs (workspace_id, slug, code_prefix) VALUES ($1, $2, 'OS')`, [ids.wsE, `slug-occupato-${suffix}`]);
  const squatted = await workspacesModule.createWorkspace({ id, organizationId: ids.org, name });
  created.push(squatted.id);
  assert.equal(squatted.id, id);
  assert.equal((await configOf(id))?.slug, prefixModule.slugForNewWorkspace(name, id));
  // Proprio lo slug dell'app già preso (a mano): ON CONFLICT DO NOTHING, il workspace nasce senza riga.
  const id2 = randomUUID();
  await main.query(`UPDATE workspace_connector_configs SET slug = $2 WHERE workspace_id = $1`, [ids.wsE, prefixModule.slugForNewWorkspace(name, id2)]);
  const taken = await workspacesModule.createWorkspace({ id: id2, organizationId: ids.org, name });
  created.push(taken.id);
  assert.equal(taken.id, id2);
  assert.equal(await configOf(id2), null);
  // La riga mancante la recupera configs, con un altro slug.
  const recoveredTaken = runAdmin(["configs", "--workspace", id2, ...confirm()]);
  assert.equal(recoveredTaken.last.status, "APPLIED", recoveredTaken.stdout);
  assert.ok(await configOf(id2));

  // Tabella assente: lo statement con la riga fallisce, il workspace nasce da solo.
  const lonely = await renamed(
    main,
    ["ALTER TABLE workspace_connector_configs RENAME TO wcc_h2c_via", "ALTER TABLE wcc_h2c_via RENAME TO workspace_connector_configs"],
    () => workspacesModule.createWorkspace({ organizationId: ids.org, name: `Senza tabella ${SUFFIX}` }),
  );
  created.push(lonely.id);
  assert.equal((await one<{ n: number }>(main, `SELECT count(*)::int AS n FROM workspaces WHERE id = $1`, [lonely.id])).n, 1);
  assert.equal(await configOf(lonely.id), null);
  const lines = log.mock.calls.map((call) => call.arguments.map(String).join(" "));
  assert.ok(lines.some((line) => line.includes("provision_failed")), JSON.stringify(lines));
  assert.ok(lines.every((line) => !line.includes("Senza tabella")), "il log non ha il nome del workspace");
  // La riga mancante la recupera anche configs, con lo slug «pulito» di proposeSlug.
  const recovered = runAdmin(["configs", "--workspace", lonely.id, ...confirm()]);
  assert.equal(recovered.last.status, "APPLIED", recovered.stdout);
  assert.equal((await configOf(lonely.id))?.slug, `senza-tabella-${suffix}`);
});
