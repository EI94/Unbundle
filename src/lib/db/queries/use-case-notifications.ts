import "server-only";
import { getAppUcExecutor, type UcExecutor, type UcRow } from "@/lib/db/uc-executor";
import { afterResponse } from "@/lib/db/queries/use-case-referent-base";
import { NOTIFICATION_RETENTION_DAYS, type FollowUpReason, type UseCaseNotificationKind } from "@/lib/db/use-case-hub-referents-ddl";
import { loadSubprocessorAck } from "@/lib/db/queries/uc-subprocessors";
import { RETRY_DELAY_MINUTES, type DispatchEnv, type UcMailer } from "@/lib/uc/notify/dispatch";
import { rowBool, rowDate, rowNumber, rowString } from "@/lib/uc/sql/readiness";
import { cast, raw, toStatement, ucSql, type UcStatement } from "@/lib/uc/sql/statement";
import { ucLogError } from "@/lib/uc/log";
import type { BellUseCaseInput } from "@/lib/notifications/bell";
import { referentAskEnabled } from "@/lib/use-cases/referent/availability";
import {
  isStaleAlert,
  runRequesterAlertDispatch,
  type AlertFacts,
  type ClaimedAlert,
  type RequesterAlertStore,
  type RequesterAlertSummary,
} from "@/lib/use-cases/referent/alerts";
import { inRomeSendWindow } from "@/lib/uc/calendar";
import { PORTFOLIO_REVIEWER_ROLES } from "@/lib/workspace-permissions";

/**
 * Le notifiche degli use case per i revisori e gli avvisi per email a chi ha chiesto (SPEC §P2.6,
 * §P2.7): i costruttori SQL che le scritture mettono **nello stesso batch** dell'evento che le
 * causa, la lettura per la campanella, la lettura «segna letta» e la coda delle email a chi ha
 * chiesto.
 *
 * - **Chi le riceve**: ogni persona con un ruolo da revisore nel workspace (prima il ruolo
 *   nell'organizzazione, poi quello nel workspace, come `getWorkspaceAccessForUser`), cioè chi vede
 *   «Cosa serve»; mai chi ha causato l'evento. Contributori e partecipanti ai corsi mai. Nessun
 *   ordinamento, conteggio o raggruppamento per persona.
 * - **Una riga per persona, use case, tipo e giorno di Roma**: gli eventi dello stesso giorno si
 *   sommano e la riga torna non letta; dopo una lettura conta solo le novità.
 * - **Niente testi**: solo codici, conteggi e date. Codice e titolo dello use case si leggono al
 *   momento.
 * - **Orologio**: `first_event_at`, `last_event_at` e il giorno usano `now()` del database (lo
 *   stesso di `seen_at`); `clock` esiste solo per i test.
 */

type Env = Readonly<Record<string, string | undefined>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

function uuid(value: string, what: string): string {
  if (!isUuid(value)) throw new Error(`Id non valido (${what})`);
  return value.toLowerCase();
}

const ROLES = () => cast([...PORTFOLIO_REVIEWER_ROLES], "text[]");

// I costruttori stanno nel modulo puro `referent/sql.ts` (li usa anche il comando dell'operatore):
// qui si riesportano con i nomi della SPEC.
export {
  infoCompleteSyncStatements,
  notifyExpiredRequestsSql,
  notifyReviewersSql,
  queueExpiredRequestAlertsSql,
  queueRequesterAlertSql,
  reviewerRecipientsSql,
} from "@/lib/use-cases/referent/sql";

// ─── Campanella ──────────────────────────────────────────────────────

async function tablePresent(executor: UcExecutor): Promise<boolean> {
  const [[row]] = await executor.batch([toStatement(ucSql`SELECT to_regclass('public.use_case_notifications') IS NOT NULL AS ok`)]);
  return rowBool(row?.ok);
}

