import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";

// Schema della 0042 sul database di prova dell'hub («Le evals dalla CI», rilascio 8.2b, RILASCIO-8.2b-SPEC.md §2.8, §3.2):
// il file due volte e il self-heal due volte non cambiano niente; la sonda falsa, poi vera; un self-heal fallito non ferma
// l'app e da un'anteprima non parte; ogni CHECK rifiuta la riga sbagliata; il codice di prima scrive le evals con la
// fonte `cli`; le chiavi si cancellano con il loro workspace e un'esecuzione perde la chiave cancellata, non la fonte.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su 127.0.0.1).
//   Dati sintetici, creati e cancellati qui.
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
  if ((globalThis.fetch as { name?: string }).name !== "localNeonFetch") {
    throw new Error("Preload scripts/uc-test/local-neon.cjs to reach the local test database");
  }
}
const opts = { skip: !enabled };

type Row = Record<string, unknown>;
let q: (text: string, params?: unknown[]) => Promise<Row[]>;
let ddl: typeof import("./use-case-hub-ci-keys-ddl.ts");
let ensure: typeof import("./ensure-schema.ts");

const migration = readFileSync(new URL("../../../drizzle/0042_chiavi_ci.sql", import.meta.url), "utf8");
const migration0036 = readFileSync(new URL("../../../drizzle/0036_evals.sql", import.meta.url), "utf8");
const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), other: randomUUID(), useCase: randomUUID(), user: randomUUID() };
const TABLES = ["use_case_ci_keys", "use_case_eval_runs"];
const HASH = (c: string) => c.repeat(64);
const REPO = "Voltaen/esempio-rosa";
const RUN_URL = "https://github.com/Voltaen/esempio-rosa/actions/runs/12345678901";

