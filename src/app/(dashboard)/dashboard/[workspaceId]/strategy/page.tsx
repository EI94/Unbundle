import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { getWorkspaceById, getStrategicGoalsByWorkspace } from "@/lib/db/queries/workspaces";
import { GoalForm } from "@/components/dashboard/goal-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Target, TrendingUp, TrendingDown, Minus } from "lucide-react";

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
    <div className="flex-1 p-6 lg:p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Strategia & OKR
          </h1>
          <p className="mt-1 text-muted-foreground">
            Definisci obiettivi, KPI e metriche per guidare l&apos;analisi del
            workspace
          </p>
        </div>
        <GoalForm
          workspaceId={workspaceId}
          parentGoals={goals}
          defaultType="goal"
        />
      </div>

      {goals.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-12 text-center">
          <Target className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold">Nessun obiettivo definito</h3>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Aggiungi goal strategici, obiettivi e key result per allineare
            l&apos;analisi alle priorita&apos; di business.
          </p>
          <div className="mt-4">
            <GoalForm
              workspaceId={workspaceId}
              parentGoals={goals}
              defaultType="goal"
            />
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {topLevelGoals.map((goal) => {
            const objectives = getChildren(goal.id);
            return (
              <Card key={goal.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Badge variant="default" className="uppercase text-xs">
                        Goal
                      </Badge>
                      <CardTitle className="text-lg">{goal.title}</CardTitle>
                    </div>
                    <div className="flex items-center gap-2">
                      {goal.owner && (
                        <Badge variant="outline" className="text-xs">
                          {goal.owner}
                        </Badge>
                      )}
                      {goal.timeframe && (
                        <Badge variant="secondary" className="text-xs">
                          {goal.timeframe}
                        </Badge>
                      )}
                    </div>
                  </div>
                  {goal.description && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {goal.description}
                    </p>
                  )}
                </CardHeader>
                <CardContent>
                  {objectives.length > 0 ? (
                    <div className="space-y-4">
                      {objectives.map((obj) => {
                        const krs = getChildren(obj.id);
                        return (
                          <div key={obj.id} className="pl-4 border-l-2 border-border">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge
                                variant="secondary"
                                className="uppercase text-xs"
                              >
                                Objective
                              </Badge>
                              <span className="font-medium text-sm">
                                {obj.title}
                              </span>
                            </div>
                            {krs.length > 0 && (
                              <div className="mt-2 space-y-2 pl-4">
                                {krs.map((kr) => (
                                  <div
                                    key={kr.id}
                                    className="flex items-center justify-between rounded-lg bg-muted/50 p-3 text-sm"
                                  >
                                    <div className="flex items-center gap-2">
                                      {directionIcon(kr.direction)}
                                      <span>{kr.title}</span>
                                    </div>
                                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                      {kr.kpiName && (
                                        <span>{kr.kpiName}</span>
                                      )}
                                      {kr.currentValue != null &&
                                        kr.targetValue != null && (
                                          <span className="font-mono">
                                            {kr.currentValue} → {kr.targetValue}
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
                              <div className="mt-2 pl-4">
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
                  ) : null}
                  <div className="mt-4">
                    <GoalForm
                      workspaceId={workspaceId}
                      parentGoals={goals}
                      defaultType="objective"
                      defaultParentId={goal.id}
                    />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
