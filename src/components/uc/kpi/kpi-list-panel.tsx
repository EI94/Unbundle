import Link from "next/link";
import { Gauge } from "lucide-react";
import { SegmentedNav, type SegmentedNavItem } from "@/components/dashboard/segmented-nav";
import { Button } from "@/components/ui/button";
import { DetailSheet } from "@/components/uc/ui/detail-sheet";
import { EmptyState } from "@/components/uc/ui/empty-state";
import type { KpiPageData } from "@/lib/db/queries/uc-value";
import { KPI_PANEL, KPI_VIEW_LABEL, groupViews, kpiPanelHref, pagesOfOpen, toggleGroup, vanityFilterLabel, withGroupPage, type KpiViewKey } from "@/lib/uc/views/kpi";
import { VALUE_TEXT } from "@/lib/uc/views/roi";
import { cn } from "@/lib/utils";
import { KpiList } from "./kpi-list";
import { KpiSearch } from "./kpi-search";
import { WidgetBoundary } from "./widget-boundary";

type ListState = { vista: KpiViewKey | null; opened: string[] | null; open: "tutti" | string[]; pagine: Readonly<Record<string, number>> };

/**
 * «Tutti i KPI» in un pannello di Valore (rilascio 10, §3.5; F-099, F-100), aperto da «Come si calcola»
 * (`?apri=kpi`): «Collegati al conto» e «Tutti», la ricerca, i gruppi per leva chiusi con il conteggio (uno aperto alla
 * volta, venti righe per pagina, come la pagina `/valore/kpi` di prima). Per Lateral Space la vista «Da sistemare»
 * diventa il filtro «KPI non collegati al conto (N)». Ogni KPI apre il suo pannello (`?apri=kpi-<id>`), con «Tutti i
 * KPI» per tornare all'elenco com'era. Reso sul server: al client arrivano solo le righe del gruppo aperto.
 */
export function KpiListPanel({ data, valoreBase, state, ls }: { data: KpiPageData; valoreBase: string; state: ListState; ls: boolean }) {
  const { vista, opened, open, pagine } = state;
  const href = (o: { kpiId?: string | null; vista?: KpiViewKey | null; q?: string | null; gruppi?: readonly string[] | null; pagine?: Readonly<Record<string, number>> | null }) =>
    kpiPanelHref(valoreBase, { kpiId: o.kpiId ?? null, vista: o.vista === undefined ? vista : o.vista, q: o.q === undefined ? data.q : o.q, gruppi: o.gruppi, pagine: o.pagine });

  const segments: SegmentedNavItem[] = [];
  if (data.counts.conto > 0 || data.view === "conto") segments.push({ key: "conto", ...KPI_VIEW_LABEL.conto, count: data.counts.conto, href: href({ vista: "conto" }) });
  segments.push({ key: "tutti", ...KPI_VIEW_LABEL.tutti, count: data.counts.tutti, href: href({ vista: "tutti" }) });
  const vanity = ls && data.counts["da-sistemare"] > 0;
  const fixing = data.view === "da-sistemare";

  return (
    <DetailSheet title={VALUE_TEXT.kpiTitle} closeHref={valoreBase} size="xl">
      {(data.counts.tutti > 0 || data.q) && (
        <div className="space-y-3">
          {segments.length > 1 && !fixing && <SegmentedNav items={segments} active={data.view} ariaLabel="Quali KPI" size="sm" />}
          <KpiSearch q={data.q} baseHref={valoreBase} vista={vista} keep={{ apri: KPI_PANEL }} />
          {(vanity || fixing) && (
            <Link
              href={fixing ? href({ vista: null }) : href({ vista: "da-sistemare" })}
              scroll={false}
              aria-current={fixing ? "true" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center rounded-full px-3 text-xs font-medium ring-1 sm:min-h-8",
                fixing ? "bg-foreground text-background ring-foreground" : "text-muted-foreground ring-foreground/15 hover:text-foreground",
              )}
            >
              {vanityFilterLabel(data.counts["da-sistemare"])}
            </Link>
          )}
        </div>
      )}
      <WidgetBoundary title="I KPI non si sono caricati">
        {data.shown === 0 ? (
          data.counts.tutti > 0 ? (
            <EmptyState
              title={data.q ? `Nessun KPI in questa vista per “${data.q}”.` : "Nessun KPI in questa vista."}
              action={
                <Button variant="outline" className="min-h-11 sm:min-h-8" nativeButton={false} render={<Link href={href({ vista: "tutti" })} scroll={false} />}>
                  Vedi tutti i KPI
                </Button>
              }
            />
          ) : data.q ? (
            <EmptyState
              title={`Nessun KPI trovato per “${data.q}”.`}
              action={
                <Button variant="outline" className="min-h-11 sm:min-h-8" nativeButton={false} render={<Link href={href({ q: null })} scroll={false} />}>
                  Togli la ricerca
                </Button>
              }
            />
          ) : (
            <EmptyState icon={Gauge} title="Questa realizzazione non ha ancora KPI" />
          )
        ) : (
          <KpiList
            groups={groupViews(data.groups, open, pagine)}
            toggleHref={opened ? (key) => href({ gruppi: toggleGroup(opened, key), pagine: pagesOfOpen(pagine, toggleGroup(opened, key)) }) : null}
            rowHref={(id) => href({ kpiId: id, gruppi: opened, pagine })}
            pageHref={(key, page) => href({ gruppi: opened, pagine: withGroupPage(pagine, key, page) })}
          />
        )}
      </WidgetBoundary>
    </DetailSheet>
  );
}
