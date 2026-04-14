import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { getWorkspaceById, getDepartmentsByWorkspace } from "@/lib/db/queries/workspaces";
import { getActivitiesByWorkspace } from "@/lib/db/queries/activities";
import { WardleyMap } from "@/components/maps/wardley-map";
import { ClassifyButton } from "@/components/dashboard/classify-button";
import { GenerateValueMapButton } from "@/components/dashboard/generate-value-map-button";
import { db } from "@/lib/db";
import { valueMapNodes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export default async function ValueMapPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { workspaceId } = await params;
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) notFound();

  const [activities, departments, nodes] = await Promise.all([
    getActivitiesByWorkspace(workspaceId),
    getDepartmentsByWorkspace(workspaceId),
    db
      .select()
      .from(valueMapNodes)
      .where(eq(valueMapNodes.workspaceId, workspaceId)),
  ]);

  const deptMap = new Map(departments.map((d) => [d.id, d.name]));
  const classified = activities.filter((a) => a.classification);
  const activitiesWithDept = activities.map((a) => ({
    ...a,
    departmentName: deptMap.get(a.departmentId) ?? "Sconosciuto",
  }));

  const needsClassification =
    activities.length > 0 && classified.length < activities.length;
  const needsPositioning = classified.length > 0 && nodes.length === 0;

  return (
    <div className="flex-1 p-8 lg:p-12 max-w-5xl">
      <div className="mb-8">
        <span className="text-xs text-muted-foreground tracking-wide uppercase">
          Analisi
        </span>
        <h1 className="mt-1 text-2xl font-medium tracking-tight">Value map</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Wardley Map — valore strategico vs maturit&agrave; evolutiva
        </p>
      </div>

      {classified.length === 0 ? (
        <div className="mt-16 text-center max-w-md mx-auto">
          <h2 className="text-lg font-medium">Nessuna attivit&agrave; classificata</h2>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            Completa il mapping e la classificazione per generare la mappa.
          </p>
          {needsClassification && (
            <div className="mt-4">
              <ClassifyButton workspaceId={workspaceId} />
            </div>
          )}
        </div>
      ) : (
        <div>
          <div className="flex items-center gap-3 mb-6">
            {needsClassification && (
              <ClassifyButton workspaceId={workspaceId} />
            )}
            <GenerateValueMapButton
              workspaceId={workspaceId}
              hasNodes={nodes.length > 0}
            />
            <span className="text-xs text-muted-foreground">
              {classified.length} attivit&agrave; &middot; {nodes.length} posizionate
            </span>
          </div>

          {nodes.length > 0 ? (
            <WardleyMap activities={activitiesWithDept} nodes={nodes} />
          ) : (
            <div className="mt-8 text-center text-sm text-muted-foreground">
              Clicca &ldquo;Genera mappa&rdquo; per posizionare le attivit&agrave; sulla Wardley Map con l&apos;AI.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
