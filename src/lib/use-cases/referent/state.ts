/**
 * Gli stati di «Chiedi al referente» (SPEC §3.3–§3.5): la richiesta, le sue domande e lo stato
 * delle esigenze di «Cosa serve» che cambiano da soli.
 *
 * - **Richiesta**: `inviata` → `completata` (ultima domanda risposta, o tutte ritirate), `scaduta`
 *   (30 giorni), `revocata` (anche da `completata`). `completata`, `scaduta` e `revocata` non
 *   tornano indietro. Leggere l'informativa non cambia lo stato: non esiste «in corso».
 * - **Domanda aperta** (calcolata, mai salvata): stato `aperta`, esigenza `chiesta`, non
 *   archiviata e ancora collegata allo use case della richiesta.
 * - **Esigenze**: gli stati di sempre, nessun insieme parallelo. `validata` e `parziale` restano
 *   una decisione di una persona, salvo «L'ho già verificata» (Parte 2).
 *
 * Modulo puro.
 */
import type { ReferentItemState, ReferentRequestStatus } from "../../db/use-case-hub-referents-ddl.ts";
import type { NeedStatus } from "../needs.ts";
import { REFERENT_PRIVACY_NOTICE } from "./labels.ts";

export type RequestEvent = "submit_last" | "all_withdrawn" | "revoke" | "expire";

/** Lo stato dopo l'evento, oppure null se l'evento non è ammesso da quello stato. */
export function nextRequestStatus(from: ReferentRequestStatus, event: RequestEvent): ReferentRequestStatus | null {
  switch (event) {
    case "submit_last":
    case "all_withdrawn":
      return from === "inviata" ? "completata" : null;
    case "revoke":
      return from === "inviata" || from === "completata" ? "revocata" : null;
    case "expire":
      return from === "inviata" ? "scaduta" : null;
  }
  return null;
}

/** Lo stato come lo vedono i revisori: una richiesta `inviata` oltre la scadenza è già `scaduta`. */
export function reviewerStatus(r: { status: ReferentRequestStatus; expiresAt: Date }, now: Date): ReferentRequestStatus {
  return r.status === "inviata" && r.expiresAt.getTime() <= now.getTime() ? "scaduta" : r.status;
}

/**
 * Eventi che cambiano lo stato di un'esigenza. `expire_open` e `revoke_replaced` (Parte 2) non
 * cambiano niente: l'esigenza resta «chiesta» e la scheda mostra «Senza risposta».
 */
export type NeedEvent =
  | "send"
  | "referent_answer"
  | "referent_dont_know"
  | "revoke_open"
  | "expire_open"
  | "revoke_replaced"
  | "reviewer_answer"
  | "reviewer_answer_validated";

/** Da quali stati parte ogni evento, e dove porta. */
export const NEED_TRANSITIONS: Readonly<Record<NeedEvent, { from: readonly NeedStatus[]; to: NeedStatus | null }>> = Object.freeze({
  send: { from: ["da_chiedere", "mancante", "parziale"], to: "chiesta" },
  referent_answer: { from: ["chiesta"], to: "in_verifica" },
  referent_dont_know: { from: ["chiesta"], to: "mancante" },
  revoke_open: { from: ["chiesta"], to: "da_chiedere" },
  expire_open: { from: [], to: null },
  revoke_replaced: { from: [], to: null },
  reviewer_answer: { from: ["da_chiedere", "chiesta", "mancante", "parziale"], to: "in_verifica" },
  reviewer_answer_validated: { from: ["da_chiedere", "chiesta", "mancante", "parziale", "in_verifica"], to: "validata" },
});

/** Lo stato nuovo dell'esigenza, oppure null se resta com'è (la risposta si salva comunque). */
export function needStatusAfter(event: NeedEvent, current: NeedStatus): NeedStatus | null {
  const rule = NEED_TRANSITIONS[event];
  if (!rule || !rule.to || !rule.from.includes(current)) return null;
  return rule.to === current ? null : rule.to;
}

/** Una domanda è aperta? Si calcola: stato salvato, stato dell'esigenza, archivio e legame. */
export function itemIsOpen(i: { state: ReferentItemState; needStatus: NeedStatus; needArchived: boolean; linked: boolean }): boolean {
  return i.state === "aperta" && i.needStatus === "chiesta" && !i.needArchived && i.linked;
}

/**
 * (Parte 3) Gli stati di un'esigenza a cui qualcuno ha già pensato: una domanda ancora «aperta» del
 * referente su un'esigenza in uno di questi stati si mostra «Non serve più: ci ha già pensato il team.».
 */
export const HANDLED_NEED_STATUSES: readonly NeedStatus[] = Object.freeze(["in_verifica", "validata"] as NeedStatus[]);

/**
 * (Parte 3) La domanda era del referente e l'ha già data qualcun altro (una risposta o un file dalla
 * scheda, o un'altra risposta arrivata): non è più aperta, il promemoria non la conta, la pagina la
 * mostra «gestita». Un'esigenza portata a mano a «Non ancora chiesta», «Manca il dato», «Risposta
 * parziale», «Non si applica» o «Bloccata» è invece ritirata e non si mostra (come nella Parte 1).
 */
export function itemHandledByTeam(i: { state: ReferentItemState; needStatus: NeedStatus; needArchived: boolean; linked: boolean }): boolean {
  return i.state === "aperta" && !i.needArchived && i.linked && HANDLED_NEED_STATUSES.includes(i.needStatus);
}

/** L'informativa è letta per la versione di adesso (una versione vecchia la fa mostrare di nuovo). */
export function privacyAccepted(r: { privacyAcceptedAt: Date | null; privacyNoticeVersion: string | null }): boolean {
  return r.privacyAcceptedAt !== null && r.privacyNoticeVersion === REFERENT_PRIVACY_NOTICE.version;
}
