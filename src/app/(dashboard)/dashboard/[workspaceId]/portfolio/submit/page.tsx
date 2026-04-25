import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PortfolioSubmitForm } from "@/components/portfolio/submit-form";

export default async function PortfolioSubmitPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { workspaceId } = await params;
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) notFound();

  const teamName =
    workspace.aiTransformationTeamName?.trim() || "AI Transformation";
  const esgEnabled = workspace.esgEnabled === true;

  return (
    <div className="flex-1 p-6 lg:p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Nuovo contributo</h1>
        <p className="mt-1 text-muted-foreground max-w-2xl">
          Compila in modo semplice. Alla fine ti ringraziamo e il team{" "}
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
