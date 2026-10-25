/**
 * Decisioni su uno use case (docs/use-case/DESIGN.md §3.6, §3.7; D3, D8, D10).
 *
 * `applyDecision(card, decision, ctx)` dice se una decisione si può prendere e cosa
 * cambia; `applyWhen` fa lo stesso per «Quando»; `checkStartRealization` controlla
 * «Avvia la realizzazione», che non cambia colonne (crea il dossier, §6.5). Il servizio le
 * usa per ogni canale (pagina, REST, MCP del team): le regole valgono uguali ovunque.
 *
 * - **I due passaggi nuovi vivono solo qui**: `draft → proposed` («Rimanda») e
 *   `rejected → proposed` («Riapri»). La mappa di `src/lib/use-case-lifecycle.ts` non
 *   cambia: la usano la vecchia scheda e la PATCH `status`, anche nei workspace spenti.
 * - **Le regole sul dossier stanno qui**, non solo nel pulsante: «Non avviare» e «Archivia»
 *   con un dossier attivo, «Segna come realizzato» solo con il dossier «In uso» o «Misura
 *   del valore», «Riapri» mai verso «Da decidere» con un dossier collegato (un «Non avviato»
 *   con il dossier resta chiuso; un archiviato torna dov'era). Se la lettura del dossier è
 *   fallita, le decisioni che ne dipendono rispondono `riprova` (§9.1 passo 2); le altre
 *   proseguono.
 * - **La fase arriva dal servizio**: `card.phase` è `phaseOfUseCase` (H1c) sulla stessa riga.
 *   Questo modulo non ha regole di fase sue.
 * - **Chi**: `ctx.actor.isReviewer` lo calcola `abilitiesForUseCase` (permissions.ts) a ogni
 *   chiamata. Decidono tutti i revisori, anche del cliente (D3); «Segna come in
 *   realizzazione» e «Avvia la realizzazione» solo Lateral Space.
 * - Non esiste «Cancella».
 * - **Ogni decisione chiude la risposta in attesa** (D17): toglie `intake.rispostaInAttesa`
 *   (`answers.ts`), così una scheda rimandata o riaperta non dice più «Risposta ricevuta».
 * - **La nota pubblica nella stessa scrittura**: «Approva», «Rimanda», «Doppione di…» e
 *   «Archivia» accettano `publicNote` (facoltativa; vuota la toglie), come «Serve info» e «Non
 *   avviare». La pagina la manda dopo una risposta a «Serve info»: una sola scrittura, così la
 *   nota non resta salvata senza la decisione.
 *
 * Il risultato non contiene mai testi oltre alla nota pubblica da salvare: `fields` sono i
 * nomi dei campi per la Storia (§10.3).
 *
 * Modulo puro: solo import relativi `.ts`.
 */
import type { CaseStatus } from "../uc/vocab.ts";
import { ANSWER_PENDING_INTAKE_KEY } from "./answers.ts";
import { CODE_ERROR, normalizeUseCaseCode, validatePublicNote } from "./inputs.ts";
import { DUPLICATE_ARCHIVE_REASON, kindOf, type EventField } from "./labels.ts";
import { isIsoDate, resolveWhen, romeToday } from "./quarter.ts";
import {
  ARCHIVE_REASONS,
  type Decision,
  type DecisionType,
  type IsoDate,
  type LifecycleStatus,
  type Phase,
  type QuarterCode,
  type ReviewStatus,
  type ServiceError,
} from "./types.ts";
import { hasTeamValuation, type KpiScoreMap } from "./valuation.ts";

/** Stato del dossier collegato (`uc_cases.status`). */
export type DossierStatus = CaseStatus;

/** Con il dossier in questi stati si può «Segna come realizzato»: «In uso» e «Misura del valore». */
export const DOSSIER_IN_USE_STATUSES: readonly DossierStatus[] = ["in_esercizio", "misura_roi"];

