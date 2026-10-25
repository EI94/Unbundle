import { FIGURE_SEPARATOR, formatEuro, hasValueText, perYearText, valueLongText, valueShortText, type ValueParts } from "@/lib/use-cases/format";
import { cn } from "@/lib/utils";
import { SourceTag } from "./source-tag";

export interface ValueFigureProps {
  /** Il Valore della scheda (`valueFigure` di `valuation.ts`); `null` vale «da stimare». */
  value: ValueParts | null;
  /**
   * «corta» (riga, pannello, card della Roadmap): la parola, «Alto»; con «Benefici e costi»
   * «Medio · 4.043 €/anno», «da misurare · fino a 5.840 €» o «qualitativo»; senza parola ma con
   * gli euro all'anno «12.250 € all'anno». «lunga» (scheda, §6.3): «Alto · 3,8» con la fonte, e
   * sotto gli euro all'anno con la loro fonte.
   */
  form?: "corta" | "lunga";
  /** Nella riga: «Valore: Alto» (§4.6). */
  withLabel?: boolean;
  /**
   * Nella forma corta, la fonte dopo la parola: «Alto · team» (pannello, §4.8). Non con «Benefici e
   * costi»: «Medio · 4.043 €/anno» è già la forma della spec. La forma lunga la mostra sempre.
   */
  withSource?: boolean;
  className?: string;
}

const VALUE_LABEL = "Valore";
/** Sotto la cifra della scheda: le voci da misurare, fuori dal totale. */
const PENDING_TEXT = (amount: number) => `e fino a ${formatEuro(amount)} da misurare`;

/**
 * Il Valore di uno use case (docs/use-case/DESIGN.md §7.1): punteggio in parola, fonte («team»,
 * «AI») ed euro all'anno («dal dossier», «team»). Senza punteggio, in grigio, «da stimare».
 * Solo per i revisori: `data-figure="valore"` permette alle schermate di controllare che la
 * pagina del contributore non ne abbia (PIANO-LAVORI §5.4).
 */
export function ValueFigure({ value, form = "corta", withLabel = false, withSource = false, className }: ValueFigureProps) {
  const estimated = !hasValueText(value);
  if (form === "lunga") {
    const perYear = perYearText(value?.perYear);
    const benefits = value?.benefits;
    const pending = benefits?.state === "contato" && benefits.pendingEur > 0 ? PENDING_TEXT(benefits.pendingEur) : null;
    return (
      <div data-figure="valore" data-estimated={estimated ? "true" : undefined} className={cn("min-w-0 space-y-1", className)}>
        {withLabel && <div className="text-sm text-muted-foreground">{VALUE_LABEL}</div>}
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className={cn("text-xl font-semibold tracking-tight", (estimated || !value?.word) && "text-muted-foreground")}>{valueLongText(value)}</span>
          {value?.source && <SourceTag figure="valore" source={value.source} form="lunga" />}
        </div>
        {perYear && value?.perYear && (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
            <span>{perYear}</span>
            <SourceTag figure="valore_anno" source={value.perYear.source} form="lunga" />
          </div>
        )}
        {pending ? <div className="text-xs text-muted-foreground">{pending}</div> : null}
      </div>
    );
  }
  // In riga, testo semplice: «Valore: Alto», «Alto · team», «Valore: Medio · 4.043 €/anno».
  return (
    <span data-figure="valore" data-estimated={estimated ? "true" : undefined} className={cn("text-sm", className)}>
      {withLabel && <span className="text-muted-foreground">{VALUE_LABEL}: </span>}
      <span className={cn("whitespace-nowrap", estimated || !value?.word ? "text-muted-foreground" : "font-medium")}>{valueShortText(value)}</span>
      {withSource && value?.source && !value.benefits && (
        <>
          <span className="text-muted-foreground">{FIGURE_SEPARATOR}</span>
          <SourceTag figure="valore" source={value.source} />
        </>
      )}
    </span>
  );
}
