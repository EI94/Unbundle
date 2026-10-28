import { Fragment } from "react";
import {
  FIGURE_SEPARATOR,
  formatEuro,
  hasValueText,
  perYearText,
  shownPerYear,
  valueScreenLongText,
  valueScreenText,
  type ValueParts,
} from "@/lib/use-cases/format";
import { cn } from "@/lib/utils";
import { SourceTag } from "./source-tag";

export interface ValueFigureProps {
  /** Il Valore della scheda (`valueFigure` di `valuation.ts`); `null` vale «da stimare». */
  value: ValueParts | null;
  /**
   * «corta» (riga, pannello, card della Roadmap): con gli euro all'anno solo la cifra,
   * «12.250 €/anno»; senza, la parola, «Alto», oppure con «Benefici e costi»
   * «da misurare · fino a 5.840 €» o «qualitativo». «lunga» (scheda, §6.3): con gli euro all'anno
   * «12.250 € all'anno» con la loro fonte; senza, «Alto · 3,8» con la fonte del punteggio.
   */
  form?: "corta" | "lunga";
  /** Nella riga: «Valore: Alto» (§4.6). */
  withLabel?: boolean;
  /**
   * Nella forma corta, la fonte dopo la cifra (pannello, §4.8): degli euro all'anno,
   * «12.250 €/anno · team», altrimenti del punteggio, «Alto · AI». Non con «Benefici e costi»:
   * «12.250 €/anno» e «da misurare · fino a 5.840 €» vanno senza fonte. La forma lunga la mostra
   * sempre.
   */
  withSource?: boolean;
  /**
   * Nella forma corta, nelle colonne strette (riga di «Da decidere», lista di «Priorità»): la cifra
   * va a capo dopo «·» se non ci sta, mai dentro una parte («da misurare ·» / «fino a 5.840 €»).
   * Senza, resta su una riga.
   */
  wrap?: boolean;
  className?: string;
}

const VALUE_LABEL = "Valore";
/** Sotto la cifra della scheda: le voci da misurare, fuori dal totale. */
const PENDING_TEXT = (amount: number) => `e fino a ${formatEuro(amount)} da misurare`;

/**
 * Il Valore di uno use case (docs/use-case/DESIGN.md §7.1). Con una cifra in euro solo la cifra,
 * senza parola né punteggio: «12.250 €/anno», «12.250 €/anno · team»,
 * «da misurare · fino a 5.840 €»; nella scheda «12.250 € all'anno» con la fonte degli euro
 * («dal dossier», «team»). Senza euro il punteggio in parola con la sua fonte: «Alto · AI», nella
 * scheda «Alto · 3,8». Senza punteggio, in grigio, «da stimare». Solo per i revisori:
 * `data-figure="valore"` permette alle schermate di controllare che la pagina del contributore non
 * ne abbia (PIANO-LAVORI §5.4).
 */
export function ValueFigure({ value, form = "corta", withLabel = false, withSource = false, wrap = false, className }: ValueFigureProps) {
  const estimated = !hasValueText(value);
  // Gli euro all'anno che vanno a schermo (mai 0 €): con loro niente parola, niente punteggio.
  const euro = shownPerYear(value);
  // In grigio «da stimare» e un Valore senza parola né euro («qualitativo», «da misurare · fino a X €»).
  const grey = estimated || (!value?.word && !euro);
  if (form === "lunga") {
    // Sotto la cifra grande gli euro all'anno solo se la cifra non li scrive già: in pratica 0 €.
    const perYear = euro ? null : perYearText(value?.perYear);
    const benefits = value?.benefits;
    const pending = benefits && benefits.pendingEur > 0 && (benefits.state === "contato" || euro) ? PENDING_TEXT(benefits.pendingEur) : null;
    return (
      <div data-figure="valore" data-estimated={estimated ? "true" : undefined} className={cn("min-w-0 space-y-1", className)}>
        {withLabel && <div className="text-sm text-muted-foreground">{VALUE_LABEL}</div>}
        <div>
          <span className={cn("text-xl font-semibold tracking-tight", grey && "text-muted-foreground")}>{valueScreenLongText(value)}</span>
        </div>
        {/* La fonte sulla riga sotto la cifra, come per il costo: lo stesso posto per le due cifre. */}
        {euro ? (
          <div data-slot="figure-source">
            <SourceTag figure="valore_anno" source={euro.source} form="lunga" />
          </div>
        ) : value?.source ? (
          <div data-slot="figure-source">
            <SourceTag figure="valore" source={value.source} form="lunga" />
          </div>
        ) : null}
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
  // In riga, testo semplice: «Valore: 12.250 €/anno», «12.250 €/anno · team», «Alto · AI».
  const text = valueScreenText(value);
  return (
    <span data-figure="valore" data-estimated={estimated ? "true" : undefined} className={cn("text-sm", className)}>
      {withLabel && <span className="text-muted-foreground">{VALUE_LABEL}: </span>}
      <span className={cn(!wrap && "whitespace-nowrap", grey ? "text-muted-foreground" : "font-medium")}>{wrap ? <WrapAfterSeparator text={text} /> : text}</span>
      {withSource && !value?.benefits && (euro || value?.source) ? (
        <>
          <span className="text-muted-foreground">{FIGURE_SEPARATOR}</span>
          {euro ? <SourceTag figure="valore_anno" source={euro.source} /> : value?.source ? <SourceTag figure="valore" source={value.source} /> : null}
        </>
      ) : null}
    </span>
  );
}

/**
 * «da misurare · fino a 5.840 €» con un solo punto dove andare a capo, dopo «·»: ogni parte, con il
 * suo «·», resta intera («da misurare ·» / «fino a 5.840 €»). Lo stesso testo della forma su una riga.
 */
function WrapAfterSeparator({ text }: { text: string }) {
  const parts = text.split(FIGURE_SEPARATOR);
  const mark = FIGURE_SEPARATOR.trimEnd();
  return parts.map((part, index) => (
    <Fragment key={index}>
      {index > 0 ? " " : null}
      <span className="whitespace-nowrap">{index < parts.length - 1 ? `${part}${mark}` : part}</span>
    </Fragment>
  ));
}
