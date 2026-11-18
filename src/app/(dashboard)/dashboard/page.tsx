import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { requireSession } from "@/lib/auth/redirect-to-login";
import { getOrganizationsByUser } from "@/lib/db/queries/organizations";
import { getWorkspaceGroupsForUser } from "@/lib/db/queries/workspaces";
import { CreateWorkspaceDialog } from "@/components/dashboard/create-workspace-dialog";
import { WorkspaceCard } from "@/components/dashboard/workspace-card";
import { DashboardListShell } from "@/components/dashboard/dashboard-list-shell";
import { PageContainer, PageTitle } from "@/components/dashboard/page-container";
import { ClickOnArrival } from "@/components/shell/click-on-arrival";
import { Button } from "@/components/ui/button";
import { CONTEXT_TEXT } from "@/lib/context/text";
import { SHELL_TEXT } from "@/lib/shell/text";
import { directWorkspaceId, slackErrorMessage, wantsNewWorkspace } from "@/lib/shell/workspaces";

const T = SHELL_TEXT.picker;

/**
 * I tuoi workspace (rilascio 10, ondata 2a «Cornice», docs/ui-10/PROPOSTA-10.md §3.2): una card per workspace con il
 * nome, il ruolo in parole e «Condiviso»; «Nuovo workspace» bordato, pieno solo quando non ce n'è nessuno. Con un solo
 * workspace si entra diretti (D1), tranne quando si chiede l'elenco o c'è un avviso da leggere.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ slack_error?: string; workspaceDeleted?: string; granola?: string; tutti?: string; nuovo?: string }>;
}) {
  const session = await requireSession();

  const sp = searchParams ? await searchParams : {};
  const slackErrMsg = slackErrorMessage(sp.slack_error);

  const [userOrgs, workspacesWithOrgs] = await Promise.all([getOrganizationsByUser(session.user.id), getWorkspaceGroupsForUser(session.user.id)]);

  const direct = directWorkspaceId(workspacesWithOrgs, sp);
  if (direct) redirect(`/dashboard/${direct}`);

  const hasWorkspaces = workspacesWithOrgs.some((o) => o.workspaces.length > 0);
  const organizations = userOrgs.map((o) => o.organization);
  const create = (button: React.ReactNode) => (
    <CreateWorkspaceDialog organizations={organizations}>{wantsNewWorkspace(sp) ? <ClickOnArrival>{button}</ClickOnArrival> : button}</CreateWorkspaceDialog>
  );

  return (
    <DashboardListShell
      user={{
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      }}
    >
      <PageContainer size="narrow">
        {sp.workspaceDeleted === "1" ? (
          <p role="status" className="mb-6 rounded-lg border border-uc-verde/30 bg-uc-verde-bg px-4 py-3 text-sm text-uc-verde">
            {T.deleted}
          </p>
        ) : null}
        {sp.granola === "scaduto" ? (
          // Il ritorno da Granola con uno stato scaduto, senza un workspace da cui ripartire (rilascio 9a).
          <p role="status" className="mb-6 rounded-lg border px-4 py-3 text-sm text-muted-foreground">
            {CONTEXT_TEXT.granola.stateExpiredSomewhere}
          </p>
        ) : null}
        {slackErrMsg ? (
          <p role="alert" className="mb-6 rounded-lg border border-uc-giallo/30 bg-uc-giallo-bg px-4 py-3 text-sm text-uc-giallo">
            {slackErrMsg}
          </p>
        ) : null}

        {/* Al telefono (375 px) il titolo e «Nuovo workspace» non stanno su una riga: il pulsante va sotto, il titolo resta intero. */}
        <div className="mb-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <PageTitle>{T.title}</PageTitle>
          {hasWorkspaces
            ? create(
                <Button variant="outline">
                  <Plus aria-hidden />
                  {T.create}
                </Button>,
              )
            : null}
        </div>

        {!hasWorkspaces ? (
          <div className="mt-16 flex flex-col items-center gap-4 text-center">
            <p className="text-sm text-muted-foreground">{T.empty}</p>
            {create(
              <Button>
                <Plus aria-hidden />
                {T.create}
              </Button>,
            )}
          </div>
        ) : (
          <div className="space-y-8">
            {workspacesWithOrgs.map(({ organization, workspaces }) =>
              workspaces.length > 0 ? (
                <section key={organization.id} aria-label={organization.name}>
                  <p className="mb-3 text-xs text-muted-foreground">{organization.name}</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {workspaces.map(({ workspace, accessRole, accessSource }) => (
                      <WorkspaceCard key={workspace.id} workspace={workspace} orgSlug={organization.slug} accessRole={accessRole} accessSource={accessSource} />
                    ))}
                  </div>
                </section>
              ) : null,
            )}
          </div>
        )}
      </PageContainer>
    </DashboardListShell>
  );
}
