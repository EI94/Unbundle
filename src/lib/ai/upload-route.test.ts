import test from "node:test";
import assert from "node:assert/strict";
import { installAppModules, message, recordLogs, refusal, THINKING, fakeAppClaude } from "./claude-test-kit.ts";

// (Migrazione a Claude Sonnet 5.5) La rotta vera del caricamento dei documenti (/api/documents/upload) con un PDF:
// che cosa salva (blob, riga, memoria della chat) secondo come risponde il modello. Sessione, database, blob e
// memoria finti; il modello è il Claude finto di claude-test-kit.ts, senza rete.

type Prova = {
  blobs: number;
  /** Gli indirizzi dei blob cancellati. */
  deletedBlobs: string[];
  inserted: Array<Record<string, unknown>>;
  indexed: number;
  /** Se ci sono, l'inserimento della riga e la cancellazione del blob falliscono con questi errori. */
  insertError?: Error;
  deleteError?: Error;
};
const prova: Prova = { blobs: 0, deletedBlobs: [], inserted: [], indexed: 0 };
(globalThis as { __prova?: Prova }).__prova = prova;

await installAppModules({
  "@/lib/auth": `export async function auth() { return { user: { id: "utente-prova" } }; }`,
  "@/lib/workspace-access": `export async function getCollaboratorAccess() { return { role: "transformation_lead", workspace: { id: "ws-prova" } }; }`,
  "@/lib/db/schema": `export const uploadedDocuments = {};`,
  "@/lib/db": `export const db = {
    insert: () => ({ values: (row) => ({ returning: async () => {
      if (globalThis.__prova.insertError) throw globalThis.__prova.insertError;
      globalThis.__prova.inserted.push(row);
      return [{ id: "doc-prova", fileName: row.fileName, summary: row.summary }];
    } }) }),
  };`,
  "@vercel/blob": `
    export async function put() { globalThis.__prova.blobs += 1; return { url: "https://blob.example.test/documento.pdf" }; }
    export async function del(url) {
      if (globalThis.__prova.deleteError) throw globalThis.__prova.deleteError;
      globalThis.__prova.deletedBlobs.push(url);
    }`,
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
  prova.deletedBlobs = [];
  prova.inserted = [];
  prova.indexed = 0;
  delete prova.insertError;
  delete prova.deleteError;
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

test("un PDF rifiutato dai classificatori (anche con del testo parziale): 422, niente salvato, nel log solo motivo e categoria", async (t) => {
  const lines = recordLogs(t);
  reset();
  const requests = fakeAppClaude([refusal([{ type: "text", text: "Organigramma riservato: direzione, ammini" }], "general_harms")]);
  const response = await upload();
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), UNREADABLE);
  assert.equal(requests.length, 1);
  assert.deepEqual({ blobs: prova.blobs, inserted: prova.inserted.length, indexed: prova.indexed }, { blobs: 0, inserted: 0, indexed: 0 });
  assert.deepEqual(lines, ['[documents/upload] pdf_rifiutato {"finishReason":"content-filter","category":"general_harms"}']);
});

test("un PDF troncato al limite dei token ma con del testo: 200, si tiene l'inizio, con sintesi e memoria; nel log «troncato»", async (t) => {
  const lines = recordLogs(t);
  reset();
  const text = "Organigramma: direzione generale, amministrazione, vendite. ".repeat(4);
  const requests = fakeAppClaude([
    message([THINKING, { type: "text", text }], "max_tokens"),
    message([THINKING, { type: "text", text: "- Tre funzioni principali." }]),
  ]);
  const response = await upload();
  assert.equal(response.status, 200);
  const body = (await response.json()) as { id: string; summary: string; extractedText: string };
  assert.deepEqual(
    { id: body.id, summary: body.summary, extractedText: body.extractedText },
    { id: "doc-prova", summary: "- Tre funzioni principali.", extractedText: text },
  );
  assert.equal(requests.length, 2, "testo e sintesi");
  assert.equal(prova.blobs, 1);
  assert.deepEqual(prova.inserted.map((row) => [row.fileName, row.extractedText, row.summary]), [["organigramma.pdf", text, "- Tre funzioni principali."]]);
  assert.equal(prova.indexed, 1);
  assert.deepEqual(prova.deletedBlobs, []);
  assert.deepEqual(lines, ['[documents/upload] pdf_troncato {"finishReason":"length","category":null}']);
});

const TEXT = "Organigramma riservato: direzione generale, amministrazione, vendite. ".repeat(4);
/** Un errore del database con il testo del documento nel messaggio, come quelli di Neon. */
const dbError = () => Object.assign(new Error(`duplicate key value: ${TEXT}`), { name: "NeonDbError", code: "23505" });

test("la sintesi non riesce: 500, nessun blob salvato (il file si salva subito prima della riga), nel log niente del testo", async (t) => {
  const lines = recordLogs(t);
  reset();
  const requests = fakeAppClaude([
    message([THINKING, { type: "text", text: TEXT }]),
    () => Response.json({ type: "error", error: { type: "invalid_request_error", message: `Richiesta non valida: ${TEXT}` } }, { status: 400 }),
  ]);
  const response = await upload();
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Errore durante l'upload" });
  assert.equal(requests.length, 2);
  assert.deepEqual({ blobs: prova.blobs, inserted: prova.inserted.length, indexed: prova.indexed }, { blobs: 0, inserted: 0, indexed: 0 });
  assert.deepEqual(lines, ['[documents/upload] upload_non_riuscito {"error":{"name":"AI_APICallError","statusCode":400}}']);
});

test("la riga non si scrive: il blob appena salvato si cancella, 500, nel log niente del testo", async (t) => {
  const lines = recordLogs(t);
  reset();
  prova.insertError = dbError();
  fakeAppClaude([message([THINKING, { type: "text", text: TEXT }]), message([THINKING, { type: "text", text: "- Tre funzioni." }])]);
  const response = await upload();
  assert.equal(response.status, 500);
  assert.equal(prova.blobs, 1);
  assert.deepEqual(prova.deletedBlobs, ["https://blob.example.test/documento.pdf"], "nessun blob privato senza il suo documento");
  assert.equal(prova.indexed, 0);
  assert.deepEqual(lines, ['[documents/upload] upload_non_riuscito {"error":{"name":"NeonDbError","code":"23505"}}']);
});

test("la riga non si scrive e nemmeno la cancellazione riesce: 500, due righe di log senza testo; quella del blob con l'id del workspace", async (t) => {
  const lines = recordLogs(t);
  reset();
  prova.insertError = dbError();
  prova.deleteError = Object.assign(new Error(`Blob non trovato: ${TEXT}`), { name: "BlobError" });
  fakeAppClaude([message([THINKING, { type: "text", text: TEXT }]), message([THINKING, { type: "text", text: "- Tre funzioni." }])]);
  const response = await upload();
  assert.equal(response.status, 500);
  assert.deepEqual(lines, [
    // Il blob orfano si cerca dall'id del workspace: nel log mai il nome del file, il percorso o l'indirizzo del blob.
    '[documents/upload] blob_non_cancellato {"workspaceId":"ws-prova","error":{"name":"BlobError"}}',
    '[documents/upload] upload_non_riuscito {"error":{"name":"NeonDbError","code":"23505"}}',
  ]);
  for (const line of lines) assert.doesNotMatch(line, /organigramma|riservato|documento\.pdf|blob\.example|documents\/ws-prova/i);
});
