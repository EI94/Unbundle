import { sql } from "drizzle-orm";
import { db } from "..";
import { ensureDbSchema } from "../ensure-schema";
import { READINESS_SIGNAL_ENTITY, READINESS_SIGNAL_TYPES } from "@/lib/ai-readiness/notify";
import { readinessBellPlan, type ReadinessBellPlan } from "@/lib/ai-readiness/notify-plan";
import { logSafeError } from "@/lib/log/safe-error";

/**
 * Le righe dell'AI Readiness in campanella (rilascio 10, ondata 7b; `src/lib/ai-readiness/notify.ts` e `notify-plan.ts`), in
 * `weekly_signals`, senza tabelle nuove:
 * - le risposte: un `INSERT … ON CONFLICT (id) DO UPDATE` sulla riga fissa della rilevazione, che prende il numero di
 *   adesso, torna in cima (`created_at = now()`) e torna non letta per tutti (via le letture di `weekly_signal_reads`);
 * - la soglia: un `INSERT … ON CONFLICT (id) DO NOTHING`, una volta sola per rilevazione.
 * Chi le vede lo decide `signals.ts` (solo chi gestisce il workspace).
 */
export async function writeReadinessBell(i: { workspaceId: string; assessmentId: string; plan: ReadinessBellPlan }): Promise<void> {
  const { answers, threshold } = i.plan;
  if (!answers && !threshold) return;
  await ensureDbSchema();
  if (answers) {
    await db.execute(sql`WITH s AS (
  INSERT INTO weekly_signals (id, workspace_id, signal_type, title, description, related_entity_type, related_entity_id, is_read, created_at)
  VALUES (${answers.id}::uuid, ${i.workspaceId}::uuid, ${answers.type}, left(${answers.title}, 500), ${answers.description}, ${READINESS_SIGNAL_ENTITY}, ${i.assessmentId}::uuid, false, now())
  ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, is_read = false, created_at = now()
  WHERE weekly_signals.workspace_id = EXCLUDED.workspace_id AND weekly_signals.signal_type = EXCLUDED.signal_type
  RETURNING id
)
DELETE FROM weekly_signal_reads r USING s WHERE r.signal_id = s.id`);
  }
  if (threshold) {
    await db.execute(sql`INSERT INTO weekly_signals (id, workspace_id, signal_type, title, description, related_entity_type, related_entity_id, is_read, created_at)
  VALUES (${threshold.id}::uuid, ${i.workspaceId}::uuid, ${threshold.type}, left(${threshold.title}, 500), ${threshold.description}, ${READINESS_SIGNAL_ENTITY}, ${i.assessmentId}::uuid, false, now())
  ON CONFLICT (id) DO NOTHING`);
  }
}

/** Dopo un questionario inviato: la campanella di chi gestisce. Mai un errore per chi ha risposto: si scrive nel log. */
export async function notifyReadinessResponse(i: { workspaceId: string; assessmentId: string; name: string; responses: number; expected: number | null; threshold: number }): Promise<void> {
  try {
    await writeReadinessBell({ workspaceId: i.workspaceId, assessmentId: i.assessmentId, plan: readinessBellPlan(i) });
  } catch (error) {
    logSafeError("ai-readiness", "bell_failed", error, { assessmentId: i.assessmentId });
  }
}

/** Una rilevazione eliminata porta via le sue righe in campanella (e, in cascata, le letture). */
export async function deleteReadinessBell(i: { workspaceId: string; assessmentId: string }): Promise<void> {
  await ensureDbSchema();
  await db.execute(sql`DELETE FROM weekly_signals
WHERE workspace_id = ${i.workspaceId}::uuid AND related_entity_type = ${READINESS_SIGNAL_ENTITY} AND related_entity_id = ${i.assessmentId}::uuid
  AND signal_type = ANY(${`{${READINESS_SIGNAL_TYPES.join(",")}}`}::text[])`);
}
