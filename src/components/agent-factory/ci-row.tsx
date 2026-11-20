import { SEMAFORO_TONE } from "@/components/uc/common/semaforo-tone";
import { cn } from "@/lib/utils";
import { CiKeyActions } from "./ci-key-actions";
import type { CiFamilyRow } from "./ci-view";

/**
 * La riga della CI di una famiglia, sotto i suoi casi (rilascio 8.2b, docs/rilascio-8/RILASCIO-8.2b-SPEC.md §2.6): il
 * puntino del colore dello stato e la frase che lo dice (lo stato non è mai solo un colore), poi i pulsanti, solo per
 * chi gestisce le chiavi del repository. Chi costruisce, anche da fuori, vede lo stato senza pulsanti.
 *
 * I pulsanti ci sono sempre per chi gestisce le chiavi, anche quando lo stato non ne offre: così la finestra con la
 * chiave appena creata resta aperta mentre la riga cambia stato. Senza riga (la famiglia senza repository): niente.
 */
export function CiRow({ workspaceId, row }: { workspaceId: string; row: CiFamilyRow | null | undefined }) {
  if (!row) return null;
  return (
    <div data-slot="ci-row" data-ci-state={row.kind} className="mt-3 flex min-w-0 flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <p className="flex min-w-0 items-start gap-2 text-sm">
        <span aria-hidden data-tone={row.tone} className={cn("mt-1.5 size-2 shrink-0 rounded-full", SEMAFORO_TONE[row.tone].fill)} />
        <span className="min-w-0 break-words">{row.text}</span>
      </p>
      {row.manages ? <CiKeyActions workspaceId={workspaceId} repo={row.repo} primary={row.primary} menu={row.menu} /> : null}
    </div>
  );
}
