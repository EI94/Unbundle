/**
 * Tipi condivisi della sezione «Casi d'uso» (PIANO §3.1).
 *
 * File chiuso dopo WP0: ogni pacchetto dichiara i propri tipi nei propri
 * moduli (es. `gates.ts` esporta `GateComputation`). Un cambio qui è un commit
 * seriale di WP0.
 */
import type {
  AnswerKind,
  CaseRole,
  GateKey,
  ItemKind,
  ItemStatus,
  Perimeter,
  Phase,
  Priority,
  PrivacyClass,
  ResponseType,
  SourceKind,
} from "./vocab.ts";

export type { SemaforoColor } from "./vocab.ts";

/** Valore JSON serializzabile (colonne jsonb). */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** Chi compie un'azione. I permessi si ricalcolano lato server a ogni comando. */
export type Actor =
  | { type: "utente"; userId: string; roles: CaseRole[] }
  | { type: "referente"; contactId: string; requestId: string; roleKey: string | null }
  /** Link di approvazione: parte solo per email al firmatario designato. */
  | { type: "owner_link"; contactId: string; requestId: string; designation: "owner" | "privacy" }
  | { type: "sistema"; job: "seed" | "uc-reminders" | "uc-freshness" | "blocchi" | "creazione" };

/** Utente con account. `isLateralSpace` si ricalcola a ogni comando. */
export interface UserContext {
  userId: string;
  emailVerified: boolean;
  emailDomain: string | null;
  isLateralSpace: boolean;
}

/** Una firma (NA, deroga, ripiego, gate, blocco). Si registrano solo codici e impronte. */
export interface Approval {
  ruolo: CaseRole;
  /** Firma da account. */
  user_id?: string | null;
  /** Firma dal link di approvazione (contatto designato). */
  contact_id?: string | null;
  at: string;
  text_hash?: string | null;
  metodo: "account" | "link";
  ip_hash?: string | null;
  email_domain?: string | null;
}

/** Deroga (`uc_items.waiver`): vale fino a `scadenza` (YYYY-MM-DD). */
export interface Waiver {
  motivo: string;
  piano: string;
  scadenza: string;
  approvazioni: Approval[];
}

/** Ripiego approvato (`uc_items.fallback`). Nell'MVP vale solo per G1. */
export interface Fallback {
  descrizione: string;
  valido_per: GateKey[];
  da_sostituire_entro: string | null;
  approvazioni: Approval[];
}

/** Parte mancante dichiarata non applicabile (`uc_items.partial_na`). */
export interface PartialNa {
  parte_mancante: string;
  motivo: string;
  approvazioni: Approval[];
  /** Impostato solo con entrambe le firme. */
  approved_at: string | null;
}

/** Metadati della risposta corrente: mai il valore. */
export interface AnswerMeta {
  id: string;
  version: number;
  kind: AnswerKind;
  sourceKind: SourceKind;
  responderContactId: string | null;
  responderUserId: string | null;
  requestId: string | null;
  validFrom: string | null;
  createdAt: Date;
  textHash: string | null;
  /** `value_normalized` presente, oppure tipo testuale. */
  typed: boolean;
}

/** Fotografia di una voce per le funzioni pure di transizione e verifica. */
export interface ItemSnapshot {
  id: string;
  key: string;
  kind: ItemKind;
  status: ItemStatus;
  priority: Priority | null;
  perimeter: Perimeter | null;
  servesFor: Phase[];
  inGateScope: boolean;
  privacyClass: PrivacyClass;
  responseType: ResponseType | null;
  ownerRoleKey: string | null;
  assigneeContactId: string | null;
  requiresValidityPeriod: boolean;
  freshnessDays: number | null;
  staleAt: Date | null;
  currentAnswer: AnswerMeta | null;
  /** Chi ha risposto in una qualsiasi versione. */
  answerResponderUserIds: string[];
  /** Utenti che hanno copiato un link della richiesta da cui viene la risposta corrente. */
  currentAnswerTokenIssuerUserIds: string[];
  confirmedByContactId: string | null;
  confirmedByRoleKey: string | null;
  /** `acting_role_key` della richiesta della risposta corrente. */
  responderRoleKey: string | null;
  na: {
    reason: string | null;
    proposedAt: Date | null;
    lsUserId: string | null;
    clientUserId: string | null;
    clientContactId: string | null;
    approvedAt: Date | null;
  };
  waiver: Waiver | null;
  fallback: Fallback | null;
  partialNa: PartialNa | null;
  activeBlockerKeys: string[];
  openClarification: boolean;
  hasActiveRequestItem: boolean;
  lastAutoCheckError: boolean;
}

/** Esito di un comando o di un controllo. `message` è in italiano semplice. */
export type Result<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T = never>(code: string, message: string): Result<T> {
  return { ok: false, code, message };
}
