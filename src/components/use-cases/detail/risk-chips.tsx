import { TriangleAlert } from "lucide-react";
import { RISK_LABEL, type RiskChip } from "@/lib/use-cases/labels";
import { cn } from "@/lib/utils";

export interface RiskChipsProps {
  /** `riskChips(intake)` di `valuation.ts`, già nella scheda dei revisori (`UseCaseDetail.risks`). */
  risks: readonly RiskChip[];
  className?: string;
}

/**
 * I chip di rischio del capitolo «Valutazione» (docs/use-case/DESIGN.md §6.3, §7.3): «Serve
 * decisione AI Board», «Dati personali», «Sicurezza». Solo un segnale: non cambiano Valore, Costo
 * o zona. Il testo c'è sempre, l'icona non è mai sola.
 */
export function RiskChips({ risks, className }: RiskChipsProps) {
  if (!risks.length) return null;
  return (
    <ul data-slot="risk-chips" className={cn("flex flex-wrap gap-1.5", className)}>
      {risks.map((risk) => (
        <li
          key={risk}
          data-risk={risk}
          className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 px-2 py-0.5 text-xs font-medium text-foreground"
        >
          <TriangleAlert aria-hidden className="size-3 text-amber-500" />
          {RISK_LABEL[risk]}
        </li>
      ))}
    </ul>
  );
}
