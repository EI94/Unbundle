import test from "node:test";
import assert from "node:assert/strict";
import { installAppModules, message, recordLogs, THINKING, fakeAppClaude } from "./claude-test-kit.ts";

// (Migrazione a Claude Sonnet 5.5) La rotta vera del caricamento dei documenti (/api/documents/upload) con un PDF:
// che cosa salva (blob, riga, memoria della chat) secondo come risponde il modello. Sessione, database, blob e
// memoria finti; il modello è il Claude finto di claude-test-kit.ts, senza rete.

type Prova = { blobs: number; inserted: Array<Record<string, unknown>>; indexed: number };
const prova: Prova = { blobs: 0, inserted: [], indexed: 0 };
(globalThis as { __prova?: Prova }).__prova = prova;

await installAppModules({
  "@/lib/auth": `export async function auth() { return { user: { id: "utente-prova" } }; }`,
  "@/lib/workspace-access": `export async function getCollaboratorAccess() { return { role: "transformation_lead", workspace: { id: "ws-prova" } }; }`,
  "@/lib/db/schema": `export const uploadedDocuments = {};`,
  "@/lib/db": `export const db = {
    insert: () => ({ values: (row) => ({ returning: async () => { globalThis.__prova.inserted.push(row); return [{ id: "doc-prova", fileName: row.fileName, summary: row.summary }]; } }) }),
  };`,
  "@vercel/blob": `export async function put() { globalThis.__prova.blobs += 1; return { url: "https://blob.example.test/documento.pdf" }; }`,
  "@/lib/ai/rag/chunker": `export async function indexDocument() { globalThis.__prova.indexed += 1; }`,
});
const { POST } = await import("../../app/api/documents/upload/route.ts");

/** Il caricamento di un PDF, come lo fa il browser. */
function upload() {
  const form = new FormData();
  form.set("file", new File([new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52])], "organigramma.pdf", { type: "application/pdf" }));
  form.set("workspaceId", "ws-prova");
  return POST(new Request("http://localhost/api/documents/upload", { method: "POST", body: form }));
}

function reset() {
  prova.blobs = 0;
  prova.inserted = [];
  prova.indexed = 0;
}

const UNREADABLE = { error: "Non riesco a leggere il testo di questo PDF." };

test("il limite dei token finito nel ragionamento (nessun testo, «length»): 422 come un rifiuto, niente salvato", async (t) => {
  const lines = recordLogs(t);
  reset();
  const requests = fakeAppClaude([message([THINKING], "max_tokens")]);
  const response = await upload();
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), UNREADABLE);
  assert.equal(requests.length, 1, "nessuna sintesi");
  assert.deepEqual({ blobs: prova.blobs, inserted: prova.inserted.length, indexed: prova.indexed }, { blobs: 0, inserted: 0, indexed: 0 });
  assert.deepEqual(lines, ['[documents/upload] pdf_senza_testo {"finishReason":"length","category":null}']);
});

test("una risposta finita ma vuota (solo spazi): 422, niente salvato", async (t) => {
  recordLogs(t);
  reset();
  fakeAppClaude([message([THINKING, { type: "text", text: "  \n " }])]);
  const response = await upload();
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), UNREADABLE);
  assert.deepEqual({ blobs: prova.blobs, inserted: prova.inserted.length, indexed: prova.indexed }, { blobs: 0, inserted: 0, indexed: 0 });
});