/** Le colonne di `use_cases` che le decisioni leggono e scrivono. */
export interface DecisionColumns {
  status: LifecycleStatus;
  portfolioReviewStatus: ReviewStatus;
  targetQuarter: string | null;
  reviewBy: string | null;
  reviewedBy: string | null;
  publicNote: string | null;
  intake: Record<string, unknown> | null;
}

/** Lo use case come lo legge il servizio, prima della decisione. */
export interface DecisionCard extends DecisionColumns {
  id: string;
  code: string | null;
  /** `phaseOfUseCase(...)` sulla stessa riga, con lo stato del dossier. */
  phase: Phase;
  portfolioKind: string | null;
  /** Stato del dossier collegato; `null` senza dossier o con la sezione Casi d'uso spenta. */
  dossierStatus: DossierStatus | null;
  /** Valutazione del team, per «Riapri» (`scored` se c'è, altrimenti `in_review`). */
  customScores?: KpiScoreMap | null;
  valueEurYear?: number | null;
  costEurOnce?: number | null;
  costBand?: number | null;
  /** «Benefici e costi» (`value_model`): un modello valido è una valutazione del team. */
  valueModel?: unknown;
}

export interface DecisionContext {
  /** Predefinito: adesso. «Oggi» e il trimestre si calcolano a Roma. */
  now?: Date;
  actor: {
    /** Chi decide; serve a «Serve info» (`reviewed_by`). */
    userId: string | null;
    /** Ha un ruolo da revisore, riletto a ogni chiamata (`abilitiesForUseCase`). */
    isReviewer: boolean;
    isLateralSpace: boolean;
  };
  /** Sezione Casi d'uso accesa per il workspace (`isUcEnabled`, `isUcWorkspaceEnabled`, tabelle presenti). */
  ucSectionEnabled: boolean;
  /** La lettura del dossier è fallita (`use-case-dossiers.ts`: `motivo: "errore"`). */
  dossierReadFailed?: boolean;
  /** «Doppione di…»: lo use case con quel codice nello stesso workspace, letto dal servizio; `null` se non c'è. */
  duplicateTarget?: { id: string; code: string } | null;
}

/**
 * Cosa cambia in `intake`: chiavi da togliere, poi chiavi da scrivere. In SQL:
 * `intake = (coalesce(intake, '{}'::jsonb) - remove::text[]) || set::jsonb`.
 */
export interface IntakeChange {
  set: Record<string, unknown>;
  remove: string[];
}

/** Le colonne da scrivere (nomi di `schema.ts`). Una chiave assente non cambia. */
export interface DecisionPatch {
  status?: LifecycleStatus;
  portfolioReviewStatus?: ReviewStatus;
  targetQuarter?: QuarterCode | null;
  reviewBy?: IsoDate | null;
  reviewedBy?: string | null;
  publicNote?: string | null;
  intake?: IntakeChange;
}

export type DecisionError = Extract<ServiceError, "permesso_mancante" | "transizione_non_ammessa" | "dati_non_validi" | "riprova">;

export type DecisionResult =
  | {
      ok: true;
      patch: DecisionPatch;
      /** Azione della riga di Storia: `decisione`, oppure `quando` per `applyWhen`. */
      action: "decisione" | "quando";
      /** Nomi dei campi che cambiano davvero (per `quando`, vuoto vuol dire nessun cambiamento). */
      fields: EventField[];
    }
  | { ok: false; error: DecisionError; message: string; fieldErrors?: Record<string, string> };

