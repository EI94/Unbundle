// Local smoke of the Claude connector (prompt WP10): prepares a synthetic workspace and a test
// connector token in the connector's local test database, runs scripts/connector-smoke.mjs
// against the app on 127.0.0.1:53130 (scripts/connettore-test/start-app.mjs), checks the saved
// rows, then the two phases that need server state: with the submission bucket full (limit
// lowered to 1 an hour: a replay is still a duplicate, a new submission is rate_limited) and
// with the connector suspended (every tool answers connector_disabled); finally revokes the
// token and deletes the synthetic data.
//
//   node scripts/connettore-test/start-app.mjs --build
//   node --no-warnings scripts/connettore-test/smoke-run.mjs --start-app [--keep]
//   # or, with an app already started by you (same UC_TEST_PG_* as below):
//   node scripts/connettore-test/start-app.mjs --production &
//   node --no-warnings scripts/connettore-test/smoke-run.mjs [--keep]
//
// --start-app starts `next start` itself (start-app.mjs --production, as a child process of
// this script), so that the first calls of the smoke are a real cold start: it reports the
// time until the port listens and the first calls, keeps the server output in memory (and,
// with UC_TEST_ROOT, in $UC_TEST_ROOT/conn-evidence/k10/next-start-<run>.log, outside git),
// checks that it holds no token, hash, submission text, name or phone number, and stops only
// its own child at the end. It refuses to start if something already listens on 53130.
//
// Optional: UC_TEST_PG_PORT (default 55469), UC_TEST_PG_DB (default unbundle_conn_test),
// --profile-file <path> (a profile file as for scripts/connector-admin.ts profile, for example
// a *.private.json outside git: loaded into the synthetic workspace row and passed to the
// smoke; default: the synthetic profile of the tests), --submission-file / --contract-file
// (passed on to the smoke, see there),
// --keep (revoke the token but keep the synthetic workspace for inspection), --list-only
// (only initialize and tools/list, e.g. with --profile-file and --contract-file to compare the
// published tools with the contract; nothing is written but the test token).
//
// The workspace gets the example guide of the tests (docs/connettore/guida-esempio.json, the
// only example guide of the repository): it must pass the guide schema of K8, as a guide
// loaded by scripts/connector-admin.ts would, and match the synthetic profile.
//
// The token is generated here, stored only as its SHA-256 hash, handed to the smoke in its
// environment and never printed or written anywhere. Synthetic data only; the code prefix
// TJ is a synthetic test prefix.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { CONNECTOR_TOKEN_PREFIX } from "../../src/lib/connector/auth.ts";
import { EXAMPLE_PROFILE_FILE, exampleSubmission } from "../../src/lib/connector/contract.fixtures.ts";
import { guideProfileMismatches, parseConnectorGuide } from "../../src/lib/connector/guide-schema.ts";
import { parseConnectorProfileFile, storedConnectorProfile } from "../../src/lib/connector/profile.ts";
import { EXAMPLE_GUIDE } from "../../src/lib/connector/tools.fixtures.ts";
import { forbiddenLogValues, isListening, phoneForms, serverLogTarget, spawnServer, stopServer, waitUntilListening } from "./smoke-support.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const APP_HOST = "127.0.0.1";
const APP_PORT = 53130;
const WORKSPACE_NAME = "Alfa e Beta";
const GUIDE_VERSION = "2026-10.1";
const WARM_RUNS = 20;
const START_TIMEOUT_MS = 90_000;
// Gli stessi valori di scripts/connector-smoke.mjs: il nome di chi propone nell'invio d'esempio e il
// telefono inventato del controllo sensitive_content (FAKE_PHONE).
const SMOKE_SUBMITTER = "Persona di prova dello smoke";
const SMOKE_FAKE_PHONE = "+39 347 000 1122";

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const keep = args.includes("--keep");
const listOnly = args.includes("--list-only");
const startApp = args.includes("--start-app");

