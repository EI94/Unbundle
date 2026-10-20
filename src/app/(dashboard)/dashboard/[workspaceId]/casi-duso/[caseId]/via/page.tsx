import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ChevronLeft } from "lucide-react";
import { PageContainer } from "@/components/dashboard/page-container";
import { casePath } from "@/components/uc/catalog/paths";
import { ClaudeDevPanel } from "@/components/uc/mcp/claude-dev-panel";
import { GatePanel } from "@/components/uc/progress/gate-panel";
import { CoverageCard, Disclosure, HowItWorks, ViaConditionList, ViaHistory, ViaSignatureList } from "@/components/uc/progress/progress-sections";
import { loadCaseHead, ucEmailConfigured } from "@/components/uc/shell/case-data";
import { ProgressToGate } from "@/components/uc/ui/progress-to-gate";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { listCaseReadTokens } from "@/lib/db/queries/uc-mcp";
import { loadVia } from "@/lib/db/queries/uc-overview";
import { exportChoices } from "@/lib/uc/export/request";
import { canOpenShellPage, stepHiddenOn } from "@/lib/uc/views/case-shell";
import { caseNextSteps, nextStepFor, resolveStepHref } from "@/lib/uc/views/next-step";
import { canOpenPage, seesValidatedOnly } from "@/lib/uc/views/page-access";
import {
  VIA_AFTER_TEXT,
  VIA_EVIDENCE_MISSING,
  VIA_EXCEPTIONS,
  VIA_POLICY_TEXT,
  VIA_RULE_TEXT,
  VIA_RULE_TO_CONFIRM,
  VIA_SIGNERS_TEXT,
  casePhaseGroups,
  catalogVersionRow,
  coverageText,
  doneConditionsText,
  exceptionsText,
  isPastVia,
  latestApproval,
  reviewHistoryRow,
  viaAction,
  viaConditions,
  viaEverApproved,
  viaShownSignatures,
  viaSignatures,
  viaState,
  viaStateView,
  type ViaConditionView,
} from "@/lib/uc/views/progress";
import { isLsViewer } from "@/lib/uc/views/status-groups";

/**
 * Via allo sviluppo (DESIGN §3.5): lo stato del via, il numero, cosa serve
 * ancora (le condizioni a posto chiuse), le firme dei due lati, l'azione della
 * pagina per ogni stato della tabella «Primario per stato», poi «Come
 * funziona», «Storico» e, per Lateral Space, «Diagnostica». In fondo, per
 * Lateral Space dopo il via, «Sviluppo con Claude» all'ancora dove porta il
 * menu «⋯» (`via#sviluppo-con-claude`): il componente è di WP6, che lo apre
 * come pannello da quell'ancora.
 *
 * Un solo pulsante pieno: quello della pagina è pieno solo se la testata non
 * ne mostra già uno (sulla pagina in cui porta il suo si nasconde).
 *
 * Letture: la testata (`loadCaseHead`) e un giro per la pagina (`loadVia`,
 * prontezza dal vivo, proposte, versioni del catalogo e i file per la prova
 * scritta quando servono); gli accessi di Claude solo per Lateral Space dopo
 * il via.
 */
