import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ValueParams } from "@/lib/use-cases/value-model";
import { VALUE_PARAMS_TEXT, valueParamsLines } from "@/lib/use-cases/value-params-form";
import { cn } from "@/lib/utils";

/**
 * Il riquadro chiuso «Ipotesi di calcolo», in sola lettura: le ipotesi del workspace con cui si
 * contano «Benefici e costi» (costo orario, soglie in euro, mesi). Va sotto i grafici, per i
 * revisori; le cambia solo chi gestisce il workspace, in Impostazioni › Valutazione: a lui
 * (`settingsHref`) il riquadro dà il link. Componente senza stato: va bene sul server e nel browser.
 */
export function ValueParamsSummary({
  params,
  followsCurrentMonth = false,
  settingsHref = null,
  className,
}: {
  params: ValueParams;
  /** Il workspace non ha salvato il primo mese della curva: vale il mese corrente. */
  followsCurrentMonth?: boolean;
  /** Impostazioni › Valutazione, solo per chi gestisce il workspace (le può cambiare). */
  settingsHref?: string | null;
  className?: string;
}) {
  const lines = valueParamsLines(params, { followsCurrentMonth });
  return (
    <details data-slot="value-params-summary" className={cn("group rounded-lg border border-border px-3 py-2 text-sm", className)}>
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium outline-none marker:hidden focus-visible:underline [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        {VALUE_PARAMS_TEXT.title}
      </summary>
      <dl className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-[minmax(0,1fr)_auto]">
        {lines.map((line) => (
          <div key={line.key} className="contents">
            <dt className="text-muted-foreground">{line.label}</dt>
            <dd className="tabular-nums sm:text-right">{line.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">{VALUE_PARAMS_TEXT.planRule}</p>
      {settingsHref ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {VALUE_PARAMS_TEXT.editIn}{" "}
          <Link href={settingsHref} className="font-medium text-foreground underline underline-offset-4 hover:decoration-2">
            {VALUE_PARAMS_TEXT.settingsPlace}
          </Link>
          .
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">{VALUE_PARAMS_TEXT.readOnly}</p>
      )}
    </details>
  );
}
