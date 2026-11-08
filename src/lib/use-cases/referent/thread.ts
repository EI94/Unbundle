/**
 * (Rilascio 6) «Il filo con il referente»: le regole del filo di una richiesta, senza database.
 *
 * - **Un filo per domanda, uno per voce di «Benefici e costi», uno «Generale»** (decisione 1 del titolare,
 *   08/11/2026): ogni messaggio ha la sua ancora (`anchorKeyOf`).
 * - **Chi aspetta chi**: un «chiarimento» del team aspetta il referente finché lui non risponde; un «dubbio»
 *   del referente aspetta il team finché il team non risponde; una «risposta» o un'«aggiunta» del referente
 *   su una voce o su «Generale» è una novità per il team finché il team non preme «Fatto» (o decide su
 *   quella voce, o chiede un altro chiarimento lì). Su una domanda lo dice lo stato dell'informazione: la
 *   risposta la porta «Da verificare», «A posto» la chiude.
 * - **Di chi è il turno** (`threadTurn`): «Tocca a noi» quando qualcosa aspetta il team, altrimenti «Tocca al
 *   referente» quando qualcosa aspetta lui (un chiarimento, una domanda aperta), altrimenti nessuno.
 * - **Il referente modifica una risposta finché il team non la segna «A posto»** (decisione 3): dopo può solo
 *   aggiungere (`referentCanEdit`).
 *
 * Nessun conteggio o ordinamento per persona (art. 15.4): un filo è di una richiesta, in ordine di tempo.
 * Modulo puro: import relativi `.ts`.
 */
import type { ReferentRequestStatus } from "../../db/use-case-hub-referents-ddl.ts";
import type { ReferentThreadAnchor, ReferentThreadKind, ReferentThreadSide } from "../../db/use-case-hub-referent-thread-ddl.ts";
import { addWorkingDays, inRomeSendWindow, nextRomeSendWindowStart, romeDate, romeLocalToUtc, ROME_SEND_WINDOW } from "../../uc/calendar.ts";
import type { NeedStatus } from "../needs.ts";

/** Un messaggio del filo come lo legge il server. */
export interface ThreadMessageFact {
  id: string;
  requestId: string;
  anchor: ReferentThreadAnchor;
  needId: string | null;
  componentKey: string | null;
  side: ReferentThreadSide;
  kind: ReferentThreadKind;
  replyToId: string | null;
  body: string | null;
  createdAt: Date;
  seenAt: Date | null;
  handledAt: Date | null;
  removedAt: Date | null;
}

/** L'ancora di un messaggio come chiave: «d:<esigenza>», «b:<voce>», «g». */
export function anchorKeyOf(m: Pick<ThreadMessageFact, "anchor" | "needId" | "componentKey">): string {
  if (m.anchor === "domanda") return `d:${(m.needId ?? "").toLowerCase()}`;
  if (m.anchor === "beneficio") return `b:${m.componentKey ?? ""}`;
  return "g";
}

const live = (m: Pick<ThreadMessageFact, "handledAt" | "removedAt">) => m.handledAt === null && m.removedAt === null;

/** Un chiarimento del team che aspetta la risposta del referente. */
export function waitsForReferent(m: Pick<ThreadMessageFact, "side" | "kind" | "handledAt" | "removedAt">): boolean {
  return m.side === "team" && m.kind === "chiarimento" && live(m);
}

/** Un dubbio del referente che aspetta la risposta del team. */
export function waitsForTeam(m: Pick<ThreadMessageFact, "side" | "kind" | "handledAt" | "removedAt">): boolean {
  return m.side === "referente" && m.kind === "dubbio" && live(m);
}

/**
 * Una risposta o un'aggiunta del referente su una voce o su «Generale» che il team non ha ancora gestito
 * («Fatto»). Su una domanda no: lì la novità è l'informazione «Da verificare».
 */
export function newsForTeam(m: Pick<ThreadMessageFact, "side" | "kind" | "anchor" | "handledAt" | "removedAt">): boolean {
  return m.side === "referente" && (m.kind === "risposta" || m.kind === "aggiunta") && m.anchor !== "domanda" && live(m);
}

/** I fatti del filo di una richiesta per gli stati (`use-case-state.ts`): solo conteggi della richiesta. */
export interface ThreadFacts {
  /** Chiarimenti del team che aspettano il referente. */
  clarifications: number;
  /** Dubbi del referente che aspettano il team. */
  doubts: number;
  /** Risposte e aggiunte del referente su voci o «Generale» da guardare. */
  news: number;
}

export const NO_THREAD: ThreadFacts = Object.freeze({ clarifications: 0, doubts: 0, news: 0 });

