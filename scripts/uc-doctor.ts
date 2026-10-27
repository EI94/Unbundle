#!/usr/bin/env node
/**
 * Controllo dell'ambiente della sezione «Casi d'uso» (DESIGN §7.1 P0-10), in
 * sola lettura. Non scrive mai: né variabili, né database, né archivi.
 *
 *   node --no-warnings scripts/uc-doctor.ts [--environment local|preview|production] [--json] [--no-db]
 *   env: le variabili dell'ambiente da controllare (UC_ENABLED, UC_WORKSPACE_IDS,
 *        USE_CASE_HUB_WORKSPACES, USE_CASE_HUB_EXCLUDE, UC_LS_EMAIL_DOMAINS, UC_SECRET, CRON_SECRET,
 *        UC_SCHEMA_SELF_HEAL, NEXT_PUBLIC_APP_URL, RESEND_API_KEY, UC_EMAIL_FROM, UC_EMAIL_REPLY_TO,
 *        BLOB_READ_WRITE_TOKEN, UC_PERSONAL_ZONE_KEY, UC_PERSONAL_BLOB_READ_WRITE_TOKEN);
 *        per il database UC_ADMIN_DATABASE_URL, passata a mano.
 *
 * Variabili: si controlla solo se ci sono e la loro forma; nessun valore esce
 * dal rapporto. Database (con `UC_ADMIN_DATABASE_URL`, mai `.env` né
 * `DATABASE_URL`, in una transazione `READ ONLY`): tabelle uc, sonda dello
 * schema, dossier doppi sulla stessa scheda (righe complete e incomplete, la
 * stessa condizione della 0020), indice unico, dossier senza scheda madre,
 * workspace accesi presenti. `USE_CASE_HUB_WORKSPACES` (`*` = ogni workspace, anche in
 * produzione, oppure UUID separati da virgole) e `USE_CASE_HUB_EXCLUDE` si leggono con le
 * regole della pagina Use case, senza importare nulla da lei (`src/lib/uc/platform.ts`).
 *
 * Esce con 1 se c'è almeno un errore. La procedura è in `docs/casi-duso/RUNBOOK.md`.
 */
import { ucExecutorForUrl } from "../src/lib/db/uc-executor.ts";
import { UC_PROBE_SQL } from "../src/lib/uc/ddl.ts";
import {
  DOCTOR_DUPLICATES_SQL,
  DOCTOR_ENVIRONMENTS,
  DOCTOR_INDEX_SQL,
  DOCTOR_ORPHANS_SQL,
  DOCTOR_TABLES_SQL,
  DOCTOR_UC_TABLES,
  DOCTOR_WORKSPACES_SQL,
  checkUcDatabase,
  checkUcEnv,
  doctorExitCode,
  formatDoctorReport,
  type DoctorCheck,
  type DoctorEnvironment,
} from "../src/lib/uc/doctor.ts";
import { parseUcWorkspaceIds } from "../src/lib/uc/rollout.ts";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const args = process.argv.slice(2);
const opts = { environment: null as string | null, json: false, db: true };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--json") opts.json = true;
  else if (a === "--no-db") opts.db = false;
  else if (a === "--environment") opts.environment = args[++i] ?? null;
  else {
    console.error(`Opzione sconosciuta: ${a}. Uso: --environment local|preview|production [--json] [--no-db]`);
    process.exit(2);
  }
}
const fromVercel = process.env.VERCEL_ENV === "production" ? "production" : process.env.VERCEL_ENV === "preview" ? "preview" : "local";
const environment = (opts.environment ?? fromVercel) as DoctorEnvironment;
if (!DOCTOR_ENVIRONMENTS.includes(environment)) {
  console.error("--environment deve essere local, preview o production.");
  process.exit(2);
}

const checks: DoctorCheck[] = checkUcEnv(process.env, environment);
let database: string | null = null;

async function databaseChecks(): Promise<DoctorCheck[]> {
  const url = process.env.UC_ADMIN_DATABASE_URL;
  if (!opts.db) return [{ key: "database", status: "avviso", message: "Database non controllato (--no-db)." }];
  if (!url) return [{ key: "database", status: "avviso", message: "Database non controllato: imposta UC_ADMIN_DATABASE_URL a mano (lo script non legge .env né DATABASE_URL)." }];
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return [{ key: "database", status: "errore", message: "UC_ADMIN_DATABASE_URL non è un URL valido." }];
  }
  database = `${target.hostname}${target.port ? `:${target.port}` : ""}${target.pathname}`;
  const loopback = LOOPBACK.has(target.hostname);
  if (environment === "local" && !loopback) return [{ key: "database", status: "errore", message: "--environment local accetta solo un database su loopback." }];
  if (environment !== "local" && loopback) return [{ key: "database", status: "errore", message: "Un database su loopback si controlla solo con --environment local." }];

  const executor = ucExecutorForUrl(url);
  const readOnly = { text: "SET TRANSACTION READ ONLY", params: [] as unknown[] };
  const listed = [...parseUcWorkspaceIds(process.env.UC_WORKSPACE_IDS).ids];
  try {
    const [, tables, index, workspaces] = await executor.batch([
      readOnly,
      { text: DOCTOR_TABLES_SQL, params: [[...DOCTOR_UC_TABLES]] },
      { text: DOCTOR_INDEX_SQL, params: [] },
      { text: DOCTOR_WORKSPACES_SQL, params: [listed] },
    ]);
    const ucTables = Number(tables[0]?.n ?? 0);
    let facts = {
      ucTables,
      probeCurrent: false,
      duplicateGroups: 0,
      duplicateRows: 0,
      uniqueIndex: index[0]?.present === true,
      orphanDossiers: 0,
      listedWorkspacesFound: Number(workspaces[0]?.n ?? 0),
      listedWorkspaces: listed.length,
    };
    if (ucTables > 0) {
      const [, probe, dups, orphans] = await executor.batch([
        readOnly,
        { text: UC_PROBE_SQL, params: [] },
        { text: DOCTOR_DUPLICATES_SQL, params: [] },
        { text: DOCTOR_ORPHANS_SQL, params: [] },
      ]);
      facts = {
        ...facts,
        probeCurrent: probe[0]?.current === true,
        duplicateGroups: Number(dups[0]?.groups ?? 0),
        duplicateRows: Number(dups[0]?.rows ?? 0),
        orphanDossiers: Number(orphans[0]?.n ?? 0),
      };
    }
    return [{ key: "database", status: "ok", message: `Raggiunto in sola lettura (${database}).` }, ...checkUcDatabase(facts, { environment, ucEnabled: process.env.UC_ENABLED === "true" })];
  } catch (error) {
    const name = error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : "errore";
    return [{ key: "database", status: "errore", message: `Lettura non riuscita (${name}). Controlla URL, rete e permessi.` }];
  }
}

checks.push(...(await databaseChecks()));
const exitCode = doctorExitCode(checks);
if (opts.json) {
  console.log(JSON.stringify({ status: exitCode === 0 ? "OK" : "ERRORI", environment, database, checks }, null, 2));
} else {
  console.log(`uc-doctor · ambiente ${environment}${database ? ` · database ${database}` : ""}\n`);
  console.log(formatDoctorReport(checks));
}
process.exit(exitCode);
