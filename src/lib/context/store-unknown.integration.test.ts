import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { installAppModules, recordLogs } from "../ai/claude-test-kit.ts";

// La sonda della 0038 che non risponde (rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §2.5, §5.2): un errore del database, o
// `ensureDbSchema()` che lancia a freddo. Allora non si sa se la 0038 c'è, né quali documenti sono «Solo Lateral Space»:
// la ricerca della chat e la tesi del valore si chiudono, non si aprono. La sonda qui è finta (`contextStoreState`
// risponde quello che dice la prova); il database è quello vero del pacchetto.
//
// Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su 127.0.0.1). Dati
// sintetici, creati e cancellati qui.
const url = process.env.DATABASE_URL;
const enabled = process.env.HUB_TEST_ISOLATED === "true" && Boolean(url);
if (enabled) {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || process.env.UC_TEST_DATABASE_URL !== url) throw new Error("Hub DB tests need a loopback DATABASE_URL equal to UC_TEST_DATABASE_URL");
  if (!/^\/hub_[a-z0-9][a-z0-9_]{0,39}$/.test(parsed.pathname)) throw new Error("Run this suite only on a package database hub_<id>");
}
const opts = { skip: !enabled };

type Row = Record<string, unknown>;
type StoreState = "pronto" | "assente" | "sconosciuto";
let q: (text: string, params?: unknown[]) => Promise<Row[]>;
const suffix = randomBytes(3).toString("hex");
const ids = { orgMany: randomUUID(), orgOne: randomUUID(), wsA: randomUUID(), wsB: randomUUID(), wsSolo: randomUUID(), user: randomUUID(), shared: randomUUID(), internal: randomUUID() };
const word = `castagno${suffix}`;
const THESIS = { coreValueProposition: `Tesi dell'organizzazione ${suffix}` };

function probe(state: StoreState) {
  (globalThis as { __storeState?: StoreState }).__storeState = state;
}

before(async () => {
  if (!enabled) return;
  await installAppModules({
    "@/lib/db/queries/context-store": `export async function contextStoreState() { return globalThis.__storeState; }
      export async function contextStoreReady() { return globalThis.__storeState === "pronto"; }`,
  });
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Row[]>;
  await (await import("../db/ensure-schema.ts")).ensureDbSchema();
  await q(`INSERT INTO organizations (id, name, slug, company_value_thesis) VALUES ($1, 'Org con due workspace', $2, $5::jsonb), ($3, 'Org con un workspace', $4, $5::jsonb)`, [
    ids.orgMany,
    `org-sonda-m-${suffix}`,
    ids.orgOne,
    `org-sonda-1-${suffix}`,
    JSON.stringify(THESIS),
  ]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $4, 'Cliente A sonda'), ($2, $4, 'Cliente B sonda'), ($3, $5, 'Cliente solo sonda')`, [ids.wsA, ids.wsB, ids.wsSolo, ids.orgMany, ids.orgOne]);
  await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, 'Persona sonda', now())`, [ids.user, `sonda-${suffix}@ls.test`]);
  for (const [doc, visibility, content] of [
    [ids.shared, "tutti", `Il fornitore consegna il ${word} ogni lunedì.`],
    [ids.internal, "ls", `Il margine sul ${word} è riservato, al trentotto per cento.`],
  ] as const) {
    await q(`INSERT INTO uploaded_documents (id, workspace_id, user_id, file_name, file_type, file_size, blob_url, extracted_text, summary) VALUES ($1, $2, $3, 'doc.txt', 'text/plain', 10, $4, $5, '')`, [
      doc,
      ids.wsA,
      ids.user,
      `https://archivio.test/${doc}`,
      content,
    ]);
    await q(`INSERT INTO context_sources (workspace_id, kind, origin, title, occurred_on, document_id, visibility) VALUES ($1, 'documento', 'web', 'Documento', '2026-11-14', $2, $3)`, [ids.wsA, doc, visibility]);
    await q(`INSERT INTO document_chunks (document_id, workspace_id, content, chunk_index) VALUES ($1, $2, $3, 0)`, [doc, ids.wsA, content]);
  }
});

after(async () => {
  if (!enabled) return;
  await q(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [[ids.orgMany, ids.orgOne]]);
  await q(`DELETE FROM users WHERE id = $1`, [ids.user]);
});

test("la ricerca della chat per chi non è di Lateral Space: con la 0038 il filtro, senza la 0038 tutto, con la sonda che non risponde nessun documento", opts, async () => {
  const { retrieveRelevantContext } = await import("../ai/rag/retriever.ts");
  const found = async (isLateralSpace: boolean) =>
    (await retrieveRelevantContext(`quando arriva il ${word}`, ids.wsA, { includeConversations: false, viewer: { isLateralSpace } })).map((chunk) => chunk.documentId).sort();
  probe("pronto");
  assert.deepEqual(await found(false), [ids.shared]);
  assert.deepEqual(await found(true), [ids.internal, ids.shared].sort());
  // Senza la 0038 nessun documento è «Solo Lateral Space» (qui la riga c'è solo perché la sonda è finta).
  probe("assente");
  assert.deepEqual(await found(false), [ids.internal, ids.shared].sort());
  // La sonda non risponde: non si sa quali documenti sono interni, e nessun frammento arriva a chi non è di Lateral Space.
  probe("sconosciuto");
  assert.deepEqual(await found(false), []);
  assert.deepEqual(await found(true), [ids.internal, ids.shared].sort(), "a Lateral Space sì");
});

test("la tesi del valore con la sonda che non risponde: quella dell'organizzazione solo se l'organizzazione ha un workspace solo", opts, async (t) => {
  recordLogs(t);
  const { getWorkspaceValueThesis } = await import("../db/queries/value-thesis.ts");
  probe("sconosciuto");
  assert.equal(await getWorkspaceValueThesis(ids.wsA), null, "due workspace: la tesi dell'organizzazione non è di tutti e due");
  assert.equal(await getWorkspaceValueThesis(ids.wsB), null);
  assert.deepEqual(await getWorkspaceValueThesis(ids.wsSolo), THESIS);
  // Senza la 0038 resta il comportamento di prima: la tesi dell'organizzazione.
  probe("assente");
  assert.deepEqual(await getWorkspaceValueThesis(ids.wsA), THESIS);
  // Con la 0038: quella del workspace (qui nessuna); dell'organizzazione solo con un workspace solo.
  probe("pronto");
  assert.equal(await getWorkspaceValueThesis(ids.wsA), null);
  assert.deepEqual(await getWorkspaceValueThesis(ids.wsSolo), THESIS);
});
