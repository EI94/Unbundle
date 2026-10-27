import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { askedTitle } from "@/lib/use-cases/answers";
import type { CostBandInfo } from "@/lib/use-cases/cost-bands";
import type { InfoProgressView } from "@/lib/use-cases/info-progress";
import type { ContributorUseCase } from "@/lib/use-cases/permissions";
import { buildDecideList, isContributorItem, type AnyHubItem } from "@/lib/use-cases/views";
import { EmptyState, NoResults } from "./hub-header";
import { CodeLabel, ROW_TEXT, UseCaseRow, isAskedOfViewer, panelHref, type HubQuery } from "./use-case-row";

/** Testi della vista (docs/use-case/DESIGN.md §4.3, §14.3). */
export const DECIDE_TEXT = Object.freeze({
  divider: "In attesa di risposta",
  emptyTitle: "Niente da decidere",
  emptyBody: "Le nuove proposte arrivano qui.",
  /** «In valutazione» dei contributori (H4p). */
  contributorEmptyTitle: "Nessuno use case in valutazione",
  toPriority: "Vai a Priorità",
});

export interface DecideViewProps {
  /** Gli use case della pagina, già filtrati e proiettati per chi guarda. */
  items: readonly AnyHubItem[];
  /** Il nome del team che valuta, da solo (§14.2): l'avviso «AI Builder ti chiede informazioni». */
  teamName: string;
  today: string;
  basePath: string;
  query: HubQuery;
  bands?: readonly CostBandInfo[];
  /** Il link «Vai a Priorità» del vuoto (solo revisori). */
  priorityHref: string | null;
  /** Con filtri attivi il vuoto è «Nessuno use case con questi filtri.» (§4.9). */
  filtersActive: boolean;
  clearHref: string;
  /** «Raccolta informazioni» per scheda (id in minuscolo), solo per i revisori. */
  info?: Readonly<Record<string, InfoProgressView>> | null;
}

/**
 * «Da decidere» (docs/use-case/DESIGN.md §4.3; D8): «Da valutare» con sotto-stato Nuova,
 * Possibile doppione, Valutata, Da rivedere (le «Rimandate» quando la data è arrivata), anche
 * senza punteggio. Prima chi aspetta da più giorni; sotto il divisore «In attesa di
 * risposta» le «Serve info», che aspettano chi ha proposto. Nessuna soglia, nessun allarme,
 * nessun ordinamento per persona. I contributori vedono «In valutazione»: i titoli
 * nell'ordine del server, le proprie proposte con la fase, e sopra la lista un avviso per ogni
 * propria proposta in «Serve info», con «Rispondi» (D17). L'ordine non cambia (art. 15.4).
 */
export function DecideView({ items, teamName, today, basePath, query, bands, priorityHref, filtersActive, clearHref, info = null }: DecideViewProps) {
  const infoOf = (id: string) => info?.[id.toLowerCase()] ?? null;
  const list = buildDecideList(items);
  if (!list.waiting.length && !list.needInfo.length) {
    if (filtersActive) return <NoResults clearHref={clearHref} />;
    return (
      <EmptyState title={priorityHref ? DECIDE_TEXT.emptyTitle : DECIDE_TEXT.contributorEmptyTitle} body={DECIDE_TEXT.emptyBody}>
        {priorityHref ? (
          <Link href={priorityHref} className="text-sm font-medium text-primary underline underline-offset-4 outline-none hover:decoration-2 focus-visible:decoration-2">
            {DECIDE_TEXT.toPriority}
          </Link>
        ) : null}
      </EmptyState>
    );
  }
  const asked = list.waiting.filter((item): item is Extract<ContributorUseCase, { own: true }> => isContributorItem(item) && isAskedOfViewer(item));
  return (
    <div data-slot="decide-view" className="space-y-4">
      {asked.length ? (
        <ul data-slot="answer-notice" className="divide-y divide-primary/20 rounded-lg border border-primary/30 bg-primary/5 px-3 text-sm">
          {asked.map((item) => (
            <li key={item.id} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 py-2">
              <span className="font-medium">{askedTitle(teamName)}:</span>
              <CodeLabel code={item.code} />
              <span className="min-w-0 flex-1 truncate">{item.title}</span>
              <Link
                href={panelHref(basePath, query, item.id)}
                scroll={false}
                className="inline-flex min-h-11 shrink-0 items-center gap-0.5 font-medium text-primary underline underline-offset-4 outline-none hover:decoration-2 focus-visible:decoration-2 sm:min-h-8"
              >
                {ROW_TEXT.answer}
                <ChevronRight aria-hidden className="size-4" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {list.waiting.length ? (
        <ul className="divide-y divide-border/70">
          {list.waiting.map((item) => (
            <UseCaseRow key={item.id} item={item} href={panelHref(basePath, query, item.id)} variant="decide" today={today} bands={bands} info={infoOf(item.id)} />
          ))}
        </ul>
      ) : null}
      {list.needInfo.length ? (
        <section aria-labelledby="da-decidere-in-attesa" className="space-y-1">
          <h2 id="da-decidere-in-attesa" className="flex items-center gap-3 px-3 pt-2 text-xs font-medium text-muted-foreground">
            <span>{DECIDE_TEXT.divider}</span>
            <span aria-hidden className="h-px flex-1 bg-border" />
          </h2>
          <ul className="divide-y divide-border/70">
            {list.needInfo.map((item) => (
              <UseCaseRow key={item.id} item={item} href={panelHref(basePath, query, item.id)} variant="decide" today={today} bands={bands} info={infoOf(item.id)} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
