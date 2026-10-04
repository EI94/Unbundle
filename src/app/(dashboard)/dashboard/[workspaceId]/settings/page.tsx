import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { notFound } from "next/navigation";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { getSlackInstallationByWorkspace } from "@/lib/db/queries/slack";
import {
  getWorkspaceCollaborators,
  getWorkspaceInvitationsForWorkspace,
} from "@/lib/db/queries/workspace-collaboration";
import { getWorkspaceIntegrationTokens } from "@/lib/db/queries/workspace-integrations";
import { Badge } from "@/components/ui/badge";
import { EsgToggle } from "@/components/dashboard/esg-toggle";
import { SlackInstallButton } from "@/components/dashboard/slack-install-button";
import { SlackNotifyChannelForm } from "@/components/dashboard/slack-notify-channel-form";
import { DeleteWorkspaceForm } from "@/components/dashboard/delete-workspace-form";
import {
  canDeleteWorkspace,
  canManageWorkspaceCollaborators,
  canManageWorkspaceSettings,
} from "@/lib/workspace-permissions";
import { WorkspaceCollaborationCard } from "@/components/workspace/workspace-collaboration-card";
import { ClaudeMcpCard } from "@/components/workspace/claude-mcp-card";
import { MessageSquare, CheckCircle, Leaf, Lock, AlertTriangle } from "lucide-react";
import { PageContainer } from "@/components/dashboard/page-container";
import { SettingsSection } from "@/components/dashboard/settings-section";
import { DisableShareLinksButton } from "@/components/workspace/disable-share-links-button";
import { roleLabel } from "@/lib/workspace-roles";

function decodeSlackErrorParam(raw: string | undefined): string {
  if (!raw) return "";
  try {
    return decodeURIComponent(raw.replace(/\+/g, " "));
  } catch {
    return raw;
  }
}

