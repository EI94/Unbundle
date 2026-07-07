import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Eye } from "lucide-react";
import { requireSession } from "@/lib/auth/redirect-to-login";
import { getWorkspaceAccessForUser } from "@/lib/workspace-access";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";
import { getAssessmentBundleById } from "@/lib/db/queries/ai-readiness";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

/**
 * Anteprima read-only della survey: l'admin vede esattamente le sezioni e le
 * domande che riceveranno i respondent, senza dover creare un invito di prova.
 */
export default async function AiReadinessSurveyPreviewPage({
  params,
}: {
  params: Promise<{ workspaceId: string; assessmentId: string }>;
}) {
  const session = await requireSession();
  const { workspaceId, assessmentId } = await params;
  const access = await getWorkspaceAccessForUser(session.user.id, workspaceId);
  if (!access || !canReviewWorkspacePortfolio(access.role)) notFound();

  const bundle = await getAssessmentBundleById(assessmentId);
  if (!bundle || bundle.assessment.workspaceId !== workspaceId) notFound();

  const { assessment, templateDefinition } = bundle;
  const anonymous = assessment.anonymousMode !== false;
  const scoredCount = templateDefinition.questions.filter(
    (question) => question.answerType !== "text"
  ).length;

  return (
    <div className="flex-1 space-y-6 p-6 lg:p-8">
      <div>
        <Button
          variant="ghost"
          size="sm"
          render={
            <Link
              href={`/dashboard/${workspaceId}/ai-readiness?assessment=${assessment.id}`}
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
            <Eye className="size-3" /> Anteprima survey
          </Badge>
          <Badge variant="outline">{assessment.name}</Badge>
          <Badge variant="outline">
            {anonymous ? "Anonima" : "Nominativa (nome e cognome richiesti)"}
          </Badge>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">
            Cosa vedranno i respondent
          </h1>
          {/* anchor nativo: il prefetch di un Link eseguirebbe la GET */}
          <Button
            render={
              <a
                href={`/api/ai-readiness/assessments/${assessment.id}/survey-pdf`}
                download
              />
            }
            nativeButton={false}
            data-testid="survey-pdf-download"
          >
            <Download className="mr-1 size-4" /> Scarica PDF per il cliente
          </Button>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          {scoredCount} domande a punteggio su{" "}
          {templateDefinition.pillars.map((pillar) => pillar.title).join(", ")}
          {anonymous
            ? ". Prima delle domande: informativa privacy e consensi."
            : ". Prima delle domande: nome e cognome, informativa privacy e consensi."}{" "}
          In coda, l&apos;intake opzionale di use case. Le risposte si salvano
          automaticamente e il respondent può riprendere in qualsiasi momento.
        </p>
      </header>

      {templateDefinition.sections.map((section) => {
        const pillar = templateDefinition.pillars.find(
          (item) => item.id === section.pillarId
        );
        const questions = templateDefinition.questions.filter(
          (question) => question.sectionId === section.id
        );
        return (
          <section key={section.id} className="rounded-[32px] border bg-card p-6">
            <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
              {pillar?.title}
            </div>
            <h2 className="mt-2 text-xl font-semibold">{section.title}</h2>
            {section.description && (
              <p className="mt-2 text-sm text-muted-foreground">
                {section.description}
              </p>
            )}
            <ol className="mt-5 space-y-4">
              {questions.map((question, index) => (
                <li key={question.id} className="rounded-2xl border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium leading-6">
                        {index + 1}. {question.label}
                        {question.required && (
                          <span className="text-destructive"> *</span>
                        )}
                      </div>
                      {question.description && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {question.description}
                        </p>
                      )}
                    </div>
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {question.answerType === "scale"
                        ? "Scala 0–5"
                        : question.answerType === "single_choice"
                          ? "Scelta singola"
                          : "Testo libero"}
                    </Badge>
                  </div>
                  {question.answerType === "scale" && question.scaleAnchors && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground/80">0</span> ={" "}
                      {question.scaleAnchors.min} ·{" "}
                      <span className="font-medium text-foreground/80">5</span> ={" "}
                      {question.scaleAnchors.max}
                    </p>
                  )}
                  {question.answerType === "single_choice" && question.options && (
                    <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                      {question.options.map((option) => (
                        <li key={option.value}>• {option.label}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
