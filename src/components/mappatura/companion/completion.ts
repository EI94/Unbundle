/**
 * «Mappatura board»: «Completa la mappatura» e «Classifica N passi», senza React (docs/mappatura/MAPPATURA-BOARD-PIANO.md
 * §1.3, §1.4, §4.5, §7.3).
 *
 * - Quale bottone: «Completa la mappatura» finché l'unità non è completa e ha almeno un passo; «Classifica N passi»
 *   quando è completa e N passi sono senza stream; niente altrimenti.
 * - Che cosa fa: salva subito le modifiche in coda (i passi a schermo sono quelli che il server classifica), poi
 *   `POST …/complete`; la board che torna diventa la base (`replace`, gli use case collegati restano), e un toast dice
 *   com'è andata. Se sul server l'unità non ha passi (`409`), il toast lo dice e la board si rilegge.
 * - Uno alla volta per board: lo stato «in corso» è dello store della board, così il bottone della testa di «Processi di
 *   oggi» e quello di «Classificazione» lo vedono tutti e due.
 */
import { allSteps, type MappingBoard } from "../../../lib/mappatura/board-model.ts";
import type { CompletionOutcome } from "../../../lib/mappatura/complete.ts";
import { BOARD_TEXT } from "../../../lib/mappatura/text.ts";
import type { BoardClient } from "../store/board-client.ts";
import { CLASSIFICATION_TEXT, classifiedText, classifyButtonLabel, completedClassifiedText, partialText } from "../classification/text.ts";

export type CompletionMode = { kind: "complete" } | { kind: "classify"; steps: number };

const isComplete = (board: Pick<MappingBoard, "unit">) => board.unit.status === "mapped" || board.unit.status === "validated";

/** Il bottone della testa: completare, classificare quello che resta, o niente. */
export function completionMode(board: Pick<MappingBoard, "unit" | "processes">): CompletionMode | null {
  const steps = allSteps(board);
  if (!isComplete(board)) return steps.length > 0 ? { kind: "complete" } : null;
  const unclassified = steps.filter((step) => step.stream === null).length;
  return unclassified > 0 ? { kind: "classify", steps: unclassified } : null;
}

/** La scritta del bottone. */
export function completionLabel(mode: CompletionMode, working: boolean): string {
  if (working) return CLASSIFICATION_TEXT.button.working;
  return mode.kind === "complete" ? CLASSIFICATION_TEXT.button.complete : classifyButtonLabel(mode.steps);
}

/**
 * Il toast dopo il bottone, secondo l'esito; `open`: porta anche a «Classificazione». «Mappatura completata» solo la
 * prima volta: «Classifica {n} passi» su un'unità già completa dice quanti passi ha classificato.
 */
export function completionToast(outcome: CompletionOutcome | null | undefined): { text: string; open: boolean } {
  const T = CLASSIFICATION_TEXT.after;
  if (!outcome) return { text: T.failed, open: false };
  switch (outcome.classification) {
    case "fatta":
      return { text: outcome.firstCompletion ? completedClassifiedText(outcome.classified) : classifiedText(outcome.classified), open: true };
    case "parziale":
      return { text: partialText(outcome.classified, outcome.classified + outcome.remaining), open: false };
    case "non_riuscita":
      return { text: T.failed, open: false };
    case "niente_da_fare":
      return { text: outcome.firstCompletion ? T.completed : classifiedText(outcome.classified), open: true };
  }
}

/** La scheda della classificazione, nell'indirizzo (P5). */
export const CLASSIFICATION_HASH = "classificazione";

/** Apre la scheda «Classificazione»: la testata della board segue l'indirizzo (`hashchange`). */
export function openClassificationTab(win: (Pick<Window, "dispatchEvent"> & { location: { hash: string } }) | null = typeof window === "undefined" ? null : window): void {
  if (!win) return;
  if (win.location.hash === `#${CLASSIFICATION_HASH}`) win.dispatchEvent(new Event("hashchange"));
  else win.location.hash = CLASSIFICATION_HASH;
}

/** L'indirizzo del completamento di un'unità. */
export const completeUrl = (workspaceId: string, departmentId: string) => `/api/workspaces/${workspaceId}/mapping/${departmentId}/complete`;

// ─── «In corso», uno per board ───────────────────────────────────────

interface CompletionState {
  working: boolean;
  listeners: Set<() => void>;
}
const states = new WeakMap<object, CompletionState>();

function stateOf(client: object): CompletionState {
  let state = states.get(client);
  if (!state) {
    state = { working: false, listeners: new Set() };
    states.set(client, state);
  }
  return state;
}

/** Lo stato «in corso» della board, per `useSyncExternalStore`. */
export function completionStore(client: object) {
  const state = stateOf(client);
  return {
    subscribe(listener: () => void) {
      state.listeners.add(listener);
      return () => {
        state.listeners.delete(listener);
      };
    },
    working: () => state.working,
  };
}

function setWorking(client: object, working: boolean) {
  const state = stateOf(client);
  if (state.working === working) return;
  state.working = working;
  for (const listener of [...state.listeners]) listener();
}

export interface CompletionDeps {
  workspaceId: string;
  departmentId: string;
  client: Pick<BoardClient, "saveNow" | "replace" | "notify" | "pull">;
  fetch: typeof fetch;
  openClassification(): void;
}

/**
 * Completa (o classifica quello che resta) e dice com'è andata. Se un completamento della stessa board è già in corso
 * non fa niente.
 */
export async function runCompletion(deps: CompletionDeps): Promise<void> {
  const { client } = deps;
  if (stateOf(client).working) return;
  setWorking(client, true);
  try {
    // I passi a schermo prima di tutto: il server classifica quelli che ha.
    await client.saveNow();
    let response: Response;
    try {
      response = await deps.fetch(completeUrl(deps.workspaceId, deps.departmentId), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    } catch {
      client.notify(CLASSIFICATION_TEXT.after.failed);
      return;
    }
    if (response.status === 503) {
      client.notify(BOARD_TEXT.storeMissing);
      return;
    }
    if (response.status === 409) {
      // Senza passi sul server (eliminati da altri, o mai salvati): niente si completa; la board mostra quello che c'è.
      client.notify(BOARD_TEXT.toast.noSteps);
      void client.pull();
      return;
    }
    const body = response.ok ? ((await response.json().catch(() => null)) as { outcome?: CompletionOutcome; board?: MappingBoard } | null) : null;
    if (body?.board) client.replace(body.board);
    const toast = completionToast(body?.outcome);
    client.notify(toast.text, toast.open ? { label: CLASSIFICATION_TEXT.after.open, run: () => deps.openClassification() } : undefined);
  } finally {
    setWorking(client, false);
  }
}
