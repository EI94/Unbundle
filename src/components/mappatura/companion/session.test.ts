import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ev, fakeAppClaude, installAppModules, recordLogs, sse } from "../../../lib/ai/claude-test-kit.ts";
import { FIXTURE_IDS, fixtureBoard } from "../../../lib/mappatura/board-fixture.ts";
import { allSteps, type MappingBoard } from "../../../lib/mappatura/board-model.ts";
import type { BoardOp } from "../../../lib/mappatura/board-ops.ts";
import { HIDDEN_TOOLS, MAPPING_TOOL_LABELS, TOOL_LABELS, assistantView } from "../../agent/chat-view.ts";

// (Mappatura board) Come un salvataggio dell'assistente arriva alla board aperta (docs/mappatura/MAPPATURA-BOARD-PIANO.md
// §5.3): ogni tool della board finito rilegge la board una volta per toolCallId, un tool fallito o nascosto mai; alla
// fine del turno la board si rilegge ancora; dopo il completamento il toast con «Apri». In fondo, una chat vera: la
// rotta /api/ai/chat con il Claude finto, i tool veri su una board finta, il Chat di AI SDK e lo store vero della board
// nel browser: dopo «Passo salvato» il passo è nello store, senza ricaricare.

const I = FIXTURE_IDS;
type Prova = { board: MappingBoard; saves: BoardOp[][]; requests: Array<Record<string, unknown>> };
const prova: Prova = { board: fixtureBoard(), saves: [], requests: [] };
(globalThis as { __prova?: Prova }).__prova = prova;

