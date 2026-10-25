import { COST_BANDS, type CostBandInfo } from "@/lib/use-cases/cost-bands";
import { FIGURE_SEPARATOR, costTextParts, type CostParts } from "@/lib/use-cases/format";
import { cn } from "@/lib/utils";
import { SourceTag } from "./source-tag";

export interface CostFigureProps {
  /** Il costo della scheda (`costFigure` di `valuation.ts`, con le fasce del workspace); `null` vale «da stimare». */
  cost: CostParts | null;
  /** Le 5 fasce del workspace (D15, `resolveCostBands`), per l'etichetta di una fascia; predefinite `COST_BANDS`. */
  bands?: readonly CostBandInfo[];
  /**
   * «corta» (riga, pannello, card della Roadmap, la stessa forma): «€€ · 40.000 € · team»,
   * «€€ · fascia · team», «€€€ · fascia · stimato», con «Benefici e costi» «avvio 560 € ·
   * ricorrenti 600 €/anno» (senza fonte: la dice la scheda); «lunga» (scheda, §6.3): «€€ · 40.000 €»
   * oppure «€€ · fascia da 25.000 a 65.000 €», con la fonte per esteso.
   */
  form?: "corta" | "lunga";
  /** «Costo: €€ · 40.000 € · team» nella riga (§4.6); «Costo di realizzazione» sopra la cifra nella scheda. */
  withLabel?: boolean;
  className?: string;
}

const COST_LABEL_SHORT = "Costo";
const COST_LABEL_LONG = "Costo di realizzazione";

/**
 * Il costo di realizzazione di uno use case (docs/use-case/DESIGN.md §7.2, D5, D15): l'importo,
 * altrimenti la fascia con la parola «fascia», e sempre la fonte. Senza costo, in grigio, «da
 * stimare». Solo per i revisori. `data-figure="costo"` e la fonte con `data-source` permettono
 * alle schermate di controllare che il costo abbia sempre la sua fonte e che la pagina del
 * contributore non abbia cifre (PIANO-LAVORI §5.4, §5.7).
 */
export function CostFigure({ cost, bands = COST_BANDS, form = "corta", withLabel = false, className }: CostFigureProps) {
  const parts = costTextParts(cost, form, bands);
  const source = cost && !parts.estimated ? cost.source : null;
  if (form === "lunga") {
    return (
      <div
        data-figure="costo"
        data-estimated={parts.estimated ? "true" : undefined}
        data-cost-source={source ?? undefined}
        className={cn("min-w-0 space-y-1", className)}
      >
        {withLabel && <div className="text-sm text-muted-foreground">{COST_LABEL_LONG}</div>}
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className={cn("text-xl font-semibold tracking-tight", parts.estimated && "text-muted-foreground")}>{parts.figure}</span>
          {source && <SourceTag figure="costo" source={source} form="lunga" />}
        </div>
      </div>
    );
  }
  // In riga, testo semplice che va a capo tra le parti: «Costo: €€ · 40.000 € · team». La cifra
  // di «Benefici e costi» («avvio 1.050 € · ricorrenti 300 €/anno») è lunga: può andare a capo,
  // altrimenti esce dal pannello.
  return (
    <span data-figure="costo" data-estimated={parts.estimated ? "true" : undefined} data-cost-source={source ?? undefined} className={cn("text-sm", className)}>
      {withLabel && <span className="text-muted-foreground">{COST_LABEL_SHORT}: </span>}
      <span className={cn(source !== "stima" && "whitespace-nowrap", parts.estimated ? "text-muted-foreground" : "font-medium")}>{parts.figure}</span>
      {source && parts.source ? (
        <>
          <span className="text-muted-foreground">{FIGURE_SEPARATOR}</span>
          <SourceTag figure="costo" source={source} />
        </>
      ) : null}
    </span>
  );
}
