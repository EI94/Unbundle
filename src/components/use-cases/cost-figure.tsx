import { COST_BANDS, type CostBandInfo } from "@/lib/use-cases/cost-bands";
import { costTextParts, startCostParts, type CostParts } from "@/lib/use-cases/format";
import { SCREEN_SEPARATOR, keepTogether } from "@/lib/use-cases/line-breaks";
import { cn } from "@/lib/utils";
import { SourceTag } from "./source-tag";

export interface CostFigureProps {
  /** Il costo della scheda (`costFigure` di `valuation.ts`, con le fasce del workspace); `null` vale «da stimare». */
  cost: CostParts | null;
  /** Le 5 fasce del workspace (D15, `resolveCostBands`), per l'etichetta di una fascia; predefinite `COST_BANDS`. */
  bands?: readonly CostBandInfo[];
  /**
   * «corta» (riga, pannello e matrice, la stessa forma): «€€ · 40.000 € · team»,
   * «€€ · fascia · team», «€€€ · fascia · stimato», con «Benefici e costi» «avvio 560 € ·
   * ricorrenti 600 €/anno» (senza fonte: la dice la scheda); «lunga» (scheda, §6.3): «€€ · 40.000 €»
   * oppure «€€ · fascia da 25.000 a 65.000 €», con la fonte per esteso; «avvio» (card della
   * Panoramica, `startCostParts`): «avvio 30.000 € · team», «avvio €€ · fascia · team», «avvio 700 €»
   * per «Benefici e costi», piccolo e grigio; senza costo niente, nemmeno «da stimare».
   */
  form?: "corta" | "lunga" | "avvio";
  /** «Costo: €€ · 40.000 € · team» nella riga (§4.6); «Costo di realizzazione» sopra la cifra nella scheda. */
  withLabel?: boolean;
  /**
   * Forma corta: «avvio 6.450 €» e «ricorrenti 1.200 €/anno» una sotto l'altra, senza « · » (il
   * pannello). Senza, le due parti stanno in riga e vanno a capo solo dopo « · ».
   */
  stack?: boolean;
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
export function CostFigure({ cost, bands = COST_BANDS, form = "corta", withLabel = false, stack = false, className }: CostFigureProps) {
  if (form === "avvio") {
    // Il costo d'avvio della card, senza etichetta: la fonte con il suo `data-source`, tranne «Benefici e costi».
    const start = startCostParts(cost, bands);
    if (!start || !cost) return null;
    return (
      <span data-figure="costo" data-cost-source={cost.source} className={cn("text-xs text-muted-foreground", className)}>
        <span className="whitespace-nowrap">{start.figure}</span>
        {start.source ? (
          <>
            <span>{SCREEN_SEPARATOR}</span>
            <SourceTag figure="costo" source={cost.source} />
          </>
        ) : null}
      </span>
    );
  }
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
        <div>
          <span className={cn("text-xl font-semibold tracking-tight", parts.estimated && "text-muted-foreground")}>{keepTogether(parts.figure)}</span>
        </div>
        {/* La fonte sulla riga sotto la cifra, come per il Valore: accanto, una cifra lunga la mandava a capo da sola. */}
        {source ? (
          <div data-slot="figure-source">
            <SourceTag figure="costo" source={source} form="lunga" />
          </div>
        ) : null}
      </div>
    );
  }
  // In riga, testo semplice che va a capo tra le parti: «Costo: €€ · 40.000 € · team». La cifra
  // di «Benefici e costi» («avvio 1.050 € · ricorrenti 300 €/anno») è lunga: va a capo dopo il «·»,
  // tra «avvio …» e «ricorrenti …», mai dentro un importo; con `stack` le due parti stanno una sotto l'altra.
  const tone = parts.estimated ? "text-muted-foreground" : "font-medium";
  const multi = parts.figureParts.length > 1;
  return (
    <span data-figure="costo" data-estimated={parts.estimated ? "true" : undefined} data-cost-source={source ?? undefined} className={cn("text-sm", className)}>
      {withLabel && <span className="text-muted-foreground">{COST_LABEL_SHORT}: </span>}
      {multi && stack ? (
        <span data-cost-parts="" className={cn("inline-flex flex-col", tone)}>
          {parts.figureParts.map((part) => (
            <span key={part} className="whitespace-nowrap">
              {part}
            </span>
          ))}
        </span>
      ) : multi ? (
        <span className={tone}>
          {parts.figureParts.map((part, index) => (
            <span key={part}>
              {index > 0 ? <span>{SCREEN_SEPARATOR}</span> : null}
              <span className="whitespace-nowrap">{part}</span>
            </span>
          ))}
        </span>
      ) : (
        <span className={cn("whitespace-nowrap", tone)}>{parts.figure}</span>
      )}
      {source && parts.source ? (
        <>
          <span className="text-muted-foreground">{SCREEN_SEPARATOR}</span>
          <SourceTag figure="costo" source={source} />
        </>
      ) : null}
    </span>
  );
}
