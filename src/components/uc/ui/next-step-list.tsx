import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { myNextSteps, resolveStepHref, type NextStep } from "@/lib/uc/views/next-step";

/**
 * «Da fare adesso» della Panoramica (DESIGN §3.4): al massimo 3 passi di chi
 * guarda, in una cornice con le righe come link (niente pulsanti dentro: il
 * pulsante pieno è quello della testata). Sotto, la riga «Tocca a …».
 *
 * Se chi guarda non ha nulla da fare resta solo la riga, mai un riquadro vuoto.
 *
 * `base` è obbligatorio: gli `href` dei passi sono relativi alla radice del
 * dossier («/via», «/persone?invia=1») e senza `base` porterebbero a pagine
 * inesistenti. Le props di DESIGN §5.1 vanno lette con `base` in più.
 */
export interface NextStepListProps {
  steps: readonly NextStep[];
  whoseTurn?: string | null;
  /** Radice del dossier (`/dashboard/<ws>/casi-duso/<id>`): completa gli `href` dei passi. */
  base: string;
  max?: number;
}

export function NextStepList({ steps, whoseTurn, base, max = 3 }: NextStepListProps) {
  const mine = myNextSteps(steps, max);
  if (mine.length === 0 && !whoseTurn) return null;
  return (
    <div data-slot="next-step-list" className="space-y-3">
      {mine.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          {mine.map((step) => (
            <li key={step.id}>
              <Link
                href={resolveStepHref(base, step.href)}
                className="group flex min-h-11 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{step.label}</span>
                  {step.detail && <span className="mt-0.5 block text-sm text-muted-foreground">{step.detail}</span>}
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {whoseTurn && <p className="text-sm text-muted-foreground">{whoseTurn}</p>}
    </div>
  );
}
