"use server";

/**
 * Le azioni di Granola (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §3.5, §8): scritture brevi, senza modello.
 * Ognuna rilegge la sessione con `contextActorFromSession` (non riuscito: `permesso_mancante`), chiama la funzione
 * condivisa di src/lib/db/queries/context-granola.ts, che rifà da sé il controllo (solo Lateral Space), e se riesce
 * aggiorna «Contesto» (e le Impostazioni, dove sta il blocco di Granola).
 * Il giro di Granola non è un'azione: è la rotta `POST /api/context/[workspaceId]/granola/sync`, che ha 120 secondi.
 */
import { revalidatePath } from "next/cache";
import { contextActorFromSession } from "@/lib/context/server/actor";
import { CONTEXT_TEXT } from "@/lib/context/text";
import type { ContextActor } from "@/lib/context/visibility";
import {
  assignGranolaMeeting,
  disconnectGranola,
  leaveOutGranolaMeetings,
  listGranolaFolders,
  saveGranolaRules,
  startGranolaConnect,
} from "@/lib/db/queries/context-granola";
import type { ServiceResult } from "@/lib/use-cases/types";

const denied = <T>(): ServiceResult<T> => ({ ok: false, error: "permesso_mancante", message: CONTEXT_TEXT.errors.denied });

async function actorFor(workspaceId: unknown): Promise<ContextActor | null> {
  if (typeof workspaceId !== "string") return null;
  const who = await contextActorFromSession(workspaceId);
  return who.ok ? who.actor : null;
}

function refresh(workspaceId: string, settings: boolean): void {
  revalidatePath(`/dashboard/${workspaceId}/contesto`, "layout");
  if (settings) revalidatePath(`/dashboard/${workspaceId}/settings`);
}

/** «Collega Granola» (anche «Ricollega»): l'indirizzo di Granola dove va il browser. */
export async function startGranolaConnectAction(workspaceId: string): Promise<ServiceResult<{ url: string }>> {
  const actor = await actorFor(workspaceId);
  if (!actor) return denied();
  return startGranolaConnect(actor);
}

/** «Scollega»: il collegamento di chi chiama. Gli appunti già entrati restano. */
export async function disconnectGranolaAction(workspaceId: string): Promise<ServiceResult<true>> {
  const actor = await actorFor(workspaceId);
  if (!actor) return denied();
  const result = await disconnectGranola(actor.userId);
  if (result.ok) refresh(actor.workspaceId, true);
  return result;
}

/** «Salva» delle regole: quali call sono di questo cliente. */
export async function saveGranolaRulesAction(
  workspaceId: string,
  input: { folderId: string | null; folderName: string | null; emails: string[]; domains: string[]; titleWords: string[]; wantTranscript: boolean },
): Promise<ServiceResult<true>> {
  const actor = await actorFor(workspaceId);
  if (!actor) return denied();
  const result = await saveGranolaRules(actor, input);
  if (result.ok) refresh(actor.workspaceId, true);
  return result;
}

/** Le cartelle di Granola di chi guarda, per il menu delle regole. Non cambia niente. */
export async function listGranolaFoldersAction(workspaceId: string): Promise<ServiceResult<Array<{ id: string; name: string }>>> {
  const actor = await actorFor(workspaceId);
  if (!actor) return denied();
  return listGranolaFolders(actor);
}

/** «Assegna a {cliente}»: la call entra nel «Contesto» di questo workspace, da leggere. */
export async function assignGranolaMeetingAction(workspaceId: string, meetingId: string): Promise<ServiceResult<{ sourceId: string }>> {
  const actor = await actorFor(workspaceId);
  if (!actor) return denied();
  const result = await assignGranolaMeeting(actor, meetingId);
  if (result.ok) refresh(actor.workspaceId, false);
  return result;
}

/** «Lascia fuori» e «Lascia fuori tutte»: di queste call resta solo l'id, e non tornano in «Da smistare». */
export async function leaveOutGranolaMeetingsAction(workspaceId: string, meetingIds: string[]): Promise<ServiceResult<{ left: number }>> {
  const actor = await actorFor(workspaceId);
  if (!actor) return denied();
  const result = await leaveOutGranolaMeetings(actor, meetingIds);
  if (result.ok) refresh(actor.workspaceId, false);
  return result;
}