export default async function ViaPage({ params }: { params: Promise<{ workspaceId: string; caseId: string }> }) {
  const { workspaceId, caseId } = await params;
  const { session, access } = await requireWorkspacePage(workspaceId);
  const { caseAccess, executor, header } = await loadCaseHead(workspaceId, caseId, session.user.id, access.role);
  const roles = caseAccess.roles;
  if (!canOpenShellPage("via", roles)) notFound();

  const now = new Date();
  const ls = isLsViewer(roles);
  const isLead = roles.includes("ls_lead");
  const isOwner = roles.includes("owner_cliente");
  const c = header.case;
  const writable = !caseAccess.readOnly && c.status !== "chiuso";
  // In pausa si riprende soltanto: firme, rifiuto e link di approvazione non ci sono (DESIGN §3.3), come nel menu e in /firme.
  const signable = writable && c.status !== "sospeso";
  const pastVia = isPastVia(c.status, c.statusBeforeSuspension);

  const [data, tokens] = await Promise.all([
    loadVia(executor, { workspaceId, caseId, now, withFiles: signable && (isLead || isOwner) }),
    ls && pastVia ? listCaseReadTokens(executor, workspaceId, caseId) : Promise.resolve([]),
  ]);
  if (!data) notFound();

  const base = casePath(workspaceId, caseId);
  const here = casePath(workspaceId, caseId, "via");
  const g1 = data.g1;
  const core = data.core;
  const contractCase = core.contractRefs.length > 0;
  const approved = latestApproval(data.reviews);
  // Da riconfermare come nella prontezza: oltre il via, ma il via non è più pronto (calcolo dal vivo).
  const reconfirm = pastVia && !g1.ready;
  // Un caso chiuso dopo il via resta «Approvato»: lo dicono lo storico o il catalogo congelato.
  const everApproved = approved !== null || viaEverApproved({ status: c.status, statusBeforeSuspension: c.statusBeforeSuspension, catalogVersion: c.catalogVersion });
  const state = viaState({ status: c.status, statusBeforeSuspension: c.statusBeforeSuspension, gateReconfirm: reconfirm, ready: g1.ready, pending: data.pending !== null, approved: everApproved });
  const stateView = viaStateView(state, approved?.at ?? null, now);
  const conditions = viaConditions(g1.conditions, { required: g1.required, ok: g1.ok, waivers: g1.waivers, audience: ls ? "ls" : "cliente" });
  // Caso a contratto con la proposta aperta senza la prova scritta: l'approvazione la aspetta.
  const evidenceMissing = contractCase && data.pending !== null && !data.pending.writtenEvidence;
  const conditionHref = (cond: ViaConditionView): string | null => {
    if (!cond.segment) return null;
    const page = cond.segment.startsWith("domande") ? "voci" : cond.segment === "soluzione/regole" ? "regole" : null;
    if (page && !canOpenPage(page, roles)) return null;
    return casePath(workspaceId, caseId, cond.segment);
  };

  const action = viaAction({
    roles,
    signable,
    status: c.status,
    statusBeforeSuspension: c.statusBeforeSuspension,
    ready: g1.ready,
    required: g1.required,
    ok: g1.ok,
    pending: data.pending,
    evidenceMissing,
    reconfirm,
    // Il link per firmare parte solo per email: senza servizio il responsabile del cliente firma dal suo account.
    canSendLink: isLead && core.designated.owner !== null && ucEmailConfigured(),
    approved,
    now,
  });

  // Il primario della testata è visibile qui? Stesse regole del layout: il passo di chi guarda, se lo può fare, salvo sulla pagina in cui porta.
  const exportable = exportChoices(roles, c.catalogVersion);
  const step = nextStepFor(caseNextSteps(header.nextStep, { roles }));
  const stepUsable = step && (step.id === "scarica_catalogo" ? exportable.validated || exportable.draft : writable);
  const headerPrimary = stepUsable ? !stepHiddenOn({ href: resolveStepHref(base, step.href), caseBase: base, panel: Boolean(step.transition) || step.id === "scarica_catalogo" }, here) : false;
  // Il via si firma in /firme (§3.5). Se la testata mostra già «Firma il via allo sviluppo», la pagina non lo ripete.
  const headerSignsVia = headerPrimary && step?.id === "firma" && header.nextStep.mySignaturesPending.length === 1 && header.nextStep.mySignaturesPending[0].kind === "via";
  const signHref = headerSignsVia ? null : casePath(workspaceId, caseId, "firme");

  const reject = signable && data.pending ? (isOwner && !data.pending.signatures.some((s) => s.ruolo === "owner_cliente") ? "non_approvo" : isLead ? "ritira" : null) : null;
  const history = data.reviews.map((r) => reviewHistoryRow(r, now));
  const versions = data.versions.map((v) => ({ key: String(v.version), ...catalogVersionRow(v, now) }));

  return (
    <PageContainer>
      <div className="max-w-3xl space-y-8">
        <div className="space-y-4">
          {canOpenShellPage("panoramica", roles) && (
            <Link href={base} className="inline-flex min-h-11 items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground sm:min-h-0">
              <ChevronLeft className="size-4" aria-hidden />
              Panoramica
            </Link>
          )}
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <h2 className="text-xl font-semibold tracking-tight">Via allo sviluppo</h2>
            <StatusDot tone={stateView.tone} label={stateView.label} size="md" />
          </div>
          {g1.required > 0 && <ProgressToGate ok={g1.ok} required={g1.required} inReview={data.inReview} size="lg" audience={ls ? "ls" : "cliente"} />}
        </div>

        {ls && contractCase && !core.policy.confirmed && (
          <p role="status" className="flex items-start gap-2 rounded-lg bg-uc-giallo-bg px-3 py-2 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-uc-giallo" aria-hidden />
            <span className="min-w-0">{VIA_RULE_TO_CONFIRM}</span>
          </p>
        )}

        <ViaConditionList open={conditions.open} done={conditions.done} doneText={doneConditionsText(conditions.done.length, conditions.open.length)} hrefFor={conditionHref} />

        <ViaSignatureList lines={viaSignatures(viaShownSignatures(data.pending, data.reviews), now)} note={evidenceMissing ? VIA_EVIDENCE_MISSING : null} />

        <GatePanel
          workspaceId={workspaceId}
          caseId={caseId}
          action={action}
          filled={!headerPrimary}
          reviewId={data.pending?.id ?? null}
          contractCase={contractCase}
          signHref={signHref}
          reject={reject}
          files={data.files}
        />

        <div className="space-y-2">
          <Disclosure id="come-funziona" title="Come funziona">
            <HowItWorks rule={VIA_RULE_TEXT[core.policy.scope]} exceptions={VIA_EXCEPTIONS} signers={VIA_SIGNERS_TEXT} after={VIA_AFTER_TEXT} phases={casePhaseGroups(c.status, c.statusBeforeSuspension)} />
          </Disclosure>
          {(history.length > 0 || versions.length > 0) && (
            <Disclosure id="storico" title="Storico">
              <ViaHistory reviews={history} versions={versions} />
            </Disclosure>
          )}
          {ls && (
            <Disclosure id="diagnostica" title="Diagnostica">
              <CoverageCard
                text={coverageText(data.coverage)}
                policy={VIA_POLICY_TEXT[core.policy.scope]}
                exceptions={exceptionsText({ waivers: g1.waivers, should: g1.should })}
                // Le chiavi degli elementi non coperti sono del catalogo intero: lo sviluppatore, che vede solo le voci validate, non le legge.
                uncovered={canOpenPage("voci", roles) && !seesValidatedOnly(roles) ? data.coverage.uncovered : []}
              />
              {contractCase && !core.policy.confirmed && <p className="text-sm text-muted-foreground">{VIA_RULE_TO_CONFIRM}</p>}
            </Disclosure>
          )}
        </div>

        {ls && pastVia && (
          <div id="sviluppo-con-claude" className="min-w-0 scroll-mt-40">
            <ClaudeDevPanel
              workspaceId={workspaceId}
              caseId={caseId}
              caseCode={c.code}
              canManage={isLead && !caseAccess.readOnly}
              catalogVersion={c.catalogVersion}
              caseClosed={c.status === "chiuso"}
              tokens={tokens}
            />
          </div>
        )}
      </div>
    </PageContainer>
  );
}
