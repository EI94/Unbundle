import test from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { installAppModules } from "../claude-test-kit.ts";

// (Rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §10.5) I due tool della mappatura che ricevono un id dal modello scrivono
// solo sulle attività del workspace della conversazione. Il modulo è quello vero, con drizzle vero; il database è
// finto: tiene le attività in memoria e applica le condizioni che gli arrivano, come farebbe Postgres.

const WS = "00000000-0000-4000-8000-0000000000a1";
const OTHER_WS = "00000000-0000-4000-8000-0000000000b1";
const MINE_1 = "11111111-1111-4111-8111-111111111111";
const MINE_2 = "22222222-2222-4222-8222-222222222222";
const THEIRS = "99999999-9999-4999-8999-999999999999";
const UNKNOWN = "33333333-3333-4333-8333-333333333333";

type Activity = { id: string; workspaceId: string; workType: string | null; updatedAt: Date | null };
type Prova = {
  activities: Activity[];
  dependencies: Array<Record<string, unknown>>;
  /** Le richieste arrivate al database, nell'ordine. */
  queries: string[];
  matching(where: SQL): Activity[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dialect = new PgDialect();
const prova: Prova = {
  activities: [],
  dependencies: [],
  queries: [],
  /** Le attività che passano la condizione. Conosce le sole forme che servono; un'altra forma è un errore del test. */
  matching(where) {
    const { sql, params } = dialect.sqlToQuery(where);
    const param = (pattern: RegExp) => {
      const found = pattern.exec(sql);
      return found ? String(params[Number(found[1]) - 1]) : null;
    };
    const one = param(/"activities"\."id" = \$(\d+)/);
    const many = /"activities"\."id" in \(([^)]*)\)/.exec(sql);
    const idList = one !== null ? [one] : many ? many[1].split(",").map((p) => String(params[Number(p.trim().slice(1)) - 1])) : null;
    if (!idList) throw new Error(`condizione sconosciuta: ${sql}`);
    // Postgres rifiuta un testo che non è un UUID: il tool deve fermarsi prima.
    for (const id of idList) if (!UUID.test(id)) throw new Error(`invalid input syntax for type uuid: "${id}"`);
    const workspace = param(/"activities"\."workspace_id" = \$(\d+)/);
    const wanted = new Set(idList.map((id) => id.toLowerCase()));
    return this.activities.filter((a) => wanted.has(a.id) && (workspace === null || a.workspaceId === workspace));
  },
};
(globalThis as { __prova?: Prova }).__prova = prova;

await installAppModules({
  // Le query degli altri tool del file («Completo mapping») qui non servono.
  "@/lib/db/queries/value-thesis": `export async function getWorkspaceValueThesis() { return null; }`,
  "@/lib/db/queries/activities": `export async function getActivitiesByDepartment() { return []; }
    export async function updateActivityClassification() {}
    export async function updateActivity() {}`,
  "@/lib/db/queries/workspaces": `export async function getStrategicGoalsByWorkspace() { return []; }`,
  "@/lib/db": `
    const prova = globalThis.__prova;
    export const db = {
      update: () => ({ set: (values) => ({ where: (where) => {
        const write = () => { prova.queries.push("update"); const rows = prova.matching(where); for (const row of rows) Object.assign(row, values); return rows.map((row) => ({ id: row.id })); };
        // Con "returning" tornano le righe scritte; senza, la scrittura parte lo stesso quando la si aspetta.
        return { returning: async () => write(), then: (resolve, reject) => { try { resolve(write()); } catch (error) { reject(error); } } };
      } }) }),
      select: () => ({ from: () => ({ where: async (where) => { prova.queries.push("select"); return prova.matching(where).map((row) => ({ id: row.id })); } }) }),
      insert: () => ({ values: async (row) => { prova.queries.push("insert"); prova.dependencies.push(row); } }),
    };`,
});
const { getActivityMappingTools } = await import("./activity-mapping-tools.ts");

type ToolResult = { success: boolean; message: string };
const call = { toolCallId: "toolu_prova", messages: [] };
const tools = () => getActivityMappingTools(WS, "00000000-0000-4000-8000-0000000000d1", { deadline: Date.now() + 60_000 });
const classify = async (activityId: string) => (await tools().updateActivityClassification.execute!({ activityId, workType: "detection" }, call)) as ToolResult;
const link = async (sourceActivityId: string, targetActivityId: string) =>
  (await tools().linkActivityDependency.execute!({ sourceActivityId, targetActivityId, dependencyType: "handoff" }, call)) as ToolResult;

function reset() {
  prova.activities = [
    { id: MINE_1, workspaceId: WS, workType: null, updatedAt: null },
    { id: MINE_2, workspaceId: WS, workType: "delivery", updatedAt: null },
    { id: THEIRS, workspaceId: OTHER_WS, workType: "enrichment", updatedAt: null },
  ];
  prova.dependencies = [];
  prova.queries = [];
}
const state = () => prova.activities.map((a) => [a.id, a.workType, a.updatedAt === null]);

const NOT_FOUND = { success: false, message: "Attività non trovata in questo workspace." };
const NOT_FOUND_BOTH = { success: false, message: "Attività non trovate in questo workspace." };

test("updateActivityClassification scrive su un'attività del workspace", async () => {
  reset();
  assert.deepEqual(await classify(MINE_1), { success: true, message: `Attivita' classificata come "detection".` });
  assert.deepEqual(state(), [[MINE_1, "detection", false], [MINE_2, "delivery", true], [THEIRS, "enrichment", true]]);
});

test("updateActivityClassification con un'attività di un altro workspace non scrive e dice che non c'è", async () => {
  reset();
  const before = state();
  assert.deepEqual(await classify(THEIRS), NOT_FOUND);
  assert.deepEqual(state(), before, "l'attività dell'altro workspace resta com'era");
  assert.deepEqual(await classify(UNKNOWN), NOT_FOUND);
  assert.deepEqual(state(), before);
});

test("updateActivityClassification con un id che non è un UUID non arriva al database", async () => {
  reset();
  for (const id of ["a-1", "", "attività uno", `${MINE_1} OR 1=1`]) assert.deepEqual(await classify(id), NOT_FOUND, id);
  assert.deepEqual(prova.queries, []);
});

test("linkActivityDependency collega due attività del workspace", async () => {
  reset();
  assert.deepEqual(await link(MINE_1, MINE_2), { success: true, message: "Dipendenza collegata con successo." });
  assert.deepEqual(prova.dependencies, [{ sourceActivityId: MINE_1, targetActivityId: MINE_2, dependencyType: "handoff" }]);
  assert.deepEqual(prova.queries, ["select", "insert"], "prima conta, poi scrive");
});

test("linkActivityDependency con un'attività di un altro workspace, o che non c'è, non scrive", async () => {
  reset();
  for (const [source, target] of [[MINE_1, THEIRS], [THEIRS, MINE_1], [THEIRS, THEIRS], [MINE_1, UNKNOWN], [UNKNOWN, MINE_2]]) {
    assert.deepEqual(await link(source, target), NOT_FOUND_BOTH, `${source} → ${target}`);
  }
  assert.deepEqual(prova.dependencies, []);
  assert.equal(prova.queries.includes("insert"), false);
});

test("linkActivityDependency vuole due attività diverse e due UUID", async () => {
  reset();
  assert.deepEqual(await link(MINE_1, MINE_1), NOT_FOUND_BOTH);
  assert.deepEqual(await link(MINE_1, MINE_1.toUpperCase()), NOT_FOUND_BOTH, "la stessa attività scritta in maiuscolo");
  assert.deepEqual(await link("a-1", MINE_2), NOT_FOUND_BOTH);
  assert.deepEqual(await link(MINE_1, ""), NOT_FOUND_BOTH);
  assert.deepEqual(prova.dependencies, []);
  assert.deepEqual(prova.queries, [], "niente arriva al database");
});
