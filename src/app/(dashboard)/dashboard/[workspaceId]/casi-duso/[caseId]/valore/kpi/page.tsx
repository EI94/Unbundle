import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, Gauge } from "lucide-react";
import { PageContainer } from "@/components/dashboard/page-container";
import { SegmentedNav, type SegmentedNavItem } from "@/components/dashboard/segmented-nav";
import { Button } from "@/components/ui/button";
import { openCaseView } from "@/components/uc/catalog/case-page";
import { casePath } from "@/components/uc/catalog/paths";
import { KpiList } from "@/components/uc/kpi/kpi-list";
import { KpiPanel } from "@/components/uc/kpi/kpi-panel";
import { KpiSearch } from "@/components/uc/kpi/kpi-search";
import { WidgetBoundary } from "@/components/uc/kpi/widget-boundary";
import { EmptyState } from "@/components/uc/ui/empty-state";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { loadKpiPage } from "@/lib/db/queries/uc-value";
import { formatCountIt } from "@/lib/uc/views/format";
import { KPI_VIEW_LABEL, groupViews, groupsOpen, kpiQuery, pagesOfOpen, parseKpiParams, toggleGroup, vanityText, withGroupPage, type KpiViewKey } from "@/lib/uc/views/kpi";
import { canOpenPage } from "@/lib/uc/views/page-access";
import { isLsViewer } from "@/lib/uc/views/status-groups";

/**
 * Tutti i KPI (DESIGN §3.8, `/valore/kpi`): «Collegati al conto» e «Tutti»,
 * raggruppati per leva, con la ricerca (`?q=`). Ricerca e gruppi stanno sul
 * server: al client arrivano solo le righe del gruppo aperto (`?gruppi=`, uno
 * alla volta), venti per pagina (`?pagine=`), senza i collegamenti. Il pannello del KPI
 * si apre da `?apri=<id>`. In fondo, solo per Lateral Space, la riga grigia dei
 * KPI indispensabili senza una voce del conto.
 */
export default async function KpiPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; caseId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId, caseId } = await params;
  const sp = await searchParams;
  const { session, access } = await requireWorkspacePage(workspaceId);
  const { executor, viewer } = await openCaseView({ workspaceId, caseId, session, access, page: "kpi" });
  const p = parseKpiParams(sp);
  const data = await loadKpiPage(executor, viewer, p);
  if (!data) notFound();
  const roles = viewer.roles;
  const ls = isLsViewer(roles);
  const base = casePath(workspaceId, caseId, "valore/kpi");
  // La vista resta nell'indirizzo solo se l'ha chiesta chi guarda: così i link restano quelli di partenza.
  const vista = p.vista ? data.view : null;
  const open = groupsOpen({ shown: data.shown, searching: Boolean(data.q), requested: p.gruppi });
  const opened = open === "tutti" ? null : open;
  // Le pagine dei gruppi aperti; quella di un gruppo chiuso non resta nell'indirizzo.
  const pagine = opened ? pagesOfOpen(p.pagine, opened) : p.pagine;
  // Gruppi aperti e pagine restano nell'indirizzo del pannello e della chiusura; cambiando vista o ricerca si ripartono da capo.
  const href = (o: { vista?: KpiViewKey | null; apri?: string | null; q?: string | null; gruppi?: readonly string[] | null; pagine?: Readonly<Record<string, number>> | null }) =>
    `${base}${kpiQuery({ vista: o.vista === undefined ? vista : o.vista, q: o.q === undefined ? data.q : o.q, apri: o.apri, gruppi: o.gruppi, pagine: o.pagine })}`;

  const segments: SegmentedNavItem[] = [];
  if (data.counts.conto > 0 || data.view === "conto") segments.push({ key: "conto", ...KPI_VIEW_LABEL.conto, count: data.counts.conto, href: href({ vista: "conto" }) });
  segments.push({ key: "tutti", ...KPI_VIEW_LABEL.tutti, count: data.counts.tutti, href: href({ vista: "tutti" }) });
  if (data.view === "da-sistemare") segments.push({ key: "da-sistemare", ...KPI_VIEW_LABEL["da-sistemare"], count: data.counts["da-sistemare"], href: href({ vista: "da-sistemare" }) });
  const keyTitles = new Map(data.groups.flatMap((g) => g.items.map((k) => [k.key, k.title] as const)));

  return (
    <PageContainer>
      <div className="max-w-4xl space-y-6">
        {canOpenPage("roi", roles) && (
          <Link
            href={casePath(workspaceId, caseId, "valore")}
            className="-mb-2 inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:min-h-8"
          >
            <ChevronLeft className="size-4" aria-hidden />
            Valore
          </Link>
        )}
        {(data.counts.tutti > 0 || data.q) && (
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {segments.length > 1 ? (
              <SegmentedNav items={segments} active={data.view} ariaLabel="Quali KPI" />
            ) : (
              <h2 className="text-base font-semibold">
                Tutti i KPI
                {data.counts.tutti > 0 && <span className="font-normal text-muted-foreground tabular-nums"> ({formatCountIt(data.counts.tutti)})</span>}
              </h2>
            )}
            <KpiSearch q={data.q} baseHref={base} vista={vista} />
          </div>
        )}

        <WidgetBoundary title="I KPI non si sono caricati">
          {data.shown === 0 ? (
            data.counts.tutti > 0 ? (
              // La vista chiesta è vuota, ma il caso (o la ricerca) ha altri KPI.
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
              <EmptyState icon={Gauge} variant="page" title="Questo caso non ha ancora KPI" />
            )
          ) : (
            <KpiList
              groups={groupViews(data.groups, open, pagine)}
              toggleHref={opened ? (key) => href({ gruppi: toggleGroup(opened, key), pagine: pagesOfOpen(pagine, toggleGroup(opened, key)) }) : null}
              rowHref={(id) => href({ apri: id, gruppi: opened, pagine })}
              pageHref={(key, page) => href({ gruppi: opened, pagine: withGroupPage(pagine, key, page) })}
            />
          )}
        </WidgetBoundary>

        {ls && data.view !== "da-sistemare" && data.counts["da-sistemare"] > 0 && (
          <p className="text-sm text-muted-foreground">
            {vanityText(data.counts["da-sistemare"])}
            <span aria-hidden>{" · "}</span>
            <Link href={href({ vista: "da-sistemare" })} scroll={false} className="inline-flex min-h-11 items-center gap-0.5 hover:text-foreground sm:min-h-0">
              Sistema
              <ChevronRight className="size-3.5" aria-hidden />
            </Link>
          </p>
        )}
      </div>

      {data.open && <KpiPanel kpi={data.open} workspaceId={workspaceId} caseId={caseId} roles={roles} closeHref={href({ apri: null, gruppi: opened, pagine })} keyTitles={keyTitles} />}
    </PageContainer>
  );
}
