"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/redirect-to-login";
import {
  acceptWorkspaceInvitation,
  createWorkspaceInvitation,
  deleteWorkspaceMembership,
  demoteToLearnerIfEnrolled,
  disablePortfolioShareLinks,
  revokeCourseGrants,
  revokeInvitationsCreatedBy,
  getWorkspaceInvitationById,
  getWorkspaceMembershipByUser,
  revokeWorkspaceInvitation,
  updateWorkspaceMembershipRole,
  WORKSPACE_COLLABORATOR_ROLES,
  type WorkspaceMemberRole,
  type WorkspaceCollaboratorRole,
} from "@/lib/db/queries/workspace-collaboration";
import { getCollaboratorAccess } from "@/lib/workspace-access";
import { canManageWorkspaceCollaborators } from "@/lib/workspace-permissions";
import { roleLabel } from "@/lib/workspace-roles";
import {
  WORKSPACE_INVITE_EXPIRES_IN_DAYS,
  WORKSPACE_INVITE_MAX_USES,
} from "@/lib/workspace-invite-token";

export type WorkspaceCollaborationActionState<Data = unknown> = {
  ok: boolean;
  message?: string | null;
  fieldErrors?: Record<string, string>;
  data?: Data;
};

export type CreateWorkspaceInviteData = {
  invitationId: string;
  inviteUrl: string;
  email: string | null;
  /** Letto dalla riga, non scelto qui: il ruolo assegnabile e' ristretto dal
   *  validatore a WORKSPACE_COLLABORATOR_ROLES, ma il tipo riflette la colonna. */
  role: WorkspaceMemberRole;
  expiresInDays: number;
  expiresAt: string;
  createdAt: string;
  maxUses: number;
  usedCount: number;
  replacedInvitationId?: string | null;
};

export type WorkspaceInvitationMutationData = {
  invitationId: string;
  revokedAt: string;
};

const createInviteSchema = z.object({
  email: z
    .string()
    .trim()
    .transform((value) => (value.length > 0 ? value.toLowerCase() : ""))
    .refine(
      (value) => value.length === 0 || z.string().email().safeParse(value).success,
      {
        message: "Email non valida.",
      }
    ),
  role: z.enum(WORKSPACE_COLLABORATOR_ROLES),
});

function normalizeBaseUrl(raw: string | undefined | null) {
  const value = raw?.trim();
  if (!value) return null;
  return value.startsWith("http://") || value.startsWith("https://")
    ? value.replace(/\/+$/, "")
    : `https://${value.replace(/\/+$/, "")}`;
}