await installAppModules({
  "@/lib/auth": `export async function auth() { return { user: { id: "33333333-cccc-4ccc-8ccc-333333333333", email: "persona@cliente.test", emailVerified: true } }; }`,
  "@/lib/workspace-access": `export async function getCollaboratorAccess(userId, workspaceId) {
    return { role: "contributor", workspace: { id: workspaceId, name: "Officina di prova", organizationId: "org-prova", unitTerminology: null, systemBoundary: null } };
  }`,
  "@/lib/db/queries/use-case-program": `export function canEditProgram() { return false; }`,
  "@/lib/db/queries/use-case-hub": `export function viewerFromSession() { return { isLateralSpace: false }; }`,
  "@/lib/ai/tools/leadership-tools": `export function getLeadershipTools() { return {}; }`,
  "@/lib/ai/tools/web-search-tool": `export function getWebSearchTool() { return {}; }`,
  "@/lib/db/queries/conversations": `
    export async function getActiveConversation() { return { id: "conv-prova" }; }
    export async function createConversation() { return { id: "conv-prova" }; }
    export async function saveMessage(message) { return { id: "msg-prova", ...message }; }
    export async function deleteMessage() {}
    export async function getMessages() { return []; }`,
  "@/lib/ai/rag/retriever": `export async function retrieveRelevantContext() { return []; } export function indexConversationMessage() { return Promise.resolve(); }`,
  // (Rilascio insieme) La rotta della chat passa anche dai controlli di «Contesto» (rilascio 9a): l'unità del workspace,
  // l'ok ai sub-responsabili (qui c'è), la tesi del valore del workspace e i documenti «Per tutti».
  "@/lib/db/queries/workspaces": `export async function getDepartmentById(id) {
    return id.toLowerCase() === ${JSON.stringify(I.unit)} ? { id: id.toLowerCase(), workspaceId: ${JSON.stringify(I.workspace)} } : null;
  }`,
  "@/lib/db/queries/context-consent": `export async function contextAiConsent() { return true; }`,
  "@/lib/db/queries/value-thesis": `export async function getWorkspaceValueThesis() { return null; }`,
  "@/lib/db/queries/context-store": `export async function contextStoreState() { return "pronto"; } export async function contextStoreReady() { return true; }`,
  "@/lib/db/queries/context-sources": `export async function listContextSources() { return []; }`,
  // (Rilascio 9b) Il blocco «Contesto» del prompt della chat: qui niente da dire.
  "@/lib/db/queries/context-work": `export async function loadPromptContext() { return ""; }`,
  "@/lib/context/server/actor": `export function contextActorFor(user, access, workspaceId) {
    return { workspaceId, userId: user.id, role: access.role, isLateralSpace: false, channel: "web" };
  }`,
  "@/lib/db/schema": `export const uploadedDocuments = {}; export const organizations = {};`,
  "drizzle-orm": `export const eq = (column, value) => ({ column, value }); export const and = (...parts) => ({ and: parts });`,
  "@/lib/db": `export const db = {
    select: () => ({ from: () => ({ where: () => Object.assign(Promise.resolve([]), { limit: async () => [{ id: "org-prova", companyValueThesis: null }] }) }) }),
  };`,
  "@/lib/db/uc-executor": `export async function getAppUcExecutor() { return { batch() { throw new Error("niente SQL in questa prova"); } }; }`,
  // La board finta: quella della prova; un salvataggio applica le operazioni come il browser e alza la revisione.
  "@/lib/mappatura/board-store": `
    import { applyOps } from ${JSON.stringify(new URL("../../../lib/mappatura/board-ops.ts", import.meta.url).href)};
    const ok = (scope) => scope.workspaceId === ${JSON.stringify(I.workspace)} && scope.departmentId.toLowerCase() === ${JSON.stringify(I.unit)};
    export async function mappingStoreReady() { return true; }
    export async function readBoard(executor, scope) { return ok(scope) ? globalThis.__prova.board : null; }
    export async function resolveProcess(executor, scope, name) {
      const board = globalThis.__prova.board;
      return (name ? board.processes.find((process) => process.name === name) : board.processes[0])?.id ?? null;
    }
    export async function saveBoardOps(executor, scope, actor, input) {
      if (!ok(scope)) return { ok: false, code: "non_trovata" };
      globalThis.__prova.saves.push(input.ops);
      const board = applyOps(globalThis.__prova.board, input.ops, actor);
      globalThis.__prova.board = { ...board, revision: board.revision + 1, savedAt: "2026-11-16T10:00:00.000Z" };
      return { ok: true, revision: globalThis.__prova.board.revision, savedAt: globalThis.__prova.board.savedAt, rejected: [], board: globalThis.__prova.board };
    }`,
});
const { POST } = await import("../../../app/api/ai/chat/route.ts");
const { createBoardClient } = await import("../store/board-client.ts");
const { BOARD_TOOLS, companionSessionFor, createCompanionSession, createToolWatch, finishedBoardTools, seedMessages } = await import("./session.ts");

type Part = { type: string; toolCallId?: string; state?: string; output?: unknown };
const reply = (id: string, parts: Part[]) => ({ id, role: "assistant", parts });
const done = (name: string, id: string, output: unknown = { success: true }): Part => ({ type: `tool-${name}`, toolCallId: id, state: "output-available", output });

test("i tool della board: sono i quattro che scrivono sulla board", () => {
  assert.deepEqual([...BOARD_TOOLS].sort(), ["linkActivityDependency", "markDepartmentMapped", "saveActivity", "updateActivity"]);
});

