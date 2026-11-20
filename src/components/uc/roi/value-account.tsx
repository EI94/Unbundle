import Link from "next/link";
import { ChevronRight, Calculator } from "lucide-react";
import { Why } from "@/components/ui-10/why";
import { EmptyState } from "@/components/uc/ui/empty-state";
import { formatCountIt } from "@/lib/uc/views/format";
import { VALUE_TEXT, missingText, type ValueFigure, type ValueView } from "@/lib/uc/views/roi";

/** Una cifra del conto in piccolo: il numero, oppure la nota («da calcolare», «non rientra»). */
export function Figure({ figure }: { figure: ValueFigure }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted-foreground">{figure.label}</dt>
      <dd className="mt-0.5 text-base font-semibold tabular-nums">
        {figure.value ?? <span className="font-normal text-muted-foreground">{figure.note}</span>}
      </dd>
    </div>
  );
}

const LINK = "inline-flex min-h-11 items-center gap-0.5 text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:min-h-0";

/**
 * Il conto (rilascio 10, §3.5; DESIGN §3.8): le tre cifre con le parole di §4. Il «Valore all'anno» è il numero grande
 * della scheda (lo stesso della scheda dello use case, D10), accanto «Stima» una volta sola con il suo «?»; sotto, in
 * piccolo, «Costo di realizzazione» e «Pareggio». Finché il conto è da calcolare una riga sola, con «Vedi quali».
 * Senza conto, lo stato vuoto con i dati che mancano: in Domande per chi le apre, raccolti da Lateral Space per gli
 * altri.
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
  const seeWhich = (
    <Link href={missingHref} scroll={false} className={LINK}>
      {VALUE_TEXT.seeWhich}
      <ChevronRight className="size-3.5" aria-hidden />
    </Link>
  );
  if (!view.computed) {
    const n = view.missing.total;
    return (
      <section aria-labelledby="valore-conto" data-slot="value-account" className="space-y-1">
        <h2 id="valore-conto" className="sr-only">
          {VALUE_TEXT.account}
        </h2>
        <p className="flex flex-wrap items-center gap-x-2 text-sm">
          <span>{n > 0 ? VALUE_TEXT.toCompute(n) : VALUE_TEXT.toComputeNoData}</span>
          {n > 0 || view.missing.needs.length > 0 ? seeWhich : null}
        </p>
      </section>
    );
  }
  const [cost, value, breakEven] = view.figures;
  const missing = missingText(view.missing.total, view.computed);
  return (
    <section aria-labelledby="valore-conto" data-slot="value-account" className="space-y-4">
      <h2 id="valore-conto" className="sr-only">
        {VALUE_TEXT.account}
      </h2>
      <dl className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <div data-figure="valore" className="min-w-0">
          <dt className="flex items-center gap-1 text-sm font-medium">
            {value.label}
            <span className="ml-1 inline-flex h-6 items-center rounded-full px-2 text-xs font-normal text-muted-foreground ring-1 ring-foreground/15">{view.statusLabel}</span>
            <Why id="valore-stima" text={view.disclaimer} label={VALUE_TEXT.statusWhy} />
          </dt>
          <dd data-slot="big-number-value" className="text-3xl font-semibold tracking-tight whitespace-nowrap tabular-nums sm:text-4xl">
            {value.value}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <Figure figure={cost} />
          <Figure figure={breakEven} />
        </div>
      </dl>
      {missing && (
        <p className="flex flex-wrap items-center gap-x-2 text-sm">
          <span>{missing}</span>
          {seeWhich}
        </p>
      )}
    </section>
  );
}
