import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import {
  getWorkspaceById,
  getDepartmentsByWorkspace,
} from "@/lib/db/queries/workspaces";
import { getActivitiesByDepartment } from "@/lib/db/queries/activities";
import {
  ArrowRight,
  Compass,
  Check,
} from "lucide-react";

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
  const totalActivities = deptWithActivities.reduce(
    (sum, d) => sum + d.activities.length,
    0
  );

  return (
    <div className="flex-1 p-8 lg:p-12 max-w-3xl">
      <div className="mb-10">
        <span className="text-xs text-muted-foreground tracking-wide uppercase">
          Mapping
        </span>
        <h1 className="mt-1 text-2xl font-medium tracking-tight">
          Activity mapping
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Scomponi il lavoro di ogni funzione in unit&agrave; analizzabili.
        </p>
      </div>

      {totalDepts > 0 && (
        <div className="mb-8 flex items-center gap-4 text-sm text-muted-foreground">
          <span>{mappedDepts}/{totalDepts} funzioni mappate</span>
          <span className="h-1 w-1 rounded-full bg-border" />
          <span>{totalActivities} attivit&agrave; totali</span>
        </div>
      )}

      {departments.length === 0 ? (
        <div className="mt-16 text-center max-w-md mx-auto">
          <h2 className="text-lg font-medium">Prima la Discovery</h2>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            Le funzioni vengono create durante la Discovery.
            Completa quella fase per sbloccare il mapping.
          </p>
          <Link
            href={`/dashboard/${workspaceId}/setup/leadership`}
            className="group mt-6 inline-flex items-center gap-2 text-sm font-medium hover:gap-3 transition-all"
          >
            <Compass className="h-3.5 w-3.5" />
            Vai alla Discovery
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      ) : (
        <div className="space-y-1">
          {deptWithActivities.map((dept) => {
            const isDone =
              dept.mappingStatus === "mapped" || dept.mappingStatus === "validated";
            return (
              <Link
                key={dept.id}
                href={`/dashboard/${workspaceId}/mapping/${dept.id}`}
                className="group flex items-center gap-4 rounded-lg px-3 py-3 hover:bg-accent transition-colors"
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border">
                  {isDone ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{dept.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {dept.activities.length} attivit&agrave;
                    {dept.teamSize ? ` \u00B7 ${dept.teamSize} persone` : ""}
                  </p>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
