import Link from "next/link";
import { ChevronRight, Calculator } from "lucide-react";
import { EmptyState } from "@/components/uc/ui/empty-state";
import { formatCountIt } from "@/lib/uc/views/format";
import { missingText, type ValueFigure, type ValueView } from "@/lib/uc/views/roi";

/** Una cifra del conto: il numero, oppure «—» e la nota sotto. */
export function Figure({ figure, size = "lg" }: { figure: ValueFigure; size?: "lg" | "md" }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 sm:block">
      <dt className="text-sm text-muted-foreground">{figure.label}</dt>
      <dd className="min-w-0 text-right sm:mt-1 sm:text-left">
        {figure.value !== null ? (
          <span className={size === "lg" ? "text-2xl font-semibold tracking-tight tabular-nums" : "text-base font-semibold tabular-nums"}>{figure.value}</span>
        ) : (
          <>
            <span className={size === "lg" ? "text-2xl font-semibold text-muted-foreground" : "text-base font-semibold text-muted-foreground"} aria-hidden>
              —
            </span>
            <span className="ml-2 text-sm text-muted-foreground sm:mt-0.5 sm:ml-0 sm:block">{figure.note}</span>
          </>
        )}
      </dd>
    </div>
  );
}

/**
 * «Il conto» (DESIGN §3.8): i tre numeri principali (costo di realizzazione,
 * beneficio all'anno, pareggio), cosa manca per calcolarlo e la riga sulle
 * stime. Senza conto, lo stato vuoto con i dati che mancano: in Domande per
 * chi le apre, raccolti da Lateral Space per gli altri.
 */
export function ValueAccount({ view, missingHref, questionsHref }: { view: ValueView; missingHref: string; questionsHref: string | null }) {
  if (view.source === "vuoto") {
    const n = view.missing.questionTotal;
    return (
      <EmptyState icon={Calculator} title="Il conto si calcola con i dati raccolti">
        {n > 0 ? (
          <>
            {n === 1 ? "Manca 1 dato" : `Mancano ${formatCountIt(n)} dati`}:{" "}
            {questionsHref ? (
              <Link href={questionsHref} className="underline underline-offset-4 hover:text-foreground">
                {n === 1 ? "lo trovi in Domande" : "li trovi in Domande"}
              </Link>
            ) : (
              // Chi non apre Domande (AI Board, Osservatore) non viene mandato lì.
              `${n === 1 ? "lo sta" : "li sta"} raccogliendo Lateral Space`
            )}
            .
          </>
        ) : (
          "Lateral Space lo prepara con le risposte alle domande."
        )}
      </EmptyState>
    );
  }
  const missing = missingText(view.missing.total, view.computed);
  return (
    <section aria-labelledby="valore-conto" className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="valore-conto" className="text-base font-semibold">
          Il conto
        </h2>
        <span className="text-sm text-muted-foreground">{view.statusLabel}</span>
      </div>
      <dl className="grid gap-3 sm:grid-cols-3 sm:gap-6">
        {view.figures.map((f) => (
          <Figure key={f.label} figure={f} />
        ))}
      </dl>
      {missing && (
        <p className="text-sm">
          <span>{missing}</span>
          <span className="text-muted-foreground" aria-hidden>
            {" · "}
          </span>
          <Link href={missingHref} scroll={false} className="inline-flex min-h-11 items-center gap-0.5 text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:min-h-0">
            Vedi quali
            <ChevronRight className="size-3.5" aria-hidden />
          </Link>
        </p>
      )}
      <p className="text-sm text-muted-foreground">{view.disclaimer}</p>
    </section>
  );
}
