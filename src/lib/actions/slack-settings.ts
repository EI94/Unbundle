"use server";

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import {
  getSlackInstallationByWorkspace,
  updateSlackNotifyChannel,
} from "@/lib/db/queries/slack";

function isLikelySlackChannelId(id: string): boolean {
  return /^[CGD][A-Z0-9]{8,}$/i.test(id) && id.length >= 9;
}

export async function setSlackNotifyChannelAction(
  workspaceId: string,
  rawChannelId: string
) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) throw new Error("Workspace non trovato");

  const installation = await getSlackInstallationByWorkspace(workspaceId);
  if (!installation) throw new Error("Installa prima il bot Slack da questa pagina.");

  const trimmed = rawChannelId.trim();
  if (trimmed === "") {
    await updateSlackNotifyChannel(installation.id, null);
    revalidatePath(`/dashboard/${workspaceId}/settings`);
    return { notifyChannelId: null as string | null };
  }

  if (!isLikelySlackChannelId(trimmed)) {
    throw new Error(
      "ID canale non valido. Deve iniziare con C, G o D (es. C01234ABCDE). Lo trovi nel link del canale in Slack."
    );
  }

  await updateSlackNotifyChannel(installation.id, trimmed);
  revalidatePath(`/dashboard/${workspaceId}/settings`);
  return { notifyChannelId: trimmed };
}
