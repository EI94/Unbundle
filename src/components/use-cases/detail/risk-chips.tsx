import { TriangleAlert } from "lucide-react";
import { RISK_LABEL, type RiskChip } from "@/lib/use-cases/labels";
import { cn } from "@/lib/utils";

export interface RiskChipsProps {
  /** `riskChips(intake)` di `valuation.ts`, già nella scheda dei revisori (`UseCaseDetail.risks`). */
  risks: readonly RiskChip[];
  className?: string;
}

/**
 * I chip di rischio di «Impatto» (docs/use-case/DESIGN.md §6.3, §7.3; rilascio 3): «Serve
 * decisione AI Board», «Dati personali», «Sicurezza». Solo un segnale: non cambiano Valore, Costo
 * o zona. Il testo c'è sempre, l'icona non è mai sola. Solo i token del tema: il bordo dei campi e
 * l'icona nel giallo del semaforo.
 */
export function RiskChips({ risks, className }: RiskChipsProps) {
  if (!risks.length) return null;
  return (
    <ul data-slot="risk-chips" className={cn("flex flex-wrap gap-1.5", className)}>
      {risks.map((risk) => (
        <li
          key={risk}
          data-risk={risk}
          className="inline-flex items-center gap-1 rounded-full border border-input px-2 py-0.5 text-xs font-medium text-foreground"
        >
          <TriangleAlert aria-hidden className="size-3 text-uc-giallo" />
          {RISK_LABEL[risk]}
        </li>
      ))}
    </ul>
  );
}
