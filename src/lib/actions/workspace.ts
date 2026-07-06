"use server";

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import {
  createOrganization,
  getOrganizationsByUser,
  getUserMembership,
} from "@/lib/db/queries/organizations";
import {
  createWorkspace,
  deleteWorkspaceById,
  getWorkspaceById,
} from "@/lib/db/queries/workspaces";
import {
  createWorkspaceInvitation,
  WORKSPACE_COLLABORATOR_ROLES,
  type WorkspaceCollaboratorRole,
} from "@/lib/db/queries/workspace-collaboration";
import {
  canDeleteWorkspace,
  canManageWorkspaceCollaborators,
} from "@/lib/workspace-permissions";
import {
  WORKSPACE_INVITE_EXPIRES_IN_DAYS,
  WORKSPACE_INVITE_MAX_USES,
} from "@/lib/workspace-invite-token";

export type WorkspaceActionState = {
  ok: boolean;
  message?: string | null;
  fieldErrors?: Record<string, string>;
};

export type WorkspaceTeamInviteResult = {
  email: string;
  role: WorkspaceCollaboratorRole;
  inviteUrl: string;
};

export type CreateWorkspaceWithTeamData = {
  workspaceId: string;
  workspaceName: string;
  invites: WorkspaceTeamInviteResult[];
  inviteWarning: string | null;
};

const MAX_TEAM_INVITES = 10;

const teamInvitesSchema = z
  .array(
    z.object({
      email: z
        .string()
        .trim()
        .transform((value) => value.toLowerCase())
        .pipe(z.string().email()),
      role: z.enum(WORKSPACE_COLLABORATOR_ROLES),
    })
  )
  .max(MAX_TEAM_INVITES);

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

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function createWorkspaceAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const name = formData.get("name") as string;
  const description = formData.get("description") as string;
  let organizationId = formData.get("organizationId") as string;
  const orgName = formData.get("orgName") as string;

  if (!name?.trim()) {
    throw new Error("Il nome del workspace è obbligatorio");
  }

  if (!organizationId && orgName?.trim()) {
    const slug = orgName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    const org = await createOrganization(
      {
        name: orgName.trim(),
        slug: `${slug}-${Date.now()}`,
      },
      session.user.id
    );
    organizationId = org.id;
  }

  if (!organizationId) {
    const userOrgs = await getOrganizationsByUser(session.user.id);
    if (userOrgs.length === 0) {
      const org = await createOrganization(
        {
          name: "La mia organizzazione",
          slug: `org-${Date.now()}`,
        },
        session.user.id
      );
      organizationId = org.id;
    } else {
      organizationId = userOrgs[0].organization.id;
    }
  }

  const workspace = await createWorkspace({
    organizationId,
    name: name.trim(),
    description: description?.trim() || null,
  });

  redirect(`/dashboard/${workspace.id}`);
}