test("un tool della board finito rilegge la board una volta per toolCallId; uno fallito, nascosto, in corso o d'altro mai", () => {
  const watch = createToolWatch();
  const turn = reply("a1", [
    { type: "step-start" },
    done("saveActivity", "t1"),
    { type: "tool-webSearch", toolCallId: "t2", state: "output-available", output: {} },
    done("saveStrategicGoal", "t3"),
    { type: "tool-updateActivity", toolCallId: "t4", state: "output-error" },
    done("linkActivityDependency", "t5", { success: false, message: "Dipendenza non collegata." }),
    { type: "tool-saveActivity", toolCallId: "t6", state: "input-available" },
  ]);
  assert.deepEqual(finishedBoardTools([turn]), [{ id: "t1", name: "saveActivity" }]);
  assert.deepEqual(watch.take([turn]), { pull: true, completed: false });
  // Gli stessi messaggi di nuovo (un altro pezzo della risposta che arriva): niente.
  assert.deepEqual(watch.take([turn]), { pull: false, completed: false });
  // Il tool in corso finisce: una rilettura in più; il completamento lo dice.
  const later = reply("a1", [...turn.parts.slice(0, 6), done("saveActivity", "t6"), done("markDepartmentMapped", "t7")]);
  assert.deepEqual(watch.take([later]), { pull: true, completed: true });
  // I messaggi di una persona non contano; i tool già nei messaggi di partenza nemmeno.
  assert.deepEqual(createToolWatch([later]).take([later, { id: "u1", role: "user", parts: [done("saveActivity", "t9")] }]), { pull: false, completed: false });
});

test("la sessione: osserva i messaggi, rilegge la board e dopo il completamento il toast con «Apri»; la stessa per lo stesso store", () => {
  const calls: string[] = [];
  const toasts: Array<{ text: string; label?: string; run?: () => void }> = [];
  const client = { pull: async () => void calls.push("pull"), notify: (text: string, action?: { label: string; run(): void }) => void toasts.push({ text, label: action?.label, run: action?.run }) };
  const create = () =>
    createCompanionSession({ workspaceId: I.workspace, departmentId: I.unit, unitName: "Ufficio acquisti", hasDocuments: false, initialMessages: [], client, openClassification: () => void calls.push("apri") });
  const session = companionSessionFor(client, create);
  assert.equal(companionSessionFor(client, create), session, "chiudere e riaprire il pannello non perde la conversazione");
  assert.notEqual(companionSessionFor({}, create), session);
  // Senza messaggi salvati, il benvenuto.
  assert.deepEqual(session.chat.messages.map((message) => message.id), ["welcome"]);
  session.observe([reply("a1", [done("saveActivity", "t1")])]);
  session.observe([reply("a1", [done("saveActivity", "t1"), done("markDepartmentMapped", "t2")])]);
  assert.deepEqual(calls, ["pull", "pull"]);
  assert.deepEqual(toasts.map(({ text, label }) => [text, label]), [["Mappatura completata.", "Apri"]]);
  toasts[0].run?.();
  assert.deepEqual(calls.at(-1), "apri");
});

test("i messaggi di partenza: quelli salvati com'erano, o il benvenuto con il nome dell'unità", () => {
  assert.deepEqual(seedMessages({ unitName: "x", hasDocuments: false, initialMessages: [{ id: "m1", role: "user", content: "Le richieste arrivano per posta." }] }), [
    { id: "m1", role: "user", parts: [{ type: "text", text: "Le richieste arrivano per posta." }] },
  ]);
  const [welcome] = seedMessages({ unitName: "Ufficio acquisti", hasDocuments: true, initialMessages: [] });
  assert.equal(welcome.role, "assistant");
  assert.match((welcome.parts[0] as { text: string }).text, /^Mappiamo il lavoro di \*\*Ufficio acquisti\*\*\. .* Ho già i documenti caricati: li uso per fare domande più precise\.$/);
});

