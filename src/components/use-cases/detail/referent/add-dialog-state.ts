/**
 * «Aggiungi domande» a una richiesta viva (SPEC §5.2): quali domande si possono aggiungere e i
 * controlli prima dell'invio. Modulo puro, lo prova `add-dialog-state.test.ts`.
 */
import type { ReferentRequestView, UseCaseReferentPanel } from "../../../../lib/use-cases/referent/contract.ts";
import { REFERENT_ERROR_MESSAGES } from "../../../../lib/use-cases/referent/labels.ts";

const lower = (id: string) => id.toLowerCase();

/** Le domande che si possono chiedere sulla scheda e che la richiesta non ha già, nell'ordine della scheda. */
export function addableNeedIds(panel: Pick<UseCaseReferentPanel, "askableNeedIds">, request: Pick<ReferentRequestView, "needIds">): string[] {
  const asked = new Set(request.needIds.map(lower));
  return panel.askableNeedIds.map(lower).filter((id) => !asked.has(id));
}

/** Quante domande ci stanno ancora nella richiesta (al massimo 20 per richiesta). */
export function addRoom(panel: Pick<UseCaseReferentPanel, "limits">, request: Pick<ReferentRequestView, "needIds">): number {
  return Math.max(0, panel.limits.questionsPerRequest - request.needIds.length);
}

/** La scelta di partenza: tutte le domande aggiungibili, fino a riempire la richiesta. */
export function initialAddSelection(panel: Pick<UseCaseReferentPanel, "askableNeedIds" | "limits">, request: Pick<ReferentRequestView, "needIds">): string[] {
  return addableNeedIds(panel, request).slice(0, addRoom(panel, request));
}

/** Il messaggio che blocca l'invio, oppure null. */
export function addSelectionError(selected: readonly string[], room: number): string | null {
  if (selected.length === 0) return REFERENT_ERROR_MESSAGES.nessuna_domanda;
  if (selected.length > room) return REFERENT_ERROR_MESSAGES.troppe_domande;
  return null;
}

/** Il contenuto dell'action, nell'ordine della scheda. */
export function addPayload(panel: Pick<UseCaseReferentPanel, "askableNeedIds">, selected: readonly string[]): { needIds: string[] } {
  const chosen = new Set(selected.map(lower));
  return { needIds: panel.askableNeedIds.filter((id) => chosen.has(lower(id))) };
}
