import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  BarChart3,
  Brain,
  Download,
  GitBranch,
  Lock,
  Mail,
  Network,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { requireSession } from "@/lib/auth/redirect-to-login";
import { getWorkspaceAccessForUser } from "@/lib/workspace-access";
import { canManageWorkspaceSettings } from "@/lib/workspace-permissions";
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
import { getMaturityLevel } from "@/lib/ai-readiness/scoring";
import { AssessmentCreateForm } from "@/components/ai-readiness/assessment-create-form";
import { AssessmentActions } from "@/components/ai-readiness/assessment-actions";
import { InsightValidationActions } from "@/components/ai-readiness/insight-validation-actions";
import { IntelligenceActions } from "@/components/ai-readiness/intelligence-actions";
import { RespondentInviteForm } from "@/components/ai-readiness/respondent-invite-form";
import { UseCasePromoteButton } from "@/components/ai-readiness/use-case-promote-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

function scoreLabel(score: number | null | undefined) {
  return typeof score === "number" && Number.isFinite(score)
    ? score.toFixed(2)
    : "N/D";
}

function statusBadge(status: string) {
  const label: Record<string, string> = {
    draft: "Draft",
    open: "Open",
    closed: "Closed",
    archived: "Archived",
  };
  return label[status] ?? status;
}

function configString(config: Record<string, unknown> | null | undefined, key: string, fallback = "") {
  const value = config?.[key];
  return typeof value === "string" ? value : fallback;
}

function evidenceRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function evidenceArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          item !== null && typeof item === "object" && !Array.isArray(item)
      )
    : [];
}

function textValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function scoreFromUnknown(value: unknown) {
  return typeof value === "number" ? scoreLabel(value) : "N/D";
}

