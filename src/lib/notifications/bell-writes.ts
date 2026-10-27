import "server-only";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { markBellSeen } from "@/lib/db/queries/bell-state";
import { markSignalsReadForUser } from "@/lib/db/queries/signals";
import { isUcEnabledFor } from "@/lib/db/queries/uc-access";
import { markUseCaseNotificationsRead } from "@/lib/db/queries/use-case-notifications";
import type { BellReadRef } from "./bell";

/**
 * Le due scritture frequenti della campanella (SPEC §P2.3.8): «l'ho aperta» e «ho aperto questa
 * riga», per la sola persona che chiama. Le usa la rotta POST `/api/workspaces/<ws>/bell`.
 */

export async function writeBellSeen(i: { workspaceId: string; userId: string }): Promise<Date> {
  return markBellSeen(i.workspaceId, i.userId);
}

/**
 * Una riga letta. Un segnale che il ruolo non vede, o un id di un altro workspace, non scrive niente
 * e risponde comunque «ok»; una riga di use case cresciuta dopo `at` resta non letta.
 */
export async function writeBellRead(i: { workspaceId: string; userId: string; role: string | null; ref: BellReadRef }): Promise<"ok" | "non_disponibile"> {
  const { ref } = i;
  if (ref.source === "use_case") {
    await markUseCaseNotificationsRead({ userId: i.userId, workspaceId: i.workspaceId, id: ref.id, at: new Date(ref.at) });
    return "ok";
  }
  if (ref.source === "segnale") {
    await markSignalsReadForUser({ workspaceId: i.workspaceId, userId: i.userId, role: i.role, signalIds: [ref.id] });
    return "ok";
  }
  // dossier: solo con la sezione accesa (la campanella mostra quelle righe con lo stesso controllo).
  if (!isUcEnabledFor(i.workspaceId)) return "non_disponibile";
  const { markBellRead } = await import("@/lib/db/queries/uc-notifications-dispatch");
  await markBellRead(await getAppUcExecutor(), { userId: i.userId, workspaceId: i.workspaceId, notificationId: ref.id });
  return "ok";
}
