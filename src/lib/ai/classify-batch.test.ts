import test from "node:test";
import assert from "node:assert/strict";
import { installAppModules, message, recordLogs, refusal, THINKING, fakeAppClaude, type Reply } from "./claude-test-kit.ts";

// (Migrazione a Claude Sonnet 5.5) La classificazione nei tre stream: un rifiuto o un errore del modello su
// un'attività non fa perdere le altre. Moduli veri (classify.ts, il tool della chat, l'azione), database e sessione
// finti; il modello è il Claude finto di claude-test-kit.ts, che risponde secondo l'attività nel prompt.

type Prova = {
  activities: Array<Record<string, unknown>>;
  classified: Array<[string, string, number]>;
  departmentUpdates: number;
};
const prova: Prova = { activities: [], classified: [], departmentUpdates: 0 };
(globalThis as { __prova?: Prova }).__prova = prova;

await installAppModules({
  "@/lib/auth/redirect-to-login": `export async function requireSession() { return { user: { id: "utente-prova" } }; }`,
  "@/lib/workspace-access": `export async function getCollaboratorAccess() {
    return { role: "transformation_lead", workspace: { id: "ws-prova", organizationId: "org-prova" } };
  }`,
  "next/cache": `export function revalidatePath() {}`,
  "@/lib/db/queries/activities": `
    export async function getActivitiesByWorkspace() { return globalThis.__prova.activities; }
    export async function getActivitiesByDepartment() { return globalThis.__prova.activities; }
    export async function updateActivityClassification(id, classification, confidence) { globalThis.__prova.classified.push([id, classification, confidence]); }
    export async function updateActivity() { throw new Error("updateActivity non atteso"); }`,
  "@/lib/db/queries/workspaces": `
    export async function getWorkspaceById() { return { id: "ws-prova", organizationId: "org-prova" }; }
    export async function getStrategicGoalsByWorkspace() { return []; }`,
  "@/lib/db/schema": `export const organizations = { id: "id" }; export const activities = {}; export const activityDependencies = {}; export const departments = { id: "id" };`,
  "drizzle-orm": `export const eq = (column, value) => ({ column, value });`,
  "@/lib/db": `export const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: "org-prova", companyValueThesis: null }] }) }) }),
    update: () => ({ set: () => ({ where: async () => { globalThis.__prova.departmentUpdates += 1; } }) }),
  };`,
});
const { classifyActivitiesBatch, skippedClassificationsText } = await import("./classify.ts");
const { runClassificationAction } = await import("../actions/classify.ts");
const { getActivityMappingTools } = await import("./tools/activity-mapping-tools.ts");

/** Quattro attività (due giri da tre): una rifiutata dopo un JSON completo, una con un errore dell'API. */
const ACTIVITIES = [
  { id: "a-1", title: "Fatture mensili", classification: null, onetTaskId: "43-3031.00" },
  { id: "a-2", title: "Revisione contratti riservati", classification: null, onetTaskId: "23-2011.00" },
  { id: "a-3", title: "Riconciliazione banche", classification: null, onetTaskId: "43-3031.00" },
  { id: "a-4", title: "Previsioni di vendita", classification: null, onetTaskId: "13-2051.00" },
];
const ANSWER = { classification: "automate", confidenceScore: 0.8, motivazione: "Ripetitiva, con input chiari.", reasoning: "Ripetitiva, con input chiari.", aiPotential: "Alto" };

/** Risponde secondo l'attività nel prompt: così l'ordine delle chiamate in parallelo non conta. */
const byActivity: Reply = (init) => {
  const prompt = JSON.stringify(JSON.parse(String(init?.body)).messages);
  if (prompt.includes("Revisione contratti riservati")) return refusal([THINKING, { type: "text", text: JSON.stringify(ANSWER) }], "general_harms")();
  if (prompt.includes("Riconciliazione banche")) {
    return Response.json({ type: "error", error: { type: "invalid_request_error", message: "Richiesta non valida (prova)" } }, { status: 400 });
  }
  return message([THINKING, { type: "text", text: JSON.stringify(ANSWER) }])();
};

/** Il tool «Completo mapping» della chat, chiamato come lo chiama streamText. */
async function markDepartmentMapped(summary: string) {
  const { execute } = getActivityMappingTools("ws-prova", "reparto-prova").markDepartmentMapped;
  return (await execute!({ summary }, { toolCallId: "toolu_prova", messages: [] })) as { success: boolean; message: string };
}

function reset() {
  prova.activities = ACTIVITIES.map((a) => ({ ...a }));
  prova.classified = [];
  prova.departmentUpdates = 0;
  return fakeAppClaude(ACTIVITIES.map(() => byActivity));
}

test("classifyActivitiesBatch: tiene le classificazioni riuscite; rifiuto ed errore restano fuori, nel log senza testi", async (t) => {
  const lines = recordLogs(t);
  const requests = reset();
  const results = await classifyActivitiesBatch(prova.activities as never, { companyValueThesis: null, goals: [] });
  assert.equal(requests.length, 4, "una chiamata per attività, nessun nuovo tentativo dopo un 400");
  assert.deepEqual([...results.keys()].sort(), ["a-1", "a-4"]);
  assert.equal(results.get("a-1")?.classification, "automate");
  assert.deepEqual(lines, [
    '[ai/classify] risposta_rifiutata {"finishReason":"content-filter","category":"general_harms"}',
    '[ai/classify] classificazione_non_riuscita {"error":{"name":"AI_APICallError"}}',
  ]);
  for (const line of lines) assert.doesNotMatch(line, /contratti|Riconciliazione|Ripetitiva|prova\)/);
});

test("l'azione «Classifica attività»: scrive le riuscite e dice quante sono rimaste da classificare", async (t) => {
  recordLogs(t);
  reset();
  const result = await runClassificationAction("ws-prova");
  assert.deepEqual(prova.classified, [
    ["a-1", "automate", 0.8],
    ["a-4", "automate", 0.8],
  ]);
  assert.deepEqual(result, { classified: 2, skipped: 2, skippedText: "2 attività sono rimaste da classificare.", total: 4 });
});

test("il tool della chat «Completo mapping»: scrive le riuscite e lo dice al modello, con le attività rimaste", async (t) => {
  recordLogs(t);
  reset();
  const result = await markDepartmentMapped("Mappate quattro attività.");
  assert.equal(prova.departmentUpdates, 1);
  assert.deepEqual(prova.classified.map(([id]) => id), ["a-1", "a-4"]);
  assert.equal(
    result.message,
    "Dipartimento segnato come mappato. Mappate quattro attività. Classificazione completata: 2 Automate, 0 Differentiate, 0 Innovate. 2 attività sono rimaste da classificare.",
  );
});

test("il tool della chat, se nessuna classificazione riesce: il messaggio di prima, niente scritto", async (t) => {
  recordLogs(t);
  reset();
  prova.activities = [ACTIVITIES[1], ACTIVITIES[2]].map((a) => ({ ...a }));
  const result = await markDepartmentMapped("Due attività.");
  assert.deepEqual(prova.classified, []);
  assert.match(result.message, /Classificazione non riuscita — verrà riprovata manualmente\.$/);
});

test("le parole delle attività rimaste", () => {
  assert.equal(skippedClassificationsText(0), "");
  assert.equal(skippedClassificationsText(1), "1 attività è rimasta da classificare.");
  assert.equal(skippedClassificationsText(3), "3 attività sono rimaste da classificare.");
});
