/**
 * «Referente in un tocco» (rilascio 5, SPEC §3.1, §3.2, §3.4): il referente di uno use case e il suo
 * stato, calcolati dalle richieste, mai salvati.
 *
 * - **R\***: l'ultima richiesta al referente dello use case (quelle con la riga in
 *   `use_case_referent_checks`), per data di creazione e poi id, qualunque sia il suo stato. Il
 *   referente è il suo contatto quando R\* non è revocata; altrimenti lo use case non ha referente
 *   (mai un ritorno a una persona di prima).
 * - **R**: l'ultima richiesta non revocata (di qualunque tipo) al contatto del referente su questo use
 *   case: dice attesa, promemoria, «Nessuna risposta». R\* dice la conferma e la stima.
 * - Sette stati, il primo che vale: «Manca il referente», (rilascio 6) «Il referente ha chiesto
 *   qualcosa», «Risposte da verificare», «Nessuna risposta», (rilascio 6) «Chiarimento in attesa», «In
 *   attesa del referente», «Il referente ha risposto». Uno use case che non è «Da costruire» in
 *   valutazione o approvato non ha stato.
 *
 * La scelta delle richieste è in TypeScript (le letture a lista non hanno ORDER BY, né per data né per
 * persona: art. 15.4); il contatto non esce mai dal server. La fase non si scrive mai: resta una
 * decisione di una persona. Modulo puro.
 */
import type { ReferentRequestStatus } from "../../db/use-case-hub-referents-ddl.ts";
import type { ReferentCheckConfirm, ReferentCheckEstimate, ReferentCheckOutcome } from "../../db/use-case-hub-referent-check-ddl.ts";
import type { SemaforoColor } from "../../uc/vocab.ts";
import type { Phase } from "../types.ts";
import { NO_THREAD, addThreadFacts, type ThreadFacts } from "./thread.ts";

/**
 * Gli stati, nell'ordine della vita di una richiesta (l'ordine del menu del filtro). (Rilascio 6) Dopo le
 * risposte, il chiarimento chiesto dal team e la domanda del referente.
 */
export const REFERENT_STATES = ["manca", "in_attesa", "nessuna_risposta", "da_verificare", "chiarimento", "ha_chiesto", "fatto"] as const;
export type ReferentStateKey = (typeof REFERENT_STATES)[number];

/** La parola di ogni stato: sulla scheda, nelle righe, nel filtro, nell'intestazione. */
export const REFERENT_STATE_TEXT: Readonly<Record<ReferentStateKey, string>> = Object.freeze({
  manca: "Manca il referente",
  in_attesa: "In attesa del referente",
  nessuna_risposta: "Nessuna risposta",
  da_verificare: "Risposte da verificare",
  chiarimento: "Chiarimento in attesa",
  ha_chiesto: "Il referente ha chiesto qualcosa",
  fatto: "Il referente ha risposto",
});

/** Il valore nell'indirizzo (`?referente=`): mai un nome o un'email. */
export const REFERENT_STATE_PARAM: Readonly<Record<ReferentStateKey, string>> = Object.freeze({
  manca: "manca",
  in_attesa: "in-attesa",
  nessuna_risposta: "nessuna-risposta",
  da_verificare: "da-verificare",
  chiarimento: "chiarimento",
  ha_chiesto: "ha-chiesto",
  fatto: "ha-risposto",
});

/** Il tono dell'icona (`SEMAFORO_TONE`). */
export const REFERENT_STATE_TONE: Readonly<Record<ReferentStateKey, SemaforoColor>> = Object.freeze({
  manca: "grigio",
  in_attesa: "blu",
  nessuna_risposta: "rosso",
  da_verificare: "giallo",
  chiarimento: "blu",
  ha_chiesto: "giallo",
  fatto: "verde",
});

