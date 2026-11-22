import { notFound } from "next/navigation";
import { CheckCircle } from "lucide-react";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { getSlackInstallationByWorkspace } from "@/lib/db/queries/slack";
import { getWorkspaceCollaborators, getWorkspaceInvitationsForWorkspace } from "@/lib/db/queries/workspace-collaboration";
import { CLAUDE_MCP_PROVIDER, getWorkspaceIntegrationTokens } from "@/lib/db/queries/workspace-integrations";
import { loadTeamMcpCard } from "@/lib/db/queries/team-mcp-tokens";
import { isUcEnabledFor, isUcLsConfigured, ucLsDomains } from "@/lib/db/queries/uc-access";
import { isLateralSpaceEmail } from "@/lib/uc/lateral-space";
import { canDeleteWorkspace, canManageWorkspaceCollaborators, canManageWorkspaceSettings } from "@/lib/workspace-permissions";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import { USE_CASE_VALUATION_ANCHOR } from "@/lib/use-cases/settings";
import { PAGE_TITLE_CLASS, PageContainer } from "@/components/dashboard/page-container";
import { SegmentedNav } from "@/components/dashboard/segmented-nav";
import { DeleteWorkspaceForm } from "@/components/dashboard/delete-workspace-form";
import { EsgToggle } from "@/components/dashboard/esg-toggle";
import { SlackNotifyChannelForm } from "@/components/dashboard/slack-notify-channel-form";
import { ValuationSettings } from "@/components/use-cases/settings/valuation-settings";
import { AlertsForm } from "@/components/workspace/alerts-form";
import { ClaudeMcpCard } from "@/components/workspace/claude-mcp-card";
import { countClaudeAccesses } from "@/components/workspace/claude-tokens";
import { ConnectionsTab, type ConnectionKey, type ConnectionRowView } from "@/components/workspace/connections-tab";
import { ConnectorPanel, loadConnectorRow } from "@/components/workspace/connector-card";
import { DisableShareLinksButton } from "@/components/workspace/disable-share-links-button";
import { SETTINGS_TEXT } from "@/components/workspace/settings-text";
import { SettingsAnchor } from "@/components/workspace/settings-anchor";
import { SETTINGS_TAB_PARAM, settingsTabHref, settingsTabOf, visibleSettingsTabs, type SettingsTab } from "@/components/workspace/settings-view";
import { decodeSlackErrorParam, slackInstallErrorHint } from "@/components/workspace/slack-errors";
import { SubprocessorsCard, subprocessorsShown } from "@/components/workspace/subprocessors-card";
import { TeamTokensRevokeAll } from "@/components/workspace/team-mcp-card";
import { TeamTab } from "@/components/workspace/workspace-collaboration-card";

const T = SETTINGS_TEXT;

/**
 * Impostazioni del workspace (rilascio 10, ondata 6b, docs/ui-10/PROPOSTA-10.md §3.10, §2.4): cinque schede, Team ·
 * Collegamenti · Valutazione · Privacy · Zona pericolosa, ognuna al suo indirizzo (`?scheda=`). Si vede solo quello che
 * chi guarda può fare: Team (chi ha accesso) a ogni membro, che invita solo chi gestisce; i Collegamenti a chi ne usa o
 * ne gestisce uno; la Valutazione a chi gestisce il workspace; la Privacy a chi vede i fornitori dei dati o gestisce i
 * link condivisi; la Zona pericolosa a chi può eliminare il workspace. Ciò che è personale (le e-mail, Claude e il
 * terminale, Granola) sta nel foglio «Il tuo account». La pagina si apre a chiunque sia nel workspace, senza un
 * controllo di ruolo: le azioni ricontrollano tutto sul server.
 *
 * Le ancore di prima portano alla loro scheda (`SettingsAnchor`); `#cli` e `#granola` aprono «Il tuo account».
 */
