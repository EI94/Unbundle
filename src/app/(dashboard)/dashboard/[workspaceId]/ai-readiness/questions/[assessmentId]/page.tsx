import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { canManageWorkspaceSettings } from "@/lib/workspace-permissions";
import {
  getAssessmentBundleById,
  listResponsesByAssessment,
  templateDefinitionFromRow,
} from "@/lib/db/queries/ai-readiness";
import {
  filterTemplateDefinition,
  includedPillarsFromScoringConfig,
  templateOverridesFromScoringConfig,
} from "@/lib/ai-readiness/template-scope";
import { READINESS_TEXT } from "@/lib/ai-readiness/dashboard-text";
import { questionAudienceOf, questionsHref, readinessHref } from "@/lib/ai-readiness/dashboard-view";
import { readinessPillarText } from "@/lib/programma/text";
import { QuestionDownloads, QuestionEditor } from "@/components/ai-readiness/question-editor";
import { PAGE_TITLE_CLASS, PageContainer } from "@/components/dashboard/page-container";
import { SegmentedNav } from "@/components/dashboard/segmented-nav";

const Q = READINESS_TEXT.questions;

/**
 * «Domande» di una rilevazione (rilascio 10, ondata 7b, §3.9; audit «Fuori» §5.3, AD-13, AD-14): le domande in righe
 * chiuse, divise in «Per tutti (N)» e «Referenti (N)» (`?per=referenti`), e «Scarica ▾» con i cinque file di oggi.
 * Partendo dalla base, ogni rilevazione toglie, modifica o aggiunge domande. Solo per chi gestisce il workspace, come
 * oggi; `/preview/<id>` porta qui.
 */
export default async function AiReadinessQuestionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; assessmentId: string }>;
  searchParams: Promise<{ per?: string }>;
}) {
  const { workspaceId, assessmentId } = await params;
  const { access } = await requireWorkspacePage(workspaceId);
  if (!canManageWorkspaceSettings(access.role)) notFound();

  const bundle = await getAssessmentBundleById(assessmentId);
  if (!bundle || bundle.assessment.workspaceId !== workspaceId) notFound();
  const asked = questionAudienceOf((await searchParams).per);

  const responses = await listResponsesByAssessment(assessmentId);
  const hasResponses = responses.some((r) => r.status === "submitted");

  // Base (senza override) per calcolare le domande rimosse ripristinabili.
  const baseDefinition = filterTemplateDefinition(
    templateDefinitionFromRow(bundle.template),
    includedPillarsFromScoringConfig(bundle.assessment.scoringConfig)
  );
  const overrides = templateOverridesFromScoringConfig(bundle.assessment.scoringConfig);
  const removedIds = new Set(overrides.removed ?? []);

  const sectionAudience = new Map([...baseDefinition.sections, ...bundle.templateDefinition.sections].map((s) => [s.id, s.audience]));
  const allSections = bundle.templateDefinition.sections.map((section) => ({
    id: section.id,
    title: section.title,
    description: section.description,
    area: readinessPillarText(section.pillarId),
    audience: section.audience,
  }));
  const count = (wanted: "tutti" | "referenti") =>
    bundle.templateDefinition.questions.filter((q) => {
      const a = sectionAudience.get(q.sectionId);
      return wanted === "referenti" ? a === "internal" : a !== "internal";
    }).length;
  // Lo zero non si vede: una parte senza domande non ha la sua scheda, e chi la chiede vede l'altra.
  const counts = { tutti: count("tutti"), referenti: count("referenti") };
  const audience = counts[asked] > 0 || counts[asked === "tutti" ? "referenti" : "tutti"] === 0 ? asked : asked === "tutti" ? "referenti" : "tutti";
  const inAudience = (sectionAudienceOf: string | undefined) => (audience === "referenti" ? sectionAudienceOf === "internal" : sectionAudienceOf !== "internal");
  const tabs = [
    { key: "tutti", label: Q.everyone(counts.tutti), href: questionsHref(workspaceId, assessmentId, "tutti"), count: counts.tutti },
    { key: "referenti", label: Q.internal(counts.referenti), href: questionsHref(workspaceId, assessmentId, "referenti"), count: counts.referenti },
  ].filter((tab) => tab.count > 0);
  const sections = allSections.filter((s) => inAudience(s.audience));
  const questions = bundle.templateDefinition.questions.filter((q) => inAudience(sectionAudience.get(q.sectionId)));
  const removedQuestions = baseDefinition.questions.filter((q) => removedIds.has(q.id) && inAudience(sectionAudience.get(q.sectionId)));

  return (
    <PageContainer className="space-y-6">
      <header className="space-y-3">
        <Link
          href={readinessHref(workspaceId, { assessmentId })}
          className="-ml-1 inline-flex min-h-11 items-center gap-1 rounded-md px-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8"
        >
          <ChevronLeft aria-hidden className="size-4" />
          {Q.back}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h1 className={PAGE_TITLE_CLASS}>{Q.title}</h1>
            <p className="text-sm text-muted-foreground break-words">{bundle.assessment.name}</p>
          </div>
          <QuestionDownloads assessmentId={assessmentId} />
        </div>
      </header>
      {tabs.length > 1 ? <SegmentedNav ariaLabel={Q.audienceLabel} active={audience} items={tabs.map(({ key, label, href }) => ({ key, label, href }))} /> : null}
      <QuestionEditor
        workspaceId={workspaceId}
        assessmentId={assessmentId}
        sections={sections}
        questions={questions}
        removedQuestions={removedQuestions}
        editedIds={Object.keys(overrides.edited ?? {})}
        hasResponses={hasResponses}
      />
    </PageContainer>
  );
}
