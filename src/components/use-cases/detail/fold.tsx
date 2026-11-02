"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { keepTogether } from "@/lib/use-cases/line-breaks";
import { cn } from "@/lib/utils";
import { useLanding } from "./arrival";

export interface FoldProps {
  /** L'ancora della piega (`?capitolo=`, `#storia`): la piega la tiene, le parti dentro no. */
  id: string;
  title: string;
  /** La riga grigia accanto al titolo (`foldSummaries`). */
  summary?: string | null;
  /** Aperta anche per un motivo dell'indirizzo che non è l'arrivo: «Mostra tutto» della Storia. */
  open?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Una piega della scheda guidata (rilascio 3): «Valutazione del team», «Dettagli», «Realizzazione»,
 * «Storia». Un `<details>` con il titolo (h2) e la riga grigia nel `<summary>`, aperto dal server
 * quando la pagina arriva con il suo `?capitolo=`; poi lo apre e lo chiude chi guarda. Aperta o no
 * lo dice l'arrivo della navigazione (`useLanding` di `Arrival`), non il passo di adesso: la
 * rilettura dopo un'azione (il passo che cambia con «Quando», un requisito aggiunto) non la apre né
 * la chiude da sé. Le pieghe stanno una sotto l'altra con una linea tra l'una e l'altra.
 */
export function Fold({ id, title, summary, open = false, children, className }: FoldProps) {
  const landed = useLanding() === id;
  return (
    <details id={id} open={landed || open || undefined} data-slot="fold" className={cn("group scroll-mt-20 border-t last:border-b", className)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-3 outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-9 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h2 className="text-base font-semibold">{title}</h2>
          {summary ? <span className="min-w-0 text-sm text-muted-foreground">{keepTogether(summary)}</span> : null}
        </span>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
      </summary>
      <div className="space-y-4 pb-5">{children}</div>
    </details>
  );
}
