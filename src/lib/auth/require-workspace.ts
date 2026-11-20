import { notFound, redirect } from "next/navigation";
import type { Session } from "@/lib/auth";
import { requireSession } from "@/lib/auth/redirect-to-login";
import { caseOnlyHomePath, workspaceDoor, type WorkspaceDoorOptions } from "@/lib/auth/case-only";
import { learnerHomePath } from "@/lib/learning/learner-scope";
import {
  getWorkspaceAccessForUser,
  type WorkspaceAccess,
} from "@/lib/workspace-access";

/**
 * Le server action e le route handler sono endpoint raggiungibili
 * direttamente: il controllo di accesso applicato dal layout del dashboard
 * non le copre. Ogni funzione che accetta un workspaceId dall'esterno deve
 * quindi verificare da sé che chi chiama abbia accesso a QUEL workspace,
 * altrimenti la piattaforma — che ospita piu' clienti sullo stesso database —
 * lascia leggere a uno i dati di un altro.
 *
 * Solleva un errore invece di restituire uno stato perche' le funzioni che
 * protegge restituiscono dati, non action state: un `throw` le interrompe
 * prima di qualunque query.
 *
 * (8.0d-1) Chiusa per default, aperta per elenco (`workspaceDoor`): senza
 * opzioni passano solo i cinque ruoli da collaboratore. `allowLearner` apre a
 * chi segue un corso, `allowCaseOnly` a «Solo questo use case» (solo nei file
 * di `CASE_ONLY_SURFACES`); un ruolo che il codice non conosce non passa mai.
 */
export async function requireWorkspaceAccess(
  workspaceId: string,
  opts: WorkspaceDoorOptions = {}
): Promise<{ session: Session; access: WorkspaceAccess }> {
  const session = await requireSession();
  const userId = session.user?.id;
  if (!userId) throw new Error("Sessione non valida.");

  const access = await getWorkspaceAccessForUser(userId, workspaceId);
  // Un partecipante a un corso è membro del workspace ma non un collaboratore:
  // le funzioni fuori dalla Formazione non sono per lui. Lo stesso per
  // «Solo questo use case» fuori dalle sue porte, e per un ruolo sconosciuto.
  if (!access || workspaceDoor(access.role, opts) !== "aperta") {
    throw new Error("Workspace non trovato o non accessibile.");
  }

  return { session, access };
}

/**
 * Lo stesso controllo per le pagine sotto /dashboard/[workspaceId].
 *
 * Il layout del workspace lo fa già, ma un layout non viene rieseguito nelle
 * navigazioni interne (src/app/.../layout.tsx resta montato): una persona
 * rimossa con la scheda aperta, o un partecipante che segue un link dalla
 * campanella, arriverebbe alla pagina senza passare dal controllo. Ogni pagina
 * quindi verifica da sé. I partecipanti ai corsi restano nell'area Formazione.
 *
 * (8.0d-1) La stessa regola di `requireWorkspaceAccess`: «Solo questo use case»
 * fuori dalle sue pagine torna all'Agent Factory, un ruolo che il codice non
 * conosce riceve 404.
 */
export async function requireWorkspacePage(
  workspaceId: string,
  opts: WorkspaceDoorOptions = {}
): Promise<{ session: Session; access: WorkspaceAccess }> {
  const session = await requireSession();
  const access = await getWorkspaceAccessForUser(session.user.id, workspaceId);
  if (!access) notFound();
  const door = workspaceDoor(access.role, opts);
  if (door === "formazione") redirect(learnerHomePath(workspaceId));
  if (door === "solo_caso") redirect(caseOnlyHomePath(workspaceId));
  if (door !== "aperta") notFound();
  return { session, access };
}