export const DECISION_MESSAGES = {
  notReviewer: "Solo chi valuta gli use case può decidere.",
  onlyLateralSpace: "Solo Lateral Space può farlo.",
  notAPerson: "Serve una persona del team.",
  wrongPhase: "In questa fase non si può.",
  /** §9.1 passo 2. */
  dossierUnreadable: "Non riesco a leggere lo stato del dossier. Riprova tra poco.",
  /** §3.7, testo esatto. */
  archiveActiveDossier: "Per archiviarlo, chiudi prima il dossier.",
  rejectActiveDossier: "Per non avviarlo, chiudi prima il dossier.",
  realizedNeedsDossierInUse: "Si segna come realizzato quando il dossier è «In uso» o «Misura del valore».",
  reopenWithDossier: "Ha già un dossier: non può tornare in «Da decidere».",
  dossiersOn: "Con i dossier accesi per questo workspace si usa «Avvia la realizzazione».",
  dossiersOff: "I dossier sono spenti per questo workspace: si usa «Segna come in realizzazione».",
  whenInvalid: "Scegli quando: questo trimestre, il prossimo o più avanti.",
  reviewByInvalid: "Scegli una data.",
  reviewByNotFuture: "Scegli una data dopo oggi.",
  reasonInvalid: "Scegli un motivo.",
  duplicateNotFound: "Nessuno use case con questo codice in questo workspace.",
  duplicateItself: "Scegli un altro use case: non può essere doppione di sé stesso.",
} as const;

type Failure = Extract<DecisionResult, { ok: false }>;

function fail(error: DecisionError, message: string, field?: string): Failure {
  return field ? { ok: false, error, message, fieldErrors: { [field]: message } } : { ok: false, error, message };
}

const wrongPhase = () => fail("transizione_non_ammessa", DECISION_MESSAGES.wrongPhase);

function isHidden(card: DecisionColumns): boolean {
  return card.intake?.hiddenFromSearch === true;
}

/** Un dossier collegato che non è chiuso. */
function hasActiveDossier(card: DecisionCard): boolean {
  return card.dossierStatus !== null && card.dossierStatus !== "chiuso";
}

/** Le decisioni che guardano lo stato del dossier (§9.1 passo 2). */
function dependsOnDossier(card: DecisionCard, type: DecisionType): boolean {
  switch (type) {
    case "non_avviare":
    case "doppione":
    case "segna_realizzato":
    case "riapri":
      return true;
    case "archivia":
      return card.phase === "approvato" || card.phase === "in_realizzazione";
    default:
      return false;
  }
}

/** Applica un cambiamento a `intake` (per i test e per calcolare la fase dopo). */
export function applyIntakeChange(intake: Record<string, unknown> | null, change: IntakeChange): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(intake ?? {}) };
  for (const key of change.remove) delete next[key];
  return Object.assign(next, change.set);
}

/** Le colonne dopo la decisione. */
export function applyDecisionPatch<T extends DecisionColumns>(card: T, patch: DecisionPatch): T {
  const next: T = { ...card };
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.portfolioReviewStatus !== undefined) next.portfolioReviewStatus = patch.portfolioReviewStatus;
  if (patch.targetQuarter !== undefined) next.targetQuarter = patch.targetQuarter;
  if (patch.reviewBy !== undefined) next.reviewBy = patch.reviewBy;
  if (patch.reviewedBy !== undefined) next.reviewedBy = patch.reviewedBy;
  if (patch.publicNote !== undefined) next.publicNote = patch.publicNote;
  if (patch.intake) next.intake = applyIntakeChange(card.intake, patch.intake);
  return next;
}

/** I campi della Storia che la patch cambia davvero. Lo stato non è un campo: è la decisione stessa. */
function changedFields(card: DecisionColumns, patch: DecisionPatch): EventField[] {
  const fields: EventField[] = [];
  if (patch.targetQuarter !== undefined && patch.targetQuarter !== card.targetQuarter) fields.push("quando");
  if (patch.reviewBy !== undefined && patch.reviewBy !== card.reviewBy) fields.push("revisione");
  if (patch.publicNote !== undefined && patch.publicNote !== card.publicNote) fields.push("nota_pubblica");
  const hidden = patch.intake?.set.hiddenFromSearch;
  if (hidden !== undefined && hidden !== isHidden(card)) fields.push("visibilita");
  return fields;
}

function success(card: DecisionColumns, patch: DecisionPatch, action: "decisione" | "quando" = "decisione"): DecisionResult {
  return { ok: true, patch, action, fields: changedFields(card, patch) };
}

