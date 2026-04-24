import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { getUseCaseById } from "@/lib/db/queries/use-cases";
import {
  savePortfolioReviewAction,
  suggestPortfolioScoresWithAiAction,
} from "@/lib/actions/portfolio";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const kindLabels: Record<string, string> = {
  best_practice: "Best Practice",
  use_case_ai: "Use Case AI",
};

export default async function PortfolioReviewPage({
  params,
}: {
  params: Promise<{ workspaceId: string; useCaseId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { workspaceId, useCaseId } = await params;
  const [workspace, useCase] = await Promise.all([
    getWorkspaceById(workspaceId),
    getUseCaseById(useCaseId),
  ]);
  if (!workspace || !useCase || useCase.workspaceId !== workspaceId) notFound();

  const isPortfolio = !!useCase.portfolioKind;
  if (!isPortfolio) notFound();

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
              {useCase.portfolioReviewStatus}
            </Badge>
          </div>
          <p className="mt-1 text-muted-foreground max-w-2xl">
            Valuta con rubriche 0–5. Puoi anche farti suggerire i punteggi dall’AI e poi
            aggiustarli.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/dashboard/${workspaceId}/portfolio`}>
            <Button variant="outline">Torna all’inbox</Button>
          </Link>
          <form action={suggestPortfolioScoresWithAiAction.bind(null, workspaceId, useCaseId)}>
            <Button variant="secondary" type="submit">
              Suggerisci punteggi con AI
            </Button>
          </form>
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
          <CardContent className="space-y-6">
            <form
              action={savePortfolioReviewAction.bind(null, workspaceId, useCaseId)}
              className="space-y-6"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">Impact Flag (opzionale)</div>
                  <div className="text-xs text-muted-foreground">
                    Se l’azienda lo ha attivato, quando questo flag è ON il ranking considera
                    anche ESG.
                  </div>
                </div>
                <Switch name="impactFlag" defaultChecked={useCase.impactFlag === true} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="font-medium">Impatto</div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input name="impactEconomic" type="number" min="0" max="5" step="0.5" defaultValue={useCase.impactEconomic ?? ""} placeholder="Economico" />
                    <Input name="impactTime" type="number" min="0" max="5" step="0.5" defaultValue={useCase.impactTime ?? ""} placeholder="Tempo" />
                    <Input name="impactQuality" type="number" min="0" max="5" step="0.5" defaultValue={useCase.impactQuality ?? ""} placeholder="Qualità" />
                    <Input name="impactCoordination" type="number" min="0" max="5" step="0.5" defaultValue={useCase.impactCoordination ?? ""} placeholder="Coordinamento" />
                    <Input name="impactSocial" type="number" min="0" max="5" step="0.5" defaultValue={useCase.impactSocial ?? ""} placeholder="Social" />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Asse Y matrice: {useCase.overallImpactScore?.toFixed(1) ?? "-"}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="font-medium">Fattibilità</div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input name="feasibilityData" type="number" min="0" max="5" step="0.5" defaultValue={useCase.feasibilityData ?? ""} placeholder="Dati" />
                    <Input name="feasibilityWorkflow" type="number" min="0" max="5" step="0.5" defaultValue={useCase.feasibilityWorkflow ?? ""} placeholder="Workflow" />
                    <Input name="feasibilityRisk" type="number" min="0" max="5" step="0.5" defaultValue={useCase.feasibilityRisk ?? ""} placeholder="Rischio" />
                    <Input name="feasibilityTech" type="number" min="0" max="5" step="0.5" defaultValue={useCase.feasibilityTech ?? ""} placeholder="Tech" />
                    <Input name="feasibilityTeam" type="number" min="0" max="5" step="0.5" defaultValue={useCase.feasibilityTeam ?? ""} placeholder="Team" />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Asse X matrice: {useCase.overallFeasibilityScore?.toFixed(1) ?? "-"}
                  </div>
                </div>
              </div>

              {workspace.esgEnabled === true && (
                <div className="space-y-2">
                  <div className="font-medium">ESG (0–5)</div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <Input name="esgEnvironmental" type="number" min="0" max="5" step="0.5" defaultValue={useCase.esgEnvironmental ?? ""} placeholder="Environmental" />
                    <Input name="esgSocial" type="number" min="0" max="5" step="0.5" defaultValue={useCase.esgSocial ?? ""} placeholder="Social" />
                    <Input name="esgGovernance" type="number" min="0" max="5" step="0.5" defaultValue={useCase.esgGovernance ?? ""} placeholder="Governance" />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    ESG medio: {useCase.overallEsgScore?.toFixed(1) ?? "-"} (entra nel ranking solo se il motore Impact Flag è ON e questo caso ha flag ON)
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Stato review</label>
                  <Input
                    name="portfolioReviewStatus"
                    defaultValue={useCase.portfolioReviewStatus}
                    placeholder="needs_inputs | in_review | scored | archived"
                  />
                  <div className="text-xs text-muted-foreground mt-1">
                    Per ora è un campo testuale guidato; lo rendiamo select nel prossimo pass.
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium">Note reviewer</label>
                  <Textarea
                    name="reviewNotes"
                    defaultValue={useCase.reviewNotes ?? ""}
                    rows={4}
                    placeholder="Note, assunzioni, cosa manca, next step…"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end">
                <Button type="submit">Salva valutazione</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

