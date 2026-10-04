"use client";

import Link from "next/link";
import { startTransition, useActionState, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  createWorkspaceInvitationAction,
  recreateWorkspaceInvitationAction,
  removeWorkspaceMemberAction,
  revokeWorkspaceInvitationAction,
  updateWorkspaceMemberRoleAction,
  type CreateWorkspaceInviteData,
  type WorkspaceCollaborationActionState,
  type WorkspaceInvitationMutationData,
  type WorkspaceMemberMutationData,
} from "@/lib/actions/workspace-collaboration";
import { WORKSPACE_INVITE_EXPIRES_IN_DAYS } from "@/lib/workspace-invite-config";
import { INVITABLE_ROLES, ROLE_INFO, roleLabel } from "@/lib/workspace-roles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsSection } from "@/components/dashboard/settings-section";
import { Users, Link2, Copy, Share2, RotateCcw, GraduationCap, MessageSquareText } from "lucide-react";

/**
 * Persone del workspace: chi ha accesso e i link per invitarne altre.
 *
 * Due cose da non far sbagliare a chi la usa: ogni link vale per UNA persona
 * (WORKSPACE_INVITE_MAX_USES = 1), e i partecipanti ai corsi non sono
 * collaboratori (si gestiscono da Formazione, non da qui).
 */

type Member = {
  userId: string;
  name: string | null;
  email: string;
  role: string;
  source: "organization" | "workspace";
  createdAt: string;
};

type Invitation = {
  id: string;
  email: string | null;
  role: string;
  maxUses: number;
  usedCount: number;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  createdByName: string | null;
  acceptedByEmail: string | null;
};

type InviteStatus = "active" | "expired" | "used" | "revoked";

const INITIAL_CREATE: WorkspaceCollaborationActionState<CreateWorkspaceInviteData> = { ok: true };
const INITIAL_MUTATION: WorkspaceCollaborationActionState<WorkspaceInvitationMutationData> = { ok: true };
const INITIAL_MEMBER: WorkspaceCollaborationActionState<WorkspaceMemberMutationData> = { ok: true };

const statusLabels: Record<InviteStatus, string> = {
  active: "In attesa",
  expired: "Scaduto",
  used: "Usato",
  revoked: "Disattivato",
};

const SELECT_CLASS =
  "h-10 w-full rounded-lg border border-input bg-background px-2 text-base sm:h-8 sm:text-sm";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function getInviteStatus(invite: Invitation, now: number): InviteStatus {
  if (invite.revokedAt) return "revoked";
  if (invite.usedCount >= invite.maxUses) return "used";
  if (new Date(invite.expiresAt).getTime() <= now) return "expired";
  return "active";
}

function invitationFromAction(data: CreateWorkspaceInviteData): Invitation {
  return {
    id: data.invitationId,
    email: data.email,
    role: data.role,
    maxUses: data.maxUses,
    usedCount: data.usedCount,
    expiresAt: data.expiresAt,
    revokedAt: null,
    createdAt: data.createdAt,
    createdByName: null,
    acceptedByEmail: null,
  };
}

const subscribeNothing = () => () => {};
/** navigator.share esiste solo nel browser (soprattutto su telefono): mai durante il rendering sul server. */
function useCanShare() {
  return useSyncExternalStore(
    subscribeNothing,
    () => typeof navigator.share === "function",
    () => false
  );
}

function inviteMessage(workspaceName: string, invite: CreateWorkspaceInviteData) {
  const who = invite.email ? "" : " (vale solo per te)";
  return (
    `Ciao! Ti invito a collaborare su «${workspaceName}» in Unbundle come ${roleLabel(invite.role)}.\n` +
    `Apri il link entro il ${formatDate(invite.expiresAt)}${who}:\n${invite.inviteUrl}`
  );
}

