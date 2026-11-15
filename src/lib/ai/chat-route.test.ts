import test from "node:test";
import assert from "node:assert/strict";
import { ev, installAppModules, recordLogs, sse, fakeAppClaude } from "./claude-test-kit.ts";

// (Migrazione a Claude Sonnet 5.5) La rotta vera della chat (/api/ai/chat): che cosa salva, che cosa mette nella
// memoria della chat (RAG) e che cosa manda al browser. Sessione, database, memoria e tool dei reparti finti; il
// modello è il Claude finto di claude-test-kit.ts, senza rete.

type Saved = { conversationId: string; role: string; content: string };
type Prova = { saved: Saved[]; indexed: Array<[string, string]>; tools: Record<string, unknown> };
const prova: Prova = { saved: [], indexed: [], tools: {} };
(globalThis as { __prova?: Prova }).__prova = prova;

await installAppModules({
  "@/lib/auth": `export async function auth() { return { user: { id: "utente-prova", email: "persona@cliente.test", emailVerified: true } }; }`,
  "@/lib/workspace-access": `export async function getCollaboratorAccess() {
    return { role: "transformation_lead", workspace: { id: "ws-prova", organizationId: "org-prova", unitTerminology: null, systemBoundary: null } };
  }`,
  "@/lib/db/queries/use-case-program": `export function canEditProgram() { return false; }`,
  "@/lib/db/queries/use-case-hub": `export function viewerFromSession() { return { isLateralSpace: false }; }`,
  "@/lib/ai/tools/leadership-tools": `export function getLeadershipTools() { return globalThis.__prova.tools; }`,
  "@/lib/ai/tools/activity-mapping-tools": `export function getActivityMappingTools() { return globalThis.__prova.tools; }`,
  "@/lib/db/queries/conversations": `
    export async function getActiveConversation() { return { id: "conv-prova" }; }
    export async function createConversation() { return { id: "conv-prova" }; }
    export async function saveMessage(message) { globalThis.__prova.saved.push(message); }`,
  "@/lib/ai/rag/retriever": `
    export async function retrieveRelevantContext() { return []; }
    export function indexConversationMessage(conversationId, workspaceId, content, role) { globalThis.__prova.indexed.push([role, content]); return Promise.resolve(); }`,
  "@/lib/db/schema": `export const uploadedDocuments = {}; export const organizations = {}; export const activities = {};`,
  "drizzle-orm": `export const eq = (column, value) => ({ column, value }); export const and = (...parts) => ({ and: parts });`,
  "@/lib/db": `export const db = {
    select: () => ({ from: () => ({ where: () => Object.assign(Promise.resolve([]), { limit: async () => [{ id: "org-prova", companyValueThesis: null }] }) }) }),
  };`,
});
const { POST } = await import("../../app/api/ai/chat/route.ts");

type Chunk = { type: string; [key: string]: unknown };

/** POST alla rotta come lo fa il browser; legge tutta la risposta (onFinish è già girato quando lo stream finisce). */
async function chat(messages: unknown[], conversationType = "leadership_setup") {
  const response = await POST(
    new Request("http://localhost/api/ai/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: "ws-prova", conversationType, messages }),
    }),
  );
  const raw = await response.text();
  const chunks: Chunk[] =
    response.status === 200
      ? raw
          .split("\n\n")
          .map((event) => event.replace(/^data: /, "").trim())
          .filter((data) => data && data !== "[DONE]")
          .map((data) => JSON.parse(data) as Chunk)
      : [];
  return { status: response.status, raw, chunks };
}

function reset() {
  prova.saved = [];
  prova.indexed = [];
  prova.tools = {};
}

const HISTORY = [
  { role: "assistant", content: "Benvenuto: di che cosa ti occupi?" },
  { role: "user", content: "Preparo le fatture dei clienti ogni mese." },
];

test("un rifiuto a metà risposta: niente salvato dell'assistente, niente nella memoria, il browser riceve «content-filter»", async (t) => {
  const lines = recordLogs(t);
  reset();
  fakeAppClaude([
    sse([ev.start("msg_1"), ...ev.thinking(0, "firma-A"), ...ev.text(1, "Ecco come si fa: per prima"), ...ev.end("refusal", { stop_details: { type: "refusal", category: "cyber", explanation: null } })]),
  ]);
  const { status, chunks } = await chat(HISTORY);
  assert.equal(status, 200);
  const finish = chunks.find((chunk) => chunk.type === "finish");
  assert.deepEqual(finish, { type: "finish", finishReason: "content-filter", messageMetadata: { finishReason: "content-filter" } });
  // La domanda dell'utente si salva prima della chiamata, come sempre; la risposta rifiutata no.
  assert.deepEqual(prova.saved, [{ conversationId: "conv-prova", role: "user", content: "Preparo le fatture dei clienti ogni mese." }]);
  assert.deepEqual(prova.indexed, [], "il turno rifiutato non entra nella memoria della chat");
  assert.deepEqual(lines, ['[chat/route] risposta_rifiutata {"finishReason":"content-filter","category":"cyber"}']);
});

test("una risposta normale: salvata e messa nella memoria con la domanda; il browser riceve «stop» (controllo)", async (t) => {
  recordLogs(t);
  reset();
  fakeAppClaude([sse([ev.start("msg_1"), ...ev.thinking(0, "firma-A"), ...ev.text(1, "Ogni quanto le prepari?"), ...ev.end("end_turn")])]);
  const { status, chunks } = await chat(HISTORY);
  assert.equal(status, 200);
  assert.deepEqual(chunks.find((chunk) => chunk.type === "finish"), { type: "finish", finishReason: "stop", messageMetadata: { finishReason: "stop" } });
  assert.deepEqual(
    prova.saved.map(({ role, content }) => [role, content]),
    [
      ["user", "Preparo le fatture dei clienti ogni mese."],
      ["assistant", "Ogni quanto le prepari?"],
    ],
  );
  assert.deepEqual(prova.indexed, [
    ["assistant", "Ogni quanto le prepari?"],
    ["user", "Preparo le fatture dei clienti ogni mese."],
  ]);
});