/** Lo stato dal valore dell'indirizzo; qualunque altro valore (un nome, un'email) è null. */
export function referentStateFromParam(value: string | null | undefined): ReferentStateKey | null {
  if (typeof value !== "string") return null;
  const clean = value.trim().toLowerCase();
  return REFERENT_STATES.find((key) => REFERENT_STATE_PARAM[key] === clean) ?? null;
}

/** Uno use case ha un referente da scegliere: «Da costruire», in valutazione o approvato (D22). */
export function eligibleForReferent(i: { portfolioKind: string | null | undefined; phase: Phase }): boolean {
  return i.portfolioKind !== "best_practice" && (i.phase === "da_valutare" || i.phase === "approvato");
}

/** La conferma e la stima di una richiesta al referente, come le legge lo stato (§3.2). */
export interface ReferentCheckFact {
  submittedAt: Date | null;
  confirm: ReferentCheckConfirm | null;
  correctionDoneAt: Date | null;
  estimate: ReferentCheckEstimate | null;
  estimateOutcome: ReferentCheckOutcome | null;
  /** null: il referente ha risposto senza una stima del team (i due numeri). */
  teamComponentKey: string | null;
  /** (Rilascio 5.1) La conferma ha le risposte per beneficio; assente o falso: la stima del tempo del rilascio 5. */
  benefits?: boolean;
  /** (Rilascio 5.1) Una risposta per beneficio diversa da quella del team aspetta il team (`benefitDiffers`, `BENEFIT_DIFFERS_SQL`). */
  benefitReview?: boolean;
  /** (Rilascio 5.1) Un «Non so» su una cifra del team aspetta il team (`benefitUnknown`, `BENEFIT_UNKNOWN_SQL`). */
  benefitUnknown?: boolean;
}

/** Una richiesta dello use case, con il conteggio delle cose ancora aperte per il referente. */
export interface ReferentRequestFact {
  id: string;
  /** Solo sul server: serve a trovare R, mai mostrato né contato per persona. */
  contactId: string;
  /** Lo stato salvato. */
  status: ReferentRequestStatus;
  createdAt: Date;
  expiresAt: Date;
  reminderCount: number;
  /** Domande aperte più 1 finché la conferma non è inviata (`openItemsCountSql`). */
  openTask: number;
  /** Presente solo per le richieste al referente. */
  check: ReferentCheckFact | null;
  /** (Rilascio 6) Il filo della richiesta: chiarimenti, dubbi, novità che aspettano qualcuno. Assente: nessun filo. */
  thread?: ThreadFacts | null;
}

/** La più recente per data di creazione, poi per id: mai per persona. */
export function latestRequest<T extends Pick<ReferentRequestFact, "id" | "createdAt">>(requests: readonly T[]): T | null {
  let best: T | null = null;
  for (const r of requests) {
    if (!best || r.createdAt.getTime() > best.createdAt.getTime() || (r.createdAt.getTime() === best.createdAt.getTime() && r.id.toLowerCase() > best.id.toLowerCase())) best = r;
  }
  return best;
}

/** R\* e R di uno use case (§3.1): R\* l'ultima richiesta al referente, R l'ultima non revocata al suo contatto. */
export function referentRequestsOf<T extends ReferentRequestFact>(requests: readonly T[]): { latestReferent: T | null; referent: string | null; current: T | null } {
  const latestReferent = latestRequest(requests.filter((r) => r.check !== null));
  if (!latestReferent || latestReferent.status === "revocata") return { latestReferent, referent: null, current: null };
  const contact = latestReferent.contactId.toLowerCase();
  const current = latestRequest(requests.filter((r) => r.contactId.toLowerCase() === contact && r.status !== "revocata"));
  return { latestReferent, referent: contact, current };
}

/**
 * Che cosa aspetta il team dalla risposta del referente: una correzione, una stima diversa, (rilascio 5.1)
 * una stima che il referente non sa («Non so» su una cifra), (rilascio 6) una sua risposta o aggiunta nel
 * filo su una voce o su «Generale», niente.
 */
