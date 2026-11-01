import "server-only";
import { getAppUcExecutor, runUcBatch, type UcExecutor, type UcRow } from "@/lib/db/uc-executor";
import { CASE_ALERTS_TABLES_PRESENT_SQL, type CaseAlertKind } from "@/lib/db/use-case-hub-alerts-ddl";
import { NOTIFICATION_RETENTION_DAYS } from "@/lib/db/use-case-hub-referents-ddl";
import { loadSubprocessorAck } from "@/lib/db/queries/uc-subprocessors";
import { logSafeError } from "@/lib/log/safe-error";
import { inRomeSendWindow } from "@/lib/uc/calendar";
import { isLateralSpaceEmail, parseLsDomains } from "@/lib/uc/lateral-space";
import { RETRY_DELAY_MINUTES, type DispatchEnv, type UcMailer } from "@/lib/uc/notify/dispatch";
import { rowBool, rowDate, rowNumber, rowString } from "@/lib/uc/sql/readiness";
import { cast, raw, toStatement, ucSql, type UcStatement } from "@/lib/uc/sql/statement";
import { cardSyncStatements, readyNowSql, type ReadinessSync } from "@/lib/use-cases/case-alerts/sql";
import {
  runCaseAlertDispatch,
  type CaseAlertFacts,
  type CaseAlertStore,
  type CaseAlertSummary,
  type ClaimedCaseAlert,
} from "@/lib/use-cases/case-alerts/email";
import { readyNoticesEnabled } from "@/lib/use-cases/client-notices";
import { alertSchedule, isStaleAlert } from "@/lib/use-cases/referent/alerts";
import { hubWorkspacesAmong } from "@/lib/use-cases/rollout";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";

/**
 * «Pronto da avviare» (drizzle/0025) sul database: se le tabelle ci sono, quello che serve alle
 * scritture per il controllo nello stesso batch (`readinessSyncFor`), il controllo di sicurezza del
 * cron (`syncReadyCards`) e la coda delle email (`dispatchCaseAlerts`).
 *
 * - **Senza la 0025** (non ancora applicata, self-heal fallito) nessuno statement nuovo entra nei
 *   batch: una riga `pronto` violerebbe il CHECK di prima e annullerebbe la scrittura della persona.
 * - **Chi le riceve**: solo i revisori di Lateral Space del workspace, mai chi ha agito.
 * - **Niente testi**: codici, date e id. Codice e titolo dello use case si leggono all'invio.
 * - Art. 15.4: nessun ordinamento, conteggio o raggruppamento per persona.
 */

type Env = Readonly<Record<string, string | undefined>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

// Questo modulo lo importano anche `service.ts` e `needs-service.ts`: niente import dei moduli di
// «Chiedi al referente» che importano il servizio (un giro di import), solo i moduli uc.
const lsDomainsOf = (env: Env) => parseLsDomains(env.UC_LS_EMAIL_DOMAINS);

/** Una riga di log: solo l'operazione, il codice, lo SQLSTATE e l'uuid del workspace. */
function logAlertError(op: string, error: unknown, ids: { workspaceId?: string } = {}): void {
  logSafeError("use-case.avvisi", `${op}_failed`, error, ids.workspaceId && isUuid(ids.workspaceId) ? { workspaceId: ids.workspaceId } : {});
}

// ─── Le tabelle ci sono ──────────────────────────────────────────────

let storeReady = false;
let dossiersPresent: boolean | null = null;

/**
 * Le tabelle della 0025 ci sono e il CHECK dei tipi ammette i due avvisi. Il risultato positivo si
 * tiene per tutto il processo; un errore conta come «no» (la scrittura della persona va avanti).
 */
export async function caseAlertsStoreReady(executor?: UcExecutor): Promise<boolean> {
  if (storeReady) return true;
  try {
    const run = executor ?? (await getAppUcExecutor());
    const [[row]] = await run.batch([toStatement(raw(CASE_ALERTS_TABLES_PRESENT_SQL))]);
    storeReady = rowBool(row?.ok);
  } catch (error) {
    logAlertError("archivi", error);
    return false;
  }
  return storeReady;
}

/** `uc_cases` c'è: uno use case con un dossier completo collegato non è pronto. Una volta per processo. */
async function dossierTablesPresent(executor: UcExecutor): Promise<boolean> {
  if (dossiersPresent !== null) return dossiersPresent;
  const [[row]] = await executor.batch([toStatement(ucSql`SELECT to_regclass('public.uc_cases') IS NOT NULL AS ok`)]);
  dossiersPresent = rowBool(row?.ok);
  return dossiersPresent;
}

