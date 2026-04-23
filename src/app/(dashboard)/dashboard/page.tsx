import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getOrganizationsByUser } from "@/lib/db/queries/organizations";
import { getWorkspacesByOrganization } from "@/lib/db/queries/workspaces";
import { CreateWorkspaceDialog } from "@/components/dashboard/create-workspace-dialog";
import { WorkspaceCard } from "@/components/dashboard/workspace-card";
import { DashboardListShell } from "@/components/dashboard/dashboard-list-shell";
import { Plus } from "lucide-react";

const SLACK_ERR: Record<string, string> = {
  invalid_workspace: "Link Slack non valido. Apri Integrazioni dal workspace e riprova.",
  forbidden: "Non hai permesso di installare Slack per quel workspace.",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ slack_error?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const sp = searchParams ? await searchParams : {};
  const slackErrKey = sp.slack_error?.trim() ?? "";
  const slackErrMsg = SLACK_ERR[slackErrKey] ?? (slackErrKey ? `Slack: ${slackErrKey}` : "");

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
    <DashboardListShell
      user={{
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      }}
    >
      <div className="flex-1 p-8 lg:p-12 max-w-3xl">
      {slackErrMsg ? (
        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {slackErrMsg}
        </div>
      ) : null}
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
    </DashboardListShell>
  );
}
