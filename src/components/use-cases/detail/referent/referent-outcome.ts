/**
 * Che cosa fare dopo un'azione di «Chiedi al referente» (SPEC §5.1): il toast, la rilettura della
 * pagina, la finestra da chiudere o l'errore da mostrare dentro. Modulo puro, lo provano i test.
 */
import type { ReferentActionResult } from "../../../../lib/use-cases/referent/contract.ts";
import { REFERENT_ERROR_MESSAGES } from "../../../../lib/use-cases/referent/labels.ts";

/** I codici dopo i quali i dati a schermo non sono più quelli veri: si rilegge la pagina. */
export const REFERENT_STALE_CODES: ReadonlySet<string> = new Set([
  "versione_superata",
  "domande_cambiate",
  "non_trovato",
  "richiesta_chiusa",
  "referente_non_valido",
  "persona_non_disponibile",
  "file_non_trovato",
  "risposta_non_trovata",
  "domanda_non_disponibile",
  "funzione_spenta",
]);

export interface ReferentOutcome {
  ok: boolean;
  /** Il toast da mostrare, oppure null (l'errore va nella finestra). */
  toast: { kind: "success" | "error"; text: string } | null;
  /** Rileggere la pagina. */
  refresh: boolean;
  /** Chiudere la finestra (anche dopo un errore che ha cambiato i dati a schermo). */
  close: boolean;
  /** Per la finestra aperta: l'errore da mostrare dentro, se resta aperta. */
  error: string | null;
}

/** Che cosa fare dopo un'azione: puro, lo provano i test. */
export function referentOutcome(result: ReferentActionResult<unknown>, opts: { inDialog: boolean }): ReferentOutcome {
  if (result.ok) return { ok: true, toast: result.message ? { kind: "success", text: result.message } : null, refresh: false, close: true, error: null };
  const stale = REFERENT_STALE_CODES.has(result.code);
  const message = result.message || REFERENT_ERROR_MESSAGES.riprova;
  if (stale) return { ok: false, toast: { kind: "error", text: message }, refresh: true, close: true, error: null };
  if (opts.inDialog) return { ok: false, toast: null, refresh: false, close: false, error: message };
  return { ok: false, toast: { kind: "error", text: message }, refresh: false, close: false, error: null };
}

