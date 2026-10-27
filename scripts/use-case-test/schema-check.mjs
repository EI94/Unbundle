// Schema checks for drizzle/0020_use_case_hub.sql on the hub's local test cluster
// (docs/use-case/PIANO-LAVORI.md §5.6, docs/use-case/DESIGN.md §10.1-10.4), on the model
// of scripts/connettore-test/schema-check.mjs. Never touches another database: every
// psql / pg_dump call is pinned to uc_test@127.0.0.1:<UC_TEST_PG_PORT>, and the scratch
// databases hub_check_<run>_* below belong to this run only: created here, dropped when
// the script exits (also after an error). <run> is HUB_CHECK_ID (lowercase letters, digits,
// _) or the process id, so two runs at once never drop each other's databases; those of a
// run that was killed (its process is gone) are dropped at the start of the next one.
//
//   UC_TEST_PG_PORT=55479 node scripts/use-case-test/schema-check.mjs
//
// 1. Idempotence: on a database migrated 0000→0019 (with synthetic rows), 0020 is applied
//    twice; `pg_dump --schema-only` after the first and the second apply must be identical.
//    Existing rows get origin 'adoption' and version 1, and no history row (no backfill).
// 2. Self-heal parity: a second database migrated only 0000→0017 (same rows) gets the real
//    `ensureDbSchema()` of the app. Tables, columns, constraints, indexes, triggers and
//    trigger functions of the hub must equal those of database 1.
// 3. Duplicate dossiers: with two uc_cases rows on the same card (a complete one and an
//    incomplete one, then two complete ones) 0020 stops with the message of DESIGN §10.4
//    and leaves nothing behind; without duplicates it creates the unique index. The database
//    first loses the unique index of the 0018 of C11b, as under a 0018 from before C11b;
//    that 0018 applied again over the duplicate skips the index with a NOTICE, and 0020
//    still stops.
// 4. Without the uc tables (0000→0017 and 0019, no 0018) 0020 passes twice and creates no
//    unique index.
// 5. Art. 15.4: no index on use_cases.proposed_by nor on use_case_events.actor_user_id; no
//    free-text column in use_case_events.
// 6. Rollout safety: on both databases inserts and updates in the shape of the code before
//    0020 succeed; the creation trigger writes one `creato` row without a person.
// 7. Probe: a database at 0019 that today's probe calls current (0000→0019 plus the
//    self-heal catch-up, without the hub objects) receives `ensureDbSchema()`: the self-heal
//    runs and the hub objects appear (DESIGN §10.2). Case 2 alone cannot see this, because
//    0000→0017 makes the probe false anyway. On a fully healed database the same call runs
//    only the probe.
// 8. Without 0019 (0000→0017): 0020 stops with its message and leaves nothing behind. The
//    version trigger reads intake and public_note, and PL/pgSQL would not notice their
//    absence until the first UPDATE of use_cases.
// Migration 0022 (value_model, its version trigger, use_case_needs, use_case_need_links):
// 9. Idempotence: on database 1 (0000→0020 with rows) 0022 is applied twice, identical
//    dumps; existing rows keep their version and get no value model. Self-heal parity: the
//    0022 objects of database 2 equal those of database 1.
// 10. The version trigger of 0022 on every database: one bump when value_model changes,
//    also together with another column; none for the same value, a hand-written version or
//    the AI. Needs: closed vocabularies, import key unique per workspace, cascades.
// 11. Production: a database at 0018, 0019 and 0020 healed by the self-heal of before
//    (ENSURE_VERSION 15), with rows of the 0020 era. `ensureDbSchema()` does not stop at the
//    probe, adds the 0022 objects (equal to those of the migration) and keeps every row; a
//    second call runs only the probe; 0022 applied twice on top changes nothing.
// 12. Without 0020 (0000→0019): 0022 stops with its message and leaves nothing behind.
// Migration 0023 (the Storia's fields CHECK widened with 'cosa_serve'):
// 13. Idempotence: on database 1 (0000→0022 with rows and history rows) 0023 is applied
//    twice, identical dumps; the CHECK lists the 0020 names plus cosa_serve and is validated;
//    every row is kept. Self-heal parity follows from case 2 (use_case_events is in its dump).
// 14. Production today: 0000→0022 healed by the self-heal of before (ENSURE_VERSION 16), with
//    use cases, history rows using every 0020 name, needs and links. a) `ensureDbSchema()`
//    does not stop at the probe, widens the CHECK as the migration does and keeps every row; a
//    second call runs only the probe; 0023 applied twice on top changes nothing. b) The same
//    database through the SQL file: twice, identical dumps, rows kept, then `ensureDbSchema()`
//    runs only the probe.
// 15. Never narrows, never fails on rows: a CHECK that already allows more names stays as it is;
//    a CHECK without cosa_serve but with an extra name keeps the extra name; with no CHECK and a
//    row outside every list 0023 passes with its WARNING, leaves the CHECK NOT VALID (new rows
//    still refused) and validates it once the row is gone.
// 16. Without 0020 (0000→0019): 0023 stops with its message.
// 17. Never queued behind a long transaction, never at the same time as the self-heal: on a
//    database as production is today, a session holding a lock on use_case_events makes 0023
//    (file and self-heal) stop within its lock_timeout of 3s with «lock timeout», changing
//    nothing; a session holding the self-heal's advisory lock makes the file stop the same way
//    (the file takes that lock); once both are gone, 0023 passes.
// Exit code 0 only if every check passes. Optional: UC_TEST_PG_BIN.
// Migration 0024 (Chiedi al referente, the per-person bell, «Raccolta informazioni»):
// 18. Idempotence: on database 1 (0000→0023 with rows) 0024 is applied twice, identical dumps;
//     the Storia's CHECK gains 'richiesta_referente'; the referents probe is true. Self-heal
//     parity: the 0024 tables of database 2 equal those of database 1.
// 19. Production today (0000→0023 healed by the self-heal of ENSURE_VERSION 17, with use cases,
//     history rows and needs; a card whose client-side needs are all validated): a) the
//     self-heal at 18 applies 0024, keeps every row and marks that card complete in
//     use_case_info_state; a second call runs only the probe; the file twice on top changes
//     nothing. b) The file through psql --single-transaction, then ensureDbSchema() runs only the
//     probe; the file again changes nothing.
// 20. TimeZone: every scratch database runs in UTC, as Neon does (the bell reads
//     weekly_signals.created_at, a timestamp without time zone, as UTC): `SHOW TimeZone` is UTC.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const port = process.env.UC_TEST_PG_PORT?.trim() || "55479";
// 55439 Learning, 55449 Casi d'uso, 55469 connector: never the hub's checks.
if (!/^\d+$/.test(port) || ["55439", "55449", "55469"].includes(port)) {
  throw new Error("Use the hub's own test cluster port (default 55479)");
}
const pgBin = process.env.UC_TEST_PG_BIN || "/opt/homebrew/opt/postgresql@16/bin";
const HOST = "127.0.0.1";
const USER = "uc_test";
// One set of scratch databases per run (see the header): never shared, never reused.
const runTag = (process.env.HUB_CHECK_ID?.trim().toLowerCase() || String(process.pid)).replace(/[^a-z0-9_]/g, "").slice(0, 24);
if (!runTag) throw new Error("HUB_CHECK_ID must contain lowercase letters, digits or _");
const DB = Object.fromEntries(
  ["mig", "heal", "probe", "dups", "nouc", "no19", "prod", "no20", "prod23", "prod23f", "narrow", "locks", "prod24", "prod24f"].map((key) => [key, `hub_check_${runTag}_${key}`]),
);
const HUB_TABLES = ["use_case_events", "use_case_mcp_requests"];
const USE_CASES_0020 = [
  // Read by the version trigger; the self-heal already adds it, migrations 0000–0019 do not.
  "column sustainability_impact",
  "column origin", "column ai_lab", "column target_quarter", "column review_by", "column value_eur_year",
  "column cost_eur_once", "column cost_band", "column ai_suggestion", "column version",
  "constraint use_cases_origin_check", "constraint use_cases_target_quarter_check",
  "constraint use_cases_value_eur_year_check", "constraint use_cases_cost_eur_once_check",
  "constraint use_cases_cost_band_check", "constraint use_cases_ai_suggestion_check",
  "constraint use_cases_cost_one_source_check",
  "index use_cases_workspace_origin_idx", "index use_cases_workspace_quarter_idx",
  "index use_cases_workspace_review_by_idx", "index use_cases_workspace_ai_lab_idx",
  "trigger use_cases_bump_version", "trigger use_cases_created_event",
];
const TOKENS_0020 = [
  "column owner_user_id",
  "constraint workspace_integration_tokens_owner_user_id_fkey",
  "index workspace_integration_tokens_owner_idx",
];
const FUNCTIONS = ["use_cases_bump_version", "use_cases_created_event"];
const VALUE_TABLES = ["use_case_needs", "use_case_need_links"];
const USE_CASES_0022 = ["column value_model", "constraint use_cases_value_model_check", "trigger use_cases_value_model_version"];
const VALUE_FUNCTIONS = ["use_cases_value_model_version"];
const env = { PATH: `${pgBin}:${process.env.PATH ?? "/usr/bin:/bin"}`, HOME: process.env.HOME ?? "/private/tmp", LC_ALL: "C", LANG: "C" };
const pinned = ["-h", HOST, "-p", port, "-U", USER];
const failures = [];

