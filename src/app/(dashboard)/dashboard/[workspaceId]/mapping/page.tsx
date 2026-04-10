import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import {
  getWorkspaceById,
  getDepartmentsByWorkspace,
} from "@/lib/db/queries/workspaces";
import { getActivitiesByDepartment } from "@/lib/db/queries/activities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  ArrowRight,
  GitBranch,
  Users,
  Compass,
  CheckCircle2,
  Clock,
  Play,
} from "lucide-react";

const statusLabels: Record<string, string> = {
  not_started: "Non iniziato",
  in_progress: "In corso",
  mapped: "Mappato",
  validated: "Validato",
};

const statusColors: Record<string, string> = {
  not_started:
    "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  in_progress:
    "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  mapped:
    "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  validated:
    "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
};

const statusIcons: Record<string, typeof Clock> = {
  not_started: Play,
  in_progress: Clock,
  mapped: CheckCircle2,
  validated: CheckCircle2,
};

export default async function MappingPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { workspaceId } = await params;
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) notFound();

  const departments = await getDepartmentsByWorkspace(workspaceId);

  const deptWithActivities = await Promise.all(
    departments.map(async (dept) => {
      const acts = await getActivitiesByDepartment(dept.id);
      return { ...dept, activities: acts };
    })
  );

  const totalDepts = departments.length;
  const mappedDepts = departments.filter(
    (d) => d.mappingStatus === "mapped" || d.mappingStatus === "validated"
  ).length;
  const progress = totalDepts > 0 ? (mappedDepts / totalDepts) * 100 : 0;
  const totalActivities = deptWithActivities.reduce(
    (sum, d) => sum + d.activities.length,
    0
  );

  return (
    <div className="flex-1 p-6 lg:p-8 max-w-5xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Activity Mapping</h1>
        <p className="mt-1 text-muted-foreground">
          Per ogni dipartimento, l&apos;agente AI Leo scompone le attivit&agrave;
          in unit&agrave; analizzabili per la classificazione
        </p>
      </div>

      {totalDepts > 0 && (
        <div className="mb-8 rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium">
                {mappedDepts}/{totalDepts} dipartimenti mappati
              </span>
              <Badge variant="outline" className="text-xs">
                {totalActivities} attivit&agrave; totali
              </Badge>
            </div>
            <span className="text-sm font-semibold text-primary">
              {Math.round(progress)}%
            </span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>
      )}

      {departments.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/30 p-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-100 dark:bg-blue-900/50 mb-5">
            <Compass className="h-8 w-8 text-blue-600 dark:text-blue-400" />
          </div>
          <h3 className="text-xl font-semibold mb-2">
            Prima completa l&apos;Intervista Strategica
          </h3>
          <p className="max-w-md text-sm text-muted-foreground leading-relaxed mb-6">
            I dipartimenti vengono creati durante il setup con la leadership.
            Mara, la Strategy Architect, ti aiuter&agrave; a identificare le
            funzioni prioritarie da mappare.
          </p>
          <Link href={`/dashboard/${workspaceId}/setup/leadership`}>
            <Badge
              variant="secondary"
              className="gap-2 px-5 py-2.5 text-sm font-medium cursor-pointer hover:bg-secondary/80"
            >
              <Compass className="h-4 w-4" />
              Vai all&apos;Intervista Strategica
              <ArrowRight className="h-4 w-4" />
            </Badge>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {deptWithActivities.map((dept) => {
            const StatusIcon = statusIcons[dept.mappingStatus] ?? Clock;
            return (
              <Link
                key={dept.id}
                href={`/dashboard/${workspaceId}/mapping/${dept.id}`}
              >
                <Card className="group cursor-pointer transition-all hover:shadow-lg hover:border-primary/30 h-full">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base font-semibold">
                        {dept.name}
                      </CardTitle>
                      <Badge
                        variant="secondary"
                        className={`text-xs gap-1 ${
                          statusColors[dept.mappingStatus] ?? ""
                        }`}
                      >
                        <StatusIcon className="h-3 w-3" />
                        {statusLabels[dept.mappingStatus] ??
                          dept.mappingStatus}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {dept.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
                        {dept.description}
                      </p>
                    )}
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      {dept.teamSize && (
                        <div className="flex items-center gap-1.5">
                          <Users className="h-3.5 w-3.5" />
                          {dept.teamSize} persone
                        </div>
                      )}
                      <div className="flex items-center gap-1.5">
                        <GitBranch className="h-3.5 w-3.5" />
                        {dept.activities.length} attivit&agrave;
                      </div>
                    </div>
                    <div className="mt-4 flex items-center text-sm font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                      {dept.mappingStatus === "not_started"
                        ? "Inizia mapping"
                        : dept.mappingStatus === "mapped" ||
                            dept.mappingStatus === "validated"
                          ? "Visualizza"
                          : "Continua mapping"}
                      <ArrowRight className="ml-1 h-4 w-4" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
