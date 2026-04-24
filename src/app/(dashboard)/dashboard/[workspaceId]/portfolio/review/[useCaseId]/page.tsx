import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { getUseCaseById } from "@/lib/db/queries/use-cases";
import { getOrCreateWorkspaceScoringModel } from "@/lib/db/queries/scoring-model";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ReviewForm } from "@/components/portfolio/review-form";

const kindLabels: Record<string, string> = {
  best_practice: "Best Practice",
  use_case_ai: "Use Case AI",
};

const statusLabels: Record<string, string> = {
  needs_inputs: "Dati mancanti",
  in_review: "In review",
  scored: "Valutato",
  archived: "Archiviato",
};

export default async function PortfolioReviewPage({
  params,
}: {
  params: Promise<{ workspaceId: string; useCaseId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { workspaceId, useCaseId } = await params;
  const [workspace, useCase, model] = await Promise.all([
    getWorkspaceById(workspaceId),
    getUseCaseById(useCaseId),
    getOrCreateWorkspaceScoringModel(workspaceId),
  ]);
  if (!workspace || !useCase || useCase.workspaceId !== workspaceId) notFound();

  const isPortfolio = !!useCase.portfolioKind;
  if (!isPortfolio) notFound();

  const esgEnabled = workspace.esgEnabled === true;

  return (
    <div className="flex-1 p-6 lg:p-8 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight">{useCase.title}</h1>
            <Badge variant="secondary" className="text-xs">
              {kindLabels[useCase.portfolioKind!] ?? useCase.portfolioKind}
            </Badge>
            <Badge variant="outline" className="text-xs font-normal">
              {statusLabels[useCase.portfolioReviewStatus] ??
                useCase.portfolioReviewStatus}
            </Badge>
          </div>
          <p className="mt-1 text-muted-foreground max-w-2xl">
            Valuta i KPI configurati dal modello di ranking. Puoi farti
            suggerire i punteggi dall&apos;AI e poi aggiustarli.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/dashboard/${workspaceId}/portfolio`}>
            <Button variant="outline">Torna all&apos;inbox</Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Contenuto</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <div className="font-medium">Problema</div>
              <div className="text-muted-foreground whitespace-pre-wrap">
                {useCase.description ?? "—"}
              </div>
            </div>
            <div>
              <div className="font-medium">Flusso</div>
              <div className="text-muted-foreground whitespace-pre-wrap">
                {useCase.flowDescription ?? "—"}
              </div>
            </div>
            <div>
              <div className="font-medium">Human-in-the-loop</div>
              <div className="text-muted-foreground whitespace-pre-wrap">
                {useCase.humanInTheLoop ?? "—"}
              </div>
            </div>
            {useCase.guardrails && (
              <div>
                <div className="font-medium">Guardrail</div>
                <div className="text-muted-foreground whitespace-pre-wrap">
                  {useCase.guardrails}
                </div>
              </div>
            )}
            <div>
              <div className="font-medium">Impatto atteso</div>
              <div className="text-muted-foreground whitespace-pre-wrap">
                {useCase.businessCase ?? "—"}
              </div>
            </div>
            <div>
              <div className="font-medium">Dati necessari</div>
              <div className="text-muted-foreground whitespace-pre-wrap">
                {useCase.dataRequirements ?? "—"}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Valutazione (0–5)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 text-xs text-muted-foreground grid grid-cols-2 md:grid-cols-3 gap-2">
              <span>
                Impatto:{" "}
                <strong>
                  {useCase.overallImpactScore?.toFixed(1) ?? "-"}
                </strong>
              </span>
              <span>
                Fattibilità:{" "}
                <strong>
                  {useCase.overallFeasibilityScore?.toFixed(1) ?? "-"}
                </strong>
              </span>
              {esgEnabled && (
                <span>
                  ESG:{" "}
                  <strong>
                    {useCase.overallEsgScore?.toFixed(1) ?? "-"}
                  </strong>
                </span>
              )}
            </div>
            <ReviewForm
              workspaceId={workspaceId}
              useCaseId={useCaseId}
              config={model.resolvedConfig}
              esgEnabled={esgEnabled}
              initial={{
                customScores: useCase.customScores ?? {},
                portfolioReviewStatus: useCase.portfolioReviewStatus,
                reviewNotes: useCase.reviewNotes ?? "",
              }}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
