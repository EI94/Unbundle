import { casePath } from "@/components/uc/catalog/paths";
import { CaseSignaturesPanel } from "@/components/uc/approvals/sign-panel";
import { CatalogExportLinks } from "@/components/uc/export/catalog-export-links";
import { filesToCheckFor, loadCaseHead } from "@/components/uc/shell/case-data";
import { CaseHeader } from "@/components/uc/shell/case-header";
import { CaseUrlPanels, type CaseMenuEntry, type CaseStepView, type CaseTransitionView } from "@/components/uc/shell/case-menu";
import { CaseStickyBar, CaseTabs } from "@/components/uc/shell/case-tabs";
import { SectionUnavailable } from "@/components/uc/shell/section-unavailable";
import { DossierTransitionRetry } from "@/components/uc/shell/transition-retry";
import { LateralSpaceViewerProvider } from "@/components/uc/shell/viewer-context";
import { SkipLink, UC_CONTENT_ID } from "@/components/uc/ui/skip-link";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { UcAccessError } from "@/lib/db/queries/uc-access";
import { CASE_STATUS_LABEL } from "@/lib/uc/case-state";
import { exportChoices } from "@/lib/uc/export/request";
import { ucLog } from "@/lib/uc/log";
import {
  CASE_STATUS_TONE,
  canOpenShellPage,
  caseHeadAlert,
  caseMenuFor,
  caseTabsFor,
  caseTrail,
  realizationTitle,
  showsHeaderProgress,
  stepHasPageCommand,
  stepPanelOf,
  transitionHint,
} from "@/lib/uc/views/case-shell";
import { NEXT_STEP_ICON, caseNextSteps, nextStepFor, resolveStepHref, type NextStep } from "@/lib/uc/views/next-step";
import { isLsViewer } from "@/lib/uc/views/status-groups";
import { canManageWorkspaceSettings } from "@/lib/workspace-permissions";

/** Il blocco testata più schede: lo misura `screens.mjs` (≤ 260 px a 1440) e lo guarda la barra fissa. */
const CASE_HEAD_ID = "uc-case-head";

