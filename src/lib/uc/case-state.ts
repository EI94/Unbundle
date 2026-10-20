/**
 * Stati del caso e transizioni ammesse (PIANO §3.4, D10).
 *
 * Le transizioni si controllano solo lato server: il comando legge lo stato,
 * chiama `checkCaseTransition` e scrive con compare-and-swap. Nell'MVP esiste
 * solo il gate G1: le transizioni che richiedono G2, G3 o G4 si rifiutano con
 * «Gate non disponibile in questa versione».
 *
 * Modulo puro: import relativi `.ts`, nessun accesso a DB o ambiente.
 */
import { actorClasses } from "./permissions.ts";
import { fail, ok, type Actor, type Result, type UserContext } from "./types.ts";
import { CASE_STATUSES, type CaseStatus, type GateKey } from "./vocab.ts";

/** Gate disponibili nell'MVP. */
export const MVP_AVAILABLE_GATES: readonly GateKey[] = ["G1"];

/** Giorni minimi di stabilizzazione prima dell'esercizio. */
export const STABILIZATION_DAYS = 14;

const TERMINAL: readonly CaseStatus[] = ["chiuso"];

/** Stati con un ciclo di lavoro (tutti tranne `sospeso` e `chiuso`). */
export const WORKING_CASE_STATUSES = CASE_STATUSES.filter((s) => s !== "sospeso" && s !== "chiuso");

/** Stati dopo l'approvazione di G1 (`pronto_sviluppo` … `misura_roi`). */
export const POST_G1_STATUSES: readonly CaseStatus[] = [
  "pronto_sviluppo",
  "in_sviluppo",
  "backtest",
  "collaudo",
  "stabilizzazione",
  "in_esercizio",
  "misura_roi",
];

/**
 * Etichette degli stati del caso (DESIGN §2.6). Le fasi e il colore del
 * puntino sono in `views/labels.ts` (`CASE_STATUS_PHASE`, `CASE_STATUS_TONE`).
 */
export const CASE_STATUS_LABEL: Readonly<Record<CaseStatus, string>> = {
  bozza: "Bozza",
  raccolta: "In preparazione",
  pronto_sviluppo: "Pronto per lo sviluppo",
  in_sviluppo: "In sviluppo",
  backtest: "Prova sul passato",
  collaudo: "In collaudo",
  stabilizzazione: "In rodaggio",
  in_esercizio: "In uso",
  misura_roi: "Misura del valore",
  sospeso: "In pausa",
  chiuso: "Chiuso",
};

/** Ordine dello stepper di Avanzamento (stabilizzazione prima dell'esercizio). */
export const CASE_STEPPER_ORDER: readonly CaseStatus[] = [
  "bozza",
  "raccolta",
  "pronto_sviluppo",
  "in_sviluppo",
  "backtest",
  "collaudo",
  "stabilizzazione",
  "in_esercizio",
  "misura_roi",
  "sospeso",
  "chiuso",
];

function withSuspendAndClose(next: readonly CaseStatus[]): readonly CaseStatus[] {
  return [...next, "sospeso", "chiuso"];
}

/** Whitelist completa. Da `sospeso` si torna solo allo stato salvato prima della sospensione. */
export const CASE_TRANSITIONS: Readonly<Record<CaseStatus, readonly CaseStatus[]>> = {
  bozza: withSuspendAndClose(["raccolta"]),
  raccolta: withSuspendAndClose(["pronto_sviluppo"]),
  pronto_sviluppo: withSuspendAndClose(["in_sviluppo"]),
  in_sviluppo: withSuspendAndClose(["backtest"]),
  backtest: withSuspendAndClose(["collaudo", "in_sviluppo"]),
  collaudo: withSuspendAndClose(["stabilizzazione", "in_sviluppo"]),
  stabilizzazione: withSuspendAndClose(["in_esercizio", "in_sviluppo"]),
  in_esercizio: withSuspendAndClose(["misura_roi"]),
  misura_roi: withSuspendAndClose(["in_esercizio"]),
  sospeso: [...WORKING_CASE_STATUSES, "chiuso"],
  chiuso: [],
};

export function isAllowedCaseTransition(from: CaseStatus, to: CaseStatus): boolean {
  return CASE_TRANSITIONS[from].includes(to);
}

/** Stato «effettivo» per le regole che guardano il ciclo: per un caso sospeso, quello di prima. */
export function effectiveCaseStatus(status: CaseStatus, statusBeforeSuspension: CaseStatus | null | undefined): CaseStatus {
  return status === "sospeso" && statusBeforeSuspension ? statusBeforeSuspension : status;
}

/** Vero se G1 è già stato approvato nel ciclo del caso (anche se ora è sospeso). */
export function isCasePastG1(status: CaseStatus, statusBeforeSuspension?: CaseStatus | null): boolean {
  return POST_G1_STATUSES.includes(effectiveCaseStatus(status, statusBeforeSuspension));
}

