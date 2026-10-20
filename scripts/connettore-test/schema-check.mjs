// Schema checks for drizzle/0019_connettore_mcp.sql on the connector's local test
// cluster (docs/connettore/README.md). Never touches another database: every psql /
// pg_dump call is pinned to uc_test@127.0.0.1:<UC_TEST_PG_PORT>, and the two scratch
// databases below are dropped and recreated on each run.
//
//   UC_TEST_PG_PORT=55469 node scripts/connettore-test/schema-check.mjs
//
// 1. Idempotence: on a database migrated 0000→0017 (with synthetic rows), 0019 is
//    applied twice; `pg_dump --schema-only` after the first and the second apply
//    must be identical.
// 2. Self-heal parity: a second database migrated only 0000→0017 (same rows) gets
//    the real `ensureDbSchema()` of the app (src/lib/db/ensure-schema.ts), then the
//    connector DDL once more. The dump of the new tables and of
//    external_contribution_submissions, the 0019 columns, constraints, indexes and
//    trigger of use_cases, the trigger function and the columns appended at the tail
//    of 0019 (exposed_at of workspace_integration_tokens; profile and
//    instructions_template of workspace_connector_configs) must equal those of
//    database 1; so must the unaccent extension, its IMMUTABLE wrapper and the GIN index
//    of the accent-insensitive search. The connector probe must turn from false to true,
//    and the backfills must match.
// 3. Rollout safety: on both databases an insert in the shape of the code before
//    0019 (without principal_key) succeeds and is covered by the new unique index.
// 4. Accent-insensitive search: the single word «qualita» finds «Qualità» (and back) with
//    the query of src/lib/connector/tool-queries.ts, while the old expression without
//    unaccent does not (control), and that query uses the new GIN index.
//    use_cases is compared object by object because the pre-existing self-heal adds
//    columns that migrations 0000–0017 lack (they are listed, not judged, here).
// Exit code 0 only if every check passes. Optional: UC_TEST_PG_BIN.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const port = process.env.UC_TEST_PG_PORT?.trim() || "55469";
if (!/^\d+$/.test(port) || ["55439", "55449"].includes(port)) throw new Error("Use the connector's own test cluster port (default 55469)");
const pgBin = process.env.UC_TEST_PG_BIN || "/opt/homebrew/opt/postgresql@16/bin";
const HOST = "127.0.0.1";
const USER = "uc_test";
const MIG_DB = "conn_check_mig";
const HEAL_DB = "conn_check_heal";
const WHOLE_TABLES = ["connector_identities", "workspace_connector_configs", "connector_rate_limits", "external_contribution_submissions"];
const USE_CASES_0019 = [
  "column code", "column intake", "column public_note", "column status_changed_at", "column submitted_by_user_id",
  "constraint use_cases_code_check", "constraint use_cases_intake_check", "constraint use_cases_public_note_check",
  "constraint use_cases_submitted_by_user_id_fkey", "index use_cases_workspace_code_idx", "index use_cases_search_italian_idx",
  "index use_cases_search_italian_unaccent_idx", "trigger use_cases_status_changed_at",
];
const env = { PATH: `${pgBin}:${process.env.PATH ?? "/usr/bin:/bin"}`, HOME: process.env.HOME ?? "/private/tmp", LC_ALL: "C", LANG: "C" };
const pinned = ["-h", HOST, "-p", port, "-U", USER];
const failures = [];

function bin(name) {
  const path = join(pgBin, name);
  return existsSync(path) ? path : name;
}

function run(name, args, { input } = {}) {
  const result = spawnSync(bin(name), args, { env, input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    console.error(result.stderr?.trim());
    throw new Error(`${name} ${args.filter((a) => !a.startsWith("-")).slice(-1)} failed (exit ${result.status})`);
  }
  return result.stdout;
}

const psql = (db, sql) => run("psql", [...pinned, "-d", db, "--no-psqlrc", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql]).trim();
const applyFile = (db, file) => run("psql", [...pinned, "-d", db, "--no-psqlrc", "--single-transaction", "--set=ON_ERROR_STOP=1", "-q", "-f", file]);

/** pg_dump output without the per-run random `\restrict` keys of recent pg_dump releases. */
function dump(db, tables = []) {
  const args = [...pinned, "-d", db, "--schema-only", "--no-owner", "--no-privileges"];
  for (const t of tables) args.push("-t", `public.${t}`);
  return run("pg_dump", args)
    .split("\n")
    .filter((line) => !/^\\(un)?restrict /.test(line))
    .join("\n");
}

function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures.push(label);
}

