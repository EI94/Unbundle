import type { Session } from "@/lib/auth";
import { requireSession } from "@/lib/auth/redirect-to-login";
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
  workspaceId: string
): Promise<{ session: Session; access: WorkspaceAccess }> {
  const session = await requireSession();
  const userId = session.user?.id;
  if (!userId) throw new Error("Sessione non valida.");

  const access = await getWorkspaceAccessForUser(userId, workspaceId);
  if (!access) throw new Error("Workspace non trovato o non accessibile.");

  return { session, access };
}