/**
 * La nota pubblica facoltativa di «Approva», «Rimanda», «Doppione di…» e «Archivia»: assente non
 * cambia; vuota la toglie; altrimenti la si scrive con la decisione.
 */
function withOptionalNote(card: DecisionColumns, patch: DecisionPatch, raw: unknown): DecisionResult {
  if (raw === undefined) return success(card, patch);
  const note = validatePublicNote(raw, { required: false });
  if (!note.ok) return fail("dati_non_validi", note.message, "publicNote");
  return success(card, { ...patch, publicNote: note.value });
}

/**
 * Una decisione chiude la risposta a «Serve info» in attesa (D17): via `intake.rispostaInAttesa`,
 * se c'è. Non è un campo della Storia: la riga dice già la decisione.
 */
function settleAnswer(card: DecisionColumns, result: DecisionResult): DecisionResult {
  if (!result.ok || !card.intake || !Object.hasOwn(card.intake, ANSWER_PENDING_INTAKE_KEY)) return result;
  const intake = result.patch.intake ?? { set: {}, remove: [] };
  return { ...result, patch: { ...result.patch, intake: { set: intake.set, remove: [...intake.remove, ANSWER_PENDING_INTAKE_KEY] } } };
}

/**
 * Una decisione di §3.7 sulla scheda. Ordine dei controlli: chi decide, lettura del dossier,
 * fase, dati della decisione. Ogni decisione presa chiude la risposta in attesa (`settleAnswer`).
 */
export function applyDecision(card: DecisionCard, decision: Decision, ctx: DecisionContext): DecisionResult {
  return settleAnswer(card, decideRules(card, decision, ctx));
}

