import { eq, desc, and, notInArray } from "drizzle-orm";
import { db } from "..";
import { weeklySignals } from "../schema";
import { ensureDbSchema } from "../ensure-schema";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";

/**
 * I segnali delle schede: `new_portfolio_item` porta il titolo e 220 caratteri del
 * problema di una proposta, `use_case_digest` e `use_case_quarter` i riepiloghi
 * dell'area. Li vedono solo i revisori, in campanella e in Intelligence, in tutti i
 * workspace (D4, docs/use-case/DESIGN.md §11).
 */
export const USE_CASE_SIGNAL_TYPES = ["new_portfolio_item", "use_case_digest", "use_case_quarter"] as const;

/**
 * I segnali del workspace che `role` può vedere. I revisori tutti; chiunque altro, anche
 * senza ruolo, senza i segnali delle schede.
 */
function visibleTo(workspaceId: string, role: string | null | undefined) {
  const ofWorkspace = eq(weeklySignals.workspaceId, workspaceId);
  if (canReviewWorkspacePortfolio(role)) return ofWorkspace;
  return and(ofWorkspace, notInArray(weeklySignals.signalType, [...USE_CASE_SIGNAL_TYPES]));
}

/** Gli ultimi segnali per la campanella e Intelligence, filtrati per il ruolo di chi guarda. */
export async function getSignalsByWorkspace(
  workspaceId: string,
  limit = 50,
  role: string | null = null
) {
  await ensureDbSchema();
  return db
    .select()
    .from(weeklySignals)
    .where(visibleTo(workspaceId, role))
    .orderBy(desc(weeklySignals.createdAt))
    .limit(limit);
}

/** I segnali non letti, filtrati per il ruolo di chi guarda come `getSignalsByWorkspace`. */
export async function getUnreadSignals(workspaceId: string, role: string | null = null) {
  await ensureDbSchema();
  return db
    .select()
    .from(weeklySignals)
    .where(and(visibleTo(workspaceId, role), eq(weeklySignals.isRead, false)))
    .orderBy(desc(weeklySignals.createdAt));
}

/**
 * «Segna tutti letti» per chi guarda: solo i segnali che `role` può vedere. `is_read` è
 * uno per tutto il workspace: un contributore non deve spegnere ai revisori i segnali
 * delle schede, che non vede.
 */
export async function markAllVisibleSignalsRead(workspaceId: string, role: string | null) {
  await ensureDbSchema();
  await db
    .update(weeklySignals)
    .set({ isRead: true })
    .where(and(visibleTo(workspaceId, role), eq(weeklySignals.isRead, false)));
}

export async function markSignalRead(workspaceId: string, signalId: string) {
  await ensureDbSchema();
  await db
    .update(weeklySignals)
    .set({ isRead: true })
    .where(
      and(
        eq(weeklySignals.id, signalId),
        eq(weeklySignals.workspaceId, workspaceId)
      )
    );
}
