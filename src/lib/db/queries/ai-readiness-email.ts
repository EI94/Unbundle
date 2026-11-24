import "server-only";
import { AIR_EMAIL_PROBE_SQL, AIR_EMAIL_KINDS, type AirEmailKind } from "@/lib/db/ai-readiness-email-ddl";
import { NOTIFICATION_RETENTION_DAYS } from "@/lib/db/use-case-hub-referents-ddl";
import { ensureDbSchema } from "@/lib/db/ensure-schema";
import { loadSubprocessorAck } from "@/lib/db/queries/uc-subprocessors";
import { getAppUcExecutor, type UcExecutor, type UcRow } from "@/lib/db/uc-executor";
import { expectedRespondentsOf } from "@/lib/ai-readiness/dashboard-view";
import { READINESS_THRESHOLD_SIGNAL } from "@/lib/ai-readiness/notify";
import { readinessSignalId } from "@/lib/ai-readiness/notify-plan";
import { airEmailBlock, runAirEmailDispatch, type AirEmailFacts, type AirEmailStore, type AirEmailSummary, type ClaimedAirEmail } from "@/lib/ai-readiness/email";
import {
  airEmailFactsSql,
  airEmailMembersSql,
  airEmailPersonSql,
  beginAirEmailAttemptSql,
  cancelInterruptedAirEmailsSql,
  cancelStaleAirEmailsSql,
  claimAirEmailsStatements,
  holdUnconfiguredAirEmailsSql,
  markAirEmailCancelledSql,
  markAirEmailFailedSql,
  markAirEmailHeldSql,
  markAirEmailRetrySql,
  markAirEmailSentStatements,
  markAirEmailUncertainSql,
  pendingAirEmailsSql,
  purgeAirEmailsSql,
  queueAirEmailStatements,
  setAirEmailSwitchSql,
} from "@/lib/ai-readiness/email-sql";
import { logSafeError } from "@/lib/log/safe-error";
import type { DispatchEnv, UcMailer } from "@/lib/uc/notify/dispatch";
import { rowBool, rowDate, rowNumber, rowString } from "@/lib/uc/sql/readiness";
import { cast, raw, toStatement, ucSql } from "@/lib/uc/sql/statement";
import { canManageWorkspaceSettings } from "@/lib/workspace-permissions";
import { isStaleAlert } from "@/lib/use-cases/referent/alerts";

/**
 * Le email dell'AI Readiness sul database (0044; le regole, i testi e il motore in `src/lib/ai-readiness/email.ts`, le
 * istruzioni in `email-sql.ts`):
 * - `queueReadinessEmails`: dopo un questionario inviato (in `after()`, dopo la campanella), le righe in coda per chi
 *   gestisce il workspace e può riceverle adesso;
 * - `dispatchReadinessEmails`: un giro di invio, solo dal cron dei giorni feriali (`use-case-referents`);
 * - `readinessEmailChoice` e `setReadinessEmails`: «Avvisami per email sull'AI Readiness» in «Il tuo account».
 * Senza la 0044 (non ancora applicata, self-heal fallito, un'anteprima) niente entra in coda e l'interruttore non si vede:
 * la campanella va avanti come prima. Mai un errore per chi ha risposto o per chi apre il suo account: si scrive nel log.
 */

type Env = Readonly<Record<string, string | undefined>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

function logAirEmailError(op: string, error: unknown, ids: { workspaceId?: string; assessmentId?: string } = {}): void {
  const safe: Record<string, string> = {};
  if (ids.workspaceId && isUuid(ids.workspaceId)) safe.workspaceId = ids.workspaceId;
  if (ids.assessmentId && isUuid(ids.assessmentId)) safe.assessmentId = ids.assessmentId;
  logSafeError("ai-readiness.email", `${op}_failed`, error, safe);
}

// ─── Le tabelle ci sono ──────────────────────────────────────────────

let storeReady = false;
let acksPresent = false;

