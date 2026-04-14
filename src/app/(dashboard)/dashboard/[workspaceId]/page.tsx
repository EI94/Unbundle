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
import Link from "next/link";
import {
  Compass,
  Target,
  GitBranch,
  Lightbulb,
  ArrowRight,
  Check,
  Lock,
  MapPin,
  BarChart3,
  FileText,
  Zap,
  TrendingUp,
  Brain,
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

  const streamCounts = {
    automate: activities.filter(
      (a) =>
        a.classification === "automate" || a.classification === "automatable"
    ).length,
    differentiate: activities.filter(
      (a) =>
        a.classification === "differentiate" ||
        a.classification === "differentiating" ||
        a.classification === "augmentable"
    ).length,
    innovate: activities.filter(
      (a) =>
        a.classification === "innovate" ||
        a.classification === "emerging_opportunity"
    ).length,
  };

  const hasLeadership = !!workspace.systemBoundary;
  const hasGoals = goals.length > 0;
  const hasDepts = departments.length > 0;
  const hasMappedAll = hasDepts && mappedDepts.length === departments.length;
  const hasUseCases = useCases.length > 0;

  const steps = [
    {
      label: "Discovery",
      sub: hasLeadership
        ? "Value thesis e perimetro definiti"
        : "Dove create valore e cosa cambia con l'AI",
      href: `/dashboard/${workspaceId}/setup/leadership`,
      icon: Compass,
      done: hasLeadership,
      locked: false,
    },
    {
      label: "Strategia",
      sub: hasGoals
        ? `${goals.length} obiettivi definiti`
        : "OKR e KPI che guidano le decisioni",
      href: `/dashboard/${workspaceId}/strategy`,
      icon: Target,
      done: hasGoals,
      locked: false,
    },
    {
      label: "Activity mapping",
      sub: hasDepts
        ? `${mappedDepts.length}/${departments.length} funzioni mappate`
        : "Scomponi il lavoro funzione per funzione",
      href: `/dashboard/${workspaceId}/mapping`,
      icon: GitBranch,
      done: hasMappedAll,
      locked: !hasDepts,
    },
    {
      label: "Use cases",
      sub: hasUseCases
        ? `${useCases.length} use case identificati`
        : "Dove l'AI trasforma il modo di lavorare",
      href: `/dashboard/${workspaceId}/use-cases`,
      icon: Lightbulb,
      done: hasUseCases,
      locked: activities.length === 0,
    },
  ];

  const nextStep = steps.find((s) => !s.done && !s.locked);

  const tools = [
    { label: "Value map", href: `/dashboard/${workspaceId}/value-map`, icon: MapPin, ready: classifiedActivities.length > 0 },
    { label: "Piano", href: `/dashboard/${workspaceId}/plan`, icon: BarChart3, ready: hasUseCases },
    { label: "Report", href: `/dashboard/${workspaceId}/reports`, icon: FileText, ready: hasUseCases },
    { label: "Blueprints", href: `/dashboard/${workspaceId}/blueprints`, icon: Zap, ready: hasUseCases },
    { label: "Simulazione", href: `/dashboard/${workspaceId}/simulation`, icon: TrendingUp, ready: hasUseCases },
    { label: "Intelligence", href: `/dashboard/${workspaceId}/intelligence`, icon: Brain, ready: true },
  ];

  return (
    <div className="flex-1 p-8 lg:p-12 max-w-3xl">
      {/* Header */}
      <div className="mb-12">
        <span className="text-xs text-muted-foreground tracking-wide uppercase">
          Workspace
        </span>
        <h1 className="mt-1 text-2xl font-medium tracking-tight">
          {workspace.name}
        </h1>
        {workspace.description && (
          <p className="mt-1 text-sm text-muted-foreground">
            {workspace.description}
          </p>
        )}
      </div>

      {/* Next step */}
      {nextStep && (
        <Link href={nextStep.href} className="group block mb-12">
          <p className="text-xs text-muted-foreground mb-3 tracking-wide">
            Prossimo passo
          </p>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium">{nextStep.label}</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                {nextStep.sub}
              </p>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
          </div>
          <div className="mt-3 h-px bg-border" />
        </Link>
      )}

      {/* Steps */}
      <div className="mb-14">
        <p className="text-xs text-muted-foreground mb-4 tracking-wide">
          Percorso
        </p>
        <div className="space-y-1">
          {steps.map((step, i) => {
            const isNext = nextStep === step;
            return (
              <Link
                key={step.href}
                href={step.locked ? "#" : step.href}
                className={`group flex items-center gap-4 rounded-lg px-3 py-3 transition-colors ${
                  step.locked
                    ? "pointer-events-none opacity-40"
                    : "hover:bg-accent"
                }`}
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-xs">
                  {step.done ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : step.locked ? (
                    <Lock className="h-3 w-3 text-muted-foreground" />
                  ) : (
                    <span className="text-muted-foreground">{i + 1}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${isNext ? "font-medium" : ""}`}>
                    {step.label}
                  </p>
                  <p className="text-xs text-muted-foreground">{step.sub}</p>
                </div>
                {!step.locked && (
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                )}
              </Link>
            );
          })}
        </div>
      </div>

      {/* 3 Streams */}
      {classifiedActivities.length > 0 && (
        <div className="mb-14">
          <p className="text-xs text-muted-foreground mb-4 tracking-wide">
            Three streams
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-4">
              <div className="text-2xl font-medium tabular-nums text-green-400">
                {streamCounts.automate}
              </div>
              <p className="text-xs font-medium mt-1">Automate</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Non dovrebbe esistere cos&igrave;
              </p>
            </div>
            <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-4">
              <div className="text-2xl font-medium tabular-nums text-violet-400">
                {streamCounts.differentiate}
              </div>
              <p className="text-xs font-medium mt-1">Differentiate</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Concentrare l&apos;energia umana
              </p>
            </div>
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
              <div className="text-2xl font-medium tabular-nums text-amber-400">
                {streamCounts.innovate}
              </div>
              <p className="text-xs font-medium mt-1">Innovate</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Valore che prima non esisteva
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tools */}
      <div>
        <p className="text-xs text-muted-foreground mb-4 tracking-wide">
          Strumenti
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {tools.map((tool) => (
            <Link
              key={tool.href}
              href={tool.ready ? tool.href : "#"}
              className={`group flex items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 text-sm transition-colors ${
                tool.ready
                  ? "hover:bg-accent"
                  : "pointer-events-none opacity-30"
              }`}
            >
              <tool.icon className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{tool.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
