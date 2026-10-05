import Link from "next/link";
import { ChartColumn, Download, Lock, Users } from "lucide-react";
import type { ResultsCohort } from "@/lib/learning/results";
import { cn } from "@/lib/utils";
import { turnLabel } from "./results-format";

export type ResultsView = "gruppo" | "individuali" | "scarica";

/** L'indirizzo della pagina Risultati con turno e sezione. */
export function resultsHref(base: string, view: ResultsView, turno: string | null) {
  const query = new URLSearchParams();
  if (turno) query.set("turno", turno);
  query.set("vista", view);
  return `${base}/results?${query.toString()}`;
}

/** Scelta del turno: un'etichetta per giorno e ora, più "Tutti i turni". */
export function ResultsTurns({ cohorts, selected, base, view }: { cohorts: ResultsCohort[]; selected: string | null; base: string; view: ResultsView }) {
  if (cohorts.length === 0) return null;
  const chip = "inline-flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
  const on = "border-transparent bg-primary text-primary-foreground";
  const off = "bg-card text-muted-foreground hover:bg-muted hover:text-foreground";
  return <nav aria-label="Turno" className="space-y-2">
    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Turno</p>
    <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" data-testid="results-turns">
      {cohorts.map((cohort) => {
        const active = cohort.id === selected;
        return <li key={cohort.id}>
          <Link href={resultsHref(base, view, cohort.id)} aria-current={active ? "true" : undefined} className={cn(chip, active ? on : off)} scroll={false}>
            {turnLabel(cohort.startsAt)}
            {cohort.live && <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", active ? "bg-emerald-600 text-white" : "bg-emerald-500/15 text-emerald-300")}>
              <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current" />In corso
            </span>}
          </Link>
        </li>;
      })}
      <li>
        <Link href={resultsHref(base, view, "all")} aria-current={selected === null ? "true" : undefined} className={cn(chip, selected === null ? on : off)} scroll={false}>
          Tutti i turni
        </Link>
      </li>
    </ul>
  </nav>;
}

const TABS: { view: ResultsView; label: string; short: string; testId: string; icon: typeof Users }[] = [
  { view: "gruppo", label: "Risultati di gruppo", short: "Gruppo", testId: "results-tab-group", icon: ChartColumn },
  { view: "individuali", label: "Risultati individuali", short: "Individuali", testId: "results-tab-individual", icon: Users },
  { view: "scarica", label: "Scarica", short: "Scarica", testId: "results-tab-export", icon: Download },
];

/** Le tre sezioni, sempre visibili. Un lucchetto dice dove manca il permesso. */
export function ResultsTabs({ active, base, turno, allowed }: { active: ResultsView; base: string; turno: string | null; allowed: Record<ResultsView, boolean> }) {
  return <nav aria-label="Sezioni dei risultati">
    <ul className="grid grid-cols-3 gap-1 rounded-2xl border bg-muted/60 p-1">
      {TABS.map(({ view, label, short, testId, icon: Icon }) => {
        const current = view === active;
        return <li key={view} className="min-w-0">
          <Link
            href={resultsHref(base, view, turno)}
            data-testid={testId}
            aria-current={current ? "page" : undefined}
            scroll={false}
            className={cn(
              "flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl px-1.5 py-1 text-xs font-medium transition-colors sm:min-h-11 sm:flex-row sm:gap-2 sm:px-2 sm:text-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              current ? "bg-background text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
            )}
          >
            <Icon aria-hidden className="size-4 shrink-0" />
            <span className="flex min-w-0 max-w-full items-center gap-1">
              <span className="truncate sm:hidden">{short}</span>
              <span className="hidden truncate sm:inline">{label}</span>
              {!allowed[view] && <><Lock aria-hidden className="size-3 shrink-0 opacity-70 sm:size-3.5" /><span className="sr-only">(serve un permesso)</span></>}
            </span>
          </Link>
        </li>;
      })}
    </ul>
  </nav>;
}
