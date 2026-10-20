// Synthetic workspace for the Claude Code dialog against the local connector (prompt WP10,
// docs/connettore/VERIFICA.md §2). Pierpaolo runs it; it touches only the connector's local
// test cluster (127.0.0.1, never a remote database) and keeps its state outside git.
//
//   export UC_TEST_ROOT=/private/tmp/<dir> UC_TEST_PG_PORT=55469 UC_TEST_PG_DB=<own database>
//   node --no-warnings scripts/connettore-test/dialog-workspace.mjs create    # workspace, guide, profile, token
//   node --no-warnings scripts/connettore-test/dialog-workspace.mjs status    # codes and states of the contributions
//   node --no-warnings scripts/connettore-test/dialog-workspace.mjs suspend   # the connector answers connector_disabled
//   node --no-warnings scripts/connettore-test/dialog-workspace.mjs resume
//   node --no-warnings scripts/connettore-test/dialog-workspace.mjs remove    # revokes the token, deletes the data
//
// create: a synthetic organization and workspace with the connector on, code prefix TJ (the test
// prefix of the prompt, criterion 5), the example guide (docs/connettore/guida-esempio.json),
// the synthetic profile and instructions template of the tests, and one connector token. The
// token is never printed: it goes only to $UC_TEST_ROOT/conn-dialog/token (mode 0600), to be
// read into UB_CONNECTOR_TEST_TOKEN; the database keeps only its hash. The state (ids, slug,
// token id, no secret) is in $UC_TEST_ROOT/conn-dialog/state.json.
// UC_TEST_PG_DB must be a database cloned from the template (createdb -T unbundle_conn_test),
// never unbundle_conn_test itself.
//
// status, suspend, resume and remove refuse to run when UC_TEST_PG_DB or UC_TEST_PG_PORT differ
// from the database and port saved by «create», and fail (exit 1) when the rows they expect are
// not there, instead of reporting a change that did not happen. remove revokes the token first,
// deletes the synthetic data in one transaction, checks that the token can no longer be used,
// and only then deletes the local token file and state.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { ucTestRoot } from "../uc-test/config.mjs";
import { CONNECTOR_TOKEN_PREFIX } from "../../src/lib/connector/auth.ts";
import { EXAMPLE_CONNECTOR_PROFILE_INPUT, EXAMPLE_INSTRUCTIONS_TEMPLATE } from "../../src/lib/connector/contract.fixtures.ts";
import { EXAMPLE_GUIDE } from "../../src/lib/connector/tools.fixtures.ts";
import { CONNECTOR_APP_HOST, CONNECTOR_APP_PORT } from "./auth-config.mjs";

const COMMANDS = ["create", "status", "suspend", "resume", "remove"];
const command = process.argv[2];
if (!COMMANDS.includes(command) || process.argv.length > 3) {
  console.error(`Usage: dialog-workspace.mjs ${COMMANDS.join("|")}`);
  process.exit(2);
}
const port = process.env.UC_TEST_PG_PORT?.trim() || "55469";
const db = process.env.UC_TEST_PG_DB?.trim() ?? "";
if (!/^\d+$/.test(port) || ["55439", "55449", "55479"].includes(port)) throw new Error("Use the connector's own test cluster port (default 55469)");
if (!/^[a-z_][a-z0-9_]{2,62}$/.test(db) || db === "unbundle_conn_test") {
  throw new Error("UC_TEST_PG_DB must name your own database, cloned with createdb -T unbundle_conn_test (never the template itself)");
}
const dir = join(ucTestRoot(), "conn-dialog");
const statePath = join(dir, "state.json");
const tokenPath = join(dir, "token");
const pool = new pg.Pool({ host: "127.0.0.1", port: Number(port), user: "uc_test", database: db, max: 2 });
const q = async (text, params = []) => (await pool.query(text, params)).rows;

