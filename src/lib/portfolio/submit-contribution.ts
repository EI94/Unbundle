/**
 * Servizio condiviso di invio al portafoglio «Raccolta & ranking».
 *
 * Lo usano la rotta REST `/api/mcp/portfolio/submissions` (e quindi il server MCP
 * stdio) e, dal WP5, il connettore MCP organizzativo. Passi:
 *  1. validazione del payload (zod v1 di external-submission.ts, sostituibile);
 *  2. presa in carico idempotente per (workspace, principal_key, idempotencyKey);
 *  3. creazione dello use case con l'id prenotato sulla presa in carico, in modo
 *     idempotente; il codice del workspace (es. TJ-0012) si assegna prima di
 *     rispondere;
 *  4. chiusura recintata della presa in carico (solo il tentativo che la possiede);
 *  5. auto-ranking AI e notifiche affidati allo scheduler (`after()` nelle rotte),
 *     così la risposta non aspetta il modello. Se il ranking fallisce la
 *     segnalazione resta com'è (proposed / needs_inputs: «Ricevuta»).
 * Le dipendenze e lo scheduler si iniettano: il servizio funziona anche fuori da
 * una richiesta (script, test). I log contengono solo nomi e codici degli errori.
 */
import type { NewUseCase, UseCase, Workspace } from "@/lib/db/schema";
import {
  buildUseCaseDataFromExternalContribution,
  hashExternalContributionPayload,
  validateExternalContributionPayload,
  type ExternalContributionPayload,
  type ExternalContributionValidationResult,
} from "./external-submission.ts";
import { logSafeError } from "../log/safe-error.ts";
import { IDEMPOTENCY_RETRY_AFTER_MAX_SECONDS } from "./idempotency.ts";
import { isUntouchedUseCase } from "./review-state.ts";

export type PortfolioPrincipal = {
  workspace: Pick<Workspace, "id" | "esgEnabled">;
  /** `token:<tokenId>` (fase 1) oppure `user:<identityId>` (fase 2). */
  principalKey: string;
  /** Token di workspace che invia; null per le identità di fase 2. */
  integrationTokenId: string | null;
};

type SubmissionRow = { id: string; useCaseId: string | null };

/**
 * Riga presa in carico: il tentativo che la possiede e l'id prenotato della
 * segnalazione (sempre presente sulle righe che il codice nuovo prende in carico).
 */
type ClaimedSubmission = SubmissionRow & { attempt: number; reservedUseCaseId: string | null };

export type ClaimOutcome =
  | { status: "claimed"; submission: ClaimedSubmission; takeover: boolean }
  | { status: "duplicate"; submission: SubmissionRow }
  | { status: "conflict"; submission: SubmissionRow }
  | { status: "in_progress"; retryAfterSeconds: number };

export type SubmissionState = { status: string; attempt: number; useCaseId: string | null };

export interface SubmitContributionDeps {
  claim: (params: {
    workspaceId: string;
    principalKey: string;
    integrationTokenId: string | null;
    idempotencyKey: string;
    requestHash: string;
  }) => Promise<ClaimOutcome>;
  /**
   * Crea la segnalazione con l'id prenotato, in modo idempotente (se esiste già la
   * restituisce con `created: false` e lo stato attuale), e le assegna il codice del
   * workspace una sola volta.
   */
  createUseCase: (data: NewUseCase & { id: string }) => Promise<{ useCase: UseCase; created: boolean }>;
  /** Chiusura recintata: `true` solo se la riga era `pending` e di questo tentativo. */
  complete: (params: { submissionId: string; attempt: number; useCaseId: string }) => Promise<boolean>;
  /** Fallimento recintato: `true` solo se la riga era `pending` e di questo tentativo. */
  fail: (params: { submissionId: string; attempt: number; errorCode: string }) => Promise<boolean>;
  readSubmission: (submissionId: string) => Promise<SubmissionState | null>;
  getUseCaseById: (id: string) => Promise<UseCase | null>;
  /** Con `onlyIfUntouched` non valuta né sovrascrive una segnalazione già valutata. */
  autoScore: (params: {
    workspaceId: string;
    useCaseId: string;
    reviewedBy: string | null;
    noteLabel: string;
    onlyIfUntouched: boolean;
  }) => Promise<UseCase>;
  notify: (params: { useCase: UseCase; workspaceId: string; source: "claude" }) => Promise<void>;
  /** Vero se il contributo è già stato annunciato (segnale della campanella). */
  wasAnnounced: (params: { workspaceId: string; useCaseId: string }) => Promise<boolean>;
}

