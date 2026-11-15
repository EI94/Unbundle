import test from "node:test";
import assert from "node:assert/strict";

// (Migrazione a Claude Sonnet 5.5) deleteMessage, la query con cui la chat toglie la domanda che il modello ha
// rifiutato: un messaggio solo, e solo dentro la conversazione data. Nessun database: la fetch del driver Neon è finta,
// registra la query e risponde come l'endpoint HTTP di Neon.

process.env.DATABASE_URL = "postgresql://prova:prova@127.0.0.1:9/prova";
await import(new URL("../../../../scripts/use-case-test/test-hooks.mjs", import.meta.url).href);
const { deleteMessage } = await import("./conversations.ts");

test("deleteMessage toglie il messaggio solo se è della conversazione data", async (t) => {
  const queries: Array<{ query: string; params: unknown[] }> = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    queries.push(JSON.parse(String(init?.body)) as { query: string; params: unknown[] });
    return Response.json({ command: "DELETE", rowCount: 1, rows: [], fields: [] });
  });
  await deleteMessage("conv-prova", "msg-prova");
  assert.equal(queries.length, 1);
  const [{ query, params }] = queries;
  assert.match(query, /^delete from "messages" where \("messages"\."id" = \$(\d) and "messages"\."conversation_id" = \$(\d)\)$/);
  const [, idAt, conversationAt] = /"id" = \$(\d) and "messages"\."conversation_id" = \$(\d)/.exec(query)!;
  assert.equal(params[Number(idAt) - 1], "msg-prova");
  assert.equal(params[Number(conversationAt) - 1], "conv-prova");
});
