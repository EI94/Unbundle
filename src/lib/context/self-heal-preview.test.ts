import test from "node:test";
import assert from "node:assert/strict";
import { installAppModules } from "../ai/claude-test-kit.ts";

// La 0038 non parte mai da un'anteprima di Vercel (rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §14): le anteprime usano il
// database di produzione. Il self-heal vero (`ensureDbSchema`), con un database finto che registra le transazioni: in
// un'anteprima tutto il resto gira come prima e la transazione della 0038 non parte; altrove sì.

type Calls = { transactions: string[][] };
const calls: Calls = { transactions: [] };
(globalThis as { __selfHeal?: Calls }).__selfHeal = calls;

await installAppModules({
  // `ensure-schema.ts` importa il database con `import { db } from "."`.
  ".": `export const db = {
    execute: async () => ({ rows: [] }),
    $client: {
      query: (text) => text,
      transaction: async (queries) => { globalThis.__selfHeal.transactions.push(queries.map(String)); return []; },
    },
  };`,
});

const CONTEXT_LOCK = "pg_advisory_xact_lock(hashtext('unbundle:context-ddl'))";
const ranContextDdl = () => calls.transactions.some((queries) => queries.some((query) => query.includes(CONTEXT_LOCK)));

/** Un avvio a freddo: il modulo nuovo (lo stato del self-heal è per processo), con `VERCEL_ENV` come in quell'ambiente. */
async function coldStart(vercelEnv: string | undefined, tag: string) {
  calls.transactions = [];
  if (vercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = vercelEnv;
  const { ensureDbSchema } = (await import(`../db/ensure-schema.ts?avvio=${tag}`)) as typeof import("../db/ensure-schema.ts");
  await ensureDbSchema();
}

test("in un'anteprima di Vercel il self-heal non applica la 0038; in produzione e in locale sì", async () => {
  const before = process.env.VERCEL_ENV;
  try {
    await coldStart("preview", "anteprima");
    assert.ok(calls.transactions.length > 0, "il resto del self-heal gira");
    assert.equal(ranContextDdl(), false, "la 0038 no");
    await coldStart("production", "produzione");
    assert.equal(ranContextDdl(), true);
    await coldStart(undefined, "locale");
    assert.equal(ranContextDdl(), true);
  } finally {
    if (before === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = before;
  }
});
