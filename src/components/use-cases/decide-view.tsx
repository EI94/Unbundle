import Link from "next/link";
import { Check, ChevronRight } from "lucide-react";
import { NextStep } from "@/components/ui-10/next-step";
import type { AgentPalette } from "@/lib/use-cases/agents";
import { askedTitle } from "@/lib/use-cases/answers";
import { HOME_TEXT } from "@/lib/home/text";
import type { ContributorUseCase } from "@/lib/use-cases/permissions";
import { buildDecideList, isContributorItem, waitingDays, type AnyHubItem, type HubItem } from "@/lib/use-cases/views";
import { EmptyState, HUB_TEXT, NoResults } from "./hub-header";
import { CodeLabel, ROW_TEXT, UseCaseRow, isAskedOfViewer, panelHref, type HubQuery } from "./use-case-row";

/** Testi della vista (docs/use-case/DESIGN.md §4.3, §14.3; rilascio 10, §3.4). */
export const DECIDE_TEXT = Object.freeze({
  divider: "In attesa di risposta",
  emptyTitle: "Niente da decidere",
  /** (Rilascio 10, §3.4) Non «proposte»: il glossario non chiama così uno use case. */
  emptyBody: "Le nuove idee arrivano qui.",
  /** «In valutazione» dei contributori (H4p). */
  contributorEmptyTitle: "Nessuno use case in valutazione",
  /** (Rilascio 10, §3.4) Il pulsante pieno della vista: apre il pannello della prima riga. */
  start: "Inizia dal più vecchio",
});

export interface DecideViewProps {
  /** Gli use case della pagina, già filtrati e proiettati per chi guarda. */
  items: readonly AnyHubItem[];
  /** Il nome del team che valuta, da solo (§14.2): l'avviso «AI Builder ti chiede informazioni». */
  teamName: string;
  today: string;
  basePath: string;
  query: HubQuery;
  /** Il link «Vai alla Panoramica» del vuoto (solo revisori). */
  overviewHref: string | null;
  /** Con filtri attivi il vuoto è «Nessuno use case con questi filtri.» (§4.9). */
  filtersActive: boolean;
  clearHref: string;
  /** (Rilascio 10) I colori degli agenti del workspace, per il tag delle righe. */
  agents?: AgentPalette | null;
  /** (Rilascio 10, §3.4) Chi guarda decide: allora «Inizia dal più vecchio» è il pulsante pieno della vista. */
  canDecide?: boolean;
}

/**
 * «Da decidere» (docs/use-case/DESIGN.md §4.3; D8): «Da valutare» con sotto-stato Nuova,
 * Possibile doppione, Valutata, Da rivedere (le «Rimandate» quando la data è arrivata), anche
 * senza punteggio. Prima chi aspetta da più giorni; sotto il divisore «In attesa di
 * risposta» le «Serve info», che aspettano chi ha proposto. Nessuna soglia, nessun allarme,
 * nessun ordinamento per persona. I contributori vedono «In valutazione»: i titoli
 * nell'ordine del server, le proprie proposte con la fase, e sopra la lista un avviso per ogni
 * propria proposta in «Serve info», con «Rispondi» (D17). L'ordine non cambia (art. 15.4).
 *
 * (Rilascio 10, §3.4) In cima il prossimo passo dei revisori, il solo pulsante pieno della vista: «Inizia dal più
 * vecchio», che apre il pannello della prima riga, con il «?» che dice da quanto aspetta. Le righe hanno cinque cose
 * (`UseCaseRow`, variante «decide»): il costo sta nel pannello.
 */
export function DecideView({ items, teamName, today, basePath, query, overviewHref, filtersActive, clearHref, agents = null, canDecide = false }: DecideViewProps) {
  const list = buildDecideList(items);
  if (!list.waiting.length && !list.needInfo.length) {
    if (filtersActive) return <NoResults clearHref={clearHref} />;
    return (
      <EmptyState title={overviewHref ? DECIDE_TEXT.emptyTitle : DECIDE_TEXT.contributorEmptyTitle} body={DECIDE_TEXT.emptyBody}>
        {overviewHref ? (
          <Link href={overviewHref} className="text-sm font-medium text-primary underline underline-offset-4 outline-none hover:decoration-2 focus-visible:decoration-2">
            {HUB_TEXT.goToOverview}
          </Link>
        ) : null}
      </EmptyState>
    );
  }
  const asked = list.waiting.filter((item): item is Extract<ContributorUseCase, { own: true }> => isContributorItem(item) && isAskedOfViewer(item));
  // Il più vecchio è la prima riga: l'ordine della vista (`compareWaiting`). Solo ai revisori, che decidono.
  const first = canDecide ? (list.waiting.find((item): item is HubItem => !isContributorItem(item)) ?? null) : null;
  return (
    <div data-slot="decide-view" className="space-y-4">
      {first ? (
        <NextStep
          id="da-decidere-passo"
          step={{
            label: DECIDE_TEXT.start,
            icon: Check,
            mine: true,
            why: HOME_TEXT.steps.decidere.why(list.count, waitingDays(first.waitingSince, today)),
            link: <Link href={panelHref(basePath, query, first.id)} scroll={false} />,
          }}
        />
      ) : null}
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
            <UseCaseRow key={item.id} item={item} href={panelHref(basePath, query, item.id)} today={today} agents={agents} />
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
              <UseCaseRow key={item.id} item={item} href={panelHref(basePath, query, item.id)} today={today} agents={agents} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