export function threadFactsOf(messages: readonly Pick<ThreadMessageFact, "side" | "kind" | "anchor" | "handledAt" | "removedAt">[]): ThreadFacts {
  let clarifications = 0;
  let doubts = 0;
  let news = 0;
  for (const m of messages) {
    if (waitsForReferent(m)) clarifications++;
    else if (waitsForTeam(m)) doubts++;
    else if (newsForTeam(m)) news++;
  }
  return { clarifications, doubts, news };
}

/** Somma i fatti di più richieste (le richieste della stessa persona sullo stesso use case). */
export function addThreadFacts(a: ThreadFacts, b: ThreadFacts | null | undefined): ThreadFacts {
  if (!b) return a;
  return { clarifications: a.clarifications + b.clarifications, doubts: a.doubts + b.doubts, news: a.news + b.news };
}

/**
 * Di chi è il turno nel filo: «team» quando un dubbio o una novità del referente aspetta il team; altrimenti
 * «referente» quando un chiarimento o una domanda aperta aspetta lui; null quando nessuno aspetta nessuno.
 */
export function threadTurn(i: { facts: ThreadFacts; openQuestions: number; teamToVerify?: boolean }): "team" | "referente" | null {
  if (i.facts.doubts > 0 || i.facts.news > 0 || i.teamToVerify === true) return "team";
  if (i.facts.clarifications > 0 || i.openQuestions > 0) return "referente";
  return null;
}

/** Gli stati di un'informazione chiusa per il referente: dopo, la risposta non si modifica più (decisione 3). */
export const REFERENT_EDIT_LOCKED_STATUSES: readonly NeedStatus[] = Object.freeze(["validata", "non_applicabile"] as NeedStatus[]);

/** Il referente può ancora modificare la risposta inviata su questa informazione (decisione 3 del titolare). */
export function referentCanEdit(needStatus: NeedStatus, archived: boolean): boolean {
  return !archived && !REFERENT_EDIT_LOCKED_STATUSES.includes(needStatus);
}

/**
 * Da quali stati «Chiedi un chiarimento» riporta un'informazione «In attesa» (`chiesta`): la risposta del
 * referente l'aveva portata «Da verificare», «Manca il dato» o «Risposta parziale», oppure il team l'aveva
 * già segnata «A posto». Negli altri stati (già «In attesa», «Non ancora chiesta», «Bloccata», «Non si
 * applica») non cambia.
 */
export const CLARIFY_FROM_STATUSES: readonly NeedStatus[] = Object.freeze(["in_verifica", "mancante", "parziale", "validata"] as NeedStatus[]);

/**
 * Da quali stati la risposta del referente a un chiarimento, o una sua aggiunta, porta un'informazione «Da
 * verificare»: di nuovo da guardare per il team («Aggiornata»).
 */
export const REPLY_TO_VERIFY_FROM_STATUSES: readonly NeedStatus[] = Object.freeze(["chiesta", "mancante", "parziale", "validata"] as NeedStatus[]);

/** I limiti del filo. */
export const REFERENT_THREAD_RULES = Object.freeze({
  /** Una riga del team. */
  teamLineMax: 300,
  /** Un testo del referente. */
  referentTextMax: 1000,
  /** I messaggi di una richiesta, per sicurezza. */
  messagesPerRequest: 200,
});

/**
 * Quando parte l'email al referente per una novità del team (un chiarimento, una risposta a un suo dubbio),
 * oppure null: la richiesta è attiva («inviata» o «completata», non revocata, non scaduta) e la sua prima
 * email è partita; nella finestra di Roma subito, fuori alle 9 del prossimo giorno lavorativo; se oggi la
 * persona ha già un'email (della richiesta o un promemoria), alle 9 del giorno lavorativo dopo: al massimo
 * un'email al giorno. Mai dopo la scadenza del link (già rinnovato da chi chiama).
 */
export function threadEmailAt(
  r: { status: ReferentRequestStatus; revokedAt: Date | null; expiresAt: Date; sentAt: Date | null; lastEmailAt: Date | null; addressChanged?: boolean },
  now: Date,
  remindedOn: ReadonlySet<string>,
): Date | null {
  if ((r.status !== "inviata" && r.status !== "completata") || r.revokedAt !== null || r.expiresAt.getTime() <= now.getTime() || !r.sentAt) return null;
  let at = inRomeSendWindow(now) ? new Date(now.getTime()) : nextRomeSendWindowStart(now);
  const busy = (d: Date) => !r.addressChanged && ((r.lastEmailAt !== null && romeDate(r.lastEmailAt) === romeDate(d)) || remindedOn.has(romeDate(d)));
  if (busy(at)) at = romeLocalToUtc(addWorkingDays(romeDate(at), 1), ROME_SEND_WINDOW.startHour);
  return at.getTime() < r.expiresAt.getTime() ? at : null;
}