export async function createWorkspaceWithTeamAction(
  _prev: WorkspaceActionState & { data?: CreateWorkspaceWithTeamData },
  formData: FormData
): Promise<WorkspaceActionState & { data?: CreateWorkspaceWithTeamData }> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const name = formString(formData, "name");
  const description = formString(formData, "description");
  let organizationId = formString(formData, "organizationId");
  const orgName = formString(formData, "orgName");
  const invitesRaw = formString(formData, "teamInvites");

  if (!name) {
    return {
      ok: false,
      message: "Il nome del workspace è obbligatorio.",
      fieldErrors: { name: "Obbligatorio." },
    };
  }

  let invites: Array<{ email: string; role: WorkspaceCollaboratorRole }> = [];
  if (invitesRaw) {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(invitesRaw);
    } catch {
      return {
        ok: false,
        message: "Formato inviti non valido.",
        fieldErrors: { teamInvites: "Formato non valido." },
      };
    }
    const parsed = teamInvitesSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return {
        ok: false,
        message:
          "Controlla le email del team: una o più email non sono valide.",
        fieldErrors: { teamInvites: "Email o ruolo non validi." },
      };
    }
    // Dedup per email mantenendo la prima occorrenza.
    const seen = new Set<string>();
    invites = parsed.data.filter((invite) => {
      if (seen.has(invite.email)) return false;
      seen.add(invite.email);
      return true;
    });
  }

  if (!organizationId && orgName) {
    const slug = orgName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const org = await createOrganization(
      { name: orgName, slug: `${slug}-${Date.now()}` },
      session.user.id
    );
    organizationId = org.id;
  }

  if (!organizationId) {
    const userOrgs = await getOrganizationsByUser(session.user.id);
    if (userOrgs.length === 0) {
      const org = await createOrganization(
        { name: "La mia organizzazione", slug: `org-${Date.now()}` },
        session.user.id
      );
      organizationId = org.id;
    } else {
      organizationId = userOrgs[0].organization.id;
    }
  }

  // Se l'org è stata scelta (non creata ora), l'utente deve esserne membro.
  const membership = await getUserMembership(session.user.id, organizationId);
  if (!membership) {
    return {
      ok: false,
      message: "Non fai parte dell'organizzazione selezionata.",
      fieldErrors: {},
    };
  }

  const workspace = await createWorkspace({
    organizationId,
    name,
    description: description || null,
  });

  const inviteResults: WorkspaceTeamInviteResult[] = [];
  let inviteWarning: string | null = null;
  if (invites.length > 0) {
    if (!canManageWorkspaceCollaborators(membership.role)) {
      inviteWarning =
        "Workspace creato, ma il tuo ruolo non permette di invitare collaboratori: chiedi a un Executive Sponsor o Transformation Lead.";
    } else {
      const baseUrl = await getBaseUrl();
      for (const invite of invites) {
        const { token } = await createWorkspaceInvitation({
          workspaceId: workspace.id,
          organizationId,
          role: invite.role,
          email: invite.email,
          maxUses: WORKSPACE_INVITE_MAX_USES,
          expiresInDays: WORKSPACE_INVITE_EXPIRES_IN_DAYS,
          createdByUserId: session.user.id,
        });
        inviteResults.push({
          email: invite.email,
          role: invite.role,
          inviteUrl: `${baseUrl}/invite/${encodeURIComponent(token)}`,
        });
      }
    }
  }

  // NB: niente revalidatePath qui — farebbe smontare la dialog (l'empty state
  // del dashboard viene sostituito dalla lista) prima che l'utente possa
  // copiare i link di invito. Il refresh avviene lato client alla chiusura.
  return {
    ok: true,
    message: null,
    fieldErrors: {},
    data: {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      invites: inviteResults,
      inviteWarning,
    },
  };
}

async function deleteBlobUrls(blobUrls: string[]) {
  if (blobUrls.length === 0) return;
  try {
    const { del } = await import("@vercel/blob");
    await del(blobUrls);
  } catch (error) {
    console.error("[actions/workspace] Blob cleanup failed:", error);
  }
}

export async function deleteWorkspaceAction(
  workspaceId: string,
  _prev: WorkspaceActionState,
  formData: FormData
): Promise<WorkspaceActionState> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) {
    return {
      ok: false,
      message: "Workspace non trovato.",
      fieldErrors: {},
    };
  }

  const membership = await getUserMembership(
    session.user.id,
    workspace.organizationId
  );
  if (!canDeleteWorkspace(membership?.role)) {
    return {
      ok: false,
      message:
        "Non hai i permessi per eliminare questo workspace. Serve un ruolo Executive Sponsor o Transformation Lead.",
      fieldErrors: {},
    };
  }

  const confirmationName = formString(formData, "confirmationName");
  const acknowledged = formData.get("acknowledged") === "on";
  const fieldErrors: Record<string, string> = {};

  if (confirmationName !== workspace.name) {
    fieldErrors.confirmationName =
      "Per confermare devi digitare esattamente il nome del workspace.";
  }
  if (!acknowledged) {
    fieldErrors.acknowledged =
      "Conferma di aver capito che l'operazione è permanente.";
  }
  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      message: "Controlla i campi evidenziati prima di eliminare.",
      fieldErrors,
    };
  }

  try {
    const result = await deleteWorkspaceById(workspaceId);
    if (!result.workspace) {
      return {
        ok: false,
        message: "Workspace già eliminato o non più disponibile.",
        fieldErrors: {},
      };
    }
    await deleteBlobUrls(result.blobUrls);
  } catch (error) {
    console.error("[actions/workspace] deleteWorkspaceAction failed:", error);
    return {
      ok: false,
      message:
        "Eliminazione non riuscita. Riprova tra poco o contatta un amministratore.",
      fieldErrors: {},
    };
  }

  revalidatePath("/dashboard");
  redirect("/dashboard?workspaceDeleted=1");
}
