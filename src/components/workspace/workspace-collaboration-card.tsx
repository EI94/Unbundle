"use client";

import Link from "next/link";
import { startTransition, useActionState, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Copy, GraduationCap, Link2, MessageSquareText, RotateCcw, Share2, UserPlus } from "lucide-react";
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
import { CONFIRM_TEXT } from "@/lib/confirm-text";
import { WORKSPACE_INVITE_EXPIRES_IN_DAYS } from "@/lib/workspace-invite-config";
import { INVITABLE_ROLES, ROLE_INFO, roleLabel } from "@/lib/workspace-roles";
import { Fold } from "@/components/ui-10/fold";
import { SideSheet, useSheetParam } from "@/components/ui-10/side-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, useSubmitConfirmation } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SETTINGS_TEXT } from "./settings-text";

const ASK = CONFIRM_TEXT.people;
const T = SETTINGS_TEXT.team;

/**
 * Impostazioni › Team (rilascio 10, ondata 6b, docs/ui-10/PROPOSTA-10.md §3.10; prima la sezione «Persone»): chi ha
 * accesso, con «(tu)» e il ruolo; a chi gestisce il workspace il ruolo da cambiare e «Rimuovi», con la conferma
 * dell'app; «Invita», bordato, apre il pannello dell'invito (`?apri=invita`: e-mail, ruolo, il link da copiare o
 * condividere); gli inviti aperti e quelli passati in due pieghe chiuse; i partecipanti ai corsi.
 *
 * Due cose da non far sbagliare a chi la usa: ogni link vale per UNA persona (WORKSPACE_INVITE_MAX_USES = 1), e i
 * partecipanti ai corsi non sono collaboratori (si gestiscono da Formazione, non da qui).
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

/** Il pannello dell'invito (`?apri=invita`). */
export const INVITE_PANEL = "invita";
const acceptInvitePanel = (raw: string | null) => (raw === INVITE_PANEL ? INVITE_PANEL : null);

const SELECT_CLASS = "h-11 w-full rounded-lg border border-input bg-background px-2 text-base sm:h-8 sm:text-sm";

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
    () => false,
  );
}

function inviteMessage(workspaceName: string, invite: CreateWorkspaceInviteData) {
  return `${T.message(workspaceName, roleLabel(invite.role), formatDate(invite.expiresAt), !invite.email)}${invite.inviteUrl}`;
}

