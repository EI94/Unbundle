import { ORIGIN_LABEL } from "@/lib/use-cases/labels";
import type { Origin } from "@/lib/use-cases/types";
import { cn } from "@/lib/utils";

/** Il colore del punto, lo stesso della matrice (§3.2): verde acqua per AI Adoption, indaco per AI Transformation. */
export const ORIGIN_DOT_CLASS: Readonly<Record<Origin, string>> = {
  adoption: "bg-teal-500",
  transformation: "bg-indigo-500",
};

export interface OriginChipProps {
  origin: Origin;
  /** «chip» (predefinito): «AI Adoption»; «lunga»: «AI Adoption · dal basso». */
  variant?: "chip" | "lunga";
  className?: string;
}

/**
 * L'origine di uno use case (docs/use-case/DESIGN.md §3.2): «AI Adoption» o «AI
 * Transformation», con il punto del colore della matrice. Il chip ha sempre il testo: il
 * colore non è mai l'unico segnale. Solo per i revisori: i contributori non vedono l'origine.
 */
export function OriginChip({ origin, variant = "chip", className }: OriginChipProps) {
  const label = ORIGIN_LABEL[origin];
  return (
    <span
      data-slot="origin-chip"
      data-origin={origin}
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-border px-2 py-0.5 align-middle text-xs font-medium whitespace-nowrap text-foreground",
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", ORIGIN_DOT_CLASS[origin])} />
      <span className="truncate">{variant === "lunga" ? label.long : label.chip}</span>
    </span>
  );
}
