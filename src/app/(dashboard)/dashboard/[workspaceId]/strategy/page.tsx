import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { getWorkspaceById, getStrategicGoalsByWorkspace } from "@/lib/db/queries/workspaces";
import { GoalForm } from "@/components/dashboard/goal-form";
import { SuggestOKRsButton } from "@/components/dashboard/suggest-okrs-button";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

export default async function StrategyPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { workspaceId } = await params;
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) notFound();

  const goals = await getStrategicGoalsByWorkspace(workspaceId);
  const topLevelGoals = goals.filter((g) => !g.parentId);
  const getChildren = (parentId: string) =>
    goals.filter((g) => g.parentId === parentId);

  const directionIcon = (d: string | null) => {
    switch (d) {
      case "increase":
        return <TrendingUp className="h-3 w-3 text-green-500" />;
      case "decrease":
        return <TrendingDown className="h-3 w-3 text-red-500" />;
      default:
        return <Minus className="h-3 w-3 text-muted-foreground" />;
    }
  };

  return (
    <div className="flex-1 p-8 lg:p-12 max-w-3xl">
      <div className="mb-8">
        <span className="text-xs text-muted-foreground tracking-wide uppercase">
          Strategia
        </span>
        <h1 className="mt-1 text-2xl font-medium tracking-tight">
          Obiettivi & OKR
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Definisci gli obiettivi che guideranno la prioritizzazione dei use case.
        </p>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <GoalForm
          workspaceId={workspaceId}
          parentGoals={goals}
          defaultType="goal"
        />
        <SuggestOKRsButton workspaceId={workspaceId} />
      </div>

      {goals.length === 0 ? (
        <div className="mt-16 text-center max-w-md mx-auto">
          <h2 className="text-lg font-medium">Nessun obiettivo</h2>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            Aggiungi goal strategici, obiettivi e key result.
            Oppure lascia che l&apos;AI suggerisca un framework OKR basato sulla tua Value Thesis.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {topLevelGoals.map((goal) => {
            const objectives = getChildren(goal.id);
            return (
              <div key={goal.id} className="rounded-lg border border-border p-5">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground uppercase">Goal</span>
                    <span className="text-sm font-medium">{goal.title}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {goal.owner && <span>{goal.owner}</span>}
                    {goal.timeframe && <span>{goal.timeframe}</span>}
                  </div>
                </div>
                {goal.description && (
                  <p className="text-xs text-muted-foreground mb-3">
                    {goal.description}
                  </p>
                )}

                {objectives.length > 0 && (
                  <div className="space-y-3 mt-3 pl-3 border-l border-border">
                    {objectives.map((obj) => {
                      const krs = getChildren(obj.id);
                      return (
                        <div key={obj.id}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs text-muted-foreground uppercase">Obj</span>
                            <span className="text-sm">{obj.title}</span>
                          </div>
                          {krs.length > 0 && (
                            <div className="mt-1.5 space-y-1 pl-3">
                              {krs.map((kr) => (
                                <div
                                  key={kr.id}
                                  className="flex items-center justify-between rounded-lg bg-accent/50 px-3 py-2 text-sm"
                                >
                                  <div className="flex items-center gap-2">
                                    {directionIcon(kr.direction)}
                                    <span className="text-xs">{kr.title}</span>
                                  </div>
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    {kr.kpiName && <span>{kr.kpiName}</span>}
                                    {kr.currentValue != null && kr.targetValue != null && (
                                      <span className="font-mono">
                                        {kr.currentValue} &rarr; {kr.targetValue}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ))}
                              <GoalForm
                                workspaceId={workspaceId}
                                parentGoals={goals}
                                defaultType="key_result"
                                defaultParentId={obj.id}
                              />
                            </div>
                          )}
                          {krs.length === 0 && (
                            <div className="pl-3 mt-1">
                              <GoalForm
                                workspaceId={workspaceId}
                                parentGoals={goals}
                                defaultType="key_result"
                                defaultParentId={obj.id}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="mt-3">
                  <GoalForm
                    workspaceId={workspaceId}
                    parentGoals={goals}
                    defaultType="objective"
                    defaultParentId={goal.id}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
