import test from "node:test";
import assert from "node:assert/strict";
import { installAppModules } from "./claude-test-kit.ts";
import type { BoardOp } from "../mappatura/board-ops.ts";
import { MAPPING_LIMITS } from "../mappatura/vocab.ts";

// (Mappatura board) I passi proposti dai documenti e scelti nel drawer «Passi dai documenti» (azione
// confirmPreGeneratedActivities, docs/mappatura/MAPPATURA-BOARD-PIANO.md §5.5, §6): la lista che torna dal browser si
// controlla (i primi 15, con la forma di una proposta) e si scrive in una volta con saveBoardOps, come «documenti», nel
// primo processo dell'unità. Sessione, unità e board finte; l'azione vera.

const UNIT = "d1d1d1d1-0000-4000-8000-000000000001";
const FOREIGN_UNIT = "d1d1d1d1-0000-4000-8000-000000000002";
const WS = "e1e1e1e1-0000-4000-8000-000000000001";
const PROCESS = "a1a1a1a1-0000-4000-8000-000000000001";
type Call = [name: string, ...args: unknown[]];
type Prova = { calls: Call[]; ready: boolean; saveCode: string | null; refuse: (op: BoardOp) => string | null };
const prova: Prova = { calls: [], ready: true, saveCode: null, refuse: () => null };
(globalThis as { __prova?: Prova }).__prova = prova;

await installAppModules({
  "@/lib/auth/require-workspace": `export async function requireWorkspaceAccess(workspaceId) {
    globalThis.__prova.calls.push(["requireWorkspaceAccess", workspaceId]);
    return { session: { user: { id: "33333333-cccc-4ccc-8ccc-333333333333" } }, access: { role: "contributor" } };
  }`,
  "@/lib/db/queries/workspaces": `export async function getDepartmentById(id) {
    return id === ${JSON.stringify(UNIT)} ? { id, workspaceId: ${JSON.stringify(WS)} } : id === ${JSON.stringify(FOREIGN_UNIT)} ? { id, workspaceId: "altro" } : null;
  }`,
  "@/lib/db": `export const db = {};`,
  "@/lib/db/schema": `export const uploadedDocuments = {};`,
  // (Rilascio insieme) Il modulo dell'azione importa anche i controlli di «Contesto» della lettura dei documenti
  // (rilascio 9a): la conferma non li usa.
  "@/lib/db/queries/context-consent": `export async function contextAiConsent() { return true; }`,
  "@/lib/context/server/actor": `export function contextActorFor(user, access, workspaceId) { return { workspaceId, userId: user.id, role: access.role, isLateralSpace: false, channel: "web" }; }`,
  "@/lib/db/queries/context-store": `export async function contextStoreState() { return "pronto"; } export async function contextStoreReady() { return true; }`,
  "@/lib/db/queries/context-sources": `export async function listContextSources() { return []; }`,
  "@/lib/db/uc-executor": `export const EXECUTOR = { batch() { throw new Error("niente SQL a mano"); } };
    export async function getAppUcExecutor() { return EXECUTOR; }`,
  "@/lib/mappatura/board-store": `
    export async function resolveProcess(executor, scope, name) {
      globalThis.__prova.calls.push(["resolveProcess", scope, name]);
      return globalThis.__prova.ready ? ${JSON.stringify(PROCESS)} : null;
    }
    export async function saveBoardOps(executor, scope, actor, input) {
      globalThis.__prova.calls.push(["saveBoardOps", scope, actor, input]);
      if (globalThis.__prova.saveCode) return { ok: false, code: globalThis.__prova.saveCode };
      const rejected = input.ops.flatMap((op) => { const reason = globalThis.__prova.refuse(op); return reason ? [{ id: op.id, reason }] : []; });
      return { ok: true, revision: 1, savedAt: "2026-11-16T10:00:00.000Z", rejected, board: {} };
    }`,
});
const { confirmPreGeneratedActivities } = await import("../actions/pre-generate-activities.ts");

function reset() {
  prova.calls = [];
  prova.ready = true;
  prova.saveCode = null;
  prova.refuse = () => null;
}
const called = (name: string) => prova.calls.filter((call) => call[0] === name);
const proposal = (title: string, extra: Record<string, unknown> = {}) => ({ title, description: "Si fa ogni settimana.", reasoning: "Dai documenti.", ...extra });