export type ReferentReview = "correzione" | "stima" | "non_sa" | "risposta" | null;

/**
 * `needsReview` (§3.2): la conferma è inviata e il referente chiede di correggere lo use case (finché il
 * team non preme «Fatto»), oppure ha una stima diversa senza esito, oppure ha dato i suoi numeri senza
 * una stima del team e lo use case non ne ha ancora una (si chiude da sola appena il team la aggiunge).
 * (Rilascio 5.1) Con le risposte per beneficio: una voce che aspetta il team («È di meno», «È di più»,
 * «No», i due numeri; prima di tutto, poi «Non so» su una cifra), finché il team non decide su quella
 * voce; una conferma conta una volta sola.
 */
export function reviewOf(check: ReferentCheckFact | null, hasTeamEstimateNow: boolean): ReferentReview {
  if (!check || !check.submittedAt) return null;
  if (check.confirm === "correggi" && !check.correctionDoneAt) return "correzione";
  if (check.benefits) return check.benefitReview ? "stima" : check.benefitUnknown ? "non_sa" : null;
  if (check.estimateOutcome) return null;
  if (check.estimate === "meno" || check.estimate === "piu") return "stima";
  if (check.teamComponentKey === null && !hasTeamEstimateNow) return "stima";
  return null;
}

export interface ReferentStateInput {
  eligible: boolean;
  /** Tutte le richieste dello use case (di ogni persona e tipo). */
  requests: readonly ReferentRequestFact[];
  /** Un requisito del cliente dello use case è «Da verificare». */
  clientRequirementToVerify: boolean;
  /** Lo use case ha adesso una stima del team in ore (§3.3). */
  hasTeamEstimateNow: boolean;
  now: Date;
}

export interface ReferentStateResult {
  state: ReferentStateKey;
  review: ReferentReview;
}

/**
 * (Rilascio 6) Il filo del referente: le richieste non revocate della sua persona su questo use case, sommate
 * (di solito una sola, quella attiva). Senza fili: niente.
 */
export function referentThreadOf(requests: readonly ReferentRequestFact[], contact: string | null): ThreadFacts {
  if (!contact) return NO_THREAD;
  let out: ThreadFacts = NO_THREAD;
  for (const r of requests) {
    if (r.contactId.toLowerCase() !== contact || r.status === "revocata") continue;
    out = addThreadFacts(out, r.thread);
  }
  return out;
}

/** Lo stato del referente di uno use case (§3.4); null quando lo use case non ha un referente da scegliere. */
export function referentStateOf(i: ReferentStateInput): ReferentStateResult | null {
  if (!i.eligible) return null;
  const { latestReferent, referent, current } = referentRequestsOf(i.requests);
  if (!latestReferent || latestReferent.status === "revocata" || !current) return { state: "manca", review: null };
  const thread = referentThreadOf(i.requests, referent);
  const review = reviewOf(latestReferent.check, i.hasTeamEstimateNow) ?? (thread.news > 0 ? "risposta" : null);
  // (Rilascio 6) Il referente ha chiesto qualcosa al team: prima di tutto, tocca a noi rispondere.
  if (thread.doubts > 0) return { state: "ha_chiesto", review };
  if (i.clientRequirementToVerify || review) return { state: "da_verificare", review };
  const now = i.now.getTime();
  const live = current.status === "inviata" && current.expiresAt.getTime() > now;
  const expired = current.status === "scaduta" || (current.status === "inviata" && current.expiresAt.getTime() <= now);
  if (expired || (live && current.reminderCount >= 2 && current.openTask > 0)) return { state: "nessuna_risposta", review: null };
  // (Rilascio 6) Il team ha chiesto un chiarimento e il referente non ha ancora risposto.
  if (live && thread.clarifications > 0) return { state: "chiarimento", review: null };
  if (live && current.openTask > 0) return { state: "in_attesa", review: null };
  return { state: "fatto", review: null };
}