/**
 * Cosa fare dopo la risposta quando la ripresa ha ritrovato una segnalazione già
 * creata da un tentativo precedente: ranking solo se è ancora intatta, notifica
 * solo se intatta e mai annunciata. Una segnalazione nuova riceve entrambi.
 */
export function followUpAfterSubmit(params: {
  created: boolean;
  untouched: boolean;
  announced: boolean;
}): { rank: boolean; notify: boolean } {
  if (params.created) return { rank: true, notify: true };
  return { rank: params.untouched, notify: params.untouched && !params.announced };
}

/** Esegue un lavoro dopo la risposta (in una rotta Next: `after`). */
export type AfterResponseScheduler = (task: () => Promise<void>) => void;

/** Fuori da una richiesta: il lavoro parte subito, senza bloccare chi chiama. */
export const runInBackground: AfterResponseScheduler = (task) => {
  void task().catch(() => {});
};

export type SubmitPortfolioContributionOptions = {
  deps: SubmitContributionDeps;
  schedule?: AfterResponseScheduler;
  validate?: (input: unknown, opts: { esgEnabled: boolean }) => ExternalContributionValidationResult;
  buildUseCaseData?: (params: {
    payload: ExternalContributionPayload;
    workspaceId: string;
    esgEnabled: boolean;
  }) => NewUseCase;
  log?: Pick<Console, "error">;
};

export type SubmitPortfolioContributionResult =
  | { ok: true; duplicate: boolean; useCase: UseCase }
  | {
      ok: false;
      error: "invalid_payload" | "missing_esg" | "missing_guardrails";
      fieldErrors: Record<string, string>;
    }
  | { ok: false; error: "idempotency_conflict" }
  | { ok: false; error: "idempotency_in_progress"; retryAfterSeconds: number }
  | { ok: false; error: "submit_failed" };

const LOG_SCOPE = "portfolio/submit";

