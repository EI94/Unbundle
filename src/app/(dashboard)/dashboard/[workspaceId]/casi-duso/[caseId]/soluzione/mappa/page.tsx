import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, Waypoints } from "lucide-react";
import { PageContainer } from "@/components/dashboard/page-container";
import { SegmentedNav } from "@/components/dashboard/segmented-nav";
import { openCaseView } from "@/components/uc/catalog/case-page";
import { casePath } from "@/components/uc/catalog/paths";
import { AnalysisSwitch } from "@/components/uc/map/analysis-switch";
import { GraphBoundary } from "@/components/uc/map/graph-boundary";
import { MapLegend } from "@/components/uc/map/map-parts";
import { ProcessSteps, SolutionSteps } from "@/components/uc/map/process-steps";
import { SolutionGraph } from "@/components/uc/map/solution-graph";
import { EmptyState } from "@/components/uc/ui/empty-state";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { loadSolutionMap } from "@/lib/db/queries/uc-solution";
import { MAP_EXAMPLE_LINK, MAP_PAGE_VIEW_LABEL, hasAgentProcess, mapItemTitles, mapPageViews, resolveMapPageView } from "@/lib/uc/views/map";
import { flowOrder, layoutGraph } from "@/lib/uc/views/map-layout";
import { audienceFor, isLsViewer } from "@/lib/uc/views/status-groups";
import { SolutionNav } from "../_parts/solution-nav";

function first(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s ? s : null;
}

/**
 * Soluzione › Mappa (DESIGN §3.7.2), l'unica pagina `wide`: si apre su «Con
 * l'agente» (il processo con l'agente, o i passi della mappa della soluzione),
 * «Oggi» se c'è il processo di oggi, e «Segui un esempio dall'inizio alla fine
 * ›» se c'è l'esempio. Le viste che non esistono (o non hanno passi) non
 * compaiono. «Vista di analisi» (Lateral Space e sviluppatore, da 768 px)
 * mostra il grafo; sotto i 768 px si vedono sempre il controllo delle viste e
 * l'elenco della vista scelta, anche da un link con `?analisi=1`.
 *
 * Un giro solo (`loadSolutionMap`): mappe e domande citate insieme.
 */
export default async function SolutionMapPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; caseId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId, caseId } = await params;
  const { session, access } = await requireWorkspacePage(workspaceId);
  const { executor, viewer } = await openCaseView({ workspaceId, caseId, session, access, page: "mappa" });
  const data = await loadSolutionMap(executor, viewer);
  if (!data) notFound();

  const sp = await searchParams;
  const { maps } = data;
  const audience = audienceFor(viewer.roles);
  const views = mapPageViews(maps);
  const view = resolveMapPageView(first(sp.vista), views);
  const base = casePath(workspaceId, caseId, "soluzione/mappa");
  const canAnalyze = isLsViewer(viewer.roles) && maps.solution !== null && maps.solution.nodes.length > 0;
  const analysis = canAnalyze && first(sp.analisi) === "1" && view !== "esempio";
  const solutionSteps = maps.solution ? flowOrder(maps.solution.nodes, maps.solution.edges) : [];
  const titles = mapItemTitles(maps);
  const layout = analysis && maps.solution ? layoutGraph(maps.solution.nodes, maps.solution.edges) : null;
  const segments = views.filter((v) => v !== "esempio").map((v) => ({ key: v, label: MAP_PAGE_VIEW_LABEL[v as "con-agente" | "oggi"], href: v === "con-agente" ? base : `${base}?vista=${v}` }));

  const list =
    view === "con-agente" ? (
      maps.toBe && hasAgentProcess(maps) ? (
        <ProcessSteps workspaceId={workspaceId} caseId={caseId} steps={maps.toBe.steps} audience={audience} roles={viewer.roles} />
      ) : (
        <SolutionSteps workspaceId={workspaceId} caseId={caseId} nodes={solutionSteps} titles={titles} audience={audience} roles={viewer.roles} />
      )
    ) : view === "oggi" && maps.asIs ? (
      <ProcessSteps workspaceId={workspaceId} caseId={caseId} steps={maps.asIs.steps} audience={audience} roles={viewer.roles} />
    ) : view === "esempio" && maps.example ? (
      <ProcessSteps workspaceId={workspaceId} caseId={caseId} steps={maps.example.steps} audience={audience} roles={viewer.roles} />
    ) : null;

  return (
    <PageContainer size="wide">
      <SolutionNav workspaceId={workspaceId} caseId={caseId} roles={viewer.roles} active="mappa" />
      {view === null ? (
        <EmptyState variant="page" icon={Waypoints} title="Questo caso non ha ancora una mappa." />
      ) : (
        <div className="min-w-0 space-y-5">
          {view === "esempio" ? (
            <div className="space-y-1">
              <Link href={base} className="inline-flex min-h-11 items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground sm:min-h-0">
                <ChevronLeft className="size-4" aria-hidden />
                Torna alla mappa
              </Link>
              <h2 className="text-base font-semibold">Un esempio dall&apos;inizio alla fine</h2>
            </div>
          ) : (
            (segments.length > 1 || canAnalyze) && (
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                {/* Con la vista di analisi accesa il grafo vale per tutte le viste: il controllo resta solo sotto i 768 px, dove si vede l'elenco. */}
                {segments.length > 1 && <SegmentedNav size="sm" ariaLabel="Viste della mappa" active={view} items={segments} className={analysis ? "md:hidden" : undefined} />}
                {canAnalyze && <AnalysisSwitch checked={analysis} className="hidden md:ml-auto md:inline-flex" />}
              </div>
            )
          )}
          <MapLegend audience={audience} />
          {analysis && maps.solution && layout ? (
            <>
              <div className="hidden md:block">
                <GraphBoundary>
                  <SolutionGraph
                    workspaceId={workspaceId}
                    caseId={caseId}
                    map={maps.solution}
                    layout={{ positions: Object.fromEntries(layout.positions), width: layout.width, height: layout.height }}
                    audience={audience}
                    roles={viewer.roles}
                  />
                </GraphBoundary>
              </div>
              <div className="md:hidden">{list}</div>
            </>
          ) : (
            list
          )}
          {view !== "esempio" && maps.example && (
            <Link href={`${base}?vista=esempio`} className="inline-flex min-h-11 items-center gap-0.5 text-sm font-medium hover:underline sm:min-h-0">
              {MAP_EXAMPLE_LINK}
              <ChevronRight className="size-4" aria-hidden />
            </Link>
          )}
        </div>
      )}
    </PageContainer>
  );
}