const port = process.env.UC_TEST_PG_PORT?.trim() || "55469";
const db = process.env.UC_TEST_PG_DB?.trim() || "unbundle_conn_test";
if (!/^\d+$/.test(port) || ["55439", "55449", "55479"].includes(port)) throw new Error("Use the connector's own test cluster port (default 55469)");
if (!/^[a-z_][a-z0-9_]{2,62}$/.test(db)) throw new Error("UC_TEST_PG_DB must be a plain lowercase database name");
const pool = new pg.Pool({ host: "127.0.0.1", port: Number(port), user: "uc_test", database: db, max: 2 });
const q = async (text, params = []) => (await pool.query(text, params)).rows;

const appIsListening = () => isListening(APP_HOST, APP_PORT);

const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), user: randomUUID(), ws: randomUUID() };
const slug = `k5-smoke-${suffix}`;
const token = `${CONNECTOR_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
let tokenId = null;
let scratch = null;
const runId = randomBytes(4).toString("hex");
let app = null;

/** The profile file (synthetic by default), validated: never printed. */
function profileFileInput() {
  const path = option("--profile-file");
  const input = path ? JSON.parse(readFileSync(path, "utf8")) : EXAMPLE_PROFILE_FILE;
  const parsed = parseConnectorProfileFile(input);
  if (!parsed.ok) throw new Error(`Invalid profile file: ${Object.keys(parsed.fieldErrors).join(", ")}`);
  return { input, parsed };
}

async function setup(profile) {
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova (smoke)', $2)`, [ids.org, `org-k5-smoke-${suffix}`]);
  await q(`INSERT INTO users (id, email, name) VALUES ($1, $2, 'Lateral Space di prova')`, [ids.user, `ls.smoke.${suffix}@ls.test`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, $3)`, [ids.ws, ids.org, `Workspace smoke ${suffix}`]);
  await q(
    `INSERT INTO workspace_connector_configs (workspace_id, slug, enabled, code_prefix, identity_mode, auth_mode, workspace_display_name, guide, guide_version, profile, instructions_template)
     VALUES ($1, $2, true, 'TJ', 'dichiarata', 'header', $3, $4::jsonb, $5, $6::jsonb, $7)`,
    [ids.ws, slug, WORKSPACE_NAME, JSON.stringify(EXAMPLE_GUIDE), GUIDE_VERSION, JSON.stringify(storedConnectorProfile(profile.profile)), profile.instructionsTemplate]
  );
  const [row] = await q(
    `INSERT INTO workspace_integration_tokens (workspace_id, label, provider, token_hash, token_prefix, scopes, created_by_user_id, expires_at)
     VALUES ($1, 'Smoke del connettore', 'claude_connector', $2, $3, '["connector:read","connector:submit"]'::jsonb, $4, (now() AT TIME ZONE 'UTC') + interval '1 day')
     RETURNING id`,
    [ids.ws, tokenHash, `${token.slice(0, 14)}...`, ids.user]
  );
  tokenId = row.id;
}

async function verifyRows() {
  const lines = [];
  const ok = [];
  const checkRow = (condition, label, detail) => {
    ok.push(Boolean(condition));
    lines.push(`${condition ? "[ok]   " : "[FAIL] "}${label}: ${detail}`);
  };
  const [first] = await q(
    `SELECT code, source, status::text AS status, portfolio_review_status::text AS review, intake ->> 'contractVersion' AS contract_version,
            impact_time, impact_economic, impact_flag, custom_scores
       FROM use_cases WHERE workspace_id = $1 ORDER BY code LIMIT 1`,
    [ids.ws]
  );
  checkRow(first?.code === "TJ-0001", "primo codice del workspace", String(first?.code));
  checkRow(first?.source === "claude_connector" && first?.contract_version === "2", "fonte e contratto", `source ${first?.source}, intake.contractVersion ${first?.contract_version}`);
  checkRow(
    [first?.impact_time, first?.impact_economic, first?.impact_flag, first?.custom_scores].every((v) => v === null),
    "punteggi non toccati dall'invio",
    "impact_time, impact_economic, impact_flag, custom_scores vuoti"
  );
  const [counts] = await q(
    `SELECT (SELECT count(*)::int FROM use_cases WHERE workspace_id = $1) AS use_cases,
            (SELECT count(*)::int FROM external_contribution_submissions WHERE workspace_id = $1) AS submissions`,
    [ids.ws]
  );
  checkRow(counts.use_cases === WARM_RUNS + 1 && counts.submissions === WARM_RUNS + 1, "nessuna riga in più per il duplicato", `${counts.use_cases} segnalazioni, ${counts.submissions} chiavi (attese ${WARM_RUNS + 1})`);
  const buckets = await q(`SELECT bucket, count FROM connector_rate_limits WHERE bucket LIKE $1 ORDER BY bucket`, [`conn:${tokenId}:%`]);
  const byKind = Object.fromEntries(buckets.map((b) => [b.bucket.split(":").pop(), Number(b.count)]));
  lines.push(`[info] secchi del token: letture ${byKind.read ?? 0}, invii ${byKind.submit ?? 0} (il duplicato non consuma)`);
  const [tok] = await q(`SELECT last_used_at IS NOT NULL AS used, exposed_at IS NULL AS not_exposed FROM workspace_integration_tokens WHERE id = $1`, [tokenId]);
  checkRow(tok.used && tok.not_exposed, "token di prova", "last_used_at aggiornato, mai segnato come esposto");
  return { lines, passed: ok.every(Boolean) };
}

async function cleanup() {
  if (tokenId) await q(`UPDATE workspace_integration_tokens SET revoked_at = now() AT TIME ZONE 'UTC' WHERE id = $1`, [tokenId]);
  if (!keep) {
    await q(`DELETE FROM connector_rate_limits WHERE bucket LIKE ANY($1::text[])`, [[`%${tokenId}%`, `%${ids.ws}%`]]);
    await q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
    await q(`DELETE FROM users WHERE id = $1`, [ids.user]);
  }
  if (scratch) rmSync(scratch, { recursive: true, force: true });
}

/**
 * `next start` (start-app.mjs --production) come processo figlio di questo script: avvio a freddo
 * misurato. Il figlio va in `app` appena nato, prima dell'attesa, così il `finally` lo ferma anche
 * se la porta non si apre in tempo; il pid si stampa subito.
 */
async function startNext() {
  if (await appIsListening()) throw new Error(`Something already listens on ${APP_HOST}:${APP_PORT}: stop it or run without --start-app`);
  const childEnv = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/private/tmp", UC_TEST_PG_PORT: port, UC_TEST_PG_DB: db };
  if (process.env.TMPDIR) childEnv.TMPDIR = process.env.TMPDIR;
  app = spawnServer({ command: process.execPath, args: ["--no-warnings", "scripts/connettore-test/start-app.mjs", "--production"], cwd: repoRoot, env: childEnv });
  console.log(`next start avviato da questo script come processo figlio (pid ${app.child.pid}); attesa della porta ${APP_HOST}:${APP_PORT}.`);
  await waitUntilListening(app, { host: APP_HOST, port: APP_PORT, timeoutMs: START_TIMEOUT_MS });
}

/** Ferma solo il proprio figlio (start-app.mjs inoltra il segnale a Next) e aspetta che la porta si liberi. */
async function stopNext() {
  if (!app || app.stopped) return;
  if (!(await stopServer(app, { host: APP_HOST, port: APP_PORT }))) {
    console.error(`[FAIL] the child process ${app.child.pid} has not exited or ${APP_HOST}:${APP_PORT} still listens after stopping it`);
  }
}

/**
 * L'invio di base che lo smoke manda davvero (come `baseSubmission()` di connector-smoke.mjs):
 * il file di `--submission-file`, altrimenti l'invio d'esempio con il nome dello smoke.
 */
function smokeSubmission() {
  const path = option("--submission-file");
  return path ? JSON.parse(readFileSync(path, "utf8")) : exampleSubmission({ submittedBy: { name: SMOKE_SUBMITTER } });
}

/**
 * Il log del server durante lo smoke: nessun token (nemmeno il prefisso dei token di workspace),
 * hash, testo dell'invio davvero mandato (ogni testo libero, nome ed email compresi), né il
 * telefono inventato in nessuna forma; poi le righe [mcp] call per esito.
 */
function scanServerLog() {
  const text = app.output.join("");
  const forbidden = forbiddenLogValues(smokeSubmission(), [CONNECTOR_TOKEN_PREFIX, tokenHash, runId, ...phoneForms(SMOKE_FAKE_PHONE)]);
  const leaks = forbidden.filter((value) => text.includes(value)).length;
  const calls = text.split("\n").filter((line) => line.includes("[mcp] call "));
  const outcomes = {};
  for (const line of calls) {
    const outcome = /"outcome":"([a-z0-9_]+)"/.exec(line)?.[1] ?? "unknown";
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }
  const originOther = calls.some((line) => line.includes('"outcome":"origin_not_allowed"') && line.includes('"origin":"other"'));
  const lines = [
    `${leaks === 0 ? "[ok]  " : "[FAIL]"} log di next start: ${leaks === 0 ? `nessun token, hash, testo, nome, email o telefono (${forbidden.length} valori cercati)` : `${leaks} valori vietati trovati (non stampati)`}`,
    `${calls.length > 0 ? "[ok]  " : "[FAIL]"} righe [mcp] call: ${calls.length}; per esito: ${Object.entries(outcomes).sort().map(([k, v]) => `${k} ${v}`).join(", ")}`,
    `${originOther ? "[ok]  " : "[FAIL]"} Origin non ammessa nel log: ${originOther ? "«other», senza il nome di host" : "riga non trovata"}`,
  ];
  // Solo sotto un UC_TEST_ROOT valido (/private/tmp/… o /tmp/…, fuori da git) e solo se il controllo passa.
  const target = serverLogTarget(runId);
  let saved = leaks === 0 ? "non salvato" : "non salvato (valori vietati)";
  if (leaks === 0 && "reason" in target) saved = `non salvato (${target.reason})`;
  if (leaks === 0 && "file" in target) {
    mkdirSync(target.dir, { recursive: true });
    writeFileSync(target.file, text);
    saved = target.file;
  }
  lines.push(`[info] log del server: ${saved}`);
  return { lines, passed: leaks === 0 && calls.length > 0 && originOther };
}

function runSmoke(env, mode) {
  console.log(`\n── Smoke: ${mode} ──`);
  return spawnSync(process.execPath, ["--no-warnings", "scripts/connector-smoke.mjs"], { cwd: repoRoot, env: { ...env, CONNECTOR_SMOKE_MODE: mode }, stdio: "inherit" }).status;
}

async function main() {
  const profile = profileFileInput();
  const guide = parseConnectorGuide(EXAMPLE_GUIDE);
  if (!guide.ok) {
    console.error(`[FAIL] the example guide does not pass the guide schema (${guide.problems.length} problems)`);
    return 1;
  }
  const mismatches = guideProfileMismatches(guide.guide, profile.parsed.profile.contract);
  if (mismatches.length && !option("--profile-file")) {
    console.error(`[FAIL] the example guide does not match the synthetic profile (${mismatches.length} problems)`);
    return 1;
  }
  if (startApp) {
    await startNext();
    console.log(`Porta ${APP_HOST}:${APP_PORT} in ascolto dopo ${Math.round(app.readyMs)} ms (pid ${app.child.pid}); le prime chiamate dello smoke sono a freddo.`);
  } else if (!(await appIsListening())) {
    console.error(`No app on ${APP_HOST}:${APP_PORT}. Start it with: node scripts/connettore-test/start-app.mjs --production, or pass --start-app`);
    return 2;
  }
  await setup(profile.parsed);
  let profileFile = option("--profile-file");
  if (!profileFile) {
    scratch = mkdtempSync(join(tmpdir(), "k5-smoke-"));
    profileFile = join(scratch, "profilo-sintetico.json");
    writeFileSync(profileFile, JSON.stringify(profile.input));
  }
  const env = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "/private/tmp",
    UB_CONNECTOR_TEST_TOKEN: token,
    CONNECTOR_SMOKE_URL: `http://${APP_HOST}:${APP_PORT}/api/mcp/connettore/${slug}`,
    CONNECTOR_SMOKE_WORKSPACE_NAME: WORKSPACE_NAME,
    CONNECTOR_SMOKE_PROFILE_FILE: profileFile,
    CONNECTOR_SMOKE_WARM_RUNS: String(WARM_RUNS),
    CONNECTOR_SMOKE_RUN_ID: runId,
  };
  if (option("--submission-file")) env.CONNECTOR_SMOKE_SUBMISSION_FILE = option("--submission-file");
  if (option("--contract-file")) env.CONNECTOR_SMOKE_CONTRACT_FILE = option("--contract-file");
  if (listOnly) {
    const status = runSmoke(env, "list");
    return status === 0 ? 0 : 1;
  }
  const phases = { full: runSmoke(env, "full") };
  const rows = await verifyRows();
  console.log("Righe nel database locale:");
  for (const line of rows.lines) console.log(line);

  // Secchio degli invii pieno: limite a 1 l'ora (il giro completo ne ha già consumati di più).
  await q(`UPDATE workspace_connector_configs SET limits = '{"submitsPerHour": 1}'::jsonb WHERE workspace_id = $1`, [ids.ws]);
  phases.limited = runSmoke(env, "limited");
  // Connettore sospeso (piano B), con i limiti predefiniti.
  await q(`UPDATE workspace_connector_configs SET enabled = false, limits = DEFAULT WHERE workspace_id = $1`, [ids.ws]);
  phases.suspended = runSmoke(env, "suspended");
  const [after] = await q(`SELECT count(*)::int AS n FROM use_cases WHERE workspace_id = $1`, [ids.ws]);
  const noNewRows = after.n === WARM_RUNS + 1;
  console.log(`\n${noNewRows ? "[ok]  " : "[FAIL]"} secchio pieno e connettore sospeso non scrivono segnalazioni: ${after.n} (attese ${WARM_RUNS + 1})`);

  let log = { lines: [], passed: true };
  if (app) {
    await stopNext();
    log = scanServerLog();
    for (const line of log.lines) console.log(line);
  }
  const phaseLine = Object.entries(phases).map(([name, status]) => `${name} ${status === 0 ? "ok" : "FAIL"}`).join(", ");
  console.log(`Fasi dello smoke: ${phaseLine}; righe ${rows.passed ? "ok" : "FAIL"}${app ? `; log del server ${log.passed ? "ok" : "FAIL"}` : ""}.`);
  return Object.values(phases).every((status) => status === 0) && rows.passed && noNewRows && log.passed ? 0 : 1;
}

let exitCode = 1;
try {
  exitCode = await main();
} catch (error) {
  // Solo i messaggi di questo script (Error); degli altri errori (database, rete) solo il nome.
  const own = error instanceof Error && error.name === "Error";
  console.error(`[FAIL] ${own ? error.message.split(token).join("[token]") : error instanceof Error ? error.name : "errore"}`);
} finally {
  await stopNext().catch(() => console.error("[FAIL] arresto di next start non riuscito"));
  await cleanup().catch(() => console.error("[FAIL] pulizia non riuscita"));
  await pool.end();
  console.log(keep ? `Token revocato; workspace di prova tenuto (slug ${slug}).` : "Token revocato e dati sintetici cancellati.");
}
process.exit(exitCode);
