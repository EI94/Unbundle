import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { REALIZATION_TEXT } from "@/lib/uc/views/realization";

/**
 * «Avvia la realizzazione» nel capitolo «Realizzazione» della scheda, prima
 * dell'avvio (DESIGN §2.1 ingresso 1, §3.2; `docs/use-case/DESIGN.md` §6.5).
 *
 * - `canStart` (Lateral Space con la sezione accesa, use case «Da costruire»
 *   approvato senza dossier): il riquadro e il pulsante pieno verso
 *   `/casi-duso/nuovo?useCaseId=…`.
 * - Altrimenti, per i revisori del cliente: «La realizzazione la avvia Lateral
 *   Space.».
 *
 * Con la sezione spenta per il workspace la pagina Use case mostra il suo
 * «Segna come in realizzazione»: questo componente non compare. Riceve i dati
 * come props (`realizationForUseCase` di `uc-nav.ts`, stato `da_avviare`).
 */
export function StartRealization({ canStart, href, className }: { canStart: boolean; href: string | null; className?: string }) {
  if (!canStart || !href) {
    return <p className={cn("text-sm text-muted-foreground", className)}>{REALIZATION_TEXT.onlyLateralSpace}</p>;
  }
  return (
    <div data-slot="start-realization" className={cn("flex min-w-0 flex-col gap-4 rounded-xl bg-card p-5 ring-1 ring-foreground/10 sm:flex-row sm:items-center sm:justify-between", className)}>
      <div className="min-w-0">
        <p className="text-sm font-medium">{REALIZATION_TEXT.notStartedTitle}</p>
        <p className="mt-1 text-sm text-muted-foreground">{REALIZATION_TEXT.notStartedBody}</p>
      </div>
      <Button className="h-11 shrink-0 sm:h-8" render={<Link href={href} />} nativeButton={false}>
        {REALIZATION_TEXT.start}
      </Button>
    </div>
  );
}
