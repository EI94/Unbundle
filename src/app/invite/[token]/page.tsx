import Link from "next/link";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { getWorkspaceInvitationByToken } from "@/lib/db/queries/workspace-collaboration";
import { isInvitationActive } from "@/lib/workspace-invite-token";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { WorkspaceInviteAcceptForm } from "@/components/workspace/workspace-invite-accept-form";
import { SwitchAccountButton } from "@/components/workspace/switch-account-button";

export const metadata: Metadata = {
  title: "Invito workspace",
  robots: { index: false, follow: false, nocache: true },
};

const roleLabels: Record<string, string> = {
  exec_sponsor: "Executive Sponsor",
  transformation_lead: "Transformation Lead",
  function_lead: "Function Lead",
  contributor: "Contributor",
  analyst: "Analyst",
};

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export default async function WorkspaceInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [session, found] = await Promise.all([
    auth(),
    getWorkspaceInvitationByToken(token),
  ]);

  if (!found || !isInvitationActive(found.invitation)) {
    return (
      <InviteShell>
        <Card>
          <CardHeader>
            <CardTitle>Invito non disponibile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>
              Il link è scaduto, è stato revocato o è già stato accettato.
            </p>
            <Button
              render={<Link href="/dashboard" />}
              nativeButton={false}
              variant="outline"
            >
              Vai alla dashboard
            </Button>
          </CardContent>
        </Card>
      </InviteShell>
    );
  }

  const { invitation, workspace, organization } = found;
  const callbackUrl = `/invite/${encodeURIComponent(token)}`;
  const loginHref = `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`;

  return (
    <InviteShell>
      <Card className="overflow-hidden">
        <div className="border-b bg-linear-to-br from-emerald-500/10 via-background to-amber-500/10 p-6">
          <Badge variant="secondary">Workspace condiviso</Badge>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">
            Entra in {workspace.name}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {organization.name} ti ha invitato a collaborare nello stesso
            workspace Unbundle.
          </p>
        </div>
        <CardContent className="space-y-5 p-6">
          <div className="grid gap-3 rounded-2xl border bg-muted/30 p-4 text-sm sm:grid-cols-2">
            <div>
              <div className="text-xs text-muted-foreground">Ruolo</div>
              <div className="mt-1 font-medium">
                {roleLabels[invitation.role] ?? invitation.role}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Scadenza</div>
              <div className="mt-1 font-medium">
                {formatDate(invitation.expiresAt)}
              </div>
            </div>
          </div>

          {(() => {
            const sessionEmail = session?.user?.email?.trim().toLowerCase() ?? null;
            const invitedEmail = invitation.email?.trim().toLowerCase() ?? null;
            const wrongAccount =
              sessionEmail != null && invitedEmail != null && sessionEmail !== invitedEmail;

            // Stile Slack: un solo stato chiaro alla volta, mai un vicolo cieco.
            if (!session?.user) {
              return (
                <div className="space-y-3">
                  {invitedEmail && (
                    <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                      Invito riservato a{" "}
                      <span className="font-medium text-foreground">{invitation.email}</span>:
                      accedi o registrati con quella email.
                    </p>
                  )}
                  <Button
                    render={<Link href={loginHref} />}
                    nativeButton={false}
                    className="w-full"
                  >
                    Accedi o registrati per accettare
                  </Button>
                  <p className="text-center text-xs text-muted-foreground">
                    Dopo l&apos;accesso tornerai automaticamente qui.
                  </p>
                </div>
              );
            }

            if (wrongAccount) {
              return (
                <div className="space-y-3" data-testid="invite-wrong-account">
                  <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-200">
                    Sei connesso come{" "}
                    <span className="font-medium">{session.user.email}</span>, ma
                    questo invito è riservato a{" "}
                    <span className="font-medium">{invitation.email}</span>.
                  </p>
                  <SwitchAccountButton loginHref={loginHref} />
                  <p className="text-center text-xs text-muted-foreground">
                    Oppure chiedi a chi ti ha invitato un nuovo link per{" "}
                    {session.user.email}.
                  </p>
                </div>
              );
            }

            return (
              <div className="space-y-3">
                <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  Connesso come{" "}
                  <span className="font-medium text-foreground">
                    {session.user.email}
                  </span>
                </p>
                <WorkspaceInviteAcceptForm token={token} />
              </div>
            );
          })()}
        </CardContent>
      </Card>
    </InviteShell>
  );
}

function InviteShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background px-6 py-10">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-xl flex-col justify-center">
        <Link href="/" className="mb-6 text-sm font-semibold tracking-wide">
          Unbundle
        </Link>
        {children}
      </div>
    </main>
  );
}
