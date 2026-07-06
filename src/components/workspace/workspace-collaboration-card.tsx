"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Users, Link2, Copy, ShieldCheck, RotateCcw } from "lucide-react";

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
};

type InviteStatus = "active" | "expired" | "used" | "revoked";

const INITIAL_CREATE: WorkspaceCollaborationActionState<CreateWorkspaceInviteData> =
  { ok: true };
const INITIAL_MUTATION: WorkspaceCollaborationActionState<WorkspaceInvitationMutationData> =
  { ok: true };
const INITIAL_MEMBER: WorkspaceCollaborationActionState<WorkspaceMemberMutationData> =
  { ok: true };

const MEMBER_ROLE_OPTIONS = [
  { value: "analyst", label: "Analyst" },
  { value: "contributor", label: "Contributor" },
  { value: "function_lead", label: "Function Lead" },
  { value: "transformation_lead", label: "Transformation Lead" },
] as const;

const roleLabels: Record<string, string> = {
  exec_sponsor: "Executive Sponsor",
  transformation_lead: "Transformation Lead",
  function_lead: "Function Lead",
  contributor: "Contributor",
  analyst: "Analyst",
};

const statusLabels: Record<InviteStatus, string> = {
  active: "In attesa",
  expired: "Scaduto",
  used: "Accettato",
  revoked: "Revocato",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function getInviteStatus(invite: Invitation): InviteStatus {
  if (invite.revokedAt) return "revoked";
  if (new Date(invite.expiresAt).getTime() <= Date.now()) return "expired";
  if (invite.usedCount >= invite.maxUses) return "used";
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
  };
}

function upsertInvitation(
  previous: Invitation[],
  data: CreateWorkspaceInviteData
) {
  const now = new Date().toISOString();
  const replacement = invitationFromAction(data);
  const updated = previous
    .filter((invite) => invite.id !== replacement.id)
    .map((invite) =>
      invite.id === data.replacedInvitationId
        ? { ...invite, revokedAt: invite.revokedAt ?? now }
        : invite
    );
  return [replacement, ...updated];
}

