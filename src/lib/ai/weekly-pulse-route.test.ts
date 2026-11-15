import test from "node:test";
import assert from "node:assert/strict";
import { installAppModules, message, recordLogs, refusal, THINKING, fakeAppClaude, type Reply } from "./claude-test-kit.ts";

// (Migrazione a Claude Sonnet 5.5) Il cron weekly-pulse, la rotta vera: un rifiuto o un errore del modello su un
// workspace non ferma gli altri, e nel log del workspace va solo l'id, niente del nome o dei segnali. Database finto; il
// modello è il Claude finto di claude-test-kit.ts, che risponde secondo il nome del workspace nel prompt.

type Prova = { workspaces: Array<Record<string, unknown>>; inserted: Array<Record<string, unknown>> };
const prova: Prova = { workspaces: [], inserted: [] };
(globalThis as { __prova?: Prova }).__prova = prova;

await installAppModules({
  "@/lib/db/schema": `export const workspaces = { table: "workspaces", status: "status" };
    export const activities = { table: "activities", workspaceId: "workspace_id" };
    export const weeklySignals = { table: "weekly_signals" };`,
  "drizzle-orm": `export const eq = (column, value) => ({ column, value }); export const and = (...parts) => ({ and: parts });`,
  "@/lib/db": `export const db = {
    select: () => ({ from: (table) => ({ where: async () => (table.table === "workspaces" ? globalThis.__prova.workspaces : []) }) }),
    insert: () => ({ values: async (row) => { globalThis.__prova.inserted.push(row); } }),
  };`,
  "@/lib/db/queries/use-case-digest": `export async function runUseCaseDigestStep() { return { workspaces: 0, signals: 0, failed: 0 }; }`,
});
const { GET } = await import("../../app/api/cron/weekly-pulse/route.ts");

const SECRET = "segreto-del-cron-di-prova";
process.env.CRON_SECRET = SECRET;
const cron = () => new Request("http://localhost/api/cron/weekly-pulse", { headers: { authorization: `Bearer ${SECRET}` } });

const SIGNALS = { signals: [{ signalType: "progress_update", title: "Mappatura avanzata", description: "Segnale riservato del cliente." }] };

/** Il primo workspace è rifiutato dopo un JSON completo, il secondo riceve un 400, il terzo riesce. */
const byWorkspace: Reply = (init) => {
  const prompt = JSON.stringify(JSON.parse(String(init?.body)).messages);
  if (prompt.includes("Cliente Rifiutato")) return refusal([THINKING, { type: "text", text: JSON.stringify(SIGNALS) }], "general_harms")();
  if (prompt.includes("Cliente Errore")) {
    return Response.json({ type: "error", error: { type: "invalid_request_error", message: "Richiesta non valida (prova)" } }, { status: 400 });
  }
  return message([THINKING, { type: "text", text: JSON.stringify(SIGNALS) }])();
};

test("un rifiuto e un errore non fermano il ciclo: il terzo workspace riceve i suoi segnali; 200 con i falliti, nel log lo stato", async (t) => {
  const lines = recordLogs(t);
  prova.workspaces = [
    { id: "ws-rifiutato", name: "Cliente Rifiutato", status: "mapping" },
    { id: "ws-errore", name: "Cliente Errore", status: "mapping" },
    { id: "ws-ok", name: "Cliente Riuscito", status: "mapping" },
  ];
  prova.inserted = [];
  const requests = fakeAppClaude(prova.workspaces.map(() => byWorkspace));
  const response = await GET(cron());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { processed: 3, failed: 2, useCaseHub: { workspaces: 0, signals: 0, failed: 0 } });
  assert.equal(requests.length, 3, "un tentativo per workspace");
  assert.deepEqual(prova.inserted, [{ workspaceId: "ws-ok", ...SIGNALS.signals[0] }], "solo i segnali del workspace riuscito");
  assert.deepEqual(lines, [
    '[cron/weekly-pulse] risposta_rifiutata {"workspaceId":"ws-rifiutato","finishReason":"content-filter","category":"general_harms"}',
    '[cron/weekly-pulse] segnali_non_generati {"workspaceId":"ws-errore","error":{"name":"AI_APICallError","statusCode":400}}',
  ]);
  for (const line of lines) assert.doesNotMatch(line, /Cliente|riservato|Mappatura|prova\)/);
});

