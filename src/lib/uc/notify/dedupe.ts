/**
 * Chiavi di deduplica della coda `uc_notifications` (PIANO §3.11, §7.1).
 *
 * Una chiave identifica «la stessa notifica»: `INSERT … ON CONFLICT (dedupe_key)
 * DO NOTHING` la scrive una volta sola. Le chiavi contengono solo id, numeri e
 * date: mai token, nomi o valori. Formato ammesso dalla colonna:
 * `^[A-Za-z0-9_.:-]{1,200}$`.
 *
 * - `richiesta:<req>:<epoca>:<data Roma>` — al massimo un invio al giorno per richiesta;
 * - `promemoria_1:<req>`, `promemoria_2:<req>`, `owner:<req>`;
 * - `chiarimento:<commento>`, `delega:<req>`;
 * - `approvazione:<review|blocker|item>:<id>:<owner|privacy>[:<giro>]`;
 * - `riepilogo:<ws>:<settimana ISO>:<c|u>-<destinatario>`;
 * - `scaduto:<item>:<data>`, `risposte:<caso>:<data>:<utente>`.
 *
 * Le notifiche della campanella per Lateral Space usano un **prefisso**
 * (`bellPrefix.*`): `enqueueForLsMembersSql` aggiunge `:<user_id>` per ogni membro.
 * Modulo puro.
 */
import { isoWeekRome, romeDate } from "./schedule.ts";
import { UUID } from "../ids.ts";

const KEY = /^[A-Za-z0-9_.:-]{1,200}$/;
/** Spazio lasciato ai prefissi della campanella per `:<uuid>`. */
export const BELL_SUFFIX_ROOM = 37;

function id(value: string, what: string): string {
  if (!UUID.test(value)) throw new Error(`Id non valido per la chiave di deduplica (${what})`);
  return value.toLowerCase();
}

function done(key: string, room = 0): string {
  if (!KEY.test(key) || key.length + room > 200) throw new Error("Chiave di deduplica non valida");
  return key;
}

function round(value: string | number | undefined): string {
  if (value === undefined) return "";
  const s = String(value);
  if (!/^[A-Za-z0-9_.-]{1,40}$/.test(s)) throw new Error("Giro di approvazione non valido");
  return `:${s}`;
}

export type Recipient = { contactId: string } | { userId: string };

function recipient(r: Recipient): string {
  return "contactId" in r ? `c-${id(r.contactId, "contatto")}` : `u-${id(r.userId, "utente")}`;
}

export const dedupeKey = {
  /** Invio della richiesta: al massimo una email al giorno per richiesta ed epoca dei link. */
  richiesta(requestId: string, shareEpoch: number, now: Date): string {
    if (!Number.isInteger(shareEpoch) || shareEpoch < 0) throw new Error("Epoca non valida");
    return done(`richiesta:${id(requestId, "richiesta")}:${shareEpoch}:${romeDate(now)}`);
  },
  promemoria(requestId: string, n: 1 | 2): string {
    if (n !== 1 && n !== 2) throw new Error("Al massimo 2 promemoria");
    return done(`promemoria_${n}:${id(requestId, "richiesta")}`);
  },
  /** Segnalazione all'Owner dopo il secondo promemoria. */
  owner(requestId: string): string {
    return done(`owner:${id(requestId, "richiesta")}`);
  },
  chiarimento(commentId: string): string {
    return done(`chiarimento:${id(commentId, "commento")}`);
  },
  /** Email al collega con il link nuovo (una per richiesta di delega). */
  delega(requestId: string): string {
    return done(`delega:${id(requestId, "richiesta")}`);
  },
  /** Conferma a chi ha delegato. */
  delegaConferma(requestId: string): string {
    return done(`delega_conferma:${id(requestId, "richiesta")}`);
  },
  /**
   * Link di approvazione al firmatario designato. `round` distingue una nuova
   * proposta sulla stessa voce o sullo stesso blocco (es. il numero di proposta).
   */
  approvazione(target: "review" | "blocker" | "item", targetId: string, designation: "owner" | "privacy", roundId?: string | number): string {
    if (target !== "review" && target !== "blocker" && target !== "item") throw new Error("Oggetto di approvazione non valido");
    if (designation !== "owner" && designation !== "privacy") throw new Error("Designazione non valida");
    return done(`approvazione:${target}:${id(targetId, target)}:${designation}${round(roundId)}`);
  },
  /** Riepilogo settimanale: uno per workspace, settimana ISO (Roma) e destinatario. */
  riepilogo(workspaceId: string, now: Date, to: Recipient): string {
    return done(`riepilogo:${id(workspaceId, "workspace")}:${isoWeekRome(now)}:${recipient(to)}`);
  },
  /** Dato scaduto (freschezza): uno al giorno per voce. */
  scaduto(itemId: string, now: Date): string {
    return done(`scaduto:${id(itemId, "voce")}:${romeDate(now)}`);
  },
  /** Campanella «risposte ricevute», raggruppata per caso, giorno e utente. */
  risposte(caseId: string, now: Date, userId: string): string {
    return done(`risposte:${id(caseId, "caso")}:${romeDate(now)}:${id(userId, "utente")}`);
  },
} as const;

/** Prefissi per `enqueueForLsMembersSql` (che aggiunge `:<user_id>`). */
export const bellPrefix = {
  bloccoSciolto(blockerId: string): string {
    return done(`blocco_sciolto:${id(blockerId, "blocco")}`, BELL_SUFFIX_ROOM);
  },
  gatePronto(caseId: string, catalogRevision: number): string {
    if (!Number.isInteger(catalogRevision) || catalogRevision < 0) throw new Error("Revisione non valida");
    return done(`gate_pronto:${id(caseId, "caso")}:${catalogRevision}`, BELL_SUFFIX_ROOM);
  },
  gateApprovato(reviewId: string): string {
    return done(`gate_approvato:${id(reviewId, "revisione")}`, BELL_SUFFIX_ROOM);
  },
  datoScaduto(itemId: string, now: Date): string {
    return done(`dato_scaduto:${id(itemId, "voce")}:${romeDate(now)}`, BELL_SUFFIX_ROOM);
  },
  lsLeadDaIndicare(caseId: string, now: Date): string {
    return done(`ls_lead_da_indicare:${id(caseId, "caso")}:${romeDate(now)}`, BELL_SUFFIX_ROOM);
  },
  /** Segnalazione senza Owner designato: la campanella LS la riceve al posto dell'email. */
  ownerDaIndicare(requestId: string): string {
    return done(`owner_da_indicare:${id(requestId, "richiesta")}`, BELL_SUFFIX_ROOM);
  },
  delegaDaApprovare(requestId: string): string {
    return done(`delega_ls:${id(requestId, "richiesta")}`, BELL_SUFFIX_ROOM);
  },
  riepilogo(workspaceId: string, now: Date): string {
    return done(`riepilogo_ls:${id(workspaceId, "workspace")}:${isoWeekRome(now)}`, BELL_SUFFIX_ROOM);
  },
} as const;
