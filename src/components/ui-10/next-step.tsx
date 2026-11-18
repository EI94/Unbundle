import type { ReactElement } from "react";
import Link from "next/link";
import { CheckCheck, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { UI10_TEXT } from "./text";
import { Why } from "./why";

/** Il passo da disegnare: il verbo e dove porta, oppure le parole dello stato quando non tocca a chi guarda. */
export interface NextStepItem {
  /** Il verbo del pulsante (2-3 parole), o le parole dello stato senza pulsante. */
  label: string;
  /** L'icona di 16 px accanto alla parola (lucide), decorativa. */
  icon?: LucideIcon;
  /** Il «?»: il perché. Vuoto: niente «?». */
  why?: string;
  /** Tocca a chi guarda: il pulsante pieno. Altrimenti le parole dello stato e «Tocca a …», senza pulsante. */
  mine: boolean;
  /** «Tocca a …», a schermo solo quando non tocca a chi guarda. */
  turn?: string | null;
  /** Dove porta il pulsante. */
  href?: string | null;
  /** Un link fatto da chi usa il passo (per esempio `<ViewFocusLink href=… />`): prende il posto di `href`. */
  link?: ReactElement | null;
  /** Un'azione della pagina al posto di un link (solo da un componente client). */
  onClick?: (() => void) | null;
}

export interface NextStepProps {
  /** null: «Tutto in ordine», senza pulsante. */
  step: NextStepItem | null;
  /** La radice degli `id` (l'etichetta e il «?»): uno per pagina. */
  id?: string;
  className?: string;
}

/**
 * `NextStep` (rilascio 10, docs/ui-10/PROPOSTA-10.md §5.4, regole 2 e 3 di §1): il prossimo passo di una schermata.
 *
 * - Sopra, l'etichetta «Prossimo passo», 12 px, grigia; la sezione si chiama così per i lettori di schermo.
 * - Il pulsante **pieno** (`variant="default"`) con l'icona e il verbo, e accanto il «?» con il perché: è il solo
 *   pulsante pieno della schermata. Al telefono è largo quanto la colonna, meno il «?» di 44 px; alto 44 px, 36 px da
 *   640 px.
 * - Se il passo non tocca a chi guarda: l'icona e le parole dello stato, senza pulsante, e sotto «Tocca a …».
 * - Niente da fare: «Tutto in ordine», senza pulsante e senza «?».
 *
 * Senza stato: si rende sul server e nel client. `onClick` vale solo da un componente client.
 */
export function NextStep({ step, id = "prossimo-passo", className }: NextStepProps) {
  const labelId = `${id}-etichetta`;
  const whyId = `${id}-perche`;
  const Icon = step?.icon;
  const why = step?.why ?? "";
  const describedBy = why ? whyId : undefined;
  const icon = Icon ? <Icon aria-hidden data-icon="inline-start" /> : null;
  const filled = "min-h-11 min-w-0 flex-1 sm:min-h-9 sm:flex-none";
  let action: ReactElement | null = null;
  if (step?.mine && step.onClick) {
    action = (
      <Button type="button" className={filled} aria-describedby={describedBy} onClick={step.onClick} data-action="next-step">
        {icon}
        {step.label}
      </Button>
    );
  } else if (step?.mine && (step.link || step.href)) {
    action = (
      <Button render={step.link ?? <Link href={step.href!} />} nativeButton={false} className={filled} aria-describedby={describedBy} data-action="next-step">
        {icon}
        {step.label}
      </Button>
    );
  }
  return (
    <section aria-labelledby={labelId} data-slot="next-step" className={cn("space-y-2", className)}>
      <p id={labelId} className="text-xs text-muted-foreground">
        {UI10_TEXT.nextStep.label}
      </p>
      <div className="flex min-w-0 items-center gap-2">
        {step === null ? (
          <p data-slot="next-step-done" className="flex min-h-11 items-center gap-2 text-sm font-medium sm:min-h-9">
            <CheckCheck aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            {UI10_TEXT.nextStep.done}
          </p>
        ) : action ? (
          action
        ) : (
          <p data-slot="next-step-status" className="flex min-h-11 min-w-0 items-center gap-2 text-sm font-medium break-words sm:min-h-9" aria-describedby={describedBy}>
            {Icon ? <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" /> : null}
            {step.label}
          </p>
        )}
        {step ? <Why id={whyId} text={why} /> : null}
      </div>
      {step && !step.mine && step.turn ? (
        <p data-slot="next-step-turn" className="text-xs text-muted-foreground">
          {step.turn}
        </p>
      ) : null}
    </section>
  );
}