export interface CasePatch {
  status: CaseStatus;
  statusChangedAt: Date;
  statusBeforeSuspension?: CaseStatus | null;
  suspensionReason?: string | null;
  closedReason?: string | null;
  closedAt?: Date | null;
}

/** Effetti da eseguire nello stesso batch del cambio di stato. */
export type CaseSideEffect =
  /** Catalogo congelato a vN (approvazione di G1). */
  | "congela_catalogo"
  /** Scheda `use_cases` da accepted a in_progress (CAS solo se accepted). */
  | "portafoglio_in_corso"
  /** Scheda `use_cases` da in_progress a implemented. */
  | "portafoglio_implementato"
  /** Campanella al team Lateral Space. */
  | "notifica_team"
  /** Coda notifiche ferma (`hold_reason = 'caso_sospeso'`), link in sola lettura. */
  | "ferma_invii"
  /** Coda notifiche ripresa. */
  | "riprendi_invii"
  /** Richieste vive revocate (voci `chiesta` → `da_chiedere`, riga 31). */
  | "revoca_richieste"
  /** Coda notifiche annullata. */
  | "annulla_coda"
  /** Token MCP del caso revocati. */
  | "revoca_token_mcp";

/** Chi chiede il cambio: «sistema», ls_lead, oppure la firma del cliente. */
type CaseActorClass = "sistema" | "ls_lead" | "cliente";

/**
 * Classi dell'attore per il caso. Con `user` i ruoli si ricalcolano adesso
 * (`actorClasses`): un ruolo `ls_*` vale solo per un utente Lateral Space e
 * `owner_cliente` solo per gli altri (D36).
 */
function caseActorClasses(actor: Actor, user?: UserContext | null): Set<CaseActorClass> {
  const out = new Set<CaseActorClass>();
  for (const c of actorClasses(actor, user)) {
    if (c === "sistema" || c === "ls_lead" || c === "cliente") out.add(c);
  }
  return out;
}

export interface CaseTransitionInput {
  from: CaseStatus;
  to: CaseStatus;
  actor: Actor;
  /** Utente che agisce, con «è Lateral Space» ricalcolato: i ruoli valgono solo così. */
  user?: UserContext | null;
  reason?: string | null;
  /** Gate approvati nel ciclo corrente. */
  approvedGates: ReadonlySet<GateKey>;
  /** Quando il caso è entrato nello stato attuale (`status_changed_at`). */
  enteredAt: Date | null;
  now: Date;
  /** MVP: `["G1"]`. */
  availableGates: readonly GateKey[];
  statusBeforeSuspension: CaseStatus | null;
  /**
   * Solo per misura_roi → chiuso («fermare»), anche passando da `sospeso`:
   * servono la firma di Lateral Space e quella del cliente. Il comando le
   * raccoglie con `addSignature`.
   */
  closeSignatures?: { ls: boolean; cliente: boolean };
}

const MIN_REASON = 3;

function hasReason(reason: string | null | undefined): boolean {
  return typeof reason === "string" && reason.trim().length >= MIN_REASON;
}

function cleanReason(reason: string | null | undefined): string | null {
  return hasReason(reason) ? reason!.trim().slice(0, 2000) : null;
}

const GATE_FOR: Partial<Record<`${CaseStatus}>${CaseStatus}`, GateKey>> = {
  "raccolta>pronto_sviluppo": "G1",
  "in_sviluppo>backtest": "G2",
  "collaudo>stabilizzazione": "G3",
  "misura_roi>in_esercizio": "G4",
};

/**
 * Controlla un cambio di stato del caso e restituisce cosa scrivere e quali
 * effetti eseguire nello stesso batch.
 */
