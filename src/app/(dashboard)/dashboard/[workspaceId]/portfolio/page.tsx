import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import Link from "next/link";
import { canManageWorkspaceSettings, canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";
import { roleLabel } from "@/lib/workspace-roles";
import { getPortfolioContributionsByWorkspace } from "@/lib/db/queries/use-cases";
import { getOrCreateWorkspaceScoringModel } from "@/lib/db/queries/scoring-model";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RankingMatrix } from "@/components/portfolio/ranking-matrix";
import { WavePlanner } from "@/components/portfolio/wave-planner";
import { PortfolioSettingsSheet } from "@/components/portfolio/portfolio-settings-sheet";

export default async function PortfolioPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ thanks?: string | string[]; created?: string | string[]; joined?: string | string[] }>;
}) {
  const { workspaceId } = await params;

  const { session, access } = await requireWorkspacePage(workspaceId);
  const sp = await searchParams;
  const { workspace } = access;
  const canManageSettings = canManageWorkspaceSettings(access.role);
  const canReview = canReviewWorkspacePortfolio(access.role);
  const joined = typeof sp.joined === "string" ? sp.joined : null;

  const [model, contributions] = await Promise.all([
    getOrCreateWorkspaceScoringModel(workspaceId),
    getPortfolioContributionsByWorkspace(workspaceId),
  ]);

  // The URL identifies a receipt, never permission to view another author's proposal.
  const createdContribution = typeof sp.created === "string"
    ? contributions.find(contribution => contribution.id === sp.created
      && contribution.source === "learning" && contribution.proposedBy === session.user.id)
    : undefined;
  const reviewStatusLabels: Record<string, string> = {
    needs_inputs: "Dati mancanti", in_review: "In valutazione", scored: "Valutato", archived: "Archiviato",
  };

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
          {canManageSettings && <PortfolioSettingsSheet
            workspaceId={workspaceId}
            teamName={teamName}
            initialTeamName={workspace.aiTransformationTeamName ?? ""}
            initialWhatsappUrl={workspace.whatsappWebhookUrl ?? ""}
            initialConfig={model.resolvedConfig}
            esgEnabled={esgEnabled}
          />}
          <Link href={`/dashboard/${workspaceId}/portfolio/submit`}>
            <Button>Nuovo contributo</Button>
          </Link>
        </div>
      </div>

      {(joined === "1" || joined === "upgraded") && (
        <Card className="border-emerald-500/30 bg-emerald-500/5" data-testid="workspace-welcome">
          <CardContent className="space-y-1 p-4 text-sm">
            <div className="font-medium">Benvenuto in {workspace.name}!</div>
            <div className="text-muted-foreground">
              Ora collabori come {roleLabel(access.role)}
              {joined === "upgraded" ? " e continui a seguire i tuoi corsi" : ""}. Per iniziare, proponi un use
              case con «Nuovo contributo».
            </div>
          </CardContent>
        </Card>
      )}
      {joined === "already" && (
        <Card className="border-sky-500/30 bg-sky-500/5" data-testid="workspace-already-member">
          <CardContent className="p-4 text-sm">
            Eri già in {workspace.name} come {roleLabel(access.role)}: l&apos;invito non ha cambiato il tuo ruolo.
          </CardContent>
        </Card>
      )}

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

      {createdContribution && <Card className="border-green-500/30 bg-green-500/5">
        <CardHeader><CardTitle>Proposta ricevuta nel portfolio</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="font-medium break-words">{createdContribution.title}</p>
          <p>Stato di valutazione: {reviewStatusLabels[createdContribution.portfolioReviewStatus] ?? createdContribution.portfolioReviewStatus}.</p>
          <p className="text-muted-foreground">L’invio non avvia un progetto o un’automazione. La proposta può comparire nella matrice dopo la valutazione dei referenti.</p>
        </CardContent>
      </Card>}

      <Card>
        <CardHeader>
          <CardTitle>Ranking contributi</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <RankingMatrix
            workspaceId={workspaceId}
            teamName={teamName}
            items={contributions}
            thresholds={model.resolvedConfig.thresholds}
            config={model.resolvedConfig}
            esgEnabled={esgEnabled}
            canReview={canReview}
          />
          <WavePlanner
            workspaceId={workspaceId}
            items={contributions}
            config={model.resolvedConfig}
            esgEnabled={esgEnabled}
          />
        </CardContent>
      </Card>
    </div>
  );
}