/**
 * Guscio del dossier (DESIGN §3.3; rilascio 10, §3.5): testata, schede, barra
 * fissa, menu «⋯» e pannelli dall'indirizzo, sopra ogni pagina del caso.
 *
 * I dati della testata sono un giro solo (`uc-header.ts`, prontezza in cache;
 * subito dopo un comando, con la cache ancora indietro, dal vivo e un giro in più),
 * con il conteggio dei PDF da controllare a mano (il passo «Controlla N file»,
 * `filesToCheckFor`). Ogni pagina ripete da sé
 * `requireWorkspacePage(` e il controllo del ruolo di caso, perché un layout non
 * si riesegue nelle navigazioni interne. Le azioni dei casi invalidano questo
 * layout (`revalidatePath(…, "layout")`), così la testata resta aggiornata.
 * Senza le tabelle uc ogni pagina mostra «Questa pagina non si è caricata.»
 * (`SectionUnavailable`). Con la configurazione di Lateral Space incompleta la
 * realizzazione è in sola lettura: lo dice il log, e l'avviso della testata a
 * chi gestisce il workspace (F-005, fino all'ondata 6b).
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
  if (!caseAccess.lsConfigured) ucLog({ level: "warn", area: "uc", op: "configurazione_da_completare", code: "domini_ls_mancanti", workspaceId, caseId });

  // In pausa, a caso chiuso e in sola lettura i controlli di scrittura non ci sono.
  const writable = !caseAccess.readOnly && c.status !== "chiuso";
  const exportable = exportChoices(roles, c.catalogVersion);
  const canExport = exportable.validated || exportable.draft;
  const steps = caseNextSteps({ ...header.nextStep, filesToCheck: filesToCheckFor(caseAccess, header) }, { roles });
  const usable = (s: NextStep) => (s.id === "scarica_catalogo" ? canExport : writable);
  const next = nextStepFor(steps);
  const primary = next && usable(next) ? next : null;
  const stepView: CaseStepView | null = primary
    ? {
        label: primary.label,
        href: resolveStepHref(base, primary.href),
        caseBase: base,
        // Un pannello: il dialogo di conferma, «Esporta…», o (rilascio 10, §3.5) il pannello «File» di Domande, che lì resta.
        panel: stepPanelOf(primary),
        // (Rilascio 10, §7.4) L'icona e il «?» come il passo dello use case.
        icon: NEXT_STEP_ICON[primary.id],
        why: primary.detail,
        // (Rilascio 10, §3.5) «Proponi il via» e «Manda il link» si fanno nella sezione «Via allo sviluppo»: lì il pulsante pieno è suo.
        pageCommand: stepHasPageCommand(primary.id),
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

  const menu: CaseMenuEntry[] = caseMenuFor(roles, { exportable: canExport }).map((m) => ({ key: m.key, label: m.label, href: m.segment === null ? null : at(m.segment) }));

  // (Rilascio 10, §3.5) Un segnale per stato: l'avviso non c'è quando il pulsante pieno dice già la stessa cosa.
  // La configurazione incompleta (F-005): nel log e, fino all'ondata 6b, un avviso solo per chi gestisce il workspace.
  const alert = caseHeadAlert({
    status: c.status,
    gateReconfirm: header.readiness?.gate_reconfirm === true,
    canOpenVia: canOpenShellPage("via", roles),
    primary: primary?.id ?? null,
    lsConfigured: caseAccess.lsConfigured,
    workspaceAdmin: canManageWorkspaceSettings(access.role),
  });
  const tabs = caseTabsFor(roles);
  const status = { tone: CASE_STATUS_TONE[c.status], label: CASE_STATUS_LABEL[c.status] };
  const ls = isLsViewer(roles);
  // (Rilascio 10, §3.5) Il titolo è sempre quello dello use case, in testata e nella barra fissa.
  const title = realizationTitle({ caseTitle: c.title, parent: header.parent });

  return (
    <div data-uc-case-root="" className="flex min-w-0 flex-1 flex-col">
      <SkipLink />
      <div id={CASE_HEAD_ID} data-uc-case-head="" className="border-b border-border">
        <div className={`mx-auto w-full max-w-6xl min-w-0 px-4 sm:px-6 lg:px-8 ${tabs.length === 0 ? "pb-4" : ""}`}>
          <CaseHeader
            trail={caseTrail({ workspaceId, caseBase: base, parent: header.parent })}
            title={title}
            status={status}
            alert={alert ? { ...alert, action: alert.action ? { label: alert.action.label, href: resolveStepHref(base, alert.action.href) } : null } : null}
            progress={header.progress && showsHeaderProgress(roles) ? { ...header.progress, audience: ls ? "ls" : "cliente" } : null}
            step={stepView}
            menu={menu}
          />
          <CaseTabs basePath={base} tabs={tabs} />
        </div>
      </div>
      <CaseStickyBar basePath={base} tabs={tabs} headId={CASE_HEAD_ID} title={title} status={status} progress={header.progress} step={stepView} />
      {/* (Rilascio 10, §3.5) Il pannello delle firme (`?firma=1`): su ogni pagina della realizzazione, così il passo «Firma»
          e `/firme` lo aprono dove si è. */}
      <CaseSignaturesPanel workspaceId={workspaceId} caseId={caseId} roles={roles} status={c.status} readOnly={caseAccess.readOnly} />
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
        {/* (Ondata 0) Anche per la pagina d'errore del caso: il codice dell'errore solo a Lateral Space. */}
        <LateralSpaceViewerProvider value={ls}>{children}</LateralSpaceViewerProvider>
      </div>
      <DossierTransitionRetry />
    </div>
  );
}
