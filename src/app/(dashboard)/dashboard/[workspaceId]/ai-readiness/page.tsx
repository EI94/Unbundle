import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { notFound } from "next/navigation";
import { canManageWorkspaceSettings, canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";
import {
  ensureAiReadinessSystemTemplate,
  getAiReadinessDashboard,
  getAssessmentBundleById,
  listAssessmentsByWorkspace,
  listAiReadinessInsights,
  listAiReadinessExports,
  listRespondentsByAssessment,
  listUseCaseSubmissionsByAssessment,
} from "@/lib/db/queries/ai-readiness";
import { readinessPillarText } from "@/lib/programma/text";
import { questionScopeFromUnknown } from "@/lib/ai-readiness/template-scope";
import { findUncoveredInternalPillarIds } from "@/lib/ai-readiness/survey-track";
import { USE_CASE_FORM_BLOCKS } from "@/lib/ai-readiness/use-case-form";
import { READINESS_TEXT, formatScore } from "@/lib/ai-readiness/dashboard-text";
import {
  INVITE_PANEL,
  READINESS_TAB_PARAM,
  expectedRespondentsOf,
  exportHref,
  insightStatusView,
  insightTypeLabel,
  personRowView,
  proposalFact,
  questionsHref,
  readinessHref,
  readinessIndexView,
  readinessNextStep,
  readinessStage,
  readinessStatusView,
  readinessSummary,
  readinessTabOf,
  strengthsAndAttention,
  synthesisOf,
  visibleReadinessTabs,
} from "@/lib/ai-readiness/dashboard-view";
import { exportTypeLabel } from "@/lib/ai-readiness/export-types";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import { AssessmentCreateForm } from "@/components/ai-readiness/assessment-create-form";
import { AssessmentSwitcher, type AssessmentOption } from "@/components/ai-readiness/assessment-switcher";
import { AutoRefresh } from "@/components/ai-readiness/auto-refresh";
import { CollectionTab } from "@/components/ai-readiness/collection-tab";
import { InsightsTab } from "@/components/ai-readiness/insights-tab";
import { ReadinessAnchor } from "@/components/ai-readiness/readiness-anchor";
import { ReadinessHeader } from "@/components/ai-readiness/readiness-header";
import { ResultsTab } from "@/components/ai-readiness/results-tab";
import { SettingsTab } from "@/components/ai-readiness/settings-tab";
import { PageContainer } from "@/components/dashboard/page-container";
import { SegmentedNav } from "@/components/dashboard/segmented-nav";
import { EmptyState } from "@/components/ui-10/empty-state";

const T = READINESS_TEXT;
const DATE = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", timeZone: "Europe/Rome" });
const CLOCK = new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });
const DATE_TIME = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object" && !Array.isArray(item)) : [];
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

/**
 * AI Readiness (rilascio 10, ondata 7b, docs/ui-10/PROPOSTA-10.md §3.9; audit «Fuori» §5.1-5.4, §8.4). Una testata
 * (il titolo è il menu delle rilevazioni, il «⋯», lo stato in italiano, «46 risposte su 120 attese · bastano 5 per i
 * risultati» e un solo pulsante pieno che segue lo stato) e quattro schede al loro indirizzo (`?scheda=`): Risultati ·
 * Raccolta · Insight · Impostazioni. Prima erano sedici blocchi uno sotto l'altro.
 *
 * Gli indirizzi di prima valgono tutti: `?assessment=`, `?new=1`, `?deleted=1`, le ancore `#respondents` e
 * `#intelligence` (`ReadinessAnchor`); `?apri=invita` apre il pannello «Invita una persona». Chi vede che cosa non
 * cambia: la pagina si apre a ogni membro del workspace; ogni controllo solo a chi può usarlo, con i permessi delle
 * azioni di oggi (gestire per la raccolta, valutare per la sintesi e i file).
 */