function bin(name) {
  const path = join(pgBin, name);
  return existsSync(path) ? path : name;
}

function exec(name, args, { input } = {}) {
  return spawnSync(bin(name), args, { env, input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function run(name, args, options) {
  const result = exec(name, args, options);
  if (result.status !== 0) {
    console.error(result.stderr?.trim());
    throw new Error(`${name} ${args.filter((a) => !a.startsWith("-")).slice(-1)} failed (exit ${result.status})`);
  }
  return result.stdout;
}

const psql = (db, sql) => run("psql", [...pinned, "-d", db, "--no-psqlrc", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql]).trim();
/** psql that may fail: { ok, out, err }. */
const tryPsql = (db, sql) => {
  const result = exec("psql", [...pinned, "-d", db, "--no-psqlrc", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql]);
  return { ok: result.status === 0, out: result.stdout.trim(), err: result.stderr.trim() };
};
const applyArgs = (db, file) => [...pinned, "-d", db, "--no-psqlrc", "--single-transaction", "--set=ON_ERROR_STOP=1", "-q", "-f", file];
const applyFile = (db, file) => run("psql", applyArgs(db, file));

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
const upTo = (last) => migrations.filter((n) => n.slice(0, 4) <= last);
const file = (prefix) => join(repoRoot, "drizzle", migrations.find((n) => n.startsWith(prefix)));
const file0020 = file("0020");
const file0022 = file("0022");
const file0023 = file("0023");
const file0024 = file("0024");

// Synthetic rows that exist before the migration (no client data, .test addresses only).
const ids = {
  org: "00000000-0000-4000-8000-0000000000b1",
  ws: "00000000-0000-4000-8000-0000000000b2",
  user: "00000000-0000-4000-8000-0000000000b3",
  token: "00000000-0000-4000-8000-0000000000b4",
  ucOld: "00000000-0000-4000-8000-0000000000b5",
  ucOldDraft: "00000000-0000-4000-8000-0000000000b6",
  cardA: "00000000-0000-4000-8000-0000000000c1",
  cardB: "00000000-0000-4000-8000-0000000000c2",
  template: "00000000-0000-4000-8000-0000000000c3",
};
const SEED = `
INSERT INTO organizations (id, name, slug) VALUES ('${ids.org}', 'Organizzazione di prova hub', 'org-prova-hub-schema');
INSERT INTO workspaces (id, organization_id, name) VALUES ('${ids.ws}', '${ids.org}', 'Workspace di prova hub');
INSERT INTO users (id, email, name) VALUES ('${ids.user}', 'revisore.schema@ls.test', 'Revisore di prova');
INSERT INTO workspace_integration_tokens (id, workspace_id, label, token_hash, token_prefix)
  VALUES ('${ids.token}', '${ids.ws}', 'Token di prova', repeat('d', 64), 'prova...');
INSERT INTO use_cases (id, workspace_id, title, status, source, submitted_at, created_at)
  VALUES ('${ids.ucOld}', '${ids.ws}', 'Riepilogo automatico delle riunioni', 'proposed', 'web_proposed', '2026-09-01 08:30:00', '2026-09-01 08:00:00');
INSERT INTO use_cases (id, workspace_id, title, created_at)
  VALUES ('${ids.ucOldDraft}', '${ids.ws}', 'Bozza di prova', '2026-09-02 10:00:00');
`;

const { CONNECTOR_PROBE_SQL } = await import("../../src/lib/db/connector-ddl.ts");
const { USE_CASE_HUB_PROBE_SQL, DOSSIER_DUPLICATES_MESSAGE, MISSING_0019_MESSAGE } = await import("../../src/lib/db/use-case-hub-ddl.ts");
const { USE_CASE_VALUE_PROBE_SQL, MISSING_0020_MESSAGE } = await import("../../src/lib/db/use-case-hub-value-ddl.ts");
const { USE_CASE_EVENT_FIELDS } = await import("../../src/lib/db/use-case-hub-ddl.ts");
const { USE_CASE_HISTORY_PROBE_SQL, USE_CASE_EVENT_FIELDS_0023, MISSING_EVENTS_MESSAGE, FIELDS_NOT_VALIDATED_WARNING } = await import(
  "../../src/lib/db/use-case-hub-history-ddl.ts"
);
const { USE_CASE_REFERENTS_PROBE_SQL, REFERENTS_TABLES, USE_CASE_EVENT_FIELDS_0024 } = await import("../../src/lib/db/use-case-hub-referents-ddl.ts");
const hubProbe = (db) => psql(db, `SELECT ${USE_CASE_HUB_PROBE_SQL}`) === "t";
const referentsProbe = (db) => psql(db, `SELECT ${USE_CASE_REFERENTS_PROBE_SQL}`) === "t";
const valueProbe = (db) => psql(db, `SELECT ${USE_CASE_VALUE_PROBE_SQL}`) === "t";
const historyProbe = (db) => psql(db, `SELECT ${USE_CASE_HISTORY_PROBE_SQL}`) === "t";
/** The Storia's fields CHECK: `<definition>|<validated t/f>`, or "" when there is none. */
const fieldsCheckOf = (db) =>
  psql(db, `SELECT coalesce((SELECT pg_get_constraintdef(oid) || '|' || convalidated FROM pg_constraint WHERE conrelid = 'public.use_case_events'::regclass AND conname = 'use_case_events_fields_check'), '')`);
/** The CHECK as Postgres prints it for a list of names. */
const checkDefOf = (names) => `CHECK ((fields <@ ARRAY[${names.map((name) => `'${name}'::text`).join(", ")}]))`;
const textArray = (names) => `ARRAY[${names.map((name) => `'${name}'`).join(", ")}]::text[]`;
/** Use cases, history rows, needs and links of a database, as comparable text. */
const snapshotOf = (db) =>
  psql(
    db,
    `SELECT (SELECT coalesce(string_agg(id || ':' || version, ',' ORDER BY id), '') FROM use_cases)
       || ' | ' || (SELECT coalesce(string_agg(id || ':' || action || ':' || array_to_string(fields, '+') || ':' || coalesce(phase_before, '-') || ':' || coalesce(phase_after, '-') || ':' || at::text, ',' ORDER BY id), '') FROM use_case_events)
       || ' | ' || (SELECT coalesce(string_agg(id || ':' || version || ':' || status, ',' ORDER BY id), '') FROM use_case_needs)
       || ' | ' || (SELECT coalesce(string_agg(need_id || ':' || use_case_id, ',' ORDER BY need_id, use_case_id), '') FROM use_case_need_links)`,
  );
const connectorProbe = (db) => psql(db, `SELECT ${CONNECTOR_PROBE_SQL}`) === "t";

/** Columns, constraints, indexes and triggers of a table, one sorted line each. */
const catalogOf = (db, table) =>
  psql(
    db,
    `SELECT string_agg(line, E'\\n' ORDER BY line) FROM (
       SELECT 'column ' || column_name || ' | ' || data_type || coalesce('(' || character_maximum_length || ')', '') || ' | ' || is_nullable || ' | ' || coalesce(column_default, '') AS line
         FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}'
       UNION ALL
       SELECT 'constraint ' || conname || ' | ' || pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.${table}'::regclass
       UNION ALL
       SELECT 'index ' || indexname || ' | ' || indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = '${table}'
       UNION ALL
       SELECT 'trigger ' || tgname || ' | ' || pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = 'public.${table}'::regclass AND NOT tgisinternal
     ) s`,
  ).split("\n");
const only = (lines, names) => lines.filter((line) => names.some((name) => line.startsWith(`${name} |`)));
const functionDefs = (db) => FUNCTIONS.map((name) => psql(db, `SELECT pg_get_functiondef('public.${name}'::regproc)`)).join("\n");

/** Every hub object of a database, as comparable text. */
function hubObjects(db) {
  return {
    tables: dump(db, HUB_TABLES),
    useCases: only(catalogOf(db, "use_cases"), USE_CASES_0020),
    tokens: only(catalogOf(db, "workspace_integration_tokens"), TOKENS_0020),
    functions: functionDefs(db),
  };
}

/** Every 0022 object of a database, as comparable text. */
function valueObjects(db) {
  return {
    tables: dump(db, VALUE_TABLES),
    useCases: only(catalogOf(db, "use_cases"), USE_CASES_0022),
    functions: VALUE_FUNCTIONS.map((name) => psql(db, `SELECT pg_get_functiondef('public.${name}'::regproc)`)).join("\n"),
  };
}
const sameValueObjects = (a, b) => a.tables === b.tables && a.useCases.join("\n") === b.useCases.join("\n") && a.functions === b.functions;
const valueDiff = (a, b) => firstDiff(a.tables, b.tables) || firstDiff(a.useCases.join("\n"), b.useCases.join("\n")) || firstDiff(a.functions, b.functions);

/** Removes what 0024 adds (its tables, the wider CHECK): the database goes back to before 0024. */
function dropReferents(db) {
  psql(
    db,
    `DROP TABLE IF EXISTS ${[...REFERENTS_TABLES].reverse().join(", ")} CASCADE;
     DO $$ BEGIN
       IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.use_case_events'::regclass AND conname = 'use_case_events_fields_check') THEN
         ALTER TABLE use_case_events DROP CONSTRAINT use_case_events_fields_check;
         ALTER TABLE use_case_events ADD CONSTRAINT use_case_events_fields_check CHECK (fields <@ ${textArray(USE_CASE_EVENT_FIELDS_0023)});
       END IF;
     END $$;`,
  );
}

function freshDatabase(db, files) {
  run("dropdb", [...pinned, "--if-exists", "--force", db]);
  run("createdb", [...pinned, db]);
  // As Neon: the database runs in UTC (case 20).
  psql(db, `ALTER DATABASE "${db}" SET timezone TO 'UTC'`);
  for (const name of files) applyFile(db, join(repoRoot, "drizzle", name));
  run("psql", [...pinned, "-d", db, "--no-psqlrc", "--single-transaction", "--set=ON_ERROR_STOP=1", "-q"], { input: SEED });
}

/**
 * The real `ensureDbSchema()` of the app on `db`, in a child process with the local Neon
 * transport. Returns how many `db.execute` calls it made: 1 means only the probe ran
 * (`schemaLooksCurrent()` was true), more means the self-heal ran.
 */
function ensureDbSchemaOn(db) {
  const url = `postgresql://${USER}@${HOST}:${port}/${db}`;
  const child = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--import",
      "./scripts/connettore-test/app-resolve.mjs",
      "--require",
      "./scripts/uc-test/local-neon.cjs",
      "--input-type=module",
      "-e",
      `const { db } = await import("./src/lib/db/index.ts");
       let calls = 0;
       const execute = db.execute.bind(db);
       db.execute = (...args) => { calls += 1; return execute(...args); };
       const m = await import("./src/lib/db/ensure-schema.ts");
       await m.ensureDbSchema();
       console.log("ensure-calls=" + calls);`,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: { PATH: env.PATH, HOME: env.HOME, DATABASE_URL: url, UC_TEST_DATABASE_URL: url, UC_TEST_PG_PORT: port, UC_TEST_PG_DB: db },
    },
  );
  const calls = Number(child.stdout.match(/ensure-calls=(\d+)/)?.[1] ?? NaN);
  return { ok: child.status === 0, calls, error: child.status === 0 ? "" : child.stderr.trim().split("\n").slice(-3).join(" / "), stderr: child.stderr };
}

/** Inserts and updates in the shape of the code before 0020 (no hub column named). */
function oldShapeWrites(db, label) {
  const inserted = psql(
    db,
    `INSERT INTO use_cases (workspace_id, title, description, source, proposed_by, portfolio_kind, status, portfolio_review_status, submitted_at)
     VALUES ('${ids.ws}', 'Classificazione delle richieste', 'Smistare le richieste in arrivo', 'web_proposed', 'persona.${label}@cliente.test', 'use_case_ai', 'proposed', 'needs_inputs', now())
     RETURNING id || ' ' || origin || ' ' || version`,
  );
  const [id, origin, version] = inserted.split(" ");
  check(`${db}: insert without the 0020 columns succeeds (origin adoption, version 1)`, origin === "adoption" && version === "1", inserted);
  const events = psql(
    db,
    `SELECT string_agg(action || '/' || channel || '/' || actor_kind || '/' || coalesce(actor_user_id::text, 'null') || '/' || cardinality(fields)
       || '/' || coalesce(phase_before, 'null') || '/' || coalesce(phase_after, 'null'), ',')
       FROM use_case_events WHERE use_case_id = '${id}'`,
  );
  check(`${db}: the creation trigger writes one «creato» row, channel web, no person, no fields`, events === "creato/web/proponente/null/0/null/null", events);
  const updated = psql(
    db,
    `UPDATE use_cases SET portfolio_review_status = 'in_review', review_notes = 'Nota interna di prova', reviewed_by = '${ids.user}', reviewed_at = now(), updated_at = now()
      WHERE id = '${id}' RETURNING version`,
  );
  check(`${db}: an old-shape review update succeeds and bumps version (review status changed)`, updated === "2", updated);
  const recomputed = psql(
    db,
    `UPDATE use_cases SET overall_score = 3.4, overall_impact_score = 3.1, category = 'quick_win', updated_at = now() WHERE id = '${id}' RETURNING version`,
  );
  check(`${db}: recomputed scores and category leave version unchanged`, recomputed === "2", recomputed);
  const token = psql(
    db,
    `INSERT INTO workspace_integration_tokens (workspace_id, label, token_hash, token_prefix)
     VALUES ('${ids.ws}', 'Token forma vecchia', md5('${label}') || md5('${label}x'), 'prova...') RETURNING coalesce(owner_user_id::text, 'null')`,
  );
  check(`${db}: an old-shape workspace token insert succeeds with owner_user_id NULL`, token === "null", token);
}

/** The 0022 trigger and tables on `db`: version bumps, closed vocabularies, unique key, cascades. */
function valueWrites(db, label) {
  const id = psql(db, `INSERT INTO use_cases (workspace_id, title, status) VALUES ('${ids.ws}', 'Scheda con benefici ${label}', 'accepted') RETURNING id`);
  const versions = [
    `value_model = '{"v": 1, "primary": "tempo"}'::jsonb`,
    `value_model = '{"primary": "tempo", "v": 1}'::jsonb`,
    `value_model = '{"v": 1, "primary": "tempo", "ease": 3}'::jsonb, version = 50`,
    `title = 'Titolo cambiato ${label}', value_model = '{"v": 1, "primary": "costi"}'::jsonb`,
    `ai_suggestion = '{"kind": "auto"}'::jsonb, overall_score = 2.5`,
    `value_model = NULL`,
  ].map((set) => psql(db, `UPDATE use_cases SET ${set} WHERE id = '${id}' RETURNING version`));
  check(`${db}: value_model bumps version by one (with another column too), not for the same jsonb, a hand-written version or the AI`, versions.join(",") === "2,2,3,4,4,5", versions.join(","));
  const array = tryPsql(db, `UPDATE use_cases SET value_model = '[]'::jsonb WHERE id = '${id}'`);
  check(`${db}: value_model must be an object`, !array.ok && array.err.includes("use_cases_value_model_check"), array.err.split("\n")[0]);
  const need = psql(
    db,
    `INSERT INTO use_case_needs (workspace_id, type, kind, title, status, import_key) VALUES ('${ids.ws}', 'requisito', 'accesso', 'Accesso al gestionale', 'chiesta', 'k-${label}') RETURNING id`,
  );
  psql(db, `INSERT INTO use_case_need_links (need_id, use_case_id) VALUES ('${need}', '${id}')`);
  const wrongStatus = tryPsql(db, `INSERT INTO use_case_needs (workspace_id, type, title, status) VALUES ('${ids.ws}', 'passo', 'Passo di prova', 'validata')`);
  check(`${db}: a step cannot take a requirement status`, !wrongStatus.ok && wrongStatus.err.includes("use_case_needs_status_check"), wrongStatus.err.split("\n")[0]);
  const dupKey = tryPsql(db, `INSERT INTO use_case_needs (workspace_id, type, title, status, import_key) VALUES ('${ids.ws}', 'passo', 'Altro passo', 'proposta', 'k-${label}')`);
  check(`${db}: the import key is unique per workspace`, !dupKey.ok && dupKey.err.includes("use_case_needs_import_key_unique"), dupKey.err.split("\n")[0]);
  psql(db, `DELETE FROM use_cases WHERE id = '${id}'`);
  const left = psql(db, `SELECT (SELECT count(*) FROM use_case_need_links WHERE need_id = '${need}') || '/' || (SELECT count(*) FROM use_case_needs WHERE id = '${need}')`);
  check(`${db}: deleting the card removes the link, the need stays`, left === "0/1", left);
  psql(db, `DELETE FROM use_case_needs WHERE id = '${need}'`);
}

/** Drops this run's scratch databases; runs on every exit, an uncaught error included. */
let dropped = false;
function dropScratchDatabases() {
  if (dropped) return;
  dropped = true;
  for (const db of Object.values(DB)) exec("dropdb", [...pinned, "--if-exists", "--force", db]);
}
process.on("exit", dropScratchDatabases);

/** A run killed outright (SIGKILL, Ctrl-C during a child process) leaves hub_check_<pid>_*: drop those of dead processes. */
function dropDeadRunDatabases() {
  const names = psql("postgres", `SELECT string_agg(datname, ' ') FROM pg_database WHERE datname ~ '^hub_check_[0-9]+_[a-z0-9]+$'`);
  for (const name of names.split(" ").filter(Boolean)) {
    const pid = Number(name.split("_")[2]);
    if (pid === process.pid) continue;
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") run("dropdb", [...pinned, "--if-exists", "--force", name]);
    }
  }
}
dropDeadRunDatabases();

