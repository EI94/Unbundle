"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspaceAccess } from "@/lib/auth/require-workspace";
import { isUcEnabledFor, ucLsDomains } from "@/lib/db/queries/uc-access";
import { subprocessorAcksReady } from "@/lib/db/queries/context-consent";
import { referentStoreReady } from "@/lib/db/queries/use-case-referent-base";
import { referentAskEnabled } from "@/lib/use-cases/referent/availability";
import { declareSubprocessors } from "@/lib/db/queries/uc-subprocessors";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { ucLogError } from "@/lib/uc/log";
import { ucFailure, ucSectionAvailable, type UcActionResult } from "./uc-action-context";

/**
 * Impostazioni › «Sub-responsabili»: la persona del cliente autorizza Lateral
 * Space a ricorrere ai sub-responsabili elencati (GDPR art. 28, par. 2), oppure
 * (rilascio 5.1) Lateral Space registra l'ok per conto del cliente. Chi può
 * farlo, la versione dell'elenco e la casella si ricontrollano sul server
 * (`declareSubprocessors`), mai fidandosi del browser. Vale anche senza i dossier, dove è accesa
 * «Chiedi al referente» con i suoi archivi pronti: le sue email vogliono la stessa autorizzazione.
 * (Rilascio 9a) Vale in ogni workspace, se `uc_subprocessor_acks` esiste: le funzioni AI di «Contesto», la chat di
 * Discovery e di mappatura e la lettura dei PDF con il modello vogliono la stessa autorizzazione, e l'ok si deve poter
 * dare ovunque. Chi può darlo, il testo e la riga salvata non cambiano.
 */
export async function declareSubprocessorsAction(workspaceId: string, listVersion: string, confirmed: boolean): Promise<UcActionResult<null>> {
  const { session } = await requireWorkspaceAccess(workspaceId);
  const withoutDossiers = !isUcEnabledFor(workspaceId);
  const viaReferents = withoutDossiers && referentAskEnabled(workspaceId, process.env) && (await referentStoreReady());
  // (9a) La terza condizione: senza dossier e senza referenti basta che la tabella dell'ok ci sia.
  const viaContext = withoutDossiers && !viaReferents && (await subprocessorAcksReady());
  if (!viaReferents && !viaContext) {
    const available = await ucSectionAvailable(workspaceId);
    if (!available.ok) return available;
  }
  let byLateralSpace = false;
  try {
    const executor = await getAppUcExecutor();
    const result = await declareSubprocessors(executor, { workspaceId, userId: session.user.id, lsDomains: ucLsDomains(), listVersion, confirmed });
    if (!result.ok) return ucFailure(result.code, result.message);
    byLateralSpace = result.value.ack.registeredBy === "lateral_space";
  } catch (error) {
    ucLogError({ area: "uc", op: "sub_responsabili", workspaceId }, error);
    return ucFailure("non_disponibile", "Autorizzazione non registrata. Riprova tra poco.");
  }
  revalidatePath(`/dashboard/${workspaceId}/settings`);
  revalidatePath(`/dashboard/${workspaceId}/casi-duso`);
  revalidatePath(`/dashboard/${workspaceId}/use-cases`, "layout");
  // (9a) Dove l'ok sblocca le funzioni AI: «Contesto», la chat di Discovery, la chat di mappatura.
  revalidatePath(`/dashboard/${workspaceId}/contesto`, "layout");
  revalidatePath(`/dashboard/${workspaceId}/setup/leadership`, "layout");
  revalidatePath(`/dashboard/${workspaceId}/mapping`, "layout");
  return { ok: true, data: null, message: byLateralSpace ? "Ok registrato per conto del cliente." : "Autorizzazione registrata." };
}