export function WorkspaceCollaborationCard({
  workspaceId,
  workspaceName,
  members,
  invitations,
  canManage,
  currentUserId,
}: {
  workspaceId: string;
  workspaceName: string;
  members: Member[];
  invitations: Invitation[];
  canManage: boolean;
  currentUserId?: string;
}) {
  const createAction = createWorkspaceInvitationAction.bind(null, workspaceId);
  const recreateAction = recreateWorkspaceInvitationAction.bind(null, workspaceId);
  const revokeAction = revokeWorkspaceInvitationAction.bind(null, workspaceId);
  const memberRoleAction = updateWorkspaceMemberRoleAction.bind(null, workspaceId);
  const memberRemoveAction = removeWorkspaceMemberAction.bind(null, workspaceId);

  // Campi controllati: React 19 svuota i moduli dopo ogni azione, anche quando
  // fallisce, e l'email rifiutata o il ruolo scelto non devono sparire.
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("analyst");
  // I link creati con successo in questa scheda: il link si vede una volta
  // sola, quindi un errore successivo non deve farlo sparire.
  const [createdLinks, setCreatedLinks] = useState<CreateWorkspaceInviteData[]>([]);
  const [createState, createFormAction, createPending] = useActionState(
    async (previous: WorkspaceCollaborationActionState<CreateWorkspaceInviteData>, formData: FormData) => {
      const result = await createAction(previous, formData);
      if (result.ok && result.data) {
        setInviteEmail("");
        const created = result.data;
        setCreatedLinks((links) => [created, ...links]);
      }
      return result;
    },
    INITIAL_CREATE
  );
  const [recreateState, recreateFormAction, recreatePending] = useActionState(
    async (previous: WorkspaceCollaborationActionState<CreateWorkspaceInviteData>, formData: FormData) => {
      const result = await recreateAction(previous, formData);
      if (result.ok && result.data) {
        const created = result.data;
        setCreatedLinks((links) => [created, ...links]);
      }
      return result;
    },
    INITIAL_CREATE
  );
  const [revokeState, revokeFormAction, revokePending] = useActionState(revokeAction, INITIAL_MUTATION);
  const [memberRoleState, memberRoleFormAction, memberRolePending] = useActionState(memberRoleAction, INITIAL_MEMBER);
  const [memberRemoveState, memberRemoveFormAction, memberRemovePending] = useActionState(memberRemoveAction, INITIAL_MEMBER);

  const [lastAction, setLastAction] = useState<"create" | "recreate" | "revoke" | null>(null);
  const [lastMemberAction, setLastMemberAction] = useState<"role" | "remove" | null>(null);
  const [now] = useState(() => Date.now());
  const canShare = useCanShare();
  const linkBoxRef = useRef<HTMLDivElement>(null);

  const revokedId = revokeState.ok ? revokeState.data?.invitationId ?? null : null;
  const localInvitations = useMemo(() => {
    const extra = createdLinks
      .filter((data) => !invitations.some((invite) => invite.id === data.invitationId))
      .map(invitationFromAction);
    const replaced = new Set([...createdLinks.map((data) => data.replacedInvitationId), revokedId].filter(Boolean));
    return [...extra, ...invitations].map((invite) =>
      replaced.has(invite.id) && !invite.revokedAt ? { ...invite, revokedAt: new Date(now).toISOString() } : invite
    );
  }, [createdLinks, invitations, revokedId, now]);

  // Il riquadro mostra il link più recente creato qui, solo se è ancora
  // utilizzabile: mai uno annullato, sostituito, usato o scaduto.
  const latestInvite =
    createdLinks.find((data) => {
      const row = localInvitations.find((invite) => invite.id === data.invitationId);
      return row ? getInviteStatus(row, now) === "active" : false;
    }) ?? null;

  useEffect(() => {
    if (lastAction !== "recreate" || !recreateState.ok || !recreateState.data) return;
    // Il nuovo link compare in cima alla colonna: lo si porta in vista, perché
    // il pulsante premuto può essere molto più in basso.
    linkBoxRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    linkBoxRef.current?.querySelector("input")?.focus();
  }, [lastAction, recreateState.ok, recreateState.data]);

  const collaborators = members.filter((member) => member.role !== "learner");
  const learnerCount = members.length - collaborators.length;

  const { open, history } = useMemo(() => {
    const sorted = [...localInvitations].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    return {
      open: sorted.filter((invite) => getInviteStatus(invite, now) === "active"),
      history: sorted.filter((invite) => getInviteStatus(invite, now) !== "active"),
    };
  }, [localInvitations, now]);

  const feedbackState = lastAction === "recreate" ? recreateState : lastAction === "revoke" ? revokeState : createState;
  // «Link creato» è già detto dal riquadro del link: si mostrano solo errori e conferme di revoca.
  const feedback =
    feedbackState.message && (!feedbackState.ok || lastAction === "revoke") ? feedbackState.message : null;

  const memberMessage = lastMemberAction === "remove" ? memberRemoveState : lastMemberAction === "role" ? memberRoleState : null;

  return (
    <SettingsSection
      id="persone"
      icon={Users}
      iconClassName="bg-emerald-500/10 text-emerald-400"
      title="Persone"
      description="Invita colleghi a lavorare solo su questo workspace, con il ruolo che scegli tu. Non vedranno gli altri workspace dell'organizzazione."
      aside={
        <Badge variant="secondary" data-testid="collaborator-count">
          {collaborators.length} {collaborators.length === 1 ? "persona" : "persone"} con accesso
        </Badge>
      }
    >
      <div className="grid gap-8 @4xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] @4xl:items-start">
        <div className="space-y-4 @4xl:sticky @4xl:top-32">
          {canManage ? (
            <form
              method="post"
              className="@container rounded-xl border bg-muted/20 p-4"
              data-testid="workspace-invite-create-form"
              onSubmit={(event) => {
                // Invio senza il reset automatico di React: azzererebbe il menu
                // del ruolo nel DOM lasciando lo stato com'era.
                event.preventDefault();
                setLastAction("create");
                const formData = new FormData(event.currentTarget);
                startTransition(() => createFormAction(formData));
              }}
            >
              <div className="mb-4 flex items-center gap-2 text-sm font-medium">
                <Link2 className="h-4 w-4" aria-hidden />
                Invita un collega
              </div>
              <div className="grid gap-4 @lg:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="invite-email">Email del collega (facoltativa)</Label>
                  <Input
                    id="invite-email"
                    name="email"
                    type="email"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    autoComplete="off"
                    placeholder="collega@azienda.it"
                    className="h-10 text-base sm:h-8 sm:text-sm"
                    aria-invalid={!!createState.fieldErrors?.email}
                    aria-describedby="invite-email-hint"
                  />
                  <p id="invite-email-hint" className={`text-xs ${createState.fieldErrors?.email ? "text-red-300" : "text-muted-foreground"}`}>
                    {createState.fieldErrors?.email ?? "Se la indichi, solo chi entra con questa email potrà usare il link."}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="invite-role">Ruolo</Label>
                  <select
                    id="invite-role"
                    name="role"
                    value={inviteRole}
                    onChange={(event) => setInviteRole(event.target.value)}
                    className={SELECT_CLASS}
                  >
                    {INVITABLE_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {ROLE_INFO[role].label} – {ROLE_INFO[role].summary}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="mt-4 rounded-lg bg-background/60 px-3 py-2 text-xs text-muted-foreground" data-testid="single-use-note">
                <span className="font-medium text-foreground">Ogni link vale per una sola persona</span> e scade tra{" "}
                {WORKSPACE_INVITE_EXPIRES_IN_DAYS} giorni. Per più colleghi, crea un link per ciascuno.
              </p>
              <Button type="submit" className="mt-4 h-10 w-full sm:h-8 @lg:w-auto" disabled={createPending}>
                {createPending ? "Creo il link…" : "Crea link"}
              </Button>
              {feedback ? (
                <div
                  className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
                    feedbackState.ok ? "border-green-500/30 bg-green-500/10 text-green-300" : "border-red-500/30 bg-red-500/10 text-red-300"
                  }`}
                  role={feedbackState.ok ? "status" : "alert"}
                >
                  {feedback}
                </div>
              ) : null}
            </form>
          ) : (
            <div className="rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">
              Puoi vedere chi ha accesso. Per invitare qualcuno chiedi a chi amministra il workspace.
            </div>
          )}

          {canManage && latestInvite?.inviteUrl ? (
            <div ref={linkBoxRef}>
              <InviteLinkBox
                key={latestInvite.invitationId}
                invite={latestInvite}
                workspaceName={workspaceName}
                canShare={canShare}
                createAnotherAction={createFormAction}
                creating={createPending}
                onCreateAnother={() => setLastAction("create")}
              />
            </div>
          ) : null}
        </div>

        <div className="min-w-0 space-y-8">
          <section className="@container space-y-3" aria-labelledby="who-has-access">
            <div className="flex items-baseline justify-between gap-3">
              <h3 id="who-has-access" className="text-sm font-semibold">Chi ha accesso</h3>
              <span className="text-xs text-muted-foreground">Dall&apos;organizzazione o su invito</span>
            </div>
            <ul className="divide-y rounded-xl border">
              {collaborators.map((member) => {
                const isManageable = canManage && member.source === "workspace" && member.userId !== currentUserId;
                const knownRole = (INVITABLE_ROLES as readonly string[]).includes(member.role);
                return (
                  <li
                    key={member.userId}
                    className="flex flex-col gap-3 p-3 @xl:flex-row @xl:items-center @xl:justify-between"
                    data-testid="workspace-member-row"
                    data-member-email={member.email}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium" title={member.name ?? member.email}>
                        {member.name ?? member.email}
                        {member.userId === currentUserId && <span className="font-normal text-muted-foreground"> (tu)</span>}
                      </div>
                      <div className="truncate text-xs text-muted-foreground" title={member.email}>{member.email}</div>
                    </div>
                    <div className="flex w-full flex-wrap items-center gap-2 @xl:w-auto">
                      {isManageable ? (
                        <>
                          <form action={memberRoleFormAction} className="min-w-0 flex-1 @xl:flex-none">
                            <input type="hidden" name="userId" value={member.userId} />
                            <select
                              key={`${member.userId}-${member.role}`}
                              name="role"
                              defaultValue={member.role}
                              disabled={memberRolePending}
                              aria-label={`Ruolo di ${member.email}`}
                              data-testid="workspace-member-role-select"
                              className={`${SELECT_CLASS} @xl:w-56`}
                              onChange={(event) => {
                                const nextRole = event.target.value;
                                if (!window.confirm(`Cambiare il ruolo di ${member.email} in «${roleLabel(nextRole)}»? Vale da subito.`)) {
                                  event.target.value = member.role;
                                  return;
                                }
                                setLastMemberAction("role");
                                event.target.form?.requestSubmit();
                              }}
                            >
                              {!knownRole && (
                                <option value={member.role} disabled>
                                  {roleLabel(member.role)}
                                </option>
                              )}
                              {INVITABLE_ROLES.map((role) => (
                                <option key={role} value={role}>
                                  {ROLE_INFO[role].label}
                                </option>
                              ))}
                            </select>
                          </form>
                          <form
                            action={memberRemoveFormAction}
                            onSubmit={(event) => {
                              if (!window.confirm(`Rimuovere ${member.email} dal workspace? Perde subito l'accesso a tutti i dati di questo workspace.`)) {
                                event.preventDefault();
                                return;
                              }
                              setLastMemberAction("remove");
                            }}
                          >
                            <input type="hidden" name="userId" value={member.userId} />
                            <Button
                              type="submit"
                              variant="ghost"
                              className="h-10 text-destructive hover:text-destructive sm:h-8"
                              disabled={memberRemovePending}
                              aria-label={`Rimuovi ${member.email}`}
                              data-testid="workspace-member-remove"
                            >
                              Rimuovi
                            </Button>
                          </form>
                        </>
                      ) : (
                        <Badge variant="outline">{roleLabel(member.role)}</Badge>
                      )}
                      <Badge variant="secondary">{member.source === "organization" ? "Organizzazione" : "Invitato"}</Badge>
                    </div>
                  </li>
                );
              })}
            </ul>
            {memberMessage?.message ? (
              <p className={`text-sm ${memberMessage.ok ? "text-emerald-400" : "text-red-300"}`} role={memberMessage.ok ? "status" : "alert"}>
                {memberMessage.message}
              </p>
            ) : null}
            {learnerCount > 0 && (
              <div className="flex flex-col gap-2 rounded-xl border border-dashed p-3 text-sm sm:flex-row sm:items-center sm:justify-between" data-testid="learner-summary">
                <p className="flex items-start gap-2 text-muted-foreground">
                  <GraduationCap className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>
                    {learnerCount} {learnerCount === 1 ? "partecipante" : "partecipanti"} ai corsi: vedono solo i propri
                    corsi e non contano come collaboratori.
                  </span>
                </p>
                {canManage && (
                  <Link href={`/dashboard/${workspaceId}/learning/admin`} className="shrink-0 text-sm font-medium underline underline-offset-4">
                    Gestisci da Formazione
                  </Link>
                )}
              </div>
            )}
          </section>

          {canManage && (
            <section className="@container space-y-3" aria-labelledby="open-invites">
              <div className="flex items-baseline justify-between gap-3">
                <h3 id="open-invites" className="text-sm font-semibold">Link di invito aperti</h3>
                <span className="text-xs text-muted-foreground">{open.length} in attesa</span>
              </div>
              {open.length === 0 ? (
                <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                  Nessun link aperto. Crea un link quando vuoi invitare un collega.
                </p>
              ) : (
                <ul className="divide-y rounded-xl border">
                  {open.map((invite) => (
                    <InviteRow
                      key={invite.id}
                      invite={invite}
                      status="active"
                      revokeFormAction={revokeFormAction}
                      recreateFormAction={recreateFormAction}
                      revokePending={revokePending}
                      recreatePending={recreatePending}
                      onRevoke={() => setLastAction("revoke")}
                      onRecreate={() => setLastAction("recreate")}
                    />
                  ))}
                </ul>
              )}
              {history.length > 0 && (
                <details className="group rounded-xl border" data-testid="invite-history">
                  <summary className="flex cursor-pointer items-center justify-between gap-3 p-3 text-sm">
                    <span className="font-medium">Storico dei link</span>
                    <span className="text-xs text-muted-foreground">{history.length}</span>
                  </summary>
                  <ul className="divide-y border-t">
                    {history.map((invite) => (
                      <InviteRow
                        key={invite.id}
                        invite={invite}
                        status={getInviteStatus(invite, now)}
                        revokeFormAction={revokeFormAction}
                        recreateFormAction={recreateFormAction}
                        revokePending={revokePending}
                        recreatePending={recreatePending}
                        onRevoke={() => setLastAction("revoke")}
                        onRecreate={() => setLastAction("recreate")}
                      />
                    ))}
                  </ul>
                </details>
              )}
            </section>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}

function InviteRow({
  invite,
  status,
  revokeFormAction,
  recreateFormAction,
  revokePending,
  recreatePending,
  onRevoke,
  onRecreate,
}: {
  invite: Invitation;
  status: InviteStatus;
  revokeFormAction: (formData: FormData) => void;
  recreateFormAction: (formData: FormData) => void;
  revokePending: boolean;
  recreatePending: boolean;
  onRevoke: () => void;
  onRecreate: () => void;
}) {
  const detail =
    status === "used"
      ? `Usato${invite.acceptedByEmail ? ` da ${invite.acceptedByEmail}` : ""}`
      : status === "revoked"
        ? "Non funziona più"
        : status === "expired"
          ? `Scaduto il ${formatDate(invite.expiresAt)}`
          : `Scade il ${formatDate(invite.expiresAt)}`;
  return (
    <li
      className="flex flex-col gap-3 p-3 @xl:flex-row @xl:items-center @xl:justify-between"
      data-invite-email={invite.email ?? ""}
      data-invite-status={status}
      data-testid="workspace-invite-row"
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium" title={invite.email ?? undefined}>
            {invite.email ?? "Link senza email"}
          </span>
          <Badge variant={status === "active" ? "secondary" : "outline"} className="shrink-0">
            {statusLabels[status]}
          </Badge>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {roleLabel(invite.role)} · {detail}
          {invite.createdByName ? ` · creato da ${invite.createdByName}` : ""}
        </div>
      </div>
      {status === "active" || status === "expired" ? (
        <div className="flex flex-wrap gap-2">
          {status === "active" && (
            <form
              action={revokeFormAction}
              onSubmit={(event) => {
                if (!window.confirm(`Disattivare il link ${invite.email ? `per ${invite.email}` : "senza email"}? Chi lo apre non potrà più entrare.`)) {
                  event.preventDefault();
                  return;
                }
                onRevoke();
              }}
            >
              <input type="hidden" name="invitationId" value={invite.id} />
              <Button
                type="submit"
                variant="outline"
                className="h-10 sm:h-8"
                disabled={revokePending}
                aria-label={`Disattiva il link ${invite.email ? `per ${invite.email}` : "senza email"}`}
                data-testid="workspace-invite-revoke"
              >
                Disattiva
              </Button>
            </form>
          )}
          <form
            action={recreateFormAction}
            onSubmit={(event) => {
              if (!window.confirm("Creare un nuovo link per questo invito? Quello vecchio smetterà di funzionare.")) {
                event.preventDefault();
                return;
              }
              onRecreate();
            }}
          >
            <input type="hidden" name="invitationId" value={invite.id} />
            <Button
              type="submit"
              variant="outline"
              className="h-10 sm:h-8"
              disabled={recreatePending}
              aria-label={`Nuovo link ${invite.email ? `per ${invite.email}` : "senza email"}`}
              data-testid="workspace-invite-recreate"
            >
              <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden />
              Nuovo link
            </Button>
          </form>
        </div>
      ) : null}
    </li>
  );
}

function InviteLinkBox({
  invite,
  workspaceName,
  canShare,
  createAnotherAction,
  creating,
  onCreateAnother,
}: {
  invite: CreateWorkspaceInviteData;
  workspaceName: string;
  canShare: boolean;
  createAnotherAction: (formData: FormData) => void;
  creating: boolean;
  onCreateAnother: () => void;
}) {
  const [copyState, setCopyState] = useState<"idle" | "link" | "message" | "manual">("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  async function copy(text: string, kind: "link" | "message") {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState(kind);
      window.setTimeout(() => setCopyState((current) => (current === kind ? "idle" : current)), 2500);
    } catch {
      setCopyState("manual");
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }

  async function share() {
    try {
      await navigator.share({ title: `Invito a ${workspaceName}`, text: inviteMessage(workspaceName, invite) });
    } catch {
      // annullato dall'utente: nessun messaggio
    }
  }

  return (
    <div className="@container rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4" data-testid="invite-link-ready">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">Link pronto per {invite.email ?? "una persona"}</p>
        <span className="text-xs text-muted-foreground">
          {roleLabel(invite.role)} · scade il {formatDate(invite.expiresAt)}
        </span>
      </div>
      <div className="mt-3 flex flex-col gap-2 @sm:flex-row">
        <Input
          ref={inputRef}
          readOnly
          value={invite.inviteUrl}
          aria-label="Link di invito"
          className="h-10 min-w-0 flex-1 font-mono text-xs sm:h-8"
          onFocus={(event) => event.currentTarget.select()}
          data-testid="invite-link-input"
        />
        <Button type="button" variant="outline" className="h-10 sm:h-8" onClick={() => copy(invite.inviteUrl, "link")}>
          <Copy className="mr-1 h-3.5 w-3.5" aria-hidden />
          {copyState === "link" ? "Copiato" : "Copia link"}
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" variant="ghost" className="h-10 px-2 text-xs sm:h-8" onClick={() => copy(inviteMessage(workspaceName, invite), "message")}>
          <MessageSquareText className="mr-1 h-3.5 w-3.5" aria-hidden />
          {copyState === "message" ? "Messaggio copiato" : "Copia un messaggio pronto"}
        </Button>
        {canShare && (
          <Button type="button" variant="ghost" className="h-10 px-2 text-xs sm:h-8" onClick={share}>
            <Share2 className="mr-1 h-3.5 w-3.5" aria-hidden />
            Condividi
          </Button>
        )}
        <form action={createAnotherAction} onSubmit={onCreateAnother}>
          <input type="hidden" name="email" value="" />
          <input type="hidden" name="role" value={invite.role} />
          <Button type="submit" variant="ghost" className="h-10 px-2 text-xs sm:h-8" disabled={creating} data-testid="invite-create-another">
            <Link2 className="mr-1 h-3.5 w-3.5" aria-hidden />
            Crea un altro link ({roleLabel(invite.role)})
          </Button>
        </form>
      </div>
      <p className="mt-2 text-xs text-muted-foreground" role="status" aria-live="polite">
        {copyState === "manual"
          ? "Copia automatica non disponibile: il link è selezionato, copialo con Cmd/Ctrl+C."
          : "Per sicurezza il link si vede solo adesso: copialo e mandalo in privato (mail o chat). Unbundle non invia email."}
      </p>
    </div>
  );
}