console.log(`Cluster 127.0.0.1:${port}; migrations ${migrations[0]} → ${migrations[migrations.length - 1]}; databases hub_check_${runTag}_*`);

// 1. Idempotence of 0020 on 0000→0019 with rows.
freshDatabase(DB.mig, upTo("0019"));
check("0000→0019: hub probe false, connector probe true", !hubProbe(DB.mig) && connectorProbe(DB.mig));
applyFile(DB.mig, file0020);
const first = dump(DB.mig);
applyFile(DB.mig, file0020);
const second = dump(DB.mig);
check("0020 applied twice: identical schema dump", first === second, firstDiff(first, second));
check("hub probe true after 0020", hubProbe(DB.mig));
const existing = psql(DB.mig, `SELECT string_agg(origin || '/' || version, ',' ORDER BY id) FROM use_cases WHERE workspace_id = '${ids.ws}'`);
check("existing rows: origin adoption, version 1", existing === "adoption/1,adoption/1", existing);
check("existing rows: no history row (no backfill)", psql(DB.mig, `SELECT count(*) FROM use_case_events`) === "0");
check("0020 with the uc tables creates the unique dossier index", psql(DB.mig, `SELECT to_regclass('public.uc_cases_portfolio_use_case_unique_idx') IS NOT NULL`) === "t");
check("the old non-unique dossier index stays", psql(DB.mig, `SELECT to_regclass('public.uc_cases_portfolio_use_case_idx') IS NOT NULL`) === "t");

