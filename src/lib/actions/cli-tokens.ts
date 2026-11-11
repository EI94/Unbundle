"use server";

/**
 * «Revoca» nella scheda «CLI di Unbundle» di Impostazioni (rilascio 8.0b): solo un collegamento della persona, nel
 * workspace. La CLI che lo usava riceve 401 alla prossima chiamata.
 */
import { revalidatePath } from "next/cache";
import { requireWorkspaceAccess } from "@/lib/auth/require-workspace";
import { ensureDbSchema } from "@/lib/db/ensure-schema";
import { cliStoreReady, revokeOwnCliToken } from "@/lib/db/queries/use-case-cli-auth";
import { getAppUcExecutor } from "@/lib/db/uc-executor";

export async function revokeOwnCliTokenAction(workspaceId: string, tokenId: string): Promise<{ ok: boolean; message: string }> {
  const { session } = await requireWorkspaceAccess(workspaceId);
  if (!/^[0-9a-f-]{36}$/i.test(tokenId)) return { ok: false, message: "Collegamento non valido." };
  await ensureDbSchema();
  const executor = await getAppUcExecutor();
  if (!(await cliStoreReady(executor))) return { ok: false, message: "Non ancora disponibile: riprova tra qualche minuto." };
  const revoked = await revokeOwnCliToken(executor, { userId: session.user.id, workspaceId, tokenId });
  revalidatePath(`/dashboard/${workspaceId}/settings`);
  return revoked ? { ok: true, message: "Collegamento revocato." } : { ok: false, message: "Il collegamento non c'è più." };
}