function decideRules(card: DecisionCard, decision: Decision, ctx: DecisionContext): DecisionResult {
  if (!ctx.actor.isReviewer) return fail("permesso_mancante", DECISION_MESSAGES.notReviewer);
  if (decision.type === "segna_in_realizzazione" && !ctx.actor.isLateralSpace) {
    return fail("permesso_mancante", DECISION_MESSAGES.onlyLateralSpace);
  }
  if (ctx.dossierReadFailed && dependsOnDossier(card, decision.type)) {
    return fail("riprova", DECISION_MESSAGES.dossierUnreadable);
  }
  const now = ctx.now ?? new Date();

  switch (decision.type) {
    // Approva · Da valutare → status accepted, target_quarter dalla scelta, review_by NULL.
    case "approva": {
      if (card.phase !== "da_valutare") return wrongPhase();
      const when = resolveWhen(decision.quando, now);
      if (!when.ok) return fail("dati_non_validi", DECISION_MESSAGES.whenInvalid, "quando");
      const patch: DecisionPatch = { status: "accepted", targetQuarter: when.quarter, reviewBy: null };
      // Casella «Mostralo ai colleghi» per una scheda nascosta alla ricerca (§8.6).
      if (decision.showToColleagues === true && isHidden(card)) patch.intake = { set: { hiddenFromSearch: false }, remove: [] };
      return withOptionalNote(card, patch, decision.publicNote);
    }

    // Rimanda · Da valutare → status proposed (anche da draft), review_by = data futura.
    case "rimanda": {
      if (card.phase !== "da_valutare") return wrongPhase();
      if (!isIsoDate(decision.reviewBy)) return fail("dati_non_validi", DECISION_MESSAGES.reviewByInvalid, "reviewBy");
      if (decision.reviewBy <= romeToday(now)) return fail("dati_non_validi", DECISION_MESSAGES.reviewByNotFuture, "reviewBy");
      return withOptionalNote(card, { status: "proposed", reviewBy: decision.reviewBy }, decision.publicNote);
    }

    // Serve info · Da valutare → needs_inputs, reviewed_by = chi decide, review_by NULL, nota pubblica.
    case "serve_info": {
      if (card.phase !== "da_valutare") return wrongPhase();
      const note = validatePublicNote(decision.publicNote, { required: true });
      if (!note.ok) return fail("dati_non_validi", note.message, "publicNote");
      if (!ctx.actor.userId) return fail("permesso_mancante", DECISION_MESSAGES.notAPerson);
      return success(card, {
        portfolioReviewStatus: "needs_inputs",
        reviewedBy: ctx.actor.userId,
        reviewBy: null,
        publicNote: note.value,
      });
    }

    // Non avviare · Da valutare, Approvato, In realizzazione senza dossier o con dossier chiuso
    // → status rejected, target_quarter NULL, review_by NULL, nota pubblica (non obbligatoria in modo legacy).
    case "non_avviare": {
      if (card.phase !== "da_valutare" && card.phase !== "approvato" && card.phase !== "in_realizzazione") return wrongPhase();
      if (hasActiveDossier(card)) return fail("transizione_non_ammessa", DECISION_MESSAGES.rejectActiveDossier);
      const note = validatePublicNote(decision.publicNote, { required: decision.legacy !== true });
      if (!note.ok) return fail("dati_non_validi", note.message, "publicNote");
      const patch: DecisionPatch = { status: "rejected", targetQuarter: null, reviewBy: null };
      if (note.value !== null) patch.publicNote = note.value;
      return success(card, patch);
    }

    // Doppione di… · Da valutare, Approvato → archived, archiveReason duplicato, duplicateOfCode.
    case "doppione": {
      if ((card.phase !== "da_valutare" && card.phase !== "approvato") || card.dossierStatus !== null) return wrongPhase();
      const code = normalizeUseCaseCode(decision.ofCode);
      if (!code) return fail("dati_non_validi", CODE_ERROR, "ofCode");
      const target = ctx.duplicateTarget;
      if (!target || normalizeUseCaseCode(target.code) !== code) {
        return fail("dati_non_validi", DECISION_MESSAGES.duplicateNotFound, "ofCode");
      }
      if (target.id === card.id || normalizeUseCaseCode(card.code) === code) {
        return fail("dati_non_validi", DECISION_MESSAGES.duplicateItself, "ofCode");
      }
      return withOptionalNote(
        card,
        { portfolioReviewStatus: "archived", intake: { set: { archiveReason: DUPLICATE_ARCHIVE_REASON, duplicateOfCode: code }, remove: [] } },
        decision.publicNote,
      );
    }

    // Archivia · ogni fase tranne Chiuso; in In realizzazione solo senza dossier o con dossier chiuso
    // → archived, archiveReason, target_quarter NULL, review_by NULL.
    case "archivia": {
      if (card.phase === "chiuso") return wrongPhase();
      if ((card.phase === "in_realizzazione" || card.phase === "approvato") && hasActiveDossier(card)) {
        return fail("transizione_non_ammessa", DECISION_MESSAGES.archiveActiveDossier);
      }
      if (!(ARCHIVE_REASONS as readonly string[]).includes(decision.reason)) {
        return fail("dati_non_validi", DECISION_MESSAGES.reasonInvalid, "reason");
      }
      return withOptionalNote(
        card,
        { portfolioReviewStatus: "archived", targetQuarter: null, reviewBy: null, intake: { set: { archiveReason: decision.reason }, remove: [] } },
        decision.publicNote,
      );
    }

    // Riapri · Chiuso → da rejected status proposed; portfolio_review_status scored con valori del
    // team, altrimenti in_review (così «Serve info» non torna con la nota vecchia); da archived si
    // tolgono archiveReason e duplicateOfCode; target_quarter e review_by NULL.
    // Da archived `status` resta com'era: gli unici passaggi nuovi sono draft → proposed e
    // rejected → proposed, e «Approvato → Da decidere» non esiste (§15 punto 10). Una scheda
    // archiviata da Da valutare torna in «Da decidere»; una archiviata da Approvato, In
    // realizzazione o Realizzato torna lì («Non si cancella niente: si può riaprire», §14.3).
    // Con un dossier collegato la fase la dà il collegamento (§3.5: AVVIATA_COME_CASO viene prima
    // di VALUTATA e IN_VALUTAZIONE): una scheda che tornerebbe draft o proposed resterebbe «In
    // realizzazione» con nessuna decisione possibile. Quindi no.
    case "riapri": {
      if (card.phase !== "chiuso") return wrongPhase();
      const nextStatus: LifecycleStatus = card.status === "rejected" ? "proposed" : card.status;
      if (card.dossierStatus !== null && (nextStatus === "draft" || nextStatus === "proposed")) {
        return fail("transizione_non_ammessa", DECISION_MESSAGES.reopenWithDossier);
      }
      const patch: DecisionPatch = {
        portfolioReviewStatus: hasTeamValuation(card) ? "scored" : "in_review",
        targetQuarter: null,
        reviewBy: null,
      };
      if (nextStatus !== card.status) patch.status = nextStatus;
      if (card.portfolioReviewStatus === "archived") patch.intake = { set: {}, remove: ["archiveReason", "duplicateOfCode"] };
      return success(card, patch);
    }

    // Segna come diffusa · Approvato, tipo «Da diffondere» → status implemented.
    case "segna_diffusa": {
      if (card.phase !== "approvato" || kindOf(card.portfolioKind) !== "da_diffondere") return wrongPhase();
      return success(card, { status: "implemented" });
    }

    // Segna come realizzato · In realizzazione → status implemented; con un dossier solo se è
    // «In uso» o «Misura del valore»; senza dossier sempre.
    case "segna_realizzato": {
      if (card.phase !== "in_realizzazione") return wrongPhase();
      if (card.dossierStatus !== null && !DOSSIER_IN_USE_STATUSES.includes(card.dossierStatus)) {
        return fail("transizione_non_ammessa", DECISION_MESSAGES.realizedNeedsDossierInUse);
      }
      return success(card, { status: "implemented" });
    }

    // Segna come in realizzazione · Approvato, «Da costruire», sezione Casi d'uso spenta, solo
    // Lateral Space → status in_progress.
    case "segna_in_realizzazione": {
      if (card.phase !== "approvato" || kindOf(card.portfolioKind) !== "da_costruire" || card.dossierStatus !== null) {
        return wrongPhase();
      }
      if (ctx.ucSectionEnabled) return fail("transizione_non_ammessa", DECISION_MESSAGES.dossiersOn);
      return success(card, { status: "in_progress" });
    }
  }
}

