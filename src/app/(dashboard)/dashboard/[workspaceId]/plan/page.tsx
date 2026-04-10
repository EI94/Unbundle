import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { getUseCasesByWorkspace } from "@/lib/db/queries/use-cases";
import { GanttChart } from "@/components/dashboard/gantt-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, ArrowRight } from "lucide-react";
import Link from "next/link";

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

export default async function PlanPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { workspaceId } = await params;
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) notFound();

  const useCases = await getUseCasesByWorkspace(workspaceId);
  const sorted = [...useCases].sort(
    (a, b) => (a.sequenceOrder ?? 99) - (b.sequenceOrder ?? 99)
  );

  const quickWins = sorted.filter((uc) => uc.category === "quick_win");
  const strategicBets = sorted.filter((uc) => uc.category === "strategic_bet");
  const capabilityBuilders = sorted.filter(
    (uc) => uc.category === "capability_builder"
  );

  const phases = [
    {
      title: "Fase 1 — Quick Wins (0-3 mesi)",
      description: "Use case ad alto impatto e alta fattibilita'. Risultati rapidi.",
      items: quickWins,
    },
    {
      title: "Fase 2 — Capability Builders (3-6 mesi)",
      description:
        "Use case che costruiscono capacita' interna e preparano il terreno.",
      items: capabilityBuilders,
    },
    {
      title: "Fase 3 — Strategic Bets (6-12 mesi)",
      description:
        "Use case ad alto impatto ma complessita' maggiore. Richiedono investimento.",
      items: strategicBets,
    },
  ];

  return (
    <div className="flex-1 p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Unbundle Plan</h1>
        <p className="mt-1 text-muted-foreground">
          Piano operativo di trasformazione con sequencing a 6 mesi
        </p>
      </div>

      {useCases.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-12 text-center">
          <FileText className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold">Nessun use case disponibile</h3>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Genera prima i use case dalla pagina Use Cases per costruire il
            piano.
          </p>
        </div>
      ) : (
        <Tabs defaultValue="gantt">
          <TabsList>
            <TabsTrigger value="gantt">Timeline Gantt</TabsTrigger>
            <TabsTrigger value="phases">Vista Fasi</TabsTrigger>
          </TabsList>

          <TabsContent value="gantt" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Piano di Sequencing a 6 Mesi</CardTitle>
              </CardHeader>
              <CardContent>
                <GanttChart useCases={useCases} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="phases" className="mt-6">
            <div className="max-w-4xl space-y-8">
              {phases.map((phase) => (
                <div key={phase.title}>
                  <h2 className="text-lg font-semibold mb-1">{phase.title}</h2>
                  <p className="text-sm text-muted-foreground mb-4">
                    {phase.description}
                  </p>

                  {phase.items.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic pl-4">
                      Nessun use case in questa fase
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {phase.items.map((uc, idx) => (
                        <Card key={uc.id} className="group">
                          <CardContent className="flex items-center gap-4 p-4">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-sm font-semibold text-primary">
                              {idx + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <p className="font-medium text-sm">
                                  {uc.title}
                                </p>
                                <Badge
                                  variant="secondary"
                                  className={`text-xs ${
                                    categoryColors[uc.category ?? "not_yet"]
                                  }`}
                                >
                                  {categoryLabels[uc.category ?? "not_yet"]}
                                </Badge>
                              </div>
                              <p className="text-xs text-muted-foreground line-clamp-1">
                                {uc.description}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="font-mono text-sm font-semibold">
                                {uc.overallScore?.toFixed(1)}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {uc.timeline}
                              </div>
                            </div>
                            <Link
                              href={`/dashboard/${workspaceId}/use-cases/${uc.id}`}
                            >
                              <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                            </Link>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