export function TeamTab({
  workspaceId,
  workspaceName,
  members,
  invitations,
  canManage,
  currentUserId,
  initialPanel = null,
}: {
  workspaceId: string;
  workspaceName: string;
  members: Member[];
  invitations: Invitation[];
  canManage: boolean;
  currentUserId?: string;
  /** `?apri=` letto sul server: `invita` apre il pannello dell'invito. */
  initialPanel?: string | null;
}) {
  const createAction = createWorkspaceInvitationAction.bind(null, workspaceId);
  const recreateAction = recreateWorkspaceInvitationAction.bind(null, workspaceId);
  const revokeAction = revokeWorkspaceInvitationAction.bind(null, workspaceId);
  const memberRoleAction = updateWorkspaceMemberRoleAction.bind(null, workspaceId);
  const memberRemoveAction = removeWorkspaceMemberAction.bind(null, workspaceId);
  const [panel, setPanel] = useSheetParam<string>({ initial: canManage ? initialPanel : null, accept: acceptInvitePanel });

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
    INITIAL_CREATE,
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
    INITIAL_CREATE,
  );
  const [revokeState, revokeFormAction, revokePending] = useActionState(revokeAction, INITIAL_MUTATION);
  const [memberRoleState, memberRoleFormAction, memberRolePending] = useActionState(memberRoleAction, INITIAL_MEMBER);
  const [memberRemoveState, memberRemoveFormAction, memberRemovePending] = useActionState(memberRemoveAction, INITIAL_MEMBER);

  const [lastAction, setLastAction] = useState<"create" | "recreate" | "revoke" | null>(null);
  const [lastMemberAction, setLastMemberAction] = useState<"role" | "remove" | null>(null);
  // Il ruolo scelto nel menu aspetta la conferma; il menu intanto resta sul ruolo di oggi.
  const [roleChange, setRoleChange] = useState<{ email: string; role: string } | null>(null);
  const roleSelect = useRef<HTMLSelectElement | null>(null);
  const removal = useSubmitConfirmation<Member>();
  const [now] = useState(() => Date.now());
  const canShare = useCanShare();
  const linkBoxRef = useRef<HTMLDivElement>(null);

  const revokedId = revokeState.ok ? (revokeState.data?.invitationId ?? null) : null;
  const localInvitations = useMemo(() => {
    const extra = createdLinks.filter((data) => !invitations.some((invite) => invite.id === data.invitationId)).map(invitationFromAction);
    const replaced = new Set([...createdLinks.map((data) => data.replacedInvitationId), revokedId].filter(Boolean));
    return [...extra, ...invitations].map((invite) => (replaced.has(invite.id) && !invite.revokedAt ? { ...invite, revokedAt: new Date(now).toISOString() } : invite));
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
    // «Nuovo link» di un invito aperto: il link nuovo si vede nel pannello dell'invito.
    setPanel(INVITE_PANEL);
  }, [lastAction, recreateState.ok, recreateState.data, setPanel]);
  useEffect(() => {
    if (!latestInvite) return;
    linkBoxRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [latestInvite]);

  const collaborators = members.filter((member) => member.role !== "learner");
  const learnerCount = members.length - collaborators.length;

  const { open, history } = useMemo(() => {
    const sorted = [...localInvitations].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return {
      open: sorted.filter((invite) => getInviteStatus(invite, now) === "active"),
      history: sorted.filter((invite) => getInviteStatus(invite, now) !== "active"),
    };
  }, [localInvitations, now]);

  const feedbackState = lastAction === "recreate" ? recreateState : lastAction === "revoke" ? revokeState : createState;
  // «Link creato» è già detto dal riquadro del link: si mostrano solo errori e conferme di revoca.
  const feedback = feedbackState.message && (!feedbackState.ok || lastAction === "revoke") ? feedbackState.message : null;
  const memberMessage = lastMemberAction === "remove" ? memberRemoveState : lastMemberAction === "role" ? memberRoleState : null;

  const rowProps = { revokeFormAction, recreateFormAction, revokePending, recreatePending, onRevoke: () => setLastAction("revoke"), onRecreate: () => setLastAction("recreate") };

  return (
    <div id="persone" className="scroll-mt-28 space-y-8" data-slot="settings-team">
      <section className="space-y-3" aria-labelledby="who-has-access">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="who-has-access" className="text-base font-semibold" data-testid="collaborator-count">
            {T.who(collaborators.length)}
          </h2>
          {canManage ? (
            <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" aria-haspopup="dialog" onClick={() => setPanel(INVITE_PANEL)} data-testid="workspace-invite-open">
              <UserPlus aria-hidden />
              {T.invite}
            </Button>
          ) : null}
        </div>
        <ul className="divide-y rounded-xl border">
          {collaborators.map((member) => {
            const isManageable = canManage && member.source === "workspace" && member.userId !== currentUserId;
            const knownRole = (INVITABLE_ROLES as readonly string[]).includes(member.role);
            return (
              <li key={member.userId} className="flex min-h-11 flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between" data-testid="workspace-member-row" data-member-email={member.email}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium" title={member.name ?? member.email}>
                    {member.name ?? member.email}
                    {member.userId === currentUserId && <span className="font-normal text-muted-foreground"> {T.you}</span>}
                  </div>
                  <div className="truncate text-xs text-muted-foreground" title={member.email}>
                    {member.email} · {member.source === "organization" ? T.fromOrganization : T.invited}
                  </div>
                </div>
                <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                  {isManageable ? (
                    <>
                      <form action={memberRoleFormAction} className="min-w-0 flex-1 sm:flex-none">
                        <input type="hidden" name="userId" value={member.userId} />
                        <select
                          key={`${member.userId}-${member.role}`}
                          name="role"
                          defaultValue={member.role}
                          disabled={memberRolePending}
                          aria-label={T.roleOf(member.email)}
                          data-testid="workspace-member-role-select"
                          className={`${SELECT_CLASS} sm:w-56`}
                          onChange={(event) => {
                            const nextRole = event.target.value;
                            event.target.value = member.role;
                            roleSelect.current = event.target;
                            setRoleChange({ email: member.email, role: nextRole });
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
                          if (!removal.ask(event, member)) return;
                          setLastMemberAction("remove");
                        }}
                      >
                        <input type="hidden" name="userId" value={member.userId} />
                        <Button type="submit" variant="ghost" className="h-11 sm:h-8" disabled={memberRemovePending} aria-label={T.removeOf(member.email)} data-testid="workspace-member-remove">
                          {T.remove}
                        </Button>
                      </form>
                    </>
                  ) : (
                    <Badge variant="outline">{roleLabel(member.role)}</Badge>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {roleChange ? (
          <ConfirmDialog
            open
            onOpenChange={(isOpen) => {
              if (!isOpen) setRoleChange(null);
            }}
            title={ASK.roleTitle(roleChange.email, roleLabel(roleChange.role))}
            description={ASK.roleBody}
            confirmLabel={ASK.roleConfirm}
            onConfirm={() => {
              const select = roleSelect.current;
              setRoleChange(null);
              if (!select) return;
              select.value = roleChange.role;
              setLastMemberAction("role");
              select.form?.requestSubmit();
            }}
          />
        ) : null}
        {removal.target ? (
          <ConfirmDialog open onOpenChange={removal.onOpenChange} title={ASK.removeTitle(removal.target.email)} description={ASK.removeBody} confirmLabel={ASK.removeConfirm} destructive onConfirm={removal.confirm} />
        ) : null}
        {memberMessage?.message ? (
          <p className={`text-sm ${memberMessage.ok ? "text-uc-verde" : "text-destructive"}`} role={memberMessage.ok ? "status" : "alert"}>
            {memberMessage.message}
          </p>
        ) : null}
        {learnerCount > 0 ? (
          <div className="flex flex-col gap-2 rounded-xl border border-dashed p-3 text-sm sm:flex-row sm:items-center sm:justify-between" data-testid="learner-summary">
            <p className="flex items-start gap-2 text-muted-foreground">
              <GraduationCap className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{T.learners(learnerCount)}</span>
            </p>
            {canManage ? (
              <Link href={`/dashboard/${workspaceId}/learning/admin`} className="inline-flex min-h-11 shrink-0 items-center text-sm font-medium underline underline-offset-4 sm:min-h-0">
                {T.learnersLink}
              </Link>
            ) : null}
          </div>
        ) : null}
      </section>

      {canManage && (open.length > 0 || history.length > 0 || feedback) ? (
        <div>
          {feedback ? (
            <p className={`mb-3 text-sm ${feedbackState.ok ? "text-uc-verde" : "text-destructive"}`} role={feedbackState.ok ? "status" : "alert"}>
              {feedback}
            </p>
          ) : null}
          {open.length > 0 ? (
            <Fold id="inviti" title={T.invites(open.length)}>
              <ul className="divide-y rounded-xl border">
                {open.map((invite) => (
                  <InviteRow key={invite.id} invite={invite} status="active" {...rowProps} />
                ))}
              </ul>
            </Fold>
          ) : null}
          {history.length > 0 ? (
            <Fold id="inviti-passati" title={T.history(history.length)}>
              <ul className="divide-y rounded-xl border" data-testid="invite-history">
                {history.map((invite) => (
                  <InviteRow key={invite.id} invite={invite} status={getInviteStatus(invite, now)} {...rowProps} />
                ))}
              </ul>
            </Fold>
          ) : null}
        </div>
      ) : null}

      {canManage ? (
        <SideSheet
          open={panel === INVITE_PANEL}
          onClose={() => setPanel(null)}
          title={T.inviteTitle}
          footer={
            <Button type="submit" form="workspace-invite-create-form" className="min-h-11 sm:min-h-9" disabled={createPending}>
              <Link2 aria-hidden />
              {createPending ? T.creating : T.create}
            </Button>
          }
        >
          <form
            id="workspace-invite-create-form"
            method="post"
            className="space-y-4"
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
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">{T.email}</Label>
              <Input
                id="invite-email"
                name="email"
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                autoComplete="off"
                placeholder="collega@azienda.it"
                className="h-11 text-base sm:h-9 sm:text-sm"
                aria-invalid={!!createState.fieldErrors?.email}
                aria-describedby="invite-email-hint"
              />
              <p id="invite-email-hint" className={`text-xs ${createState.fieldErrors?.email ? "text-destructive" : "text-muted-foreground"}`}>
                {createState.fieldErrors?.email ?? T.emailHint}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-role">{T.role}</Label>
              <select id="invite-role" name="role" value={inviteRole} onChange={(event) => setInviteRole(event.target.value)} className={SELECT_CLASS} aria-describedby="invite-role-hint">
                {INVITABLE_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_INFO[role].label}
                  </option>
                ))}
              </select>
              <p id="invite-role-hint" className="text-xs text-muted-foreground">
                {ROLE_INFO[inviteRole as (typeof INVITABLE_ROLES)[number]]?.summary ?? ""}
              </p>
            </div>
            <p className="text-xs text-muted-foreground" data-testid="single-use-note">
              {T.oneLink(WORKSPACE_INVITE_EXPIRES_IN_DAYS)}
            </p>
            {lastAction === "create" && !createState.ok && createState.message && !createState.fieldErrors?.email ? (
              <p className="text-sm text-destructive" role="alert">
                {createState.message}
              </p>
            ) : null}
          </form>
          {latestInvite?.inviteUrl ? (
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
        </SideSheet>
      ) : null}
    </div>
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
    status === "used" ? T.usedBy(invite.acceptedByEmail) : status === "revoked" ? T.stopped : status === "expired" ? T.expiredOn(formatDate(invite.expiresAt)) : T.expiresOn(formatDate(invite.expiresAt));
  const revoking = useSubmitConfirmation();
  const recreating = useSubmitConfirmation();
  return (
    <li className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between" data-invite-email={invite.email ?? ""} data-invite-status={status} data-testid="workspace-invite-row">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium" title={invite.email ?? undefined}>
            {invite.email ?? T.noEmail}
          </span>
          <Badge variant={status === "active" ? "secondary" : "outline"} className="shrink-0">
            {T.status[status]}
          </Badge>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {roleLabel(invite.role)} · {detail}
          {invite.createdByName ? ` · ${T.createdBy(invite.createdByName)}` : ""}
        </div>
      </div>
      {status === "active" || status === "expired" ? (
        <div className="flex flex-wrap gap-2">
          {status === "active" && (
            <form
              action={revokeFormAction}
              onSubmit={(event) => {
                if (!revoking.ask(event, true)) return;
                onRevoke();
              }}
            >
              <input type="hidden" name="invitationId" value={invite.id} />
              <Button type="submit" variant="outline" className="h-11 sm:h-8" disabled={revokePending} aria-label={T.revokeOf(invite.email)} data-testid="workspace-invite-revoke">
                {T.revoke}
              </Button>
            </form>
          )}
          <form
            action={recreateFormAction}
            onSubmit={(event) => {
              if (!recreating.ask(event, true)) return;
              onRecreate();
            }}
          >
            <input type="hidden" name="invitationId" value={invite.id} />
            <Button type="submit" variant="outline" className="h-11 sm:h-8" disabled={recreatePending} aria-label={T.recreateOf(invite.email)} data-testid="workspace-invite-recreate">
              <RotateCcw aria-hidden />
              {T.recreate}
            </Button>
          </form>
          <ConfirmDialog
            open={revoking.open}
            onOpenChange={revoking.onOpenChange}
            title={ASK.revokeLinkTitle(invite.email)}
            description={ASK.revokeLinkBody}
            confirmLabel={ASK.revokeLinkConfirm}
            destructive
            onConfirm={revoking.confirm}
          />
          <ConfirmDialog
            open={recreating.open}
            onOpenChange={recreating.onOpenChange}
            title={ASK.recreateLinkTitle}
            description={ASK.recreateLinkBody}
            confirmLabel={ASK.recreateLinkConfirm}
            onConfirm={recreating.confirm}
          />
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
      // annullato da chi guarda: nessun messaggio
    }
  }

  return (
    <div className="space-y-3 rounded-xl border p-4" data-testid="invite-link-ready">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{T.ready(invite.email)}</p>
        <p className="text-xs text-muted-foreground">{T.readyFact(roleLabel(invite.role), formatDate(invite.expiresAt))}</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          ref={inputRef}
          readOnly
          value={invite.inviteUrl}
          aria-label={T.linkLabel}
          className="h-11 min-w-0 flex-1 font-mono text-base sm:h-9 sm:text-xs"
          onFocus={(event) => event.currentTarget.select()}
          data-testid="invite-link-input"
        />
        <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={() => copy(invite.inviteUrl, "link")}>
          <Copy aria-hidden />
          {copyState === "link" ? T.copied : T.copyLink}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="ghost" className="h-11 px-2 sm:h-8" onClick={() => copy(inviteMessage(workspaceName, invite), "message")}>
          <MessageSquareText aria-hidden />
          {copyState === "message" ? T.messageCopied : T.copyMessage}
        </Button>
        {canShare && (
          <Button type="button" variant="ghost" className="h-11 px-2 sm:h-8" onClick={share}>
            <Share2 aria-hidden />
            {T.share}
          </Button>
        )}
        <form action={createAnotherAction} onSubmit={onCreateAnother}>
          <input type="hidden" name="email" value="" />
          <input type="hidden" name="role" value={invite.role} />
          <Button type="submit" variant="ghost" className="h-11 px-2 sm:h-8" disabled={creating} data-testid="invite-create-another">
            <Link2 aria-hidden />
            {T.another(roleLabel(invite.role))}
          </Button>
        </form>
      </div>
      <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
        {copyState === "manual" ? T.manual : T.once}
      </p>
    </div>
  );
}