export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ slack?: string; slack_error?: string; granola?: string; scheda?: string; apri?: string }>;
}) {
  const { workspaceId } = await params;

  const { session, access } = await requireWorkspacePage(workspaceId);
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) notFound();
  const search = await searchParams;

  const lateralSpace = isLateralSpaceEmail({ email: session.user.email ?? null, emailVerified: session.user.emailVerified === true }, ucLsDomains());
  const canDelete = access.source === "organization" && canDeleteWorkspace(access.role);
  const canManageCollaborators = canManageWorkspaceCollaborators(access.role);
  const canManageIntegrations = access.source === "organization" && canManageWorkspaceSettings(access.role);
  const canManageSettings = canManageWorkspaceSettings(access.role);
  // Area «Use case» accesa (DESIGN §12.1, §13): nome del team, codici, soglie, fasce e modello stanno in «Valutazione»;
  // il webhook WhatsApp in «Altri avvisi». Solo per chi gestisce il workspace, come le action.
  const useCaseHub = isUseCaseHubWorkspace(workspaceId);
  const useCaseSettings = useCaseHub && canManageSettings;

  const [slackInstallation, suppliers] = await Promise.all([getSlackInstallationByWorkspace(workspaceId), subprocessorsShown(workspaceId).catch(() => false)]);
  const visible = visibleSettingsTabs({
    manages: canManageSettings,
    links: canManageIntegrations || useCaseSettings || Boolean(slackInstallation),
    privacy: suppliers || canManageCollaborators,
    canDelete,
  });
  const tab = settingsTabOf(search[SETTINGS_TAB_PARAM], visible, { slackReturn: Boolean(search.slack || search.slack_error) });
  const panel = search.apri ?? null;

  let body: React.ReactNode;
  if (tab === "team") {
    const [collaborators, invitations] = await Promise.all([getWorkspaceCollaborators(workspaceId), canManageCollaborators ? getWorkspaceInvitationsForWorkspace(workspaceId) : Promise.resolve([])]);
    body = (
      <TeamTab
        workspaceId={workspaceId}
        workspaceName={workspace.name}
        canManage={canManageCollaborators}
        currentUserId={session.user.id}
        initialPanel={panel}
        members={collaborators.map((member) => ({
          userId: member.userId,
          name: member.name,
          email: member.email,
          role: member.role,
          source: member.source,
          createdAt: member.createdAt.toISOString(),
        }))}
        invitations={invitations.map((invitation) => ({
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
        }))}
      />
    );
  } else if (tab === "collegamenti") {
    body = await connectionsBody({ workspaceId, workspace, session, access, search, panel, lateralSpace, slackInstallation, canManageIntegrations, useCaseHub, useCaseSettings });
  } else if (tab === "valutazione") {
    const esg = (
      <div id="valutazione" className="flex min-h-11 scroll-mt-28 items-start justify-between gap-4 rounded-lg border p-3" data-slot="settings-esg">
        <div className="min-w-0">
          <p className="text-sm font-medium">{T.esg.title}</p>
          <p className="text-xs text-muted-foreground">{T.esg.lead}</p>
        </div>
        <EsgToggle workspaceId={workspaceId} initialEnabled={workspace.esgEnabled === true} canManage={canManageSettings} />
      </div>
    );
    body = useCaseSettings ? <ValuationSettings workspaceId={workspaceId} id={USE_CASE_VALUATION_ANCHOR} modelExtra={esg} /> : esg;
  } else if (tab === "privacy") {
    body = (
      <div className="space-y-8">
        <SubprocessorsCard workspaceId={workspaceId} workspaceName={workspace.name} userId={session.user.id} workspaceRole={access.role} initialPanel={panel} />
        {canManageCollaborators ? (
          <section id="link-condivisi" aria-labelledby="link-condivisi-titolo" className="scroll-mt-28 space-y-3" data-slot="settings-share-links">
            <h2 id="link-condivisi-titolo" className="text-base font-semibold">
              {T.privacy.links}
            </h2>
            <p className="text-sm text-muted-foreground">{T.privacy.linksLead}</p>
            <DisableShareLinksButton workspaceId={workspaceId} />
          </section>
        ) : null}
      </div>
    );
  } else {
    body = (
      <section id="zona-pericolosa" aria-label={T.danger.title} className="scroll-mt-28 rounded-xl p-4 ring-1 ring-uc-rosso/40 sm:p-6">
        <DeleteWorkspaceForm workspaceId={workspaceId} workspaceName={workspace.name} canDelete={canDelete} />
      </section>
    );
  }

  return (
    <PageContainer>
      <header className="space-y-3">
        <h1 className={PAGE_TITLE_CLASS}>{T.title}</h1>
        {/* (F-005) La configurazione di Lateral Space che manca: le realizzazioni sono in sola lettura. A chi gestisce. */}
        {canManageSettings && isUcEnabledFor(workspaceId) && !isUcLsConfigured() ? (
          <p role="status" data-slot="settings-config-incomplete" className="flex items-start gap-2 rounded-lg bg-uc-giallo-bg px-3 py-2 text-sm">
            <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-uc-giallo" />
            {T.configIncomplete}
          </p>
        ) : null}
      </header>
      {visible.length > 1 ? (
        <SegmentedNav
          className="mt-6"
          ariaLabel={T.tabsLabel}
          active={tab}
          gridOnPhone
          items={visible.map((key: SettingsTab) => ({ key, label: T.tabs[key], href: settingsTabHref(workspaceId, key) }))}
        />
      ) : null}
      <SettingsAnchor workspaceId={workspaceId} current={tab} visible={visible} />
      <div className="mt-8" data-settings-tab={tab}>
        {body}
      </div>
    </PageContainer>
  );
}

