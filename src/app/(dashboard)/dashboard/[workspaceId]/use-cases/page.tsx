import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { getUseCasesByWorkspace } from "@/lib/db/queries/use-cases";
import { getActivitiesByWorkspace } from "@/lib/db/queries/activities";
import { UseCaseMatrix } from "@/components/dashboard/use-case-matrix";
import { GenerateUseCasesButton } from "@/components/dashboard/generate-use-cases-button";
import { ClassifyButton } from "@/components/dashboard/classify-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Lightbulb, ArrowRight } from "lucide-react";

const categoryLabels: Record<string, string> = {
  quick_win: "Quick Win",
  strategic_bet: "Strategic Bet",
  capability_builder: "Capability Builder",
  not_yet: "Not Yet",
};

const categoryColors: Record<string, string> = {
  quick_win: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  strategic_bet: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  capability_builder: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  not_yet: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

export default async function UseCasesPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { workspaceId } = await params;
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) notFound();

  const [useCases, activities] = await Promise.all([
    getUseCasesByWorkspace(workspaceId),
    getActivitiesByWorkspace(workspaceId),
  ]);

  const classifiedCount = activities.filter((a) => a.classification).length;
  const needsClassification =
    activities.length > 0 && classifiedCount < activities.length;

  return (
    <div className="flex-1 p-6 lg:p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Use Cases</h1>
          <p className="mt-1 text-muted-foreground">
            Portfolio di use case AI generati dall&apos;analisi delle attivita&apos;
          </p>
        </div>
        <div className="flex gap-2">
          {needsClassification && (
            <ClassifyButton workspaceId={workspaceId} />
          )}
          <GenerateUseCasesButton workspaceId={workspaceId} />
        </div>
      </div>

      {useCases.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-12 text-center">
          <Lightbulb className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold">Nessun use case</h3>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            {activities.length === 0
              ? "Completa prima il mapping delle attivita'."
              : classifiedCount === 0
                ? "Classifica le attivita' prima di generare use case."
                : "Clicca 'Genera Use Cases' per analizzare le attivita' e proporre use case AI."}
          </p>
        </div>
      ) : (
        <Tabs defaultValue="matrix">
          <TabsList>
            <TabsTrigger value="matrix">Matrice</TabsTrigger>
            <TabsTrigger value="list">Lista</TabsTrigger>
          </TabsList>

          <TabsContent value="matrix" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Matrice Impatto / Fattibilita&apos;</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-4 mb-4 flex-wrap">
                  {Object.entries(categoryLabels).map(([key, label]) => {
                    const count = useCases.filter(
                      (uc) => uc.category === key
                    ).length;
                    return (
                      <Badge
                        key={key}
                        variant="secondary"
                        className={categoryColors[key]}
                      >
                        {label} ({count})
                      </Badge>
                    );
                  })}
                </div>
                <UseCaseMatrix useCases={useCases} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="list" className="mt-6">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Use Case</TableHead>
                      <TableHead>Categoria</TableHead>
                      <TableHead className="text-center">Impatto</TableHead>
                      <TableHead className="text-center">
                        Fattibilita&apos;
                      </TableHead>
                      <TableHead className="text-center">ESG</TableHead>
                      <TableHead className="text-center">Score</TableHead>
                      <TableHead>Timeline</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {useCases.map((uc, idx) => (
                      <TableRow key={uc.id}>
                        <TableCell className="font-mono text-muted-foreground">
                          {idx + 1}
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium text-sm">{uc.title}</p>
                            <p className="text-xs text-muted-foreground line-clamp-1">
                              {uc.description}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className={`text-xs ${
                              categoryColors[uc.category ?? "not_yet"]
                            }`}
                          >
                            {categoryLabels[uc.category ?? "not_yet"]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center font-mono text-sm">
                          {uc.overallImpactScore?.toFixed(1) ?? "-"}
                        </TableCell>
                        <TableCell className="text-center font-mono text-sm">
                          {uc.overallFeasibilityScore?.toFixed(1) ?? "-"}
                        </TableCell>
                        <TableCell className="text-center font-mono text-sm text-green-400">
                          {uc.overallEsgScore?.toFixed(1) ?? "-"}
                        </TableCell>
                        <TableCell className="text-center font-mono text-sm font-semibold">
                          {uc.overallScore?.toFixed(1) ?? "-"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {uc.timeline}
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/dashboard/${workspaceId}/use-cases/${uc.id}`}
                          >
                            <ArrowRight className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