function readState() {
  if (!existsSync(statePath)) throw new Error(`No dialog workspace: run «create» first (${statePath} missing)`);
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  if (state.database !== db || String(state.port) !== port) {
    throw new Error(
      `The dialog workspace was created in database ${state.database} on port ${state.port}, but UC_TEST_PG_DB and UC_TEST_PG_PORT say database ${db} on port ${port}: export the values used for «create» and run again (nothing changed)`
    );
  }
  return state;
}

/** Fails when a row the command needs is missing: the state is stale or the data is gone. */
function missing(what, done = "nothing changed") {
  return new Error(`${what} of the dialog workspace is not in database ${db} on port ${port}: ${done}, state kept (${statePath})`);
}

async function create() {
  if (existsSync(statePath)) throw new Error(`A dialog workspace already exists (${statePath}): run «remove» first`);
  const suffix = randomBytes(3).toString("hex");
  const ids = { org: randomUUID(), user: randomUUID(), ws: randomUUID() };
  const slug = `dialogo-${suffix}`;
  const token = `${CONNECTOR_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const hash = createHash("sha256").update(token, "utf8").digest("hex");
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova (dialogo)', $2)`, [ids.org, `org-dialogo-${suffix}`]);
  await q(`INSERT INTO users (id, email, name) VALUES ($1, $2, 'Lateral Space di prova')`, [ids.user, `ls.dialogo.${suffix}@ls.test`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, $3)`, [ids.ws, ids.org, `Workspace del dialogo ${suffix}`]);
  await q(
    `INSERT INTO workspace_connector_configs (workspace_id, slug, enabled, code_prefix, identity_mode, auth_mode, workspace_display_name, guide, guide_version, profile, instructions_template)
     VALUES ($1, $2, true, 'TJ', 'dichiarata', 'header', 'Alfa e Beta', $3::jsonb, $4, $5::jsonb, $6)`,
    [ids.ws, slug, JSON.stringify(EXAMPLE_GUIDE), String(EXAMPLE_GUIDE.guideVersion), JSON.stringify(EXAMPLE_CONNECTOR_PROFILE_INPUT), EXAMPLE_INSTRUCTIONS_TEMPLATE]
  );
  // Un giorno basta per il dialogo; «remove» lo revoca comunque.
  const [row] = await q(
    `INSERT INTO workspace_integration_tokens (workspace_id, label, provider, token_hash, token_prefix, scopes, created_by_user_id, expires_at)
     VALUES ($1, 'Dialogo in Claude Code', 'claude_connector', $2, $3, '["connector:read","connector:submit"]'::jsonb, $4, (now() AT TIME ZONE 'UTC') + interval '1 day')
     RETURNING id`,
    [ids.ws, hash, `${token.slice(0, 14)}...`, ids.user]
  );
  mkdirSync(dir, { recursive: true });
  writeFileSync(tokenPath, token, { mode: 0o600 });
  chmodSync(tokenPath, 0o600);
  writeFileSync(statePath, JSON.stringify({ ...ids, slug, tokenId: row.id, database: db, port }, null, 2));
  const url = `http://${CONNECTOR_APP_HOST}:${CONNECTOR_APP_PORT}/api/mcp/connettore/${slug}`;
  console.log(`Workspace del dialogo creato (database ${db}): slug ${slug}, prefisso TJ, connettore acceso, token valido 1 giorno.`);
  console.log(`Indirizzo: ${url}`);
  console.log(`Token (mai stampato): ${tokenPath}`);
  console.log(`Nella shell di Claude Code:\n  export UB_CONNECTOR_TEST_TOKEN="$(cat ${tokenPath})"`);
  console.log(`  claude mcp add --transport http --scope local unbundle-test ${url} --header 'Authorization: Bearer \${UB_CONNECTOR_TEST_TOKEN}'`);
}

