import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { getPortfolioContributionsByWorkspace } from "@/lib/db/queries/use-cases";
import { getOrCreateWorkspaceScoringModel } from "@/lib/db/queries/scoring-model";
import {
  updateAiTransformationTeamNameAction,
  updateScoringModelAction,
} from "@/lib/actions/portfolio";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

const portfolioKindLabels: Record<string, string> = {
  best_practice: "Best Practice",
  use_case_ai: "Use Case AI",
};

const reviewStatusLabels: Record<string, string> = {
  needs_inputs: "Dati mancanti",
  in_review: "In review",
  scored: "Valutato",
  archived: "Archiviato",
};

export default async function PortfolioPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ thanks?: string; created?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { workspaceId } = await params;
  const sp = await searchParams;

  const [workspace, model, contributions] = await Promise.all([
    getWorkspaceById(workspaceId),
    getOrCreateWorkspaceScoringModel(workspaceId),
    getPortfolioContributionsByWorkspace(workspaceId),
  ]);
  if (!workspace) notFound();

  const teamName = workspace.aiTransformationTeamName?.trim() || "AI Transformation";

  return (
    <div className="flex-1 p-6 lg:p-8 space-y-6">
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Raccolta & Ranking</h1>
          <p className="mt-1 text-muted-foreground max-w-2xl">
            Raccogli best practice e use case AI anche prima della discovery. Il team{" "}
            <strong>{teamName}</strong> li valuta e li posiziona nella matrice Impatto /
            Fattibilità con parametri configurabili.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href={`/dashboard/${workspaceId}/portfolio/submit`}>
            <Button>Nuovo contributo</Button>
          </Link>
        </div>
      </div>

      {sp.thanks === "1" && (
        <Card className="border-green-500/30 bg-green-500/5">
          <CardContent className="p-4 text-sm">
            <div className="font-medium">Grazie! Contributo inviato.</div>
            <div className="text-muted-foreground">
              Il team {teamName} lo vedrà nell’inbox e potrà valutarlo con l’aiuto dell’AI.
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Inbox contributi</CardTitle>
          </CardHeader>
          <CardContent>
            {contributions.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                Nessun contributo ancora. Clicca “Nuovo contributo” per inserirne uno in
                modo semplice.
              </div>
            ) : (
              <div className="space-y-3">
                {contributions.map((uc) => (
                  <div
                    key={uc.id}
                    className="flex items-start justify-between gap-4 rounded-lg border p-4"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="font-medium text-sm truncate">{uc.title}</div>
                        {uc.portfolioKind && (
                          <Badge variant="secondary" className="text-xs">
                            {portfolioKindLabels[uc.portfolioKind] ?? uc.portfolioKind}
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-xs font-normal">
                          {reviewStatusLabels[uc.portfolioReviewStatus] ??
                            uc.portfolioReviewStatus}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground line-clamp-2 mt-1">
                        {uc.description}
                      </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      <Link href={`/dashboard/${workspaceId}/portfolio/review/${uc.id}`}>
                        <Button variant="outline" size="sm">
                          Valuta
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Chi valuta?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <form
                action={updateAiTransformationTeamNameAction.bind(null, workspaceId)}
                className="space-y-3"
              >
                <label className="text-sm font-medium">
                  Nome team (usato in UI e notifiche)
                </label>
                <Input
                  name="aiTransformationTeamName"
                  defaultValue={workspace.aiTransformationTeamName ?? ""}
                  placeholder="es. AI Transformation, CoE AI, Digital Factory…"
                />
                <Button type="submit" variant="outline" className="w-full">
                  Salva
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Modello di ranking (base)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <form
                action={updateScoringModelAction.bind(null, workspaceId)}
                className="space-y-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">Motore Impact Flag</div>
                    <div className="text-xs text-muted-foreground">
                      Se ON, quando un use case ha Impact Flag attivo si considera ESG nel ranking.
                    </div>
                  </div>
                  <Switch
                    name="impactFlagEnabled"
                    defaultChecked={model.impactFlagEnabled === true}
                  />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-3 font-medium text-xs text-muted-foreground">
                    Soglie matrice (0–5)
                  </div>
                  <div>
                    <label className="text-xs">High Impact</label>
                    <Input
                      name="threshold_highImpact"
                      type="number"
                      step="0.1"
                      min="0"
                      max="5"
                      defaultValue={model.config?.thresholds.highImpact ?? 3.5}
                    />
                  </div>
                  <div>
                    <label className="text-xs">High Feasibility</label>
                    <Input
                      name="threshold_highFeasibility"
                      type="number"
                      step="0.1"
                      min="0"
                      max="5"
                      defaultValue={model.config?.thresholds.highFeasibility ?? 3.5}
                    />
                  </div>
                  <div>
                    <label className="text-xs">Mid Impact</label>
                    <Input
                      name="threshold_midImpact"
                      type="number"
                      step="0.1"
                      min="0"
                      max="5"
                      defaultValue={model.config?.thresholds.midImpact ?? 2.5}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-3 font-medium text-xs text-muted-foreground">
                    Pesi ranking (normalizzati)
                  </div>
                  <div>
                    <label className="text-xs">Impatto</label>
                    <Input
                      name="weight_overallImpact"
                      type="number"
                      step="0.05"
                      min="0"
                      defaultValue={model.config?.weights.overall.impact ?? 0.5}
                    />
                  </div>
                  <div>
                    <label className="text-xs">Fattibilità</label>
                    <Input
                      name="weight_overallFeasibility"
                      type="number"
                      step="0.05"
                      min="0"
                      defaultValue={model.config?.weights.overall.feasibility ?? 0.5}
                    />
                  </div>
                  <div>
                    <label className="text-xs">ESG (quando Flag)</label>
                    <Input
                      name="weight_overallEsg"
                      type="number"
                      step="0.05"
                      min="0"
                      defaultValue={model.config?.weights.overall.esgWhenEnabled ?? 0.2}
                    />
                  </div>
                </div>

                <Button type="submit" className="w-full">
                  Salva modello
                </Button>
              </form>

              <div className="text-xs text-muted-foreground">
                Nota: la configurazione avanzata (pesi per singola dimensione) la aggiungiamo
                nel prossimo step, ma il workflow di raccolta/review è già operativo.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