async function getBaseUrl() {
  const configured =
    normalizeBaseUrl(process.env.NEXT_PUBLIC_APP_URL) ??
    normalizeBaseUrl(process.env.APP_URL) ??
    normalizeBaseUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
    normalizeBaseUrl(process.env.VERCEL_URL);
  if (configured) return configured;

  const headerStore = await headers();
  const host = headerStore.get("host") ?? "localhost:3000";
  const proto = headerStore.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

function errorState(message: string, fieldErrors: Record<string, string> = {}) {
  return { ok: false, message, fieldErrors };
}

async function assertWorkspaceInviteManager(workspaceId: string) {
  const session = await requireSession();

  const access = await getCollaboratorAccess(session.user.id, workspaceId);
  if (!access) {
    return {
      ok: false as const,
      state: errorState("Workspace non trovato o non accessibile."),
    };
  }
  if (!canManageWorkspaceCollaborators(access.role)) {
    return {
      ok: false as const,
      state: errorState("Non hai i permessi per invitare collaboratori."),
    };
  }

  return { ok: true as const, session, access };
}

export async function createWorkspaceInvitationAction(
  workspaceId: string,
  _prev: WorkspaceCollaborationActionState<CreateWorkspaceInviteData>,
  formData: FormData
): Promise<WorkspaceCollaborationActionState<CreateWorkspaceInviteData>> {
  const manager = await assertWorkspaceInviteManager(workspaceId);
  if (!manager.ok) return manager.state;

  const parsed = createInviteSchema.safeParse({
    email: String(formData.get("email") ?? ""),
    role: String(formData.get("role") ?? "contributor"),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[issue.path.join(".")] = issue.message;
    }
    return errorState("Controlla i campi evidenziati.", fieldErrors);
  }

  const { invitation, token } = await createWorkspaceInvitation({
    workspaceId,
    organizationId: manager.access.workspace.organizationId,
    role: parsed.data.role as WorkspaceCollaboratorRole,
    email: parsed.data.email || null,
    maxUses: WORKSPACE_INVITE_MAX_USES,
    expiresInDays: WORKSPACE_INVITE_EXPIRES_IN_DAYS,
    createdByUserId: manager.session.user.id,
  });
  const baseUrl = await getBaseUrl();
  const inviteUrl = `${baseUrl}/invite/${encodeURIComponent(token)}`;

  revalidatePath(`/dashboard/${workspaceId}/settings`);
  return {
    ok: true,
    message: "Link creato.",
    fieldErrors: {},
    data: {
      invitationId: invitation.id,
      inviteUrl,
      email: invitation.email,
      role: invitation.role,
      expiresInDays: WORKSPACE_INVITE_EXPIRES_IN_DAYS,
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
      maxUses: invitation.maxUses,
      usedCount: invitation.usedCount,
      replacedInvitationId: null,
    },
  };
}

export async function revokeWorkspaceInvitationAction(
  workspaceId: string,
  _prev: WorkspaceCollaborationActionState<WorkspaceInvitationMutationData>,
  formData: FormData
): Promise<WorkspaceCollaborationActionState<WorkspaceInvitationMutationData>> {
  const invitationId = String(formData.get("invitationId") ?? "");
  if (!invitationId) {
    return errorState("Invito non valido.");
  }

  const manager = await assertWorkspaceInviteManager(workspaceId);
  if (!manager.ok) return manager.state;

  const invitation = await getWorkspaceInvitationById(invitationId);
  if (invitation?.workspaceId !== workspaceId) {
    return errorState("Invito non trovato.");
  }

  const revoked = await revokeWorkspaceInvitation({ workspaceId, invitationId });
  revalidatePath(`/dashboard/${workspaceId}/settings`);
  return {
    ok: true,
    message: "Link disattivato: non funziona più.",
    fieldErrors: {},
    data: {
      invitationId,
      revokedAt: (revoked?.revokedAt ?? new Date()).toISOString(),
    },
  };
}

export async function recreateWorkspaceInvitationAction(
  workspaceId: string,
  _prev: WorkspaceCollaborationActionState<CreateWorkspaceInviteData>,
  formData: FormData
): Promise<WorkspaceCollaborationActionState<CreateWorkspaceInviteData>> {
  const invitationId = String(formData.get("invitationId") ?? "");
  if (!invitationId) {
    return errorState("Invito non valido.");
  }

  const manager = await assertWorkspaceInviteManager(workspaceId);
  if (!manager.ok) return manager.state;

  const previous = await getWorkspaceInvitationById(invitationId);
  if (previous?.workspaceId !== workspaceId) {
    return errorState("Invito non trovato.");
  }
  if (previous.usedCount >= previous.maxUses) {
    return errorState("Questo link è già stato usato: la persona è già entrata. Per invitare qualcun altro crea un nuovo link.");
  }

  await revokeWorkspaceInvitation({ workspaceId, invitationId });
  const { invitation, token } = await createWorkspaceInvitation({
    workspaceId,
    organizationId: manager.access.workspace.organizationId,
    role: previous.role as WorkspaceCollaboratorRole,
    email: previous.email,
    maxUses: WORKSPACE_INVITE_MAX_USES,
    expiresInDays: WORKSPACE_INVITE_EXPIRES_IN_DAYS,
    createdByUserId: manager.session.user.id,
  });
  const baseUrl = await getBaseUrl();
  const inviteUrl = `${baseUrl}/invite/${encodeURIComponent(token)}`;

  revalidatePath(`/dashboard/${workspaceId}/settings`);
  return {
    ok: true,
    message: "Nuovo link creato. Quello precedente non funziona più.",
    fieldErrors: {},
    data: {
      invitationId: invitation.id,
      inviteUrl,
      email: invitation.email,
      role: invitation.role,
      expiresInDays: WORKSPACE_INVITE_EXPIRES_IN_DAYS,
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
      maxUses: invitation.maxUses,
      usedCount: invitation.usedCount,
      replacedInvitationId: previous.id,
    },
  };
}

export type WorkspaceMemberMutationData = {
  userId: string;
  role?: string;
};

export async function updateWorkspaceMemberRoleAction(
  workspaceId: string,
  _prev: WorkspaceCollaborationActionState<WorkspaceMemberMutationData>,
  formData: FormData
): Promise<WorkspaceCollaborationActionState<WorkspaceMemberMutationData>> {
  const manager = await assertWorkspaceInviteManager(workspaceId);
  if (!manager.ok) return manager.state;

  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!userId) return errorState("Membro non valido.");
  if (!(WORKSPACE_COLLABORATOR_ROLES as readonly string[]).includes(role)) {
    return errorState("Ruolo non valido.");
  }
  if (userId === manager.session.user.id) {
    return errorState("Non puoi modificare il tuo stesso ruolo.");
  }

  const membership = await getWorkspaceMembershipByUser(userId, workspaceId);
  if (!membership) {
    return errorState(
      "Questo membro fa parte dell'organizzazione: il suo ruolo si gestisce a livello organizzazione, non di workspace."
    );
  }
  if (membership.role === "learner") {
    // Un partecipante a un corso diventa collaboratore solo accettando un
    // invito: un cambio di ruolo per sbaglio gli aprirebbe tutto il workspace.
    return errorState(
      "Questa persona partecipa a un corso. Per farla diventare collaboratore mandale un link di invito."
    );
  }

  const updated = await updateWorkspaceMembershipRole({
    workspaceId,
    userId,
    role: role as WorkspaceCollaboratorRole,
  });
  if (!updated) return errorState("Aggiornamento non riuscito.");

  // Chi non può più invitare non deve lasciare link aperti dietro di sé.
  const revokedInvites =
    canManageWorkspaceCollaborators(membership.role) && !canManageWorkspaceCollaborators(role)
      ? await revokeInvitationsCreatedBy({ workspaceId, userId })
      : 0;

  revalidatePath(`/dashboard/${workspaceId}/settings`);
  return {
    ok: true,
    message:
      `Ruolo aggiornato a ${roleLabel(role)}: vale da subito.` +
      (revokedInvites > 0 ? ` ${revokedInvites === 1 ? "Il link di invito che aveva creato è stato disattivato" : `I ${revokedInvites} link di invito che aveva creato sono stati disattivati`}.` : ""),
    fieldErrors: {},
    data: { userId, role },
  };
}

