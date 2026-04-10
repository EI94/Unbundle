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
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ArrowRight, GitBranch, Users, Clock } from "lucide-react";

const statusLabels: Record<string, string> = {
  not_started: "Non iniziato",
  in_progress: "In corso",
  mapped: "Mappato",
  validated: "Validato",
};

const statusColors: Record<string, string> = {
  not_started: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  in_progress: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  mapped: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  validated: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
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

  return (
    <div className="flex-1 p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Activity Mapping</h1>
        <p className="mt-1 text-muted-foreground">
          Mappa le attivita&apos; di ogni dipartimento con l&apos;aiuto
          dell&apos;agente AI
        </p>
      </div>

      {totalDepts > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">
              {mappedDepts}/{totalDepts} dipartimenti mappati
            </span>
            <span className="text-sm text-muted-foreground">
              {Math.round(progress)}%
            </span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>
      )}

      {departments.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-12 text-center">
          <GitBranch className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold">Nessun dipartimento</h3>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            I dipartimenti vengono creati durante il setup con la leadership.
            Completa prima quella fase.
          </p>
          <Link href={`/dashboard/${workspaceId}/setup/leadership`}>
            <Button className="mt-4">Vai al Setup Leadership</Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {deptWithActivities.map((dept) => (
            <Link
              key={dept.id}
              href={`/dashboard/${workspaceId}/mapping/${dept.id}`}
            >
              <Card className="group cursor-pointer transition-all hover:shadow-md hover:border-primary/30">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{dept.name}</CardTitle>
                    <Badge
                      variant="secondary"
                      className={
                        statusColors[dept.mappingStatus] ?? ""
                      }
                    >
                      {statusLabels[dept.mappingStatus] ?? dept.mappingStatus}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  {dept.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                      {dept.description}
                    </p>
                  )}
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    {dept.teamSize && (
                      <div className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {dept.teamSize} persone
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      <GitBranch className="h-3 w-3" />
                      {dept.activities.length} attivita&apos;
                    </div>
                  </div>
                  <div className="mt-3 flex items-center text-sm font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                    {dept.mappingStatus === "not_started"
                      ? "Inizia mapping"
                      : "Continua mapping"}
                    <ArrowRight className="ml-1 h-4 w-4" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
