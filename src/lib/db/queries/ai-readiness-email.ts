import "server-only";
import { AIR_EMAIL_PROBE_SQL, AIR_EMAIL_KINDS, type AirEmailKind } from "@/lib/db/ai-readiness-email-ddl";
import { NOTIFICATION_RETENTION_DAYS } from "@/lib/db/use-case-hub-referents-ddl";
import { ensureDbSchema } from "@/lib/db/ensure-schema";
import { loadSubprocessorAck } from "@/lib/db/queries/uc-subprocessors";
import { getAppUcExecutor, type UcExecutor, type UcRow } from "@/lib/db/uc-executor";
import { expectedRespondentsOf } from "@/lib/ai-readiness/dashboard-view";
import { airEmailBlock, runAirEmailDispatch, type AirEmailFacts, type AirEmailStore, type AirEmailSummary, type ClaimedAirEmail } from "@/lib/ai-readiness/email";
import {
  airEmailFactsSql,
  airEmailMembersSql,
  airEmailSwitchSql,
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
import { romeDate, romeLocalToUtc } from "@/lib/uc/calendar";
import { isLateralSpaceEmail, parseLsDomains } from "@/lib/uc/lateral-space";
import type { DispatchEnv, UcMailer } from "@/lib/uc/notify/dispatch";
import { rowBool, rowDate, rowNumber, rowString } from "@/lib/uc/sql/readiness";
import { cast, raw, toStatement, ucSql } from "@/lib/uc/sql/statement";
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

/** L'ok del cliente sui sub-responsabili della versione di oggi; senza la tabella delle autorizzazioni, no. */
async function workspaceAckOf(executor: UcExecutor, workspaceId: string): Promise<boolean> {
  if (!acksPresent) {
    const [[row]] = await executor.batch([toStatement(ucSql`SELECT to_regclass('public.uc_subprocessor_acks') IS NOT NULL AS ok`)]);
    acksPresent = rowBool(row?.ok);
    if (!acksPresent) return false;
  }
  return (await loadSubprocessorAck(executor, workspaceId)) !== null;
}

const lsDomainsOf = (env: Env) => parseLsDomains(env.UC_LS_EMAIL_DOMAINS);

// ─── In coda, dopo un questionario inviato ───────────────────────────

/**
 * Le righe in coda dopo un questionario inviato: le risposte nuove per chi può riceverle adesso (chi gestisce il
 * workspace, con l'email verificata, la sua scelta accesa e, per il cliente, l'ok sui sub-responsabili) e, se questo
 * invio ha fatto nascere la riga della soglia in campanella (`resultsReady`), i risultati. Mai in un'anteprima di Vercel
 * (usa il database di produzione). Non lancia mai.
 */
export async function queueReadinessEmails(
  i: { workspaceId: string; assessmentId: string; submittedAt: Date; resultsReady: boolean },
  env: Env = process.env,
): Promise<void> {
  if (env.VERCEL_ENV === "preview" || !isUuid(i.workspaceId) || !isUuid(i.assessmentId)) return;
  try {
    const executor = await getAppUcExecutor();
    if (!(await airEmailStoreReady(executor))) return;
    const [members] = await executor.batch([airEmailMembersSql(i.workspaceId)]);
    const lsDomains = lsDomainsOf(env);
    let ack: boolean | null = null;
    const recipients: string[] = [];
    for (const m of members) {
      const userId = rowString(m.user_id);
      if (!userId || !rowBool(m.switch_on)) continue;
      const email = rowString(m.email);
      const verified = rowBool(m.verified);
      const lateralSpace = isLateralSpaceEmail({ email, emailVerified: verified }, lsDomains);
      // L'ok del cliente si legge una volta, e solo se serve.
      if (!lateralSpace && ack === null) ack = await workspaceAckOf(executor, i.workspaceId);
      if (airEmailBlock({ role: rowString(m.role), email, verified, lateralSpace }, ack === true) === null) recipients.push(userId);
    }
    const submittedAt = Number.isNaN(i.submittedAt.getTime()) ? new Date() : i.submittedAt;
    const statements = queueAirEmailStatements({ workspaceId: i.workspaceId, assessmentId: i.assessmentId, recipients, countsFrom: submittedAt, resultsReady: i.resultsReady });
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

/** La mezzanotte di oggi a Roma: un'email al giorno per rilevazione e persona si conta da qui. */
function romeDayStart(now: Date): Date {
  return romeLocalToUtc(romeDate(now), 0);
}

/** Lo store delle email dell'AI Readiness sul database. */
export function createAirEmailStore(executor: UcExecutor, o: { env: DispatchEnv }): AirEmailStore {
  const env = o.env as Env;
  const one = async (statement: ReturnType<typeof toStatement>) => {
    await executor.batch([statement]);
  };
  return {
    async holdUnconfigured() {
      const [rows] = await executor.batch([holdUnconfiguredAirEmailsSql()]);
      return rows.length;
    },
    async cancelStale(now) {
      const [interrupted] = await executor.batch([cancelInterruptedAirEmailsSql(now)]);
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
      const [, rows] = await executor.batch(claimAirEmailsStatements({ now: i.now, dayStart: romeDayStart(i.now), limit: i.limit }));
      return rows.map(claimedOf).filter((x): x is ClaimedAirEmail => x !== null);
    },
    async loadFacts(e) {
      const [[row]] = await executor.batch([airEmailFactsSql(e.id)]);
      const countedUntil = rowDate(row?.counted_until);
      if (!row || !countedUntil) throw new Error("Riga dell'email non trovata");
      const email = rowString(row.email);
      const verified = rowBool(row.verified);
      const lateralSpace = isLateralSpaceEmail({ email, emailVerified: verified }, lsDomainsOf(env));
      const assessmentId = rowString(row.assessment_id);
      const facts: AirEmailFacts = {
        company: rowString(row.company) ?? "",
        assessment: assessmentId
          ? { name: rowString(row.assessment_name) ?? "", expected: expectedRespondentsOf(row.scoring_config), threshold: rowNumber(row.aggregation_threshold) ?? 5 }
          : null,
        recipient: rowString(row.user_id) ? { role: rowString(row.role), email, verified, lateralSpace, switchOn: rowBool(row.switch_on) } : null,
        // L'ok si legge solo per una persona del cliente: Lateral Space non ne ha bisogno.
        workspaceAck: lateralSpace ? false : await workspaceAckOf(executor, e.workspaceId).catch(() => false),
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
  return runAirEmailDispatch(createAirEmailStore(executor, { env }), { env, now, limit: o.limit, mailer: o.mailer, sendIntervalMs: o.sendIntervalMs });
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
 * La scelta di chi guarda, solo se potrebbe ricevere le email dell'AI Readiness di questo workspace (chi gestisce, con
 * l'email verificata e, per il cliente, l'ok sui sub-responsabili): `{ on }`, oppure null (l'interruttore non si vede).
 * Senza la 0044, null. Non lancia mai.
 */
export async function readinessEmailChoice(i: {
  workspaceId: string;
  user: { id: string; email: string | null; emailVerified: boolean };
  role: string | null;
  env?: Env;
}): Promise<{ on: boolean } | null> {
  if (!isUuid(i.workspaceId) || !isUuid(i.user.id)) return null;
  const env = i.env ?? process.env;
  try {
    const executor = await getAppUcExecutor();
    if (!(await airEmailStoreReady(executor))) return null;
    const email = i.user.email?.trim().toLowerCase() ?? null;
    const verified = i.user.emailVerified === true;
    const lateralSpace = isLateralSpaceEmail({ email, emailVerified: verified }, lsDomainsOf(env));
    // Prima le regole che non leggono niente; l'ok del cliente solo per una persona del cliente che gestisce.
    if (airEmailBlock({ role: i.role, email, verified, lateralSpace }, true) !== null) return null;
    if (!lateralSpace && !(await workspaceAckOf(executor, i.workspaceId))) return null;
    const [[row]] = await executor.batch([airEmailSwitchSql(i.workspaceId, i.user.id)]);
    return { on: row?.switch_on !== false };
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
