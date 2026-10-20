"use client";

import { cn } from "@/lib/utils";
import { SOURCE_CHIPS } from "@/lib/uc/views/referente-form";
import type { SourceBasis } from "@/lib/uc/vocab";

/**
 * «Da dove viene? (facoltativo)» (DESIGN §4.3 R2b, §4.7): Sistema, Documento,
 * Calcolo, A memoria, come pulsanti `aria-pressed` in un gruppo con il suo
 * nome. «A memoria» vale come stima. Mai pulsanti pieni: il pieno è uno solo
 * per schermata.
 */
export function SourceChips({ id, value, disabled, onToggle }: { id: string; value: SourceBasis | null; disabled: boolean; onToggle: (basis: SourceBasis) => void }) {
  return (
    <div role="group" aria-labelledby={`${id}-fonte`} className="space-y-2">
      <p id={`${id}-fonte`} className="text-base">
        Da dove viene? <span className="text-muted-foreground">(facoltativo)</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {SOURCE_CHIPS.map((chip) => {
          const pressed = value === chip.basis;
          return (
            <button
              key={chip.basis}
              type="button"
              aria-pressed={pressed}
              disabled={disabled}
              onClick={() => onToggle(chip.basis)}
              className={cn(
                "min-h-11 rounded-full border px-4 text-base transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60",
                pressed ? "border-primary bg-primary/10 font-medium text-foreground" : "border-border bg-background text-foreground hover:bg-muted",
              )}
            >
              {chip.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