function firstDiff(a, b) {
  const la = a.split("\n");
  const lb = b.split("\n");
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) return `line ${i + 1}: ${JSON.stringify(la[i])} vs ${JSON.stringify(lb[i])}`;
  }
  return "";
}

const migrations = readdirSync(join(repoRoot, "drizzle")).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort();
const base = migrations.filter((n) => n < "0018");
const file0019 = join(repoRoot, "drizzle", "0019_connettore_mcp.sql");

// Synthetic rows that exist before the migration, to exercise the backfills.
const ids = {
  org: "00000000-0000-4000-8000-0000000000a1",
  ws: "00000000-0000-4000-8000-0000000000a2",
  token: "00000000-0000-4000-8000-0000000000a3",
  ucSubmitted: "00000000-0000-4000-8000-0000000000a4",
  ucDraft: "00000000-0000-4000-8000-0000000000a5",
  submission: "00000000-0000-4000-8000-0000000000a6",
};
const SEED = `
INSERT INTO organizations (id, name, slug) VALUES ('${ids.org}', 'Organizzazione di prova', 'org-prova-schema');
INSERT INTO workspaces (id, organization_id, name) VALUES ('${ids.ws}', '${ids.org}', 'Workspace di prova');
INSERT INTO workspace_integration_tokens (id, workspace_id, label, token_hash, token_prefix)
  VALUES ('${ids.token}', '${ids.ws}', 'Token di prova', repeat('a', 64), 'ub_mcp_prova...');
INSERT INTO use_cases (id, workspace_id, title, status, submitted_at, created_at)
  VALUES ('${ids.ucSubmitted}', '${ids.ws}', 'Sintesi automatica dei verbali', 'proposed', '2026-09-01 08:30:00', '2026-09-01 08:00:00');
INSERT INTO use_cases (id, workspace_id, title, created_at)
  VALUES ('${ids.ucDraft}', '${ids.ws}', 'Bozza senza invio', '2026-09-02 10:00:00');
INSERT INTO external_contribution_submissions (id, workspace_id, integration_token_id, idempotency_key, request_hash, status, use_case_id)
  VALUES ('${ids.submission}', '${ids.ws}', '${ids.token}', 'chiave-di-prova-001', repeat('b', 64), 'completed', '${ids.ucSubmitted}');
`;
const PROBE = (await import("../../src/lib/db/connector-ddl.ts")).CONNECTOR_PROBE_SQL;
const { SEARCH_VECTOR_SQL, SEARCH_TSQUERY_SQL } = await import("../../src/lib/connector/tool-queries.ts");
const probe = (db) => psql(db, `SELECT ${PROBE}`) === "t";
const backfill = (db) =>
  psql(
    db,
    `SELECT string_agg(x, ' | ' ORDER BY x) FROM (
       SELECT id::text || '=' || to_char(status_changed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS x FROM use_cases WHERE workspace_id = '${ids.ws}'
       UNION ALL
       SELECT id::text || '=' || principal_key FROM external_contribution_submissions WHERE workspace_id = '${ids.ws}'
     ) s`,
  );
/** Columns, constraints, indexes and triggers of use_cases, one sorted line each. */
const catalogOfUseCases = (db) =>
  psql(
    db,
    `SELECT string_agg(line, E'\\n' ORDER BY line) FROM (
       SELECT 'column ' || column_name || ' | ' || data_type || coalesce('(' || character_maximum_length || ')', '') || ' | ' || is_nullable || ' | ' || coalesce(column_default, '') AS line
         FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'use_cases'
       UNION ALL
       SELECT 'constraint ' || conname || ' | ' || pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.use_cases'::regclass
       UNION ALL
       SELECT 'index ' || indexname || ' | ' || indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'use_cases'
       UNION ALL
       SELECT 'trigger ' || tgname || ' | ' || pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = 'public.use_cases'::regclass AND NOT tgisinternal
     ) s`,
  ).split("\n");
