import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import { legacyRouteRedirect, stubLogEntry } from "@/lib/use-cases/legacy-routes";
import { notFound, redirect } from "next/navigation";
import type { SessionUser } from "@/lib/auth";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { getUseCasesByWorkspace } from "@/lib/db/queries/use-cases";
import { dossierStates } from "@/lib/db/queries/use-case-dossiers";
import type { UseCase } from "@/lib/db/schema";
import { projectForContributor, type ContributorUseCase } from "@/lib/use-cases/permissions";
import type { PhaseInput } from "@/lib/use-cases/phase";
import { romeToday } from "@/lib/use-cases/quarter";
import { GanttChart } from "@/components/dashboard/gantt-chart";
import { toGanttUseCases } from "@/lib/portfolio/use-case-client-rows";
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

/**
 * Gli use case come li vede chi non valuta (D4 e D13, docs/use-case/DESIGN.md §11):
 * titolo, fase e «Quando»; delle proprie proposte anche il codice. Niente schede nascoste
 * altrui. In ordine di arrivo, dalla più recente, come /portfolio: `getUseCasesByWorkspace`
 * ordina per punteggio, e quell'ordine è la classifica dei revisori.
 */
async function contributorItems(workspaceId: string, user: SessionUser, rows: UseCase[]): Promise<ContributorUseCase[]> {
  const read = await dossierStates(workspaceId, rows.map((row) => row.id));
  const today = romeToday();
  const viewer = { userId: user.id, email: user.email, emailVerified: user.emailVerified };
  const byArrival = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id));
  return byArrival.flatMap((row) => {
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

export default async function PlanPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {

  const { workspaceId } = await params;

  // Area «Use case» accesa: questa pagina vive nell'area (docs/use-case/DESIGN.md §2.3, §2.4).
  // 307, mai 308, prima di ogni lettura: se l'area si spegne il vecchio indirizzo torna com'era.
  if (isUseCaseHubWorkspace(workspaceId)) {
    const legacy = legacyRouteRedirect(`/dashboard/${workspaceId}/plan`, null);
    if (legacy) {
      console.info(JSON.stringify(stubLogEntry(legacy.from)));
      redirect(legacy.to);
    }
  }

  const { session, access } = await requireWorkspacePage(workspaceId);
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) notFound();

  const useCases = await getUseCasesByWorkspace(workspaceId);

  // D4: niente cifre, zone e sequenza per chi non valuta: titolo, fase e «Quando».
  if (!canReviewWorkspacePortfolio(access.role)) {
    const items = await contributorItems(workspaceId, session.user, useCases);
    return (
      <div className="flex-1 p-6 lg:p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Unbundle Plan</h1>
          <p className="mt-1 text-muted-foreground">
            Gli use case del workspace e a che punto sono.
          </p>
        </div>
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-12 text-center">
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">Nessun use case disponibile</h3>
          </div>
        ) : (
          <Card>
            <CardContent className="py-0">
              <ul className="divide-y">
                {items.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
                    <div className="min-w-0">
                      {item.own && item.code && <div className="font-mono text-xs text-muted-foreground">{item.code}</div>}
                      <Link href={`/dashboard/${workspaceId}/use-cases/${item.id}`} className="font-medium text-sm break-words hover:underline">
                        {item.title}
                      </Link>
                    </div>
                    <Badge variant="outline">{item.phaseLabel}</Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }
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
                <GanttChart useCases={toGanttUseCases(useCases)} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="phases" className="mt-6">
            <div className="mx-auto max-w-4xl space-y-8">
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
