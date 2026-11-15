import test from "node:test";
import assert from "node:assert/strict";
import { hang, installAppModules, message, recordLogs, refusal, THINKING, fakeAppClaude } from "./claude-test-kit.ts";
import { WEB_SEARCH_TIMEOUT_MS } from "./models.ts";

// (Migrazione a Claude Sonnet 5.5) Il tool vero della ricerca web della chat: un rifiuto e una ricerca più lenta
// del tempo massimo finiscono come «ricerca non disponibile», mai con un riassunto parziale né con il turno della
// chat scaduto. Il modello è il Claude finto di claude-test-kit.ts, senza rete.

await installAppModules({});
const { getWebSearchTool } = await import("./tools/web-search-tool.ts");

type SearchResult = { success: boolean; reason: string; summary: string };

/** Il tool chiamato come lo chiama streamText. */
async function search(query: string): Promise<SearchResult> {
  const { execute } = getWebSearchTool().webSearch;
  return (await execute!({ query, reason: "contesto del cliente" }, { toolCallId: "toolu_prova", messages: [] })) as SearchResult;
}

const UNAVAILABLE = { success: false, reason: "contesto del cliente", summary: "Ricerca non disponibile al momento. Prosegui senza." };

test("ricerca riuscita: il riassunto, sforzo basso, il tool di ricerca dell'API e un tempo massimo (controllo)", async (t) => {
  recordLogs(t);
  const requests = fakeAppClaude([message([THINKING, { type: "text", text: "Acme produce bulloni a Brescia." }])]);
  assert.deepEqual(await search("Acme"), { success: true, reason: "contesto del cliente", summary: "Acme produce bulloni a Brescia." });
  const [request] = requests;
  assert.equal((request.body.output_config as { effort?: string }).effort, "low");
  assert.deepEqual((request.body.tools as Array<{ type: string }>).map((tool) => tool.type), ["web_search_20250305"]);
  assert.ok(request.signal, "la ricerca ha un tempo massimo");
});

test("ricerca rifiutata, anche con un riassunto parziale: «non disponibile», nel log solo motivo e categoria", async (t) => {
  const lines = recordLogs(t);
  fakeAppClaude([refusal([{ type: "text", text: "Ecco i dati riservati di Acme: fattur" }], "cyber")]);
  assert.deepEqual(await search("Acme"), UNAVAILABLE);
  assert.deepEqual(lines, ['[web-search-tool] ricerca_rifiutata {"finishReason":"content-filter","category":"cyber"}']);
});

test("ricerca più lenta del tempo massimo (45 secondi, qui accorciati): si interrompe e risponde «non disponibile»", async (t) => {
  recordLogs(t);
  const requested: number[] = [];
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, "timeout", (ms: number) => {
    requested.push(ms);
    return timeout(30);
  });
  const requests = fakeAppClaude([hang]);
  const started = Date.now();
  assert.deepEqual(await search("Acme"), UNAVAILABLE);
  assert.deepEqual(requested, [WEB_SEARCH_TIMEOUT_MS], "il tempo massimo chiesto è quello di models.ts");
  assert.equal(WEB_SEARCH_TIMEOUT_MS, 45_000);
  assert.equal(requests.length, 1, "nessun nuovo tentativo dopo l'interruzione");
  assert.ok(requests[0].signal?.aborted, "la richiesta è stata interrotta");
  assert.ok(Date.now() - started < 5_000);
});
