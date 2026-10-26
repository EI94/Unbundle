import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

// Schema della 0023 sul database di prova dell'hub: il CHECK della Storia ammette «Cosa serve».
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id>
//   su 127.0.0.1) porta lo schema con il vero ensureDbSchema(): su una copia del modello senza
//   la 0023 applica il blocco; con la 0023 la sonda è vera e non cambia nulla.
// - Dentro `npm run check` (nessun loader, nessun database) si salta.
// La migrazione (due volte, database come in produzione con righe, mai restringere, righe fuori
// elenco, parità col self-heal) la prova scripts/use-case-test/schema-check.mjs. Dati sintetici.
const url = process.env.DATABASE_URL;
const enabled = process.env.HUB_TEST_ISOLATED === "true" && Boolean(url);
if (enabled) {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || process.env.UC_TEST_DATABASE_URL !== url) {
    throw new Error("Hub DB tests need a loopback DATABASE_URL equal to UC_TEST_DATABASE_URL");
  }
  if ((globalThis.fetch as { name?: string }).name !== "localNeonFetch") {
    throw new Error("Preload scripts/uc-test/local-neon.cjs to reach the local test database");
  }
}
const opts = { skip: !enabled };

type Row = Record<string, unknown>;
let q: (text: string, params?: unknown[]) => Promise<Row[]>;
let ddl: typeof import("./use-case-hub-history-ddl.ts");
let ensure: typeof import("./ensure-schema.ts");

const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), useCase: randomUUID() };

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Row[]>;
  ensure = await import("./ensure-schema.ts");
  await ensure.ensureDbSchema();
  ddl = await import("./use-case-hub-history-ddl.ts");
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova storia', $2)`, [ids.org, `org-storia-${suffix}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Workspace di prova storia')`, [ids.ws, ids.org]);
  await q(`INSERT INTO use_cases (id, workspace_id, title) VALUES ($1, $2, 'Scheda di prova storia')`, [ids.useCase, ids.ws]);
});

after(async () => {
  if (!enabled) return;
  await q(`DELETE FROM workspaces WHERE id = $1`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
});

const constraint = async () =>
  (await q(`SELECT pg_get_constraintdef(oid) AS def, convalidated FROM pg_constraint WHERE conrelid = 'public.use_case_events'::regclass AND conname = $1`, [ddl.FIELDS_CHECK_NAME]))[0];

test("lo schema della 0023 c'è: la sonda è vera, il CHECK ha l'elenco intero ed è validato; il DDL due volte non cambia nulla", opts, async () => {
  const [row] = await q(`SELECT ${ddl.USE_CASE_HISTORY_PROBE_SQL} AS current, current_database() AS db`);
  assert.equal(row.db, process.env.UC_TEST_PG_DB);
  assert.equal(row.current, true);
  const first = await constraint();
  assert.equal(first.def, `CHECK ((fields <@ ARRAY[${ddl.USE_CASE_EVENT_FIELDS_0023.map((name) => `'${name}'::text`).join(", ")}]))`);
  assert.equal(first.convalidated, true);
  await ensure.runUseCaseHistoryDdl();
  await ensure.runUseCaseHistoryDdl();
  assert.deepEqual(await constraint(), first);
});

test("il CHECK ammette cosa_serve con gli altri nomi e rifiuta un testo", opts, async () => {
  const insert = (fields: string[]) =>
    q(`INSERT INTO use_case_events (workspace_id, use_case_id, actor_kind, channel, action, fields, phase_after) VALUES ($1, $2, 'sistema', 'script', 'modificato', $3::text[], 'aggiunta.requisito.da_chiedere') RETURNING id`, [
      ids.ws,
      ids.useCase,
      fields,
    ]);
  assert.equal((await insert(["cosa_serve"])).length, 1);
  assert.equal((await insert(["titolo", "cosa_serve"])).length, 1);
  await assert.rejects(insert(["Testo libero di una persona"]), /use_case_events_fields_check/);
  await assert.rejects(insert(["cosa_serve", "Accesso al gestionale"]), /use_case_events_fields_check/);
});
