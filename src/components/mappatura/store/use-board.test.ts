import test from "node:test";
import assert from "node:assert/strict";
import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { enableTsxImports } from "../../use-cases/detail/referent/tsx-test-loader.ts";
import { fixtureBoard } from "../../../lib/mappatura/board-fixture.ts";

// La board nel browser, per React (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.7): il collegamento con la pagina
// (bozza alla partenza, salvataggio quando la pagina si nasconde o si chiude, rilettura quando torna visibile, in linea
// o no), il posto del toast (in fondo alla pagina, o nel drawer aperto più in alto) e il primo disegno sul server.

await enableTsxImports();
const { BoardProvider, PAGE_TOAST_HOST, connectBrowser, createToastHosts, useBoard, useBoardClient, useOptionalBoardState, useToastHost } = await import("./use-board.tsx");
const { DRAFT_PREFIX, clearBoardDrafts, draftKey, signOutBoards } = await import("./drafts.ts");

/** Un bersaglio di eventi finto: chi ascolta che cosa. */
function target<T extends object>(extra: T) {
  const listeners = new Map<string, Set<() => void>>();
  return Object.assign(extra, {
    listeners,
    addEventListener(type: string, listener: () => void) {
      listeners.set(type, (listeners.get(type) ?? new Set()).add(listener));
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
    fire(type: string) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener();
    },
    count: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  });
}

function fakeClient(pending = 0) {
  const calls: string[] = [];
  const client = {
    pending,
    start: () => void calls.push("start"),
    setOnline: (online: boolean) => void calls.push(`online:${online}`),
    saveNow: async (options?: { hidden?: boolean }) => void calls.push(`save:${options?.hidden === true ? "nascosta" : "normale"}`),
    pull: async () => void calls.push("pull"),
    signOut: async () => void calls.push("esce"),
    getState: () => ({ pending: client.pending }) as ReturnType<Parameters<typeof connectBrowser>[0]["getState"]>,
  };
  return { client, calls };
}

test("collegata alla pagina: la bozza alla partenza, il browser in linea o no, i salvataggi quando la pagina si nasconde o si chiude", () => {
  const { client, calls } = fakeClient();
  const win = target({ navigator: { onLine: true } });
  const doc = target({ visibilityState: "visible" as DocumentVisibilityState });
  const stop = connectBrowser(client, win, doc);
  assert.deepEqual(calls, ["start", "online:true"]);

  win.navigator.onLine = false;
  win.fire("offline");
  win.navigator.onLine = true;
  win.fire("online");
  assert.deepEqual(calls.slice(2), ["online:false", "online:true"]);

  // Niente da salvare: la pagina che si nasconde non manda niente; quella che torna visibile rilegge la board.
  calls.length = 0;
  doc.visibilityState = "hidden";
  doc.fire("visibilitychange");
  win.fire("pagehide");
  assert.deepEqual(calls, []);
  doc.visibilityState = "visible";
  doc.fire("visibilitychange");
  assert.deepEqual(calls, ["pull"]);

  // Con delle modifiche: la pagina che si nasconde e quella che si chiude salvano subito, tutte e due come pagina
  // nascosta (keepalive se il corpo ci sta: sul telefono una pagina in secondo piano può essere fermata senza
  // `pagehide`); tornando visibile non rilegge.
  calls.length = 0;
  client.pending = 2;
  doc.visibilityState = "hidden";
  doc.fire("visibilitychange");
  assert.deepEqual(calls, ["save:nascosta"], "basta nascondersi");
  win.fire("pagehide");
  doc.visibilityState = "visible";
  doc.fire("visibilitychange");
  assert.deepEqual(calls, ["save:nascosta", "save:nascosta"]);

  // Staccata (la pagina lascia la board, l'app resta aperta): nessuno ascolta più, e quello che resta si salva.
  calls.length = 0;
  stop();
  assert.equal(win.count() + doc.count(), 0);
  assert.deepEqual(calls, ["save:normale"]);
  win.fire("pagehide");
  doc.fire("visibilitychange");
  assert.deepEqual(calls, ["save:normale"]);
});