function slackInstallErrorHint(decoded: string): string | null {
  const t = decoded.toLowerCase();
  if (t.includes("bad_client_secret")) {
    return (
      "Il valore di SLACK_CLIENT_SECRET su Vercel non corrisponde al Client Secret dell’app Slack " +
      "(oppure è vuoto o di un’altra app). Apri https://api.slack.com/apps → seleziona l’app Unbundle → " +
      "Basic Information → App Credentials → copia «Client Secret» e in Vercel (Project → Settings → " +
      "Environment Variables) imposta SLACK_CLIENT_SECRET per Production, salva e fai Redeploy. " +
      "Se hai rigenerato il secret in Slack, il vecchio su Vercel non funziona più."
    );
  }
  if (
    t.includes("did not match any configured") ||
    t.includes("bad_redirect_uri") ||
    t.includes("redirect_uri")
  ) {
    return (
      "L’URL di callback non è nella lista Slack. Vai su api.slack.com/apps → la tua app → OAuth & Permissions → " +
      "Redirect URLs e aggiungi **esattamente** l’URL che vedi nell’errore (host + `/api/slack/oauth`). " +
      "Se installi da un deploy Vercel preview (es. `*.vercel.app`), quell’host va aggiunto **in aggiunta** a " +
      "produzione (`www.theunbundle.com` / `theunbundle.com`). Slack non accetta wildcard: ogni dominio preview usato va elencato, oppure testa Slack solo da produzione."
    );
  }
  return null;
}

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ slack?: string; slack_error?: string }>;
}) {

  const { workspaceId } = await params;

  const { session, access } = await requireWorkspacePage(workspaceId);
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) notFound();

  const search = await searchParams;
  const [slackInstallation, collaborators, invitations, integrationTokens] = await Promise.all([
    getSlackInstallationByWorkspace(workspaceId),
    getWorkspaceCollaborators(workspaceId),
    getWorkspaceInvitationsForWorkspace(workspaceId),
    getWorkspaceIntegrationTokens(workspaceId),
  ]);
  const isSlackInstalled = !!slackInstallation;
  const canDelete =
    access.source === "organization" && canDeleteWorkspace(access.role);
  const canManageCollaborators = canManageWorkspaceCollaborators(access.role);
  const canManageIntegrations =
    access.source === "organization" && canManageWorkspaceSettings(access.role);
  const canManageSettings = canManageWorkspaceSettings(access.role);
  const slackErrDecoded = decodeSlackErrorParam(search.slack_error);
  const slackErrHint = slackErrDecoded ? slackInstallErrorHint(slackErrDecoded) : null;

  const roleName = roleLabel(access.role);
  const sections = [
    { id: "persone", label: "Persone" },
    { id: "integrazioni", label: "Integrazioni" },
    { id: "valutazione", label: "Valutazione" },
    { id: "zona-pericolosa", label: "Zona pericolosa" },
  ];

  return (
    <PageContainer>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">{workspace.name}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Impostazioni</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Chi ha accesso, le integrazioni e i criteri di valutazione di questo workspace.
          </p>
        </div>
        <Badge variant="outline" className="h-7 self-start px-3 sm:self-auto" data-testid="settings-role">
          Il tuo ruolo: {roleName}
        </Badge>
      </header>

      <nav
        aria-label="Sezioni delle impostazioni"
        className="-mx-4 mt-6 overflow-x-auto border-b px-4 sm:-mx-6 sm:px-6 md:sticky md:top-[53px] md:z-10 md:bg-background/90 md:backdrop-blur lg:-mx-8 lg:px-8"
      >
        <ul className="flex gap-1 py-2">
          {sections.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="inline-flex h-10 items-center whitespace-nowrap rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {section.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {search.slack === "installed" && isSlackInstalled && (
        <div className="mt-6 flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/5 px-4 py-3 text-sm text-green-300" role="status">
          <CheckCircle className="h-4 w-4 shrink-0" aria-hidden />
          Slack collegato.
        </div>
      )}

      {search.slack === "installed" && !isSlackInstalled && (
        <div className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100" role="alert">
          <p className="font-medium text-amber-50">Slack ha dato l&apos;ok, ma questo workspace non risulta collegato</p>
          <p className="mt-1 leading-relaxed">
            Controlla di essere nel workspace giusto e premi di nuovo «Collega Slack».
          </p>
          <details className="mt-2 text-xs text-amber-100/80">
            <summary className="cursor-pointer">Dettagli tecnici</summary>
            <p className="mt-1 leading-relaxed">
              Succede se l&apos;URL contiene <code>?slack=installed</code> ma sei in un altro workspace, oppure se
              l&apos;installazione è finita su un database diverso (per esempio un deploy di anteprima).
            </p>
          </details>
        </div>
      )}

      {search.slack_error && (
        <div className="mt-6 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-300" role="alert">
          <p className="font-medium">Non siamo riusciti a collegare Slack</p>
          <p className="mt-1 text-red-200/90">
            Riprova tra qualche minuto. Se succede ancora, scrivi al supporto indicando il codice qui sotto.
          </p>
          <p className="mt-2 break-words font-mono text-xs text-red-300/80">{slackErrDecoded}</p>
          {slackErrHint ? (
            <details className="mt-2 text-xs text-red-200/90">
              <summary className="cursor-pointer">Dettagli tecnici per chi gestisce l&apos;app Slack</summary>
              <p className="mt-1 leading-relaxed">{slackErrHint}</p>
            </details>
          ) : null}
        </div>
      )}

      <div className="mt-8 space-y-10">
        <WorkspaceCollaborationCard
          workspaceId={workspaceId}
          workspaceName={workspace.name}
          canManage={canManageCollaborators}
          currentUserId={session.user.id}
          members={collaborators.map((member) => ({
            userId: member.userId,
            name: member.name,
            email: member.email,
            role: member.role,
            source: member.source,
            createdAt: member.createdAt.toISOString(),
          }))}
          invitations={
            canManageCollaborators
              ? invitations.map((invitation) => ({
                  id: invitation.id,
                  email: invitation.email,
                  role: invitation.role,
                  maxUses: invitation.maxUses,
                  usedCount: invitation.usedCount,
                  expiresAt: invitation.expiresAt.toISOString(),
                  revokedAt: invitation.revokedAt?.toISOString() ?? null,
                  createdAt: invitation.createdAt.toISOString(),
                  createdByName: invitation.createdByName,
                  acceptedByEmail: invitation.acceptedByEmail,
                }))
              : []
          }
        />

        <div id="integrazioni" className="scroll-mt-28 space-y-6">
          <SettingsSection
            icon={MessageSquare}
            iconClassName="bg-purple-500/10 text-purple-400"
            title="Slack"
            description="I colleghi propongono use case scrivendo al bot, e chi gestisce il workspace riceve le notifiche."
            aside={
              isSlackInstalled ? (
                <Badge variant="outline" className="border-green-500/30 text-green-400">
                  <CheckCircle className="mr-1 h-3 w-3" aria-hidden />
                  Connesso
                </Badge>
              ) : !canManageIntegrations ? (
                <Badge variant="outline" className="text-muted-foreground">
                  <Lock className="mr-1 h-3 w-3" aria-hidden />
                  Solo amministratori
                </Badge>
              ) : (
                <SlackInstallButton workspaceId={workspaceId} />
              )
            }
          >
            <div className="grid gap-6 @3xl:grid-cols-2">
              <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
                {isSlackInstalled ? (
                  <>
                    <p>
                      Collegato a{" "}
                      <span className="font-medium text-foreground">
                        {slackInstallation.slackTeamName ?? slackInstallation.slackTeamId}
                      </span>
                      .
                    </p>
                    <p>
                      Per usarlo in un canale aggiungi il bot con{" "}
                      <code className="font-mono text-purple-300">/invite @Unbundle</code> e poi menzionalo; puoi anche
                      scrivergli in privato. Nei canali condivisi con altre aziende, ogni contributo va al workspace
                      dell&apos;azienda di chi scrive.
                    </p>
                  </>
                ) : (
                  <p>
                    Dopo il collegamento aggiungi il bot ai canali in cui vuoi usarlo scrivendo{" "}
                    <code className="font-mono text-purple-300">/invite @Unbundle</code>. Potrai anche scegliere un
                    canale per le notifiche agli amministratori.
                  </p>
                )}
                {canManageIntegrations && (
                  <details className="text-xs">
                    <summary className="cursor-pointer">Dettagli tecnici per chi gestisce l&apos;app Slack</summary>
                    <p className="mt-2">
                      Se nei messaggi diretti compare «invio messaggi disattivato», in{" "}
                      <a className="underline" href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer">
                        api.slack.com/apps
                      </a>{" "}
                      → App Home abilita la scheda Messaggi. Le menzioni richiedono che Event Subscriptions punti a{" "}
                      <code>…/api/slack/events</code> sullo stesso deploy che ha salvato l&apos;installazione.
                    </p>
                  </details>
                )}
              </div>
              <div className="space-y-6">
                {isSlackInstalled &&
                  (canManageIntegrations ? (
                    <SlackNotifyChannelForm workspaceId={workspaceId} initialChannelId={slackInstallation.notifyChannelId} />
                  ) : (
                    <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                      Il canale per le notifiche lo sceglie un amministratore dell&apos;organizzazione.
                    </p>
                  ))}
                <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                  <p className="text-sm font-medium">Link pubblici al portfolio</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Le notifiche su Slack portano a una copia in sola lettura del portfolio, valida 30 giorni. Si
                    disattivano da sole quando rimuovi una persona; puoi farlo anche ora.
                  </p>
                  {canManageCollaborators ? <DisableShareLinksButton workspaceId={workspaceId} /> : null}
                </div>
              </div>
            </div>
          </SettingsSection>

          <ClaudeMcpCard
            workspaceId={workspaceId}
            workspaceName={workspace.name}
            canManage={canManageIntegrations}
            tokens={integrationTokens.map((token) => ({
              id: token.id,
              label: token.label,
              provider: token.provider,
              tokenPrefix: token.tokenPrefix,
              scopes: token.scopes,
              lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
              expiresAt: token.expiresAt?.toISOString() ?? null,
              revokedAt: token.revokedAt?.toISOString() ?? null,
              createdAt: token.createdAt.toISOString(),
            }))}
          />
        </div>

        <SettingsSection
          id="valutazione"
          icon={Leaf}
          iconClassName="bg-green-500/10 text-green-400"
          title="Criteri ESG"
          description={
            <>
              Aggiunge ambiente, impatto sociale e governance ai criteri con cui valuti gli use case.
              {!canManageSettings && (
                <span className="mt-1 block text-xs">Solo chi amministra il workspace può cambiarlo.</span>
              )}
            </>
          }
          aside={
            <EsgToggle
              workspaceId={workspaceId}
              initialEnabled={workspace.esgEnabled === true}
              canManage={canManageSettings}
            />
          }
        />

        <SettingsSection
          id="zona-pericolosa"
          tone="danger"
          icon={AlertTriangle}
          iconClassName="bg-red-500/10 text-red-400"
          title="Zona pericolosa"
          description="Azioni definitive: non si possono annullare."
        >
          <DeleteWorkspaceForm workspaceId={workspaceId} workspaceName={workspace.name} canDelete={canDelete} />
        </SettingsSection>
      </div>
    </PageContainer>
  );
}
