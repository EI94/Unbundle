import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { PageContainer } from "@/components/dashboard/page-container";
import { openCaseView } from "@/components/uc/catalog/case-page";
import { casePath } from "@/components/uc/catalog/paths";
import { CostList } from "@/components/uc/roi/cost-list";
import { HowCalculated } from "@/components/uc/roi/how-calculated";
import { LeverList } from "@/components/uc/roi/lever-list";
import { CostPanel, LeverPanel, type RoiSaveContext } from "@/components/uc/roi/line-panels";
import { MissingData } from "@/components/uc/roi/missing-data";
import { ValueAccount } from "@/components/uc/roi/value-account";
import { DetailSheet } from "@/components/uc/ui/detail-sheet";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { loadValuePage } from "@/lib/db/queries/uc-value";
import { can } from "@/lib/uc/permissions";
import { formatCountIt } from "@/lib/uc/views/format";
import { canOpenPage } from "@/lib/uc/views/page-access";
import { valuePanel } from "@/lib/uc/views/roi";
import { VALUE_PANEL } from "@/lib/uc/views/roi-edit";
import { audienceFor, isLsViewer } from "@/lib/uc/views/status-groups";

/** La riga per il pannello, senza la riga grezza del conto (arriva a parte, solo a chi serve). */
function withoutLine<T extends { line: unknown }>(row: T): Omit<T, "line"> {
  const { line, ...rest } = row;
  void line;
  return rest;
}

function first(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" ? s : null;
}

/**
 * Valore (DESIGN §3.8): quanto costa e quanto rende, leva per leva. I tre
 * numeri del conto, le leve attive, i costi, «Tutti i KPI» e «Come si calcola».
 * Nessun pulsante pieno: il responsabile Lateral Space modifica con le matite,
 * che aprono il pannello della riga in modifica. I pannelli si aprono da
 * `?apri=` («dati», «leva-…», «nuova-leva-…», «costo-…»). In pausa, a caso
 * chiuso e in sola lettura le matite non ci sono.
 */
export default async function ValuePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; caseId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId, caseId } = await params;
  const sp = await searchParams;
  const { session, access } = await requireWorkspacePage(workspaceId);
  const { executor, viewer } = await openCaseView({ workspaceId, caseId, session, access, page: "roi" });
  const data = await loadValuePage(executor, viewer);
  if (!data) notFound();
  const { ctx, roi, view } = data;
  const roles = viewer.roles;
  const canEdit = can(roles, "modificare_catalogo") && !viewer.readOnly && ctx.status !== "chiuso" && ctx.status !== "sospeso";
  const base = casePath(workspaceId, caseId, "valore");
  const panelHref = (id: string, edit = false) => `${base}?apri=${encodeURIComponent(id)}${edit ? "&modifica=1" : ""}`;
  const kpiHref = canOpenPage("kpi", roles) ? casePath(workspaceId, caseId, "valore/kpi") : null;
  const questionsHref = canOpenPage("voci", roles) ? casePath(workspaceId, caseId, "domande") : null;
  const panel = valuePanel(first(sp.apri), view);
  const editing = first(sp.modifica) === "1";
  // Righe e testi grezzi arrivano al client solo a chi modifica (il salvataggio) e a Lateral Space («Dettagli tecnici»).
  const save: RoiSaveContext | null = canEdit
    ? { workspaceId, caseId, costLines: roi.costLines, benefitLines: roi.benefitLines, content: roi.content, fromTemplate: roi.source === "template", seen: roi.seen }
    : null;
  const ls = isLsViewer(roles);

  return (
    <PageContainer>
      <div className="max-w-4xl space-y-8">
        <p className="text-sm text-muted-foreground">Quanto costa e quanto rende, leva per leva.</p>
        <ValueAccount view={view} missingHref={panelHref(VALUE_PANEL.missing)} questionsHref={questionsHref} />
        <LeverList view={view} panelHref={panelHref} canEdit={canEdit} />
        <CostList view={view} panelHref={panelHref} canEdit={canEdit} />
        {kpiHref && view.kpiTotal > 0 && (
          <Link
            href={kpiHref}
            className="group flex min-h-11 items-center justify-between gap-3 rounded-xl px-4 py-3 ring-1 ring-foreground/10 hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <span className="font-medium">
              Tutti i KPI <span className="font-normal text-muted-foreground tabular-nums">({formatCountIt(view.kpiTotal)})</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        )}
        {view.source !== "vuoto" && <HowCalculated how={view.how} />}
      </div>

      {panel?.kind === "dati" && (
        <DetailSheet title={`Dati che mancano (${formatCountIt(view.missing.total)})`} closeHref={base} description="Servono per calcolare il conto.">
          <MissingData
            missing={view.missing}
            workspaceId={workspaceId}
            caseId={caseId}
            roles={roles}
            audience={audienceFor(roles)}
            panelHref={(id) => panelHref(id)}
            questionsHref={questionsHref}
          />
        </DetailSheet>
      )}
      {panel?.kind === "leva" && (
        <LeverPanel
          key={panel.row.id}
          row={withoutLine(panel.row)}
          line={ls ? panel.row.line : null}
          hasLine={panel.row.line !== null}
          save={save}
          baseHref={base}
          editing={editing}
          roles={roles}
          kpiHref={kpiHref}
        />
      )}
      {panel?.kind === "costo" && (
        <CostPanel key={panel.row.id} row={withoutLine(panel.row)} line={ls ? panel.row.line : null} save={save} baseHref={base} editing={editing} roles={roles} />
      )}
    </PageContainer>
  );
}
