import test from "node:test";
import assert from "node:assert/strict";
import { installAppModules } from "../ai/claude-test-kit.ts";
import { PORTFOLIO_REVIEWER_ROLES } from "../workspace-permissions.ts";

// Gli obiettivi strategici del cliente (Strategia › Obiettivi & OKR): l'azione vera `createGoalAction`, con sessione,
// accesso e database finti. Li crea solo chi rivede il portfolio, come gli OKR suggeriti; il tipo è uno dei tre e il
// padre è un obiettivo dello stesso workspace. Clienti e obiettivi inventati.

type Goal = { id: string; workspaceId: string; type: string; title: string };
type Prova = { role: string | null; goals: Goal[]; inserted: Array<Record<string, unknown>>; revalidated: string[] };
const prova: Prova = { role: "transformation_lead", goals: [], inserted: [], revalidated: [] };
(globalThis as { __obiettivi?: Prova }).__obiettivi = prova;

await installAppModules({
  "@/lib/auth/redirect-to-login": `export async function requireSession() { return { user: { id: "utente-prova" } }; }`,
  "@/lib/workspace-access": `export async function getCollaboratorAccess(userId, workspaceId) {
    const role = globalThis.__obiettivi.role;
    return role ? { role, source: "workspace", workspace: { id: workspaceId, name: "Cliente di prova", organizationId: "org-prova" } } : null;
  }`,
  "next/cache": `export function revalidatePath(path) { globalThis.__obiettivi.revalidated.push(path); }`,
  "@/lib/db/queries/workspaces": `export async function getStrategicGoalsByWorkspace(workspaceId) {
    return globalThis.__obiettivi.goals.filter((goal) => goal.workspaceId === workspaceId);
  }`,
  "@/lib/db/queries/value-thesis": `export async function getWorkspaceValueThesis() { return null; }`,
  "@/lib/db/schema": `export const strategicGoals = { table: "strategic_goals" };`,
  "@/lib/db": `export const db = {
    insert: (table) => ({ values: async (row) => { globalThis.__obiettivi.inserted.push({ table: table.table, ...row }); } }),
  };`,
});
const { createGoalAction } = await import("../actions/strategy.ts");

const WS = "ws-prova";
const GOALS: Goal[] = [
  { id: "obiettivo-prova", workspaceId: WS, type: "goal", title: "Consegne più rapide" },
  { id: "obiettivo-altro-cliente", workspaceId: "ws-altro-cliente", type: "goal", title: "Un obiettivo di un altro cliente" },
];

function reset(role: string | null = "transformation_lead") {
  Object.assign(prova, { role, goals: GOALS, inserted: [], revalidated: [] });
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries({ workspaceId: WS, type: "objective", title: "Ridurre i resi", ...fields })) data.set(name, value);
  return data;
}

test("chi non rivede il portfolio non crea obiettivi: un contributore del cliente è rifiutato e non si scrive niente", async () => {
  reset("contributor");
  await assert.rejects(createGoalAction(form({})), /^Error: Non hai i permessi per creare obiettivi\.$/);
  await assert.rejects(createGoalAction(form({ type: "goal", parentId: "obiettivo-prova" })), /Non hai i permessi per creare obiettivi\./);
  reset(null);
  await assert.rejects(createGoalAction(form({})), /^Error: Workspace non trovato$/);
  assert.equal(prova.inserted.length, 0, "nessuna scrittura");
  assert.equal(prova.revalidated.length, 0);
});

test("ogni ruolo che rivede il portfolio crea l'obiettivo, senza padre", async () => {
  for (const role of PORTFOLIO_REVIEWER_ROLES) {
    reset(role);
    await createGoalAction(form({ type: "goal", title: "Consegne più rapide" }));
    assert.equal(prova.inserted.length, 1, role);
    assert.deepEqual(
      { table: prova.inserted[0].table, workspaceId: prova.inserted[0].workspaceId, parentId: prova.inserted[0].parentId, type: prova.inserted[0].type, title: prova.inserted[0].title },
      { table: "strategic_goals", workspaceId: WS, parentId: null, type: "goal", title: "Consegne più rapide" },
      role,
    );
    assert.deepEqual(prova.revalidated, [`/dashboard/${WS}/strategy`], role);
  }
});

test("il tipo è uno dei tre: un altro valore, o nessuno, è rifiutato e non si scrive niente", async () => {
  reset();
  for (const type of ["missione", "", "GOAL", "key-result"]) {
    await assert.rejects(createGoalAction(form({ type })), /^Error: Tipo di obiettivo non valido$/, type);
  }
  const missing = form({});
  missing.delete("type");
  await assert.rejects(createGoalAction(missing), /^Error: Tipo di obiettivo non valido$/);
  assert.equal(prova.inserted.length, 0, "nessuna scrittura");
  for (const type of ["goal", "objective", "key_result"]) await createGoalAction(form({ type }));
  assert.deepEqual(prova.inserted.map((row) => row.type), ["goal", "objective", "key_result"]);
});

test("il padre è un obiettivo dello stesso workspace: quello di un altro cliente, o uno che non c'è, è rifiutato", async () => {
  reset();
  for (const parentId of ["obiettivo-altro-cliente", "obiettivo-che-non-esiste"]) {
    await assert.rejects(createGoalAction(form({ type: "key_result", parentId })), /^Error: Obiettivo padre non trovato$/, parentId);
  }
  assert.equal(prova.inserted.length, 0, "nessuna scrittura");
  await createGoalAction(form({ type: "objective", parentId: "obiettivo-prova" }));
  assert.deepEqual([prova.inserted.length, prova.inserted[0].parentId, prova.inserted[0].workspaceId], [1, "obiettivo-prova", WS]);
});