/** Le righe della persona nel workspace, dalle più recenti, degli ultimi `days` giorni (§P2.6.4). */
export async function listUseCaseBellRows(i: { userId: string; workspaceId: string; limit: number; days: number; now: Date }): Promise<BellUseCaseInput[]> {
  if (!isUuid(i.userId) || !isUuid(i.workspaceId)) return [];
  const executor = await getAppUcExecutor();
  if (!(await tablePresent(executor))) return [];
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT n.id, n.use_case_id, n.kind, n.answers, n.unknowns, n.documents, n.follow_up, n.last_event_at, n.read_at, u.code, u.title
FROM use_case_notifications n
JOIN use_cases u ON u.id = n.use_case_id AND u.workspace_id = n.workspace_id
WHERE n.recipient_user_id = ${cast(i.userId, "uuid")} AND n.workspace_id = ${cast(i.workspaceId, "uuid")}
  AND n.last_event_at > ${cast(i.now.toISOString(), "timestamptz")} - make_interval(days => ${cast(Math.max(1, Math.floor(i.days)), "int")})
ORDER BY n.last_event_at DESC, n.id
LIMIT ${cast(Math.max(1, Math.min(200, Math.floor(i.limit))), "int")}`),
  ]);
  return rows.flatMap((r): BellUseCaseInput[] => {
    const id = rowString(r.id);
    const useCaseId = rowString(r.use_case_id);
    const lastEventAt = rowDate(r.last_event_at);
    const kind = rowString(r.kind) as UseCaseNotificationKind | null;
    if (!id || !useCaseId || !lastEventAt || !kind) return [];
    return [
      {
        id,
        useCaseId,
        code: rowString(r.code),
        title: rowString(r.title) ?? "",
        kind,
        answers: rowNumber(r.answers) ?? 0,
        unknowns: rowNumber(r.unknowns) ?? 0,
        documents: rowNumber(r.documents) ?? 0,
        followUp: (rowString(r.follow_up) as FollowUpReason | null) ?? null,
        lastEventAt,
        readAt: rowDate(r.read_at),
      },
    ];
  });
}

/**
 * Segna lette le righe della persona: una (`id`, con `at` = l'activityAt che la persona ha visto)
 * o tutte (`id` null, fino a `upTo`). Solo le righe con `last_event_at` (troncato ai millisecondi)
 * non dopo l'istante dato: una riga cresciuta dopo che la persona l'ha vista resta non letta.
 */
export async function markUseCaseNotificationsRead(i: { userId: string; workspaceId: string } & ({ id: string; at: Date } | { id: null; upTo: Date })): Promise<number> {
  if (!isUuid(i.userId) || !isUuid(i.workspaceId)) return 0;
  const executor = await getAppUcExecutor();
  if (!(await tablePresent(executor))) return 0;
  const one = i.id !== null ? ucSql` AND id = ${cast(uuid(i.id, "notifica"), "uuid")}` : raw("");
  const limit = i.id !== null ? cast(i.at.toISOString(), "timestamptz") : ucSql`least(${cast(i.upTo.toISOString(), "timestamptz")}, now())`;
  const [rows] = await executor.batch([
    toStatement(ucSql`UPDATE use_case_notifications SET read_at = coalesce(read_at, now())
WHERE recipient_user_id = ${cast(i.userId, "uuid")} AND workspace_id = ${cast(i.workspaceId, "uuid")} AND read_at IS NULL${one}
  AND date_trunc('milliseconds', last_event_at) <= ${limit}
RETURNING id`),
  ]);
  return rows.length;
}

// ─── Coda degli avvisi: lo store del motore ──────────────────────────

const LEASE_MINUTES = 5;
const CODE = /^[a-z0-9_]{1,60}$/;
const code = (value: string) => (CODE.test(value) ? value : "errore_invio");

function claimedOf(r: UcRow): ClaimedAlert | null {
  const id = rowString(r.id);
  const workspaceId = rowString(r.workspace_id);
  const recipientUserId = rowString(r.recipient_user_id);
  const scheduledAt = rowDate(r.scheduled_at);
  const dueAt = rowDate(r.due_at);
  const sendOn = rowString(r.send_on);
  if (!id || !workspaceId || !recipientUserId || !scheduledAt || !dueAt || !sendOn) return null;
  return { id, workspaceId, recipientUserId, sendOn: sendOn.slice(0, 10), scheduledAt, dueAt, attempts: rowNumber(r.attempts) ?? 0 };
}

/** Lo store degli avvisi sul database (§P2.7). */
export function createRequesterAlertStore(executor: UcExecutor, o: { env: DispatchEnv; now: Date }): RequesterAlertStore {
  const one = async (statement: UcStatement) => {
    await executor.batch([statement]);
  };
  return {
    async holdUnconfigured() {
      const [rows] = await executor.batch([
        toStatement(ucSql`UPDATE use_case_requester_emails SET hold_reason = 'email_non_configurata', lease_until = NULL, updated_at = now()
WHERE status IN ('in_coda', 'errore') AND hold_reason IS DISTINCT FROM 'email_non_configurata'
RETURNING id`),
      ]);
      return rows.length;
    },
    async cancelStale(now) {
      const [pending] = await executor.batch([
        toStatement(ucSql`SELECT id, due_at FROM use_case_requester_emails WHERE status IN ('in_coda', 'errore') ORDER BY due_at, id LIMIT 500`),
      ]);
      const stale = pending.filter((r) => {
        const dueAt = rowDate(r.due_at);
        return dueAt !== null && isStaleAlert(dueAt, now);
      });
      if (stale.length === 0) return 0;
      const [rows] = await executor.batch([
        toStatement(ucSql`UPDATE use_case_requester_emails SET status = 'annullata', cancel_reason = 'troppo_vecchia', lease_until = NULL, updated_at = now()
WHERE id = ANY(${cast(stale.map((r) => String(r.id)), "uuid[]")}) AND status IN ('in_coda', 'errore')
RETURNING id`),
      ]);
      return rows.length;
    },
    async claimDue(i) {
      if (!inRomeSendWindow(i.now)) return [];
      const now = cast(i.now.toISOString(), "timestamptz");
      const who = i.recipientUserId && isUuid(i.recipientUserId) ? ucSql` AND recipient_user_id = ${cast(i.recipientUserId, "uuid")}` : raw("");
      const [rows] = await executor.batch([
        toStatement(ucSql`WITH c AS (
  SELECT id FROM use_case_requester_emails
  WHERE (status = 'in_coda' OR (status = 'errore' AND attempts < 3)) AND scheduled_at <= ${now}
    AND (lease_until IS NULL OR lease_until <= ${now})${who}
  ORDER BY scheduled_at, id
  LIMIT ${cast(i.limit, "int")}
  FOR UPDATE SKIP LOCKED
)
UPDATE use_case_requester_emails e SET lease_until = ${now} + make_interval(mins => ${cast(LEASE_MINUTES, "int")}), updated_at = now()
FROM c WHERE e.id = c.id
RETURNING e.id, e.workspace_id, e.recipient_user_id, e.send_on::text AS send_on, e.scheduled_at, e.due_at, e.attempts`),
      ]);
      return rows.map(claimedOf).filter((x): x is ClaimedAlert => x !== null);
    },
    async loadFacts(e) {
      const ws = cast(e.workspaceId, "uuid");
      const [[head], items] = await executor.batch([
        toStatement(ucSql`SELECT w.name AS company,
  lower(u.email) AS email, u.email_verified IS NOT NULL AS verified,
  coalesce(
    (SELECT m.role::text FROM memberships m WHERE m.user_id = u.id AND m.organization_id = w.organization_id LIMIT 1),
    (SELECT wm.role::text FROM workspace_memberships wm WHERE wm.user_id = u.id AND wm.workspace_id = w.id LIMIT 1)
  ) = ANY(${ROLES()}) AS reviewer,
  coalesce((SELECT b.referent_emails FROM workspace_bell_state b WHERE b.workspace_id = w.id AND b.user_id = u.id), true) AS alerts_on,
  u.id AS user_id
FROM workspaces w LEFT JOIN users u ON u.id = ${cast(e.recipientUserId, "uuid")}
WHERE w.id = ${ws}`),
        toStatement(ucSql`SELECT i.request_id, i.use_case_id, i.answers, i.unknowns, i.documents, i.follow_up, r.created_at, r.purged_at IS NOT NULL AS purged, c.code, c.title
FROM use_case_requester_email_items i
JOIN use_case_referent_requests r ON r.id = i.request_id AND r.workspace_id = i.workspace_id
JOIN use_cases c ON c.id = i.use_case_id AND c.workspace_id = i.workspace_id
WHERE i.email_id = ${cast(e.id, "uuid")} AND i.workspace_id = ${ws}
ORDER BY r.created_at, i.request_id`),
      ]);
      const ack = await loadSubprocessorAck(executor, e.workspaceId).catch(() => null);
      const recipient = head && rowString(head.user_id) ? { email: rowString(head.email), verified: rowBool(head.verified), reviewer: rowBool(head.reviewer), alertsOn: rowBool(head.alerts_on) } : null;
      const facts: AlertFacts = {
        company: rowString(head?.company) ?? "",
        featureOn: referentAskEnabled(e.workspaceId, o.env as Env),
        subprocessorsAuthorized: ack !== null,
        recipient,
        items: items.flatMap((r) => {
          const requestId = rowString(r.request_id);
          const useCaseId = rowString(r.use_case_id);
          const createdAt = rowDate(r.created_at);
          if (!requestId || !useCaseId || !createdAt) return [];
          return [
            {
              requestId,
              useCaseId,
              code: rowString(r.code),
              title: rowString(r.title) ?? "",
              createdAt,
              answers: rowNumber(r.answers) ?? 0,
              unknowns: rowNumber(r.unknowns) ?? 0,
              documents: rowNumber(r.documents) ?? 0,
              followUp: (rowString(r.follow_up) as FollowUpReason | null) ?? null,
              requestPurged: rowBool(r.purged),
            },
          ];
        }),
      };
      return facts;
    },
    async markSent(e) {
      await one(
        toStatement(ucSql`UPDATE use_case_requester_emails SET status = 'inviata', sent_at = now(), lease_until = NULL, hold_reason = NULL, updated_at = now()
WHERE id = ${cast(e.id, "uuid")} AND status IN ('in_coda', 'errore')`),
      );
    },
    async markFailed(e, failure) {
      await one(
        toStatement(ucSql`UPDATE use_case_requester_emails SET status = 'errore', attempts = least(3, attempts + 1), last_error_code = ${cast(code(failure), "text")},
  scheduled_at = scheduled_at + make_interval(mins => ${cast(RETRY_DELAY_MINUTES, "int")}), lease_until = NULL, updated_at = now()
WHERE id = ${cast(e.id, "uuid")} AND status IN ('in_coda', 'errore')`),
      );
    },
    async markHeld(e, reason) {
      await one(
        toStatement(ucSql`UPDATE use_case_requester_emails SET hold_reason = ${cast(code(reason), "text")}, lease_until = NULL, updated_at = now()
WHERE id = ${cast(e.id, "uuid")} AND status IN ('in_coda', 'errore')`),
      );
    },
    async markCancelled(e, reason) {
      await one(
        toStatement(ucSql`UPDATE use_case_requester_emails SET status = 'annullata', cancel_reason = ${cast(code(reason), "text")}, lease_until = NULL, updated_at = now()
WHERE id = ${cast(e.id, "uuid")} AND status IN ('in_coda', 'errore')`),
      );
    },
  };
}

const ZERO: RequesterAlertSummary = { sent: 0, failed: 0, held: 0, cancelled: 0, notConfigured: 0 };

/** Un giro di invio degli avvisi a chi ha chiesto. Zeri con la funzione spenta o in un'anteprima. */
export async function dispatchRequesterAlerts(
  o: { recipientUserId?: string | null; limit?: number; env?: DispatchEnv; now?: Date; mailer?: UcMailer; sendIntervalMs?: number } = {},
): Promise<RequesterAlertSummary> {
  const env = o.env ?? (process.env as DispatchEnv);
  if (env.USE_CASE_REFERENTS?.trim() === "off" || env.VERCEL_ENV === "preview") return { ...ZERO };
  const now = o.now ?? new Date();
  const executor = await getAppUcExecutor();
  if (!(await tablePresent(executor))) return { ...ZERO };
  return runRequesterAlertDispatch(createRequesterAlertStore(executor, { env, now }), {
    env,
    now,
    recipientUserId: o.recipientUserId ?? null,
    limit: o.limit,
    mailer: o.mailer,
    sendIntervalMs: o.sendIntervalMs,
  });
}

/** Dopo la risposta: l'avviso di chi ha chiesto, al massimo 3 righe. Solo per le risposte del referente (evento 1). */
export function scheduleRequesterAlertDispatch(recipientUserId: string | null): void {
  afterResponse(async () => {
    try {
      await dispatchRequesterAlerts({ recipientUserId, limit: 3 });
    } catch (error) {
      ucLogError({ area: "use-case.referenti", op: "avvisi_dopo_risposte" }, error);
    }
  });
}

/** Le notifiche e gli avvisi più vecchi di 90 giorni (cron). */
export async function purgeOldNotifications(now: Date): Promise<{ notifications: number; emails: number }> {
  const executor = await getAppUcExecutor();
  if (!(await tablePresent(executor))) return { notifications: 0, emails: 0 };
  const limit = cast(new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * 86_400_000).toISOString(), "timestamptz");
  const [notifications, emails] = await executor.batch([
    toStatement(ucSql`DELETE FROM use_case_notifications WHERE last_event_at < ${limit} RETURNING id`),
    toStatement(ucSql`DELETE FROM use_case_requester_emails WHERE created_at < ${limit} AND status IN ('inviata', 'annullata', 'errore') RETURNING id`),
  ]);
  return { notifications: notifications.length, emails: emails.length };
}
