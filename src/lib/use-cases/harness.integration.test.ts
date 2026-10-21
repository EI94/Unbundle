import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

// Prova del harness delle suite d'integrazione dell'hub (docs/use-case/PIANO-LAVORI.md H0,
// docs/use-case/DESIGN.md §12.5). È una suite finta: non prova regole dell'area, prova
// che le suite vere potranno caricare i moduli dell'app.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database di prova
//   su 127.0.0.1) carica un modulo dell'app che ha `import "server-only"` e import `@/`
//   (src/lib/db/queries/uc-access.ts) e lo usa sul database di prova.
// - Dentro `npm run check` (nessun loader, nessun database) si salta: in testa importa solo
//   moduli di Node e i moduli dell'app arrivano con `await import()` dentro `before()`.
// Ogni suite dell'hub si accende con HUB_TEST_ISOLATED, come questa, e non con
// CONN_TEST_ISOLATED della suite modello del connettore
// (src/lib/portfolio/submission.integration.test.ts): run-db-tests.mjs imposta solo
// HUB_TEST_ISOLATED e fallisce se una prova si salta.
// Dati sintetici, creati e cancellati dalla suite.
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

type App = {
  isUcEnabled: typeof import("../db/queries/uc-access.ts").isUcEnabled;
  getUcUserContext: typeof import("../db/queries/uc-access.ts").getUcUserContext;
  q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
};
let app: App;

const suffix = randomBytes(3).toString("hex");
const ids = { ls: randomUUID(), client: randomUUID() };
const envBefore = { UC_ENABLED: process.env.UC_ENABLED, UC_LS_EMAIL_DOMAINS: process.env.UC_LS_EMAIL_DOMAINS };

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  // Un modulo dell'app con `import "server-only"` e import `@/`: sotto Node puro darebbe
  // ERR_MODULE_NOT_FOUND; con test-hooks.mjs si carica.
  const access = await import("../db/queries/uc-access.ts");
  app = {
    isUcEnabled: access.isUcEnabled,
    getUcUserContext: access.getUcUserContext,
    q: (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>,
  };
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  delete process.env.UC_ENABLED;
  await app.q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, 'Persona di prova LS', now())`, [
    ids.ls,
    `ls.${suffix}@ls.test`,
  ]);
  await app.q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, 'Persona di prova cliente', now())`, [
    ids.client,
    `cliente.${suffix}@cliente.test`,
  ]);
});

after(async () => {
  for (const [key, value] of Object.entries(envBefore)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (!enabled) return;
  await app.q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.ls, ids.client]]);
});

test("server-only si risolve nel modulo vuoto di Next", opts, () => {
  assert.match(import.meta.resolve("server-only"), /\/next\/dist\/compiled\/server-only\/empty\.js$/);
});

test("il database è quello di prova su 127.0.0.1, con la 0019", opts, async () => {
  const [row] = await app.q(
    `SELECT current_database() AS db, to_regclass('public.workspace_connector_configs') IS NOT NULL AS connector,
            to_regclass('public.uc_cases') IS NOT NULL AS uc`,
  );
  assert.equal(row.db, process.env.UC_TEST_PG_DB);
  assert.equal(row.connector, true);
  assert.equal(row.uc, true);
});

test("un modulo con server-only e import @/ legge il database di prova", opts, async () => {
  assert.equal(app.isUcEnabled(), false);
  const ls = await app.getUcUserContext(ids.ls);
  const client = await app.getUcUserContext(ids.client);
  assert.equal(ls?.userId, ids.ls);
  assert.equal(ls?.isLateralSpace, true);
  assert.equal(client?.isLateralSpace, false);
  assert.equal(await app.getUcUserContext(randomUUID()), null);
});
