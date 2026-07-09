import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, ListChecks } from "lucide-react";
import { requireSession } from "@/lib/auth/redirect-to-login";
import { getWorkspaceAccessForUser } from "@/lib/workspace-access";
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
import { QuestionEditor } from "@/components/ai-readiness/question-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * Editor domande: partendo dalla base core, ogni assessment può rimuovere,
 * modificare o aggiungere singole domande. Pensato per l'incontro live di
 * setup con il referente del cliente.
 */
export default async function AiReadinessQuestionsPage({
  params,
}: {
  params: Promise<{ workspaceId: string; assessmentId: string }>;
}) {
  const session = await requireSession();
  const { workspaceId, assessmentId } = await params;
  const access = await getWorkspaceAccessForUser(session.user.id, workspaceId);
  if (!access || !canManageWorkspaceSettings(access.role)) notFound();

  const bundle = await getAssessmentBundleById(assessmentId);
  if (!bundle || bundle.assessment.workspaceId !== workspaceId) notFound();

  const responses = await listResponsesByAssessment(assessmentId);
  const hasResponses = responses.some((r) => r.status === "submitted");

  // Base (senza override) per calcolare le domande rimosse ripristinabili.
  const baseDefinition = filterTemplateDefinition(
    templateDefinitionFromRow(bundle.template),
    includedPillarsFromScoringConfig(bundle.assessment.scoringConfig)
  );
  const overrides = templateOverridesFromScoringConfig(
    bundle.assessment.scoringConfig
  );
  const removedIds = new Set(overrides.removed ?? []);
  const removedQuestions = baseDefinition.questions.filter((q) =>
    removedIds.has(q.id)
  );

  const pillarById = new Map(
    bundle.templateDefinition.pillars.map((p) => [p.id, p.title])
  );
  const sections = bundle.templateDefinition.sections.map((section) => ({
    id: section.id,
    title: section.title,
    description: section.description,
    pillarTitle: pillarById.get(section.pillarId) ?? section.pillarId,
    audience: section.audience,
  }));
  const scored = bundle.templateDefinition.questions.filter(
    (q) => q.answerType !== "text"
  ).length;

  return (
    <div className="flex-1 space-y-6 p-6 lg:p-8">
      <div>
        <Button
          variant="ghost"
          size="sm"
          render={
            <Link
              href={`/dashboard/${workspaceId}/ai-readiness?assessment=${assessmentId}`}
            />
          }
          nativeButton={false}
        >
          <ArrowLeft className="mr-1 size-4" /> Torna all&apos;assessment
        </Button>
      </div>

      <header className="rounded-[32px] border bg-card p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="gap-1">
            <ListChecks className="size-3" /> Editor domande
          </Badge>
          <Badge variant="outline">{bundle.assessment.name}</Badge>
          <Badge variant="outline">{scored} domande a punteggio</Badge>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">
            Domande e anteprima
          </h1>
        </div>
        {/* Download separati: file distinti da inviare al cliente.
            Anchor nativi: il prefetch di un Link eseguirebbe la GET. */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2" data-testid="question-downloads">
          <div className="rounded-2xl border bg-muted/20 p-4">
            <div className="text-sm font-semibold">Survey organizzazione</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Il questionario per tutte le persone.
            </p>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                render={
                  <a
                    href={`/api/ai-readiness/assessments/${assessmentId}/questions-export?track=everyone&format=pdf`}
                    download
                  />
                }
                nativeButton={false}
                data-testid="dl-survey-pdf"
              >
                <Download className="mr-1 size-3.5" /> PDF
              </Button>
              <Button
                size="sm"
                variant="outline"
                render={
                  <a
                    href={`/api/ai-readiness/assessments/${assessmentId}/questions-export?track=everyone&format=xlsx`}
                    download
                  />
                }
                nativeButton={false}
                data-testid="dl-survey-xlsx"
              >
                <Download className="mr-1 size-3.5" /> Excel
              </Button>
            </div>
          </div>
          <div className="rounded-2xl border bg-muted/20 p-4">
            <div className="text-sm font-semibold">Assessment referenti</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Le schede per IT, HR e business.
            </p>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                render={
                  <a
                    href={`/api/ai-readiness/assessments/${assessmentId}/questions-export?track=internal&format=pdf`}
                    download
                  />
                }
                nativeButton={false}
                data-testid="dl-internal-pdf"
              >
                <Download className="mr-1 size-3.5" /> PDF
              </Button>
              <Button
                size="sm"
                variant="outline"
                render={
                  <a
                    href={`/api/ai-readiness/assessments/${assessmentId}/questions-export?track=internal&format=xlsx`}
                    download
                  />
                }
                nativeButton={false}
                data-testid="dl-internal-xlsx"
              >
                <Download className="mr-1 size-3.5" /> Excel
              </Button>
            </div>
          </div>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Questo è esattamente ciò che riceveranno le persone, diviso in due
          binari: la <span className="font-medium text-foreground">survey per tutta
          l&apos;organizzazione</span> e le <span className="font-medium text-foreground">schede
          per i referenti</span> (IT, HR, business). Modifica il testo, i livelli
          1–5, rimuovi o aggiungi domande: le modifiche valgono solo per questo
          assessment e lo score resta sempre da 0 a 5 per pilastro.
        </p>
      </header>

      <QuestionEditor
        workspaceId={workspaceId}
        assessmentId={assessmentId}
        sections={sections}
        questions={bundle.templateDefinition.questions}
        removedQuestions={removedQuestions}
        editedIds={Object.keys(overrides.edited ?? {})}
        hasResponses={hasResponses}
      />
    </div>
  );
}
