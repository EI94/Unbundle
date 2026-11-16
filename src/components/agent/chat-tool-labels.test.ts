import test from "node:test";
import assert from "node:assert/strict";
import { installAppModules } from "../../lib/ai/claude-test-kit.ts";
import { HIDDEN_TOOLS, MAPPING_TOOL_LABELS, TOOL_LABELS, toolChip } from "./chat-view.ts";

// (Migrazione a Claude Sonnet 5.5) Le etichette dei tool nella chat (chat-view.ts): ogni tool che la rotta dà al
// modello ha le sue, in italiano, tranne quelli nascosti; senza, la chat mostrerebbe «Elaboro...» e poi il nome inglese
// del tool. I tool sono quelli veri, costruiti come nella rotta; database e query sono finti, perché non si eseguono.

await installAppModules({
  "@/lib/db": `export const db = {};`,
  "@/lib/db/queries/activities": `export async function getActivitiesByDepartment() { return []; }
    export async function updateActivityClassification() {}
    export async function updateActivity() {}`,
  "@/lib/db/queries/workspaces": `export async function getWorkspaceById() { return null; }
    export async function getStrategicGoalsByWorkspace() { return []; }`,
});
const { getLeadershipTools } = await import("../../lib/ai/tools/leadership-tools.ts");
const { getActivityMappingTools } = await import("../../lib/ai/tools/activity-mapping-tools.ts");
const { getWebSearchTool } = await import("../../lib/ai/tools/web-search-tool.ts");

test("ogni tool della chat ha le sue etichette, in corso e finito, tranne quelli nascosti", () => {
  const deadline = Date.now() + 60_000;
  const names = Object.keys({
    ...getLeadershipTools("ws-prova", "org-prova", { canSaveCompanyFacts: true }),
    ...getActivityMappingTools("ws-prova", "reparto-prova", { deadline, actor: { kind: "assistente", userId: "utente-prova", role: "contributor" } }),
    ...getWebSearchTool({ deadline }),
  });
  assert.ok(["saveCompanyFacts", "saveStrategicGoal", "markDepartmentMapped", "webSearch"].every((name) => names.includes(name)), names.join(", "));
  for (const name of names.filter((name) => !HIDDEN_TOOLS.has(name))) {
    const labels = TOOL_LABELS[name];
    assert.ok(labels?.active && labels.done, `${name}: senza etichette la chat mostra «Elaboro...» e poi «${name}»`);
    assert.notEqual(labels.done, name);
  }
  // I tool della board hanno anche le etichette dell'assistente accanto alla board, e sono tutti e soli quelli della mappatura.
  const mapping = Object.keys(getActivityMappingTools("ws-prova", "reparto-prova", { deadline, actor: { kind: "assistente", userId: "utente-prova", role: "contributor" } }));
  assert.deepEqual(mapping.sort(), Object.keys(MAPPING_TOOL_LABELS).sort());
  assert.deepEqual(toolChip({ type: "tool-saveCompanyFacts", state: "input-available" }), { kind: "tool", label: "Salvo i dati dell'azienda", done: false });
  assert.deepEqual(toolChip({ type: "tool-saveCompanyFacts", state: "output-available", output: { success: true } }), {
    kind: "tool",
    label: "Dati dell'azienda salvati",
    done: true,
  });
});
