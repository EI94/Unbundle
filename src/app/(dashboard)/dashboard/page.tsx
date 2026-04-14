import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getOrganizationsByUser } from "@/lib/db/queries/organizations";
import { getWorkspacesByOrganization } from "@/lib/db/queries/workspaces";
import { CreateWorkspaceDialog } from "@/components/dashboard/create-workspace-dialog";
import { WorkspaceCard } from "@/components/dashboard/workspace-card";
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
    <div className="flex-1 p-8 lg:p-12 max-w-3xl">
      <div className="mb-10 flex items-center justify-between">
        <div>
          <span className="text-xs text-muted-foreground tracking-wide uppercase">
            Dashboard
          </span>
          <h1 className="mt-1 text-2xl font-medium tracking-tight">
            I tuoi workspace
          </h1>
        </div>
        <CreateWorkspaceDialog
          organizations={userOrgs.map((o) => o.organization)}
        >
          <button className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent transition-colors">
            <Plus className="h-3.5 w-3.5" />
            Nuovo
          </button>
        </CreateWorkspaceDialog>
      </div>

      {!hasWorkspaces ? (
        <div className="mt-20 text-center max-w-md mx-auto">
          <h2 className="text-lg font-medium">Nessun workspace</h2>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            Crea il tuo primo workspace per scomporre il lavoro della tua
            organizzazione e capire dove l&apos;AI trasforma il valore.
          </p>
          <CreateWorkspaceDialog
            organizations={userOrgs.map((o) => o.organization)}
          >
            <button className="mt-6 inline-flex items-center gap-2 rounded-lg bg-foreground text-background px-4 py-2.5 text-sm font-medium hover:opacity-90 transition-opacity">
              <Plus className="h-3.5 w-3.5" />
              Crea workspace
            </button>
          </CreateWorkspaceDialog>
        </div>
      ) : (
        <div className="space-y-8">
          {workspacesWithOrgs.map(({ organization, workspaces }) =>
            workspaces.length > 0 ? (
              <div key={organization.id}>
                <p className="text-xs text-muted-foreground mb-3 tracking-wide">
                  {organization.name}
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