export function WorkspaceCollaborationCard({
  workspaceId,
  members,
  invitations,
  canManage,
  currentUserId,
}: {
  workspaceId: string;
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

  const [createState, createFormAction, createPending] = useActionState(
    createAction,
    INITIAL_CREATE
  );
  const [recreateState, recreateFormAction, recreatePending] = useActionState(
    recreateAction,
    INITIAL_CREATE
  );
  const [revokeState, revokeFormAction, revokePending] = useActionState(
    revokeAction,
    INITIAL_MUTATION
  );
  const [memberRoleState, memberRoleFormAction, memberRolePending] =
    useActionState(memberRoleAction, INITIAL_MEMBER);
  const [memberRemoveState, memberRemoveFormAction, memberRemovePending] =
    useActionState(memberRemoveAction, INITIAL_MEMBER);

  const [copied, setCopied] = useState(false);
  const [lastAction, setLastAction] = useState<
    "create" | "recreate" | "revoke" | null
  >(null);
  const [lastMemberAction, setLastMemberAction] = useState<
    "role" | "remove" | null
  >(null);
  const [latestInvite, setLatestInvite] =
    useState<CreateWorkspaceInviteData | null>(null);
  const [localInvitations, setLocalInvitations] = useState(invitations);

  useEffect(() => {
    setLocalInvitations(invitations);
  }, [invitations]);

  useEffect(() => {
    if (!createState.ok || !createState.data) return;
    setLatestInvite(createState.data);
    setCopied(false);
    setLocalInvitations((prev) => upsertInvitation(prev, createState.data!));
  }, [createState.data, createState.ok]);

  useEffect(() => {
    if (!recreateState.ok || !recreateState.data) return;
    setLatestInvite(recreateState.data);
    setCopied(false);
    setLocalInvitations((prev) => upsertInvitation(prev, recreateState.data!));
  }, [recreateState.data, recreateState.ok]);

  useEffect(() => {
    if (!revokeState.ok || !revokeState.data) return;
    setLocalInvitations((prev) =>
      prev.map((invite) =>
        invite.id === revokeState.data?.invitationId
          ? { ...invite, revokedAt: revokeState.data.revokedAt }
          : invite
      )
    );
    setLatestInvite((current) =>
      current?.invitationId === revokeState.data?.invitationId ? null : current
    );
  }, [revokeState.data, revokeState.ok]);

  const sortedInvitations = useMemo(
    () =>
      [...localInvitations].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    [localInvitations]
  );
  const pendingInvites = sortedInvitations.filter(
    (invite) => getInviteStatus(invite) === "active"
  ).length;
  const feedbackState =
    lastAction === "recreate"
      ? recreateState
      : lastAction === "revoke"
        ? revokeState
        : createState;
  const feedback = feedbackState.message ?? null;
  const feedbackOk = feedbackState.ok;

  async function copyInviteLink() {
    if (!latestInvite?.inviteUrl) return;
    await navigator.clipboard.writeText(latestInvite.inviteUrl);
    setCopied(true);
  }

  return (
    <div className="rounded-xl border bg-card text-card-foreground">
      <div className="border-b p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
              <Users className="h-5 w-5 text-emerald-500" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Collaboratori</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Condividi solo questo workspace con colleghi e reviewer.
                Vedranno lo stesso spazio per segnalare e rankizzare gli use
                case, senza accedere agli altri workspace dell&apos;organizzazione.
              </p>
            </div>
          </div>
          <Badge variant="secondary" className="shrink-0">
            {members.length} seat
          </Badge>
        </div>
      </div>

      <div className="space-y-6 p-6">
        {canManage ? (
          <form
            action={createFormAction}
            className="rounded-2xl border bg-muted/20 p-4"
            data-testid="workspace-invite-create-form"
            onSubmit={() => setLastAction("create")}
          >
            <div className="mb-4 flex items-center gap-2 text-sm font-medium">
              <Link2 className="h-4 w-4" />
              Crea link di invito
            </div>
            <div className="grid gap-3 md:grid-cols-[1.2fr_0.9fr]">
              <div className="space-y-1.5">
                <Label htmlFor="invite-email">Email opzionale</Label>
                <Input
                  id="invite-email"
                  name="email"
                  type="email"
                  placeholder="collega@azienda.com"
                  aria-invalid={!!createState.fieldErrors?.email}
                />
                {createState.fieldErrors?.email ? (
                  <p className="text-xs text-red-500">
                    {createState.fieldErrors.email}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Se inserisci un&apos;email, solo quell&apos;account potrà
                    accettare l&apos;invito.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invite-role">Ruolo</Label>
                <select
                  id="invite-role"
                  name="role"
                  defaultValue="analyst"
                  className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
                >
                  <option value="analyst">Analyst - segnala e rankizza</option>
                  <option value="contributor">Contributor - solo raccolta</option>
                  <option value="function_lead">
                    Function Lead - ranking e wave
                  </option>
                  <option value="transformation_lead">
                    Transformation Lead - gestione completa
                  </option>
                </select>
                <p className="text-xs text-muted-foreground">
                  Il link resta valido per {WORKSPACE_INVITE_EXPIRES_IN_DAYS}
                  {" "}giorni.
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5" />
                Il token non viene salvato in chiaro: il link resta visibile qui
                solo appena creato o rigenerato.
              </p>
              <Button type="submit" disabled={createPending}>
                {createPending ? "Creo..." : "Crea link"}
              </Button>
            </div>
            {feedback ? (
              <div
                className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
                  feedbackOk
                    ? "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300"
                    : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
                }`}
                role="status"
              >
                {feedback}
              </div>
            ) : null}
            {latestInvite?.inviteUrl ? (
              <div className="mt-3 rounded-xl border bg-background p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label className="text-xs text-muted-foreground">
                    Link pronto
                  </Label>
                  <span className="text-xs text-muted-foreground">
                    Valido fino al {formatDate(latestInvite.expiresAt)}
                  </span>
                </div>
                <div className="mt-2 flex gap-2">
                  <Input readOnly value={latestInvite.inviteUrl} />
                  <Button type="button" variant="outline" onClick={copyInviteLink}>
                    <Copy className="mr-1 h-3.5 w-3.5" />
                    {copied ? "Copiato" : "Copia"}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Unbundle non invia email automaticamente: copia il link e
                  condividilo nel canale corretto.
                </p>
              </div>
            ) : null}
          </form>
        ) : (
          <div className="rounded-2xl border bg-muted/20 p-4 text-sm text-muted-foreground">
            Puoi vedere i collaboratori, ma solo Executive Sponsor e
            Transformation Lead possono creare o revocare link di invito.
          </div>
        )}

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Membri attivi</h3>
            <span className="text-xs text-muted-foreground">
              Org + workspace share
            </span>
          </div>
          <div className="divide-y rounded-2xl border">
            {members.map((member) => {
              const isManageable =
                canManage &&
                member.source === "workspace" &&
                member.userId !== currentUserId;
              return (
                <div
                  key={member.userId}
                  className="flex flex-wrap items-center justify-between gap-3 p-3"
                  data-testid="workspace-member-row"
                  data-member-email={member.email}
                >
                  <div>
                    <div className="text-sm font-medium">
                      {member.name ?? member.email}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {member.email}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isManageable ? (
                      <>
                        <form action={memberRoleFormAction}>
                          <input
                            type="hidden"
                            name="userId"
                            value={member.userId}
                          />
                          <select
                            // Rimonta il select quando il ruolo cambia lato server:
                            // React 19 resetta i form dopo le action e defaultValue
                            // da solo non riallinea il valore mostrato.
                            key={`${member.userId}-${member.role}`}
                            name="role"
                            defaultValue={member.role}
                            disabled={memberRolePending}
                            aria-label={`Ruolo di ${member.email}`}
                            data-testid="workspace-member-role-select"
                            className="h-8 rounded-lg border border-input bg-background px-2 text-xs"
                            onChange={(event) => {
                              const nextRole = event.target.value;
                              if (
                                !window.confirm(
                                  `Cambiare il ruolo di ${member.email} in "${
                                    roleLabels[nextRole] ?? nextRole
                                  }"? La modifica vale da subito per tutto il workspace.`
                                )
                              ) {
                                event.target.value = member.role;
                                return;
                              }
                              setLastMemberAction("role");
                              event.target.form?.requestSubmit();
                            }}
                          >
                            {MEMBER_ROLE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </form>
                        <form
                          action={memberRemoveFormAction}
                          onSubmit={(event) => {
                            if (
                              !window.confirm(
                                `Rimuovere ${member.email} dal workspace? Perderà subito l'accesso a tutti i dati di questo workspace.`
                              )
                            ) {
                              event.preventDefault();
                              return;
                            }
                            setLastMemberAction("remove");
                          }}
                        >
                          <input
                            type="hidden"
                            name="userId"
                            value={member.userId}
                          />
                          <Button
                            type="submit"
                            variant="ghost"
                            size="sm"
                            disabled={memberRemovePending}
                            data-testid="workspace-member-remove"
                            className="text-destructive hover:text-destructive"
                          >
                            Rimuovi
                          </Button>
                        </form>
                      </>
                    ) : (
                      <Badge variant="outline">
                        {roleLabels[member.role] ?? member.role}
                      </Badge>
                    )}
                    <Badge variant="secondary">
                      {member.source === "organization"
                        ? "Organizzazione"
                        : "Workspace"}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
          {lastMemberAction && (
            (lastMemberAction === "remove"
              ? memberRemoveState.message
              : memberRoleState.message) ? (
              <p
                className={`text-sm ${
                  (lastMemberAction === "remove"
                    ? memberRemoveState.ok
                    : memberRoleState.ok)
                    ? "text-emerald-600"
                    : "text-destructive"
                }`}
                role="status"
              >
                {lastMemberAction === "remove"
                  ? memberRemoveState.message
                  : memberRoleState.message}
              </p>
            ) : null
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Inviti inviati</h3>
            <span className="text-xs text-muted-foreground">
              {pendingInvites} in attesa
            </span>
          </div>
          {sortedInvitations.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
              Nessun invito creato. Crea un link quando vuoi invitare un
              collega.
            </div>
          ) : (
            <div className="divide-y rounded-2xl border">
              {sortedInvitations.map((invite) => {
                const status = getInviteStatus(invite);
                const isActive = status === "active";
                return (
                  <div
                    key={invite.id}
                    className="flex flex-wrap items-center justify-between gap-3 p-3"
                    data-invite-email={invite.email ?? ""}
                    data-testid="workspace-invite-row"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-sm font-medium">
                          {invite.email ?? "Link non vincolato a email"}
                        </div>
                        <Badge
                          variant={isActive ? "secondary" : "outline"}
                          className="shrink-0"
                        >
                          {statusLabels[status]}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {roleLabels[invite.role] ?? invite.role} · creato il{" "}
                        {formatDate(invite.createdAt)} · scade il{" "}
                        {formatDate(invite.expiresAt)}
                      </div>
                    </div>
                    {canManage ? (
                      <div className="flex flex-wrap gap-2">
                        {isActive ? (
                          <form
                            action={revokeFormAction}
                            onSubmit={(event) => {
                              if (
                                !window.confirm(
                                  "Revocare questo invito? Il link non potrà più essere usato."
                                )
                              ) {
                                event.preventDefault();
                                return;
                              }
                              setLastAction("revoke");
                            }}
                          >
                            <input
                              type="hidden"
                              name="invitationId"
                              value={invite.id}
                            />
                            <Button
                              type="submit"
                              variant="destructive"
                              size="sm"
                              disabled={revokePending}
                              data-testid="workspace-invite-revoke"
                            >
                              Revoca
                            </Button>
                          </form>
                        ) : null}
                        <form
                          action={recreateFormAction}
                          onSubmit={(event) => {
                            if (
                              !window.confirm(
                                "Creare un nuovo link per questo invito? Il link precedente verrà revocato."
                              )
                            ) {
                              event.preventDefault();
                              return;
                            }
                            setLastAction("recreate");
                          }}
                        >
                          <input
                            type="hidden"
                            name="invitationId"
                            value={invite.id}
                          />
                          <Button
                            type="submit"
                            variant="outline"
                            size="sm"
                            disabled={recreatePending}
                            data-testid="workspace-invite-recreate"
                          >
                            <RotateCcw className="mr-1 h-3.5 w-3.5" />
                            Ricrea link
                          </Button>
                        </form>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
