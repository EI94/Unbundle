import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import { legacyRouteRedirect, stubLogEntry } from "@/lib/use-cases/legacy-routes";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import { canManageWorkspaceSettings, canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";
import { roleLabel } from "@/lib/workspace-roles";
import { getPortfolioContributionsByWorkspace } from "@/lib/db/queries/use-cases";
import { getOrCreateWorkspaceScoringModel } from "@/lib/db/queries/scoring-model";
import { dossierStates } from "@/lib/db/queries/use-case-dossiers";
import type { UseCase } from "@/lib/db/schema";
import { projectForContributor, type ContributorUseCase } from "@/lib/use-cases/permissions";
import type { PhaseInput } from "@/lib/use-cases/phase";
import { romeToday } from "@/lib/use-cases/quarter";
import { reviewTeamName } from "@/lib/review-team";
import { getPortfolioParticipation } from "@/lib/db/queries/portfolio-participation";
import { toPortfolioClientItems } from "@/lib/portfolio/client-items";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RankingMatrix } from "@/components/portfolio/ranking-matrix";
import { WavePlanner } from "@/components/portfolio/wave-planner";
import { PortfolioSettingsSheet } from "@/components/portfolio/portfolio-settings-sheet";
import { ParticipationCard } from "@/components/portfolio/participation-card";

/**
 * Le proposte come le vede chi non valuta (D4 e D13, docs/use-case/DESIGN.md §11): titolo,
 * fase e «Quando»; delle proprie anche il codice. Niente schede nascoste altrui.
 */
async function contributorItems(workspaceId: string, user: SessionUser, rows: UseCase[]): Promise<ContributorUseCase[]> {
  const read = await dossierStates(workspaceId, rows.map((row) => row.id));
  const today = romeToday();
  const viewer = { userId: user.id, email: user.email, emailVerified: user.emailVerified };
  return rows.flatMap((row) => {
    const dossier = read.ok ? read.states.get(row.id.toLowerCase()) : undefined;
    const item = projectForContributor(viewer, {
      ...row,
      intake: row.intake as PhaseInput["intake"],
      linkedCaseCode: dossier?.code ?? null,
      dossierStatus: dossier?.status ?? null,
      duplicateOfCode: null,
      today,
    });
    return item ? [item] : [];
  });
}

export default async function PortfolioPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ thanks?: string | string[]; created?: string | string[]; joined?: string | string[] }>;
}) {
  const { workspaceId } = await params;

  // Area «Use case» accesa: questa pagina vive nell'area (docs/use-case/DESIGN.md §2.3, §2.4).
  // 307, mai 308, prima di ogni lettura: se l'area si spegne il vecchio indirizzo torna com'era.
  if (isUseCaseHubWorkspace(workspaceId)) {
    const legacy = legacyRouteRedirect(`/dashboard/${workspaceId}/portfolio`, await searchParams);
    if (legacy) {
      console.info(JSON.stringify(stubLogEntry(legacy.from)));
      redirect(legacy.to);
    }
  }

  const { session, access } = await requireWorkspacePage(workspaceId);
  const sp = await searchParams;
  const { workspace } = access;
  const canManageSettings = canManageWorkspaceSettings(access.role);
  // D4: punteggi, KPI, note, matrice, wave planner ed «Export Excel» solo a chi valuta.
  const canReview = canReviewWorkspacePortfolio(access.role);
  const joined = typeof sp.joined === "string" ? sp.joined : null;

  const [model, contributions, participation] = await Promise.all([
    canReview ? getOrCreateWorkspaceScoringModel(workspaceId) : null,
    getPortfolioContributionsByWorkspace(workspaceId),
    getPortfolioParticipation(workspaceId),
  ]);
  const ownView = canReview ? null : await contributorItems(workspaceId, session.user, contributions);

  // The URL identifies a receipt, never permission to view another author's proposal.
  const createdContribution = typeof sp.created === "string"
    ? contributions.find(contribution => contribution.id === sp.created
      && contribution.source === "learning" && contribution.proposedBy === session.user.id)
    : undefined;
  // Al browser vanno solo le righe ridotte: chi propone e l'intake restano sul server.
  const items = toPortfolioClientItems(contributions, { canReview });
  const reviewStatusLabels: Record<string, string> = {
    needs_inputs: "Dati mancanti", in_review: "In valutazione", scored: "Valutato", archived: "Archiviato",
  };

  const esgEnabled = workspace.esgEnabled === true;
  // Il nome da solo, senza articolo né «team» davanti (DESIGN §14.2).
  const teamName = reviewTeamName(workspace);

  return (
    <div className="flex-1 p-6 lg:p-8 space-y-6">
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Raccolta & Ranking</h1>
          {canReview ? (
            <p className="mt-1 text-muted-foreground max-w-2xl">
              Raccogli best practice e use case AI anche prima della discovery. Li
              valuta <strong>{teamName}</strong> e li posiziona sulla matrice
              Impatto / Fattibilità con KPI visibili e modificabili: Efficiency,
              Profitability, Effort e Sustainability quando ESG è attivo.
            </p>
          ) : (
            <p className="mt-1 text-muted-foreground max-w-2xl">
              Proponi best practice e use case AI: li valuta <strong>{teamName}</strong>.
              Qui vedi a che punto sono.
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {canManageSettings && model && <PortfolioSettingsSheet
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
              {teamName}{" "}lo vedrà nell&apos;inbox e potrà valutarlo con
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
          <p className="text-muted-foreground">
            L’invio non avvia un progetto o un’automazione.{" "}
            {canReview
              ? "La proposta può comparire nella matrice dopo la valutazione dei referenti."
              : "Trovi la sua fase nella lista qui sotto."}
          </p>
        </CardContent>
      </Card>}

      {canReview && model ? (
        <Card>
          <CardHeader>
            <CardTitle>Ranking contributi</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <RankingMatrix
              workspaceId={workspaceId}
              teamName={teamName}
              items={items}
              thresholds={model.resolvedConfig.thresholds}
              config={model.resolvedConfig}
              esgEnabled={esgEnabled}
            />
            <WavePlanner
              workspaceId={workspaceId}
              items={items}
              config={model.resolvedConfig}
              esgEnabled={esgEnabled}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Use case</CardTitle>
          </CardHeader>
          <CardContent>
            {ownView && ownView.length > 0 ? (
              <ul className="divide-y">
                {ownView.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
                    <div className="min-w-0">
                      {item.own && item.code && <div className="font-mono text-xs text-muted-foreground">{item.code}</div>}
                      <Link href={`/dashboard/${workspaceId}/portfolio/review/${item.id}`} className="font-medium break-words hover:underline">
                        {item.title}
                      </Link>
                    </div>
                    <Badge variant="outline">{item.phaseLabel}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Ancora nessuna proposta da mostrare.</p>
            )}
          </CardContent>
        </Card>
      )}

      {participation && <ParticipationCard participation={participation} />}
    </div>
  );
}