export async function submitPortfolioContribution(
  principal: PortfolioPrincipal,
  payload: unknown,
  opts: SubmitPortfolioContributionOptions
): Promise<SubmitPortfolioContributionResult> {
  const { deps } = opts;
  const schedule = opts.schedule ?? runInBackground;
  const validate = opts.validate ?? validateExternalContributionPayload;
  const buildUseCaseData = opts.buildUseCaseData ?? buildUseCaseDataFromExternalContribution;
  const log = opts.log ?? console;
  const workspaceId = principal.workspace.id;
  const esgEnabled = principal.workspace.esgEnabled === true;

  const validation = validate(payload, { esgEnabled });
  if (!validation.ok) {
    return { ok: false, error: validation.code, fieldErrors: validation.fieldErrors };
  }
  const data = validation.data;

  let claim: ClaimOutcome;
  try {
    claim = await deps.claim({
      workspaceId,
      principalKey: principal.principalKey,
      integrationTokenId: principal.integrationTokenId,
      idempotencyKey: data.idempotencyKey,
      requestHash: hashExternalContributionPayload(data),
    });
  } catch (error) {
    logSafeError(LOG_SCOPE, "claim_failed", error, { workspaceId }, log);
    return { ok: false, error: "submit_failed" };
  }

  if (claim.status === "conflict") return { ok: false, error: "idempotency_conflict" };
  if (claim.status === "in_progress") {
    return { ok: false, error: "idempotency_in_progress", retryAfterSeconds: claim.retryAfterSeconds };
  }
  if (claim.status === "duplicate") {
    try {
      const useCase = claim.submission.useCaseId ? await deps.getUseCaseById(claim.submission.useCaseId) : null;
      if (useCase && useCase.workspaceId === workspaceId) return { ok: true, duplicate: true, useCase };
    } catch (error) {
      logSafeError(LOG_SCOPE, "duplicate_read_failed", error, { workspaceId }, log);
      return { ok: false, error: "submit_failed" };
    }
    return { ok: false, error: "idempotency_conflict" };
  }

  // Una segnalazione sola per chiave, con qualunque guasto singolo (eccezione,
  // risposta persa, processo interrotto) fra due istruzioni:
  //  - la segnalazione si crea con l'id prenotato sulla riga, in modo idempotente:
  //    ogni ripresa della stessa riga ritrova la stessa segnalazione;
  //  - chiusura e fallimento valgono solo per il tentativo che possiede la riga;
  //  - se l'esito della chiusura è incerto si rilegge la riga prima di decidere.
  // Un tentativo che chiude senza riuscirci viene segnato `failed`: la ripresa,
  // immediata, riusa l'id prenotato e quindi la segnalazione già creata.
  const { id: submissionId, attempt, reservedUseCaseId } = claim.submission;
  if (!reservedUseCaseId) {
    // Non succede: la presa in carico scrive sempre l'id e non riprende le righe senza.
    return { ok: false, error: "idempotency_in_progress", retryAfterSeconds: IDEMPOTENCY_RETRY_AFTER_MAX_SECONDS };
  }
  const markFailed = async () => {
    try {
      await deps.fail({ submissionId, attempt, errorCode: "submit_failed" });
    } catch (failError) {
      logSafeError(LOG_SCOPE, "mark_failed_failed", failError, { workspaceId }, log);
    }
  };

  let useCase: UseCase;
  let created: boolean;
  try {
    ({ useCase, created } = await deps.createUseCase({
      ...buildUseCaseData({ payload: data, workspaceId, esgEnabled }),
      id: reservedUseCaseId,
    }));
  } catch (error) {
    logSafeError(LOG_SCOPE, "submit_failed", error, { workspaceId }, log);
    await markFailed();
    return { ok: false, error: "submit_failed" };
  }

  let completed = false;
  try {
    completed = await deps.complete({ submissionId, attempt, useCaseId: useCase.id });
  } catch (error) {
    logSafeError(LOG_SCOPE, "complete_uncertain", error, { workspaceId }, log);
  }

  if (!completed) {
    let state: SubmissionState | null = null;
    try {
      state = await deps.readSubmission(submissionId);
    } catch (error) {
      logSafeError(LOG_SCOPE, "read_back_failed", error, { workspaceId }, log);
    }
    if (!state) {
      // Database irraggiungibile: la riga resta com'è; un nuovo invio con la stessa
      // chiave la ritrova (duplicato o ripresa con lo stesso id prenotato).
      return { ok: false, error: "submit_failed" };
    }
    if (state.status === "completed" && state.useCaseId) {
      if (state.attempt === attempt && state.useCaseId === useCase.id) {
        completed = true; // la chiusura era riuscita, si era persa solo la risposta
      } else {
        // Un altro tentativo ha chiuso la riga: ranking e notifiche sono suoi.
        let winner: UseCase | null = state.useCaseId === useCase.id ? useCase : null;
        if (!winner) {
          try {
            winner = await deps.getUseCaseById(state.useCaseId);
          } catch (error) {
            logSafeError(LOG_SCOPE, "duplicate_read_failed", error, { workspaceId }, log);
            return { ok: false, error: "submit_failed" };
          }
        }
        if (winner && winner.workspaceId === workspaceId) return { ok: true, duplicate: true, useCase: winner };
        return { ok: false, error: "idempotency_conflict" };
      }
    } else if (state.status === "pending" && state.attempt === attempt) {
      // La chiusura non è avvenuta e la riga è ancora nostra.
      await markFailed();
      return { ok: false, error: "submit_failed" };
    } else {
      // La riga è passata a un altro tentativo che non ha ancora chiuso.
      return { ok: false, error: "idempotency_in_progress", retryAfterSeconds: 1 };
    }
  }

  // Ripresa che ha ritrovato la segnalazione: niente secondo ranking su una
  // segnalazione già valutata, niente secondo annuncio. Se non si riesce a sapere
  // se è stata annunciata, non si annuncia di nuovo.
  let announced = false;
  if (!created) {
    try {
      announced = await deps.wasAnnounced({ workspaceId, useCaseId: useCase.id });
    } catch (error) {
      logSafeError(LOG_SCOPE, "announced_read_failed", error, { useCaseId: useCase.id }, log);
      announced = true;
    }
  }
  const followUp = followUpAfterSubmit({ created, untouched: isUntouchedUseCase(useCase), announced });

  if (followUp.rank || followUp.notify) {
    schedule(async () => {
      let current = useCase;
      if (followUp.rank) {
        try {
          current = await deps.autoScore({
            workspaceId,
            useCaseId: useCase.id,
            reviewedBy: null,
            noteLabel: "Auto-ranking AI",
            onlyIfUntouched: true,
          });
        } catch (error) {
          logSafeError(LOG_SCOPE, "auto_ranking_failed", error, { useCaseId: useCase.id }, log);
        }
      }
      if (followUp.notify) {
        try {
          await deps.notify({ useCase: current, workspaceId, source: "claude" });
        } catch (error) {
          logSafeError(LOG_SCOPE, "notify_failed", error, { useCaseId: useCase.id }, log);
        }
      }
    });
  }
  return { ok: true, duplicate: false, useCase };
}
