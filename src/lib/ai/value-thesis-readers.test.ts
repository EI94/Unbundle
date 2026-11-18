import test from "node:test";
import assert from "node:assert/strict";
import { fakeAppClaude, installAppModules, message, recordLogs, THINKING, type Captured } from "./claude-test-kit.ts";
import { contextPromptBlock } from "../context/work/prompt-block.ts";

// (Rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §10.1) La tesi del valore sta sul workspace: la Discovery la salva lì, e
// report, simulazione e OKR leggono quella del workspace. Azioni e tool veri; database, sessione e generatori finti.
// (Rilascio 9b, RILASCIO-9b-COSTRUZIONE.md §2.12) Con la tesi, il blocco «Contesto» del workspace: chiesto dopo i
// permessi, con l'ok della richiesta.

type Prova = {
  thesis: unknown;
  asked: string[];
  saved: Array<[string, unknown]>;
  saveOk: boolean;
  report: unknown[];
  simulation: unknown[];
  orgWrites: number;
  /** (Rilascio 9b) Il ruolo di chi chiama; il blocco che `loadPromptContext` restituisce, e con che cosa le azioni l'hanno chiesto. */
  role: string;
  contextBlock: string;
  contexts: unknown[][];
  /** (Rilascio 9b) Il blocco che i generatori finti di report e simulazione hanno ricevuto. */
  reportContext: unknown[];
  simulationContext: unknown[];
};
const prova: Prova = { thesis: null, asked: [], saved: [], saveOk: true, report: [], simulation: [], orgWrites: 0, role: "transformation_lead", contextBlock: "", contexts: [], reportContext: [], simulationContext: [] };
(globalThis as { __prova?: Prova }).__prova = prova;

await installAppModules({
  "@/lib/auth/redirect-to-login": `export async function requireSession() { return { user: { id: "utente-prova" } }; }`,
  "@/lib/auth/require-workspace": `export async function requireWorkspaceAccess() { return { session: { user: { id: "utente-prova" } } }; }`,
  "@/lib/workspace-access": `export async function getCollaboratorAccess() {
    return { role: globalThis.__prova.role, workspace: { id: "ws-prova", name: "Cliente di prova", organizationId: "org-prova" } };
  }`,
  "@/lib/db/queries/context-work": `export async function loadPromptContext(workspaceId, i) {
    globalThis.__prova.contexts.push([workspaceId, i]);
    return globalThis.__prova.contextBlock;
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
  "@/lib/ai/generate-report": `export async function generateReport(data, contesto) {
    globalThis.__prova.report.push(data.companyValueThesis);
    globalThis.__prova.reportContext.push(contesto);
    return { executiveSummary: "x" };
  }`,
  "@/lib/ai/generate-simulation": `export async function generateSimulation(data, contesto) {
    globalThis.__prova.simulation.push(data.companyValueThesis);
    globalThis.__prova.simulationContext.push(contesto);
    return { scenarios: [] };
  }`,
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
  Object.assign(
    prova,
    { thesis: THESIS, asked: [], saved: [], saveOk: true, report: [], simulation: [], orgWrites: 0, role: "transformation_lead", contextBlock: "", contexts: [], reportContext: [], simulationContext: [] },
    over,
  );
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

/** (Rilascio 9b) Il blocco come lo restituisce `loadPromptContext` per un generatore. */
const BLOCK = `\n${contextPromptBlock({ brief: ["Il cliente fa cucine su misura per i negozi."], facts: [{ section: "obiettivi", statement: "Vogliono consegnare in tre settimane." }], nonce: "v7t2h9s4k1m6", purpose: "generatore" })}\n`;
/** Il messaggio dell'utente che il modello ha ricevuto. */
const userText = (requests: Captured[]) => (requests[0].body.messages as Array<{ content: Array<{ text: string }> }>)[0].content[0].text;

test("(Rilascio 9b) report, simulazione e OKR ricevono il blocco «Contesto» del workspace, chiesto con l'ok della richiesta", async (t) => {
  recordLogs(t);
  reset({ contextBlock: BLOCK });
  await generateReportAction("ws-prova");
  await generateSimulationAction("ws-prova");
  const okrs = [{ type: "goal", title: "Consegne più rapide", description: "Ridurre i tempi di consegna." }];
  const requests = fakeAppClaude([message([THINKING, { type: "text", text: JSON.stringify({ okrs }) }])]);
  await suggestOKRsAction("ws-prova");
  assert.deepEqual(prova.contexts, [
    ["ws-prova", { profile: "report", consent: "request" }],
    ["ws-prova", { profile: "simulation", consent: "request" }],
    ["ws-prova", { profile: "okr", consent: "request" }],
  ]);
  assert.deepEqual(prova.reportContext, [BLOCK]);
  assert.deepEqual(prova.simulationContext, [BLOCK]);
  // Gli OKR: il blocco in fondo al messaggio, dopo la tesi.
  assert.equal(userText(requests), `Value Thesis dell'azienda:\n${JSON.stringify(THESIS, null, 2)}${BLOCK}`);
  // Senza niente da dire (o senza l'ok): "" ai generatori, e il messaggio degli OKR è quello di prima.
  reset();
  await generateReportAction("ws-prova");
  const before = fakeAppClaude([message([THINKING, { type: "text", text: JSON.stringify({ okrs }) }])]);
  await suggestOKRsAction("ws-prova");
  assert.deepEqual(prova.reportContext, [""]);
  assert.equal(userText(before), `Value Thesis dell'azienda:\n${JSON.stringify(THESIS, null, 2)}`);
});

test("(Rilascio 9b) un ruolo che non genera non legge il contesto: prima i permessi", async () => {
  reset({ role: "contributor", contextBlock: BLOCK });
  const requests = fakeAppClaude([]);
  await assert.rejects(generateReportAction("ws-prova"), /Non hai i permessi per generare report\./);
  await assert.rejects(generateSimulationAction("ws-prova"), /Non hai i permessi per generare simulazioni\./);
  await assert.rejects(suggestOKRsAction("ws-prova"), /Non hai i permessi per suggerire OKR\./);
  assert.deepEqual(prova.contexts, []);
  assert.equal(requests.length, 0);
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