/** La 0044 c'è tutta (la sonda): il risultato positivo si tiene per il processo; un errore conta come «no». */
export async function airEmailStoreReady(executor?: UcExecutor): Promise<boolean> {
  if (storeReady) return true;
  try {
    await ensureDbSchema();
    const run = executor ?? (await getAppUcExecutor());
    const [[row]] = await run.batch([toStatement(raw(`SELECT ${AIR_EMAIL_PROBE_SQL} AS ok`))]);
    storeReady = rowBool(row?.ok);
  } catch (error) {
    logAirEmailError("archivio", error);
    return false;
  }
  return storeReady;
}

/**
 * L'ok del cliente sui sub-responsabili della versione di oggi; senza la tabella delle autorizzazioni, no. Una lettura
 * mancata lancia: chi chiama riprova, mai la scambia per un «no».
 */
async function workspaceAckOf(executor: UcExecutor, workspaceId: string): Promise<boolean> {
  if (!acksPresent) {
    const [[row]] = await executor.batch([toStatement(ucSql`SELECT to_regclass('public.uc_subprocessor_acks') IS NOT NULL AS ok`)]);
    acksPresent = rowBool(row?.ok);
    if (!acksPresent) return false;
  }
  return (await loadSubprocessorAck(executor, workspaceId)) !== null;
}

// ─── In coda, dopo un questionario inviato ───────────────────────────

/**
 * Le righe in coda dopo un questionario inviato, solo con l'ok del cliente sui sub-responsabili (per tutti, Lateral
 * Space compreso), per chi può riceverle adesso (chi gestisce il workspace, con l'email verificata e la sua scelta
 * accesa): le risposte nuove e, finché c'è la riga della soglia in campanella, i risultati (una volta per persona:
 * l'indice unico). Mai in un'anteprima di Vercel (usa il database di produzione). Non lancia mai.
 */
export async function queueReadinessEmails(i: { workspaceId: string; assessmentId: string; submittedAt: Date }, env: Env = process.env): Promise<void> {
  if (env.VERCEL_ENV === "preview" || !isUuid(i.workspaceId) || !isUuid(i.assessmentId)) return;
  try {
    const executor = await getAppUcExecutor();
    if (!(await airEmailStoreReady(executor))) return;
    if (!(await workspaceAckOf(executor, i.workspaceId))) return;
    const [members] = await executor.batch([airEmailMembersSql(i.workspaceId)]);
    const recipients = members.flatMap((m) => {
      const userId = rowString(m.user_id);
      if (!userId || !rowBool(m.switch_on)) return [];
      return airEmailBlock({ role: rowString(m.role), email: rowString(m.email), verified: rowBool(m.verified) }) === null ? [userId] : [];
    });
    const submittedAt = Number.isNaN(i.submittedAt.getTime()) ? new Date() : i.submittedAt;
    const resultsSignalId = readinessSignalId(READINESS_THRESHOLD_SIGNAL, i.assessmentId);
    const statements = queueAirEmailStatements({ workspaceId: i.workspaceId, assessmentId: i.assessmentId, recipients, countsFrom: submittedAt, resultsSignalId });
    if (statements.length) await executor.batch(statements);
  } catch (error) {
    logAirEmailError("coda", error, i);
  }
}

// ─── Lo store del motore ─────────────────────────────────────────────

function claimedOf(r: UcRow): ClaimedAirEmail | null {
  const id = rowString(r.id);
  const workspaceId = rowString(r.workspace_id);
  const assessmentId = rowString(r.assessment_id);
  const recipientUserId = rowString(r.recipient_user_id);
  const kind = rowString(r.kind) as AirEmailKind | null;
  const scheduledAt = rowDate(r.scheduled_at);
  const createdAt = rowDate(r.created_at);
  if (!id || !workspaceId || !assessmentId || !recipientUserId || !kind || !AIR_EMAIL_KINDS.includes(kind) || !scheduledAt || !createdAt) return null;
  return { id, workspaceId, assessmentId, recipientUserId, kind, scheduledAt, createdAt, attempts: rowNumber(r.attempts) ?? 0 };
}

