import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, Check, ChevronRight, Lock } from "lucide-react";
import { PageContainer } from "@/components/dashboard/page-container";
import { Fold } from "@/components/ui-10/fold";
import { casePath, itemPath } from "@/components/uc/catalog/paths";
import { BlockerResolveForm } from "@/components/uc/overview/blocker-resolve-form";
import {
  BlockerList,
  MilestoneLine,
  NextMilestone,
  OverviewTodo,
  SectionTitle,
  TopicList,
  ViaConditions,
  ViaGroupLinks,
  ViaNumber,
  ViaState,
  ViaStatusLine,
  type TodoRow,
} from "@/components/uc/overview/overview-sections";
import { GatePanel, ViaWithdraw } from "@/components/uc/progress/gate-panel";
import { CasePhases, CoverageCard, ViaHistory } from "@/components/uc/progress/progress-sections";
import { filesToCheckFor, loadCaseHead, ucEmailConfigured } from "@/components/uc/shell/case-data";
import { DetailSheet } from "@/components/uc/ui/detail-sheet";
import { TechDetails } from "@/components/uc/ui/tech-details";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { loadOverviewWithVia } from "@/lib/db/queries/uc-overview";
import { exportChoices } from "@/lib/uc/export/request";
import { VIA_SECTION_ID, canOpenShellPage, landingSegment, stepHasPageCommand, stepHiddenOn, stepPanelOf } from "@/lib/uc/views/case-shell";
import { readableText } from "@/lib/uc/views/description";
import { FILES_HREF, NEXT_STEP_ICON, SIGN_HREF, caseNextSteps, nextStepFor, overviewTodo, resolveStepHref, stepFact, turnRow, type NextStep } from "@/lib/uc/views/next-step";
import { canOpenPage, seesValidatedOnly } from "@/lib/uc/views/page-access";
import {
  BLOCKER_PANEL_ITEMS,
  OVERVIEW_SIDE_SECTIONS,
  OVERVIEW_TEXT as T,
  VIA_EVIDENCE_MISSING,
  VIA_POLICY_TEXT,
  VIA_RULE_TO_CONFIRM,
  blockerPanelParam,
  blockerResolver,
  casePhaseGroups,
  catalogVersionRow,
  coverageText,
  exceptionsText,
  isPastVia,
  latestApproval,
  milestoneView,
  moduleProgress,
  nextMilestoneText,
  nextMilestones,
  noRequiredText,
  overviewBlockerRow,
  overviewBlockers,
  overviewLayout,
  parseOverviewPanel,
  reviewHistoryRow,
  topTopics,
  viaAction,
  viaConditions,
  viaEverApproved,
  viaGroupLinks,
  viaHowText,
  viaOpenConditions,
  viaProgress,
  viaProposeWhen,
  viaShownSignatures,
  viaSignatures,
  viaSignaturesLine,
  viaState,
  viaStateView,
  type OverviewSection,
  type ViaConditionView,
} from "@/lib/uc/views/progress";
import { isLsViewer } from "@/lib/uc/views/status-groups";

