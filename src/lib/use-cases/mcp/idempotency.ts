/**
 * Idempotenza delle scritture del MCP del team (docs/use-case/DESIGN.md §9.4; tabella
 * `use_case_mcp_requests` della 0020), con la stessa logica del connettore WP1
 * (`src/lib/portfolio/idempotency.ts`).
 *
 * Una riga per (workspace, principal, chiave). La presa in carico è un `INSERT … ON CONFLICT
 * DO NOTHING` seguito da una rilettura (`src/lib/db/queries/team-mcp-requests.ts`); questa
 * funzione pura decide che cosa fare quando la chiave esiste già:
 *  - hash diverso → `idempotency_conflict` (l'hash copre anche lo strumento);
 *  - completata con lo stesso hash → la stessa risposta, con `duplicate: true`;
 *  - `failed`, oppure in corso da oltre 2 minuti (`updated_at`) → ripresa: un UPDATE atomico
 *    alza `attempt`; `create_use_cases` riusa gli id di `reserved_ids`, `update_use_case`
 *    riparte dai passi già salvati in `result`;
 *  - in corso da poco → `idempotency_in_progress` con `retryAfterSeconds`.
 *
 * Esito di una richiesta presa in carico:
 *  - riuscita → `completed`, con un `result` di soli id, codici e versioni (mai testi);
 *  - errore certo senza effetti (`releasesKey`: dati non validi, non trovato, permesso,
 *    versione superata, passaggio non ammesso, area spenta) → la riga si cancella: la chiave
 *    torna libera e la stessa chiave si può riusare dopo aver corretto la richiesta, come
 *    dicono le istruzioni del server;
 *  - errore incerto (`riprova`, `internal_error`) o con una parte già scritta → `failed`: una
 *    nuova chiamata con la stessa chiave e lo stesso contenuto riprende.
 *
 * Modulo puro, senza import: gira con `node --test`.
 */

/** Oltre questa età (secondi da `updated_at`) una richiesta `pending` si considera abbandonata. */
export const TEAM_REQUEST_STALE_AFTER_SECONDS = 120;
/** Attesa suggerita al massimo: una scrittura normale si chiude in 1-2 secondi. */
export const TEAM_REQUEST_RETRY_AFTER_MAX_SECONDS = 5;

export type TeamRequestStatus = "pending" | "completed" | "failed";

export interface ExistingTeamRequest {
  status: string;
  requestHash: string;
  /** Secondi dall'ultimo `updated_at`, sull'orologio del database. */
  ageSeconds: number;
}

export type TeamRequestDecision =
  | { kind: "duplicate" }
  | { kind: "conflict" }
  | { kind: "in_progress"; retryAfterSeconds: number }
  | { kind: "takeover" };

export function decideExistingTeamRequest(existing: ExistingTeamRequest, requestHash: string): TeamRequestDecision {
  if (existing.requestHash !== requestHash) return { kind: "conflict" };
  if (existing.status === "completed") return { kind: "duplicate" };
  if (existing.status === "failed") return { kind: "takeover" };
  const age = Number.isFinite(existing.ageSeconds) ? Math.max(0, existing.ageSeconds) : 0;
  if (age >= TEAM_REQUEST_STALE_AFTER_SECONDS) return { kind: "takeover" };
  const untilStale = Math.ceil(TEAM_REQUEST_STALE_AFTER_SECONDS - age);
  return { kind: "in_progress", retryAfterSeconds: Math.max(1, Math.min(TEAM_REQUEST_RETRY_AFTER_MAX_SECONDS, untilStale)) };
}

/** Gli errori certi che non hanno scritto nulla: la chiave torna libera. */
const RELEASING_ERRORS: ReadonlySet<string> = new Set([
  "invalid_payload",
  "not_found",
  "permesso_mancante",
  "version_conflict",
  "transizione_non_ammessa",
  "area_spenta",
]);

/**
 * Vero se una richiesta presa in carico e fallita con questo errore va cancellata (nessun
 * effetto, la chiave torna libera); falso se va segnata `failed` (esito incerto o una parte già
 * scritta: si riprende con la stessa chiave).
 */
export function releasesKey(errorCode: string, opts: { partial: boolean }): boolean {
  return !opts.partial && RELEASING_ERRORS.has(errorCode);
}