async function status() {
  const state = readState();
  const [config] = await q(`SELECT enabled, next_code_seq FROM workspace_connector_configs WHERE workspace_id = $1`, [state.ws]);
  if (!config) throw missing("The connector config row");
  const [token] = await q(
    `SELECT revoked_at IS NOT NULL AS revoked, expires_at <= (now() AT TIME ZONE 'UTC') AS expired, exposed_at IS NOT NULL AS exposed, last_used_at IS NOT NULL AS used
       FROM workspace_integration_tokens WHERE id = $1 AND workspace_id = $2`,
    [state.tokenId, state.ws]
  );
  if (!token) throw missing("The token row");
  const rows = await q(
    `SELECT code, portfolio_kind AS kind, source, status::text AS status, portfolio_review_status::text AS review,
            intake ->> 'contractVersion' AS contract, intake ->> 'possibleDuplicateOf' AS integra,
            to_char(submitted_at, 'YYYY-MM-DD HH24:MI') AS submitted
       FROM use_cases WHERE workspace_id = $1 ORDER BY code NULLS LAST, created_at`,
    [state.ws]
  );
  const tokenState = token.revoked ? "revocato" : token.expired ? "scaduto" : "attivo";
  console.log(`Connettore ${config.enabled ? "acceso" : "sospeso"}; prossimo numero ${Number(config.next_code_seq) + 1}; token ${tokenState}, ${token.used ? "usato" : "mai usato"}, ${token.exposed ? "ESPOSTO" : "mai esposto"}.`);
  console.log(`Segnalazioni: ${rows.length}`);
  for (const r of rows) {
    console.log(`  ${r.code ?? "(senza codice)"}  ${r.kind}  ${r.source}  ${r.status}/${r.review}  contratto ${r.contract ?? "-"}${r.integra ? `  integra ${r.integra}` : ""}  ${r.submitted ?? ""}`);
  }
}

async function setEnabled(enabled) {
  const state = readState();
  const rows = await q(`UPDATE workspace_connector_configs SET enabled = $2, updated_at = now() WHERE workspace_id = $1 RETURNING enabled`, [state.ws, enabled]);
  if (rows.length !== 1 || rows[0].enabled !== enabled) throw missing("The connector config row");
  console.log(enabled ? "Connettore riacceso." : "Connettore sospeso: ogni tool risponde connector_disabled (piano B).");
}

async function remove() {
  const state = readState();
  // 1. Revoca (resta anche se un passo dopo fallisce): la riga del token deve esserci.
  const [token] = await q(
    `UPDATE workspace_integration_tokens SET revoked_at = coalesce(revoked_at, now() AT TIME ZONE 'UTC') WHERE id = $1 AND workspace_id = $2 RETURNING revoked_at IS NOT NULL AS revoked`,
    [state.tokenId, state.ws]
  );
  if (!token?.revoked) throw missing("The token row");
  // 2. Dati sintetici in una transazione: l'organizzazione (con workspace, configurazione, token e
  // segnalazioni in cascata) e l'utente devono esserci entrambi, altrimenti non si cancella nulla.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM connector_rate_limits WHERE bucket LIKE ANY($1::text[])`, [[`%${state.tokenId}%`, `%${state.ws}%`]]);
    if ((await client.query(`DELETE FROM organizations WHERE id = $1 RETURNING id`, [state.org])).rowCount !== 1) throw missing("The organization", "token revoked, nothing deleted");
    if ((await client.query(`DELETE FROM users WHERE id = $1 RETURNING id`, [state.user])).rowCount !== 1) throw missing("The synthetic user", "token revoked, nothing deleted");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  // 3. Il token non deve poter più aprire nulla: riga cancellata o revocata.
  const [left] = await q(`SELECT count(*)::int AS n FROM workspace_integration_tokens WHERE id = $1 AND revoked_at IS NULL`, [state.tokenId]);
  if (left.n !== 0) throw new Error(`The dialog token is still active in database ${db}: state kept (${statePath})`);
  rmSync(dir, { recursive: true, force: true });
  console.log("Token revocato, dati sintetici del dialogo cancellati, file del token e stato rimossi.");
}

try {
  if (command === "create") await create();
  else if (command === "status") await status();
  else if (command === "suspend") await setEnabled(false);
  else if (command === "resume") await setEnabled(true);
  else await remove();
} catch (error) {
  console.error(`[FAIL] ${error instanceof Error && error.name === "Error" ? error.message : error instanceof Error ? error.name : "errore"}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
