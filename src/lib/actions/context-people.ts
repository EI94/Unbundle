"use server";

import { revalidatePath } from "next/cache";
import { contextActorFromSession, type ContextActor } from "@/lib/context/server/actor";
import { CONTEXT_TEXT } from "@/lib/context/text";
import { erasePerson, searchPerson, type PersonErased, type PersonHits } from "@/lib/db/queries/context-people";
import { logSafeError } from "@/lib/log/safe-error";
import type { ServiceResult } from "@/lib/use-cases/types";

/**
 * «Cerca una persona» nella vista «Appunti» (rilascio 9b, docs/contesto/RILASCIO-9b-COSTRUZIONE.md §2.13): le due azioni
 * del pannello. Ognuna rilegge chi chiama dalla sessione (`contextActorFromSession`: chi non entra risponde
 * `permesso_mancante`) e chiama la funzione condivisa, che rifà da sé il controllo (solo Lateral Space). Dopo «Togli … da
 * tutto» la pagina si aggiorna (`revalidatePath` di `/dashboard/<ws>/contesto`). Nessun modello: «In breve» lo riscrive
 * la notte.
 *
 * Il nome viaggia nel corpo della richiesta (un'azione è un POST), mai in un indirizzo; nei log solo codici e id.
 */

const denied = <T>(): ServiceResult<T> => ({ ok: false, error: "permesso_mancante", message: CONTEXT_TEXT.errors.denied });
const retry = <T>(): ServiceResult<T> => ({ ok: false, error: "riprova", message: CONTEXT_TEXT.errors.retry });

/** Chi chiama, poi la funzione condivisa. Un errore inatteso risponde «riprova»; nel log il codice, mai il nome. */
async function run<T>(workspaceId: string, op: string, act: (actor: ContextActor) => Promise<ServiceResult<T>>): Promise<ServiceResult<T>> {
  try {
    const who = await contextActorFromSession(workspaceId);
    if (!who.ok) return denied<T>();
    return await act(who.actor);
  } catch (error) {
    logSafeError("context/people-actions", `${op}_non_riuscita`, error, { workspaceId });
    return retry<T>();
  }
}

/** «Cerca»: dove compare il nome o l'e-mail, a gruppi. Non scrive niente. */
export async function searchPersonAction(workspaceId: string, term: string): Promise<ServiceResult<PersonHits>> {
  return run(workspaceId, "ricerca_persona", (actor) => searchPerson(actor, term));
}

/** «Togli «…» da tutto», dopo la conferma. Poi la pagina si aggiorna: gli appunti cambiano titolo. */
export async function erasePersonAction(workspaceId: string, term: string): Promise<ServiceResult<PersonErased>> {
  const result = await run(workspaceId, "persona_tolta", (actor) => erasePerson(actor, term));
  if (result.ok) revalidatePath(`/dashboard/${workspaceId}/contesto`, "layout");
  return result;
}
