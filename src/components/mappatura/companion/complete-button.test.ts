import test from "node:test";
import assert from "node:assert/strict";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { enableTsxImports } from "../../use-cases/detail/referent/tsx-test-loader.ts";
import { FIXTURE_IDS, fixtureBoard } from "../../../lib/mappatura/board-fixture.ts";
import type { MappingBoard } from "../../../lib/mappatura/board-model.ts";
import type { CompletionOutcome } from "../../../lib/mappatura/complete.ts";
import { BOARD_TEXT } from "../../../lib/mappatura/text.ts";

// (Mappatura board) «Completa la mappatura» e «Classifica {n} passi» (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.3, §1.4,
// §4.10, §7.3): quale bottone, che cosa manda, che cosa dice dopo; uno alla volta per board; spento in sola lettura.

await enableTsxImports();
const { BoardProvider } = await import("../store/use-board.tsx");
const { CompleteButton } = await import("./complete-button.tsx");
const { completeUrl, completionLabel, completionMode, completionStore, completionToast, openClassificationTab, runCompletion } = await import("./completion.ts");

const I = FIXTURE_IDS;
const h = <P extends object>(type: (props: P) => ReactNode, props: Omit<P, "children"> | null = null, ...children: ReactNode[]) =>
  createElement(type as unknown as FunctionComponent<Omit<P, "children">>, props, ...children);
const button = (board: MappingBoard) =>
  renderToStaticMarkup(h(BoardProvider, { workspaceId: I.workspace, departmentId: I.unit, userId: I.user, initial: board }, h(CompleteButton, { workspaceId: I.workspace, departmentId: I.unit })));

const outcome = (over: Partial<CompletionOutcome> = {}): CompletionOutcome => ({
  firstCompletion: true,
  total: 6,
  classified: 5,
  remaining: 0,
  counts: { automate: 3, differentiate: 1, innovate: 1 },
  classification: "fatta",
  matched: 3,
  avgExposurePct: 32,
  onet: "fatto",
  ...over,
});

test("quale bottone: completare un'unità con dei passi; dopo, classificare quello che resta; altrimenti niente", () => {
  assert.deepEqual(completionMode(fixtureBoard()), { kind: "complete" });
  assert.equal(completionMode(fixtureBoard({ empty: true })), null, "senza passi non si completa");
  const classified = fixtureBoard({ classified: true });
  assert.deepEqual(completionMode(classified), { kind: "classify", steps: 1 }, "«Invio dell'ordine» è senza stream");
  const all = { ...classified, processes: classified.processes.map((process) => ({ ...process, steps: process.steps.map((step) => ({ ...step, stream: step.stream ?? ("automate" as const) })) })) };
  assert.equal(completionMode(all), null);
  assert.deepEqual(completionMode({ ...all, unit: { ...all.unit, status: "validated" } }), null);
  assert.deepEqual(
    [completionLabel({ kind: "complete" }, false), completionLabel({ kind: "classify", steps: 1 }, false), completionLabel({ kind: "classify", steps: 3 }, false), completionLabel({ kind: "complete" }, true)],
    ["Completa la mappatura", "Classifica 1 passo", "Classifica 3 passi", "Classificazione in corso…"],
  );
});

test("il bottone nella testa: pieno; spento su una board in sola lettura; niente quando non serve", () => {
  assert.equal(button(fixtureBoard()), '<button data-action="complete" type="button" class="b-btn b-primary" data-b="button" data-variant="primary">Completa la mappatura</button>');
  assert.match(button(fixtureBoard({ readOnly: true })), /^<button disabled="" data-action="complete"[^>]*>Completa la mappatura<\/button>$/);
  assert.match(button(fixtureBoard({ classified: true })), />Classifica 1 passo<\/button>$/);
  assert.equal(button(fixtureBoard({ empty: true })), "");
});

test("il toast dopo il bottone: tutto classificato, una parte, niente, niente da fare; «Apri» dove porta alla classificazione", () => {
  assert.deepEqual(completionToast(outcome()), { text: "Mappatura completata: 5 passi classificati.", open: true });
  assert.deepEqual(completionToast(outcome({ classification: "parziale", classified: 3, remaining: 2 })), { text: "Classificati 3 passi su 5. Riprova per gli altri.", open: false });
  assert.deepEqual(completionToast(outcome({ classification: "non_riuscita", classified: 0, remaining: 5 })), { text: "Classificazione non riuscita. Riprova.", open: false });
  assert.deepEqual(completionToast(outcome({ classification: "niente_da_fare", classified: 0 })), { text: "Mappatura completata.", open: true });
  assert.deepEqual(completionToast(null), { text: "Classificazione non riuscita. Riprova.", open: false });
});

