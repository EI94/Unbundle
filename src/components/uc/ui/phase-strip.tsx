import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { CASE_PHASES, CASE_PHASE_LABEL, type CasePhase } from "@/lib/uc/views/labels";

/**
 * Le 5 fasi del caso (DESIGN §3.4, «Tappe»), con lo stesso schema del
 * «Percorso» della Overview: cerchio con il numero, o la spunta per le fasi
 * superate. «In pausa» e «Chiuso» sono stati, non fasi: qui la fase corrente
 * si attenua e basta. `complete` vale per «Preparazione ✓».
 */
export interface PhaseStripProps {
  current: CasePhase;
  complete?: boolean;
  paused?: boolean;
  className?: string;
}

export function PhaseStrip({ current, complete = false, paused = false, className }: PhaseStripProps) {
  const at = CASE_PHASES.indexOf(current);
  return (
    <ol data-slot="phase-strip" aria-label="Fasi del caso" className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", className)}>
      {CASE_PHASES.map((phase, i) => {
        const done = i < at || (i === at && complete);
        const isCurrent = i === at;
        return (
          <li key={phase} aria-current={isCurrent ? "step" : undefined} className="flex items-center gap-2 text-sm">
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums",
                isCurrent && !paused ? "border-foreground font-medium text-foreground" : "border-border text-muted-foreground",
                done && "border-uc-verde/60 text-uc-verde",
              )}
              aria-hidden
            >
              {done ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className={cn(isCurrent ? (paused ? "text-muted-foreground" : "font-medium text-foreground") : "text-muted-foreground")}>
              {CASE_PHASE_LABEL[phase]}
              {done && <span className="sr-only"> (fatta)</span>}
              {isCurrent && !done && <span className="sr-only"> (in corso)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
