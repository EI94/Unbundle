import test from "node:test";
import assert from "node:assert/strict";
import { hang, installAppModules, message, recordLogs, refusal, THINKING, fakeAppClaude, type Reply } from "./claude-test-kit.ts";
import { MIN_MODEL_CALL_MS } from "./models.ts";

// (Migrazione a Claude Sonnet 5.5) La classificazione nei tre stream: un rifiuto o un errore del modello su
// un'attività non fa perdere le altre. Moduli veri (classify.ts, il tool della chat, l'azione), database e sessione
// finti; il modello è il Claude finto di claude-test-kit.ts, che risponde secondo l'attività nel prompt.

type Prova = {
  activities: Array<Record<string, unknown>>;
  classified: Array<[string, string, number]>;
  /** I match O*NET scritti, per id dell'attività. */
  matched: string[];
  departmentUpdates: number;
};
const prova: Prova = { activities: [], classified: [], matched: [], departmentUpdates: 0 };
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
    export async function updateActivity(id) { globalThis.__prova.matched.push(id); }`,
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
const ANSWER = { classification: "automate", confidenceScore: 0.8, motivazione: "Ripetitiva, con input chiari.", aiPotential: "Alto" };

/** Risponde secondo l'attività nel prompt: così l'ordine delle chiamate in parallelo non conta. */
const byActivity: Reply = (init) => {
  const prompt = JSON.stringify(JSON.parse(String(init?.body)).messages);
  if (prompt.includes("Revisione contratti riservati")) return refusal([THINKING, { type: "text", text: JSON.stringify(ANSWER) }], "general_harms")();
  if (prompt.includes("Riconciliazione banche")) {
    return Response.json({ type: "error", error: { type: "invalid_request_error", message: "Richiesta non valida (prova)" } }, { status: 400 });
  }
  return message([THINKING, { type: "text", text: JSON.stringify(ANSWER) }])();
};

/**
 * Il tool «Completo mapping» della chat, costruito con la scadenza della richiesta come nella rotta (lontana, se non
 * è data) e chiamato come lo chiama streamText.
 */
async function markDepartmentMapped(summary: string, deadline = Date.now() + 10 * 60_000) {
  const { execute } = getActivityMappingTools("ws-prova", "reparto-prova", { deadline }).markDepartmentMapped;
  return (await execute!({ summary }, { toolCallId: "toolu_prova", messages: [] })) as { success: boolean; message: string };
}

function reset() {
  prova.activities = ACTIVITIES.map((a) => ({ ...a }));
  prova.classified = [];
  prova.matched = [];
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
  assert.equal(results.get("a-1")?.reasoning, "Ripetitiva, con input chiari.");
  assert.deepEqual(lines, [
    '[ai/classify] risposta_rifiutata {"finishReason":"content-filter","category":"general_harms"}',
    '[ai/classify] classificazione_non_riuscita {"error":{"name":"AI_APICallError","statusCode":400}}',
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

test("«Completo mapping» con rifiuti prima di scrivere o a metà JSON: nel log come rifiuti, con la categoria; niente scritto", async (t) => {
  const lines = recordLogs(t);
  reset();
  prova.activities = [{ ...ACTIVITIES[0], onetTaskId: null }];
  // La classificazione è rifiutata senza testo, il match O*NET a metà del suo JSON: generateObject lancia tutte e due.
  fakeAppClaude([refusal([], "bio"), refusal([THINKING, { type: "text", text: '{"matches":[{"activityId":"a-1","suggestedOn' }], "cyber")]);
  const result = await markDepartmentMapped("Una attività.");
  assert.deepEqual(prova.classified, []);
  assert.deepEqual(prova.matched, []);
  assert.equal(
    result.message,
    "Dipartimento segnato come mappato. Una attività. Classificazione non riuscita — verrà riprovata manualmente. " +
      "Match O*NET non riuscito — verrà riprovato manualmente.",
  );
  assert.deepEqual(lines, [
    '[ai/classify] risposta_rifiutata {"finishReason":"content-filter","category":"bio"}',
    '[ai/onet-matching] risposta_rifiutata {"finishReason":"content-filter","category":"cyber"}',
  ]);
});

test("«Completo mapping» con il modello che non risponde: alla scadenza della chat restano le classificazioni riuscite, i testi di sempre, il tempo scaduto nel log", async (t) => {
  const lines = recordLogs(t);
  reset();
  // Quattro attività da classificare e da abbinare a O*NET: nel primo giro di tre la seconda non risponde mai.
  prova.activities = ACTIVITIES.map((a) => ({ ...a, onetTaskId: null }));
  const requested: number[] = [];
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, "timeout", (ms: number) => {
    requested.push(ms);
    return timeout(30);
  });
  const hangOn = (title: string): Reply => (init) => {
    const prompt = JSON.stringify(JSON.parse(String(init?.body)).messages);
    // Il match O*NET (tutte le attività in un prompt) e la classificazione di «title» non rispondono.
    if (prompt.includes("O*NET SOC") || prompt.includes(title)) return hang(init);
    return message([THINKING, { type: "text", text: JSON.stringify(ANSWER) }])();
  };
  const requests = fakeAppClaude(Array.from({ length: 6 }, () => hangOn("Revisione contratti riservati")));
  const started = Date.now();
  // La scadenza è già vicina: ogni chiamata ha il tempo minimo (qui accorciato a 30 ms).
  const result = await markDepartmentMapped("Mappate quattro attività.", Date.now() + 1_000);
  assert.ok(Date.now() - started < 5_000, "il tool risponde alla scadenza, non resta appeso");
  assert.deepEqual(requested, [MIN_MODEL_CALL_MS, MIN_MODEL_CALL_MS], "un tempo per la classificazione, uno per O*NET");
  // Primo giro: tre chiamate, una interrotta; il secondo giro non parte. Poi il match O*NET, interrotto.
  assert.equal(requests.length, 4);
  assert.ok(requests.every((request) => request.signal), "ogni chiamata ha un abortSignal");
  assert.deepEqual(prova.classified.map(([id]) => id), ["a-1", "a-3"], "le riuscite si scrivono");
  assert.deepEqual(prova.matched, []);
  assert.equal(
    result.message,
    "Dipartimento segnato come mappato. Mappate quattro attività. Classificazione completata: 2 Automate, 0 Differentiate, 0 Innovate. " +
      "2 attività sono rimaste da classificare. Match O*NET non riuscito — verrà riprovato manualmente.",
  );
  assert.deepEqual(lines, [
    '[ai/classify] tempo_scaduto {"classificate":2,"rimaste":2}',
    `[ai/onet-matching] tempo_scaduto {"timeoutMs":${MIN_MODEL_CALL_MS}}`,
  ]);
});

test("«Completo mapping» con la scadenza lontana: la classificazione e il match O*NET hanno il tempo che resta, e riescono", async (t) => {
  recordLogs(t);
  reset();
  prova.activities = [{ ...ACTIVITIES[0], onetTaskId: null }];
  const requested: number[] = [];
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, "timeout", (ms: number) => {
    requested.push(ms);
    return timeout(ms);
  });
  const match = { activityId: "a-1", suggestedOnetCode: "43-3031.00", occupationTitle: "Contabile", relevantTasks: [], aiExposureEstimate: 0.3, augmentationVsAutomation: "mixed", motivazione: "Ripetitiva." };
  const requests = fakeAppClaude([
    message([THINKING, { type: "text", text: JSON.stringify(ANSWER) }]),
    message([THINKING, { type: "text", text: JSON.stringify({ matches: [match] }) }]),
  ]);
  const result = await markDepartmentMapped("Una attività.", Date.now() + 60_000);
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => request.signal && !request.signal.aborted));
  assert.equal(requested.length, 2);
  for (const ms of requested) assert.ok(ms > 59_000 && ms <= 60_000, `chiesti ${ms} ms`);
  assert.deepEqual(prova.matched, ["a-1"]);
  assert.match(result.message, /Classificazione completata: 1 Automate.*Match O\*NET completato su 1 attività\./);
});

test("le parole delle attività rimaste", () => {
  assert.equal(skippedClassificationsText(0), "");
  assert.equal(skippedClassificationsText(1), "1 attività è rimasta da classificare.");
  assert.equal(skippedClassificationsText(3), "3 attività sono rimaste da classificare.");
});
