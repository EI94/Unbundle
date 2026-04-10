import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { getWorkspaceById, getDepartmentsByWorkspace } from "@/lib/db/queries/workspaces";
import { getActivitiesByWorkspace, getActivityStats } from "@/lib/db/queries/activities";
import { getUseCasesByWorkspace } from "@/lib/db/queries/use-cases";
import { getStrategicGoalsByWorkspace } from "@/lib/db/queries/workspaces";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
  Compass,
  Building2,
  Target,
  GitBranch,
  Lightbulb,
  ArrowRight,
  CheckCircle2,
  Circle,
} from "lucide-react";

export default async function WorkspaceOverviewPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { workspaceId } = await params;
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) notFound();

  const [departments, activities, useCases, goals] = await Promise.all([
    getDepartmentsByWorkspace(workspaceId),
    getActivitiesByWorkspace(workspaceId),
    getUseCasesByWorkspace(workspaceId),
    getStrategicGoalsByWorkspace(workspaceId),
  ]);

  const mappedDepts = departments.filter(
    (d) => d.mappingStatus === "mapped" || d.mappingStatus === "validated"
  );
  const classifiedActivities = activities.filter((a) => a.classification);

  const steps = [
    {
      title: "Setup Leadership",
      description: "Intervista strategica con la leadership",
      href: `/dashboard/${workspaceId}/setup/leadership`,
      icon: Compass,
      done: !!workspace.systemBoundary,
    },
    {
      title: "Strategia & OKR",
      description: "Definisci obiettivi e KPI",
      href: `/dashboard/${workspaceId}/strategy`,
      icon: Target,
      done: goals.length > 0,
    },
    {
      title: "Activity Mapping",
      description: `${mappedDepts.length}/${departments.length} dipartimenti mappati`,
      href: `/dashboard/${workspaceId}/mapping`,
      icon: GitBranch,
      done: departments.length > 0 && mappedDepts.length === departments.length,
    },
    {
      title: "Use Cases",
      description: `${useCases.length} use case generati`,
      href: `/dashboard/${workspaceId}/use-cases`,
      icon: Lightbulb,
      done: useCases.length > 0,
    },
  ];

  const completedSteps = steps.filter((s) => s.done).length;
  const progressPercent = (completedSteps / steps.length) * 100;

  return (
    <div className="flex-1 p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">{workspace.name}</h1>
        <p className="mt-1 text-muted-foreground">
          {workspace.description ?? "Panoramica del workspace"}
        </p>
      </div>

      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">
            Progresso: {completedSteps}/{steps.length} fasi completate
          </span>
          <span className="text-sm text-muted-foreground">
            {Math.round(progressPercent)}%
          </span>
        </div>
        <Progress value={progressPercent} className="h-2" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Dipartimenti
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{departments.length}</div>
            <p className="text-xs text-muted-foreground">
              {mappedDepts.length} mappati
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Attivita&apos;
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activities.length}</div>
            <p className="text-xs text-muted-foreground">
              {classifiedActivities.length} classificate
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Use Cases
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{useCases.length}</div>
            <p className="text-xs text-muted-foreground">
              {useCases.filter((u) => u.category === "quick_win").length} quick
              wins
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              OKR / Goals
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{goals.length}</div>
            <p className="text-xs text-muted-foreground">
              {goals.filter((g) => g.type === "key_result").length} key results
            </p>
          </CardContent>
        </Card>
      </div>

      <h2 className="text-lg font-semibold mb-4">Percorso di trasformazione</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {steps.map((step) => (
          <Link key={step.href} href={step.href}>
            <Card className="group cursor-pointer transition-all hover:shadow-md hover:border-primary/30">
              <CardContent className="flex items-center gap-4 p-4">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                    step.done
                      ? "bg-green-100 dark:bg-green-900"
                      : "bg-primary/10"
                  }`}
                >
                  {step.done ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                  ) : (
                    <step.icon className="h-5 w-5 text-primary" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{step.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {step.description}
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
