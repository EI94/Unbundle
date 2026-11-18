import type { ReactNode } from "react";

/**
 * (Ondata 0) Le liste lunghe dell'AI Readiness (use case proposti, persone invitate, insight, export): le prime
 * `visible` righe in vista e le altre dietro «Mostra tutti (N)», senza tagliarne nessuna. Prima la pagina si fermava
 * alle prime 8 (o 12) senza dirlo, e dal nono use case non si poteva portarlo nel Portfolio. Si apre con un tocco,
 * senza JavaScript: va bene anche in un componente server.
 */
export function ShowAll<T>({ items, visible, children }: { items: readonly T[]; visible: number; children: (item: T) => ReactNode }) {
  const shown = items.slice(0, visible);
  const rest = items.slice(visible);
  return (
    <>
      {shown.map((item) => children(item))}
      {rest.length > 0 ? (
        <details className="group space-y-3">
          <summary className="flex min-h-11 cursor-pointer list-none items-center text-sm font-medium text-primary underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Mostra tutti ({items.length})</span>
            <span className="hidden group-open:inline">Mostra meno</span>
          </summary>
          {rest.map((item) => children(item))}
        </details>
      ) : null}
    </>
  );
}
