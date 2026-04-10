import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2 } from "lucide-react";

export default async function ContextSetupPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { workspaceId } = await params;
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) notFound();

  const boundary = workspace.systemBoundary as {
    includedFunctions?: string[];
    excludedFunctions?: string[];
    rationale?: string;
    timeHorizon?: string;
  } | null;

  return (
    <div className="flex-1 p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          Contesto Organizzativo
        </h1>
        <p className="mt-1 text-muted-foreground">
          Sistemi, canali, ruoli, documenti, policy e confini del sistema
        </p>
      </div>

      {boundary ? (
        <div className="max-w-2xl space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>System Boundary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {boundary.rationale && (
                <div>
                  <p className="text-sm font-medium mb-1">Motivazione</p>
                  <p className="text-sm text-muted-foreground">
                    {boundary.rationale}
                  </p>
                </div>
              )}
              {boundary.includedFunctions &&
                boundary.includedFunctions.length > 0 && (
                  <div>
                    <p className="text-sm font-medium mb-1">Funzioni incluse</p>
                    <ul className="list-disc list-inside text-sm text-muted-foreground">
                      {boundary.includedFunctions.map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  </div>
                )}
              {boundary.excludedFunctions &&
                boundary.excludedFunctions.length > 0 && (
                  <div>
                    <p className="text-sm font-medium mb-1">Funzioni escluse</p>
                    <ul className="list-disc list-inside text-sm text-muted-foreground">
                      {boundary.excludedFunctions.map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  </div>
                )}
              {boundary.timeHorizon && (
                <div>
                  <p className="text-sm font-medium mb-1">
                    Orizzonte temporale
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {boundary.timeHorizon}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-12 text-center">
          <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold">
            Contesto non ancora definito
          </h3>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Il contesto organizzativo viene costruito durante il setup con la
            leadership. I confini del sistema saranno definiti li&apos;.
          </p>
        </div>
      )}
    </div>
  );
}
