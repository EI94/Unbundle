"use client";

import { useRef, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { FIGURE_SEPARATOR } from "@/lib/use-cases/format";
import type { CompactPath } from "@/lib/use-cases/guided";
import { keepTogether } from "@/lib/use-cases/line-breaks";
import { cn } from "@/lib/utils";
import { useArrivalOpen } from "./arrival";

/** Gli id del percorso compatto: la riga e i passi che apre. */
export const PATH_IDS = Object.freeze({ root: "percorso", steps: "percorso-passi" });

/**
 * (Rilascio 10, §3.4) Il percorso compatto della scheda, subito dopo il passo: una riga, «Passo 4 di 6 · Informazioni:
 * 2 di 5 arrivate ›» (`compactPathOf`), che si apre sui passi (`UseCasePath`) e, per uno use case approvato, su
 * «Quando». Chiuso di partenza; si apre anche quando un link chiede qualcosa che sta dentro (`#quando`, il passo
 * «Scegli il trimestre»: `arriveAt` manda `ARRIVAL_OPEN_EVENT`). Lo stesso al telefono e su desktop: una riga.
 */
export function PathDisclosure({ compact, children, className }: { compact: CompactPath; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useArrivalOpen(ref, () => setOpen(true));
  return (
    <div ref={ref} id={PATH_IDS.root} data-slot="path-disclosure" data-arrival-host="" data-open={open ? "" : undefined} className={cn("min-w-0 scroll-mt-20", className)}>
      <button
        type="button"
        data-arrival-toggle=""
        aria-expanded={open}
        aria-controls={PATH_IDS.steps}
        onClick={() => setOpen((now) => !now)}
        className="group inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-md text-left text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-9"
      >
        <span className="min-w-0 break-words">
          <span className="text-muted-foreground">
            {keepTogether(compact.position)}
            {FIGURE_SEPARATOR}
          </span>
          <span className="underline-offset-4 group-hover:underline">{keepTogether(compact.now)}</span>
        </span>
        <ChevronRight aria-hidden className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none", open && "rotate-90")} />
      </button>
      <div id={PATH_IDS.steps} data-slot="path-steps" hidden={!open} className="mt-2 space-y-4 rounded-xl border bg-card px-2 py-4">
        {children}
      </div>
    </div>
  );
}