/** Columns appended at the tail of 0019 on pre-existing tables (PIANO-LAVORI §2.5). */
const TAIL_COLUMNS = [
  ["workspace_integration_tokens", "exposed_at"],
  ["workspace_connector_configs", "profile"],
  ["workspace_connector_configs", "instructions_template"],
];
const EXPECTED_TAIL_COLUMNS = [
  "workspace_integration_tokens.exposed_at | timestamp without time zone | YES |",
  "workspace_connector_configs.profile | jsonb | YES |",
  "workspace_connector_configs.instructions_template | text | YES |",
].join("\n");
const tailColumns = (db) =>
  TAIL_COLUMNS.map(([table, column]) =>
    psql(
      db,
      `SELECT '${table}.' || column_name || ' | ' || data_type || ' | ' || is_nullable || ' | ' || coalesce(column_default, '')
         FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}' AND column_name = '${column}'`,
    ),
  ).join("\n");
const functionDef = (db) =>
  ["use_cases_touch_status_changed_at", "external_contribution_fill_principal_key", "connector_unaccent"]
    .map((name) => psql(db, `SELECT pg_get_functiondef('public.${name}'::regproc)`))
    .join("\n");
/** Extensions of the database, with their schema (0019 adds only unaccent). */
const extensions = (db) =>
  psql(db, `SELECT string_agg(e.extname || '@' || n.nspname, ',' ORDER BY e.extname) FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname <> 'plpgsql'`);
/** Volatility and parallel safety of the wrapper: IMMUTABLE (i) and PARALLEL SAFE (s), as an index needs. */
const wrapperFlags = (db) => psql(db, `SELECT provolatile::text || proparallel::text || proisstrict::text FROM pg_proc WHERE oid = 'public.connector_unaccent(text)'::regprocedure`);
/** Codes of the rows the search of tool-queries.ts finds for a text, in the seeded workspace. */
const searchCodes = (db, text) =>
  psql(
    db,
    `SELECT coalesce(string_agg(u.code, ',' ORDER BY u.code), '') FROM use_cases u
      WHERE u.workspace_id = '${ids.ws}' AND u.code IS NOT NULL
        AND ${SEARCH_VECTOR_SQL} @@ ${SEARCH_TSQUERY_SQL.replace("$2", `'${text.replace(/'/g, "''")}'`)}`,
  );
/** The same, with the expression of the old index (use_cases_search_italian_idx, no unaccent): the control. */
const legacySearchCodes = (db, text) =>
  psql(
    db,
    `SELECT coalesce(string_agg(code, ',' ORDER BY code), '') FROM use_cases
      WHERE workspace_id = '${ids.ws}' AND code IS NOT NULL
        AND to_tsvector('italian', coalesce(title, '') || ' ' || coalesce(description, '')) @@ websearch_to_tsquery('italian', '${text.replace(/'/g, "''")}')`,
  );
/** The plan of the search predicate with sequential scans off: it must use the new index. */
const searchPlan = (db) =>
  psql(
    db,
    `SET enable_seqscan = off; EXPLAIN SELECT 1 FROM use_cases u WHERE ${SEARCH_VECTOR_SQL} @@ ${SEARCH_TSQUERY_SQL.replace("$2", "'qualita'")}`,
  );

/**
 * Expand/contract: an insert in the shape of the code before 0019 (no principal_key,
 * no reserved id, no attempt) must succeed, land under the new unique index and stay
 * a legacy row (reserved_use_case_id NULL: never taken over).
 */
function oldShapeInsert(db, key) {
  const inserted = psql(
    db,
    `INSERT INTO external_contribution_submissions (workspace_id, integration_token_id, idempotency_key, request_hash, status)
     VALUES ('${ids.ws}', '${ids.token}', '${key}', repeat('c', 64), 'pending')
     RETURNING principal_key || ' ' || (reserved_use_case_id IS NULL)::text || ' ' || attempt`,
  );
  const arbiter = psql(
    db,
    `INSERT INTO external_contribution_submissions (workspace_id, integration_token_id, principal_key, idempotency_key, request_hash, status)
     VALUES ('${ids.ws}', '${ids.token}', 'token:${ids.token}', '${key}', repeat('c', 64), 'pending')
     ON CONFLICT (workspace_id, principal_key, idempotency_key) DO NOTHING RETURNING id`,
  );
  return { inserted, arbiter };
}
const legacyRows = (db) =>
  psql(db, `SELECT count(*) || '/' || count(*) FILTER (WHERE reserved_use_case_id IS NULL AND attempt = 1) FROM external_contribution_submissions WHERE workspace_id = '${ids.ws}'`);

function freshDatabase(db) {
  run("dropdb", [...pinned, "--if-exists", db]);
  run("createdb", [...pinned, db]);
  for (const name of base) applyFile(db, join(repoRoot, "drizzle", name));
  run("psql", [...pinned, "-d", db, "--no-psqlrc", "--single-transaction", "--set=ON_ERROR_STOP=1", "-q"], { input: SEED });
}