/** Lo store delle email dell'AI Readiness sul database. */
export function createAirEmailStore(executor: UcExecutor): AirEmailStore {
  const one = async (statement: ReturnType<typeof toStatement>) => {
    await executor.batch([statement]);
  };
  return {
    async holdUnconfigured() {
      const [rows] = await executor.batch([holdUnconfiguredAirEmailsSql()]);
      return rows.length;
    },
    async cancelStale(now) {
      const [interrupted] = await executor.batch([cancelInterruptedAirEmailsSql()]);
      const [pending] = await executor.batch([pendingAirEmailsSql()]);
      const stale = pending.flatMap((r) => {
        const createdAt = rowDate(r.created_at);
        const id = rowString(r.id);
        return id && createdAt && isStaleAlert(createdAt, now) ? [id] : [];
      });
      if (stale.length === 0) return interrupted.length;
      const [cancelled] = await executor.batch([cancelStaleAirEmailsSql(stale)]);
      return interrupted.length + cancelled.length;
    },
    async claimDue(i) {
      const [, rows] = await executor.batch(claimAirEmailsStatements({ now: i.now, limit: i.limit }));
      return rows.map(claimedOf).filter((x): x is ClaimedAirEmail => x !== null);
    },
    async loadFacts(e) {
      const [[row]] = await executor.batch([airEmailFactsSql(e.id)]);
      const countedUntil = rowDate(row?.counted_until);
      if (!row || !countedUntil) throw new Error("Riga dell'email non trovata");
      const assessmentId = rowString(row.assessment_id);
      const facts: AirEmailFacts = {
        company: rowString(row.company) ?? "",
        assessment: assessmentId
          ? { name: rowString(row.assessment_name) ?? "", expected: expectedRespondentsOf(row.scoring_config), threshold: rowNumber(row.aggregation_threshold) ?? 5 }
          : null,
        recipient: rowString(row.user_id) ? { role: rowString(row.role), email: rowString(row.email), verified: rowBool(row.verified), switchOn: rowBool(row.switch_on) } : null,
        // Per tutti, Lateral Space compreso. Una lettura mancata lancia: la riga si riprova, mai si annulla per questo.
        workspaceAck: await workspaceAckOf(executor, e.workspaceId),
        newAnswers: rowNumber(row.new_answers) ?? 0,
        total: rowNumber(row.total) ?? 0,
        countedUntil,
      };
      return facts;
    },
    async beginAttempt(e, countedUntil) {
      const [rows] = await executor.batch([beginAirEmailAttemptSql(e.id, countedUntil)]);
      return rows.length === 1 ? (rowNumber(rows[0].attempts) ?? null) : null;
    },
    async markSent(e) {
      await executor.batch(markAirEmailSentStatements(e.id));
    },
    async markFailed(e, code) {
      await one(markAirEmailFailedSql(e.id, code));
    },
    async markUncertain(e, code) {
      await one(markAirEmailUncertainSql(e.id, code));
    },
    async markRetry(e, code) {
      await one(markAirEmailRetrySql(e.id, code));
    },
    async markHeld(e, reason) {
      await one(markAirEmailHeldSql(e.id, reason));
    },
    async markCancelled(e, reason) {
      await one(markAirEmailCancelledSql(e.id, reason));
    },
  };
}

const ZERO: AirEmailSummary = { sent: 0, failed: 0, held: 0, cancelled: 0, notConfigured: 0 };

/**
 * Un giro di invio delle email dell'AI Readiness (solo dal cron dei giorni feriali; la campanella è subito). Zeri in
 * un'anteprima di Vercel o senza la 0044.
 */
