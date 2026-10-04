import { notFound, redirect } from "next/navigation";
import type { Session } from "@/lib/auth";
import { requireSession } from "@/lib/auth/redirect-to-login";
import { isLearnerOnly, learnerHomePath } from "@/lib/learning/learner-scope";
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
 */
export async function requireWorkspaceAccess(
  workspaceId: string,
  opts: { allowLearner?: boolean } = {}
): Promise<{ session: Session; access: WorkspaceAccess }> {
  const session = await requireSession();
  const userId = session.user?.id;
  if (!userId) throw new Error("Sessione non valida.");

  const access = await getWorkspaceAccessForUser(userId, workspaceId);
  // Un partecipante a un corso è membro del workspace ma non un collaboratore:
  // le funzioni fuori dalla Formazione non sono per lui.
  if (!access || (isLearnerOnly(access.role) && !opts.allowLearner)) {
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
 */
export async function requireWorkspacePage(
  workspaceId: string,
  opts: { allowLearner?: boolean } = {}
): Promise<{ session: Session; access: WorkspaceAccess }> {
  const session = await requireSession();
  const access = await getWorkspaceAccessForUser(session.user.id, workspaceId);
  if (!access) notFound();
  if (isLearnerOnly(access.role) && !opts.allowLearner) {
    redirect(learnerHomePath(workspaceId));
  }
  return { session, access };
}