async function schemaSnapshot(): Promise<string> {
  const list = TABLES.map((t) => `'${t}'`).join(", ");
  const columns = await q(
    `SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name IN (${list}) ORDER BY table_name, ordinal_position`,
  );
  const constraints = await q(
    `SELECT conrelid::regclass::text AS t, conname, pg_get_constraintdef(oid) AS def, convalidated FROM pg_constraint
     WHERE conrelid IN (${TABLES.map((t) => `'public.${t}'::regclass`).join(", ")}) ORDER BY 1, 2`,
  );
  const indexes = await q(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename IN (${list}) ORDER BY 1`);
  return JSON.stringify({ columns, constraints, indexes });
}

async function probe(): Promise<boolean> {
  return (await q(`SELECT ${ddl.CI_KEYS_PROBE_SQL} AS ok`))[0]?.ok === true;
}

async function rejects(sqlText: string, params: unknown[], constraint: string) {
  await assert.rejects(q(sqlText, params), (error: unknown) => {
    const text = String((error as { message?: unknown })?.message ?? error);
    assert.ok(text.includes(constraint), `atteso ${constraint}, ricevuto: ${text}`);
    return true;
  });
}

const KEY = `INSERT INTO use_case_ci_keys (workspace_id, repo, token_hash, token_prefix, expires_at) VALUES ($1, $2, $3, $4, now() + interval '180 days')`;
const RUN = `INSERT INTO use_case_eval_runs (use_case_id, workspace_id, kind, level, branch, commit_sha, cases_total`;

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Row[]>;
  ensure = await import("./ensure-schema.ts");
  await ensure.ensureDbSchema();
  ddl = await import("./use-case-hub-ci-keys-ddl.ts");
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova 0042', $2)`, [ids.org, `org-0042-${suffix}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Workspace di prova 0042'), ($3, $2, 'Altro workspace 0042')`, [ids.ws, ids.org, ids.other]);
  await q(`INSERT INTO use_cases (id, workspace_id, title, code) VALUES ($1, $2, 'Scheda di prova 0042', 'XX-0042')`, [ids.useCase, ids.ws]);
  await q(`INSERT INTO users (id, email, name) VALUES ($1, $2, 'Persona di prova 0042')`, [ids.user, `prova-0042-${suffix}@example.test`]);
});

after(async () => {
  if (!enabled) return;
  await q(`DELETE FROM workspaces WHERE id IN ($1, $2)`, [ids.ws, ids.other]);
  await q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
  await q(`DELETE FROM users WHERE id = $1`, [ids.user]);
});

test("lo schema della 0042 c'è; il file due volte, il self-heal due volte, la 0036 di nuovo non cambiano niente", opts, async () => {
  const [row] = await q(`SELECT current_database() AS db`);
  assert.equal(row.db, process.env.UC_TEST_PG_DB);
  assert.equal(await probe(), true);
  const first = await schemaSnapshot();
  await q(migration);
  await q(migration);
  assert.equal(await schemaSnapshot(), first, "il file due volte");
  await ensure.runCiKeysDdl();
  await ensure.runCiKeysDdl();
  assert.equal(await schemaSnapshot(), first, "il self-heal due volte");
  await q(migration0036);
  await ensure.runEvalsDdl();
  assert.equal(await schemaSnapshot(), first, "la 0036 di nuovo non tocca le colonne nuove");
  const [source] = await q(`SELECT column_default, is_nullable FROM information_schema.columns WHERE table_name = 'use_case_eval_runs' AND column_name = 'source'`);
  assert.equal(source.is_nullable, "NO");
  assert.match(String(source.column_default), /'cli'/);
});

test("su un database senza la 0042 la sonda è falsa, il DDL la rende vera (in una transazione annullata)", opts, async () => {
  const marker = `prova-0042-annullata-${suffix}`;
  const text = [
    `ALTER TABLE use_case_eval_runs DROP CONSTRAINT use_case_eval_runs_ci_key_fkey, DROP CONSTRAINT use_case_eval_runs_ci_check, DROP CONSTRAINT use_case_eval_runs_ci_url_check, DROP CONSTRAINT use_case_eval_runs_source_check;`,
    `ALTER TABLE use_case_eval_runs DROP COLUMN source, DROP COLUMN ci_key_id, DROP COLUMN ci_run_url;`,
    `DROP TABLE use_case_ci_keys;`,
    `DO $$ BEGIN IF ${ddl.CI_KEYS_PROBE_SQL} THEN RAISE EXCEPTION 'sonda ancora vera'; END IF; END $$;`,
    ...ddl.CI_KEYS_DDL,
    `DO $$ BEGIN IF NOT ${ddl.CI_KEYS_PROBE_SQL} THEN RAISE EXCEPTION 'sonda ancora falsa'; END IF; END $$;`,
    `DO $$ BEGIN RAISE EXCEPTION '${marker}'; END $$;`,
  ].join("\n");
  await assert.rejects(q(text), (error: unknown) => String((error as { message?: unknown })?.message ?? error).includes(marker));
  assert.equal(await probe(), true, "annullata: tutto come prima");
  // Senza la 0036 la 0042 si ferma con il suo messaggio (in una transazione annullata).
  const missing = [`DROP TABLE use_case_eval_results, use_case_eval_runs CASCADE;`, ...ddl.CI_KEYS_DDL].join("\n");
  await assert.rejects(q(missing), (error: unknown) => String((error as { message?: unknown })?.message ?? error).includes(ddl.MISSING_EVALS_FOR_CI_KEYS_MESSAGE));
  assert.equal(await probe(), true);
});

test("un self-heal della 0042 che fallisce non ferma l'app; da un'anteprima non parte", opts, async () => {
  // Un'istanza nuova del modulo per ogni prova: quella di `before()` ha già fatto il suo giro e non lo rifà.
  const fresh = async (tag: string) => (await import(new URL(`./ensure-schema.ts?ci-keys=${tag}-${suffix}`, import.meta.url).href)) as typeof import("./ensure-schema.ts");
  const errors: string[] = [];
  const original = console.error;
  const env = process.env.VERCEL_ENV;
  console.error = (...args: unknown[]) => void errors.push(args.map(String).join(" "));
  try {
    // La sonda falsa: manca un vincolo della 0042.
    await q(`ALTER TABLE use_case_eval_runs DROP CONSTRAINT use_case_eval_runs_ci_url_check`);
    assert.equal(await probe(), false);
    process.env.VERCEL_ENV = "preview";
    await (await fresh("anteprima")).ensureDbSchema();
    assert.equal(await probe(), false, "da un'anteprima la 0042 non parte");
    delete process.env.VERCEL_ENV;
    // Il self-heal non riesce (la colonna dell'indirizzo ha il tipo sbagliato): l'errore resta nel log, l'app va avanti.
    await q(`ALTER TABLE use_case_eval_runs ALTER COLUMN ci_run_url TYPE integer USING NULL`);
    await (await fresh("guasto")).ensureDbSchema();
    assert.equal(await probe(), false);
    assert.ok(errors.some((line) => line.includes("0042 self-heal failed")), "l'errore nel log");
  } finally {
    console.error = original;
    if (env === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = env;
    await q(`ALTER TABLE use_case_eval_runs ALTER COLUMN ci_run_url TYPE varchar(300) USING NULL`);
  }
  await ensure.runCiKeysDdl();
  assert.equal(await probe(), true, "il giro dopo la rimette a posto");
});

test("i CHECK della tabella delle chiavi rifiutano la riga sbagliata; il workspace la cancella", opts, async () => {
  await rejects(KEY, [ids.ws, "senza-organizzazione", HASH("a"), "ub_ci_ab12"], "use_case_ci_keys_repo_check");
  await rejects(KEY, [ids.ws, REPO, "non-una-impronta", "ub_ci_ab12"], "use_case_ci_keys_hash_check");
  await rejects(KEY, [ids.ws, REPO, HASH("A"), "ub_ci_ab12"], "use_case_ci_keys_hash_check");
  await rejects(KEY, [ids.ws, REPO, HASH("b"), "ub_cli_ab1"], "use_case_ci_keys_prefix_check");
  await rejects(KEY, [ids.ws, REPO, HASH("b"), `ub_ci_${"x".repeat(10)}`], "use_case_ci_keys_prefix_check");
  const [key] = await q(`${KEY} RETURNING id`, [ids.ws, REPO, HASH("c"), "ub_ci_ab12"]);
  await rejects(KEY, [ids.ws, REPO, HASH("c"), "ub_ci_cd34"], "use_case_ci_keys_hash_unique");
  await rejects(`UPDATE use_case_ci_keys SET revoked_at = now() WHERE id = $1`, [key.id], "use_case_ci_keys_revoked_check");
  await rejects(`UPDATE use_case_ci_keys SET revoked_reason = 'a_mano' WHERE id = $1`, [key.id], "use_case_ci_keys_revoked_check");
  await rejects(`UPDATE use_case_ci_keys SET revoked_at = now(), revoked_reason = 'perso' WHERE id = $1`, [key.id], "use_case_ci_keys_reason_check");
  await rejects(`UPDATE use_case_ci_keys SET revoked_by_user_id = $2 WHERE id = $1`, [key.id, ids.user], "use_case_ci_keys_revoked_by_check");
  await rejects(`UPDATE use_case_ci_keys SET expires_at = created_at WHERE id = $1`, [key.id], "use_case_ci_keys_expiry_check");
  await rejects(`UPDATE use_case_ci_keys SET replaces_key_id = id WHERE id = $1`, [key.id], "use_case_ci_keys_replaces_check");
  for (const reason of ["a_mano", "ruotata", "esposta", "senza_casi"]) {
    await q(`UPDATE use_case_ci_keys SET revoked_at = now(), revoked_reason = $2, revoked_by_user_id = $3 WHERE id = $1`, [key.id, reason, ids.user]);
  }
  // Il workspace cancellato porta via le sue chiavi (cascade).
  const [gone] = await q(`${KEY} RETURNING id`, [ids.other, REPO, HASH("d"), "ub_ci_ef56"]);
  await q(`DELETE FROM workspaces WHERE id = $1`, [ids.other]);
  assert.equal((await q(`SELECT count(*)::int AS n FROM use_case_ci_keys WHERE id = $1`, [gone.id]))[0].n, 0);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Altro workspace 0042')`, [ids.other, ids.org]);
});

test("la fonte delle evals: «cli» per il codice di prima; la chiave e l'indirizzo solo per la CI; una chiave cancellata lascia la fonte", opts, async () => {
  // Il codice di prima della 8.2b non scrive le colonne nuove: la riga è «cli», senza chiave né indirizzo.
  const [before0042] = await q(`${RUN}) VALUES ($1, $2, 'evals', 'pull_request', 'main', $3, 28) RETURNING source, ci_key_id, ci_run_url`, [ids.useCase, ids.ws, "a".repeat(40)]);
  assert.deepEqual(before0042, { source: "cli", ci_key_id: null, ci_run_url: null });
  const [key] = await q(`${KEY} RETURNING id`, [ids.ws, REPO, HASH("e"), "ub_ci_gh78"]);
  await rejects(`${RUN}, source) VALUES ($1, $2, 'evals', 'veloce', 'main', $3, 1, 'web')`, [ids.useCase, ids.ws, "b".repeat(40)], "use_case_eval_runs_source_check");
  await rejects(`${RUN}, ci_key_id) VALUES ($1, $2, 'evals', 'veloce', 'main', $3, 1, $4)`, [ids.useCase, ids.ws, "b".repeat(40), key.id], "use_case_eval_runs_ci_check");
  await rejects(`${RUN}, ci_run_url) VALUES ($1, $2, 'evals', 'veloce', 'main', $3, 1, $4)`, [ids.useCase, ids.ws, "b".repeat(40), RUN_URL], "use_case_eval_runs_ci_check");
  await rejects(`${RUN}, source, ci_run_url) VALUES ($1, $2, 'evals', 'veloce', 'main', $3, 1, 'ci', $4)`, [ids.useCase, ids.ws, "b".repeat(40), `${RUN_URL}/attempts/2`], "use_case_eval_runs_ci_url_check");
  await rejects(`${RUN}, source, ci_key_id) VALUES ($1, $2, 'evals', 'veloce', 'main', $3, 1, 'ci', $4)`, [ids.useCase, ids.ws, "b".repeat(40), randomUUID()], "use_case_eval_runs_ci_key_fkey");
  const [ci] = await q(`${RUN}, source, ci_key_id, ci_run_url) VALUES ($1, $2, 'evals', 'pull_request', 'main', $3, 28, 'ci', $4, $5) RETURNING id`, [ids.useCase, ids.ws, "c".repeat(40), key.id, RUN_URL]);
  await q(`DELETE FROM use_case_ci_keys WHERE id = $1`, [key.id]);
  const [kept] = await q(`SELECT source, ci_key_id, ci_run_url FROM use_case_eval_runs WHERE id = $1`, [ci.id]);
  assert.deepEqual(kept, { source: "ci", ci_key_id: null, ci_run_url: RUN_URL }, "ON DELETE SET NULL: la fonte e il link restano");
});
