import { casePath } from "@/components/uc/catalog/paths";
import { CatalogExportLinks } from "@/components/uc/export/catalog-export-links";
import { loadCaseHead } from "@/components/uc/shell/case-data";
import { CaseHeader } from "@/components/uc/shell/case-header";
import { CaseUrlPanels, type CaseMenuEntry, type CaseStepView, type CaseTransitionView } from "@/components/uc/shell/case-menu";
import { CaseStickyBar, CaseTabs } from "@/components/uc/shell/case-tabs";
import { SectionUnavailable } from "@/components/uc/shell/section-unavailable";
import { DossierTransitionRetry } from "@/components/uc/shell/transition-retry";
import { SkipLink, UC_CONTENT_ID } from "@/components/uc/ui/skip-link";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { UcAccessError } from "@/lib/db/queries/uc-access";
import { CASE_STATUS_LABEL, isCasePastG1 } from "@/lib/uc/case-state";
import { exportChoices } from "@/lib/uc/export/request";
import { CASE_STATUS_TONE, canOpenShellPage, caseHeadAlert, caseMenuFor, caseTabsFor, caseTrail, showsReadOnlyBadge, transitionHint } from "@/lib/uc/views/case-shell";
import { caseNextSteps, nextStepFor, resolveStepHref, type NextStep } from "@/lib/uc/views/next-step";
import { isLsViewer } from "@/lib/uc/views/status-groups";
import { canManageWorkspaceSettings } from "@/lib/workspace-permissions";

/** Il blocco testata più schede: lo misura `screens.mjs` (≤ 260 px a 1440) e lo guarda la barra fissa. */
const CASE_HEAD_ID = "uc-case-head";

/**
 * Guscio del dossier (DESIGN §3.3): testata, schede, barra fissa, menu «⋯» e
 * pannelli dall'indirizzo, sopra ogni pagina del caso.
 *
 * I dati della testata sono un giro solo (`uc-header.ts`, prontezza in cache;
 * subito dopo un comando, con la cache ancora indietro, dal vivo e un giro in più).
 * Ogni pagina ripete da sé `requireWorkspacePage(` e il controllo del ruolo di
 * caso, perché un layout non si riesegue nelle navigazioni interne. Le azioni
 * dei casi invalidano questo layout (`revalidatePath(…, "layout")`), così la
 * testata resta aggiornata. Senza le tabelle uc ogni pagina mostra «Sezione
 * non disponibile», come la lista.
 */
export default async function CaseLayout({ children, params }: { children: React.ReactNode; params: Promise<{ workspaceId: string; caseId: string }> }) {
  const { workspaceId, caseId } = await params;
  const { session, access } = await requireWorkspacePage(workspaceId);
  let head: Awaited<ReturnType<typeof loadCaseHead>>;
  try {
    head = await loadCaseHead(workspaceId, caseId, session.user.id, access.role);
  } catch (error) {
    if (error instanceof UcAccessError && error.code === "non_disponibile") return <SectionUnavailable />;
    throw error;
  }
  const { caseAccess, header } = head;
  const roles = caseAccess.roles;
  const c = header.case;
  const base = casePath(workspaceId, caseId);
  const at = (segment: string) => `${base}/${segment}`;

  // In pausa, a caso chiuso e in sola lettura i controlli di scrittura non ci sono.
  const writable = !caseAccess.readOnly && c.status !== "chiuso";
  // In pausa si riprende soltanto: niente firme dal menu.
  const signable = writable && c.status !== "sospeso";
  const exportable = exportChoices(roles, c.catalogVersion);
  const canExport = exportable.validated || exportable.draft;
  const steps = caseNextSteps(header.nextStep, { roles });
  const usable = (s: NextStep) => (s.id === "scarica_catalogo" ? canExport : writable);
  const next = nextStepFor(steps);
  const primary = next && usable(next) ? next : null;
  const stepView: CaseStepView | null = primary
    ? {
        label: primary.label,
        href: resolveStepHref(base, primary.href),
        caseBase: base,
        panel: primary.transition ? { name: "conferma", value: primary.transition } : primary.id === "scarica_catalogo" ? { name: "esporta", value: "1" } : undefined,
      }
    : null;
  const transitionStep = steps.find((s) => s.owner === "me" && s.transition && usable(s));
  const transition: CaseTransitionView | null =
    transitionStep?.transition !== undefined
      ? {
          to: transitionStep.transition,
          label: transitionStep.label,
          hint: transitionHint(c.status, transitionStep.transition) || transitionStep.detail || "",
          statusLabel: CASE_STATUS_LABEL[transitionStep.transition],
        }
      : null;

  const menu: CaseMenuEntry[] = caseMenuFor(roles, {
    pendingSignatures: signable ? header.signatures.length : 0,
    pastVia: isCasePastG1(c.status, c.statusBeforeSuspension),
    exportable: canExport,
  }).map((m) => ({ key: m.key, label: m.label, href: m.segment === null ? null : at(m.segment) }));

  const workspaceAdmin = canManageWorkspaceSettings(access.role);
  const canOpenVia = canOpenShellPage("via", roles);
  const alert = caseHeadAlert({ status: c.status, gateReconfirm: header.readiness?.gate_reconfirm === true, lsConfigured: caseAccess.lsConfigured, workspaceAdmin, canOpenVia });
  const tabs = caseTabsFor(roles);
  const status = { tone: CASE_STATUS_TONE[c.status], label: CASE_STATUS_LABEL[c.status] };
  const ls = isLsViewer(roles);

  return (
    <div data-uc-case-root="" className="flex min-w-0 flex-1 flex-col">
      <SkipLink />
      <div id={CASE_HEAD_ID} data-uc-case-head="" className="border-b border-border">
        <div className={`mx-auto w-full max-w-6xl min-w-0 px-4 sm:px-6 lg:px-8 ${tabs.length === 0 ? "pb-4" : ""}`}>
          <CaseHeader
            trail={caseTrail({ workspaceId, caseBase: base, parent: header.parent })}
            overviewLinkable={canOpenShellPage("panoramica", roles)}
            title={c.title}
            oneLiner={c.oneLiner}
            status={status}
            readOnlyBadge={showsReadOnlyBadge({ lsConfigured: caseAccess.lsConfigured, workspaceAdmin })}
            alert={alert ? { ...alert, href: alert.action ? at(alert.action.segment) : null } : null}
            progress={header.progress ? { ...header.progress, href: canOpenVia ? at("via") : null, audience: ls ? "ls" : "cliente" } : null}
            step={stepView}
            menu={menu}
          />
          <CaseTabs basePath={base} tabs={tabs} />
        </div>
      </div>
      <CaseStickyBar basePath={base} tabs={tabs} headId={CASE_HEAD_ID} title={c.title} status={status} progress={header.progress} step={stepView} />
      <CaseUrlPanels
        workspaceId={workspaceId}
        caseId={caseId}
        transition={writable ? transition : null}
        exportPanel={
          canExport
            ? {
                title: ls ? "Esporta il catalogo" : "Scarica in Excel",
                note: "Ogni download resta in Attività.",
                content: <CatalogExportLinks workspaceId={workspaceId} caseId={caseId} roles={roles} latestVersion={c.catalogVersion} />,
              }
            : null
        }
      />
      <div id={UC_CONTENT_ID} tabIndex={-1} className="flex min-w-0 flex-1 flex-col outline-none">
        {children}
      </div>
      <DossierTransitionRetry />
    </div>
  );
}