// 9. Idempotence of 0022 on the same database (now 0000→0020 with rows).
check("0000→0020: value probe false before 0022", !valueProbe(DB.mig));
applyFile(DB.mig, file0022);
const firstValue = dump(DB.mig);
applyFile(DB.mig, file0022);
const secondValue = dump(DB.mig);
check("0022 applied twice: identical schema dump", firstValue === secondValue, firstDiff(firstValue, secondValue));
check("value probe true after 0022", valueProbe(DB.mig));
const migValue = valueObjects(DB.mig);
check("0022 creates every listed use_cases object", migValue.useCases.length === USE_CASES_0022.length, `${migValue.useCases.length}/${USE_CASES_0022.length}`);
const afterValue = psql(DB.mig, `SELECT string_agg(version || '/' || coalesce(value_model::text, 'null'), ',' ORDER BY id) FROM use_cases WHERE workspace_id = '${ids.ws}'`);
check("existing rows after 0022: same version, no value model", afterValue === "1/null,1/null", afterValue);
check("no extension created by 0022", !readFileSync(file0022, "utf8").match(/CREATE\s+EXTENSION/i));

// 13. Idempotence of 0023 on the same database (now 0000→0022 with rows), with history rows that
//     use every name of the 0020 list.
check("0000→0022: history probe false before 0023", !historyProbe(DB.mig));
const check0020 = fieldsCheckOf(DB.mig);
check("…with the CHECK of 0020, validated", check0020 === `${checkDefOf(USE_CASE_EVENT_FIELDS)}|true`, check0020);
psql(
  DB.mig,
  `INSERT INTO use_case_events (workspace_id, use_case_id, actor_kind, channel, action, fields)
     VALUES ('${ids.ws}', '${ids.ucOld}', 'sistema', 'script', 'modificato', ${textArray(USE_CASE_EVENT_FIELDS)});
   INSERT INTO use_case_events (workspace_id, use_case_id, actor_kind, channel, action, fields, phase_before, phase_after)
     VALUES ('${ids.ws}', '${ids.ucOld}', 'sistema', 'script', 'decisione', '{}', 'da_valutare.nuova', 'approvato.trimestre');`,
);
const migBefore0023 = snapshotOf(DB.mig);
applyFile(DB.mig, file0023);
const firstHistory = dump(DB.mig);
applyFile(DB.mig, file0023);
const secondHistory = dump(DB.mig);
check("0023 applied twice: identical schema dump", firstHistory === secondHistory, firstDiff(firstHistory, secondHistory));
check("history probe true after 0023", historyProbe(DB.mig));
const check0023 = fieldsCheckOf(DB.mig);
check("0023: the CHECK lists the 0020 names plus cosa_serve, validated", check0023 === `${checkDefOf(USE_CASE_EVENT_FIELDS_0023)}|true`, check0023);
check("0023 keeps every use case, history row, need and link", snapshotOf(DB.mig) === migBefore0023, `${migBefore0023} → ${snapshotOf(DB.mig)}`);
check("no extension created by 0023", !readFileSync(file0023, "utf8").match(/CREATE\s+EXTENSION/i));
psql(DB.mig, `DELETE FROM use_case_events WHERE use_case_id = '${ids.ucOld}'`);

// 18. Idempotence of 0024 on the same database (now 0000→0023 with rows).
check("0000→0023: referents probe false before 0024", !referentsProbe(DB.mig));
const migBefore0024 = snapshotOf(DB.mig);
applyFile(DB.mig, file0024);
const firstReferents = dump(DB.mig);
applyFile(DB.mig, file0024);
const secondReferents = dump(DB.mig);
check("0024 applied twice: identical schema dump", firstReferents === secondReferents, firstDiff(firstReferents, secondReferents));
check("referents probe true after 0024", referentsProbe(DB.mig));
const check0024 = fieldsCheckOf(DB.mig);
check("0024: the CHECK lists the 0023 names plus richiesta_referente, validated", check0024 === `${checkDefOf(USE_CASE_EVENT_FIELDS_0024)}|true`, check0024);
check("0024 keeps every use case, history row, need and link", snapshotOf(DB.mig) === migBefore0024, `${migBefore0024} → ${snapshotOf(DB.mig)}`);
check("no extension created by 0024", !readFileSync(file0024, "utf8").match(/CREATE\s+EXTENSION/i));

// 2. Self-heal parity on 0000→0017.
freshDatabase(DB.heal, upTo("0017"));
check("0000→0017: hub probe false before the self-heal", !hubProbe(DB.heal));
const heal = ensureDbSchemaOn(DB.heal);
check("ensureDbSchema() runs without errors and applies the self-heal", heal.ok && heal.calls > 1, heal.error || `${heal.calls} execute calls`);
check("hub probe true after the self-heal", hubProbe(DB.heal));
const migHub = hubObjects(DB.mig);
const healHub = hubObjects(DB.heal);
check(`self-heal = 0020 for ${HUB_TABLES.join(", ")}`, migHub.tables === healHub.tables, firstDiff(migHub.tables, healHub.tables));
check("0020 creates every listed use_cases object", migHub.useCases.length === USE_CASES_0020.length, `${migHub.useCases.length}/${USE_CASES_0020.length}`);
check(
  "self-heal = 0020 for the use_cases columns, constraints, indexes and triggers",
  migHub.useCases.join("\n") === healHub.useCases.join("\n"),
  firstDiff(migHub.useCases.join("\n"), healHub.useCases.join("\n")),
);
check("0020 creates every listed workspace_integration_tokens object", migHub.tokens.length === TOKENS_0020.length, `${migHub.tokens.length}/${TOKENS_0020.length}`);
check("self-heal = 0020 for workspace_integration_tokens.owner_user_id", migHub.tokens.join("\n") === healHub.tokens.join("\n"), firstDiff(migHub.tokens.join("\n"), healHub.tokens.join("\n")));
check("self-heal = 0020 for the trigger functions", migHub.functions === healHub.functions, firstDiff(migHub.functions, healHub.functions));
check("the self-heal creates no dossier index (it is only in 0020)", psql(DB.heal, `SELECT to_regclass('public.uc_cases_portfolio_use_case_unique_idx') IS NULL`) === "t");
check("value probe true after the self-heal", valueProbe(DB.heal));
const healValue = valueObjects(DB.heal);
check(`self-heal = 0022 for ${VALUE_TABLES.join(", ")}, use_cases.value_model, its CHECK, trigger and function`, sameValueObjects(migValue, healValue), valueDiff(migValue, healValue));
check("history probe true after the self-heal", historyProbe(DB.heal));
check("self-heal = 0023 and 0024 for the Storia's fields CHECK", fieldsCheckOf(DB.heal) === check0024, fieldsCheckOf(DB.heal));
check("referents probe true after the self-heal", referentsProbe(DB.heal));
check(`self-heal = 0024 for ${REFERENTS_TABLES.length} tables`, dump(DB.heal, [...REFERENTS_TABLES]) === dump(DB.mig, [...REFERENTS_TABLES]), firstDiff(dump(DB.mig, [...REFERENTS_TABLES]), dump(DB.heal, [...REFERENTS_TABLES])));

