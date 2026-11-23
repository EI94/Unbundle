import type { ReactNode } from "react";
import { READINESS_TEXT } from "@/lib/ai-readiness/dashboard-text";
import { cn } from "@/lib/utils";

/**
 * (Ondata 0) Le liste lunghe dell'AI Readiness (use case proposti, persone invitate, insight, export): le prime
 * `visible` righe in vista e le altre dietro «Mostra tutti (N)», senza tagliarne nessuna. Prima la pagina si fermava
 * alle prime 8 (o 12) senza dirlo, e dal nono use case non si poteva portarlo nel Portfolio. Si apre con un tocco,
 * senza JavaScript: va bene anche in un componente server. (Ondata 7b) Tre righe in vista, come vuole la regola 4 di
 * §1; dentro una lista con le righe divise, `inList` divide anche quelle della piega e allinea «Mostra tutti».
 */
export function ShowAll<T>({ items, visible, inList = false, children }: { items: readonly T[]; visible: number; inList?: boolean; children: (item: T) => ReactNode }) {
  const shown = items.slice(0, visible);
  const rest = items.slice(visible);
  return (
    <>
      {shown.map((item) => children(item))}
      {rest.length > 0 ? (
        <details className={cn("group", inList ? "divide-y" : "space-y-3")}>
          <summary
            className={cn(
              "flex min-h-11 cursor-pointer list-none items-center text-sm font-medium text-foreground underline decoration-foreground/40 underline-offset-4 hover:decoration-foreground [&::-webkit-details-marker]:hidden",
              inList && "px-4",
            )}
          >
            <span className="group-open:hidden">{READINESS_TEXT.collection.showAll(items.length)}</span>
            <span className="hidden group-open:inline">{READINESS_TEXT.collection.showLess}</span>
          </summary>
          {rest.map((item) => children(item))}
        </details>
      ) : null}
    </>
  );
}
