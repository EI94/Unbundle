import test from "node:test";
import assert from "node:assert/strict";
import { fakeAppClaude, installAppModules, message, recordLogs, THINKING } from "./claude-test-kit.ts";

// (Rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §10.1) La tesi del valore sta sul workspace: la Discovery la salva lì, e
// report, simulazione e OKR leggono quella del workspace. Azioni e tool veri; database, sessione e generatori finti.

type Prova = {
  thesis: unknown;
  asked: string[];
  saved: Array<[string, unknown]>;
  saveOk: boolean;
  report: unknown[];
  simulation: unknown[];
  orgWrites: number;
};
const prova: Prova = { thesis: null, asked: [], saved: [], saveOk: true, report: [], simulation: [], orgWrites: 0 };
(globalThis as { __prova?: Prova }).__prova = prova;

await installAppModules({
  "@/lib/auth/redirect-to-login": `export async function requireSession() { return { user: { id: "utente-prova" } }; }`,
  "@/lib/auth/require-workspace": `export async function requireWorkspaceAccess() { return { session: { user: { id: "utente-prova" } } }; }`,
  "@/lib/workspace-access": `export async function getCollaboratorAccess() {
    return { role: "transformation_lead", workspace: { id: "ws-prova", name: "Cliente di prova", organizationId: "org-prova" } };
  }`,
  "next/cache": `export function revalidatePath() {}`,
  "@/lib/db/queries/activities": `export async function getActivitiesByWorkspace() { return []; }`,
  "@/lib/db/queries/workspaces": `export async function getDepartmentsByWorkspace() { return []; }
    export async function getStrategicGoalsByWorkspace() { return []; }`,
  "@/lib/db/queries/use-cases": `export async function getUseCasesByWorkspace() { return []; }`,
  "@/lib/db/queries/use-case-program": `export async function saveCompanyFactsFromDiscovery() { return true; }`,
  "@/lib/db/queries/value-thesis": `
    export async function getWorkspaceValueThesis(workspaceId) { globalThis.__prova.asked.push(workspaceId); return globalThis.__prova.thesis; }
    export async function saveWorkspaceValueThesis(workspaceId, thesis) { globalThis.__prova.saved.push([workspaceId, thesis]); return globalThis.__prova.saveOk; }`,
  "@/lib/ai/generate-report": `export async function generateReport(data) { globalThis.__prova.report.push(data.companyValueThesis); return { executiveSummary: "x" }; }`,
  "@/lib/ai/generate-simulation": `export async function generateSimulation(data) { globalThis.__prova.simulation.push(data.companyValueThesis); return { scenarios: [] }; }`,
  "@/lib/db/schema": `export const organizations = { id: "organizations" }; export const workspaces = { id: "workspaces" }; export const departments = {}; export const strategicGoals = {};
    export const reports = {}; export const simulations = { workspaceId: "w", generatedAt: "g" };`,
  "drizzle-orm": `export const eq = (column, value) => ({ column, value }); export const desc = (column) => ({ desc: column });`,
  "@/lib/db": `export const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: "org-prova", companyValueThesis: { coreValueProposition: "Tesi di un altro workspace della stessa organizzazione" } }] }) }) }),
    insert: () => ({ values: () => Object.assign(Promise.resolve(), { returning: async () => [{ id: "riga-prova" }] }) }),
    update: (table) => ({ set: () => ({ where: async () => { if (table.id === "organizations") globalThis.__prova.orgWrites += 1; } }) }),
  };`,
});
const { generateReportAction } = await import("../actions/reports.ts");
const { generateSimulationAction } = await import("../actions/simulation.ts");
const { suggestOKRsAction } = await import("../actions/strategy.ts");
const { getLeadershipTools } = await import("./tools/leadership-tools.ts");

const THESIS = { coreValueProposition: "Cucine su misura del workspace di prova", strategicNodes: ["Progettazione"], commodityNodes: [], marginDrivers: [], keyRisks: [], aiReadiness: "Bassa" };

function reset(over: Partial<Prova> = {}) {
  Object.assign(prova, { thesis: THESIS, asked: [], saved: [], saveOk: true, report: [], simulation: [], orgWrites: 0 }, over);
}

test("report e simulazione ricevono la tesi del workspace, mai quella dell'organizzazione", async () => {
  reset();
  await generateReportAction("ws-prova");
  await generateSimulationAction("ws-prova");
  assert.deepEqual(prova.asked, ["ws-prova", "ws-prova"]);
  assert.deepEqual(prova.report, [THESIS]);
  assert.deepEqual(prova.simulation, [THESIS]);
  // Un workspace senza tesi non eredita quella di un altro workspace della stessa organizzazione.
  reset({ thesis: null });
  await generateReportAction("ws-prova");
  assert.deepEqual(prova.report, [null]);
});

test("gli OKR suggeriti partono dalla tesi del workspace; senza, chiedono di completare la Discovery", async (t) => {
  recordLogs(t);
  reset();
  const okrs = [{ type: "goal", title: "Consegne più rapide", description: "Ridurre i tempi di consegna." }];
  const requests = fakeAppClaude([message([THINKING, { type: "text", text: JSON.stringify({ okrs }) }])]);
  assert.deepEqual(await suggestOKRsAction("ws-prova"), okrs);
  assert.deepEqual(prova.asked, ["ws-prova"]);
  assert.equal(requests.length, 1);
  const body = JSON.stringify(requests[0].body);
  assert.ok(body.includes("Cucine su misura del workspace di prova"));
  assert.equal(body.includes("Tesi di un altro workspace"), false);
  reset({ thesis: null });
  const none = fakeAppClaude([]);
  await assert.rejects(suggestOKRsAction("ws-prova"), /Completa prima la Discovery per avere la Value Thesis\./);
  assert.equal(none.length, 0, "senza tesi il modello non parte");
});

test("la Discovery salva la tesi sul workspace; se non riesce lo dice, e l'organizzazione non si scrive più", async () => {
  reset();
  const tools = getLeadershipTools("ws-prova", "org-prova");
  const call = { toolCallId: "toolu_prova", messages: [] };
  assert.deepEqual(await tools.saveCompanyValueThesis.execute!(THESIS, call), { success: true, message: "Company Value Thesis salvata con successo." });
  assert.deepEqual(prova.saved, [["ws-prova", THESIS]]);
  assert.equal(prova.orgWrites, 0);
  reset({ saveOk: false });
  assert.deepEqual(await tools.saveCompanyValueThesis.execute!(THESIS, call), { success: false, message: "Non salvata: riprova tra qualche minuto." });
  assert.equal(prova.orgWrites, 0);
});
