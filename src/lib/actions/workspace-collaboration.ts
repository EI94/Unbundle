"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  acceptWorkspaceInvitation,
  createWorkspaceInvitation,
  getWorkspaceInvitationById,
  revokeWorkspaceInvitation,
  WORKSPACE_COLLABORATOR_ROLES,
  type WorkspaceCollaboratorRole,
} from "@/lib/db/queries/workspace-collaboration";
import { getWorkspaceAccessForUser } from "@/lib/workspace-access";
import { canManageWorkspaceCollaborators } from "@/lib/workspace-permissions";
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
  role: WorkspaceCollaboratorRole;
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
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const access = await getWorkspaceAccessForUser(session.user.id, workspaceId);
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
    message:
      `Link pronto: valido per ${WORKSPACE_INVITE_EXPIRES_IN_DAYS} giorni. Copialo e invialo al collega.`,
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
    message: "Invito revocato. Il vecchio link non può più essere usato.",
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
    message:
      `Nuovo link pronto: valido per ${WORKSPACE_INVITE_EXPIRES_IN_DAYS} giorni. Il link precedente è stato revocato.`,
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

export async function acceptWorkspaceInvitationAction(
  token: string,
  _prev: WorkspaceCollaborationActionState,
  _formData: FormData
): Promise<WorkspaceCollaborationActionState> {
  void _prev;
  void _formData;
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/invite/${token}`)}`);
  }

  const result = await acceptWorkspaceInvitation({
    token,
    userId: session.user.id,
    userEmail: session.user.email,
  });

  if (!result.ok) {
    const messages: Record<typeof result.reason, string> = {
      invalid: "Invito non valido.",
      expired: "Invito scaduto o revocato.",
      email_mismatch:
        "Questo invito e' riservato a un'altra email. Accedi con l'account corretto o chiedi un nuovo link.",
      full: "Questo link ha gia raggiunto il numero massimo di utilizzi.",
    };
    return errorState(messages[result.reason]);
  }

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/${result.workspaceId}`);
  redirect(`/dashboard/${result.workspaceId}/portfolio?joined=1`);
}
