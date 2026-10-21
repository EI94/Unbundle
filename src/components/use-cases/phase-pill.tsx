import { SEMAFORO_TONE } from "@/components/uc/common/semaforo-tone";
import { phaseTone } from "@/lib/use-cases/format";
import type { Phase, PhaseTone, SubState } from "@/lib/use-cases/types";
import { cn } from "@/lib/utils";

export interface PhasePillProps {
  /**
   * La pillola già scritta, «Fase · sotto-stato»: `label` di `phaseOfUseCase` per i revisori,
   * `phaseLabel` della proiezione per i contributori (mai il codice di un'altra scheda).
   */
  label: string;
  /** Il tono calcolato (`phaseOfUseCase(...).tone`). Senza, lo si ricava da fase e sotto-stato. */
  tone?: PhaseTone;
  phase?: Phase;
  subState?: SubState | null;
  size?: "sm" | "md";
  className?: string;
}

/**
 * La fase di uno use case in una pillola sola (docs/use-case/DESIGN.md §3.4): «Da valutare ·
 * Nuova», «Approvato · T1 2027», «Chiuso · Doppione di XX-0007». Puntino più parola, mai solo
 * colore: grigio (Da valutare, Chiuso), giallo («Da rivedere»), blu (Approvato, In
 * realizzazione), verde (Realizzato). Va anche nella pagina del contributore.
 */
export function PhasePill({ label, tone, phase, subState, size = "sm", className }: PhasePillProps) {
  const resolved: PhaseTone = tone ?? (phase ? phaseTone(phase, subState) : "grigio");
  return (
    <span
      data-slot="phase-pill"
      data-tone={resolved}
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-border/70 align-middle",
        size === "md" ? "px-2.5 py-1 text-sm" : "px-2 py-0.5 text-xs",
        className,
      )}
    >
      <span aria-hidden className={cn("shrink-0 rounded-full", SEMAFORO_TONE[resolved].fill, size === "md" ? "size-2" : "size-1.5")} />
      <span className="truncate font-medium text-foreground">{label}</span>
    </span>
  );
}