export default async function AiReadinessPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ assessment?: string; new?: string; deleted?: string; scheda?: string; apri?: string }>;
}) {
  const { workspaceId } = await params;
  const { access } = await requireWorkspacePage(workspaceId);
  const search = await searchParams;

  await ensureAiReadinessSystemTemplate();
  const manages = canManageWorkspaceSettings(access.role);
  const reviews = canReviewWorkspacePortfolio(access.role);
  const assessments = await listAssessmentsByWorkspace(workspaceId);
  const selectedRow = assessments.find((row) => row.assessment.id === search.assessment) ?? assessments[0] ?? null;
  const showCreateForm = (search.new === "1" && manages) || assessments.length === 0;
  const options: AssessmentOption[] = assessments.map((row) => ({
    id: row.assessment.id,
    name: row.assessment.name,
    status: readinessStatusView(row.assessment.status).label,
    href: readinessHref(workspaceId, { assessmentId: row.assessment.id }),
  }));
  const newHref = manages ? `/dashboard/${workspaceId}/ai-readiness?new=1` : null;
  const deletedNotice =
    search.deleted === "1" ? (
      <p className="text-sm text-muted-foreground" role="status">
        {T.deleted}
      </p>
    ) : null;

  if (showCreateForm) {
    return (
      <PageContainer className="space-y-6">
        <header className="space-y-1">
          <AssessmentSwitcher title={manages ? T.create.title : T.pageTitle} currentId={null} options={options} newHref={null} />
        </header>
        {deletedNotice}
        {manages ? <AssessmentCreateForm workspaceId={workspaceId} workspaceName={access.workspace.name} /> : <EmptyState text={T.create.noManager} />}
      </PageContainer>
    );
  }

  const bundle = selectedRow ? await getAssessmentBundleById(selectedRow.assessment.id) : null;
  if (!bundle) notFound();
  const assessment = bundle.assessment;

  const [dashboard, respondents, useCases, exports, insights] = await Promise.all([
    getAiReadinessDashboard(assessment.id),
    listRespondentsByAssessment(assessment.id),
    listUseCaseSubmissionsByAssessment(assessment.id),
    listAiReadinessExports(assessment.id),
    listAiReadinessInsights(assessment.id),
  ]);
  const responses = dashboard?.responseCount ?? 0;
  const expected = expectedRespondentsOf(assessment.scoringConfig);
  const scoring = record(assessment.scoringConfig);
  const hasOpenLink = typeof scoring.openLinkTokenHash === "string";
  const draftInsights = insights.filter((insight) => insight.validationStatus === "draft").length;
  const stage = readinessStage({
    status: assessment.status,
    hasOpenLink,
    completed: responses,
    threshold: assessment.aggregationThreshold,
    draftInsights,
    synthesis: synthesisOf(insights),
  });
  const step = readinessNextStep(stage, { manages, reviews, draftInsights });

  const tabs = visibleReadinessTabs({ manages, reviews, proposals: useCases.length, insights: insights.length });
  const tab = readinessTabOf(search[READINESS_TAB_PARAM], tabs);
  const href = (t: (typeof tabs)[number], panel?: string) => readinessHref(workspaceId, { assessmentId: assessment.id, tab: t, panel });

  // Le aree: il nome in italiano, mai il titolo inglese salvato nel modello («Technology») né l'id del pilastro.
  const sectionOptions = bundle.templateDefinition.sections.map((section) => ({
    id: section.id,
    title: section.title,
    audience: section.audience,
    pillarId: section.pillarId,
    area: readinessPillarText(section.pillarId),
  }));

  let body: React.ReactNode;
  if (tab === "risultati") {
    const sectionScores = bundle.templateDefinition.sections.flatMap((section) => {
      const score = dashboard?.sectionScores[section.id];
      return typeof score === "number" && Number.isFinite(score) ? [{ title: section.title, score }] : [];
    });
    const { strengths, attention } = strengthsAndAttention(sectionScores);
    const missing = findUncoveredInternalPillarIds({
      pillarIds: bundle.templateDefinition.pillars.map((pillar) => pillar.id),
      sections: sectionOptions,
      respondents,
    });
    const weakest = dashboard?.bottleneckPillar ? readinessPillarText(dashboard.bottleneckPillar) : null;
    body = (
      <ResultsTab
        responses={responses}
        threshold={assessment.aggregationThreshold}
        thresholdMet={dashboard?.aggregationThresholdMet ?? false}
        index={readinessIndexView(dashboard?.overallScore, weakest)}
        areas={bundle.templateDefinition.pillars.map((pillar) => ({
          id: pillar.id,
          title: readinessPillarText(pillar.id),
          description: pillar.description,
          score: typeof dashboard?.pillarScores[pillar.id] === "number" ? (dashboard.pillarScores[pillar.id] as number) : null,
        }))}
        strengths={strengths}
        attention={attention}
        missingInternal={missing.map((id) => readinessPillarText(id))}
        inviteHref={manages ? href("raccolta", INVITE_PANEL) : null}
        teams={(dashboard?.units ?? [])
          .filter((unit) => unit.respondentCount > 0)
          .map((unit) => ({
            unit: unit.unit,
            responses: unit.respondentCount,
            thresholdMet: unit.aggregationThresholdMet,
            score: unit.overallScore,
            weakest: unit.bottleneckPillar ? readinessPillarText(unit.bottleneckPillar) : null,
          }))}
      />
    );
  } else if (tab === "raccolta") {
    const scope = questionScopeFromUnknown(scoring.openLinkQuestionScope);
    const hub = isUseCaseHubWorkspace(workspaceId);
    body = (
      <CollectionTab
        workspaceId={workspaceId}
        assessmentId={assessment.id}
        manages={manages}
        status={assessment.status}
        initialPanel={search.apri ?? null}
        link={{ active: hasOpenLink, scopeIds: scope?.sectionIds?.length ? scope.sectionIds : null }}
        everyoneSections={sectionOptions.filter((s) => s.audience !== "internal").map(({ id, title, area }) => ({ id, title, area }))}
        sections={sectionOptions.map(({ id, title, audience, area }) => ({ id, title, audience, area }))}
        useCaseBlocks={USE_CASE_FORM_BLOCKS.map((block) => ({ id: block.id, title: block.title, subtitle: block.subtitle }))}
        people={respondents.map((r) => ({ id: r.id, ...personRowView(r) }))}
        proposals={useCases.map((item) => ({ id: item.id, title: item.title, fact: proposalFact(item), linkedUseCaseId: item.linkedUseCaseId }))}
        useCaseBase={hub ? `/dashboard/${workspaceId}/use-cases/` : `/dashboard/${workspaceId}/portfolio/review/`}
      />
    );
  } else if (tab === "insight") {
    const roadmap = records(record(insights.find((i) => i.insightType === "roadmap")?.evidence).waves);
    const clusters = records(record(insights.find((i) => i.insightType === "use_case")?.evidence).clusters);
    const benchmark = record(record(insights.find((i) => i.insightType === "benchmark")?.evidence).benchmark);
    const delta = typeof benchmark.overallDelta === "number" ? formatScore(benchmark.overallDelta) : null;
    // Prima quelli da rivedere, poi gli altri; dentro, dal più recente.
    const ordered = [...insights].sort((a, b) => Number(b.validationStatus === "draft") - Number(a.validationStatus === "draft"));
    body = (
      <InsightsTab
        workspaceId={workspaceId}
        assessmentId={assessment.id}
        manages={manages}
        canGenerate={reviews && responses >= Math.max(1, assessment.aggregationThreshold)}
        threshold={assessment.aggregationThreshold}
        drafts={draftInsights}
        insights={ordered.map((insight) => ({
          id: insight.id,
          type: insightTypeLabel(insight.insightType),
          title: insight.title,
          body: insight.body,
          status: insightStatusView(insight.validationStatus),
          rawStatus: insight.validationStatus,
          date: DATE.format(insight.generatedAt),
        }))}
        roadmap={roadmap.map((wave, index) => ({ id: text(wave.id) || String(index), horizon: text(wave.horizon), title: text(wave.title), focus: text(wave.focus), metric: text(wave.successMetric) }))}
        groups={clusters.slice(0, 4).map((cluster, index) => ({ id: text(cluster.id) || String(index), label: text(cluster.label), description: text(cluster.description), count: typeof cluster.count === "number" ? cluster.count : 0 }))}
        comparison={benchmark.enabled === true && delta ? T.insights.comparisonValue(delta) : null}
      />
    );
  } else {
    const privacy = record(assessment.privacyConfig);
    body = (
      <SettingsTab
        workspaceId={workspaceId}
        assessmentId={assessment.id}
        manages={manages}
        threshold={assessment.aggregationThreshold}
        minThreshold={assessment.anonymousMode !== false ? 3 : 1}
        expected={expected}
        anonymous={assessment.anonymousMode !== false}
        controller={text(privacy.controllerName) || access.workspace.name}
        exports={exports.map((item) => ({
          id: item.id,
          label: exportTypeLabel(item.exportType),
          when: DATE_TIME.format(item.createdAt),
          personal: item.includedPersonalData,
        }))}
      />
    );
  }

  return (
    <PageContainer className="space-y-6">
      {assessment.status === "open" ? <AutoRefresh seconds={30} /> : null}
      <ReadinessAnchor workspaceId={workspaceId} assessmentId={assessment.id} current={tab} visible={tabs} />
      {deletedNotice}
      {/* (Revisione 7b) Una rilevazione, uno stato: cambiando rilevazione dal menu (stessa pagina, solo `?assessment=`)
          la testata e la scheda ripartono da capo, senza portarsi dietro la finestra del link o le pieghe di prima. */}
      <ReadinessHeader
        key={assessment.id}
        workspaceId={workspaceId}
        assessmentId={assessment.id}
        title={assessment.name}
        options={options}
        newHref={newHref}
        status={readinessStatusView(assessment.status)}
        summary={readinessSummary({ completed: responses, expected, threshold: assessment.aggregationThreshold })}
        updated={assessment.status === "open" ? T.summary.updated(CLOCK.format(new Date())) : null}
        step={step}
        insightsHref={href("insight")}
        reportHref={exportHref(assessment.id, "pdf")}
        menu={{
          status: assessment.status,
          respondentCount: respondents.length,
          completedCount: dashboard?.completedCount ?? 0,
          manages,
          reviews,
          questionsHref: questionsHref(workspaceId, assessment.id),
        }}
      />
      {tabs.length > 1 ? (
        <SegmentedNav ariaLabel={T.tabs.label} active={tab} gridOnPhone items={tabs.map((key) => ({ key, label: T.tabs[key], href: href(key) }))} />
      ) : null}
      <div key={assessment.id} data-readiness-tab={tab}>
        {body}
      </div>
    </PageContainer>
  );
}
