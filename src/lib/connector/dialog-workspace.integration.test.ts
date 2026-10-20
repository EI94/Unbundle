import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CONNECTOR_TOKEN_PREFIX } from "./auth.ts";

// Opt-in integration suite for scripts/connettore-test/dialog-workspace.mjs (prompt WP10,
// docs/connettore/VERIFICA.md §2): the real script, run as a child process on the connector's
// local cluster. It must refuse a database or port other than the one of «create», fail when
// the rows it needs are missing (never print «sospeso», «attivo» or «rimossi» for a change
// that did not happen) and delete its local state only after the token is revoked and the
// synthetic data is gone.
//   UC_TEST_PG_DB=<a copy of the template> node scripts/connettore-test/run-db-tests.mjs
// The script refuses the template database itself, so on unbundle_conn_test the suite skips.
// Synthetic data, created and deleted here; the token is never printed.
const url = process.env.DATABASE_URL;
const db = process.env.UC_TEST_PG_DB?.trim() ?? "";
const port = process.env.UC_TEST_PG_PORT?.trim() || "55469";
const isolated = process.env.CONN_TEST_ISOLATED === "true" && Boolean(url);
if (isolated) {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || process.env.UC_TEST_DATABASE_URL !== url) {
    throw new Error("Connector DB tests need a loopback DATABASE_URL equal to UC_TEST_DATABASE_URL");
  }
  if ((globalThis.fetch as { name?: string }).name !== "localNeonFetch") {
    throw new Error("Preload scripts/uc-test/local-neon.cjs to reach the local test database");
  }
}
const onConnectorCluster = port === "55469";
const enabled = isolated && onConnectorCluster && db !== "" && db !== "unbundle_conn_test";
const opts = {
  skip: !isolated
    ? true
    : !onConnectorCluster
      ? "dialog-workspace.mjs gira solo sul cluster del connettore (55469): qui si salta, per esempio sul cluster dell'hub"
      : !enabled
        ? "dialog-workspace.mjs rifiuta il database modello: lanciare la suite su una copia (UC_TEST_PG_DB)"
        : false,
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
// ucTestRoot() vuole /private/tmp/… o /tmp/… (run-db-tests.mjs non passa TMPDIR: tmpdir() è /tmp).
const tmpBase = /^\/(private\/)?tmp(\/|$)/.test(tmpdir()) ? tmpdir() : "/tmp";
let root = "";
let created: { org: string; user: string } | null = null;
let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
const one = async (text: string, params: unknown[] = []) => (await q(text, params))[0];

type DialogState = { org: string; user: string; ws: string; tokenId: string; slug: string; database: string; port: string };
const dialogDir = () => join(root, "conn-dialog");
const statePath = () => join(dialogDir(), "state.json");
const tokenPath = () => join(dialogDir(), "token");
const readState = () => JSON.parse(readFileSync(statePath(), "utf8")) as DialogState;
const writeState = (state: DialogState) => writeFileSync(statePath(), JSON.stringify(state, null, 2));
const readToken = () => (existsSync(tokenPath()) ? readFileSync(tokenPath(), "utf8") : "");

function script(command: string, env: Record<string, string> = {}) {
  const tokenBefore = readToken();
  const run = spawnSync(process.execPath, ["--no-warnings", "scripts/connettore-test/dialog-workspace.mjs", command], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/private/tmp", UC_TEST_ROOT: root, UC_TEST_PG_PORT: port, UC_TEST_PG_DB: db, ...env } as unknown as NodeJS.ProcessEnv,
  });
  const printed = `${run.stdout}${run.stderr}`;
  assert.ok(!printed.includes(CONNECTOR_TOKEN_PREFIX), `${command}: un token compare nell'uscita`);
  for (const token of [tokenBefore, readToken()]) if (token) assert.ok(!printed.includes(token), `${command}: il token compare nell'uscita`);
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

const enabledFlag = async (ws: string) => (await one(`SELECT enabled FROM workspace_connector_configs WHERE workspace_id = $1`, [ws]))?.enabled;
const tokenActive = async (id: string) =>
  (await one(`SELECT (revoked_at IS NULL AND expires_at > (now() AT TIME ZONE 'UTC')) AS active FROM workspace_integration_tokens WHERE id = $1`, [id]))?.active;
const orgExists = async (id: string) => Boolean(await one(`SELECT id FROM organizations WHERE id = $1`, [id]));

/** Lancia il comando con uno stato che punta a righe che non ci sono, poi rimette lo stato vero. */
function withStaleState<T>(patch: Partial<DialogState>, run: () => T): T {
  const real = readState();
  writeState({ ...real, ...patch });
  try {
    return run();
  } finally {
    writeState(real);
  }
}

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>;
  root = mkdtempSync(join(tmpBase, "conn-dialog-test-"));
});

after(async () => {
  if (!enabled) return;
  if (created) {
    await q(`DELETE FROM organizations WHERE id = $1`, [created.org]);
    await q(`DELETE FROM users WHERE id = $1`, [created.user]);
  }
  if (root) rmSync(root, { recursive: true, force: true });
});

