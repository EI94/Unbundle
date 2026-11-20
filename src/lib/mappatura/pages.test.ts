import test from "node:test";
import assert from "node:assert/strict";
import type { ReactElement } from "react";
import { installAppModules } from "../ai/claude-test-kit.ts";
import { enableTsxImports } from "../../components/use-cases/detail/referent/tsx-test-loader.ts";
import { FIXTURE_IDS, fixtureBoard, fixtureUnits } from "./board-fixture.ts";
import type { MappingBoard } from "./board-model.ts";

// Le due pagine della mappatura (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.1, §4.10, §6): leggono e montano, niente di
// più. Le pagine vere, con chi guarda, il database e le letture finti; i componenti sono quelli veri, non disegnati:
// qui conta che cosa ricevono.
// - S2: la board per chi guarda; un'unità di un altro workspace è un 404 e niente altro si legge; gli use case che chi
//   guarda può vedere, una volta sola; la conversazione dell'unità e i documenti; l'assistente aperto con `?mode=chat`
//   o senza passi; i tre slot del compagno con le loro props;
// - S1: una lettura sola per tutte le unità.

const WS = FIXTURE_IDS.workspace;
// L'area «Use case» spenta, salvo dove una prova la accende: l'ambiente di chi lancia i test non conta.
delete process.env.USE_CASE_HUB_WORKSPACES;
delete process.env.USE_CASE_HUB_EXCLUDE;
const USER = "33333333-cccc-4ccc-8ccc-333333333333";
type Call = [name: string, ...args: unknown[]];
type Pagina = {
  calls: Call[];
  unitName?: string | null | Error;
  board: MappingBoard | null;
  conversation: { id: string } | null;
  hasDocuments: boolean;
  links: { links: unknown[]; byStep: Map<string, string[]> };
};
const pagina: Pagina = { calls: [], board: null, conversation: null, hasDocuments: false, links: { links: [], byStep: new Map() } };
(globalThis as { __pagina?: Pagina }).__pagina = pagina;

await installAppModules({
  // (Rilascio insieme) L'assistente importa l'avviso dell'ok di «Contesto» (rilascio 9a), con la sua azione del server.
  "@/lib/actions/uc-subprocessors": `export async function declareSubprocessorsAction() { return { ok: true }; }`,
  "@/lib/auth/require-workspace": `export async function requireWorkspacePage(workspaceId) {
    globalThis.__pagina.calls.push(["requireWorkspacePage", workspaceId]);
    return { session: { user: { id: ${JSON.stringify(USER)}, email: "persona@cliente.test", emailVerified: true } }, access: { role: "contributor", source: "workspace", workspace: { id: workspaceId, name: "Officina di prova", unitTerminology: { singular: "reparto", plural: "reparti" } } } };
  }`,
  "@/lib/db/uc-executor": `export const EXECUTOR = { batch() { throw new Error("la pagina non scrive SQL da sé"); } };
    export async function getAppUcExecutor() { return EXECUTOR; }`,
  "@/lib/mappatura/board-store": `export async function readBoard(executor, scope, viewer) { globalThis.__pagina.calls.push(["readBoard", executor, scope, viewer]); return globalThis.__pagina.board; }`,
  "@/lib/mappatura/units": `
    export async function listUnitBoards(executor, workspaceId) { globalThis.__pagina.calls.push(["listUnitBoards", executor, workspaceId]); return globalThis.__pagina.units; }
    export async function unitHasDocuments(executor, scope) { globalThis.__pagina.calls.push(["unitHasDocuments", executor, scope]); return globalThis.__pagina.hasDocuments; }
    export async function unitName(executor, scope) { globalThis.__pagina.calls.push(["unitName", executor, scope]); if (globalThis.__pagina.unitName instanceof Error) throw globalThis.__pagina.unitName; return globalThis.__pagina.unitName; }`,
  "@/lib/mappatura/use-case-links": `export async function boardUseCaseLinks(workspaceId, viewer, stepIds) { globalThis.__pagina.calls.push(["boardUseCaseLinks", workspaceId, viewer, [...stepIds]]); return globalThis.__pagina.links; }`,
  "@/lib/db/queries/conversations": `
    export async function getActiveConversation(...args) { globalThis.__pagina.calls.push(["getActiveConversation", ...args]); return globalThis.__pagina.conversation; }
    export async function getMessages(id) { globalThis.__pagina.calls.push(["getMessages", id]); return [
      { id: "m1", conversationId: id, role: "user", content: "Le richieste arrivano per posta.", toolInvocations: null, createdAt: new Date(0) },
      { id: "m2", conversationId: id, role: "assistant", content: "Passo salvato.", toolInvocations: [{}], createdAt: new Date(1) },
    ]; }`,
  "@/lib/db/queries/use-case-hub": `export function viewerFromSession(user, role) { return { userId: user.id, email: user.email, emailVerified: user.emailVerified === true, role, isLateralSpace: false }; }`,
});
await enableTsxImports();
const unitPage = (await import("../../app/(dashboard)/dashboard/[workspaceId]/mapping/[deptId]/page.tsx")).default;
const listPage = (await import("../../app/(dashboard)/dashboard/[workspaceId]/mapping/page.tsx")).default;
const unitLayout = (await import("../../app/(dashboard)/dashboard/[workspaceId]/mapping/[deptId]/layout.tsx")).default;
const { BoardLoadingNames } = await import("../../components/mappatura/board/loading-header.tsx");
const { BoardProvider } = await import("../../components/mappatura/store/use-board.tsx");
const { UnitBoard } = await import("../../components/mappatura/board/unit-board.tsx");
const { Companion } = await import("../../components/mappatura/companion/companion.tsx");
const { CompleteButton } = await import("../../components/mappatura/companion/complete-button.tsx");
const { ClassificationView } = await import("../../components/mappatura/classification/classification-view.tsx");
const { EXECUTOR } = (await import("@/lib/db/uc-executor" as string)) as { EXECUTOR: unknown };

