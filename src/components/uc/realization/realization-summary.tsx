import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProgressToGate } from "@/components/uc/ui/progress-to-gate";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { cn } from "@/lib/utils";
import { REALIZATION_TEXT, type RealizationDossierView } from "@/lib/uc/views/realization";

/**
 * Il riepilogo del dossier nel capitolo «Realizzazione» della scheda dello use
 * case (DESIGN §2.1 ingresso 1; `docs/use-case/DESIGN.md` §6.5): stato, l'unico
 * numero di avanzamento, la prossima tappa (o «Tocca a te · <passo>» per chi
 * apre il dossier) e le tre cifre del conto. «Apri il dossier» solo per chi lo
 * può aprire; gli altri revisori leggono chi lo vede.
 *
 * Riceve i dati come props (`realizationForUseCase` di `uc-nav.ts`). `primary`:
 * «Apri il dossier» come pulsante pieno (predefinito) o `outline`, se la
 * schermata ha già il suo pulsante pieno. `hideEmptyFigures`: senza nessuna
 * delle tre cifre, niente «da calcolare» (la scheda dello use case con
 * «Benefici e costi» ha già le sue cifre nella Valutazione, poco sopra).
 */
export function RealizationSummary({
  dossier,
  primary = true,
  hideEmptyFigures = false,
  className,
}: {
  dossier: RealizationDossierView;
  primary?: boolean;
  hideEmptyFigures?: boolean;
  className?: string;
}) {
  const figures = [
    { label: REALIZATION_TEXT.cost, value: dossier.figures.cost },
    { label: REALIZATION_TEXT.benefit, value: dossier.figures.benefit },
    { label: REALIZATION_TEXT.breakEven, value: dossier.figures.breakEven },
  ];
  return (
    <div data-slot="realization-summary" className={cn("min-w-0 space-y-4", className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm font-medium">{REALIZATION_TEXT.dossier}</span>
        <StatusDot tone={dossier.statusTone} label={dossier.statusLabel} size="md" />
      </div>
      {/* `md` senza link, come la testata del dossier: «0 di 245 indispensabili a posto» da 640 px in su. */}
      {dossier.progress && <ProgressToGate size="md" ok={dossier.progress.ok} required={dossier.progress.required} inReview={dossier.progress.inReview} className="max-w-md" />}
      {dossier.myStep ? (
        <p className="text-sm">
          <Link href={dossier.myStep.href} className="inline-flex min-h-11 items-center gap-1 font-medium underline-offset-4 hover:underline sm:min-h-0">
            {REALIZATION_TEXT.myTurn} · {dossier.myStep.label}
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </p>
      ) : dossier.nextMilestone ? (
        <p className="text-sm text-muted-foreground">
          {REALIZATION_TEXT.nextMilestone}: <span className="text-foreground tabular-nums">{dossier.nextMilestone}</span>
        </p>
      ) : null}
      {hideEmptyFigures && figures.every((f) => !f.value) ? null : (
        <dl className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
          {figures.map((f) => (
            <div key={f.label} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{f.label}</dt>
              <dd className={cn("mt-0.5 text-base tabular-nums", f.value ? "font-semibold" : "text-muted-foreground")}>{f.value ?? REALIZATION_TEXT.toCompute}</dd>
            </div>
          ))}
        </dl>
      )}
      {dossier.closed && <p className="text-sm text-muted-foreground">{REALIZATION_TEXT.closed}</p>}
      {dossier.href ? (
        <Button variant={primary ? "default" : "outline"} className="h-11 sm:h-8" render={<Link href={dossier.href} />} nativeButton={false}>
          {REALIZATION_TEXT.open}
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">{REALIZATION_TEXT.membersOnly}</p>
      )}
    </div>
  );
}

/** La lettura del dossier non è riuscita: il capitolo mostra solo la fase e questa riga. */
export function RealizationUnavailable({ className }: { className?: string }) {
  return <p className={cn("text-sm text-muted-foreground", className)}>{REALIZATION_TEXT.unavailable}</p>;
}
