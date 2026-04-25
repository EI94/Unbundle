"use server";

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
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
import { canDeleteWorkspace } from "@/lib/workspace-permissions";

export type WorkspaceActionState = {
  ok: boolean;
  message?: string | null;
  fieldErrors?: Record<string, string>;
};

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