// 3. Duplicate dossiers stop 0020, complete or not, and leave nothing behind.
freshDatabase(DB.dups, upTo("0019"));
// The 0018 of C11b creates the unique dossier index on the still empty uc_cases. Production
// ran a 0018 from before it: drop the index to seed duplicates as there (no-op before C11b).
psql(DB.dups, `DROP INDEX IF EXISTS uc_cases_portfolio_use_case_unique_idx`);
psql(
  DB.dups,
  `INSERT INTO use_cases (id, workspace_id, title, status) VALUES ('${ids.cardA}', '${ids.ws}', 'Scheda A di prova', 'accepted'), ('${ids.cardB}', '${ids.ws}', 'Scheda B di prova', 'accepted');
   INSERT INTO uc_templates (id, key, version, name, archetype, definition, definition_hash)
     VALUES ('${ids.template}', 'prova.schema_hub', '1.0.0', 'Modello di prova', 'prova', '{}'::jsonb, repeat('a', 64));
   INSERT INTO uc_cases (workspace_id, organization_id, portfolio_use_case_id, template_id, template_version, code, title, setup_completed_at)
     VALUES ('${ids.ws}', '${ids.org}', '${ids.cardA}', '${ids.template}', '1.0.0', 'XX-D1', 'Dossier completo A', now()),
            ('${ids.ws}', '${ids.org}', '${ids.cardA}', '${ids.template}', '1.0.0', 'XX-D2', 'Dossier incompleto A', NULL);`,
);
const stopped = (label) => {
  const result = exec("psql", applyArgs(DB.dups, file0020));
  const error = result.stderr.split("\n").find((line) => line.startsWith("psql:") && line.includes("ERROR:")) ?? result.stderr.trim();
  check(`${label}: 0020 stops with the message of DESIGN §10.4`, result.status !== 0 && result.stderr.includes(DOSSIER_DUPLICATES_MESSAGE), error.replace(/^.*ERROR:\s*/, ""));
  const left = psql(DB.dups, `SELECT (SELECT count(*) FROM information_schema.columns WHERE table_name = 'use_cases' AND column_name = 'origin') || '/' || coalesce(to_regclass('public.use_case_events')::text, 'none')`);
  check(`${label}: nothing of 0020 is left (single transaction)`, left === "0/none", left);
};
stopped("complete + incomplete dossier on one card");
// Then production gets the 0018 of C11b over the duplicate: it skips the index with a NOTICE
// (UC_UNIQUE_DOSSIER_INDEX_DDL in src/lib/uc/ddl.ts), and 0020 still stops.
const rerun0018 = exec("psql", applyArgs(DB.dups, file("0018")));
check(
  "0018 again over the duplicate passes and creates no unique index",
  rerun0018.status === 0 && psql(DB.dups, `SELECT to_regclass('public.uc_cases_portfolio_use_case_unique_idx') IS NULL`) === "t",
  rerun0018.status === 0 ? "" : rerun0018.stderr.trim().split("\n").pop(),
);
if (readFileSync(file("0018"), "utf8").includes("uc_cases_portfolio_use_case_unique_idx")) {
  const notice = "uc_cases: piu dossier sulla stessa scheda (righe complete e incomplete). Indice uc_cases_portfolio_use_case_unique_idx non creato: esegui use-case-admin dossier-dups.";
  check("…with the NOTICE that names use-case-admin dossier-dups", rerun0018.stderr.includes(notice), rerun0018.stderr.trim().split("\n").pop());
} else {
  console.log("SKIP …with the NOTICE that names use-case-admin dossier-dups (this 0018 predates C11b: no unique index in it)");
}
stopped("0018 again over the duplicate");
psql(DB.dups, `DELETE FROM uc_cases WHERE code = 'XX-D2'`);
psql(
  DB.dups,
  `INSERT INTO uc_cases (workspace_id, organization_id, portfolio_use_case_id, template_id, template_version, code, title, setup_completed_at)
   VALUES ('${ids.ws}', '${ids.org}', '${ids.cardB}', '${ids.template}', '1.0.0', 'XX-D3', 'Dossier completo B', now()),
          ('${ids.ws}', '${ids.org}', '${ids.cardB}', '${ids.template}', '1.0.0', 'XX-D4', 'Altro dossier completo B', now());`,
);
stopped("two complete dossiers on one card");
psql(DB.dups, `DELETE FROM uc_cases WHERE code = 'XX-D4'`);
const passed = exec("psql", applyArgs(DB.dups, file0020));
check("without duplicates 0020 passes", passed.status === 0, passed.status === 0 ? "" : passed.stderr.trim().split("\n").pop());
check("…and creates the unique dossier index", psql(DB.dups, `SELECT to_regclass('public.uc_cases_portfolio_use_case_unique_idx') IS NOT NULL`) === "t");
const dupAfter = tryPsql(
  DB.dups,
  `INSERT INTO uc_cases (workspace_id, organization_id, portfolio_use_case_id, template_id, template_version, code, title)
   VALUES ('${ids.ws}', '${ids.org}', '${ids.cardA}', '${ids.template}', '1.0.0', 'XX-D5', 'Secondo dossier A')`,
);
check("…which then refuses a second dossier on the same card, even incomplete", !dupAfter.ok && dupAfter.err.includes("uc_cases_portfolio_use_case_unique_idx"), dupAfter.err.split("\n")[0]);

// 4. Without the uc tables.
freshDatabase(DB.nouc, [...upTo("0017"), migrations.find((n) => n.startsWith("0019"))]);
const noUc1 = exec("psql", applyArgs(DB.nouc, file0020));
const noUc2 = exec("psql", applyArgs(DB.nouc, file0020));
check(
  "without uc tables 0020 passes twice",
  noUc1.status === 0 && noUc2.status === 0,
  noUc1.status === 0 && noUc2.status === 0 ? "" : `${noUc1.stderr}${noUc2.stderr}`.trim().split("\n").pop(),
);
check(
  "…creates no uc table and no unique index",
  psql(DB.nouc, `SELECT to_regclass('public.uc_cases') IS NULL AND to_regclass('public.uc_cases_portfolio_use_case_unique_idx') IS NULL`) === "t",
);
check("…and the hub probe is true", hubProbe(DB.nouc));

// 5. Art. 15.4: no index per person, no free text in the history.
for (const db of [DB.mig, DB.heal]) {
  const personIndexes = psql(
    db,
    `SELECT coalesce(string_agg(indexname, ', '), '') FROM pg_indexes
      WHERE schemaname = 'public' AND tablename IN ('use_cases', 'use_case_events')
        AND (indexdef ~ 'proposed_by' OR indexdef ~ 'actor_user_id')`,
  );
  check(`${db}: no index on use_cases.proposed_by nor on use_case_events.actor_user_id`, personIndexes === "", personIndexes);
  const freeText = psql(
    db,
    `SELECT coalesce(string_agg(column_name || ':' || udt_name || coalesce('(' || character_maximum_length || ')', ''), ', ' ORDER BY column_name), '')
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'use_case_events'
        AND (udt_name IN ('text', 'json', 'jsonb', 'bytea') OR (udt_name = 'varchar' AND character_maximum_length > 40)
             OR (udt_name = '_text' AND column_name <> 'fields'))`,
  );
  const columnCount = psql(db, `SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'use_case_events'`);
  check(`${db}: no free-text column in use_case_events (11 columns)`, freeText === "" && columnCount === "11", freeText || `${columnCount} columns`);
  const fieldsCheck = tryPsql(
    db,
    `INSERT INTO use_case_events (workspace_id, use_case_id, actor_kind, channel, action, fields)
     VALUES ('${ids.ws}', '${ids.ucOld}', 'sistema', 'script', 'modificato', ARRAY['Testo libero di una persona'])`,
  );
  check(`${db}: the fields CHECK refuses a value outside the list`, !fieldsCheck.ok && fieldsCheck.err.includes("use_case_events_fields_check"), fieldsCheck.err.split("\n")[0]);
  const needsRow = tryPsql(
    db,
    `INSERT INTO use_case_events (workspace_id, use_case_id, actor_kind, channel, action, fields, phase_after)
     VALUES ('${ids.ws}', '${ids.ucOld}', 'sistema', 'script', 'modificato', ARRAY['cosa_serve'], 'aggiunta.requisito.da_chiedere') RETURNING 1`,
  );
  check(`${db}: the fields CHECK accepts cosa_serve (0023)`, needsRow.ok, needsRow.err.split("\n")[0]);
  psql(db, `DELETE FROM use_case_events WHERE use_case_id = '${ids.ucOld}' AND 'cosa_serve' = ANY(fields)`);
}

// 6. The code before 0020 still writes.
for (const [db, label] of [[DB.mig, "mig"], [DB.heal, "heal"]]) oldShapeWrites(db, label);

// 10. The 0022 trigger and tables, on the migrated and on the healed database.
for (const [db, label] of [[DB.mig, "mig"], [DB.heal, "heal"]]) valueWrites(db, label);

// 7. Probe: production after 0019 (catch-up done, no hub objects) must self-heal.
check("a fully healed database: ensureDbSchema() runs only the probe", (() => {
  const again = ensureDbSchemaOn(DB.heal);
  return again.ok && again.calls === 1;
})());
freshDatabase(DB.probe, upTo("0019"));
const caughtUp = ensureDbSchemaOn(DB.probe);
check("0000→0019 + ensureDbSchema(): catch-up done", caughtUp.ok && hubProbe(DB.probe), caughtUp.error);
// Remove what this branch adds, nothing else: the database is now what production looks
// like after 0019 with the self-heal of ENSURE_VERSION 14.
psql(
  DB.probe,
  `DROP TRIGGER use_cases_bump_version ON use_cases;
   DROP TRIGGER use_cases_created_event ON use_cases;
   DROP FUNCTION use_cases_bump_version();
   DROP FUNCTION use_cases_created_event();
   DROP TABLE use_case_events;
   DROP TABLE use_case_mcp_requests;
   ALTER TABLE use_cases DROP CONSTRAINT use_cases_cost_one_source_check,
     DROP COLUMN origin, DROP COLUMN ai_lab, DROP COLUMN target_quarter, DROP COLUMN review_by, DROP COLUMN value_eur_year,
     DROP COLUMN cost_eur_once, DROP COLUMN cost_band, DROP COLUMN ai_suggestion, DROP COLUMN version;
   ALTER TABLE workspace_integration_tokens DROP COLUMN owner_user_id;`,
);
check("0019 database as in production: connector probe true, hub probe false", connectorProbe(DB.probe) && !hubProbe(DB.probe));
const healedAt0019 = ensureDbSchemaOn(DB.probe);
check(
  "on it ensureDbSchema() does not stop at the probe: the self-heal runs",
  healedAt0019.ok && healedAt0019.calls > 1,
  healedAt0019.error || `${healedAt0019.calls} execute calls`,
);
const hubBack = hubProbe(DB.probe);
check("…and the hub objects are there (hub probe true)", hubBack);
if (hubBack) {
  const probeHub = hubObjects(DB.probe);
  check(
    "…equal to those of 0020",
    probeHub.tables === migHub.tables &&
      probeHub.useCases.join("\n") === migHub.useCases.join("\n") &&
      probeHub.tokens.join("\n") === migHub.tokens.join("\n") &&
      probeHub.functions === migHub.functions,
  );
  const kept = psql(DB.probe, `SELECT string_agg(origin || '/' || version, ',' ORDER BY id) FROM use_cases WHERE workspace_id = '${ids.ws}'`);
  check("…with the existing rows kept (origin adoption, version 1)", kept === "adoption/1,adoption/1", kept);
}
check("no extension created by 0020", !readFileSync(file0020, "utf8").match(/CREATE\s+EXTENSION/i));