/** «Quando» · Approvato → `target_quarter` dalla scelta o dal trimestre esplicito (`setWhen`). */
export function applyWhen(card: DecisionCard, when: unknown, ctx: DecisionContext): DecisionResult {
  if (!ctx.actor.isReviewer) return fail("permesso_mancante", DECISION_MESSAGES.notReviewer);
  if (card.phase !== "approvato") return wrongPhase();
  const resolved = resolveWhen(when, ctx.now ?? new Date());
  if (!resolved.ok) return fail("dati_non_validi", DECISION_MESSAGES.whenInvalid, "quando");
  return success(card, { targetQuarter: resolved.quarter }, "quando");
}

/**
 * «Avvia la realizzazione» · Approvato, «Da costruire», nessun dossier, sezione Casi d'uso
 * accesa, solo Lateral Space. Non cambia colonne: `status` resta `accepted` e la fase la dà
 * il collegamento al dossier (§6.5).
 */
export function checkStartRealization(card: DecisionCard, ctx: DecisionContext): { ok: true } | Failure {
  if (!ctx.actor.isReviewer || !ctx.actor.isLateralSpace) return fail("permesso_mancante", DECISION_MESSAGES.onlyLateralSpace);
  if (ctx.dossierReadFailed) return fail("riprova", DECISION_MESSAGES.dossierUnreadable);
  if (card.phase !== "approvato" || card.status !== "accepted" || kindOf(card.portfolioKind) !== "da_costruire" || card.dossierStatus !== null) {
    return wrongPhase();
  }
  if (!ctx.ucSectionEnabled) return fail("transizione_non_ammessa", DECISION_MESSAGES.dossiersOff);
  return { ok: true };
}