/**
 * Panoramica della realizzazione (rilascio 10, docs/ui-10/PROPOSTA-10.md
 * §3.5, prototipo S4): tre blocchi più gli argomenti. A sinistra «Da fare»
 * (al massimo 3 righe, mai il pulsante pieno di nuovo) e «Via allo sviluppo»
 * (il numero grande, i gruppi come link, le condizioni ancora aperte, le firme
 * in una riga, i comandi del via, «Storico» e «Diagnostica» chiusi, «Come
 * funziona» nel «?»: assorbe la vecchia `/via`, all'ancora `#via`); a destra
 * «Prossima tappa», «Per argomento» e i blocchi. Al telefono una colonna.
 *
 * Un solo pulsante pieno: quello della testata, oppure il comando della
 * sezione «Via allo sviluppo» quando il passo si fa lì (la testata allora lo
 * nasconde, `stepHasPageCommand`).
 *
 * Letture: due giri. La testata (`loadCaseHead`, già fatta dal layout nella
 * stessa richiesta, con il conteggio dei PDF da controllare), poi un batch solo
 * (`loadOverviewWithVia`) con la Panoramica (anche con il pannello di un blocco
 * `?apri=blocco:<id>` o di tutte le tappe `?apri=tappe`) e il via (prontezza dal
 * vivo, proposte, versioni). (Ondata 5b) Gli accessi di Claude stanno in
 * Costruzione › «Per il coding agent».
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
  const ls = isLsViewer(roles);
  const isLead = roles.includes("ls_lead");
  const isOwner = roles.includes("owner_cliente");
  // In pausa e a caso chiuso i controlli di scrittura non ci sono; in sola lettura nemmeno.
  const writable = !caseAccess.readOnly && c.status !== "chiuso";
  const signable = writable && c.status !== "sospeso";
  const pastVia = isPastVia(c.status, c.statusBeforeSuspension);
  const panel = parseOverviewPanel((await searchParams).apri);
  const blockerPanel = panel?.kind === "blocco" && layout.sections.includes("blocchi") ? panel.blockerId : null;

  // Un giro solo: Panoramica e via nello stesso batch.
  const read = await loadOverviewWithVia(executor, {
    overview: { workspaceId, caseId, now, blockerId: blockerPanel, blockerQuestions: BLOCKER_PANEL_ITEMS, withFiles: blockerPanel !== null && isLead && signable, audience: layout.audience },
    via: { workspaceId, caseId, now, withFiles: signable && (isLead || isOwner) },
  });
  const { overview: data, via } = read;
  if (!data || !via) notFound();
  const filesToCheck = filesToCheckFor(caseAccess, header);

  // I testi del caso e dello schema come li legge chi guarda: al cliente niente articoli, sigle, chiavi né codici (DESIGN §6.2).
  const text = (t: string) => readableText(t, layout.audience);
  const textOrNull = (t: string | null) => (t ? text(t) || null : null);
  const questionsHref = canOpenPage("voci", roles) ? casePath(workspaceId, caseId, "domande") : null;

  // ── Il prossimo passo: le stesse regole della testata (un passo si mostra solo se chi guarda lo può fare). ──
  const exportable = exportChoices(roles, c.catalogVersion);
  const canExport = exportable.validated || exportable.draft;
  const usable = (s: NextStep) => s.owner !== "me" || (s.id === "scarica_catalogo" ? canExport : writable);
  const stepInput = { ...header.nextStep, filesToCheck };
  const allSteps = caseNextSteps(stepInput, { roles });
  const first = nextStepFor(allSteps);
  const primary = first && usable(first) ? first : null;
  const steps = allSteps.filter(usable);
  // Il pulsante della testata si vede qui? Se no, il comando della sezione «Via allo sviluppo» è il pulsante pieno.
  const headerPrimary = primary
    ? !stepHiddenOn({ href: resolveStepHref(base, primary.href), caseBase: base, panel: stepPanelOf(primary) !== undefined, pageCommand: stepHasPageCommand(primary.id) }, base)
    : false;
  const todo = overviewTodo(steps, primary, turnRow(steps, stepInput, { roles }));
  const todoRows: TodoRow[] = todo.steps.map((s) => ({ key: s.id, label: s.label, fact: stepFact(s), href: resolveStepHref(base, s.href), icon: NEXT_STEP_ICON[s.id], samePage: s.href.startsWith("?") }));

  // ── Via allo sviluppo ──
  const g1 = via.g1;
  const progress = viaProgress(data.required, layout.audience);
  const contractCase = via.core.contractRefs.length > 0;
  const approved = latestApproval(via.reviews);
  // Da riconfermare come nella prontezza: oltre il via, ma il via non è più pronto (calcolo dal vivo).
  const reconfirm = pastVia && !g1.ready;
  const everApproved = approved !== null || viaEverApproved({ status: c.status, statusBeforeSuspension: c.statusBeforeSuspension, catalogVersion: c.catalogVersion });
  const state = viaState({ status: c.status, statusBeforeSuspension: c.statusBeforeSuspension, gateReconfirm: reconfirm, ready: g1.ready, pending: via.pending !== null, approved: everApproved });
  const stateView = viaStateView(state, approved?.at ?? null, now);
  // Caso a contratto con la proposta aperta senza la prova scritta: l'approvazione la aspetta.
  const evidenceMissing = contractCase && via.pending !== null && !via.pending.writtenEvidence;
  const action = viaAction({
    roles,
    signable,
    status: c.status,
    statusBeforeSuspension: c.statusBeforeSuspension,
    ready: g1.ready,
    required: g1.required,
    ok: g1.ok,
    pending: via.pending,
    evidenceMissing,
    reconfirm,
    // Il link per firmare parte solo per email: senza servizio il responsabile del cliente firma dal suo account.
    canSendLink: isLead && via.core.designated.owner !== null && ucEmailConfigured(),
    approved,
    now,
  });
  // La riga dello stato: quando si propone, le firme della proposta aperta, oppure «Approvato il 3 ott · catalogo v1».
  const statusLine =
    state === "in_attesa_firme"
      ? viaSignaturesLine(viaSignatures(viaShownSignatures(via.pending, via.reviews), now))
      : state === "approvato" || state === "da_riconfermare"
        ? action.kind === "nessuna"
          ? action.note
          : null
        : c.status === "chiuso"
          ? null
          : (viaProposeWhen({ status: c.status, ready: g1.ready, required: g1.required, ok: g1.ok }) ?? (g1.ready ? T.allReady : null));
  const conditions = state === "approvato" || c.status === "chiuso" ? [] : viaOpenConditions(viaConditions(g1.conditions, { required: g1.required, ok: g1.ok, waivers: g1.waivers, audience: layout.audience }).open);
  const conditionHref = (cond: ViaConditionView): string | null => {
    if (!cond.segment) return null;
    // (Ondata 5b) Le regole sono il pannello «Regole» della Soluzione (`soluzione?apri=regole`).
    const page = cond.segment.startsWith("domande") ? "voci" : cond.segment.startsWith("soluzione?apri=regole") ? "regole" : null;
    if (page && !canOpenPage(page, roles)) return null;
    // (Rilascio 10, §3.5) I file stanno nel pannello «File» di Domande.
    return cond.segment === "domande/documenti" ? resolveStepHref(base, FILES_HREF) : casePath(workspaceId, caseId, cond.segment);
  };
  // Il via si firma nel pannello delle firme (`?firma=1`, nel guscio). Se la testata mostra già «Firma il via allo sviluppo», la sezione non lo ripete.
  const headerSignsVia = headerPrimary && primary?.id === "firma" && header.nextStep.mySignaturesPending.length === 1 && header.nextStep.mySignaturesPending[0].kind === "via";
  const signHref = headerSignsVia ? null : resolveStepHref(base, SIGN_HREF);
  const history = via.reviews.map((r) => reviewHistoryRow(r, now));
  const versions = via.versions.map((v) => ({ key: String(v.version), ...catalogVersionRow(v, now) }));
  // Le risposte da verificare stanno già nel pulsante pieno «Verifica N risposte»: il gruppo non si ripete.
  const groupLinks =
    layout.kind === "ls" || layout.kind === "cliente" ? viaGroupLinks(progress, layout.audience, { skip: primary?.id === "verifica" && headerPrimary ? ["da_verificare"] : [] }) : [];

  // ── Tappe, argomenti, blocchi ──
  const milestones = data.milestones.map((m) => milestoneView({ ...m, title: text(m.title), plannedLabel: textOrNull(m.plannedLabel) }, now));
  const phases = data.phases.map((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, text(v)]).filter(([, v]) => v !== "")) as typeof p);
  const nextMilestone = nextMilestones(milestones, 1)[0] ?? null;
  const topics = moduleProgress(data.required, data.modules).map((r) => ({ ...r, title: text(r.title) || r.title }));
  const blockers = layout.sections.includes("blocchi") ? overviewBlockers(data.blockers).map((b) => ({ ...b, href: `${base}?apri=${blockerPanelParam(b.id)}` })) : [];

  const section = (key: OverviewSection) => {
    switch (key) {
      case "fare":
        return <OverviewTodo key={key} rows={todoRows} turn={todo.turn} />;
      case "via":
        return (
          <section key={key} id={VIA_SECTION_ID} aria-labelledby="uc-overview-via" className="min-w-0 scroll-mt-40 space-y-3">
            <SectionTitle id="uc-overview-via" title={T.via}>
              {state !== "non_ancora" && <ViaState tone={stateView.tone} label={stateView.label} />}
              {isLead && signable && via.pending && <ViaWithdraw workspaceId={workspaceId} caseId={caseId} reviewId={via.pending.id} />}
            </SectionTitle>
            <ViaNumber ok={progress.ok} required={progress.required} inReview={progress.inReview} audience={layout.audience} emptyText={noRequiredText(layout.audience)} />
            <ViaGroupLinks links={groupLinks} questionsHref={questionsHref} />
            {statusLine && <ViaStatusLine text={statusLine} how={viaHowText(via.core.policy.scope)} />}
            {evidenceMissing && <p className="text-sm text-muted-foreground">{VIA_EVIDENCE_MISSING}</p>}
            {ls && contractCase && !via.core.policy.confirmed && (
              <p role="status" className="flex items-start gap-2 rounded-lg bg-uc-giallo-bg px-3 py-2 text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-uc-giallo" aria-hidden />
                <span className="min-w-0">{VIA_RULE_TO_CONFIRM}</span>
              </p>
            )}
            <ViaConditions rows={conditions} hrefFor={conditionHref} />
            <GatePanel workspaceId={workspaceId} caseId={caseId} action={action} filled={!headerPrimary} reviewId={via.pending?.id ?? null} contractCase={contractCase} signHref={signHref} files={via.files} />
            {(history.length > 0 || versions.length > 0 || ls) && (
              <div className="pt-1">
                {(history.length > 0 || versions.length > 0) && (
                  <Fold id="storico" title={T.storico}>
                    <ViaHistory reviews={history} versions={versions} />
                  </Fold>
                )}
                {ls && (
                  <Fold
                    id="diagnostica"
                    title={T.diagnostica}
                    marker={
                      <>
                        <Lock className="size-3.5 text-uc-lucchetto" aria-hidden />
                        <span className="sr-only">{T.lsOnly}</span>
                      </>
                    }
                  >
                    <CoverageCard
                      text={coverageText(via.coverage)}
                      policy={VIA_POLICY_TEXT[via.core.policy.scope]}
                      exceptions={exceptionsText({ waivers: g1.waivers, should: g1.should })}
                      // Le chiavi degli elementi non coperti sono del catalogo intero: lo sviluppatore, che vede solo le voci validate, non le legge.
                      uncovered={canOpenPage("voci", roles) && !seesValidatedOnly(roles) ? via.coverage.uncovered : []}
                    />
                  </Fold>
                )}
              </div>
            )}
          </section>
        );
      case "tappe":
        return (
          <NextMilestone
            key={key}
            text={nextMilestone ? nextMilestoneText(nextMilestone) : null}
            // Il pannello ha sempre il percorso della realizzazione, con i suoi stati.
            allHref={`${base}?apri=tappe`}
          />
        );
      case "argomenti":
        return (
          <TopicList
            key={key}
            rows={topTopics(topics)}
            hrefFor={(r) => (questionsHref && r.key ? `${questionsHref}?argomento=${encodeURIComponent(r.key)}` : null)}
            allHref={questionsHref}
            total={topics.length}
          />
        );
      case "blocchi":
        return <BlockerList key={key} rows={blockers} />;
    }
  };

  const main = layout.sections.filter((s) => !OVERVIEW_SIDE_SECTIONS.includes(s));
  const side = layout.sections.filter((s) => OVERVIEW_SIDE_SECTIONS.includes(s));

  // Il pannello si apre solo per un blocco attivo, mai per quello dei dati sanitari.
  const openBlocker = data.blocker && data.blocker.status === "attivo" && data.blocker.key !== "sanitario" ? data.blocker : null;
  const openBlockerRow = openBlocker ? overviewBlockerRow(openBlocker) : null;

  return (
    <PageContainer>
      <div className="grid min-w-0 gap-x-8 gap-y-10 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:items-start">
        <div className="min-w-0 space-y-10">{main.map(section)}</div>
        {side.length > 0 && <div className="min-w-0 space-y-10">{side.map(section)}</div>}
      </div>

      {openBlocker && openBlockerRow && (
        <DetailSheet title={openBlockerRow.label} status={{ tone: "lucchetto", label: T.blockerActive }} description={openBlockerRow.fullLabel} closeHref={base}>
          <div className="space-y-1 text-sm">
            <p className="text-muted-foreground">{T.blockerResolver}</p>
            <p>{blockerResolver(openBlocker.key)}</p>
          </div>
          {openBlocker.questions.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {T.blockerItems(openBlocker.items)}
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
                  {T.blockerAllItems}
                  <ChevronRight className="size-3.5" aria-hidden />
                </Link>
              )}
            </div>
          )}
          {openBlocker.key === "a8" && canOpenShellPage("privacy", roles) && (
            <Link href={casePath(workspaceId, caseId, "privacy")} className="inline-flex min-h-11 items-center gap-0.5 text-sm font-medium hover:underline sm:min-h-0">
              {T.toPrivacySheet}
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
        <DetailSheet title={T.allMilestones} closeHref={base}>
          {milestones.length > 0 && (
            <ol className="space-y-3">
              {milestones.map((m) => (
                <li key={m.key} className="flex min-w-0 items-start gap-2">
                  {m.done ? <Check className="mt-0.5 size-4 shrink-0 text-uc-verde" aria-label={T.milestoneDone} /> : <span className="size-4 shrink-0" aria-hidden />}
                  <MilestoneLine m={m} />
                </li>
              ))}
            </ol>
          )}
          {phases.length > 0 && (
            <div className="space-y-2 border-t pt-4">
              <h3 className="text-sm font-semibold">{T.plan}</h3>
              <ol className="space-y-3">
                {phases.map((p, i) => (
                  <li key={i} className="min-w-0 text-sm">
                    <p className="font-medium">
                      {p.fase ?? T.planStep(i + 1)}
                      {p.quando && <span className="font-normal text-muted-foreground"> · {p.quando}</span>}
                    </p>
                    {p.cosa && <p className="break-words whitespace-pre-line">{p.cosa}</p>}
                    {p.uscita && <p className="break-words text-muted-foreground">{T.closesWith(p.uscita)}</p>}
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div className="space-y-2 border-t pt-4">
            <h3 className="text-sm font-semibold">{T.path}</h3>
            <CasePhases phases={casePhaseGroups(c.status, c.statusBeforeSuspension)} />
          </div>
        </DetailSheet>
      )}
    </PageContainer>
  );
}
