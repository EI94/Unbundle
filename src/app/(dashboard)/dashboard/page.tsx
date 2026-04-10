import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getOrganizationsByUser } from "@/lib/db/queries/organizations";
import { getWorkspacesByOrganization } from "@/lib/db/queries/workspaces";
import { CreateWorkspaceDialog } from "@/components/dashboard/create-workspace-dialog";
import { WorkspaceCard } from "@/components/dashboard/workspace-card";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const userOrgs = await getOrganizationsByUser(session.user.id);

  const workspacesWithOrgs = await Promise.all(
    userOrgs.map(async ({ organization }) => {
      const workspaces = await getWorkspacesByOrganization(organization.id);
      return { organization, workspaces };
    })
  );

  const hasWorkspaces = workspacesWithOrgs.some(
    (o) => o.workspaces.length > 0
  );

  return (
    <div className="flex-1 p-6 lg:p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">I miei Workspace</h1>
          <p className="mt-1 text-muted-foreground">
            Gestisci i tuoi progetti di trasformazione AI
          </p>
        </div>
        <CreateWorkspaceDialog
          organizations={userOrgs.map((o) => o.organization)}
        >
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Nuovo Workspace
          </Button>
        </CreateWorkspaceDialog>
      </div>

      {!hasWorkspaces ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-12 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Plus className="h-8 w-8 text-primary" />
          </div>
          <h3 className="mt-4 text-lg font-semibold">Nessun workspace</h3>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Crea il tuo primo workspace per iniziare a scomporre il lavoro della
            tua organizzazione e scoprire dove si sposta il valore.
          </p>
          <CreateWorkspaceDialog
            organizations={userOrgs.map((o) => o.organization)}
          >
            <Button className="mt-6">
              <Plus className="mr-2 h-4 w-4" />
              Crea il primo workspace
            </Button>
          </CreateWorkspaceDialog>
        </div>
      ) : (
        <div className="space-y-8">
          {workspacesWithOrgs.map(({ organization, workspaces }) =>
            workspaces.length > 0 ? (
              <div key={organization.id}>
                <h2 className="mb-4 text-lg font-semibold text-foreground">
                  {organization.name}
                </h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {workspaces.map((workspace) => (
                    <WorkspaceCard
                      key={workspace.id}
                      workspace={workspace}
                      orgSlug={organization.slug}
                    />
                  ))}
                </div>
              </div>
            ) : null
          )}
        </div>
      )}
    </div>
  );
}