// 8. Without 0019: 0020 stops before creating anything.
freshDatabase(DB.no19, upTo("0017"));
const without0019 = exec("psql", applyArgs(DB.no19, file0020));
check(
  "0000→0017 without 0019: 0020 stops with its message",
  without0019.status !== 0 && without0019.stderr.includes(MISSING_0019_MESSAGE),
  (without0019.stderr.split("\n").find((line) => line.includes("ERROR:")) ?? without0019.stderr.trim()).replace(/^.*ERROR:\s*/, ""),
);
const leftNo19 = psql(
  DB.no19,
  `SELECT (SELECT count(*) FROM information_schema.columns WHERE table_name = 'use_cases' AND column_name IN ('origin', 'version'))
       || '/' || coalesce(to_regprocedure('public.use_cases_bump_version()')::text, 'none') || '/' || coalesce(to_regclass('public.use_case_events')::text, 'none')`,
);
check("…and leaves nothing of 0020 behind (single transaction)", leftNo19 === "0/none/none", leftNo19);
const stillWrites = tryPsql(DB.no19, `UPDATE use_cases SET title = 'Titolo di prova cambiato' WHERE id = '${ids.ucOld}'`);
check("…so use_cases still accepts updates", stillWrites.ok, stillWrites.err.split("\n")[0]);

// 11. Production before 0022: 0018, 0019, 0020 and the self-heal of ENSURE_VERSION 15, with
//     rows of the 0020 era. The first ensureDbSchema() heals it completely; then remove only
//     what 0022 adds, which leaves the database as production is today.
freshDatabase(DB.prod, upTo("0020"));
const prodCatchUp = ensureDbSchemaOn(DB.prod);
check("0000→0020 + ensureDbSchema(): catch-up done", prodCatchUp.ok && hubProbe(DB.prod) && valueProbe(DB.prod), prodCatchUp.error);
dropReferents(DB.prod);
psql(
  DB.prod,
  `DROP TRIGGER use_cases_value_model_version ON use_cases;
   DROP FUNCTION use_cases_value_model_version();
   DROP TABLE use_case_need_links;
   DROP TABLE use_case_needs;
   ALTER TABLE use_cases DROP COLUMN value_model;`,
);
psql(
  DB.prod,
  `INSERT INTO use_cases (workspace_id, title, status, source, target_quarter, value_eur_year, cost_band, origin)
     VALUES ('${ids.ws}', 'Scheda approvata della 0020', 'accepted', 'manual', '2027-Q1', 24000, 2, 'transformation');
   UPDATE use_cases SET title = 'Scheda approvata della 0020, corretta' WHERE title = 'Scheda approvata della 0020';
   INSERT INTO use_case_events (workspace_id, use_case_id, actor_kind, channel, action, fields)
     SELECT workspace_id, id, 'sistema', 'script', 'valutato', ARRAY['valore', 'costo'] FROM use_cases WHERE workspace_id = '${ids.ws}';`,
);
check("production before 0022: hub probe true, value probe false", hubProbe(DB.prod) && !valueProbe(DB.prod));
const rowsOf = (db) =>
  psql(
    db,
    `SELECT string_agg(id || ':' || version || ':' || coalesce(target_quarter, '-') || ':' || coalesce(value_eur_year::text, '-'), ',' ORDER BY id) || ' events ' || (SELECT count(*) FROM use_case_events)
       FROM use_cases WHERE workspace_id = '${ids.ws}'`,
  );
const prodRows = rowsOf(DB.prod);
const prodHeal = ensureDbSchemaOn(DB.prod);
check("on it ensureDbSchema() does not stop at the probe: the 0022 self-heal runs", prodHeal.ok && prodHeal.calls > 1, prodHeal.error || `${prodHeal.calls} execute calls`);
check("…the value probe is true", valueProbe(DB.prod));
const prodValue = valueObjects(DB.prod);
check("…the 0022 objects equal those of the migration", sameValueObjects(migValue, prodValue), valueDiff(migValue, prodValue));
check("…every row is kept, versions and history included", rowsOf(DB.prod) === prodRows, `${prodRows} → ${rowsOf(DB.prod)}`);
check("…no row gets a value model", psql(DB.prod, `SELECT count(*) FROM use_cases WHERE value_model IS NOT NULL`) === "0");
const prodAgain = ensureDbSchemaOn(DB.prod);
check("a second ensureDbSchema() runs only the probe", prodAgain.ok && prodAgain.calls === 1, prodAgain.error || `${prodAgain.calls} execute calls`);
const healedDump = dump(DB.prod);
applyFile(DB.prod, file0022);
applyFile(DB.prod, file0022);
check("0022 applied twice on the healed database: identical schema dump", dump(DB.prod) === healedDump, firstDiff(healedDump, dump(DB.prod)));
valueWrites(DB.prod, "prod");
oldShapeWrites(DB.prod, "prod");

// 12. Without 0020 (0000→0019): 0022 stops before creating anything.
freshDatabase(DB.no20, upTo("0019"));
const without0020 = exec("psql", applyArgs(DB.no20, file0022));
check(
  "0000→0019 without 0020: 0022 stops with its message",
  without0020.status !== 0 && without0020.stderr.includes(MISSING_0020_MESSAGE),
  (without0020.stderr.split("\n").find((line) => line.includes("ERROR:")) ?? without0020.stderr.trim()).replace(/^.*ERROR:\s*/, ""),
);
const leftNo20 = psql(
  DB.no20,
  `SELECT (SELECT count(*) FROM information_schema.columns WHERE table_name = 'use_cases' AND column_name = 'value_model')
       || '/' || coalesce(to_regprocedure('public.use_cases_value_model_version()')::text, 'none') || '/' || coalesce(to_regclass('public.use_case_needs')::text, 'none')`,
);
check("…and leaves nothing of 0022 behind (single transaction)", leftNo20 === "0/none/none", leftNo20);

// 14. Production today: 0000→0022 and the self-heal of ENSURE_VERSION 16, with rows. The first
//     ensureDbSchema() heals it completely (0023 included); then the CHECK goes back to the list
//     of 0020, which leaves the database as production is today.
function productionAt0022(db) {
  freshDatabase(db, upTo("0022"));
  const caughtUp = ensureDbSchemaOn(db);
  check(`${db}: 0000→0022 + ensureDbSchema(): catch-up done`, caughtUp.ok && hubProbe(db) && valueProbe(db) && historyProbe(db), caughtUp.error);
  dropReferents(db);
  psql(
    db,
    `ALTER TABLE use_case_events DROP CONSTRAINT use_case_events_fields_check;
     ALTER TABLE use_case_events ADD CONSTRAINT use_case_events_fields_check CHECK (fields <@ ${textArray(USE_CASE_EVENT_FIELDS)});`,
  );
  psql(
    db,
    `INSERT INTO use_cases (workspace_id, title, status, source, target_quarter, value_eur_year, cost_band, origin, value_model)
       VALUES ('${ids.ws}', 'Scheda approvata della 0022', 'accepted', 'manual', '2027-Q1', 24000, 2, 'transformation', '{"v": 1, "primary": "tempo"}'::jsonb);
     UPDATE use_cases SET title = 'Scheda approvata della 0022, corretta' WHERE title = 'Scheda approvata della 0022';
     INSERT INTO use_case_events (workspace_id, use_case_id, actor_kind, channel, action, fields)
       SELECT workspace_id, id, 'sistema', 'script', 'modificato', ${textArray(USE_CASE_EVENT_FIELDS)} FROM use_cases WHERE workspace_id = '${ids.ws}';
     INSERT INTO use_case_events (workspace_id, use_case_id, actor_user_id, actor_kind, channel, action, fields, phase_before, phase_after)
       SELECT workspace_id, id, '${ids.user}', 'persona', 'pagina', 'decisione', '{}', 'da_valutare.nuova', 'approvato.trimestre' FROM use_cases WHERE workspace_id = '${ids.ws}';
     WITH need AS (
       INSERT INTO use_case_needs (workspace_id, type, kind, title, status, import_key)
       VALUES ('${ids.ws}', 'requisito', 'accesso', 'Accesso al gestionale di prova', 'chiesta', 'prod-0022') RETURNING id
     )
     INSERT INTO use_case_need_links (need_id, use_case_id) SELECT need.id, u.id FROM need, use_cases u WHERE u.workspace_id = '${ids.ws}';`,
  );
  check(`${db}: production today: hub and value probes true, history probe false, the CHECK of 0020`, hubProbe(db) && valueProbe(db) && !historyProbe(db) && fieldsCheckOf(db) === check0020, fieldsCheckOf(db));
}
/** A write of the needs service after 0023, and the free text still refused. */
function needsHistoryWrites(db) {
  const accepted = tryPsql(
    db,
    `INSERT INTO use_case_events (workspace_id, use_case_id, actor_user_id, actor_kind, channel, action, fields, phase_after)
     SELECT workspace_id, id, '${ids.user}', 'persona', 'pagina', 'modificato', ARRAY['cosa_serve'], 'aggiunta.requisito.da_chiedere' FROM use_cases WHERE id = '${ids.ucOld}'`,
  );
  check(`${db}: a «Cosa serve» row is accepted`, accepted.ok, accepted.err.split("\n")[0]);
  const refused = tryPsql(db, `INSERT INTO use_case_events (workspace_id, use_case_id, actor_kind, channel, action, fields) VALUES ('${ids.ws}', '${ids.ucOld}', 'sistema', 'script', 'modificato', ARRAY['cosa_serve', 'Accesso al gestionale'])`);
  check(`${db}: free text is still refused`, !refused.ok && refused.err.includes("use_case_events_fields_check"), refused.err.split("\n")[0]);
}

