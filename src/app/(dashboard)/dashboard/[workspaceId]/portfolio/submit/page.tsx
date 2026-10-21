import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import { legacyRouteRedirect, stubLogEntry } from "@/lib/use-cases/legacy-routes";
import { notFound, redirect } from "next/navigation";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { reviewTeamName } from "@/lib/review-team";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PortfolioSubmitForm } from "@/components/portfolio/submit-form";

export default async function PortfolioSubmitPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {

  const { workspaceId } = await params;

  // Area «Use case» accesa: questa pagina vive nell'area (docs/use-case/DESIGN.md §2.3, §2.4).
  // 307, mai 308, prima di ogni lettura: se l'area si spegne il vecchio indirizzo torna com'era.
  if (isUseCaseHubWorkspace(workspaceId)) {
    const legacy = legacyRouteRedirect(`/dashboard/${workspaceId}/portfolio/submit`, null);
    if (legacy) {
      console.info(JSON.stringify(stubLogEntry(legacy.from)));
      redirect(legacy.to);
    }
  }

  await requireWorkspacePage(workspaceId);
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) notFound();

  // Il nome da solo, senza articolo né «team» davanti (DESIGN §14.2).
  const teamName = reviewTeamName(workspace);
  const esgEnabled = workspace.esgEnabled === true;

  return (
    <div className="flex-1 p-6 lg:p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Nuovo contributo</h1>
        <p className="mt-1 text-muted-foreground max-w-2xl">
          Compila in modo semplice. Alla fine ti ringraziamo e{" "}
          <strong>{teamName}</strong> potrà valutare e confrontare i contributi
          sulla matrice.
        </p>
      </div>

      <Card>
        <CardHeader>
        <CardTitle>Seleziona il tipo e rispondi alle domande</CardTitle>
        </CardHeader>
        <CardContent>
          <PortfolioSubmitForm workspaceId={workspaceId} esgEnabled={esgEnabled} />
        </CardContent>
      </Card>
    </div>
  );
}