test("una chat vera con il Claude finto: «Passo salvato», e dopo la rilettura il passo è nello store della board, senza ricaricare", async (t) => {
  recordLogs(t);
  prova.board = fixtureBoard();
  prova.saves = [];
  prova.requests = [];
  const answer = { title: "Verifica della fattura", description: "Si confronta la fattura con l'ordine.", processName: "Dalla richiesta all'ordine" };
  const claude = fakeAppClaude([
    sse([ev.start("msg_1"), ...ev.toolUse(0, "toolu_passo", "saveActivity", JSON.stringify(answer)), ...ev.end("tool_use")]),
    sse([ev.start("msg_2"), ...ev.text(0, "Fatto: il passo è sulla board, da validare."), ...ev.end("end_turn")]),
  ]);

  // Lo store della board nel browser: legge la board dalla sua rotta (qui: la board finta).
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const client = createBoardClient({
    workspaceId: I.workspace,
    departmentId: I.unit,
    userId: I.user,
    initial: fixtureBoard(),
    fetch: (async (input: string | URL | Request) => {
      const url = new URL(String(input), "http://localhost");
      const since = Number(url.searchParams.get("since"));
      return Response.json(since === prova.board.revision ? { unchanged: true, revision: since } : { board: prova.board });
    }) as typeof fetch,
    storage: null,
    now: () => Date.now(),
    setTimer: (run, ms) => {
      const handle = setTimeout(() => {
        timers.delete(handle);
        run();
      }, ms);
      timers.add(handle);
      return handle;
    },
    clearTimer: (handle) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
      timers.delete(handle as ReturnType<typeof setTimeout>);
    },
    newId: () => randomUUID(),
  });
  t.after(() => {
    client.dispose();
    for (const handle of timers) clearTimeout(handle);
  });
  const toasts: string[] = [];
  const session = createCompanionSession({
    workspaceId: I.workspace,
    departmentId: I.unit,
    unitName: "Ufficio acquisti",
    hasDocuments: false,
    initialMessages: [],
    client: { pull: () => client.pull(), notify: (text) => void toasts.push(text) },
    openClassification: () => {},
    // La rotta vera, chiamata come la chiama il browser.
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      prova.requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return POST(new Request(new URL(String(input), "http://localhost"), init));
    }) as typeof fetch,
  });

  const before = allSteps(client.getState().board).length;
  await session.chat.sendMessage({ role: "user", parts: [{ type: "text", text: "Ogni fattura si controlla a mano con l'ordine." }] });
  // La rilettura parte alla fine del turno: si aspetta che arrivi.
  for (let tries = 0; tries < 50 && allSteps(client.getState().board).length === before; tries++) await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(claude.length, 2, "il tool e poi la risposta");
  // La richiesta del browser: la conversazione dell'activity mapping di questa unità, senza il benvenuto tra i turni.
  assert.deepEqual(
    prova.requests.map((body) => [body.workspaceId, body.conversationType, body.departmentId]),
    [[I.workspace, "activity_mapping", I.unit]],
  );
  // Il tool vero ha scritto con la board: un passo nel processo nominato.
  assert.equal(prova.saves.length, 1);
  assert.equal(prova.saves[0][0].t, "step.add");
  // La risposta nel browser: il tool finito, con la sua etichetta della board, e il testo.
  const last = session.chat.messages.at(-1)!;
  const toolPart = last.parts.find((part) => part.type === "tool-saveActivity") as { state?: string; output?: { success?: boolean } } | undefined;
  assert.equal(toolPart?.state, "output-available");
  assert.equal(toolPart?.output?.success, true);
  assert.deepEqual(assistantView(last, HIDDEN_TOOLS, { arriving: false, labels: { ...TOOL_LABELS, ...MAPPING_TOOL_LABELS } }), {
    kind: "answer",
    text: "Fatto: il passo è sulla board, da validare.",
    progress: [{ kind: "tool", label: "Passo salvato", done: true }],
  });
  // Lo store della board ha il passo nuovo, «da validare», dall'assistente.
  const step = allSteps(client.getState().board).find((item) => item.title === "Verifica della fattura");
  assert.ok(step, "il passo è sulla board aperta");
  assert.deepEqual([step.status, step.origin], ["da_validare", "chat"]);
  assert.equal(client.getState().board.processes[0].steps.at(-1)?.id, step.id, "in fondo al processo nominato");
  assert.equal(client.getState().pill, "saved", "nessuna modifica della persona in coda");
  assert.deepEqual(toasts, []);
});