// 14a. Through the self-heal.
productionAt0022(DB.prod23);
const prod23Rows = snapshotOf(DB.prod23);
const prod23Heal = ensureDbSchemaOn(DB.prod23);
check("production today: ensureDbSchema() does not stop at the probe, the 0023 self-heal runs", prod23Heal.ok && prod23Heal.calls > 1, prod23Heal.error || `${prod23Heal.calls} execute calls`);
check("…the history probe is true", historyProbe(DB.prod23));
check("…the CHECK equals the one of the migrations (0023, then 0024)", fieldsCheckOf(DB.prod23) === check0024, fieldsCheckOf(DB.prod23));
check("…every use case, history row, need and link is kept", snapshotOf(DB.prod23) === prod23Rows, `${prod23Rows} → ${snapshotOf(DB.prod23)}`);
const prod23Again = ensureDbSchemaOn(DB.prod23);
check("a second ensureDbSchema() runs only the probe", prod23Again.ok && prod23Again.calls === 1, prod23Again.error || `${prod23Again.calls} execute calls`);
const prod23Dump = dump(DB.prod23);
applyFile(DB.prod23, file0023);
applyFile(DB.prod23, file0023);
check("0023 applied twice on the healed database: identical schema dump", dump(DB.prod23) === prod23Dump, firstDiff(prod23Dump, dump(DB.prod23)));
needsHistoryWrites(DB.prod23);
valueWrites(DB.prod23, "prod23");
oldShapeWrites(DB.prod23, "prod23");

// 14b. Through the SQL file.
productionAt0022(DB.prod23f);
const prod23fRows = snapshotOf(DB.prod23f);
applyFile(DB.prod23f, file0023);
const prod23fFirst = dump(DB.prod23f);
applyFile(DB.prod23f, file0023);
check("production today, 0023 applied twice through the file: identical schema dump", dump(DB.prod23f) === prod23fFirst, firstDiff(prod23fFirst, dump(DB.prod23f)));
check("…the history probe is true and the CHECK equals the one of the migration", historyProbe(DB.prod23f) && fieldsCheckOf(DB.prod23f) === check0023, fieldsCheckOf(DB.prod23f));
check("…every use case, history row, need and link is kept", snapshotOf(DB.prod23f) === prod23fRows, `${prod23fRows} → ${snapshotOf(DB.prod23f)}`);
applyFile(DB.prod23f, file0024);
const prod23fProbe = ensureDbSchemaOn(DB.prod23f);
check("…then (with 0024 by hand too) ensureDbSchema() runs only the probe", prod23fProbe.ok && prod23fProbe.calls === 1, prod23fProbe.error || `${prod23fProbe.calls} execute calls`);
needsHistoryWrites(DB.prod23f);

// 15. Never narrows, never fails on rows.
freshDatabase(DB.narrow, upTo("0022"));
applyFile(DB.narrow, file0023);
const replaceCheck = (expression) =>
  psql(DB.narrow, `ALTER TABLE use_case_events DROP CONSTRAINT IF EXISTS use_case_events_fields_check;${expression ? ` ALTER TABLE use_case_events ADD CONSTRAINT use_case_events_fields_check CHECK (${expression}) NOT VALID;` : ""}`);
const wider = [...USE_CASE_EVENT_FIELDS_0023, "campo_futuro"];
replaceCheck(`fields <@ ${textArray(wider)}`);
psql(DB.narrow, `ALTER TABLE use_case_events VALIDATE CONSTRAINT use_case_events_fields_check;
  INSERT INTO use_case_events (workspace_id, use_case_id, actor_kind, channel, action, fields) VALUES ('${ids.ws}', '${ids.ucOld}', 'sistema', 'script', 'modificato', ARRAY['campo_futuro']);`);
const widerApplied = exec("psql", applyArgs(DB.narrow, file0023));
check("a CHECK that already allows more names: 0023 passes and leaves it as it is", widerApplied.status === 0 && fieldsCheckOf(DB.narrow) === `${checkDefOf(wider)}|true`, widerApplied.stderr.trim() || fieldsCheckOf(DB.narrow));
replaceCheck(`fields <@ ${textArray(["titolo", "campo_futuro", "problema"])}`);
const extraApplied = exec("psql", applyArgs(DB.narrow, file0023));
check(
  "a CHECK without cosa_serve but with an extra name: 0023 keeps the extra name after the list, validated",
  extraApplied.status === 0 && fieldsCheckOf(DB.narrow) === `${checkDefOf(wider)}|true` && historyProbe(DB.narrow),
  extraApplied.stderr.trim() || fieldsCheckOf(DB.narrow),
);
replaceCheck(null);
psql(DB.narrow, `INSERT INTO use_case_events (workspace_id, use_case_id, actor_kind, channel, action, fields) VALUES ('${ids.ws}', '${ids.ucOld}', 'sistema', 'script', 'modificato', ARRAY['valore_fuori_elenco'])`);
const narrowRows = snapshotOf(DB.narrow);
const outside = exec("psql", applyArgs(DB.narrow, file0023));
check(
  "no CHECK and rows outside the list: 0023 passes with its WARNING and leaves the CHECK NOT VALID",
  outside.status === 0 && outside.stderr.includes(FIELDS_NOT_VALIDATED_WARNING) && fieldsCheckOf(DB.narrow) === `${checkDefOf(USE_CASE_EVENT_FIELDS_0023)} NOT VALID|false`,
  `${outside.status} ${fieldsCheckOf(DB.narrow)} ${outside.stderr.trim().split("\n").pop()}`,
);
check("…keeps every row", snapshotOf(DB.narrow) === narrowRows);
check("…the history probe is true (no self-heal at every start)", historyProbe(DB.narrow));
const stillRefused = tryPsql(DB.narrow, `INSERT INTO use_case_events (workspace_id, use_case_id, actor_kind, channel, action, fields) VALUES ('${ids.ws}', '${ids.ucOld}', 'sistema', 'script', 'modificato', ARRAY['Testo libero di una persona'])`);
check("…and still refuses a new row outside the list", !stillRefused.ok && stillRefused.err.includes("use_case_events_fields_check"), stillRefused.err.split("\n")[0]);
psql(DB.narrow, `DELETE FROM use_case_events WHERE NOT (fields <@ ${textArray(USE_CASE_EVENT_FIELDS_0023)})`);
applyFile(DB.narrow, file0023);
check("once the rows are gone, 0023 validates the CHECK", fieldsCheckOf(DB.narrow) === `${checkDefOf(USE_CASE_EVENT_FIELDS_0023)}|true`, fieldsCheckOf(DB.narrow));

// 16. Without 0020 (0000→0019, the database of case 12): 0023 stops with its message.
const without0020History = exec("psql", applyArgs(DB.no20, file0023));
check(
  "0000→0019 without 0020: 0023 stops with its message",
  without0020History.status !== 0 && without0020History.stderr.includes(MISSING_EVENTS_MESSAGE),
  (without0020History.stderr.split("\n").find((line) => line.includes("ERROR:")) ?? without0020History.stderr.trim()).replace(/^.*ERROR:\s*/, ""),
);

// 17. Locks: never queued behind a long transaction, never together with the self-heal.
const HOLDER = `hub_check_holder_${runTag}`;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
/**
 * A session of this run on `db` that runs `sql` (it takes a lock, then sleeps) in the background.
 * Resolves once the lock is granted; `release()` ends that session (only it: its application_name
 * and this run's database) and waits until it is gone.
 */