test("uscire dall'app: ogni board aperta manda quello che resta e lascia la sua bozza, poi nessuna bozza resta; staccata, non conta più", async () => {
  const { client, calls } = fakeClient(1);
  const stop = connectBrowser(client, target({ navigator: { onLine: true } }), target({ visibilityState: "visible" as DocumentVisibilityState }));
  calls.length = 0;
  const keys = [draftKey("persona-a", "unita-1"), draftKey("persona-b", "unita-2"), "un-altro-dato", "unbundle-tema"];
  const stored = new Map(keys.map((key) => [key, "{}"]));
  const storage = {
    get length() {
      return stored.size;
    },
    key: (index: number) => [...stored.keys()][index] ?? null,
    removeItem: (key: string) => void stored.delete(key),
  };
  await signOutBoards(storage);
  assert.deepEqual(calls, ["esce"]);
  assert.deepEqual([...stored.keys()], ["un-altro-dato", "unbundle-tema"], "solo le bozze della board si tolgono");
  assert.ok(keys.slice(0, 2).every((key) => key.startsWith(DRAFT_PREFIX)));
  // Staccata (la pagina ha lasciato la board): uscire non la chiama più. Senza memoria non si rompe niente.
  stop();
  calls.length = 0;
  await signOutBoards(null);
  assert.deepEqual(calls, []);
  clearBoardDrafts(null);
});

test("uscire non aspetta per sempre una board che non risponde", async () => {
  const stuck = { ...fakeClient(1).client, signOut: () => new Promise<void>(() => {}) };
  const stop = connectBrowser(stuck, target({ navigator: { onLine: true } }), target({ visibilityState: "visible" as DocumentVisibilityState }));
  const started = Date.now();
  await signOutBoards(null, 20);
  assert.ok(Date.now() - started < 1_000);
  stop();
});

test("staccata senza niente da salvare non manda niente; un browser che non dice se è in linea vale in linea", () => {
  const { client, calls } = fakeClient();
  const stop = connectBrowser(client, target({ navigator: {} }), target({ visibilityState: "visible" as DocumentVisibilityState }));
  stop();
  assert.deepEqual(calls, ["start", "online:true"]);
});

test("il posto del toast: la pagina; un drawer aperto lo prende, quello aperto per ultimo lo tiene; chiusi, torna alla pagina", () => {
  const hosts = createToastHosts();
  let changes = 0;
  const stop = hosts.subscribe(() => {
    changes += 1;
  });
  assert.equal(hosts.current(), PAGE_TOAST_HOST);
  const releaseStep = hosts.claim("passo");
  const releaseText = hosts.claim("testo");
  assert.equal(hosts.current(), "testo");
  releaseStep();
  assert.equal(hosts.current(), "testo", "chiude il drawer di sotto: il posto resta a quello di sopra");
  releaseText();
  assert.equal(hosts.current(), PAGE_TOAST_HOST);
  releaseText();
  assert.equal(changes, 4, "lasciare un posto già lasciato non avvisa");
  stop();
  hosts.claim("passo");
  assert.equal(changes, 4, "chi ha smesso di ascoltare non viene più chiamato");
});

test("il primo disegno, sul server: lo stato è quello della board letta, e fuori da BoardProvider non c'è uno store", () => {
  const seen: unknown[] = [];
  function Pillola() {
    const pill = useBoard((state) => state.pill);
    const steps = useBoard((state) => state.board.processes.reduce((sum, process) => sum + process.steps.length, 0));
    seen.push(useBoardClient().getState().pending, useToastHost());
    return createElement("span", { "data-pill": pill }, String(steps));
  }
  const board = fixtureBoard();
  // I figli dopo le props: il tipo di React li vorrebbe tra le props, la regola di lint no.
  const Provider = BoardProvider as unknown as FunctionComponent<Omit<Parameters<typeof BoardProvider>[0], "children">>;
  const html = renderToStaticMarkup(createElement(Provider, { workspaceId: board.unit.id, departmentId: board.unit.id, userId: board.unit.id, initial: board }, createElement(Pillola)));
  const steps = board.processes.reduce((sum, process) => sum + process.steps.length, 0);
  assert.equal(html, `<span data-pill="saved">${steps}</span>`);
  assert.deepEqual(seen, [0, PAGE_TOAST_HOST]);

  function Fuori() {
    return createElement("span", null, useOptionalBoardState() === null ? "nessuno" : "store", useToastHost());
  }
  assert.equal(renderToStaticMarkup(createElement(Fuori)), `<span>nessuno${PAGE_TOAST_HOST}</span>`);
  function Senza() {
    useBoardClient();
    return null;
  }
  assert.throws(() => renderToStaticMarkup(createElement(Senza)), /manca BoardProvider/);
});