export default async function AiReadinessPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ assessment?: string; new?: string }>;
}) {
  const session = await requireSession();
  const { workspaceId } = await params;
  const search = await searchParams;
  const access = await getWorkspaceAccessForUser(session.user.id, workspaceId);
  if (!access) notFound();

  await ensureAiReadinessSystemTemplate();
  const canManage = canManageWorkspaceSettings(access.role);
  const assessments = await listAssessmentsByWorkspace(workspaceId);
  const selectedRow =
    assessments.find((row) => row.assessment.id === search.assessment) ??
    assessments[0] ??
    null;
  const showCreateForm =
    (search.new === "1" && canManage) || assessments.length === 0;
  const bundle =
    !showCreateForm && selectedRow
      ? await getAssessmentBundleById(selectedRow.assessment.id)
      : null;

  const assessmentSwitcher =
    assessments.length > 0 ? (
      <div className="flex flex-wrap items-center gap-2" data-testid="assessment-switcher">
        {assessments.map((row) => {
          const isActive =
            !showCreateForm && row.assessment.id === selectedRow?.assessment.id;
          return (
            <Link
              key={row.assessment.id}
              href={`/dashboard/${workspaceId}/ai-readiness?assessment=${row.assessment.id}`}
              className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                isActive
                  ? "border-emerald-500 bg-emerald-500/10 font-medium"
                  : "hover:bg-muted"
              }`}
            >
              {row.assessment.name}
              <span className="ml-2 text-xs text-muted-foreground">
                {statusBadge(row.assessment.status)}
              </span>
            </Link>
          );
        })}
        {canManage && (
          <Link
            href={`/dashboard/${workspaceId}/ai-readiness?new=1`}
            className="rounded-full border border-dashed px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
            data-testid="assessment-new-link"
          >
            + Nuovo assessment
          </Link>
        )}
      </div>
    ) : null;

  if (showCreateForm) {
    return (
      <div className="flex-1 space-y-8 p-6 lg:p-8">
        <div className="rounded-[32px] border bg-linear-to-br from-emerald-500/10 via-background to-sky-500/10 p-8">
          <Badge variant="secondary">Fase 1 - Assessment Core</Badge>
          <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight">
            AI Readiness OS
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
            La diagnostica Lateral Space dentro Unbundle: setup cliente, inviti,
            survey privacy-safe, scoring, dashboard base ed export.
          </p>
        </div>
        {assessmentSwitcher}
        {canManage ? (
          <AssessmentCreateForm
            workspaceId={workspaceId}
            workspaceName={access.workspace.name}
          />
        ) : (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              Serve un Executive Sponsor o Transformation Lead per creare il
              primo assessment.
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  if (!bundle) notFound();

  const [dashboard, respondents, useCases, exports, insights] = await Promise.all([
    getAiReadinessDashboard(bundle.assessment.id),
    listRespondentsByAssessment(bundle.assessment.id),
    listUseCaseSubmissionsByAssessment(bundle.assessment.id),
    listAiReadinessExports(bundle.assessment.id),
    listAiReadinessInsights(bundle.assessment.id),
  ]);
  const maturity = getMaturityLevel(dashboard?.overallScore);
  const completion =
    dashboard && dashboard.invitedCount > 0
      ? Math.round((dashboard.completedCount / dashboard.invitedCount) * 100)
      : 0;
  const privacyConfig = bundle.assessment.privacyConfig ?? {};
  const roadmapInsight = insights.find((insight) => insight.insightType === "roadmap");
  const roadmapEvidence = evidenceRecord(roadmapInsight?.evidence);
  const roadmapWaves = evidenceArray(roadmapEvidence.waves);
  const useCaseInsight = insights.find((insight) => insight.insightType === "use_case");
  const useCaseEvidence = evidenceRecord(useCaseInsight?.evidence);
  const clusters = evidenceArray(useCaseEvidence.clusters);
  const benchmarkInsight = insights.find((insight) => insight.insightType === "benchmark");
  const benchmark = evidenceRecord(evidenceRecord(benchmarkInsight?.evidence).benchmark);

  const includedPillarTitles = bundle.templateDefinition.pillars
    .map((pillar) => pillar.title)
    .join(", ");

  return (
    <div className="flex-1 space-y-6 p-6 lg:p-8">
      {assessmentSwitcher}
      <header className="rounded-[32px] border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">AI Readiness OS</Badge>
              <Badge variant="outline">Fase 2 - Intelligence Layer</Badge>
              <Badge variant="outline">{statusBadge(bundle.assessment.status)}</Badge>
              {bundle.assessment.anonymousMode && (
                <Badge variant="outline" className="gap-1">
                  <Lock className="size-3" /> Anonymous by default
                </Badge>
              )}
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight">
              {bundle.assessment.name}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Diagnostic layer per misurare readiness su: {includedPillarTitles}.
              I risultati per team vengono mostrati solo sopra soglia
              aggregazione.
            </p>
          </div>
          <div className="space-y-2">
            {canManage && (
              <AssessmentActions
                workspaceId={workspaceId}
                assessmentId={bundle.assessment.id}
                status={bundle.assessment.status}
              />
            )}
            <IntelligenceActions
              workspaceId={workspaceId}
              assessmentId={bundle.assessment.id}
            />
            <div className="flex flex-wrap gap-2">
              {/* Anchor nativi (non <Link>): il prefetch di Next eseguirebbe
                  la GET di export a ogni visita, generando file e audit finti. */}
              <Button
                variant="outline"
                render={
                  <a
                    href={`/api/ai-readiness/assessments/${bundle.assessment.id}/export?type=excel`}
                    download
                  />
                }
                nativeButton={false}
              >
                <Download className="mr-1 size-4" /> Excel
              </Button>
              <Button
                variant="outline"
                render={
                  <a
                    href={`/api/ai-readiness/assessments/${bundle.assessment.id}/export?type=pdf`}
                    download
                  />
                }
                nativeButton={false}
              >
                <Download className="mr-1 size-4" /> PDF
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <Users className="mb-3 size-5 text-primary" />
            <div className="text-2xl font-semibold">{dashboard?.completedCount ?? 0}</div>
            <p className="text-xs text-muted-foreground">
              risposte completate su {dashboard?.invitedCount ?? 0} inviti
            </p>
            <Progress className="mt-4" value={completion} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <BarChart3 className="mb-3 size-5 text-primary" />
            <div className="text-2xl font-semibold">
              {scoreLabel(dashboard?.overallScore)}
            </div>
            <p className="text-xs text-muted-foreground">
              readiness index - {maturity?.label ?? "insufficient data"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <AlertTriangle className="mb-3 size-5 text-amber-500" />
            <div className="text-2xl font-semibold">
              {dashboard?.bottleneckPillar ?? "N/D"}
            </div>
            <p className="text-xs text-muted-foreground">
              weakest AI Native enabler
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <Sparkles className="mb-3 size-5 text-primary" />
            <div className="text-2xl font-semibold">{useCases.length}</div>
            <p className="text-xs text-muted-foreground">use case proposti via survey</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="rounded-[28px]">
          <CardHeader>
            <CardTitle>Pillar score</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {bundle.templateDefinition.pillars.map((pillar) => {
              const score = dashboard?.pillarScores[pillar.id] ?? null;
              const percentage = typeof score === "number" ? (score / 5) * 100 : 0;
              return (
                <div key={pillar.id} className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{pillar.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {pillar.description}
                      </div>
                    </div>
                    <div className="font-mono text-sm">{scoreLabel(score)}</div>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card className="rounded-[28px]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-emerald-500" />
              Privacy guardrails
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-2xl border p-3">
              <div className="text-xs text-muted-foreground">Soglia aggregazione</div>
              <div className="mt-1 font-medium">
                {bundle.assessment.aggregationThreshold} respondent minimi
              </div>
            </div>
            <div className="rounded-2xl border p-3">
              <div className="text-xs text-muted-foreground">Controller</div>
              <div className="mt-1 font-medium">
                {configString(privacyConfig, "controllerName", access.workspace.name)}
              </div>
            </div>
            <div className="rounded-2xl border p-3">
              <div className="text-xs text-muted-foreground">Raw individual data</div>
              <div className="mt-1 font-medium">
                {privacyConfig.allowIndividualView === true ? "Permesso" : "Disabilitato"}
              </div>
            </div>
            <div className="rounded-2xl border p-3">
              <div className="text-xs text-muted-foreground">Privacy advanced</div>
              <div className="mt-1 font-medium">
                Export respondent, revoca benchmark e anonimizzazione via link personale.
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                DPIA, special category warning e benchmark restano espliciti e auditabili.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="rounded-[28px]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="size-5" />
              Intelligence review
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {insights.length === 0 ? (
              <p className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                Genera intelligence per ottenere sintesi executive, rischi,
                cluster use case, roadmap e benchmark. Ogni insight nasce in
                draft e richiede review umana.
              </p>
            ) : (
              insights.slice(0, 8).map((insight) => (
                <div key={insight.id} className="rounded-2xl border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{insight.insightType}</Badge>
                        <Badge
                          variant={
                            insight.validationStatus === "approved"
                              ? "secondary"
                              : insight.validationStatus === "rejected"
                                ? "destructive"
                                : "outline"
                          }
                        >
                          {insight.validationStatus === "draft"
                            ? "AI suggested"
                            : insight.validationStatus}
                        </Badge>
                      </div>
                      <h3 className="mt-2 font-medium">{insight.title}</h3>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {insight.generatedAt.toLocaleDateString("it-IT")}
                    </div>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {insight.body}
                  </p>
                  <div className="mt-3 rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">
                    Evidence: {textValue(evidenceRecord(insight.evidence).privacyGuardrail, "aggregated only")}
                  </div>
                  {canManage && (
                    <div className="mt-3">
                      <InsightValidationActions
                        workspaceId={workspaceId}
                        assessmentId={bundle.assessment.id}
                        insightId={insight.id}
                        status={insight.validationStatus}
                      />
                    </div>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="rounded-[28px]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GitBranch className="size-5" />
                Roadmap waves
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {roadmapWaves.length === 0 ? (
                <p className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                  Genera intelligence per vedere le waves 0-90 giorni, 3-6 mesi
                  e 6-12 mesi.
                </p>
              ) : (
                roadmapWaves.map((wave) => (
                  <div key={textValue(wave.id)} className="rounded-2xl border p-4">
                    <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      {textValue(wave.horizon)}
                    </div>
                    <div className="mt-1 font-medium">{textValue(wave.title)}</div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {textValue(wave.focus)}
                    </p>
                    <div className="mt-3 rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">
                      Success metric: {textValue(wave.successMetric)}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="rounded-[28px]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Network className="size-5" />
                Cluster e benchmark
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-2xl border p-4">
                <div className="text-xs text-muted-foreground">Benchmark</div>
                <div className="mt-1 font-medium">
                  {benchmark.enabled === true
                    ? `Delta overall ${scoreFromUnknown(benchmark.overallDelta)}`
                    : textValue(benchmark.reason, "Non ancora disponibile")}
                </div>
              </div>
              {clusters.slice(0, 4).map((cluster) => (
                <div key={textValue(cluster.id)} className="rounded-2xl border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium">{textValue(cluster.label)}</div>
                    <Badge variant="outline">{String(cluster.count ?? 0)} casi</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {textValue(cluster.description)}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="rounded-[28px]">
        <CardHeader>
          <CardTitle>Team heatmap</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="text-left text-xs uppercase tracking-[0.16em] text-muted-foreground">
              <tr>
                <th className="py-2">Area</th>
                <th>Risposte</th>
                <th>Privacy threshold</th>
                <th>Score</th>
                <th>Bottleneck</th>
              </tr>
            </thead>
            <tbody>
              {dashboard?.units.map((unit) => (
                <tr key={unit.unit} className="border-t">
                  <td className="py-3 font-medium">{unit.unit}</td>
                  <td>{unit.respondentCount}</td>
                  <td>
                    {unit.aggregationThresholdMet ? (
                      <Badge variant="secondary">OK</Badge>
                    ) : (
                      <Badge variant="outline">Insufficient data</Badge>
                    )}
                  </td>
                  <td>{unit.aggregationThresholdMet ? scoreLabel(unit.overallScore) : "-"}</td>
                  <td>{unit.aggregationThresholdMet ? unit.bottleneckPillar ?? "-" : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {canManage && (
        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <Card className="rounded-[28px]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="size-5" /> Invita respondent
              </CardTitle>
            </CardHeader>
            <CardContent>
              <RespondentInviteForm
                workspaceId={workspaceId}
                assessmentId={bundle.assessment.id}
              />
            </CardContent>
          </Card>
          <Card className="rounded-[28px]">
            <CardHeader>
              <CardTitle>Respondent</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {respondents.length === 0 ? (
                <p className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                  Nessun invito creato.
                </p>
              ) : (
                respondents.slice(0, 12).map((respondent) => (
                  <div
                    key={respondent.id}
                    className="flex items-center justify-between rounded-2xl border p-3 text-sm"
                  >
                    <div>
                      <div className="font-medium">
                        {[respondent.name, respondent.surname].filter(Boolean).join(" ") ||
                          respondent.email ||
                          respondent.pseudonymousId}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {respondent.email &&
                        (respondent.name || respondent.surname)
                          ? `${respondent.email} · `
                          : ""}
                        {respondent.organizationUnit ?? "Area non indicata"} · {respondent.role ?? "ruolo n/d"}
                      </div>
                    </div>
                    <Badge variant={respondent.inviteStatus === "completed" ? "secondary" : "outline"}>
                      {respondent.inviteStatus}
                    </Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="rounded-[28px]">
          <CardHeader>
            <CardTitle>Use case intake</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {useCases.length === 0 ? (
              <p className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                I use case proposti dai respondent appariranno qui.
              </p>
            ) : (
              useCases.slice(0, 8).map((item) => (
                <div key={item.id} className="rounded-2xl border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{item.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {item.linkedUseCaseId ? "Collegato al Portfolio" : "Da valutare"}
                      </div>
                    </div>
                    {canManage && (
                      <UseCasePromoteButton
                        workspaceId={workspaceId}
                        assessmentId={bundle.assessment.id}
                        submissionId={item.id}
                        linkedUseCaseId={item.linkedUseCaseId}
                      />
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {item.desiredOutcome || item.painPoint || item.currentProcess}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{item.frequency ?? "frequenza n/d"}</span>
                    <span>{item.riskLevel ?? "rischio n/d"}</span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
        <Card className="rounded-[28px]">
          <CardHeader>
            <CardTitle>Export audit</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {exports.length === 0 ? (
              <p className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                Nessun export generato.
              </p>
            ) : (
              exports.slice(0, 8).map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded-2xl border p-3 text-sm">
                  <div>
                    <div className="font-medium">{item.exportType}</div>
                    <div className="text-xs text-muted-foreground">
                      {item.createdAt.toLocaleString("it-IT")}
                    </div>
                  </div>
                  <Badge variant={item.includedPersonalData ? "destructive" : "secondary"}>
                    {item.includedPersonalData ? "personal data" : "anonymized"}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
