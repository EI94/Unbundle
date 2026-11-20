import { LEARNING_TEXT } from "@/lib/learning/text";
import { clockLabel } from "./results-format";

/**
 * L'ora dell'ultima lettura dei Risultati, con il puntino che dice che la pagina si aggiorna da sola.
 *
 * (Rilascio 10, ondata 7a, FO-24) L'aggiornamento è sempre acceso (`LiveRefresh` della pagina, ogni 10 secondi, solo con
 * la rete e la scheda in vista): l'interruttore «Aggiornamento automatico» e «Aggiorna ora» se ne vanno.
 */
export function ResultsUpdatedAt({ refreshedAt }: { refreshedAt: number }) {
  return <p className="inline-flex items-center gap-2 text-sm text-muted-foreground" aria-live="off" data-testid="results-updated-at">
    <span aria-hidden className="size-2 animate-pulse rounded-full bg-uc-verde motion-reduce:animate-none" />
    <span>{LEARNING_TEXT.results.updatedAt} <span className="tabular-nums text-foreground">{clockLabel(refreshedAt)}</span></span>
  </p>;
}