function fakeClient() {
  const calls: Array<[string, ...unknown[]]> = [];
  const client = {
    saveNow: async () => void calls.push(["saveNow"]),
    replace: (board: MappingBoard) => void calls.push(["replace", board.revision]),
    notify: (text: string, action?: { label: string; run(): void }) => void calls.push(["notify", text, action?.label, action?.run]),
    pull: async () => void calls.push(["pull"]),
  };
  return { client, calls };
}

test("completare: prima si salvano le modifiche in coda, poi POST …/complete; la board che torna diventa la base, e il toast", async () => {
  const { client, calls } = fakeClient();
  const requests: Array<[string, RequestInit | undefined]> = [];
  const board = { ...fixtureBoard({ classified: true }), revision: 9 };
  let opened = 0;
  await runCompletion({
    workspaceId: I.workspace,
    departmentId: I.unit,
    client,
    openClassification: () => void (opened += 1),
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(["fetch"]);
      requests.push([String(url), init]);
      return Response.json({ outcome: outcome(), board });
    }) as typeof fetch,
  });
  assert.deepEqual(calls.map(([name]) => name), ["saveNow", "fetch", "replace", "notify"]);
  assert.deepEqual(requests.map(([url, init]) => [url, init?.method, init?.body]), [[completeUrl(I.workspace, I.unit), "POST", "{}"]]);
  assert.equal(completeUrl(I.workspace, I.unit), `/api/workspaces/${I.workspace}/mapping/${I.unit}/complete`);
  assert.deepEqual(calls[2], ["replace", 9]);
  const [, text, label, run] = calls[3] as [string, string, string, () => void];
  assert.deepEqual([text, label], ["Mappatura completata: 5 passi classificati.", "Apri"]);
  run();
  assert.equal(opened, 1);
});

test("se il completamento non va: senza la 0039 la frase della sola lettura; un errore o la rete, «Classificazione non riuscita»; niente si sostituisce", async () => {
  for (const [label, respond, expected] of [
    ["503", () => new Response("{}", { status: 503 }), BOARD_TEXT.storeMissing],
    ["500", () => new Response("{}", { status: 500 }), "Classificazione non riuscita. Riprova."],
    ["rete", () => Promise.reject(new TypeError("Failed to fetch")), "Classificazione non riuscita. Riprova."],
  ] as const) {
    const { client, calls } = fakeClient();
    await runCompletion({ workspaceId: I.workspace, departmentId: I.unit, client, openClassification() {}, fetch: (async () => respond()) as typeof fetch });
    assert.deepEqual(
      calls.map(([name, text]) => (name === "notify" ? [name, text] : [name])),
      [["saveNow"], ["notify", expected]],
      label,
    );
  }
});

test("senza passi sul server (eliminati da altri, o mai salvati): il toast lo dice, la board si rilegge, niente si sostituisce", async () => {
  const { client, calls } = fakeClient();
  await runCompletion({
    workspaceId: I.workspace,
    departmentId: I.unit,
    client,
    openClassification() {},
    fetch: (async () => Response.json({ code: "senza_passi" }, { status: 409 })) as typeof fetch,
  });
  assert.deepEqual(
    calls.map(([name, text]) => (name === "notify" ? [name, text] : [name])),
    [["saveNow"], ["notify", "Aggiungi almeno un passo prima di completare la mappatura."], ["pull"]],
  );
  assert.equal(BOARD_TEXT.toast.noSteps, "Aggiungi almeno un passo prima di completare la mappatura.");
});

test("uno alla volta per board: un secondo clic mentre lavora non manda niente, e i bottoni delle due schede lo sanno", async () => {
  const { client } = fakeClient();
  let release!: () => void;
  let fetches = 0;
  const fetch = (async () => {
    fetches += 1;
    await new Promise<void>((resolve) => (release = resolve));
    return Response.json({ outcome: outcome(), board: fixtureBoard({ classified: true }) });
  }) as typeof globalThis.fetch;
  const store = completionStore(client);
  const seen: boolean[] = [];
  const stop = store.subscribe(() => seen.push(store.working()));
  const first = runCompletion({ workspaceId: I.workspace, departmentId: I.unit, client, fetch, openClassification() {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(store.working(), true);
  await runCompletion({ workspaceId: I.workspace, departmentId: I.unit, client, fetch, openClassification() {} });
  assert.equal(fetches, 1, "il secondo clic non parte");
  release();
  await first;
  assert.equal(store.working(), false);
  assert.deepEqual(seen, [true, false]);
  stop();
  assert.equal(completionStore({}).working(), false, "un'altra board ha il suo stato");
});

test("«Apri» porta alla scheda «Classificazione»: cambia l'indirizzo, o lo riannuncia se è già quello", () => {
  const events: string[] = [];
  const win = { location: { hash: "#oggi" }, dispatchEvent: (event: Event) => (events.push(event.type), true) };
  openClassificationTab(win);
  assert.equal(win.location.hash, "classificazione");
  win.location.hash = "#classificazione";
  openClassificationTab(win);
  assert.deepEqual(events, ["hashchange"]);
  openClassificationTab(null);
});