test("un rifiuto prima di scrivere o a metà JSON (generateObject lancia): nel log come rifiuto, con la categoria e l'id del workspace", async (t) => {
  const lines = recordLogs(t);
  prova.workspaces = [
    { id: "ws-1", name: "Cliente Uno", status: "mapping" },
    { id: "ws-2", name: "Cliente Due", status: "mapping" },
    { id: "ws-3", name: "Cliente Tre", status: "mapping" },
  ];
  prova.inserted = [];
  fakeAppClaude([
    refusal([], "bio"),
    refusal([THINKING, { type: "text", text: '{"signals":[{"signalType":"risk_alert","title":"Rischio riserv' }], "cyber"),
    message([THINKING, { type: "text", text: JSON.stringify(SIGNALS) }]),
  ]);
  const response = await GET(cron());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { processed: 3, failed: 2, useCaseHub: { workspaces: 0, signals: 0, failed: 0 } });
  assert.deepEqual(prova.inserted, [{ workspaceId: "ws-3", ...SIGNALS.signals[0] }]);
  assert.deepEqual(lines, [
    '[cron/weekly-pulse] risposta_rifiutata {"workspaceId":"ws-1","finishReason":"content-filter","category":"bio"}',
    '[cron/weekly-pulse] risposta_rifiutata {"workspaceId":"ws-2","finishReason":"content-filter","category":"cyber"}',
  ]);
  for (const line of lines) assert.doesNotMatch(line, /Cliente|Rischio|riserv/);
});

test("ogni workspace fallisce (il modello risponde 404, come da ritirato): 500 con lo stesso corpo, e nel log lo stato", async (t) => {
  const lines = recordLogs(t);
  prova.workspaces = [
    { id: "ws-1", name: "Cliente Uno", status: "mapping" },
    { id: "ws-2", name: "Cliente Due", status: "mapping" },
  ];
  prova.inserted = [];
  const notFound: Reply = () =>
    Response.json({ type: "error", error: { type: "not_found_error", message: "model: claude-sonnet-5-5" } }, { status: 404 });
  const requests = fakeAppClaude([notFound, notFound]);
  const response = await GET(cron());
  assert.equal(response.status, 500, "il giro risulta fallito nei log del cron");
  assert.deepEqual(await response.json(), { processed: 2, failed: 2, useCaseHub: { workspaces: 0, signals: 0, failed: 0 } });
  assert.equal(requests.length, 2, "un 404 non si ritenta");
  assert.deepEqual(prova.inserted, []);
  assert.deepEqual(lines, [
    '[cron/weekly-pulse] segnali_non_generati {"workspaceId":"ws-1","error":{"name":"AI_APICallError","statusCode":404}}',
    '[cron/weekly-pulse] segnali_non_generati {"workspaceId":"ws-2","error":{"name":"AI_APICallError","statusCode":404}}',
  ]);
});

test("nessun workspace in mapping: 200, niente da fare", async () => {
  prova.workspaces = [];
  const requests = fakeAppClaude([]);
  const response = await GET(cron());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { processed: 0, failed: 0, useCaseHub: { workspaces: 0, signals: 0, failed: 0 } });
  assert.equal(requests.length, 0);
});

test("senza il segreto del cron: 401 e nessuna chiamata al modello", async () => {
  const requests = fakeAppClaude([]);
  const response = await GET(new Request("http://localhost/api/cron/weekly-pulse"));
  assert.equal(response.status, 401);
  assert.equal(requests.length, 0);
});