console.log(`Cluster 127.0.0.1:${port}; base migrations ${base[0]} → ${base[base.length - 1]}`);

// 1. Idempotence of 0019.
freshDatabase(MIG_DB);
check("probe is false before 0019", !probe(MIG_DB));
applyFile(MIG_DB, file0019);
const first = dump(MIG_DB);
applyFile(MIG_DB, file0019);
const second = dump(MIG_DB);
check("0019 applied twice: identical schema dump", first === second, firstDiff(first, second));
check("probe is true after 0019", probe(MIG_DB));
const expectedBackfill = [
  `${ids.ucDraft}=2026-09-02 10:00:00`,
  `${ids.submission}=token:${ids.token}`,
  `${ids.ucSubmitted}=2026-09-01 08:30:00`,
].sort().join(" | ");
check("0019 backfills status_changed_at (submitted_at, else created_at) and principal_key", backfill(MIG_DB) === expectedBackfill, backfill(MIG_DB));

// 2. Self-heal parity on a database with 0000→0017 only.
freshDatabase(HEAL_DB);
check("probe is false before the self-heal", !probe(HEAL_DB));
const healUrl = `postgresql://${USER}@${HOST}:${port}/${HEAL_DB}`;
const heal = spawnSync(
  process.execPath,
  [
    "--no-warnings",
    "--import",
    "./scripts/connettore-test/app-resolve.mjs",
    "--require",
    "./scripts/uc-test/local-neon.cjs",
    "--input-type=module",
    "-e",
    `const m = await import("./src/lib/db/ensure-schema.ts");
     await m.ensureDbSchema();
     await m.runConnectorDdl();
     console.log("self-heal done");`,
  ],
  {
    cwd: repoRoot,
    encoding: "utf8",
    env: { PATH: env.PATH, HOME: env.HOME, DATABASE_URL: healUrl, UC_TEST_DATABASE_URL: healUrl, UC_TEST_PG_PORT: port, UC_TEST_PG_DB: HEAL_DB },
  },
);
check("ensureDbSchema() + runConnectorDdl() run without errors", heal.status === 0, heal.status === 0 ? "" : heal.stderr.trim().split("\n").slice(-3).join(" / "));
check("probe is true after the self-heal", probe(HEAL_DB));
const migTables = dump(MIG_DB, WHOLE_TABLES);
const healTables = dump(HEAL_DB, WHOLE_TABLES);
check(`self-heal = 0019 for ${WHOLE_TABLES.join(", ")}`, migTables === healTables, firstDiff(migTables, healTables));
const of0019 = (lines) => lines.filter((line) => USE_CASES_0019.some((name) => line.startsWith(`${name} |`)));
const migUseCases = catalogOfUseCases(MIG_DB);
const healUseCases = catalogOfUseCases(HEAL_DB);
check("0019 creates every listed use_cases object", of0019(migUseCases).length === USE_CASES_0019.length, `${of0019(migUseCases).length}/${USE_CASES_0019.length}`);
check("self-heal = 0019 for the use_cases columns, constraints, indexes and trigger", of0019(migUseCases).join("\n") === of0019(healUseCases).join("\n"), firstDiff(of0019(migUseCases).join("\n"), of0019(healUseCases).join("\n")));
const onlyMig = migUseCases.filter((line) => !healUseCases.includes(line));
const onlyHeal = healUseCases.filter((line) => !migUseCases.includes(line));
check("use_cases: nothing in 0019 that the self-heal lacks", onlyMig.length === 0, onlyMig.join(" / "));
if (onlyHeal.length) console.log(`INFO use_cases objects added by the pre-existing self-heal but absent from migrations 0000–0017: ${onlyHeal.map((l) => l.split(" | ")[0]).join(", ")}`);
check("self-heal = 0019 for the trigger functions", functionDef(MIG_DB) === functionDef(HEAL_DB));
check("0019 adds the tail columns (nullable, no default)", tailColumns(MIG_DB) === EXPECTED_TAIL_COLUMNS, tailColumns(MIG_DB));
check("self-heal = 0019 for the tail columns", tailColumns(MIG_DB) === tailColumns(HEAL_DB), `${tailColumns(MIG_DB)} vs ${tailColumns(HEAL_DB)}`);
check("self-heal backfills like 0019", backfill(HEAL_DB) === expectedBackfill, backfill(HEAL_DB));
check("existing submissions stay legacy rows (reserved_use_case_id NULL, attempt 1)", legacyRows(MIG_DB) === "1/1" && legacyRows(HEAL_DB) === "1/1");
for (const db of [MIG_DB, HEAL_DB]) {
  const { inserted, arbiter } = oldShapeInsert(db, "chiave-forma-vecchia-001");
  check(`${db}: insert without principal_key (code before 0019) succeeds after the schema change`, inserted === `token:${ids.token} true 1`, inserted);
  check(`${db}: that row sits under the (workspace, principal_key, key) unique index`, arbiter === "");
}

