import { notFound } from "next/navigation";
import { PageContainer } from "@/components/dashboard/page-container";
import { openCaseView } from "@/components/uc/catalog/case-page";
import { casePath } from "@/components/uc/catalog/paths";
import { KpiListPanel } from "@/components/uc/kpi/kpi-list-panel";
import { KpiPanel } from "@/components/uc/kpi/kpi-panel";
import { CostList } from "@/components/uc/roi/cost-list";
import { HowCalculated } from "@/components/uc/roi/how-calculated";
import { LeverList } from "@/components/uc/roi/lever-list";
import { LeverSwitchesPanel } from "@/components/uc/roi/lever-switches";
import { CostPanel, LeverPanel, type RoiSaveContext } from "@/components/uc/roi/line-panels";
import { MissingData } from "@/components/uc/roi/missing-data";
import { ValueAccount } from "@/components/uc/roi/value-account";
import { DetailSheet } from "@/components/uc/ui/detail-sheet";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { loadCaseSettings } from "@/lib/db/queries/uc-people-view";
import { loadKpiPage, loadValuePage } from "@/lib/db/queries/uc-value";
import { can } from "@/lib/uc/permissions";
import { formatCountIt } from "@/lib/uc/views/format";
import { groupsOpen, kpiPanelHref, pagesOfOpen, parseKpiPanel, parseKpiParams } from "@/lib/uc/views/kpi";
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

/** Il pannello delle leve da accendere e spegnere (`?apri=leve`). */
const LEVERS_PANEL = "leve";

/**
 * Valore (rilascio 10, §3.5; DESIGN §3.8): le tre cifre con le parole comuni («Valore all'anno» il numero grande, lo
 * stesso della scheda dello use case, D10; «Costo di realizzazione» e «Pareggio» in piccolo; «Stima» una volta), le
 * leve e i costi, «Come si calcola» chiusa con «Tutti i KPI» dentro. Nessun pulsante pieno: il responsabile Lateral
 * Space modifica con le matite, che aprono il pannello della riga in modifica, e accende le leve da «Cambia le leve».
 * I pannelli si aprono da `?apri=`: «dati», «leva-…», «nuova-leva-…», «costo-…», «leve», «kpi» (l'elenco dei KPI) e
 * «kpi-<id>» (un KPI). `/valore/kpi` e `/kpi` portano al pannello dei KPI. In pausa, a realizzazione chiusa e in sola
 * lettura le matite non ci sono.
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
  const apri = first(sp.apri);
  const kpiPanel = canOpenPage("kpi", viewer.roles) ? parseKpiPanel(apri) : null;
  const kpiParams = kpiPanel ? { ...parseKpiParams(sp), apri: kpiPanel.kpiId } : null;
  const roles = viewer.roles;
  // Le leve le accende il responsabile Lateral Space (prima in Impostazioni del caso, F-096).
  const leversEditable = roles.includes("ls_lead") && !viewer.readOnly;
  const [data, kpis, settings] = await Promise.all([
    loadValuePage(executor, viewer),
    kpiParams ? loadKpiPage(executor, viewer, kpiParams) : Promise.resolve(null),
    leversEditable && apri === LEVERS_PANEL ? loadCaseSettings(executor, { workspaceId, caseId }) : Promise.resolve(null),
  ]);
  if (!data) notFound();
  const { ctx, roi, view } = data;
  const canEdit = can(roles, "modificare_catalogo") && !viewer.readOnly && ctx.status !== "chiuso" && ctx.status !== "sospeso";
  const canLevers = leversEditable && ctx.status !== "chiuso" && ctx.status !== "sospeso";
  const base = casePath(workspaceId, caseId, "valore");
  const panelHref = (id: string, edit = false) => `${base}?apri=${encodeURIComponent(id)}${edit ? "&modifica=1" : ""}`;
  const kpiHref = canOpenPage("kpi", roles) ? kpiPanelHref(base, {}) : null;
  const questionsHref = canOpenPage("voci", roles) ? casePath(workspaceId, caseId, "domande") : null;
  const panel = valuePanel(apri, view);
  const editing = first(sp.modifica) === "1";
  // Righe e testi grezzi arrivano al client solo a chi modifica (il salvataggio) e a Lateral Space («Dettagli tecnici»).
  const save: RoiSaveContext | null = canEdit
    ? { workspaceId, caseId, costLines: roi.costLines, benefitLines: roi.benefitLines, content: roi.content, fromTemplate: roi.source === "template", seen: roi.seen }
    : null;
  const ls = isLsViewer(roles);

  // Il pannello dei KPI: la vista resta nell'indirizzo solo se l'ha chiesta chi guarda; un gruppo aperto alla volta.
  const kpiState =
    kpis && kpiParams
      ? (() => {
          const open = groupsOpen({ shown: kpis.shown, searching: Boolean(kpis.q), requested: kpiParams.gruppi });
          const opened = open === "tutti" ? null : open;
          return { vista: kpiParams.vista ? kpis.view : null, open, opened, pagine: opened ? pagesOfOpen(kpiParams.pagine, opened) : kpiParams.pagine };
        })()
      : null;
  const keyTitles = kpis ? new Map(kpis.groups.flatMap((g) => g.items.map((k) => [k.key, k.title] as const))) : new Map<string, string>();

  return (
    <PageContainer>
      <div className="max-w-4xl space-y-8">
        <ValueAccount view={view} missingHref={panelHref(VALUE_PANEL.missing)} questionsHref={questionsHref} />
        <LeverList view={view} panelHref={panelHref} canEdit={canEdit} leversHref={canLevers ? panelHref(LEVERS_PANEL) : null} />
        <CostList view={view} panelHref={panelHref} canEdit={canEdit} />
        <HowCalculated how={view.how} kpiHref={kpiHref} kpiTotal={view.kpiTotal} account={view.source !== "vuoto"} />
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
          kpiBase={kpiHref ? base : null}
        />
      )}
      {panel?.kind === "costo" && (
        <CostPanel key={panel.row.id} row={withoutLine(panel.row)} line={ls ? panel.row.line : null} save={save} baseHref={base} editing={editing} roles={roles} />
      )}
      {apri === LEVERS_PANEL && canLevers && settings && <LeverSwitchesPanel workspaceId={workspaceId} caseId={caseId} levers={settings.levers} closeHref={base} />}
      {kpis && kpiState && kpiPanel && !kpiPanel.kpiId && <KpiListPanel data={kpis} valoreBase={base} state={kpiState} ls={ls} />}
      {kpis?.open && kpiState && kpiPanel?.kpiId && (
        <KpiPanel
          kpi={kpis.open}
          workspaceId={workspaceId}
          caseId={caseId}
          roles={roles}
          closeHref={base}
          backHref={kpiPanelHref(base, { vista: kpiState.vista, q: kpis.q, gruppi: kpiState.opened, pagine: kpiState.pagine })}
          keyTitles={keyTitles}
        />
      )}
    </PageContainer>
  );
}
