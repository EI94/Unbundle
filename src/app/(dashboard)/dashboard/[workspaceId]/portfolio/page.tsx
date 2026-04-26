import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { getPortfolioContributionsByWorkspace } from "@/lib/db/queries/use-cases";
import { getOrCreateWorkspaceScoringModel } from "@/lib/db/queries/scoring-model";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  TeamNameForm,
  WhatsappWebhookForm,
} from "@/components/portfolio/team-settings-form";
import { ScoringModelForm } from "@/components/portfolio/scoring-model-form";
import { RankingMatrix } from "@/components/portfolio/ranking-matrix";
import { WavePlanner } from "@/components/portfolio/wave-planner";

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

  const esgEnabled = workspace.esgEnabled === true;
  const teamName =
    workspace.aiTransformationTeamName?.trim() || "AI Transformation";

  return (
    <div className="flex-1 p-6 lg:p-8 space-y-6">
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Raccolta & Ranking</h1>
          <p className="mt-1 text-muted-foreground max-w-2xl">
            Raccogli best practice e use case AI anche prima della discovery. Il
            team <strong>{teamName}</strong> li valuta e li posiziona sulla matrice
            Impatto / Fattibilità con KPI visibili e modificabili: Efficiency,
            Profitability, Effort e Sustainability quando ESG è attivo.
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
              Il team {teamName} lo vedrà nell&apos;inbox e potrà valutarlo con
              l&apos;aiuto dell&apos;AI.
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Ranking contributi</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <RankingMatrix
              workspaceId={workspaceId}
              items={contributions}
              thresholds={model.resolvedConfig.thresholds}
              config={model.resolvedConfig}
              esgEnabled={esgEnabled}
            />
            <WavePlanner
              workspaceId={workspaceId}
              items={contributions}
              config={model.resolvedConfig}
              esgEnabled={esgEnabled}
            />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Chi valuta?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <TeamNameForm
                workspaceId={workspaceId}
                initialName={workspace.aiTransformationTeamName ?? ""}
              />
              <WhatsappWebhookForm
                workspaceId={workspaceId}
                initialUrl={workspace.whatsappWebhookUrl ?? ""}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Modello di ranking</CardTitle>
            </CardHeader>
            <CardContent>
              <ScoringModelForm
                workspaceId={workspaceId}
                initialConfig={model.resolvedConfig}
                esgEnabled={esgEnabled}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