test("dialog-workspace.mjs: crea, sospende e riaccende il workspace del dialogo; il token sta solo nel file 0600", opts, async () => {
  const out = script("create");
  assert.equal(out.status, 0, out.stdout + out.stderr);
  const state = readState();
  created = { org: state.org, user: state.user };
  assert.equal(state.database, db);
  assert.equal(String(state.port), port);
  assert.equal(statSync(tokenPath()).mode & 0o777, 0o600);
  assert.ok(readToken().startsWith(CONNECTOR_TOKEN_PREFIX));
  assert.equal(await enabledFlag(state.ws), true);
  assert.equal(await tokenActive(state.tokenId), true);

  const status = script("status");
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /Connettore acceso; prossimo numero 1; token attivo, mai usato, mai esposto\./);

  const suspend = script("suspend");
  assert.equal(suspend.status, 0, suspend.stderr);
  assert.equal(await enabledFlag(state.ws), false);
  assert.match(script("status").stdout, /Connettore sospeso/);
  const resume = script("resume");
  assert.equal(resume.status, 0, resume.stderr);
  assert.equal(await enabledFlag(state.ws), true);
});

test("dialog-workspace.mjs: un altro database o un'altra porta nella shell si rifiutano senza toccare nulla", opts, async () => {
  const state = readState();
  const otherDb = `${db.slice(0, 50)}_altro`;
  const cases: Array<[string, Record<string, string>]> = [
    ["suspend", { UC_TEST_PG_DB: otherDb }],
    ["resume", { UC_TEST_PG_DB: otherDb }],
    ["status", { UC_TEST_PG_DB: otherDb }],
    ["remove", { UC_TEST_PG_DB: otherDb }],
    ["suspend", { UC_TEST_PG_PORT: "55470" }],
    ["remove", { UC_TEST_PG_PORT: "55470" }],
  ];
  for (const [command, env] of cases) {
    const out = script(command, env);
    const label = `${command} ${JSON.stringify(env)}`;
    assert.equal(out.status, 1, `${label}: ${out.stdout}`);
    assert.equal(out.stdout, "", `${label}: nessun messaggio di riuscita`);
    assert.ok(out.stderr.includes(`created in database ${db} on port ${port}`), `${label}: il messaggio nomina il database del create`);
    assert.ok(out.stderr.includes(`say database ${env.UC_TEST_PG_DB ?? db} on port ${env.UC_TEST_PG_PORT ?? port}`), `${label}: il messaggio nomina i valori della shell`);
    assert.match(out.stderr, /nothing changed/);
  }
  assert.ok(existsSync(statePath()) && existsSync(tokenPath()), "stato e token restano");
  assert.equal(await enabledFlag(state.ws), true, "il connettore non è stato sospeso");
  assert.equal(await tokenActive(state.tokenId), true, "il token non è stato revocato");
});

test("dialog-workspace.mjs: senza la riga della configurazione suspend, resume e status falliscono", opts, async () => {
  const state = readState();
  for (const command of ["suspend", "resume", "status"]) {
    const out = withStaleState({ ws: randomUUID() }, () => script(command));
    assert.equal(out.status, 1, `${command}: ${out.stdout}`);
    assert.equal(out.stdout, "", `${command}: nessun esito inventato («sospeso», «riacceso», «acceso»)`);
    assert.match(out.stderr, /connector config row of the dialog workspace is not in database .*nothing changed/);
  }
  assert.equal(await enabledFlag(state.ws), true);
  assert.equal(script("status").status, 0, "con lo stato vero status risponde");
});

test("dialog-workspace.mjs: senza la riga del token status e remove falliscono, lo stato e i dati restano", opts, async () => {
  const state = readState();
  const status = withStaleState({ tokenId: randomUUID() }, () => script("status"));
  assert.equal(status.status, 1, status.stdout);
  assert.equal(status.stdout, "", "nessun «token attivo» inventato");
  assert.match(status.stderr, /token row of the dialog workspace is not in database/);

  const remove = withStaleState({ tokenId: randomUUID() }, () => script("remove"));
  assert.equal(remove.status, 1, remove.stdout);
  assert.equal(remove.stdout, "");
  assert.match(remove.stderr, /token row of the dialog workspace is not in database .*state kept/);
  assert.ok(existsSync(statePath()) && existsSync(tokenPath()), "stato e token tenuti");
  assert.ok(await orgExists(state.org), "nessun dato cancellato");
  assert.equal(await tokenActive(state.tokenId), true);
});

test("dialog-workspace.mjs: remove cancella i dati in una transazione e solo dopo lo stato locale; la revoca resta", opts, async () => {
  const state = readState();
  // Senza l'utente sintetico la transazione non cancella nulla, ma la revoca resta.
  const partial = withStaleState({ user: randomUUID() }, () => script("remove"));
  assert.equal(partial.status, 1, partial.stdout);
  assert.equal(partial.stdout, "");
  assert.match(partial.stderr, /synthetic user of the dialog workspace is not in database .*: token revoked, nothing deleted, state kept/);
  assert.ok(existsSync(statePath()) && existsSync(tokenPath()), "stato tenuto");
  assert.ok(await orgExists(state.org), "organizzazione non cancellata: transazione annullata");
  assert.equal(await tokenActive(state.tokenId), false, "la revoca resta anche se la cancellazione non va");

  // Rilanciato con lo stato vero (token già revocato): cancella tutto, poi file del token e stato.
  const out = script("remove");
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /Token revocato, dati sintetici del dialogo cancellati, file del token e stato rimossi\./);
  assert.equal(existsSync(dialogDir()), false, "file del token e stato rimossi");
  assert.equal(await tokenActive(state.tokenId), undefined, "la riga del token è cancellata con il workspace");
  assert.equal(await orgExists(state.org), false);
  assert.equal(await one(`SELECT id FROM users WHERE id = $1`, [state.user]), undefined);
  assert.equal(await one(`SELECT workspace_id FROM workspace_connector_configs WHERE workspace_id = $1`, [state.ws]), undefined);
  created = null;
  const again = script("status");
  assert.equal(again.status, 1);
  assert.match(again.stderr, /run «create» first/);
});
