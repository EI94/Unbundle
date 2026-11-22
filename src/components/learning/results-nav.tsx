import Link from "next/link";
import type { ResultsCohort } from "@/lib/learning/results";
import { LEARNING_TEXT } from "@/lib/learning/text";
import { SegmentedNav } from "@/components/dashboard/segmented-nav";
import { cn } from "@/lib/utils";
import { turnLabel } from "./results-format";

const R = LEARNING_TEXT.results;

/** Le due schede dei Risultati (§3.9): «In aula» (`?vista=gruppo`, senza nomi) e «Persone» (`?vista=individuali`). */
export type ResultsView = "gruppo" | "individuali";

/** L'indirizzo della pagina Risultati con lezione e scheda. */
export function resultsHref(base: string, view: ResultsView, turno: string | null) {
  const query = new URLSearchParams();
  if (turno) query.set("turno", turno);
  query.set("vista", view);
  return `${base}/results?${query.toString()}`;
}

/**
 * La scelta della lezione: un'etichetta per giorno e ora, più «Tutte le lezioni». (Rilascio 10, ondata 7a, FO-24) Solo
 * quando le lezioni sono più d'una: con una sola non c'è niente da scegliere.
 */
export function ResultsTurns({ cohorts, selected, base, view }: { cohorts: ResultsCohort[]; selected: string | null; base: string; view: ResultsView }) {
  if (cohorts.length < 2) return null;
  const chip = "inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-9";
  const on = "border-foreground bg-muted text-foreground";
  const off = "bg-card text-muted-foreground hover:bg-muted hover:text-foreground";
  return <nav aria-label={R.lessons} className="max-w-full min-w-0">
    <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" data-testid="results-turns">
      {cohorts.map((cohort) => {
        const active = cohort.id === selected;
        return <li key={cohort.id}>
          <Link href={resultsHref(base, view, cohort.id)} aria-current={active ? "true" : undefined} className={cn(chip, active ? on : off)} scroll={false}>
            {turnLabel(cohort.startsAt)}
            {cohort.live && <span className="inline-flex items-center gap-1 text-xs font-semibold text-foreground">
              <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-uc-verde motion-reduce:animate-none" />{R.live}
            </span>}
          </Link>
        </li>;
      })}
      <li>
        <Link href={resultsHref(base, view, "all")} aria-current={selected === null ? "true" : undefined} className={cn(chip, selected === null ? on : off)} scroll={false}>
          {R.allLessons}
        </Link>
      </li>
    </ul>
  </nav>;
}

/**
 * Le schede, «In aula» e «Persone». Una scheda senza permesso si vede con il lucchetto solo da chi gestisce il corso,
 * che il permesso se lo può dare (FO-26); per gli altri non c'è. Con una scheda sola, niente schede.
 */
export function ResultsTabs({ active, base, turno, allowed, canGrant }: { active: ResultsView; base: string; turno: string | null; allowed: Record<ResultsView, boolean>; canGrant: boolean }) {
  const items = ([
    { key: "gruppo", label: R.tabs.group },
    { key: "individuali", label: R.tabs.people },
  ] as const)
    .filter((item) => allowed[item.key] || canGrant)
    .map((item) => ({ key: item.key, label: item.label, href: resultsHref(base, item.key, turno), locked: allowed[item.key] ? false : R.tabs.locked }));
  if (items.length < 2) return null;
  return <SegmentedNav items={items} active={active} ariaLabel={R.tabs.label} />;
}