export function checkCaseTransition(i: CaseTransitionInput): Result<{ patch: CasePatch; sideEffects: CaseSideEffect[] }> {
  const { from, to, now } = i;
  if (from === to) return fail("stato_invariato", "Il caso è già in questo stato.");
  if (TERMINAL.includes(from)) return fail("caso_chiuso", "Il caso è chiuso: si può solo duplicare.");
  if (!isAllowedCaseTransition(from, to)) {
    return fail("transizione_non_ammessa", "Questo cambio di stato non è ammesso.");
  }
  const actors = caseActorClasses(i.actor, i.user);
  const base: CasePatch = { status: to, statusChangedAt: now };

  // Chiusura: da ogni stato non terminale, con motivo (D10). Dopo la revisione del
  // ROI servono le due firme anche se il caso è stato sospeso prima di chiuderlo.
  if (to === "chiuso") {
    if (!hasReason(i.reason)) return fail("motivo_obbligatorio", "Scrivi il motivo della chiusura.");
    if (effectiveCaseStatus(from, i.statusBeforeSuspension) === "misura_roi") {
      if (!actors.has("ls_lead") && !actors.has("cliente")) return fail("attore_non_ammesso", "Solo il Responsabile del caso e l'Owner possono chiudere il caso.");
      if (!i.closeSignatures?.ls || !i.closeSignatures?.cliente) {
        return fail("firme_mancanti", "Per chiudere dopo la revisione del ROI servono la firma di Lateral Space e quella del cliente.");
      }
    } else if (!actors.has("ls_lead")) {
      return fail("attore_non_ammesso", "Solo il Responsabile del caso può chiudere il caso.");
    }
    return ok({
      patch: { ...base, closedReason: cleanReason(i.reason), closedAt: now, statusBeforeSuspension: null },
      sideEffects: ["revoca_richieste", "annulla_coda", "revoca_token_mcp"],
    });
  }

  // Sospensione: da ogni stato di lavoro, con motivo.
  if (to === "sospeso") {
    if (!actors.has("ls_lead")) return fail("attore_non_ammesso", "Solo il Responsabile del caso può sospendere il caso.");
    if (!hasReason(i.reason)) return fail("motivo_obbligatorio", "Scrivi il motivo della sospensione.");
    return ok({
      patch: { ...base, statusBeforeSuspension: from, suspensionReason: cleanReason(i.reason) },
      sideEffects: ["ferma_invii"],
    });
  }

  // Ripresa: solo verso lo stato di prima.
  if (from === "sospeso") {
    if (!actors.has("ls_lead")) return fail("attore_non_ammesso", "Solo il Responsabile del caso può riprendere il caso.");
    if (!i.statusBeforeSuspension) return fail("stato_precedente_assente", "Non si sa da quale stato riprendere il caso.");
    if (to !== i.statusBeforeSuspension) {
      return fail("ripresa_non_ammessa", "Un caso sospeso torna solo allo stato in cui era prima della sospensione.");
    }
    return ok({ patch: { ...base, statusBeforeSuspension: null, suspensionReason: null }, sideEffects: ["riprendi_invii"] });
  }

  // Transizioni legate a un gate.
  const gate = GATE_FOR[`${from}>${to}`];
  if (gate) {
    if (!i.availableGates.includes(gate)) return fail("gate_non_disponibile", "Gate non disponibile in questa versione.");
    if (!actors.has("sistema")) return fail("attore_non_ammesso", "Questo passaggio avviene solo con l'approvazione del gate.");
    if (!i.approvedGates.has(gate)) return fail("gate_non_approvato", `Il gate ${gate} non è ancora approvato.`);
    if (gate === "G1") return ok({ patch: base, sideEffects: ["congela_catalogo", "portafoglio_in_corso", "notifica_team"] });
    return ok({ patch: base, sideEffects: ["notifica_team"] });
  }

  switch (`${from}>${to}`) {
    case "bozza>raccolta":
      if (!actors.has("sistema")) return fail("attore_non_ammesso", "Il caso passa in raccolta da solo, al primo invio di una richiesta.");
      return ok({ patch: base, sideEffects: [] });
    case "backtest>collaudo":
      if (!actors.has("cliente")) return fail("attore_non_ammesso", "Il collaudo parte con l'approvazione del cliente.");
      return ok({ patch: base, sideEffects: [] });
    case "stabilizzazione>in_esercizio": {
      if (!actors.has("ls_lead")) return fail("attore_non_ammesso", "Solo il Responsabile del caso può portare il caso in esercizio.");
      if (!i.enteredAt || now.getTime() < i.enteredAt.getTime() + STABILIZATION_DAYS * 86_400_000) {
        return fail("stabilizzazione_in_corso", `La stabilizzazione dura almeno ${STABILIZATION_DAYS} giorni.`);
      }
      return ok({ patch: base, sideEffects: ["portafoglio_implementato"] });
    }
    case "pronto_sviluppo>in_sviluppo":
    case "backtest>in_sviluppo":
    case "collaudo>in_sviluppo":
    case "stabilizzazione>in_sviluppo":
    case "in_esercizio>misura_roi":
      if (!actors.has("ls_lead")) return fail("attore_non_ammesso", "Solo il Responsabile del caso può fare questo cambio di stato.");
      return ok({ patch: base, sideEffects: [] });
    default:
      return fail("transizione_non_ammessa", "Questo cambio di stato non è ammesso.");
  }
}

/** Stati verso cui il caso può andare adesso (per il menu «Cambia stato»), senza guardare chi chiede. */
export function nextCaseStatuses(from: CaseStatus, statusBeforeSuspension: CaseStatus | null): CaseStatus[] {
  if (from === "sospeso") return statusBeforeSuspension ? [statusBeforeSuspension, "chiuso"] : ["chiuso"];
  return [...CASE_TRANSITIONS[from]];
}