test("i passi scelti: una scrittura sola con saveBoardOps, come «documenti», nel primo processo dell'unità; i testi tagliati ai limiti", async () => {
  reset();
  const result = await confirmPreGeneratedActivities(WS, UNIT, [
    proposal("Raccolta delle richieste", { frequency: "settimanale", estimatedHoursWeek: 4, workType: "enrichment", inputDescription: "Le e-mail.", outputDescription: "Il foglio.", toolsUsed: ["E-mail"] }),
    proposal(`Controllo ${"molto ".repeat(40)}lungo`),
  ] as never);
  assert.deepEqual(result, { saved: 2 });
  assert.deepEqual(called("resolveProcess"), [["resolveProcess", { workspaceId: WS, departmentId: UNIT }, null]]);
  const saves = called("saveBoardOps") as Array<[string, unknown, unknown, { ops: BoardOp[] }]>;
  assert.equal(saves.length, 1, "una transazione per tutti i passi");
  const [[, scope, actor, input]] = saves;
  assert.deepEqual(scope, { workspaceId: WS, departmentId: UNIT });
  assert.deepEqual(actor, { kind: "documenti", userId: "33333333-cccc-4ccc-8ccc-333333333333", role: "contributor" });
  const adds = input.ops.filter((op): op is Extract<BoardOp, { t: "step.add" }> => op.t === "step.add");
  assert.deepEqual(adds.map((op) => op.processId), [PROCESS, PROCESS]);
  assert.equal(adds[0].title, "Raccolta delle richieste");
  assert.ok(adds[1].title.length <= MAPPING_LIMITS.title);
  const fields = input.ops.flatMap((op) => (op.t === "step.set" && op.stepId === adds[0].stepId ? [[op.field, op.next]] : []));
  assert.deepEqual(fields, [
    ["description", "Si fa ogni settimana."],
    ["tools", ["E-mail"]],
    ["input", "Le e-mail."],
    ["output", "Il foglio."],
    ["frequency", "settimanale"],
    ["hoursWeek", 4],
    ["workType", "enrichment"],
  ]);
});

test("più di 15 passi: entrano i primi 15, gli altri restano fuori, come le proposte oltre la quindicesima", async () => {
  reset();
  const result = await confirmPreGeneratedActivities(WS, UNIT, Array.from({ length: 16 }, (_, index) => proposal(`Passo ${index + 1}`)) as never);
  assert.deepEqual(result, { saved: 15 });
  const saves = called("saveBoardOps") as Array<[string, unknown, unknown, { ops: BoardOp[] }]>;
  assert.equal(saves.length, 1);
  const titles = saves[0][3].ops.flatMap((op) => (op.t === "step.add" ? [op.title] : []));
  assert.deepEqual(titles, Array.from({ length: 15 }, (_, index) => `Passo ${index + 1}`));
});

test("una lista che non ha la forma delle proposte: niente si scrive", async () => {
  reset();
  await assert.rejects(confirmPreGeneratedActivities(WS, UNIT, [{ title: 42 }] as never), /Passi non validi/);
  await assert.rejects(confirmPreGeneratedActivities(WS, UNIT, "tutti" as never), /Passi non validi/);
  assert.deepEqual([called("resolveProcess"), called("saveBoardOps")], [[], []]);
  // Quindici vanno bene; un titolo vuoto non diventa un passo.
  const result = await confirmPreGeneratedActivities(WS, UNIT, [...Array.from({ length: 14 }, (_, index) => proposal(`Passo ${index + 1}`)), proposal("   ")] as never);
  assert.deepEqual(result, { saved: 14 });
});

test("un'unità di un altro workspace: rifiutata prima di leggere o scrivere la board", async () => {
  reset();
  await assert.rejects(confirmPreGeneratedActivities(WS, FOREIGN_UNIT, [proposal("Passo")] as never), /Reparto non trovato/);
  assert.deepEqual(prova.calls.map(([name]) => name), ["requireWorkspaceAccess"]);
});

test("la board non c'è ancora (0039), o rifiuta un passo: l'azione lo dice, e conta solo i passi entrati", async () => {
  reset();
  prova.ready = false;
  await assert.rejects(confirmPreGeneratedActivities(WS, UNIT, [proposal("Passo")] as never), /La board non è ancora disponibile/);
  assert.deepEqual(called("saveBoardOps"), []);
  reset();
  prova.saveCode = "non_disponibile";
  await assert.rejects(confirmPreGeneratedActivities(WS, UNIT, [proposal("Passo")] as never), /La board non è ancora disponibile/);
  reset();
  let adds = 0;
  prova.refuse = (op) => (op.t === "step.add" && ++adds === 2 ? "limit" : null);
  assert.deepEqual(await confirmPreGeneratedActivities(WS, UNIT, [proposal("Uno"), proposal("Due"), proposal("Tre")] as never), { saved: 2 });
});