export async function removeWorkspaceMemberAction(
  workspaceId: string,
  _prev: WorkspaceCollaborationActionState<WorkspaceMemberMutationData>,
  formData: FormData
): Promise<WorkspaceCollaborationActionState<WorkspaceMemberMutationData>> {
  const manager = await assertWorkspaceInviteManager(workspaceId);
  if (!manager.ok) return manager.state;

  const userId = String(formData.get("userId") ?? "");
  if (!userId) return errorState("Membro non valido.");
  if (userId === manager.session.user.id) {
    return errorState("Non puoi rimuovere te stesso dal workspace.");
  }

  const membership = await getWorkspaceMembershipByUser(userId, workspaceId);
  if (!membership) {
    return errorState(
      "Questo membro fa parte dell'organizzazione: non può essere rimosso dal singolo workspace."
    );
  }

  if (membership.role === "learner") {
    return errorState(
      "Questa persona partecipa solo ai corsi: la sua iscrizione si gestisce da Formazione."
    );
  }

  // Chi è iscritto a un corso nel workspace resta partecipante: perde il
  // workspace, non i suoi corsi. In ogni caso perde i permessi da formatore.
  const revokedGrants = await revokeCourseGrants({ workspaceId, userId, actorId: manager.session.user.id });
  const keptAsLearner = await demoteToLearnerIfEnrolled({ workspaceId, userId });
  const removed = keptAsLearner || (await deleteWorkspaceMembership({ workspaceId, userId }));
  if (!removed) return errorState("Rimozione non riuscita.");

  // Niente porte lasciate aperte: i link di invito che aveva creato e i link
  // pubblici al portfolio già condivisi (che potrebbe aver conservato) smettono
  // di funzionare. Chi ha un account con accesso entra comunque dal login.
  const revokedInvites = await revokeInvitationsCreatedBy({ workspaceId, userId });
  await disablePortfolioShareLinks(workspaceId);

  revalidatePath(`/dashboard/${workspaceId}/settings`);
  return {
    ok: true,
    message:
      (keptAsLearner
        ? "Non è più collaboratore: resta solo partecipante ai suoi corsi. "
        : "Accesso rimosso: questa persona non vede più il workspace. ") +
      "I link pubblici al portfolio già condivisi sono stati disattivati" +
      (revokedInvites > 0 ? `, insieme ai link di invito che aveva creato` : "") +
      (revokedGrants > 0 ? ". Ha perso anche i permessi da formatore sui corsi." : "."),
    fieldErrors: {},
    data: { userId },
  };
}

