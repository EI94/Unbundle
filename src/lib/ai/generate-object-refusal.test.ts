import test from "node:test";
import assert from "node:assert/strict";
import { installAppModules, message, recordLogs, refusal, THINKING, useAppClaude } from "./claude-test-kit.ts";
import { ClaudeRefusalError } from "./models.ts";

// (Migrazione a Claude Sonnet 5.5) Un rifiuto con il JSON completo, nell'azione vera della value map: l'oggetto
// non si usa e niente si scrive (la value map cancella e riscrive i nodi del workspace). Database e sessione finti;
// il modello è il Claude finto di claude-test-kit.ts, senza rete.

type Prova = { writes: string[]; activities: unknown[] };
const prova: Prova = { writes: [], activities: [] };
(globalThis as { __prova?: Prova }).__prova = prova;

await installAppModules({
  "@/lib/auth/redirect-to-login": `export async function requireSession() { return { user: { id: "utente-prova" } }; }`,
  "@/lib/workspace-access": `export async function getCollaboratorAccess() {
    return { role: "transformation_lead", workspace: { id: "ws-prova", organizationId: "org-prova" } };
  }`,
  "@/lib/db/queries/activities": `export async function getActivitiesByWorkspace() { return globalThis.__prova.activities; }`,
  "@/lib/db/schema": `export const valueMapNodes = { workspaceId: "workspace_id" }; export const organizations = { id: "id" };`,
  "drizzle-orm": `export const eq = (column, value) => ({ column, value });`,
  "@/lib/db": `export const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    delete: () => ({ where: async () => { globalThis.__prova.writes.push("delete"); } }),
    insert: () => ({ values: async () => { globalThis.__prova.writes.push("insert"); } }),
  };`,
});
const { generateValueMapAction } = await import("../actions/value-map.ts");

const ACTIVITY = { id: "act-1", title: "Fatture del cliente Rossi", description: "Riservato", workType: "delivery", classification: "automate", timeSpentHoursWeek: 4 };
const NODES = { nodes: [{ activityId: "act-1", xMaturity: 0.8, yStrategicValue: 0.2 }] };

test("value map: un rifiuto con i nodi completi non cancella né scrive nulla; nel log solo motivo e categoria", async (t) => {
  const lines = recordLogs(t);
  prova.writes = [];
  prova.activities = [ACTIVITY];
  const requests = useAppClaude([refusal([THINKING, { type: "text", text: JSON.stringify(NODES) }], "general_harms")]);
  await assert.rejects(generateValueMapAction("ws-prova"), (error: unknown) => error instanceof ClaudeRefusalError);
  assert.equal(requests.length, 1);
  assert.deepEqual(prova.writes, [], "nessun delete, nessun insert");
  assert.deepEqual(lines, ['[actions/value-map] risposta_rifiutata {"finishReason":"content-filter","category":"general_harms"}']);
});

test("value map: la stessa risposta completa, senza rifiuto, cancella e riscrive i nodi (controllo)", async (t) => {
  recordLogs(t);
  prova.writes = [];
  prova.activities = [ACTIVITY];
  useAppClaude([message([THINKING, { type: "text", text: JSON.stringify(NODES) }])]);
  assert.deepEqual(await generateValueMapAction("ws-prova"), { positioned: 1 });
  assert.deepEqual(prova.writes, ["delete", "insert"]);
});
