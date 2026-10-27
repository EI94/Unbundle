import "server-only";
import { sql } from "drizzle-orm";
import { db } from "..";
import { ensureDbSchema } from "../ensure-schema";

/**
 * Lo stato della campanella di una persona in un workspace (SPEC §P2.3.7): «visto fino a» e la
 * scelta sulle email delle richieste al referente. Solo l'orologio del database: mai un istante
 * mandato dal client, mai l'ora dell'applicazione.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function dateOf(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" && value) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export interface BellState {
  seenAt: Date | null;
  referentEmails: boolean;
  /** Un sì o un no su chi guarda: ha già chiesto almeno una volta a un referente in questo workspace. */
  hasRequested: boolean;
}

/**
 * Senza riga, «visto fino a» è l'inizio dell'iscrizione (le date delle iscrizioni sono `timestamp`
 * in UTC; `least` ignora i null): le righe di prima che la persona entrasse non sono mai «nuove».
 */
export async function getBellState(workspaceId: string, userId: string): Promise<BellState> {
  if (!UUID.test(workspaceId) || !UUID.test(userId)) return { seenAt: null, referentEmails: true, hasRequested: false };
  await ensureDbSchema();
  const { rows } = await db.execute(sql`SELECT
  coalesce(b.seen_at, (SELECT least(m.created_at, wm.created_at) AT TIME ZONE 'UTC'
     FROM workspaces w
     LEFT JOIN memberships m ON m.organization_id = w.organization_id AND m.user_id = ${userId}::uuid
     LEFT JOIN workspace_memberships wm ON wm.workspace_id = w.id AND wm.user_id = ${userId}::uuid
     WHERE w.id = ${workspaceId}::uuid)) AS seen_at,
  coalesce(b.referent_emails, true) AS referent_emails,
  to_regclass('public.use_case_referent_requests') IS NOT NULL AS requests_present
FROM (SELECT 1) x LEFT JOIN workspace_bell_state b ON b.workspace_id = ${workspaceId}::uuid AND b.user_id = ${userId}::uuid`);
  const row = (rows[0] ?? {}) as Record<string, unknown>;
  let hasRequested = false;
  if (row.requests_present === true) {
    const asked = await db.execute(sql`SELECT EXISTS (SELECT 1 FROM use_case_referent_requests r
  WHERE r.workspace_id = ${workspaceId}::uuid AND r.requested_by_user_id = ${userId}::uuid) AS has_requested`);
    hasRequested = (asked.rows[0] as Record<string, unknown> | undefined)?.has_requested === true;
  }
  return { seenAt: dateOf(row.seen_at), referentEmails: row.referent_emails !== false, hasRequested };
}

/** «Ho aperto la campanella»: `seen_at` non torna mai indietro. */
export async function markBellSeen(workspaceId: string, userId: string): Promise<Date> {
  if (!UUID.test(workspaceId) || !UUID.test(userId)) throw new Error("Dati non validi");
  await ensureDbSchema();
  const { rows } = await db.execute(sql`INSERT INTO workspace_bell_state (workspace_id, user_id, seen_at, updated_at)
VALUES (${workspaceId}::uuid, ${userId}::uuid, now(), now())
ON CONFLICT (workspace_id, user_id) DO UPDATE SET
  seen_at = greatest(coalesce(workspace_bell_state.seen_at, '-infinity'::timestamptz), EXCLUDED.seen_at), updated_at = now()
RETURNING seen_at`);
  const seen = dateOf((rows[0] as Record<string, unknown> | undefined)?.seen_at);
  if (!seen) throw new Error("seen_at mancante");
  return seen;
}

/** La scelta «Avvisami per email…» della persona. */
export async function setReferentEmails(workspaceId: string, userId: string, on: boolean): Promise<void> {
  if (!UUID.test(workspaceId) || !UUID.test(userId) || typeof on !== "boolean") throw new Error("Dati non validi");
  await ensureDbSchema();
  await db.execute(sql`INSERT INTO workspace_bell_state (workspace_id, user_id, referent_emails, updated_at)
VALUES (${workspaceId}::uuid, ${userId}::uuid, ${on}, now())
ON CONFLICT (workspace_id, user_id) DO UPDATE SET referent_emails = EXCLUDED.referent_emails, updated_at = now()`);
}
