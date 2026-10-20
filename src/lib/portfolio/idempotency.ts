/**
 * Idempotenza degli invii al portafoglio (REST, server MCP stdio, connettore).
 *
 * La presa in carico è `INSERT … ON CONFLICT DO NOTHING RETURNING` sulla chiave
 * (workspace_id, principal_key, idempotency_key), seguita da una rilettura. Questa
 * funzione pura decide che cosa fare quando la chiave esiste già:
 *  - hash diverso → conflitto (`idempotency_conflict`);
 *  - stesso hash e riga già collegata a una segnalazione (`use_case_id`) → stessa
 *    segnalazione, `duplicate: true`, qualunque sia lo stato: vale anche per le
 *    righe `failed` o `pending` lasciate dal codice precedente alla 0019;
 *  - completata ma la segnalazione non c'è più (cancellata da Lateral Space) →
 *    conflitto: non si ricrea in silenzio ciò che è stato tolto;
 *  - riga scritta dal codice precedente alla 0019 (`reserved_use_case_id` NULL) e
 *    mai collegata → `idempotency_in_progress`, come rispondeva quel codice: il suo
 *    tentativo potrebbe aver già creato una segnalazione che la riga non conosce,
 *    quindi non si riprende mai;
 *  - `failed`, oppure in corso da oltre 2 minuti (per `updated_at`) → ripresa con
 *    un UPDATE atomico e nuovo tentativo. La ripresa riusa l'id prenotato della
 *    segnalazione (`reserved_use_case_id`): se il tentativo precedente l'aveva già
 *    creata, la ritrova invece di crearne una seconda;
 *  - in corso da poco → `idempotency_in_progress` con `retryAfterSeconds`.
 * Modulo puro: lo usano le query e i test con Node.
 */

/** Oltre questa età (secondi da `updated_at`) un invio `pending` si considera abbandonato. */
export const IDEMPOTENCY_STALE_AFTER_SECONDS = 120;
/** Attesa suggerita al massimo: un invio normale si chiude in 1-2 secondi. */
export const IDEMPOTENCY_RETRY_AFTER_MAX_SECONDS = 5;

export type ExistingSubmissionState = {
  status: string;
  requestHash: string;
  useCaseId: string | null;
  /** Id prenotato della segnalazione; NULL per le righe del codice precedente alla 0019. */
  reservedUseCaseId: string | null;
  /** Secondi trascorsi dall'ultimo `updated_at`, misurati sull'orologio del database. */
  ageSeconds: number;
};

export type IdempotencyDecision =
  | { kind: "duplicate" }
  | { kind: "conflict" }
  | { kind: "in_progress"; retryAfterSeconds: number }
  | { kind: "takeover" };

export function decideExistingSubmission(existing: ExistingSubmissionState, requestHash: string): IdempotencyDecision {
  if (existing.requestHash !== requestHash) return { kind: "conflict" };
  if (existing.useCaseId) return { kind: "duplicate" };
  if (existing.status === "completed") return { kind: "conflict" };
  if (!existing.reservedUseCaseId) {
    return { kind: "in_progress", retryAfterSeconds: IDEMPOTENCY_RETRY_AFTER_MAX_SECONDS };
  }
  if (existing.status === "failed") return { kind: "takeover" };
  const age = Number.isFinite(existing.ageSeconds) ? Math.max(0, existing.ageSeconds) : 0;
  if (age >= IDEMPOTENCY_STALE_AFTER_SECONDS) return { kind: "takeover" };
  const untilStale = Math.ceil(IDEMPOTENCY_STALE_AFTER_SECONDS - age);
  return {
    kind: "in_progress",
    retryAfterSeconds: Math.max(1, Math.min(IDEMPOTENCY_RETRY_AFTER_MAX_SECONDS, untilStale)),
  };
}

/** `token:<tokenId>` in fase 1; in fase 2 `user:<identityId>`. */
export function tokenPrincipalKey(tokenId: string) {
  return `token:${tokenId}`;
}
