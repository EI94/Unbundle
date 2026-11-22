import { eq, desc, and, notInArray, sql, getTableColumns, type SQL } from "drizzle-orm";
import { db } from "..";
import { weeklySignals } from "../schema";
import { ensureDbSchema } from "../ensure-schema";
import { canManageWorkspaceSettings, canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";
import type { BellSignalInput } from "@/lib/notifications/bell";
import { READINESS_SIGNAL_TYPES } from "@/lib/ai-readiness/notify";

/**
 * I segnali delle schede: `new_portfolio_item` porta il titolo e 220 caratteri del
 * problema di una proposta, `use_case_digest` e `use_case_quarter` i riepiloghi
 * dell'area. Li vedono solo i revisori, in campanella e in Intelligence, in tutti i
 * workspace (D4, docs/use-case/DESIGN.md §11).
 *
 * **Letto per persona** (SPEC §P2.4): un segnale è letto per U quando `is_read = true` (letto per
 * tutti: le righe di prima e i riepiloghi ritirati dal digest) **oppure** c'è una riga
 * `weekly_signal_reads` (segnale, U). Nessuna scrittura dell'applicazione mette più `is_read = true`
 * per una persona sola: il clic di un revisore non spegne il segnale ai colleghi.
 */
export const USE_CASE_SIGNAL_TYPES = ["new_portfolio_item", "use_case_digest", "use_case_quarter"] as const;

/**
 * (Rilascio 10, ondata 7b) Le righe dell'AI Readiness (`src/lib/ai-readiness/notify.ts`): risposte nuove e soglia dei
 * risultati di una rilevazione. Le vede solo chi gestisce la rilevazione, cioè chi gestisce il workspace.
 */
export const MANAGER_SIGNAL_TYPES: readonly string[] = READINESS_SIGNAL_TYPES;

/** I tipi che `role` non vede: quelli delle schede a chi non valuta, quelli dell'AI Readiness a chi non gestisce. */
export function hiddenSignalTypes(role: string | null | undefined): string[] {
  return [...(canReviewWorkspacePortfolio(role) ? [] : USE_CASE_SIGNAL_TYPES), ...(canManageWorkspaceSettings(role) ? [] : MANAGER_SIGNAL_TYPES)];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * I segnali del workspace che `role` può vedere. I revisori tutti quelli delle schede; chiunque altro, anche senza
 * ruolo, senza i segnali delle schede. (Ondata 7b) Quelli dell'AI Readiness solo chi gestisce il workspace.
 */
function visibleTo(workspaceId: string, role: string | null | undefined) {
  const ofWorkspace = eq(weeklySignals.workspaceId, workspaceId);
  const hidden = hiddenSignalTypes(role);
  return hidden.length ? and(ofWorkspace, notInArray(weeklySignals.signalType, hidden)) : ofWorkspace;
}

/** Letto per `userId` (o, senza persona, il solo `is_read` di sempre). */
function readFor(userId: string | null): SQL<boolean> {
  if (!userId || !UUID.test(userId)) return sql<boolean>`${weeklySignals.isRead}`;
  return sql<boolean>`(${weeklySignals.isRead} OR EXISTS (SELECT 1 FROM weekly_signal_reads r WHERE r.signal_id = ${weeklySignals.id} AND r.user_id = ${userId}::uuid))`;
}

function unreadFor(userId: string | null): SQL {
  if (!userId || !UUID.test(userId)) return sql`NOT ${weeklySignals.isRead}`;
  return sql`(NOT ${weeklySignals.isRead} AND NOT EXISTS (SELECT 1 FROM weekly_signal_reads r WHERE r.signal_id = ${weeklySignals.id} AND r.user_id = ${userId}::uuid))`;
}

/**
 * Gli ultimi segnali per Intelligence, filtrati per il ruolo di chi guarda. Con `userId`, `isRead`
 * è quello della persona; senza, l'`is_read` grezzo (test e chiamanti di prima).
 */
export async function getSignalsByWorkspace(workspaceId: string, limit = 50, role: string | null = null, userId: string | null = null) {
  await ensureDbSchema();
  return db
    .select({ ...getTableColumns(weeklySignals), isRead: readFor(userId).mapWith(Boolean) })
    .from(weeklySignals)
    .where(visibleTo(workspaceId, role))
    .orderBy(desc(weeklySignals.createdAt))
    .limit(limit);
}

/** I segnali non letti (dalla persona, con `userId`), filtrati per il ruolo come `getSignalsByWorkspace`. */
export async function getUnreadSignals(workspaceId: string, role: string | null = null, userId: string | null = null) {
  await ensureDbSchema();
  return db
    .select({ ...getTableColumns(weeklySignals), isRead: sql<boolean>`false`.mapWith(Boolean) })
    .from(weeklySignals)
    .where(and(visibleTo(workspaceId, role), unreadFor(userId)))
    .orderBy(desc(weeklySignals.createdAt));
}

/**
 * I segnali della campanella: `created_at` letto come UTC e troncato ai millisecondi (la colonna è
 * un `timestamp` senza fuso, scritto con il `TimeZone` del database, UTC su Neon).
 */
export async function getSignalsForBell(i: { workspaceId: string; role: string | null; userId: string | null; limit: number }): Promise<BellSignalInput[]> {
  await ensureDbSchema();
  const rows = await db
    .select({
      id: weeklySignals.id,
      title: weeklySignals.title,
      description: weeklySignals.description,
      signalType: weeklySignals.signalType,
      relatedEntityType: weeklySignals.relatedEntityType,
      relatedEntityId: weeklySignals.relatedEntityId,
      createdAt: sql<string>`to_char(date_trunc('milliseconds', ${weeklySignals.createdAt}), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
      read: readFor(i.userId).mapWith(Boolean),
    })
    .from(weeklySignals)
    .where(visibleTo(i.workspaceId, i.role))
    .orderBy(desc(weeklySignals.createdAt), desc(weeklySignals.id))
    .limit(Math.max(1, Math.min(100, i.limit)));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description ?? null,
    signalType: r.signalType,
    relatedEntityType: r.relatedEntityType ?? null,
    relatedEntityId: r.relatedEntityId ?? null,
    createdAt: r.createdAt,
    read: Boolean(r.read),
  }));
}

/**
 * Segna letti per `userId` soltanto: gli id indicati, oppure (null) ogni segnale visibile ancora
 * non letto, creato fino a `upTo` quando c'è (`least(upTo, now())`). Solo i segnali che il ruolo
 * vede: un id indovinato di un altro workspace o di un tipo nascosto non scrive niente.
 * Restituisce le righe scritte.
 */
export async function markSignalsReadForUser(i: { workspaceId: string; userId: string; role: string | null; signalIds: readonly string[] | null; upTo?: Date | null }): Promise<number> {
  if (!UUID.test(i.workspaceId) || !UUID.test(i.userId)) return 0;
  const ids = i.signalIds === null ? null : [...new Set(i.signalIds.filter((x) => UUID.test(x)).map((x) => x.toLowerCase()))];
  if (ids !== null && ids.length === 0) return 0;
  await ensureDbSchema();
  const hiddenTypes = hiddenSignalTypes(i.role);
  const hidden = hiddenTypes.length ? sql` AND s.signal_type <> ALL(${`{${hiddenTypes.join(",")}}`}::text[])` : sql``;
  const only = ids === null ? sql`` : sql` AND s.id = ANY(${`{${ids.join(",")}}`}::uuid[])`;
  const upTo =
    i.upTo instanceof Date && !Number.isNaN(i.upTo.getTime())
      ? sql` AND date_trunc('milliseconds', s.created_at AT TIME ZONE 'UTC') <= least(${i.upTo.toISOString()}::timestamptz, now())`
      : sql``;
  const { rows } = await db.execute(sql`INSERT INTO weekly_signal_reads (signal_id, user_id, workspace_id)
SELECT s.id, ${i.userId}::uuid, s.workspace_id FROM weekly_signals s
WHERE s.workspace_id = ${i.workspaceId}::uuid AND NOT s.is_read${hidden}${only}${upTo}
ON CONFLICT (signal_id, user_id) DO NOTHING
RETURNING signal_id`);
  return rows.length;
}
