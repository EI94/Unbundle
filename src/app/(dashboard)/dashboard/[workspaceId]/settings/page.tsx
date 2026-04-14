import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { getSlackInstallationByWorkspace } from "@/lib/db/queries/slack";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EsgToggle } from "@/components/dashboard/esg-toggle";
import { SlackInstallButton } from "@/components/dashboard/slack-install-button";
import { MessageSquare, CheckCircle, Leaf } from "lucide-react";

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ slack?: string; slack_error?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { workspaceId } = await params;
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) notFound();

  const search = await searchParams;
  const slackInstallation = await getSlackInstallationByWorkspace(workspaceId);
  const isSlackInstalled = !!slackInstallation;

  return (
    <div className="flex-1 p-6 lg:p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Integrazioni</h1>
        <p className="mt-1 text-muted-foreground">
          Configura le integrazioni esterne per il tuo workspace
        </p>
      </div>

      {search.slack === "installed" && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/5 px-4 py-3 text-sm text-green-400">
          <CheckCircle className="h-4 w-4" />
          Slack installato con successo!
        </div>
      )}

      {search.slack_error && (
        <div className="mb-6 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          Errore durante l&apos;installazione di Slack: {search.slack_error}
        </div>
      )}

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10">
                  <MessageSquare className="h-5 w-5 text-purple-400" />
                </div>
                <div>
                  <CardTitle className="text-base">Slack</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Bot per proporre use case AI direttamente da Slack
                  </p>
                </div>
              </div>
              {isSlackInstalled ? (
                <Badge variant="outline" className="border-green-500/30 text-green-400">
                  <CheckCircle className="mr-1 h-3 w-3" />
                  Connesso
                </Badge>
              ) : (
                <SlackInstallButton workspaceId={workspaceId} />
              )}
            </div>
          </CardHeader>
          {isSlackInstalled && (
            <CardContent className="pt-0">
              <div className="rounded-lg bg-accent/30 px-4 py-3 text-sm">
                <p className="text-muted-foreground">
                  Workspace: <span className="text-foreground font-medium">{slackInstallation.slackTeamName ?? slackInstallation.slackTeamId}</span>
                </p>
                <p className="text-muted-foreground mt-1">
                  Gli utenti possono taggare <span className="font-mono text-purple-400">@unbundle</span> su Slack o scrivere in DM per proporre use case.
                </p>
              </div>
            </CardContent>
          )}
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
                  <Leaf className="h-5 w-5 text-green-400" />
                </div>
                <div>
                  <CardTitle className="text-base">Scoring ESG</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Includi Environmental, Social, Governance nella valutazione use case
                  </p>
                </div>
              </div>
              <EsgToggle
                workspaceId={workspaceId}
                initialEnabled={workspace.esgEnabled === true}
              />
            </div>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
