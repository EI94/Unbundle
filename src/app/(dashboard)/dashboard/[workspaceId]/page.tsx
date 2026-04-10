import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import {
  getWorkspaceById,
  getDepartmentsByWorkspace,
} from "@/lib/db/queries/workspaces";
import {
  getActivitiesByWorkspace,
} from "@/lib/db/queries/activities";
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
  MapPin,
  BarChart3,
  FileText,
  Zap,
  TrendingUp,
  Brain,
  Play,
  Lock,
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

  const hasLeadership = !!workspace.systemBoundary;
  const hasGoals = goals.length > 0;
  const hasDepts = departments.length > 0;
  const hasMappedAll =
    hasDepts && mappedDepts.length === departments.length;
  const hasClassified = classifiedActivities.length > 0;
  const hasUseCases = useCases.length > 0;

  const steps = [
    {
      title: "Intervista Strategica",
      description: hasLeadership
        ? "Value thesis e perimetro definiti"
        : "Definisci value thesis, confini del sistema e funzioni",
      href: `/dashboard/${workspaceId}/setup/leadership`,
      icon: Compass,
      done: hasLeadership,
      locked: false,
      color: "bg-blue-600",
    },
    {
      title: "Strategia & OKR",
      description: hasGoals
        ? `${goals.length} obiettivi definiti`
        : "Definisci obiettivi e KPI che guideranno la prioritizzazione",
      href: `/dashboard/${workspaceId}/strategy`,
      icon: Target,
      done: hasGoals,
      locked: false,
      color: "bg-indigo-600",
    },
    {
      title: "Activity Mapping",
      description: hasDepts
        ? `${mappedDepts.length}/${departments.length} dipartimenti mappati`
        : "Scomponi le attività di ogni dipartimento",
      href: `/dashboard/${workspaceId}/mapping`,
      icon: GitBranch,
      done: hasMappedAll,
      locked: !hasDepts,
      color: "bg-violet-600",
    },
    {
      title: "Classificazione & Use Cases",
      description: hasUseCases
        ? `${useCases.length} use case generati`
        : "Classifica attività e genera use case AI",
      href: `/dashboard/${workspaceId}/use-cases`,
      icon: Lightbulb,
      done: hasUseCases,
      locked: activities.length === 0,
      color: "bg-amber-600",
    },
  ];

  const completedSteps = steps.filter((s) => s.done).length;
  const progressPercent = (completedSteps / steps.length) * 100;
  const nextStep = steps.find((s) => !s.done && !s.locked);

  const advancedPages = [
    {
      title: "Value Map",
      description: "Wardley Map interattiva",
      href: `/dashboard/${workspaceId}/value-map`,
      icon: MapPin,
      available: hasClassified,
    },
    {
      title: "Unbundle Plan",
      description: "Piano di trasformazione",
      href: `/dashboard/${workspaceId}/plan`,
      icon: BarChart3,
      available: hasUseCases,
    },
    {
      title: "Report",
      description: "Report esecutivo",
      href: `/dashboard/${workspaceId}/reports`,
      icon: FileText,
      available: hasUseCases,
    },
    {
      title: "Agent Blueprints",
      description: "Progetti agenti AI",
      href: `/dashboard/${workspaceId}/blueprints`,
      icon: Zap,
      available: hasUseCases,
    },
    {
      title: "Simulazione",
      description: "Scenari di impatto",
      href: `/dashboard/${workspaceId}/simulation`,
      icon: TrendingUp,
      available: hasUseCases,
    },
    {
      title: "Intelligence",
      description: "Segnali e opportunità",
      href: `/dashboard/${workspaceId}/intelligence`,
      icon: Brain,
      available: true,
    },
  ];

  return (
    <div className="flex-1 p-6 lg:p-8 max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          {workspace.name}
        </h1>
        <p className="mt-1 text-muted-foreground">
          {workspace.description ?? "Trasformazione organizzativa guidata dall'AI"}
        </p>
      </div>

      {/* Next step CTA */}
      {nextStep && !nextStep.done && (
        <Link href={nextStep.href}>
          <Card className="mb-8 group cursor-pointer border-primary/30 bg-primary/5 transition-all hover:shadow-lg hover:border-primary/50">
            <CardContent className="flex items-center gap-5 p-5">
              <div
                className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${nextStep.color} text-white shadow-lg`}
              >
                <Play className="h-6 w-6" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-primary mb-1">
                  Prossimo passo
                </p>
                <p className="text-lg font-semibold">{nextStep.title}</p>
                <p className="text-sm text-muted-foreground">
                  {nextStep.description}
                </p>
              </div>
              <ArrowRight className="h-5 w-5 text-primary transition-transform group-hover:translate-x-1" />
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Progress */}
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

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Building2 className="h-4 w-4" />
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
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <GitBranch className="h-4 w-4" />
              Attivit&agrave;
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
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Lightbulb className="h-4 w-4" />
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
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Target className="h-4 w-4" />
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

      {/* Journey steps */}
      <h2 className="text-lg font-semibold mb-4">Percorso di trasformazione</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 mb-10">
        {steps.map((step, index) => (
          <Link
            key={step.href}
            href={step.locked ? "#" : step.href}
            className={step.locked ? "pointer-events-none" : ""}
          >
            <Card
              className={`group cursor-pointer transition-all hover:shadow-md ${
                step.done
                  ? "border-green-200 dark:border-green-800"
                  : step.locked
                    ? "opacity-50"
                    : "hover:border-primary/30"
              }`}
            >
              <CardContent className="flex items-center gap-4 p-4">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-muted-foreground w-5">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                      step.done
                        ? "bg-green-100 dark:bg-green-900"
                        : step.locked
                          ? "bg-muted"
                          : `${step.color} text-white`
                    }`}
                  >
                    {step.done ? (
                      <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                    ) : step.locked ? (
                      <Lock className="h-5 w-5 text-muted-foreground" />
                    ) : (
                      <step.icon className="h-5 w-5" />
                    )}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{step.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {step.locked
                      ? "Completa i passi precedenti per sbloccare"
                      : step.description}
                  </p>
                </div>
                {!step.locked && (
                  <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                )}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Advanced pages */}
      <h2 className="text-lg font-semibold mb-4">Analisi avanzate</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {advancedPages.map((page) => (
          <Link
            key={page.href}
            href={page.available ? page.href : "#"}
            className={!page.available ? "pointer-events-none" : ""}
          >
            <Card
              className={`group cursor-pointer transition-all hover:shadow-md ${
                !page.available ? "opacity-40" : "hover:border-primary/30"
              }`}
            >
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  {page.available ? (
                    <page.icon className="h-4 w-4" />
                  ) : (
                    <Lock className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{page.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {page.available
                      ? page.description
                      : "Completa il mapping per sbloccare"}
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
