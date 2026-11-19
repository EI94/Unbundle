import { stepItem } from "@/components/home/step-icons";
import { BigNumber } from "@/components/ui-10/big-number";
import { NextStep } from "@/components/ui-10/next-step";
import { TextAction } from "@/components/ui-10/row";
import type { StepView } from "@/lib/home/next-step";
import { HOME_TEXT } from "@/lib/home/text";
import { formatEuro, formatInteger } from "@/lib/use-cases/format";
import { keepTogether } from "@/lib/use-cases/line-breaks";
import type { OverviewNumber } from "@/lib/use-cases/panoramica";
import { ViewFocusLink } from "./list-focus";

/** Testi della testa della Panoramica (rilascio 10, docs/ui-10/PROPOSTA-10.md §3.4, prototipo S2). */
export const OVERVIEW_TEXT = Object.freeze({
  /** L'etichetta del numero grande. */
  value: "Valore all'anno",
  /** «su 20 use case». */
  onUseCases: (count: number) => `su ${formatInteger(count)} use case`,
  /** Il link alla Home, al pannello «Tutti i numeri». */
  allNumbers: "Tutti i numeri",
  /** La riga senza pulsante sull'ok ai fornitori (Lateral Space), con le parole del passo della Home. */
  suppliers: HOME_TEXT.steps.fornitori.status,
  /** Il link della riga: Impostazioni › Fornitori. */
  suppliersLink: "Impostazioni",
});

/**
 * (Rilascio 10, D3) I passi che cambiano vista dentro «Use case» («Decidi», «Chiedi», «Verifica»): il loro link porta
 * il fuoco al titolo della vista nuova (`ViewFocusLink`). Gli altri («Autorizza i fornitori», «Chiudi il SAL») escono
 * dalla pagina con un link normale.
 */
const IN_HUB_STEPS: ReadonlySet<string> = new Set(["decidere", "chiedere", "verificare"]);

/** Il numero grande già scritto: la cifra, l'etichetta e la riga grigia. null senza numero. */
export function overviewNumberView(number: OverviewNumber | null): { value: string; label: string; note: string } | null {
  if (!number) return null;
  return { value: formatEuro(number.amountEur), label: OVERVIEW_TEXT.value, note: OVERVIEW_TEXT.onUseCases(number.count) };
}

export interface PanoramicaTopProps {
  /**
   * (Rilascio 10, D3) Il prossimo passo del workspace, lo stesso della Home (`workspaceSteps` e `workspaceStepView`):
   * solo revisori, senza filtri; `step` null è «Tutto in ordine». null: niente passo (un filtro).
   */
  nextStep: { step: StepView | null } | null;
  /** Il numero grande (`overviewNumber`): solo revisori, con i filtri di adesso; null senza cifre. */
  number: OverviewNumber | null;
  /** «Tutti i numeri ›»: la Home con il suo pannello (`/dashboard/<ws>?apri=numeri`). */
  numbersHref: string;
}

/**
 * La testa della Panoramica dei revisori (rilascio 10, §3.4, prototipo S2), sopra le corsie:
 * 1. il prossimo passo del workspace (D3, `NextStep`): il solo pulsante pieno della pagina, con l'icona, il verbo e
 *    il «?» con il perché; «Tocca a …» quando non tocca a chi guarda, «Tutto in ordine» quando non c'è niente. Al
 *    telefono sta nella prima schermata;
 * 2. un numero grande, «412.000 € · Valore all'anno · su 20 use case» (approvati, in realizzazione e in uso, la stessa
 *    cifra della Home), con «Tutti i numeri ›» che porta alla Home.
 * La striscia delle fasi, le altre cifre e «Su tutto il portafoglio» non ci sono più: i numeri delle fasi stanno nelle
 * viste e nelle sezioni, il resto nella Home e in «Curva del valore». Conteggi di use case, mai di persone (art. 15.4).
 * A Lateral Space, quando manca l'ok ai fornitori e il passo non lo dice già, sopra c'è una riga senza pulsante
 * (`SuppliersLine`).
 */
export function PanoramicaTop({ nextStep, number, numbersHref }: PanoramicaTopProps) {
  const big = overviewNumberView(number);
  if (!nextStep && !big) return null;
  return (
    <div data-slot="panoramica-top" className="space-y-6">
      {nextStep ? <PanoramicaNextStep step={nextStep.step} /> : null}
      {big ? (
        <div data-figure="totale-valore">
          <BigNumber
            value={big.value}
            label={big.label}
            note={keepTogether(big.note)}
            action={<TextAction href={numbersHref}>{OVERVIEW_TEXT.allNumbers}</TextAction>}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Il passo del workspace sulla Panoramica: dentro «Use case» il link porta il fuoco al titolo della vista che apre. */
function PanoramicaNextStep({ step }: { step: StepView | null }) {
  const item = stepItem(step);
  const href = step?.href ?? null;
  const link = step && href && IN_HUB_STEPS.has(step.key) ? <ViewFocusLink href={href} /> : null;
  return <NextStep id="panoramica-prossimo-passo" step={item ? { ...item, link } : null} />;
}

/**
 * (Rilascio 10) La riga senza pulsante «Manca l'ok sui fornitori · Impostazioni ›», per Lateral Space (le stesse persone
 * dell'avviso di prima, `subprocessorsPendingForLs`) quando l'ok manca e il passo «Autorizza i fornitori» non c'è: il
 * passo vale solo quando l'ok ferma le domande al referente, la riga lo dice sempre. Il link porta a Impostazioni ›
 * Fornitori, dove l'ok si dà.
 */
export function SuppliersLine({ href }: { href: string }) {
  return (
    <p data-slot="suppliers-line" className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
      <span>{OVERVIEW_TEXT.suppliers}</span>
      <span aria-hidden>·</span>
      <TextAction href={href}>{OVERVIEW_TEXT.suppliersLink}</TextAction>
    </p>
  );
}