type Element = ReactElement<Record<string, unknown>>;
const open = (deptId: string, search: Record<string, string> = {}) =>
  unitPage({ params: Promise.resolve({ workspaceId: WS, deptId }), searchParams: Promise.resolve(search) }) as Promise<Element>;
const called = (name: string) => pagina.calls.filter((call) => call[0] === name);
function reset(board: MappingBoard | null) {
  pagina.calls = [];
  pagina.board = board;
  pagina.conversation = { id: "conv-1" };
  pagina.hasDocuments = true;
  pagina.links = { links: [{ id: "uc-1", code: "UC-0001", title: "Richieste in un modulo solo", href: `/dashboard/${WS}/use-cases/uc-1`, stream: null }], byStep: new Map([[FIXTURE_IDS.richieste, ["uc-1"]]]) };
}

test("la board di un'unità: letta per chi guarda, con gli use case che può vedere; la vista della board e i tre slot del compagno", async () => {
  const board = fixtureBoard({ classified: true });
  reset(board);
  const page = await open(board.unit.id.toUpperCase());
  // Prima il controllo della pagina, poi la board per chi guarda, con il workspace e l'unità dell'indirizzo.
  assert.deepEqual(pagina.calls.slice(0, 2), [
    ["requireWorkspacePage", WS],
    ["readBoard", EXECUTOR, { workspaceId: WS, departmentId: board.unit.id.toUpperCase() }, { userId: USER, role: "contributor" }],
  ]);
  // Gli use case: per chi guarda (le bozze nascoste restano nascoste), con i passi di questa board.
  const [[, linksWs, viewer, stepIds]] = called("boardUseCaseLinks");
  assert.equal(linksWs, WS);
  assert.deepEqual(viewer, { userId: USER, email: "persona@cliente.test", emailVerified: true, role: "contributor", isLateralSpace: false });
  assert.deepEqual(new Set(stepIds as string[]), new Set(board.processes.flatMap((process) => process.steps.map((step) => step.id))));
  // La conversazione e i documenti dell'unità, con l'id come lo scrive il database.
  assert.deepEqual(called("getActiveConversation"), [["getActiveConversation", WS, "activity_mapping", board.unit.id]]);
  assert.deepEqual(called("unitHasDocuments"), [["unitHasDocuments", EXECUTOR, { workspaceId: WS, departmentId: board.unit.id }]]);

  // La board nel browser: l'unità, e la board con gli use case collegati.
  assert.equal(page.type, BoardProvider);
  assert.equal(page.props.workspaceId, WS);
  assert.equal(page.props.departmentId, board.unit.id, "la bozza e le rotte usano l'id del database");
  assert.equal(page.props.userId, USER, "la bozza sul dispositivo è di chi guarda");
  const initial = page.props.initial as MappingBoard;
  assert.deepEqual(initial.useCases.map((link) => [link.id, link.code]), [["uc-1", "UC-0001"]]);
  assert.deepEqual(initial.processes[0].steps.find((step) => step.id === FIXTURE_IDS.richieste)?.useCaseIds, ["uc-1"]);

  // La vista della board, con il nome del workspace, la sua parola per le unità e i tre slot.
  const view = page.props.children as Element;
  assert.equal(view.type, UnitBoard);
  assert.deepEqual([view.props.workspaceId, view.props.workspaceName, view.props.unitTerm, view.props.assistantDefaultOpen], [WS, "Officina di prova", { singular: "reparto", plural: "reparti" }, false]);
  const assistant = view.props.assistant as Element;
  assert.equal(assistant.type, Companion);
  assert.deepEqual(assistant.props, {
    workspaceId: WS,
    departmentId: board.unit.id,
    unitName: board.unit.name,
    teamSize: board.unit.teamSize,
    initialMessages: [
      { id: "m1", role: "user", content: "Le richieste arrivano per posta." },
      { id: "m2", role: "assistant", content: "Passo salvato." },
    ],
    hasDocuments: true,
  });
  const classification = view.props.classification as Element;
  assert.equal(classification.type, ClassificationView);
  assert.deepEqual(classification.props, { workspaceId: WS, useCaseHub: false });
  const headAction = view.props.headAction as Element;
  assert.equal(headAction.type, CompleteButton);
  assert.deepEqual(headAction.props, { workspaceId: WS, departmentId: board.unit.id });
});

