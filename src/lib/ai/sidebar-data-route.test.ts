import test from "node:test";
import assert from "node:assert/strict";
import { installAppModules } from "./claude-test-kit.ts";

// (Rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §10.1) La barra della Discovery (/api/workspaces/<ws>/sidebar-data) mostra
// la tesi del valore del workspace: con più workspace nella stessa organizzazione, ognuno la sua. Sessione, accesso e
// letture finti; l'organizzazione ha la tesi di un altro workspace, che non deve comparire.

type Prova = { thesis: Record<string, unknown> | null; asked: string[] };
const prova: Prova = { thesis: null, asked: [] };
(globalThis as { __sidebarProva?: Prova }).__sidebarProva = prova;

await installAppModules({
  "@/lib/auth": `export async function auth() { return { user: { id: "persona-1" } }; }`,
  "@/lib/workspace-access": `export async function getCollaboratorAccess(userId, workspaceId) {
    return workspaceId === "ws-prova" ? { role: "transformation_lead", workspace: { id: "ws-prova", organizationId: "org-prova", unitTerminology: null } } : null;
  }`,
  "@/lib/db/queries/workspaces": `
    export async function getDepartmentsByWorkspace() { return [{ id: "u1", name: "Acquisti", mappingStatus: "not_started", teamSize: 4 }]; }
    export async function getStrategicGoalsByWorkspace() { return [{ id: "g1", title: "Ridurre i tempi", type: "objective" }]; }`,
  "@/lib/db/queries/value-thesis": `export async function getWorkspaceValueThesis(workspaceId) {
    globalThis.__sidebarProva.asked.push(workspaceId);
    return globalThis.__sidebarProva.thesis;
  }`,
  "@/lib/db/schema": `export const organizations = { id: "organizations" };`,
  "drizzle-orm": `export const eq = (column, value) => ({ column, value });`,
  "@/lib/db": `export const db = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: "org-prova", companyValueThesis: { coreValueProposition: "Tesi di un altro workspace" } }] }) }) }) };`,
});
const { GET } = await import("../../app/api/workspaces/[workspaceId]/sidebar-data/route.ts");

async function sidebar(workspaceId = "ws-prova") {
  const response = await GET(new Request(`http://localhost/api/workspaces/${workspaceId}/sidebar-data`), { params: Promise.resolve({ workspaceId }) });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

test("la tesi della barra è quella del workspace; senza, nessuna tesi (mai quella dell'organizzazione)", async () => {
  const thesis = { coreValueProposition: "Cucine su misura del workspace di prova", strategicNodes: ["Progettazione", "Posa"] };
  prova.thesis = thesis;
  prova.asked = [];
  const withThesis = await sidebar();
  assert.equal(withThesis.status, 200);
  assert.deepEqual(withThesis.body.thesis, thesis);
  assert.deepEqual(prova.asked, ["ws-prova"]);
  assert.deepEqual(withThesis.body.departments, [{ id: "u1", name: "Acquisti", mappingStatus: "not_started", teamSize: 4 }]);

  prova.thesis = null;
  const without = await sidebar();
  assert.equal(without.body.thesis, null);
  assert.equal(JSON.stringify(without.body).includes("Tesi di un altro workspace"), false);
});

test("senza accesso al workspace: 404, e la tesi non si legge", async () => {
  prova.asked = [];
  const response = await sidebar("ws-altro");
  assert.equal(response.status, 404);
  assert.deepEqual(prova.asked, []);
});
