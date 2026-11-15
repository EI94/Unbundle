import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { hang, installAppModules, message, recordLogs, refusal, THINKING, fakeAppClaude } from "./claude-test-kit.ts";
import { MIN_MODEL_CALL_MS, WEB_SEARCH_TIMEOUT_MS } from "./models.ts";

// (Migrazione a Claude Sonnet 5.5) Il tool vero della ricerca web della chat: un rifiuto e una ricerca più lenta
// del tempo massimo (45 secondi, o meno se la scadenza della chat è più vicina) finiscono come «ricerca non
// disponibile», mai con un riassunto parziale né con il turno della chat scaduto. Il modello è il Claude finto di
// claude-test-kit.ts, senza rete.

await installAppModules({});
const { getWebSearchTool } = await import("./tools/web-search-tool.ts");

type SearchResult = { success: boolean; reason: string; summary: string };

/** Una scadenza della chat lontana: la ricerca ha i suoi 45 secondi. */
const FAR = () => Date.now() + 10 * 60_000;

/** Il tool, costruito con la scadenza della richiesta come nella rotta, chiamato come lo chiama streamText. */
async function search(query: string, deadline = FAR()): Promise<SearchResult> {
  const { execute } = getWebSearchTool({ deadline }).webSearch;
  return (await execute!({ query, reason: "contesto del cliente" }, { toolCallId: "toolu_prova", messages: [] })) as SearchResult;
}

/** AbortSignal.timeout registra il tempo chiesto e scade dopo 30 ms, così il test non aspetta. */
function shortTimeouts(t: TestContext): number[] {
  const requested: number[] = [];
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, "timeout", (ms: number) => {
    requested.push(ms);
    return timeout(30);
  });
  return requested;
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
  const lines = recordLogs(t);
  const requested = shortTimeouts(t);
  const requests = fakeAppClaude([hang]);
  const started = Date.now();
  assert.deepEqual(await search("Acme"), UNAVAILABLE);
  assert.deepEqual(requested, [WEB_SEARCH_TIMEOUT_MS], "il tempo massimo chiesto è quello di models.ts");
  assert.equal(WEB_SEARCH_TIMEOUT_MS, 45_000);
  assert.equal(requests.length, 1, "nessun nuovo tentativo dopo l'interruzione");
  assert.ok(requests[0].signal?.aborted, "la richiesta è stata interrotta");
  assert.ok(Date.now() - started < 5_000);
  assert.deepEqual(lines, ['[web-search-tool] tempo_scaduto {"timeoutMs":45000}'], "nel log il tempo scaduto, niente della ricerca");
});

test("con la scadenza della chat più vicina di 45 secondi, la ricerca ha solo il tempo che resta (almeno qualche secondo)", async (t) => {
  recordLogs(t);
  const requested = shortTimeouts(t);
  fakeAppClaude([hang, hang]);
  assert.deepEqual(await search("Acme", Date.now() + 20_000), UNAVAILABLE);
  assert.ok(requested[0] > 19_000 && requested[0] <= 20_000, `chiesti ${requested[0]} ms`);
  assert.deepEqual(await search("Acme", Date.now() - 1_000), UNAVAILABLE);
  assert.equal(requested[1], MIN_MODEL_CALL_MS, "a scadenza passata, il minimo");
});

test("il tempo della ricerca si conta quando parte, non quando la rotta costruisce il tool", async (t) => {
  recordLogs(t);
  const requested = shortTimeouts(t);
  fakeAppClaude([hang, hang]);
  const start = Date.now();
  // La rotta costruisce il tool all'inizio della richiesta, con la scadenza tra 60 secondi...
  const { execute } = getWebSearchTool({ deadline: start + 60_000 }).webSearch;
  const options = { toolCallId: "toolu_prova", messages: [] };
  // ...e il modello lo chiama dopo 30 secondi: restano 30 secondi, meno dei 45 della ricerca.
  const now = t.mock.method(Date, "now", () => start + 30_000);
  assert.deepEqual(await execute!({ query: "Acme", reason: "contesto del cliente" }, options), UNAVAILABLE);
  // Dopo 50 secondi la seconda ricerca dello stesso turno: ne restano 10.
  now.mock.mockImplementation(() => start + 50_000);
  assert.deepEqual(await execute!({ query: "Acme", reason: "contesto del cliente" }, options), UNAVAILABLE);
  assert.deepEqual(requested, [30_000, 10_000]);
});

test("un errore dell'API: «non disponibile»; nel log nome e stato, mai la ricerca", async (t) => {
  const lines = recordLogs(t);
  fakeAppClaude([() => Response.json({ type: "error", error: { type: "invalid_request_error", message: "Richiesta non valida: Acme Bulloni SpA" } }, { status: 400 })]);
  assert.deepEqual(await search("Acme Bulloni SpA"), UNAVAILABLE);
  assert.deepEqual(lines, ['[web-search-tool] ricerca_non_riuscita {"error":{"name":"AI_APICallError","statusCode":400}}']);
});