async function holdLock(db, sql, granted) {
  const child = spawn(bin("psql"), [...pinned, "-d", db, "--no-psqlrc", "-q", "-c", sql], { env: { ...env, PGAPPNAME: HOLDER }, stdio: "ignore" });
  const exited = new Promise((done) => child.once("exit", done));
  const mine = `a.datname = '${db}' AND a.application_name = '${HOLDER}'`;
  for (let i = 0; i < 100 && psql(db, `SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE ${mine} AND l.granted AND ${granted}`) === "0"; i++) await sleep(100);
  return {
    held: psql(db, `SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE ${mine} AND l.granted AND ${granted}`) !== "0",
    async release() {
      psql(db, `SELECT count(pg_terminate_backend(a.pid)) FROM pg_stat_activity a WHERE ${mine}`);
      await exited;
    },
  };
}
/** 0023 through the file, timed. */
function timedApply(db) {
  const start = Date.now();
  const result = exec("psql", applyArgs(db, file0023));
  return { ...result, ms: Date.now() - start };
}
const lockTimedOut = (text) => /canceling statement due to lock timeout/.test(text);
productionAt0022(DB.locks);
const locksRows = snapshotOf(DB.locks);
const tableLock = await holdLock(
  DB.locks,
  "BEGIN; SELECT count(*) FROM use_case_events; SELECT pg_sleep(30); COMMIT;",
  "l.locktype = 'relation' AND l.relation = 'public.use_case_events'::regclass",
);
check("a long transaction reads use_case_events (ACCESS SHARE held)", tableLock.held);
const behindTable = timedApply(DB.locks);
check(
  "behind it 0023 does not wait: it stops within its lock_timeout with «lock timeout»",
  behindTable.status !== 0 && lockTimedOut(behindTable.stderr) && behindTable.ms >= 2500 && behindTable.ms < 10000,
  `${behindTable.status} in ${behindTable.ms} ms: ${behindTable.stderr.trim().split("\n").pop()}`,
);
check("…and changes nothing (the CHECK of 0020, every row)", fieldsCheckOf(DB.locks) === check0020 && snapshotOf(DB.locks) === locksRows, fieldsCheckOf(DB.locks));
const healStart = Date.now();
const healBehindTable = ensureDbSchemaOn(DB.locks);
const healMs = Date.now() - healStart;
check(
  "behind it the self-heal stops too, with «lock timeout», and changes nothing",
  !healBehindTable.ok && lockTimedOut(healBehindTable.stderr) && healMs < 20000 && fieldsCheckOf(DB.locks) === check0020 && snapshotOf(DB.locks) === locksRows,
  `${healBehindTable.ok ? "ok" : (healBehindTable.stderr.match(/canceling statement[^\n"]*/)?.[0] ?? healBehindTable.error)} in ${healMs} ms`,
);
await tableLock.release();
const advisoryLock = await holdLock(
  DB.locks,
  `SELECT pg_advisory_lock(hashtext('unbundle:use-case-history-ddl')); SELECT pg_sleep(30);`,
  "l.locktype = 'advisory'",
);
check("a session holds the self-heal's advisory lock", advisoryLock.held);
const behindAdvisory = timedApply(DB.locks);
check(
  "the file takes the same advisory lock: it waits, then stops within its lock_timeout",
  behindAdvisory.status !== 0 && lockTimedOut(behindAdvisory.stderr) && behindAdvisory.ms >= 2500 && behindAdvisory.ms < 10000,
  `${behindAdvisory.status} in ${behindAdvisory.ms} ms: ${behindAdvisory.stderr.trim().split("\n").pop()}`,
);
check("…and changes nothing", fieldsCheckOf(DB.locks) === check0020 && snapshotOf(DB.locks) === locksRows, fieldsCheckOf(DB.locks));
await advisoryLock.release();
const afterLocks = timedApply(DB.locks);
check("with both sessions gone 0023 passes: the CHECK of the migration, every row kept", afterLocks.status === 0 && fieldsCheckOf(DB.locks) === check0023 && snapshotOf(DB.locks) === locksRows, afterLocks.stderr.trim() || fieldsCheckOf(DB.locks));
// The file without --single-transaction, then SHOW in the same session: the limit ended with the DO block.
const sameSession = exec("psql", [...pinned, "-d", DB.locks, "--no-psqlrc", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-f", file0023, "-c", "SHOW lock_timeout"]);
check("lock_timeout ends with 0023's transaction: the session keeps its own", sameSession.status === 0 && sameSession.stdout.trim() === "0", sameSession.stderr.trim() || sameSession.stdout.trim());

// 19. Production today for 0024: 0000→0023 healed by the self-heal of ENSURE_VERSION 17.
function productionAt0023(db) {
  freshDatabase(db, upTo("0023"));
  const caughtUp = ensureDbSchemaOn(db);
  check(`${db}: 0000→0023 + ensureDbSchema(): catch-up done`, caughtUp.ok && historyProbe(db) && referentsProbe(db), caughtUp.error);
  dropReferents(db);
  psql(
    db,
    `INSERT INTO use_cases (id, workspace_id, title, status, source, origin) VALUES ('${ids.cardA}', '${ids.ws}', 'Scheda completa della 0023', 'accepted', 'manual', 'transformation'),
       ('${ids.cardB}', '${ids.ws}', 'Scheda in corso della 0023', 'accepted', 'manual', 'transformation');
     WITH n AS (
       INSERT INTO use_case_needs (workspace_id, type, kind, title, status, owner_side, import_key)
       VALUES ('${ids.ws}', 'requisito', 'dato', 'Quante fatture', 'validata', 'cliente', 'p24-a1'), ('${ids.ws}', 'requisito', 'dato', 'Quali programmi', 'non_applicabile', 'cliente', 'p24-a2')
       RETURNING id
     )
     INSERT INTO use_case_need_links (need_id, use_case_id) SELECT n.id, '${ids.cardA}' FROM n;
     WITH n AS (
       INSERT INTO use_case_needs (workspace_id, type, kind, title, status, owner_side, import_key)
       VALUES ('${ids.ws}', 'requisito', 'dato', 'Quanto tempo', 'chiesta', 'cliente', 'p24-b1') RETURNING id
     )
     INSERT INTO use_case_need_links (need_id, use_case_id) SELECT n.id, '${ids.cardB}' FROM n;
     INSERT INTO use_case_events (workspace_id, use_case_id, actor_kind, channel, action, fields, phase_after)
       VALUES ('${ids.ws}', '${ids.cardA}', 'sistema', 'script', 'modificato', ARRAY['cosa_serve'], 'aggiunta.requisito.da_chiedere');`,
  );
  check(`${db}: production today for 0024: history probe true, referents probe false, the CHECK of 0023`, historyProbe(db) && !referentsProbe(db) && fieldsCheckOf(db) === check0023, fieldsCheckOf(db));
}
const completeSince = (db) =>
  psql(db, `SELECT coalesce(string_agg(use_case_id || ':' || (complete_since IS NOT NULL), ',' ORDER BY use_case_id), '') FROM use_case_info_state WHERE use_case_id IN ('${ids.cardA}', '${ids.cardB}')`);

// 19a. Through the self-heal.
productionAt0023(DB.prod24);
const prod24Rows = snapshotOf(DB.prod24);
const prod24Heal = ensureDbSchemaOn(DB.prod24);
check("production today: ensureDbSchema() does not stop at the probe, the 0024 self-heal runs", prod24Heal.ok && prod24Heal.calls > 1, prod24Heal.error || `${prod24Heal.calls} execute calls`);
check("…the referents probe is true and the CHECK equals the one of the migration", referentsProbe(DB.prod24) && fieldsCheckOf(DB.prod24) === check0024, fieldsCheckOf(DB.prod24));
check("…the 0024 tables equal those of the migration", dump(DB.prod24, [...REFERENTS_TABLES]) === dump(DB.mig, [...REFERENTS_TABLES]), firstDiff(dump(DB.mig, [...REFERENTS_TABLES]), dump(DB.prod24, [...REFERENTS_TABLES])));
check("…every use case, history row, need and link is kept", snapshotOf(DB.prod24) === prod24Rows, `${prod24Rows} → ${snapshotOf(DB.prod24)}`);
check("…a card whose client-side needs are all done is marked complete; the other is not", completeSince(DB.prod24) === `${ids.cardA}:true`, completeSince(DB.prod24));
const prod24Again = ensureDbSchemaOn(DB.prod24);
check("a second ensureDbSchema() runs only the probe", prod24Again.ok && prod24Again.calls === 1, prod24Again.error || `${prod24Again.calls} execute calls`);
const prod24Dump = dump(DB.prod24);
applyFile(DB.prod24, file0024);
applyFile(DB.prod24, file0024);
check("0024 applied twice on the healed database: identical schema dump", dump(DB.prod24) === prod24Dump, firstDiff(prod24Dump, dump(DB.prod24)));
needsHistoryWrites(DB.prod24);

// 19b. Through the SQL file, then the self-heal.
productionAt0023(DB.prod24f);
const prod24fRows = snapshotOf(DB.prod24f);
applyFile(DB.prod24f, file0024);
const prod24fFirst = dump(DB.prod24f);
check("production today, 0024 through the file: the referents probe is true, every row kept", referentsProbe(DB.prod24f) && snapshotOf(DB.prod24f) === prod24fRows, `${prod24fRows} → ${snapshotOf(DB.prod24f)}`);
check("…the card complete before 0024 is marked complete", completeSince(DB.prod24f) === `${ids.cardA}:true`, completeSince(DB.prod24f));
const prod24fProbe = ensureDbSchemaOn(DB.prod24f);
check("…then ensureDbSchema() runs only the probe", prod24fProbe.ok && prod24fProbe.calls === 1, prod24fProbe.error || `${prod24fProbe.calls} execute calls`);
applyFile(DB.prod24f, file0024);
check("…and the file again changes nothing", dump(DB.prod24f) === prod24fFirst, firstDiff(prod24fFirst, dump(DB.prod24f)));

// 20. TimeZone, as Neon: UTC on every scratch database of this run.
for (const db of Object.values(DB)) {
  if (psql("postgres", `SELECT count(*) FROM pg_database WHERE datname = '${db}'`) !== "1") continue;
  const zone = psql(db, "SHOW TimeZone");
  check(`${db}: SHOW TimeZone is UTC`, ["UTC", "GMT", "Etc/UTC"].includes(zone), zone);
}

dropScratchDatabases();
console.log(failures.length === 0 ? "All hub schema checks passed." : `${failures.length} check(s) failed.`);
process.exit(failures.length === 0 ? 0 : 1);
