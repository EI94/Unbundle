import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { getWorkspaceById, getDepartmentsByWorkspace } from "@/lib/db/queries/workspaces";
import { getActivitiesByWorkspace } from "@/lib/db/queries/activities";
import { WardleyMap } from "@/components/maps/wardley-map";
import { ClassifyButton } from "@/components/dashboard/classify-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Map as MapIcon } from "lucide-react";

const classificationLabels: Record<string, string> = {
  automatable: "Automatizzabile",
  augmentable: "Augmentabile",
  differentiating: "Differenziante",
  emerging_opportunity: "Opportunita' emergente",
  blocked_by_system: "Bloccato (sistema)",
  blocked_by_governance: "Bloccato (governance)",
};

const classificationColors: Record<string, string> = {
  automatable: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  augmentable: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  differentiating: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  emerging_opportunity: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  blocked_by_system: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  blocked_by_governance: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
};

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

  const [activities, departments] = await Promise.all([
    getActivitiesByWorkspace(workspaceId),
    getDepartmentsByWorkspace(workspaceId),
  ]);

  const deptMap = new Map(departments.map((d) => [d.id, d.name]));
  const classified = activities.filter((a) => a.classification);
  const activitiesWithDept = activities.map((a) => ({
    ...a,
    departmentName: deptMap.get(a.departmentId) ?? "Sconosciuto",
  }));

  const needsClassification =
    activities.length > 0 && classified.length < activities.length;

  const groupedByClassification = classified.reduce(
    (acc, a) => {
      const key = a.classification ?? "unclassified";
      if (!acc[key]) acc[key] = [];
      acc[key].push(a);
      return acc;
    },
    {} as Record<string, typeof activities>
  );

  return (
    <div className="flex-1 p-6 lg:p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Value Map</h1>
          <p className="mt-1 text-muted-foreground">
            Mappa del valore in stile Wardley — centralita&apos; strategica vs
            maturita&apos;
          </p>
        </div>
        {needsClassification && (
          <ClassifyButton workspaceId={workspaceId} />
        )}
      </div>

      {classified.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-12 text-center">
          <MapIcon className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold">
            Nessuna attivita&apos; classificata
          </h3>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Completa il mapping e la classificazione delle attivita&apos; per
            visualizzare la mappa del valore interattiva.
          </p>
        </div>
      ) : (
        <Tabs defaultValue="map">
          <TabsList>
            <TabsTrigger value="map">Mappa Wardley</TabsTrigger>
            <TabsTrigger value="table">Vista Tabellare</TabsTrigger>
          </TabsList>

          <TabsContent value="map" className="mt-6">
            <Card>
              <CardContent className="p-6">
                <WardleyMap activities={activitiesWithDept} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="table" className="mt-6">
            <div className="space-y-6">
              <div className="flex gap-3 flex-wrap">
                {Object.entries(classificationLabels).map(([key, label]) => {
                  const count = groupedByClassification[key]?.length ?? 0;
                  return (
                    <Badge
                      key={key}
                      variant="secondary"
                      className={classificationColors[key]}
                    >
                      {label} ({count})
                    </Badge>
                  );
                })}
              </div>

              {Object.entries(groupedByClassification).map(([cls, acts]) => (
                <Card key={cls}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Badge
                        variant="secondary"
                        className={classificationColors[cls] ?? ""}
                      >
                        {classificationLabels[cls] ?? cls}
                      </Badge>
                      <span className="text-muted-foreground font-normal">
                        ({acts.length} attivita&apos;)
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {acts.map((a) => (
                        <div
                          key={a.id}
                          className="rounded-lg border bg-muted/30 p-3"
                        >
                          <p className="text-sm font-medium">{a.title}</p>
                          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                            {a.description}
                          </p>
                          <div className="flex items-center gap-2 mt-2">
                            {a.aiExposureScore != null && (
                              <Badge variant="outline" className="text-xs">
                                AI Exp: {(a.aiExposureScore * 100).toFixed(0)}%
                              </Badge>
                            )}
                            {a.confidenceScore != null && (
                              <Badge variant="outline" className="text-xs">
                                Conf: {(a.confidenceScore * 100).toFixed(0)}%
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