test("l'assistente si apre da solo con ?mode=chat (i link di prima) e finché l'unità non ha un passo", async () => {
  const assistantOpen = async (board: MappingBoard, search: Record<string, string>) => {
    reset(board);
    const page = await open(board.unit.id, search);
    return (page.props.children as Element).props.assistantDefaultOpen;
  };
  assert.equal(await assistantOpen(fixtureBoard(), { mode: "chat" }), true);
  assert.equal(await assistantOpen(fixtureBoard(), { mode: "altro" }), false);
  assert.equal(await assistantOpen(fixtureBoard({ empty: true }), {}), true);
});

test("senza conversazione nessun messaggio; con l'area «Use case» accesa la classificazione lo sa", async () => {
  process.env.USE_CASE_HUB_WORKSPACES = WS;
  try {
    reset(fixtureBoard());
    pagina.conversation = null;
    pagina.hasDocuments = false;
    const view = (await open(FIXTURE_IDS.unit)).props.children as Element;
    assert.deepEqual(called("getMessages"), []);
    assert.deepEqual((view.props.assistant as Element).props.initialMessages, []);
    assert.equal((view.props.assistant as Element).props.hasDocuments, false);
    assert.equal((view.props.classification as Element).props.useCaseHub, true);
  } finally {
    delete process.env.USE_CASE_HUB_WORKSPACES;
  }
});

test("un'unità di un altro workspace (o un id che non è un'unità): 404, e niente altro si legge", async () => {
  reset(null);
  await assert.rejects(open("22222222-bbbb-4bbb-8bbb-999999999999"), (error: unknown) => (error as { digest?: string }).digest === "NEXT_HTTP_ERROR_FALLBACK;404");
  assert.deepEqual(pagina.calls.map((call) => call[0]), ["requireWorkspacePage", "readBoard"]);
});

test("(rilascio 10, §2.4) il vecchio elenco delle unità porta ai Processi di «Contesto»: un 308 con la query di prima, dopo il controllo di chi guarda", async () => {
  pagina.calls = [];
  const go = (search: Record<string, string | string[]>) => listPage({ params: Promise.resolve({ workspaceId: WS }), searchParams: Promise.resolve(search) });
  const target = (error: unknown) => (error as { digest?: string }).digest ?? "";
  await assert.rejects(go({}), (error: unknown) => target(error) === `NEXT_REDIRECT;replace;/dashboard/${WS}/contesto?vista=processi;308;`);
  assert.deepEqual(pagina.calls, [["requireWorkspacePage", WS]], "nessuna lettura: solo il controllo");
  await assert.rejects(go({ x: "1", vista: "vecchia" }), (error: unknown) => target(error).includes(`/dashboard/${WS}/contesto?vista=processi&x=1;308;`));
});

test("prima della board: il layout dell'unità legge i due nomi per la testata che carica, con il controllo della pagina", async () => {
  const deptId = FIXTURE_IDS.unit;
  const layout = (unitName: string | null | Error) => {
    pagina.calls = [];
    pagina.unitName = unitName;
    return unitLayout({ params: Promise.resolve({ workspaceId: WS, deptId }), children: "la pagina" }) as Promise<Element>;
  };
  const named = await layout("Amministrazione, finanza e controllo di gestione");
  assert.equal(named.type, BoardLoadingNames);
  assert.deepEqual([named.props.unitName, named.props.workspaceName, named.props.children], ["Amministrazione, finanza e controllo di gestione", "Officina di prova", "la pagina"]);
  assert.deepEqual(pagina.calls, [
    ["requireWorkspacePage", WS],
    ["unitName", EXECUTOR, { workspaceId: WS, departmentId: deptId }],
  ]);
  // Un'unità che non è del workspace non ha nome (la pagina risponde 404); una lettura non riuscita non rompe niente.
  assert.equal((await layout(null)).props.unitName, null);
  const failed = await layout(Object.assign(new Error("database giù, con un testo che non deve finire nei log"), { code: "57P01" }));
  assert.deepEqual([failed.type, failed.props.unitName, failed.props.children], [BoardLoadingNames, null, "la pagina"]);
});
