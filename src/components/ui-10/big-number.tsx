import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface BigNumberProps {
  /** La cifra già scritta («412.000 €»). */
  value: string;
  /** Al massimo quattro parole: «Valore all'anno». */
  label: string;
  /** La riga grigia, al massimo otto parole: «su 20 use case · in uso 38.000 €». */
  note?: string | null;
  /** Un link o un «?» sotto: «Tutti i numeri ›» (`TextAction`). */
  action?: ReactNode;
  className?: string;
}

/**
 * `BigNumber` (rilascio 10, docs/ui-10/PROPOSTA-10.md §5.4, regola 4 di §1): il numero grande della schermata. Uno
 * solo per schermata: gli altri numeri stanno in «Tutti i numeri». La cifra è 36/40 da 640 px, 30/36 al telefono, con
 * le cifre tabellari, e non va mai a capo; sotto l'etichetta, la riga grigia e l'azione facoltativa.
 * Lo zero non si mostra: chi lo usa non lo rende senza una cifra.
 */
export function BigNumber({ value, label, note, action, className }: BigNumberProps) {
  return (
    <div data-slot="big-number" className={cn("min-w-0", className)}>
      <p data-slot="big-number-value" className="text-3xl font-semibold tracking-tight whitespace-nowrap tabular-nums sm:text-4xl">
        {value}
      </p>
      <p data-slot="big-number-label" className="mt-1.5 text-sm font-medium">
        {label}
      </p>
      {note ? (
        <p data-slot="big-number-note" className="mt-0.5 text-sm text-muted-foreground">
          {note}
        </p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
