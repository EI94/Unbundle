"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspaceAccess } from "@/lib/auth/require-workspace";
import { isUcEnabledFor, ucLsDomains } from "@/lib/db/queries/uc-access";
import { referentStoreReady } from "@/lib/db/queries/use-case-referent-base";
import { referentAskEnabled } from "@/lib/use-cases/referent/availability";
import { declareSubprocessors } from "@/lib/db/queries/uc-subprocessors";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { ucLogError } from "@/lib/uc/log";
import { ucFailure, ucSectionAvailable, type UcActionResult } from "./uc-action-context";

/**
 * Impostazioni › «Sub-responsabili»: la persona del cliente autorizza Lateral
 * Space a ricorrere ai sub-responsabili elencati (GDPR art. 28, par. 2). Chi può
 * farlo, la versione dell'elenco e la casella si ricontrollano sul server
 * (`declareSubprocessors`), mai fidandosi del browser. Vale anche senza i dossier, dove è accesa
 * «Chiedi al referente» con i suoi archivi pronti: le sue email vogliono la stessa autorizzazione.
 */
export async function declareSubprocessorsAction(workspaceId: string, listVersion: string, confirmed: boolean): Promise<UcActionResult<null>> {
  const { session } = await requireWorkspaceAccess(workspaceId);
  const viaReferents = !isUcEnabledFor(workspaceId) && referentAskEnabled(workspaceId, process.env) && (await referentStoreReady());
  if (!viaReferents) {
    const available = await ucSectionAvailable(workspaceId);
    if (!available.ok) return available;
  }
  try {
    const executor = await getAppUcExecutor();
    const result = await declareSubprocessors(executor, { workspaceId, userId: session.user.id, lsDomains: ucLsDomains(), listVersion, confirmed });
    if (!result.ok) return ucFailure(result.code, result.message);
  } catch (error) {
    ucLogError({ area: "uc", op: "sub_responsabili", workspaceId }, error);
    return ucFailure("non_disponibile", "Autorizzazione non registrata. Riprova tra poco.");
  }
  revalidatePath(`/dashboard/${workspaceId}/settings`);
  revalidatePath(`/dashboard/${workspaceId}/casi-duso`);
  revalidatePath(`/dashboard/${workspaceId}/use-cases`, "layout");
  return { ok: true, data: null, message: "Autorizzazione registrata." };
}
