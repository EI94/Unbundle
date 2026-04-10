"use server";

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import {
  createOrganization,
  getOrganizationsByUser,
} from "@/lib/db/queries/organizations";
import { createWorkspace } from "@/lib/db/queries/workspaces";

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