/**
 * Quello che serve a una scrittura per il controllo di «Pronto da avviare» nello stesso batch, oppure
 * null: area spenta per il workspace, un'anteprima di Vercel, la 0025 assente. Non lancia mai.
 */
export async function readinessSyncFor(workspaceId: string, env: Env = process.env, now: Date = new Date()): Promise<ReadinessSync | null> {
  if (!isUuid(workspaceId) || !readyNoticesEnabled(workspaceId, env)) return null;
  try {
    const executor = await getAppUcExecutor();
    if (!(await caseAlertsStoreReady(executor))) return null;
    return { lsDomains: lsDomainsOf(env), dossiers: await dossierTablesPresent(executor), schedule: alertSchedule(now), now };
  } catch (error) {
    logAlertError("contesto", error, { workspaceId });
    return null;
  }
}

/** L'errore l'ha dato il database (uno SQLSTATE): la transazione è stata annullata per intero. */
export function rejectedByDatabase(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && typeof current === "object" && depth < 4; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * La scrittura della persona non cade mai per «Pronto da avviare»: se il batch con il controllo è
 * rifiutato dal database (niente è scritto), si rifà la sola scrittura come prima della 0025 e il
 * passaggio lo vede il prossimo giro del cron. Un errore di rete (esito incerto) si rilancia com'è.
 */
export async function withReadinessFallback<T>(workspaceId: string, withSync: () => Promise<T>, without: () => Promise<T>): Promise<T> {
  try {
    return await withSync();
  } catch (error) {
    if (!rejectedByDatabase(error)) throw error;
    logAlertError("controllo_saltato", error, { workspaceId });
    return without();
  }
}

// ─── Il controllo di sicurezza del cron ──────────────────────────────

const CRON_CHUNK = 50;

/**
 * Il cron dei giorni feriali: ogni use case approvato e ogni stato «pronto» salvato, dei workspace con
 * l'area accesa, si ricontrolla contro la regola (un trimestre passato, un dossier collegato dai
 * dossier, una modifica fatta fuori dall'app) e annuncia i passaggi che nessuna scrittura ha visto.
 * Confronta con lo stato salvato: niente doppioni, anche con due giri. Restituisce quante schede sono
 * diventate pronte e quanti batch sono falliti.
 */
export async function syncReadyCards(o: { env: Env; now: Date }): Promise<{ announced: number; errors: number }> {
  const out = { announced: 0, errors: 0 };
  const executor = await getAppUcExecutor();
  if (!(await caseAlertsStoreReady(executor))) return out;
  const dossiers = await dossierTablesPresent(executor);
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT u.id, u.workspace_id FROM use_cases u WHERE u.status = 'accepted'
UNION SELECT s.use_case_id, s.workspace_id FROM use_case_ready_state s WHERE s.ready_since IS NOT NULL`),
  ]);
  const byWorkspace = new Map<string, string[]>();
  for (const r of rows) {
    const ws = String(r.workspace_id).toLowerCase();
    byWorkspace.set(ws, [...(byWorkspace.get(ws) ?? []), String(r.id).toLowerCase()]);
  }
  const readiness: ReadinessSync = { lsDomains: lsDomainsOf(o.env), dossiers, schedule: alertSchedule(o.now), now: o.now };
  for (const workspaceId of hubWorkspacesAmong([...byWorkspace.keys()].sort(), o.env)) {
    if (!readyNoticesEnabled(workspaceId, o.env)) continue;
    const cards = [...new Set(byWorkspace.get(workspaceId) ?? [])].sort();
    for (let at = 0; at < cards.length; at += CRON_CHUNK) {
      const statements = cardSyncStatements({ workspaceId, useCaseIds: cards.slice(at, at + CRON_CHUNK), actorUserId: null, readiness, info: false });
      try {
        const run = await runUcBatch(executor, statements);
        if (!run.ok) {
          out.errors++;
          continue;
        }
        out.announced += rowNumber(run.rows[1]?.[0]?.announced) ?? 0;
      } catch (error) {
        out.errors++;
        logAlertError("cron_pronti", error, { workspaceId });
      }
    }
  }
  return out;
}

// ─── Coda delle email: lo store del motore ───────────────────────────

const LEASE_MINUTES = 5;
const CODE = /^[a-z0-9_]{1,60}$/;
const code = (value: string) => (CODE.test(value) ? value : "errore_invio");
const KINDS: readonly CaseAlertKind[] = ["pronto", "fornitori"];

function claimedOf(r: UcRow): ClaimedCaseAlert | null {
  const id = rowString(r.id);
  const workspaceId = rowString(r.workspace_id);
  const recipientUserId = rowString(r.recipient_user_id);
  const kind = rowString(r.kind) as CaseAlertKind | null;
  const scheduledAt = rowDate(r.scheduled_at);
  const dueAt = rowDate(r.due_at);
  const sendOn = rowString(r.send_on);
  if (!id || !workspaceId || !recipientUserId || !kind || !KINDS.includes(kind) || !scheduledAt || !dueAt || !sendOn) return null;
  return { id, workspaceId, recipientUserId, kind, sendOn: sendOn.slice(0, 10), scheduledAt, dueAt, attempts: rowNumber(r.attempts) ?? 0 };
}

/** Lo store degli avvisi della 0025 sul database. */
export function createCaseAlertStore(executor: UcExecutor, o: { env: DispatchEnv; now: Date }): CaseAlertStore {
  const one = async (statement: UcStatement) => {
    await executor.batch([statement]);
  };
  const env = o.env as Env;
  return {
    async holdUnconfigured() {
      const [rows] = await executor.batch([
        toStatement(ucSql`UPDATE use_case_alert_emails SET hold_reason = 'email_non_configurata', lease_until = NULL, updated_at = now()
WHERE status IN ('in_coda', 'errore') AND hold_reason IS DISTINCT FROM 'email_non_configurata'
RETURNING id`),
      ]);
      return rows.length;
    },
    async cancelStale(now) {
      const [pending] = await executor.batch([
        toStatement(ucSql`SELECT id, due_at FROM use_case_alert_emails WHERE status IN ('in_coda', 'errore') ORDER BY due_at, id LIMIT 500`),
      ]);
      const stale = pending.filter((r) => {
        const dueAt = rowDate(r.due_at);
        return dueAt !== null && isStaleAlert(dueAt, now);
      });
      if (stale.length === 0) return 0;
      const [rows] = await executor.batch([
        toStatement(ucSql`UPDATE use_case_alert_emails SET status = 'annullata', cancel_reason = 'troppo_vecchia', lease_until = NULL, updated_at = now()
WHERE id = ANY(${cast(stale.map((r) => String(r.id)), "uuid[]")}) AND status IN ('in_coda', 'errore')
RETURNING id`),
      ]);
      return rows.length;
    },
    async claimDue(i) {
      if (!inRomeSendWindow(i.now)) return [];
      const now = cast(i.now.toISOString(), "timestamptz");
      const [rows] = await executor.batch([
        toStatement(ucSql`WITH c AS (
  SELECT id FROM use_case_alert_emails
  WHERE (status = 'in_coda' OR (status = 'errore' AND attempts < 3)) AND scheduled_at <= ${now}
    AND (lease_until IS NULL OR lease_until <= ${now})
  ORDER BY scheduled_at, id
  LIMIT ${cast(i.limit, "int")}
  FOR UPDATE SKIP LOCKED
)
UPDATE use_case_alert_emails e SET lease_until = ${now} + make_interval(mins => ${cast(LEASE_MINUTES, "int")}), updated_at = now()
FROM c WHERE e.id = c.id
RETURNING e.id, e.workspace_id, e.recipient_user_id, e.kind, e.send_on::text AS send_on, e.scheduled_at, e.due_at, e.attempts`),
      ]);
      return rows.map(claimedOf).filter((x): x is ClaimedCaseAlert => x !== null);
    },
    async loadFacts(e) {
      const ws = cast(e.workspaceId, "uuid");
      const dossiers = await dossierTablesPresent(executor);
      const [[head], items] = await executor.batch([
        toStatement(ucSql`SELECT w.name AS company, lower(u.email) AS email, u.email_verified IS NOT NULL AS verified,
  coalesce(
    (SELECT m.role::text FROM memberships m WHERE m.user_id = u.id AND m.organization_id = w.organization_id LIMIT 1),
    (SELECT wm.role::text FROM workspace_memberships wm WHERE wm.user_id = u.id AND wm.workspace_id = w.id LIMIT 1)
  ) AS role,
  u.id AS user_id
FROM workspaces w LEFT JOIN users u ON u.id = ${cast(e.recipientUserId, "uuid")}
WHERE w.id = ${ws}`),
        toStatement(ucSql`SELECT i.use_case_id, c.code, c.title, c.target_quarter, ${readyNowSql("c", { dossiers })} AS still_ready,
  EXISTS (SELECT 1 FROM use_case_notifications n
          WHERE n.recipient_user_id = ${cast(e.recipientUserId, "uuid")} AND n.workspace_id = i.workspace_id AND n.use_case_id = i.use_case_id
            AND n.kind = 'pronto' AND n.read_at IS NULL) AS unread
FROM use_case_alert_email_items i
JOIN use_cases c ON c.id = i.use_case_id AND c.workspace_id = i.workspace_id
WHERE i.email_id = ${cast(e.id, "uuid")} AND i.workspace_id = ${ws}
ORDER BY i.ready_since, i.use_case_id`),
      ]);
      const ack = await loadSubprocessorAck(executor, e.workspaceId).catch(() => null);
      const email = rowString(head?.email);
      const verified = rowBool(head?.verified);
      const facts: CaseAlertFacts = {
        company: rowString(head?.company) ?? "",
        readyNoticesOn: readyNoticesEnabled(e.workspaceId, env),
        subprocessorsAuthorized: ack !== null,
        recipient:
          head && rowString(head.user_id)
            ? { email, verified, lateralSpace: isLateralSpaceEmail({ email, emailVerified: verified }, lsDomainsOf(env)), reviewer: canReviewWorkspacePortfolio(rowString(head.role)) }
            : null,
        items: items.flatMap((r) => {
          const useCaseId = rowString(r.use_case_id);
          if (!useCaseId) return [];
          return [{ useCaseId, code: rowString(r.code), title: rowString(r.title) ?? "", quarter: rowString(r.target_quarter), stillReady: rowBool(r.still_ready), unread: rowBool(r.unread) }];
        }),
      };
      return facts;
    },
    async markSent(e) {
      await one(
        toStatement(ucSql`UPDATE use_case_alert_emails SET status = 'inviata', sent_at = now(), lease_until = NULL, hold_reason = NULL, updated_at = now()
WHERE id = ${cast(e.id, "uuid")} AND status IN ('in_coda', 'errore')`),
      );
    },
    async markFailed(e, failure) {
      await one(
        toStatement(ucSql`UPDATE use_case_alert_emails SET status = 'errore', attempts = least(3, attempts + 1), last_error_code = ${cast(code(failure), "text")},
  scheduled_at = scheduled_at + make_interval(mins => ${cast(RETRY_DELAY_MINUTES, "int")}), lease_until = NULL, updated_at = now()
WHERE id = ${cast(e.id, "uuid")} AND status IN ('in_coda', 'errore')`),
      );
    },
    async markHeld(e, reason) {
      await one(
        toStatement(ucSql`UPDATE use_case_alert_emails SET hold_reason = ${cast(code(reason), "text")}, lease_until = NULL, updated_at = now()
WHERE id = ${cast(e.id, "uuid")} AND status IN ('in_coda', 'errore')`),
      );
    },
    async markCancelled(e, reason) {
      await one(
        toStatement(ucSql`UPDATE use_case_alert_emails SET status = 'annullata', cancel_reason = ${cast(code(reason), "text")}, lease_until = NULL, updated_at = now()
WHERE id = ${cast(e.id, "uuid")} AND status IN ('in_coda', 'errore')`),
      );
    },
  };
}

const ZERO: CaseAlertSummary = { sent: 0, failed: 0, held: 0, cancelled: 0, notConfigured: 0 };

/**
 * Un giro di invio degli avvisi della 0025 (solo dal cron dei giorni feriali; la campanella è subito).
 * Zeri in un'anteprima di Vercel o senza la 0025.
 */
export async function dispatchCaseAlerts(o: { limit?: number; env?: DispatchEnv; now?: Date; mailer?: UcMailer; sendIntervalMs?: number } = {}): Promise<CaseAlertSummary> {
  const env = o.env ?? (process.env as DispatchEnv);
  if (env.VERCEL_ENV === "preview") return { ...ZERO };
  const now = o.now ?? new Date();
  const executor = await getAppUcExecutor();
  if (!(await caseAlertsStoreReady(executor))) return { ...ZERO };
  return runCaseAlertDispatch(createCaseAlertStore(executor, { env, now }), { env, now, limit: o.limit, mailer: o.mailer, sendIntervalMs: o.sendIntervalMs });
}

/** Le email degli avvisi più vecchie di 90 giorni, finite (cron, con le notifiche vecchie). */
export async function purgeOldCaseAlerts(now: Date): Promise<number> {
  const executor = await getAppUcExecutor();
  if (!(await caseAlertsStoreReady(executor))) return 0;
  const limit = cast(new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * 86_400_000).toISOString(), "timestamptz");
  const [rows] = await executor.batch([
    toStatement(ucSql`DELETE FROM use_case_alert_emails WHERE created_at < ${limit} AND status IN ('inviata', 'annullata', 'errore') RETURNING id`),
  ]);
  return rows.length;
}