export async function dispatchReadinessEmails(o: { limit?: number; env?: DispatchEnv; now?: Date; mailer?: UcMailer; sendIntervalMs?: number } = {}): Promise<AirEmailSummary> {
  const env = o.env ?? (process.env as DispatchEnv);
  if (env.VERCEL_ENV === "preview") return { ...ZERO };
  const now = o.now ?? new Date();
  const executor = await getAppUcExecutor();
  if (!(await airEmailStoreReady(executor))) return { ...ZERO };
  return runAirEmailDispatch(createAirEmailStore(executor), { env, now, limit: o.limit, mailer: o.mailer, sendIntervalMs: o.sendIntervalMs });
}

/** Le email dell'AI Readiness finite più vecchie di 90 giorni (cron, con le notifiche vecchie). */
export async function purgeOldReadinessEmails(now: Date): Promise<number> {
  const executor = await getAppUcExecutor();
  if (!(await airEmailStoreReady(executor))) return 0;
  const [rows] = await executor.batch([purgeAirEmailsSql(now, NOTIFICATION_RETENTION_DAYS)]);
  return rows.length;
}

// ─── Il link dell'email ──────────────────────────────────────────────

/** La rilevazione è di questo workspace (il link dell'email porta solo lì). */
export async function assessmentInWorkspace(workspaceId: string, assessmentId: string): Promise<boolean> {
  if (!isUuid(workspaceId) || !isUuid(assessmentId)) return false;
  await ensureDbSchema();
  const executor = await getAppUcExecutor();
  const [[row]] = await executor.batch([
    toStatement(ucSql`SELECT EXISTS (SELECT 1 FROM ai_readiness_assessments a WHERE a.id = ${cast(assessmentId, "uuid")} AND a.workspace_id = ${cast(workspaceId, "uuid")}) AS ok`),
  ]);
  return rowBool(row?.ok);
}

// ─── «Avvisami per email sull'AI Readiness» ──────────────────────────

/**
 * La scelta di chi guarda, solo se potrebbe ricevere le email dell'AI Readiness di questo workspace: chi gestisce, con
 * l'ok del cliente sui sub-responsabili e l'email verificata, letta in `users.email_verified` come la leggono la coda e
 * l'invio (mai la sessione). `{ on }`, oppure null (l'interruttore non si vede). Senza la 0044, null. Non lancia mai.
 */
export async function readinessEmailChoice(i: { workspaceId: string; userId: string; role: string | null }): Promise<{ on: boolean } | null> {
  if (!isUuid(i.workspaceId) || !isUuid(i.userId)) return null;
  // Prima la regola che non legge niente: solo chi gestisce (lo stesso permesso di `airEmailBlock`).
  if (!canManageWorkspaceSettings(i.role)) return null;
  try {
    const executor = await getAppUcExecutor();
    if (!(await airEmailStoreReady(executor))) return null;
    if (!(await workspaceAckOf(executor, i.workspaceId))) return null;
    const [[row]] = await executor.batch([airEmailPersonSql(i.workspaceId, i.userId)]);
    if (!row || airEmailBlock({ role: i.role, email: rowString(row.email), verified: rowBool(row.verified) }) !== null) return null;
    return { on: row.switch_on !== false };
  } catch (error) {
    logAirEmailError("scelta", error, { workspaceId: i.workspaceId });
    return null;
  }
}

/** Salva la scelta della persona e restituisce quella salvata. Senza la 0044 lancia: l'azione dice di riprovare. */
export async function setReadinessEmails(workspaceId: string, userId: string, on: boolean): Promise<boolean> {
  if (!isUuid(workspaceId) || !isUuid(userId) || typeof on !== "boolean") throw new Error("Dati non validi");
  const executor = await getAppUcExecutor();
  if (!(await airEmailStoreReady(executor))) throw new Error("Scelta non ancora disponibile");
  const [[row]] = await executor.batch([setAirEmailSwitchSql(workspaceId, userId, on)]);
  return row?.switch_on !== false;
}
