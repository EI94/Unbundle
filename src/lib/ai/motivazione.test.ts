import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { installAppModules, message, recordLogs, THINKING, fakeAppClaude, type Captured } from "./claude-test-kit.ts";
import { MOTIVAZIONE_DESCRIPTION } from "./models.ts";

// (Migrazione a Claude Sonnet 5.5) Negli schemi che il modello riempie nessun campo si chiama più `reasoning`: un
// campo che chiede il ragionamento invita i rifiuti `reasoning_extraction`. Il modello vede `motivazione`, con la
// descrizione di una breve spiegazione per l'utente; l'app riceve `reasoning` come prima. Moduli veri
// (classificazione, match O*NET, attività dai documenti), database e sessione finti, il Claude finto del kit.

await installAppModules({
  "@/lib/auth/require-workspace": `export async function requireWorkspaceAccess() { return { session: { user: { id: "utente-prova" } }, access: { role: "transformation_lead" } }; }`,
  "@/lib/db/queries/workspaces": `export async function getDepartmentById(id) { return { id, workspaceId: "ws-prova" }; }`,
  "@/lib/db/schema": `export const activities = {}; export const uploadedDocuments = { workspaceId: "workspace_id", departmentId: "department_id" };`,
  "drizzle-orm": `export const eq = (column, value) => ({ column, value }); export const and = (...parts) => ({ and: parts });`,
  "@/lib/db": `export const db = {
    select: () => ({ from: () => ({ where: async () => [{ id: "doc-prova", fileName: "procedure.pdf", extractedText: "Ogni mese il team prepara le fatture.", summary: null }] }) }),
  };`,
  "next/cache": `export function revalidatePath() {}`,
  // (Rilascio 9a) L'ok ai sub-responsabili c'è; chi chiama vede il documento «Per tutti» dell'unità.
  "@/lib/db/queries/context-consent": `export async function contextAiConsent() { return true; }`,
  "@/lib/context/server/actor": `export function contextActorFor(user, access, workspaceId) { return { workspaceId, userId: user.id, role: access.role, isLateralSpace: false, channel: "web" }; }`,
  "@/lib/db/queries/context-store": `export async function contextStoreReady() { return true; }`,
  "@/lib/db/queries/context-sources": `export async function listContextSources() { return [{ id: "fonte-prova", kind: "documento", visibility: "tutti", document: { id: "doc-prova" } }]; }`,
});
const { classifyActivity } = await import("./classify.ts");
const { matchActivitiesToOnet } = await import("./onet-matching.ts");
const { preGenerateActivitiesFromDocuments } = await import("../actions/pre-generate-activities.ts");

const WHY = "Si ripete ogni mese con regole chiare.";
const reply = (answer: unknown) => message([THINKING, { type: "text", text: JSON.stringify(answer) }]);

/** Lo schema JSON che il modello ha ricevuto: `motivazione` descritta, nessun `reasoning` da nessuna parte. */
function assertSchemaHasMotivazione(request: Captured, path: (schema: Record<string, unknown>) => Record<string, unknown>) {
  const schema = (request.body.output_config as { format: { schema: Record<string, unknown> } }).format.schema;
  assert.equal(JSON.stringify(schema).includes("reasoning"), false, JSON.stringify(schema));
  const properties = path(schema).properties as Record<string, { type: string; description?: string }>;
  assert.deepEqual(properties.motivazione, { type: "string", description: MOTIVAZIONE_DESCRIPTION });
}

const items = (schema: Record<string, unknown>, key: string) =>
  ((schema.properties as Record<string, { items: Record<string, unknown> }>)[key]).items;

const ACTIVITY = { id: "a-1", title: "Fatture mensili", description: "Fatture ai clienti", workType: "delivery", classification: null };

test("classificazione: il modello vede «motivazione», l'app riceve «reasoning»", async (t) => {
  recordLogs(t);
  const requests = fakeAppClaude([reply({ classification: "automate", confidenceScore: 0.9, motivazione: WHY, aiPotential: "Alto" })]);
  const result = await classifyActivity(ACTIVITY as never, { companyValueThesis: null, goals: [] });
  assertSchemaHasMotivazione(requests[0], (schema) => schema);
  assert.deepEqual(result, { classification: "automate", confidenceScore: 0.9, reasoning: WHY, aiPotential: "Alto" });
});

test("match O*NET: il modello vede «motivazione» in ogni match, l'app riceve «reasoning»", async (t) => {
  recordLogs(t);
  const match = { activityId: "a-1", suggestedOnetCode: "43-3031.00", occupationTitle: "Contabile", relevantTasks: ["Prepara fatture"], aiExposureEstimate: 0.3, augmentationVsAutomation: "mixed" };
  const requests = fakeAppClaude([reply({ matches: [{ ...match, motivazione: WHY }] })]);
  const matches = await matchActivitiesToOnet([ACTIVITY] as never);
  assertSchemaHasMotivazione(requests[0], (schema) => items(schema, "matches"));
  assert.deepEqual(matches, [{ ...match, reasoning: WHY }]);
});

test("attività dai documenti: il modello vede «motivazione» (anche nel prompt), l'app riceve «reasoning»", async (t) => {
  recordLogs(t);
  const activity = { title: "Fatturazione mensile", description: "Prepara e invia le fatture ai clienti." };
  const requests = fakeAppClaude([reply({ activities: [{ ...activity, motivazione: WHY }] })]);
  const result = await preGenerateActivitiesFromDocuments("ws-prova", "reparto-prova");
  assertSchemaHasMotivazione(requests[0], (schema) => items(schema, "activities"));
  const prompt = JSON.stringify(requests[0].body.messages);
  assert.match(prompt, /\*\*Motivazione\*\*: in una o due frasi/);
  assert.doesNotMatch(prompt, /Reasoning/);
  assert.deepEqual(result, { activities: [{ ...activity, reasoning: WHY }] });
});

test("nessuno schema che il modello riempie ha un campo «reasoning»: chiamate generateObject, tool della chat, schemi del ranking e del filo", () => {
  const root = new URL("../../../", import.meta.url);
  const files = (readdirSync(new URL("src/", root), { recursive: true }) as string[])
    .map((file) => `src/${file.split("\\").join("/")}`)
    .filter((file) => /\.(ts|tsx)$/.test(file) && !file.endsWith(".test.ts"));
  const schemaFiles = files.filter((file) => {
    const source = readFileSync(new URL(file, root), "utf8");
    return (
      /\bgenerateObject\(/.test(source) ||
      file.startsWith("src/lib/ai/tools/") ||
      file === "src/lib/portfolio/ai-ranking-contract.ts" ||
      file === "src/lib/use-cases/referent/ai-followup.ts"
    );
  });
  assert.ok(schemaFiles.length >= 16, schemaFiles.join("\n"));
  for (const file of schemaFiles) {
    assert.doesNotMatch(readFileSync(new URL(file, root), "utf8"), /\breasoning["']?\s*:\s*(z\b|\{)/, file);
  }
});
