import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Check, ChevronRight } from "lucide-react";
import { PageContainer } from "@/components/dashboard/page-container";
import { casePath, itemPath } from "@/components/uc/catalog/paths";
import { BlockerResolveForm } from "@/components/uc/overview/blocker-resolve-form";
import { ApprovedNote, BlockersSummary, CaseSummary, MilestoneLine, MilestonesSummary, ModuleProgressList, SignatureCallout, ViaSummary } from "@/components/uc/overview/overview-sections";
import { loadCaseHead } from "@/components/uc/shell/case-data";
import { DetailSheet } from "@/components/uc/ui/detail-sheet";
import { NextStepList } from "@/components/uc/ui/next-step-list";
import { SectionHeading } from "@/components/uc/ui/section-heading";
import { TechDetails } from "@/components/uc/ui/tech-details";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { loadOverview } from "@/lib/db/queries/uc-overview";
import { CASE_STATUS_LABEL } from "@/lib/uc/case-state";
import { exportChoices } from "@/lib/uc/export/request";
import { CASE_STATUS_TONE, canOpenShellPage, landingSegment } from "@/lib/uc/views/case-shell";
import { readableText } from "@/lib/uc/views/description";
import { formatCountIt } from "@/lib/uc/views/format";
import { caseNextSteps, myNextSteps, whoseTurn, type NextStep } from "@/lib/uc/views/next-step";
import { canOpenPage } from "@/lib/uc/views/page-access";
import {
  BLOCKER_PANEL_ITEMS,
  blockerPanelParam,
  blockerResolver,
  developerCatalogText,
  milestoneView,
  moduleProgress,
  nextMilestones,
  noRequiredText,
  overviewBlockerRow,
  overviewBlockers,
  overviewLayout,
  parseOverviewPanel,
  phaseStripOf,
  recentlyApprovedText,
  signatureCalloutText,
  viaEverApproved,
  viaProgress,
  viaProgressHint,
  type OverviewSection,
} from "@/lib/uc/views/progress";

/**
 * Panoramica del dossier (DESIGN §3.4): cosa fare adesso, il via allo
 * sviluppo, le domande indispensabili per argomento, i blocchi, le tappe e il
 * caso in breve, in una colonna `max-w-3xl`. Le sezioni e il loro ordine
 * cambiano per ruolo (`overviewLayout`); il solo pulsante pieno è quello della
 * testata, le righe di «Da fare adesso» sono link.
 *
 * Letture: la testata (`loadCaseHead`, già fatta dal layout nella stessa
 * richiesta) e un solo giro per la pagina (`loadOverview`), anche con il
 * pannello di un blocco aperto (`?apri=blocco:<id>`) o di tutte le tappe
 * (`?apri=tappe`).
 *
 * Chi non vede la Panoramica (l'approvatore privacy) va alla sua pagina d'arrivo.
 */
