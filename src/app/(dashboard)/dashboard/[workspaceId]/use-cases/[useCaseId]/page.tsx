import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { getUseCaseById, getUseCaseKRLinks } from "@/lib/db/queries/use-cases";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

const categoryLabels: Record<string, string> = {
  quick_win: "Quick Win",
  strategic_bet: "Strategic Bet",
  capability_builder: "Capability Builder",
  not_yet: "Not Yet",
};

const statusLabels: Record<string, string> = {
  draft: "Bozza",
  proposed: "Proposto",
  accepted: "Accettato",
  in_progress: "In corso",
  implemented: "Implementato",
  rejected: "Rifiutato",
};

export default async function UseCaseDetailPage({
  params,
}: {
  params: Promise<{ workspaceId: string; useCaseId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { workspaceId, useCaseId } = await params;
  const useCase = await getUseCaseById(useCaseId);
  if (!useCase || useCase.workspaceId !== workspaceId) notFound();

  const krLinks = await getUseCaseKRLinks(useCaseId);

  const impactItems = [
    { label: "Economico", value: useCase.impactEconomic },
    { label: "Tempo", value: useCase.impactTime },
    { label: "Qualita'", value: useCase.impactQuality },
    { label: "Coordinamento", value: useCase.impactCoordination },
    { label: "Sociale", value: useCase.impactSocial },
  ];

  const feasibilityItems = [
    { label: "Dati", value: useCase.feasibilityData },
    { label: "Workflow", value: useCase.feasibilityWorkflow },
    { label: "Rischio", value: useCase.feasibilityRisk },
    { label: "Tech", value: useCase.feasibilityTech },
    { label: "Team", value: useCase.feasibilityTeam },
  ];

  const esgItems = [
    { label: "Ambientale", value: useCase.esgEnvironmental, color: "text-green-400" },
    { label: "Sociale", value: useCase.esgSocial, color: "text-blue-400" },
    { label: "Governance", value: useCase.esgGovernance, color: "text-violet-400" },
  ];

  const hasEsg = esgItems.some((i) => (i.value ?? 0) > 0);

  return (
    <div className="flex-1 p-6 lg:p-8 max-w-4xl">
      <Link href={`/dashboard/${workspaceId}/use-cases`}>
        <Button variant="ghost" size="sm" className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Torna al portfolio
        </Button>
      </Link>

      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Badge variant="outline" className="uppercase text-xs">
            {categoryLabels[useCase.category ?? "not_yet"]}
          </Badge>
          <Badge variant="secondary" className="text-xs">
            {statusLabels[useCase.status]}
          </Badge>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">{useCase.title}</h1>
        <p className="mt-2 text-muted-foreground">{useCase.description}</p>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8">
        <Card>
          <CardContent className="pt-4 text-center">
            <div className="text-3xl font-bold text-primary">
              {useCase.overallImpactScore?.toFixed(1)}
            </div>
            <p className="text-sm text-muted-foreground">Impatto</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <div className="text-3xl font-bold text-primary">
              {useCase.overallFeasibilityScore?.toFixed(1)}
            </div>
            <p className="text-sm text-muted-foreground">Fattibilita&apos;</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <div className="text-3xl font-bold text-green-400">
              {useCase.overallEsgScore?.toFixed(1) ?? "-"}
            </div>
            <p className="text-sm text-muted-foreground">ESG</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <div className="text-3xl font-bold">
              {useCase.overallScore?.toFixed(1)}
            </div>
            <p className="text-sm text-muted-foreground">Score totale</p>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Business Case</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm whitespace-pre-wrap">{useCase.businessCase}</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-6 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Scoring Impatto</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {impactItems.map((item) => (
              <div key={item.label}>
                <div className="flex justify-between text-sm mb-1">
                  <span>{item.label}</span>
                  <span className="font-mono">{item.value ?? 0}/5</span>
                </div>
                <Progress
                  value={((item.value ?? 0) / 5) * 100}
                  className="h-2"
                />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Scoring Fattibilita&apos;
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {feasibilityItems.map((item) => (
              <div key={item.label}>
                <div className="flex justify-between text-sm mb-1">
                  <span>{item.label}</span>
                  <span className="font-mono">{item.value ?? 0}/5</span>
                </div>
                <Progress
                  value={((item.value ?? 0) / 5) * 100}
                  className="h-2"
                />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {hasEsg && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">ESG Impact</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {esgItems.map((item) => (
              <div key={item.label}>
                <div className="flex justify-between text-sm mb-1">
                  <span className={item.color}>{item.label}</span>
                  <span className="font-mono">{item.value ?? 0}/5</span>
                </div>
                <Progress
                  value={((item.value ?? 0) / 5) * 100}
                  className="h-2"
                />
              </div>
            ))}
            <Separator className="my-2" />
            <div className="flex justify-between text-sm font-medium">
              <span>Score ESG complessivo</span>
              <span className="font-mono">
                {useCase.overallEsgScore?.toFixed(1) ?? "-"}/5
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {useCase.requirements && (useCase.requirements as string[]).length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Requisiti</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc list-inside space-y-1 text-sm">
              {(useCase.requirements as string[]).map((req, i) => (
                <li key={i}>{req}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {useCase.timeline && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{useCase.timeline}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