export type AcceptInviteFailure = "invalid" | "revoked" | "expired" | "used" | "email_mismatch" | "email_unverified";

const ACCEPT_MESSAGES: Record<AcceptInviteFailure, string> = {
  invalid: "Questo link di invito non è valido. Controlla di averlo copiato per intero.",
  revoked: "Questo invito è stato annullato. Chiedi a chi ti ha invitato di crearne uno nuovo.",
  expired: "Questo invito è scaduto. Chiedi a chi ti ha invitato di crearne uno nuovo.",
  used: "Questo link è già stato usato da un'altra persona: ogni link vale per una sola persona. Chiedi a chi ti ha invitato di crearne uno per te.",
  email_mismatch: "Questo invito è riservato a un'altra email: accedi con l'account giusto o chiedi un nuovo link.",
  email_unverified: "Per usare un invito riservato alla tua email devi prima confermarla.",
};

export async function acceptWorkspaceInvitationAction(
  token: string,
  _prev: WorkspaceCollaborationActionState<{ reason: AcceptInviteFailure }>,
  _formData: FormData
): Promise<WorkspaceCollaborationActionState<{ reason: AcceptInviteFailure }>> {
  void _prev;
  void _formData;
  const session = await requireSession(`/invite/${token}`);

  const result = await acceptWorkspaceInvitation({
    token,
    userId: session.user.id,
    userEmail: session.user.email,
    emailVerified: session.user.emailVerified,
  });

  if (!result.ok) {
    return { ok: false, message: ACCEPT_MESSAGES[result.reason], fieldErrors: {}, data: { reason: result.reason } };
  }

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/${result.workspaceId}`);
  const flag = result.outcome === "joined" ? "1" : result.outcome === "upgraded" ? "upgraded" : "already";
  redirect(`/dashboard/${result.workspaceId}/portfolio?joined=${flag}`);
}

export async function disablePortfolioShareLinksAction(
  workspaceId: string,
  _prev: WorkspaceCollaborationActionState,
  _formData: FormData
): Promise<WorkspaceCollaborationActionState> {
  void _prev;
  void _formData;
  const manager = await assertWorkspaceInviteManager(workspaceId);
  if (!manager.ok) return manager.state;
  await disablePortfolioShareLinks(workspaceId);
  revalidatePath(`/dashboard/${workspaceId}/settings`);
  return {
    ok: true,
    message: "Link pubblici disattivati. Le prossime notifiche su Slack porteranno link nuovi.",
    fieldErrors: {},
  };
}