/** La scheda «Collegamenti»: le righe che chi guarda può usare, e il contenuto dei loro pannelli. */
async function connectionsBody(i: {
  workspaceId: string;
  workspace: { name: string; whatsappWebhookUrl: string | null };
  session: { user: { id: string; email?: string | null; emailVerified?: boolean | null } };
  access: { role: string; source: "organization" | "workspace" };
  search: { slack?: string; slack_error?: string };
  panel: string | null;
  lateralSpace: boolean;
  slackInstallation: Awaited<ReturnType<typeof getSlackInstallationByWorkspace>>;
  canManageIntegrations: boolean;
  useCaseHub: boolean;
  useCaseSettings: boolean;
}) {
  const L = T.links;
  const { workspaceId, slackInstallation } = i;
  const [connector, teamCard, integrationTokens] = await Promise.all([
    loadConnectorRow(workspaceId, i.access),
    loadTeamMcpCard({ workspaceId, user: { id: i.session.user.id, email: i.session.user.email ?? null, emailVerified: i.session.user.emailVerified === true }, role: i.access.role }),
    // La card v1 «Claude per Unbundle» e le realizzazioni: solo `provider = 'claude_mcp'` (D11, DESIGN §9.7).
    i.canManageIntegrations ? getWorkspaceIntegrationTokens(workspaceId, { providers: [CLAUDE_MCP_PROVIDER] }) : Promise.resolve([]),
  ]);
  const tokens = integrationTokens.map((token) => ({
    id: token.id,
    label: token.label,
    provider: token.provider,
    tokenPrefix: token.tokenPrefix,
    scopes: token.scopes,
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    expiresAt: token.expiresAt?.toISOString() ?? null,
    revokedAt: token.revokedAt?.toISOString() ?? null,
    createdAt: token.createdAt.toISOString(),
  }));
  const claude = countClaudeAccesses(tokens);
  const teamActive = teamCard?.canRevokeAll ? (teamCard.workspaceActiveCount ?? 0) : 0;
  const showClaudeCard = i.canManageIntegrations && (!i.useCaseHub || claude.v1 > 0 || claude.realizations > 0);

  const rows: ConnectionRowView[] = [];
  const panels: Partial<Record<ConnectionKey, React.ReactNode>> = {};
  const team = slackInstallation ? (slackInstallation.slackTeamName ?? slackInstallation.slackTeamId) : null;
  if (slackInstallation || i.canManageIntegrations) {
    rows.push({
      key: "slack",
      name: L.slack.name,
      state: slackInstallation ? { tone: "verde", label: L.slack.on } : { tone: "grigio", label: L.slack.off },
      fact: team ? (i.canManageIntegrations ? L.slack.onTeam(team) : `${L.slack.onTeam(team)} · ${L.slack.howTo}`) : L.slack.howToBefore,
      action: !i.canManageIntegrations ? null : slackInstallation ? { kind: "panel", label: L.manage } : { kind: "slack", label: L.connect },
    });
    if (slackInstallation && i.canManageIntegrations) {
      panels.slack = (
        <div className="space-y-5" data-slot="slack-panel">
          <div className="space-y-2 text-sm">
            {team ? <p className="font-medium">{L.slack.onTeam(team)}</p> : null}
            <p className="text-muted-foreground">{L.slack.howTo}</p>
            <p className="text-muted-foreground">{L.slack.shared}</p>
          </div>
          <SlackNotifyChannelForm workspaceId={workspaceId} initialChannelId={slackInstallation.notifyChannelId} />
          {i.lateralSpace ? (
            <details className="text-xs text-muted-foreground">
              <summary className="inline-flex min-h-11 cursor-pointer items-center sm:min-h-8">{T.technical}</summary>
              <p className="mt-1">{L.slack.technicalApp}</p>
            </details>
          ) : null}
        </div>
      );
    }
  }
  if (connector.kind !== "hidden") {
    const status = connector.kind === "ready" ? connector.view.status : null;
    rows.push({
      key: "organizzazione",
      name: L.organization.name,
      state: status ? { tone: status === "attivo" ? "verde" : status === "non_configurato" ? "grigio" : "giallo", label: L.organization.state[status] } : null,
      fact: connector.kind === "error" ? L.organization.loadFailed : null,
      action: connector.kind === "ready" ? { kind: "panel", label: L.manage } : null,
    });
    if (connector.kind === "ready") panels.organizzazione = <ConnectorPanel workspaceId={workspaceId} view={connector.view} lead={L.organization.lead} />;
  }
  if (teamActive > 0 || showClaudeCard) {
    const active = teamActive + (i.canManageIntegrations ? claude.v1 + claude.realizations : 0);
    rows.push({ key: "accessi", name: L.accesses.name, state: { tone: active > 0 ? "verde" : "grigio", label: L.accesses.state(active) }, action: { kind: "panel", label: L.manage } });
    panels.accessi = (
      <div className="space-y-6" data-slot="accesses-panel">
        {teamActive > 0 ? <TeamTokensRevokeAll workspaceId={workspaceId} activeCount={teamActive} /> : null}
        {showClaudeCard ? <ClaudeMcpCard workspaceId={workspaceId} workspaceName={i.workspace.name} canManage={i.canManageIntegrations} useCaseHub={i.useCaseHub} tokens={tokens} /> : null}
      </div>
    );
  }
  if (i.useCaseSettings) {
    const on = Boolean(i.workspace.whatsappWebhookUrl);
    rows.push({ key: "avvisi", name: L.alerts.name, state: on ? { tone: "verde", label: L.alerts.on } : { tone: "grigio", label: L.alerts.off }, action: { kind: "panel", label: L.manage } });
    panels.avvisi = <AlertsForm key={`avvisi-${i.workspace.whatsappWebhookUrl ?? ""}`} workspaceId={workspaceId} initialUrl={i.workspace.whatsappWebhookUrl ?? ""} />;
  }

  // Il ritorno da Slack: l'esito in una frase; il codice e che cosa fare li vede solo Lateral Space.
  const slackError = decodeSlackErrorParam(i.search.slack_error);
  const hint = slackError ? slackInstallErrorHint(slackError) : null;
  const banner =
    i.search.slack === "installed" && slackInstallation ? (
      <p role="status" className="flex items-center gap-2 rounded-lg bg-uc-verde-bg px-3 py-2 text-sm">
        <CheckCircle aria-hidden className="size-4 shrink-0 text-uc-verde" />
        {L.slack.installed}
      </p>
    ) : i.search.slack === "installed" ? (
      <div role="alert" className="space-y-1 rounded-lg bg-uc-giallo-bg px-3 py-2 text-sm">
        <p className="font-medium">{L.slack.mismatchTitle}</p>
        <p>{L.slack.mismatchBody}</p>
        {i.lateralSpace ? (
          <details className="text-xs text-muted-foreground">
            <summary className="inline-flex min-h-11 cursor-pointer items-center sm:min-h-8">{T.technical}</summary>
            <p className="mt-1">{L.slack.mismatchTechnical}</p>
          </details>
        ) : null}
      </div>
    ) : slackError ? (
      <div role="alert" className="space-y-1 rounded-lg bg-uc-rosso-bg px-3 py-2 text-sm">
        <p className="font-medium">{L.slack.errorTitle}</p>
        <p>{L.slack.errorBody}</p>
        {i.lateralSpace ? (
          <details className="text-xs text-muted-foreground">
            <summary className="inline-flex min-h-11 cursor-pointer items-center sm:min-h-8">{T.technical}</summary>
            <p className="mt-1 font-mono break-words">{slackError}</p>
            {hint ? <p className="mt-1">{hint}</p> : null}
          </details>
        ) : null}
      </div>
    ) : null;

  return <ConnectionsTab workspaceId={workspaceId} rows={rows} panels={panels} banner={banner} initialPanel={i.panel} />;
}