// Trigger behaviour: a text edit keeps status_changed_at, a status change moves it.
const before = psql(MIG_DB, `SELECT status_changed_at FROM use_cases WHERE id = '${ids.ucSubmitted}'`);
psql(MIG_DB, `UPDATE use_cases SET title = 'Titolo corretto', updated_at = now() WHERE id = '${ids.ucSubmitted}'`);
const afterText = psql(MIG_DB, `SELECT status_changed_at FROM use_cases WHERE id = '${ids.ucSubmitted}'`);
psql(MIG_DB, `UPDATE use_cases SET portfolio_review_status = 'in_review' WHERE id = '${ids.ucSubmitted}'`);
const afterReview = psql(MIG_DB, `SELECT status_changed_at FROM use_cases WHERE id = '${ids.ucSubmitted}'`);
psql(MIG_DB, `UPDATE use_cases SET status = 'proposed' WHERE id = '${ids.ucSubmitted}'`);
const afterSame = psql(MIG_DB, `SELECT status_changed_at FROM use_cases WHERE id = '${ids.ucSubmitted}'`);
check("trigger: text edit leaves status_changed_at unchanged", before === afterText);
check("trigger: review status change updates status_changed_at", afterReview !== afterText);
check("trigger: setting the same status leaves it unchanged", afterSame === afterReview);
const created = readFileSync(file0019, "utf8").match(/CREATE\s+EXTENSION[^;]*;/gi) ?? [];
check("the only extension created by 0019 is unaccent", created.length === 1 && created[0] === "CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;", created.join(" "));
for (const db of [MIG_DB, HEAL_DB]) {
  check(`${db}: unaccent installed in public`, extensions(db) === "unaccent@public", extensions(db));
  check(`${db}: connector_unaccent is IMMUTABLE, PARALLEL SAFE and STRICT`, wrapperFlags(db) === "istrue", wrapperFlags(db));
}

// 4. Accent-insensitive search with the very query of tool-queries.ts.
psql(
  MIG_DB,
  `INSERT INTO use_cases (workspace_id, code, title, description, status) VALUES
     ('${ids.ws}', 'XS-0001', 'Qualità delle schede tecniche', 'Verifica delle schede.', 'proposed'),
     ('${ids.ws}', 'XS-0002', 'Qualita delle risposte', 'Risposte ai fornitori.', 'proposed')`,
);
// Single words only: the Italian stemmer turns «qualità» into 'qualit' and «qualita» into
// 'qual', so without unaccent each finds only its own spelling (the control below).
check("search: «qualita» alone finds «Qualità» and «Qualita»", searchCodes(MIG_DB, "qualita") === "XS-0001,XS-0002", searchCodes(MIG_DB, "qualita"));
check("search: «qualità» alone finds «Qualità» and «Qualita»", searchCodes(MIG_DB, "qualità") === "XS-0001,XS-0002", searchCodes(MIG_DB, "qualità"));
check(
  "search control: without unaccent (old index expression) each spelling finds only itself",
  legacySearchCodes(MIG_DB, "qualita") === "XS-0002" && legacySearchCodes(MIG_DB, "qualità") === "XS-0001",
  `${legacySearchCodes(MIG_DB, "qualita")} / ${legacySearchCodes(MIG_DB, "qualità")}`,
);
check("search: the query of tool-queries.ts uses use_cases_search_italian_unaccent_idx", searchPlan(MIG_DB).includes("use_cases_search_italian_unaccent_idx"), searchPlan(MIG_DB).split("\n")[0]);

run("dropdb", [...pinned, "--if-exists", MIG_DB]);
run("dropdb", [...pinned, "--if-exists", HEAL_DB]);
console.log(failures.length === 0 ? "All schema checks passed." : `${failures.length} check(s) failed.`);
process.exit(failures.length === 0 ? 0 : 1);