export default async function OverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; caseId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { workspaceId, caseId } = await params;
  const { session, access } = await requireWorkspacePage(workspaceId);
  const { caseAccess, executor, header } = await loadCaseHead(workspaceId, caseId, session.user.id, access.role);
  const roles = caseAccess.roles;
  if (!canOpenShellPage("panoramica", roles)) {
    const landing = landingSegment(roles);
    if (landing) redirect(casePath(workspaceId, caseId, landing));
    notFound();
  }

  const now = new Date();
  const layout = overviewLayout(roles);
  const c = header.case;
  const base = casePath(workspaceId, caseId);
  // In pausa e a caso chiuso i controlli di scrittura non ci sono; in sola lettura nemmeno.
  const writable = !caseAccess.readOnly && c.status !== "chiuso";
  const signable = writable && c.status !== "sospeso";
  const isLead = roles.includes("ls_lead");
  const panel = parseOverviewPanel((await searchParams).apri);
  const blockerPanel = panel?.kind === "blocco" && layout.sections.includes("blocchi") ? panel.blockerId : null;

  const data = await loadOverview(executor, {
    workspaceId,
    caseId,
    now,
    blockerId: blockerPanel,
    blockerQuestions: BLOCKER_PANEL_ITEMS,
    withFiles: blockerPanel !== null && isLead && signable,
    audience: layout.audience,
  });
  if (!data) notFound();

  // I testi del caso e dello schema come li legge chi guarda: al cliente niente articoli, sigle, chiavi né codici (DESIGN §6.2).
  const text = (t: string) => readableText(t, layout.audience);
  const textOrNull = (t: string | null) => (t ? text(t) || null : null);

  // Il prossimo passo: le stesse regole della testata (un passo si mostra solo se chi guarda lo può fare).
  const exportable = exportChoices(roles, c.catalogVersion);
  const usable = (s: NextStep) => s.owner !== "me" || (s.id === "scarica_catalogo" ? exportable.validated || exportable.draft : writable);
  const steps = caseNextSteps(header.nextStep, { roles }).filter(usable);
  const turn = whoseTurn(steps, header.nextStep);
  const signatures = signable ? header.signatures.length : 0;
  const listSteps = layout.kind === "cliente" && signatures > 0 ? steps.filter((s) => s.id !== "firma") : steps;

  const progress = viaProgress(data.required, layout.audience);
  const questionsHref = canOpenPage("voci", roles) ? casePath(workspaceId, caseId, "domande") : null;
  const viaHref = canOpenShellPage("via", roles) ? casePath(workspaceId, caseId, "via") : null;
  // Il catalogo validato resta anche a caso chiuso dopo il via: la riga dello sviluppatore lo dice.
  const catalogValidated = viaEverApproved({ status: c.status, statusBeforeSuspension: c.statusBeforeSuspension, catalogVersion: c.catalogVersion });
  const blockers = layout.sections.includes("blocchi") ? overviewBlockers(data.blockers).map((b) => ({ ...b, href: `${base}?apri=${blockerPanelParam(b.id)}` })) : [];
  const milestones = data.milestones.map((m) => milestoneView({ ...m, title: text(m.title), plannedLabel: textOrNull(m.plannedLabel) }, now));
  const phases = data.phases.map((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, text(v)]).filter(([, v]) => v !== "")) as typeof p);
  const strip = phaseStripOf(c.status, c.statusBeforeSuspension);
  const approvedNote = recentlyApprovedText({ status: c.status, statusBeforeSuspension: c.statusBeforeSuspension, catalog: header.nextStep.catalog, now });
  const callout = layout.sections.includes("firma") ? signatureCalloutText(signatures) : null;

  const section = (key: OverviewSection) => {
    switch (key) {
      case "firma":
        return callout ? <SignatureCallout key={key} text={callout} href={casePath(workspaceId, caseId, "firme")} /> : null;
      case "fare": {
        const mine = myNextSteps(listSteps).length > 0;
        if (!mine && !turn) return null;
        return (
          <section key={key} aria-labelledby={mine ? "uc-overview-next" : undefined} className="min-w-0 space-y-3">
            {mine && <SectionHeading id="uc-overview-next" title="Da fare adesso" />}
            <NextStepList steps={listSteps} whoseTurn={turn} base={base} />
          </section>
        );
      }
      case "via":
        return (
          <ViaSummary
            key={key}
            progress={progress}
            audience={layout.audience}
            detailsHref={viaHref}
            questionsHref={questionsHref}
            showGroups={layout.kind === "ls" || layout.kind === "cliente"}
            hint={layout.kind === "sviluppatore" ? null : viaProgressHint(c.status)}
            note={layout.kind === "sviluppatore" ? developerCatalogText({ pastVia: catalogValidated, catalog: header.nextStep.catalog, now }) : null}
            emptyText={noRequiredText(layout.audience)}
          />
        );
      case "argomenti":
        return (
          <ModuleProgressList
            key={key}
            rows={moduleProgress(data.required, data.modules, { roleLabels: data.roleLabels }).map((r) => ({ ...r, title: text(r.title) || r.title }))}
            questionsHref={questionsHref}
            showRole={layout.audience === "ls"}
          />
        );
      case "blocchi":
        return <BlockersSummary key={key} rows={blockers} />;
      case "tappe":
        return (
          <MilestonesSummary
            key={key}
            strip={strip}
            state={c.status === "sospeso" || c.status === "chiuso" ? { tone: CASE_STATUS_TONE[c.status], label: CASE_STATUS_LABEL[c.status] } : null}
            next={nextMilestones(milestones)}
            allHref={milestones.length > 0 || phases.length > 0 ? `${base}?apri=tappe` : null}
          />
        );
      case "caso":
        return <CaseSummary key={key} inBreve={textOrNull(data.inBreve)} descriptionHref={canOpenShellPage("descrizione", roles) ? casePath(workspaceId, caseId, "soluzione") : null} />;
    }
  };

  // Il pannello si apre solo per un blocco attivo, mai per quello dei dati sanitari.
  const openBlocker = data.blocker && data.blocker.status === "attivo" && data.blocker.key !== "sanitario" ? data.blocker : null;
  const openBlockerRow = openBlocker ? overviewBlockerRow(openBlocker) : null;

  return (
    <PageContainer>
      <div className="max-w-3xl space-y-10">
        {approvedNote && <ApprovedNote text={approvedNote} />}
        {layout.sections.map(section)}
      </div>

      {openBlocker && openBlockerRow && (
        <DetailSheet title={openBlockerRow.label} status={{ tone: "lucchetto", label: "Attivo" }} description={openBlockerRow.fullLabel} closeHref={base}>
          <div className="space-y-1 text-sm">
            <p className="text-muted-foreground">Chi lo scioglie</p>
            <p>{blockerResolver(openBlocker.key)}</p>
          </div>
          {openBlocker.questions.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {openBlocker.items === 1 ? "1 domanda collegata" : `${formatCountIt(openBlocker.items)} domande collegate`}
              </p>
              <ul className="divide-y overflow-hidden rounded-xl ring-1 ring-foreground/10">
                {openBlocker.questions.map((q) => (
                  <li key={q.id}>
                    {questionsHref ? (
                      <Link href={itemPath(workspaceId, caseId, q.id)} className="flex min-h-11 items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50">
                        <span className="min-w-0 flex-1 break-words">{text(q.title) || q.title}</span>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      </Link>
                    ) : (
                      <p className="px-3 py-2 text-sm break-words">{text(q.title) || q.title}</p>
                    )}
                  </li>
                ))}
              </ul>
              {questionsHref && openBlocker.items > openBlocker.questions.length && (
                <Link href={`${questionsHref}?vista=bloccate&blocco=${openBlocker.id}`} className="inline-flex min-h-11 items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground sm:min-h-0">
                  Vedi tutte
                  <ChevronRight className="size-3.5" aria-hidden />
                </Link>
              )}
            </div>
          )}
          {openBlocker.key === "a8" && canOpenShellPage("privacy", roles) && (
            <Link href={casePath(workspaceId, caseId, "privacy")} className="inline-flex min-h-11 items-center gap-0.5 text-sm font-medium hover:underline sm:min-h-0">
              Vai alla scheda privacy
              <ChevronRight className="size-3.5" aria-hidden />
            </Link>
          )}
          {openBlocker.key !== "a8" && isLead && signable && (
            <BlockerResolveForm workspaceId={workspaceId} caseId={caseId} blockerId={openBlocker.id} blockerKey={openBlocker.key} files={data.files} closeHref={base} />
          )}
          <TechDetails roles={roles}>
            <p>{openBlocker.key}</p>
            <p>{openBlocker.label}</p>
          </TechDetails>
        </DetailSheet>
      )}

      {panel?.kind === "tappe" && (
        <DetailSheet title="Tutte le tappe" closeHref={base}>
          {milestones.length > 0 && (
            <ol className="space-y-3">
              {milestones.map((m) => (
                <li key={m.key} className="flex min-w-0 items-start gap-2">
                  {m.done ? <Check className="mt-0.5 size-4 shrink-0 text-uc-verde" aria-label="Fatta" /> : <span className="size-4 shrink-0" aria-hidden />}
                  <MilestoneLine m={m} />
                </li>
              ))}
            </ol>
          )}
          {phases.length > 0 && (
            <div className="space-y-2 border-t pt-4">
              <h3 className="text-sm font-semibold">Fasi</h3>
              <ol className="space-y-3">
                {phases.map((p, i) => (
                  <li key={i} className="min-w-0 text-sm">
                    <p className="font-medium">
                      {p.fase ?? `Fase ${i + 1}`}
                      {p.quando && <span className="font-normal text-muted-foreground"> · {p.quando}</span>}
                    </p>
                    {p.cosa && <p className="break-words whitespace-pre-line">{p.cosa}</p>}
                    {p.uscita && <p className="break-words text-muted-foreground">Si chiude con: {p.uscita}</p>}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </DetailSheet>
      )}
    </PageContainer>
  );
}
