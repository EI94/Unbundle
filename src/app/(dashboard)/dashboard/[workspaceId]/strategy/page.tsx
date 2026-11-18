import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";
import { notFound } from "next/navigation";
import { getWorkspaceById, getStrategicGoalsByWorkspace } from "@/lib/db/queries/workspaces";
import { GoalForm } from "@/components/dashboard/goal-form";
import { SuggestOKRsButton } from "@/components/dashboard/suggest-okrs-button";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { PAGE_TITLE_CLASS, PageContainer } from "@/components/dashboard/page-container";
import { HOME_TEXT } from "@/lib/home/text";

export const metadata = { title: HOME_TEXT.goalsPage.title };

/** (Rilascio 10, §2.4, §3.8) La pagina «Obiettivi», aperta da Home › Obiettivi: la barra accende «Home». */
export default async function StrategyPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {

  const { workspaceId } = await params;

  const { access } = await requireWorkspacePage(workspaceId);
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) notFound();
  // Gli obiettivi li scrive solo chi valuta gli use case (`createGoalAction`, `suggestOKRsAction`): gli altri ruoli
  // li leggono, senza pulsanti che finirebbero in un rifiuto.
  const canEdit = canReviewWorkspacePortfolio(access.role);

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
    <PageContainer size="narrow">
      <div className="mb-8">
        <h1 className={PAGE_TITLE_CLASS}>{HOME_TEXT.goalsPage.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Definisci gli obiettivi che guideranno la prioritizzazione dei use case.
        </p>
      </div>

      {canEdit ? (
        <div className="flex items-center gap-3 mb-6">
          <GoalForm
            workspaceId={workspaceId}
            parentGoals={goals}
            defaultType="goal"
          />
          <SuggestOKRsButton workspaceId={workspaceId} />
        </div>
      ) : null}

      {goals.length === 0 ? (
        <div className="mt-16 text-center max-w-md mx-auto">
          <h2 className="text-lg font-medium">Nessun obiettivo</h2>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            {canEdit ? (
              <>
                Aggiungi goal strategici, obiettivi e key result.
                Oppure lascia che l&apos;AI suggerisca un framework OKR basato sulla tua Value Thesis.
              </>
            ) : (
              "Gli obiettivi li aggiunge chi valuta gli use case."
            )}
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
                              {canEdit ? (
                                <GoalForm
                                  workspaceId={workspaceId}
                                  parentGoals={goals}
                                  defaultType="key_result"
                                  defaultParentId={obj.id}
                                />
                              ) : null}
                            </div>
                          )}
                          {canEdit && krs.length === 0 && (
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
                {canEdit ? (
                  <div className="mt-3">
                    <GoalForm
                      workspaceId={workspaceId}
                      parentGoals={goals}
                      defaultType="objective"
                      defaultParentId={goal.id}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}
