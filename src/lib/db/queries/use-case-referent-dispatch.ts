import "server-only";
import { getAppUcExecutor, type UcExecutor, type UcRow } from "@/lib/db/uc-executor";
import { loadUserContext } from "@/lib/db/queries/uc-cases";
import { loadSubprocessorAck } from "@/lib/db/queries/uc-subprocessors";
import { lsDomainsOf, logReferentError, readReferentPerson, type Env } from "@/lib/db/queries/use-case-referent-base";
import type { ReferentEmailTemplate, ReferentReminderKind, ReferentRequestStatus } from "@/lib/db/use-case-hub-referents-ddl";
import { DISPATCH_LEASE_MINUTES, RETRY_DELAY_MINUTES, type DispatchEnv, type UcMailer } from "@/lib/uc/notify/dispatch";
import { rowBool, rowDate, rowNumber, rowString } from "@/lib/uc/sql/readiness";
import { cast, raw, toStatement, ucSql, type UcStatement } from "@/lib/uc/sql/statement";
import { alertSchedule } from "@/lib/use-cases/referent/alerts";
import { referentAskEnabled } from "@/lib/use-cases/referent/availability";
import {
  REFERENT_DISPATCH_AFTER_LIMIT,
  REFERENT_DISPATCH_LIMIT,
  runReferentDispatch,
  type ClaimedReferentEmail,
  type ReferentDeliveryFacts,
  type ReferentDispatchOptions,
  type ReferentDispatchStore,
  type ReferentDispatchSummary,
  type ReferentRequestFacts,
} from "@/lib/use-cases/referent/dispatch";
import { notifyReviewersSql, openItemsCountSql, queueRequesterAlertSql, referentEventsForRequestsSql, validLinkSql } from "@/lib/use-cases/referent/sql";
import { newReferentToken } from "@/lib/use-cases/referent/tokens";
import { PORTFOLIO_REVIEWER_ROLES } from "@/lib/workspace-permissions";

/**
 * L'invio delle email di «Chiedi al referente» sul database (SPEC §3.6): lo store del motore puro
 * (`referent/dispatch.ts`) e il giro di invio, dopo un comando (`after()`, 5 righe) o dal cron (50).
 *
 * - **Prese in carico**: una riga si prende con un lease di 10 minuti (`FOR UPDATE SKIP LOCKED`):
 *   due giri in parallelo non la mandano due volte. I promemoria solo nella finestra di Roma.
 * - **Link**: il token nasce qui, al momento dell'invio, solo se la richiesta è ancora viva; si salva
 *   l'impronta sha256 e quella dell'indirizzo; il token in chiaro torna solo al motore, per l'email.
 * - **Dopo l'invio** (`markSent`, un batch): la riga e le sue voci, le date della richiesta, la Storia
 *   dei promemoria, e con l'ultimo promemoria l'evento «Nessuna risposta» e l'avviso a chi ha chiesto.
 */

const LEASE = DISPATCH_LEASE_MINUTES;
const CODE = /^[a-z0-9_]{1,60}$/;
const code = (value: string) => (CODE.test(value) ? value : "errore_invio");

function claimedOf(r: UcRow): ClaimedReferentEmail | null {
  const id = rowString(r.id);
  const workspaceId = rowString(r.workspace_id);
  const contactId = rowString(r.contact_id);
  const template = rowString(r.template) as ReferentEmailTemplate | null;
  const dedupeKey = rowString(r.dedupe_key);
  const dueAt = rowDate(r.due_at);
  if (!id || !workspaceId || !contactId || !template || !dedupeKey || !dueAt) return null;
  return {
    id: id.toLowerCase(),
    workspaceId: workspaceId.toLowerCase(),
    contactId: contactId.toLowerCase(),
    requestId: rowString(r.request_id)?.toLowerCase() ?? null,
    template,
    attempts: rowNumber(r.attempts) ?? 0,
    dedupeKey,
    dueAt,
  };
}

function scopeOf(requestId: string | null): ReturnType<typeof ucSql> {
  if (!requestId) return raw("");
  const r = cast(requestId, "uuid");
  return ucSql` AND (e.request_id = ${r} OR e.id IN (SELECT it.email_id FROM use_case_referent_email_items it WHERE it.request_id = ${r}))`;
}

/** Le colonne di una richiesta per il motore; la voce del promemoria con il suo tipo. */
function requestFactsSql(i: { emailId: string; template: ReferentEmailTemplate; requestId: string | null; workspaceId: string }): UcStatement {
  const ws = cast(i.workspaceId, "uuid");
  const common = raw(`r.id, r.use_case_id, r.status, r.expires_at, r.sent_at, r.reminder_count, r.last_email_at, r.message, r.requester_name, r.requested_by_user_id, r.created_at,
  (r.status = 'inviata' AND r.revoked_at IS NULL AND r.expires_at > now()) AS live, u.code, u.title`);
  // Già partita ma senza link valido per l'indirizzo di adesso («Correggi l'email»).
  const changed = ucSql`(r.sent_at IS NOT NULL AND NOT ${validLinkSql("r")}) AS address_changed`;
  if (i.template !== "promemoria") {
    return toStatement(ucSql`SELECT ${common}, ${changed}, ${openItemsCountSql("r")} AS open_items, 0 AS new_questions, NULL::text AS item_kind, false AS already_sent,
  (SELECT count(*)::int FROM use_case_referent_request_items x WHERE x.request_id = r.id AND x.answered_at >= (date_trunc('day', now() AT TIME ZONE 'Europe/Rome') AT TIME ZONE 'Europe/Rome')) AS answered_today
FROM use_case_referent_requests r JOIN use_cases u ON u.id = r.use_case_id AND u.workspace_id = r.workspace_id
WHERE r.id = ${cast(i.requestId, "uuid")} AND r.workspace_id = ${ws}`);
  }
  return toStatement(ucSql`SELECT ${common}, ${changed}, ${openItemsCountSql("r")} AS open_items, it.new_questions, it.kind AS item_kind,
  EXISTS (SELECT 1 FROM use_case_referent_email_items o WHERE o.request_id = r.id AND o.kind = it.kind AND o.state = 'inviata' AND o.email_id <> it.email_id) AS already_sent,
  0 AS answered_today
FROM use_case_referent_email_items it
JOIN use_case_referent_requests r ON r.id = it.request_id AND r.workspace_id = it.workspace_id
JOIN use_cases u ON u.id = r.use_case_id AND u.workspace_id = r.workspace_id
WHERE it.email_id = ${cast(i.emailId, "uuid")} AND it.workspace_id = ${ws} AND it.state = 'in_coda'
ORDER BY r.created_at, r.id`);
}

function requestFactsOf(r: UcRow): ReferentRequestFacts | null {
  const id = rowString(r.id);
  const expiresAt = rowDate(r.expires_at);
  if (!id || !expiresAt) return null;
  const kind = rowString(r.item_kind) as ReferentReminderKind | null;
  return {
    id: id.toLowerCase(),
    useCaseId: rowString(r.use_case_id)?.toLowerCase() ?? undefined,
    useCase: { code: rowString(r.code), title: rowString(r.title) ?? "" },
    status: (rowString(r.status) ?? "inviata") as ReferentRequestStatus,
    live: rowBool(r.live),
    expiresAt,
    sentAt: rowDate(r.sent_at),
    reminderCount: rowNumber(r.reminder_count) ?? 0,
    lastEmailAt: rowDate(r.last_email_at),
    message: rowString(r.message),
    requesterName: rowString(r.requester_name) ?? "",
    requesterUserId: rowString(r.requested_by_user_id)?.toLowerCase() ?? null,
    openItems: rowNumber(r.open_items) ?? 0,
    newQuestions: rowNumber(r.new_questions) ?? 0,
    answeredToday: rowNumber(r.answered_today) ?? 0,
    item: kind ? { kind, alreadySent: rowBool(r.already_sent) } : null,
    addressChanged: rowBool(r.address_changed),
  };
}

/** Lo store del motore sul database. */
export function createReferentDispatchStore(executor: UcExecutor, o: { env?: Env; now?: Date } = {}): ReferentDispatchStore {
  const env = o.env ?? process.env;
  const clock = () => o.now ?? new Date();
  const lsDomains = lsDomainsOf(env);
  return {
    async holdUnconfigured(scope) {
      const [rows] = await executor.batch([
        toStatement(ucSql`UPDATE use_case_referent_emails e SET hold_reason = 'email_non_configurata', lease_until = NULL, updated_at = now()
WHERE e.status IN ('in_coda', 'errore')${scopeOf(scope.requestId)}
RETURNING e.id`),
      ]);
      return rows.length;
    },
    async cancelStale(now, isStale) {
      const [pending] = await executor.batch([
        toStatement(ucSql`SELECT e.id, e.due_at FROM use_case_referent_emails e WHERE e.status IN ('in_coda', 'errore') ORDER BY e.due_at, e.id LIMIT 500`),
      ]);
      const stale = pending.filter((r) => {
        const dueAt = rowDate(r.due_at);
        return dueAt !== null && isStale(dueAt);
      });
      void now;
      if (stale.length === 0) return 0;
      const [rows] = await executor.batch([
        toStatement(ucSql`UPDATE use_case_referent_emails e SET status = 'annullata', cancel_reason = 'troppo_vecchia', lease_until = NULL, updated_at = now()
WHERE e.id = ANY(${cast(stale.map((r) => String(r.id)), "uuid[]")}) AND e.status IN ('in_coda', 'errore')
RETURNING e.id`),
      ]);
      return rows.length;
    },
    async claimDue(i) {
      const now = cast(i.now.toISOString(), "timestamptz");
      const windowed = i.includeWindowed ? raw("") : raw(" AND e.template <> 'promemoria'");
      const [rows] = await executor.batch([
        toStatement(ucSql`WITH c AS (
  SELECT e.id FROM use_case_referent_emails e
  WHERE (e.status = 'in_coda' OR (e.status = 'errore' AND e.attempts < 3)) AND e.scheduled_at <= ${now}
    AND (e.lease_until IS NULL OR e.lease_until <= ${now})${windowed}${scopeOf(i.requestId)}
  ORDER BY e.scheduled_at, e.id
  LIMIT ${cast(i.limit, "int")}
  FOR UPDATE SKIP LOCKED
)
UPDATE use_case_referent_emails e SET lease_until = ${now} + make_interval(mins => ${cast(LEASE, "int")}), updated_at = now()
FROM c WHERE e.id = c.id
RETURNING e.id, e.workspace_id, e.contact_id, e.request_id, e.template, e.attempts, e.dedupe_key, e.due_at`),
      ]);
      return rows.map(claimedOf).filter((x): x is ClaimedReferentEmail => x !== null);
    },
    async loadFacts(e, now) {
      void now;
      const ws = cast(e.workspaceId, "uuid");
      const [[head], requestRows, [reminded]] = await executor.batch([
        toStatement(ucSql`SELECT w.name AS company, c.email, c.is_active, c.anonymized_at IS NOT NULL AS anonymized, c.user_id, c.id AS contact_id
FROM workspaces w LEFT JOIN uc_contacts c ON c.id = ${cast(e.contactId, "uuid")} AND c.workspace_id = w.id
WHERE w.id = ${ws}`),
        requestFactsSql({ emailId: e.id, template: e.template, requestId: e.requestId, workspaceId: e.workspaceId }),
        toStatement(ucSql`SELECT EXISTS (SELECT 1 FROM use_case_referent_emails x
  WHERE x.workspace_id = ${ws} AND x.contact_id = ${cast(e.contactId, "uuid")} AND x.template = 'promemoria' AND x.status = 'inviata' AND x.id <> ${cast(e.id, "uuid")}
    AND x.sent_at >= (date_trunc('day', now() AT TIME ZONE 'Europe/Rome') AT TIME ZONE 'Europe/Rome')) AS today`),
      ]);
      const requests = requestRows.map(requestFactsOf).filter((x): x is ReferentRequestFacts => x !== null);
      const requester = requests[0]?.requesterUserId ?? null;
      let replyTo: string | null = null;
      if (requester) {
        const [[row]] = await executor.batch([
          toStatement(ucSql`SELECT lower(u.email) AS email FROM users u JOIN workspaces w ON w.id = ${ws}
WHERE u.id = ${cast(requester, "uuid")} AND u.email_verified IS NOT NULL
  AND coalesce(
    (SELECT m.role::text FROM memberships m WHERE m.user_id = u.id AND m.organization_id = w.organization_id LIMIT 1),
    (SELECT wm.role::text FROM workspace_memberships wm WHERE wm.user_id = u.id AND wm.workspace_id = w.id LIMIT 1)
  ) = ANY(${cast([...PORTFOLIO_REVIEWER_ROLES], "text[]")})`),
        ]);
        replyTo = rowString(row?.email);
      }
      const userId = rowString(head?.user_id);
      const user = userId ? await loadUserContext(executor, userId, lsDomains) : null;
      const ack = await loadSubprocessorAck(executor, e.workspaceId);
      // (Parte 3) Il referente è adesso un revisore del workspace con la stessa email verificata? Riletto a ogni invio.
      const person = await readReferentPerson(executor, e.workspaceId, e.contactId);
      // (Parte 3) Mai un'email a chi ha chiesto: lo stesso account, oppure l'email del contatto uguale alla sua email verificata.
      const contactEmail = rowString(head?.email)?.trim().toLowerCase() ?? null;
      const requesterIds = [...new Set(requests.map((x) => x.requesterUserId).filter((x): x is string => x !== null))];
      const requesterEmails = new Map<string, string>();
      if (requesterIds.length) {
        const [rows] = await executor.batch([
          toStatement(ucSql`SELECT u.id::text AS id, lower(btrim(u.email)) AS email FROM users u
WHERE u.id = ANY(${cast(requesterIds, "uuid[]")}) AND u.email_verified IS NOT NULL AND u.email IS NOT NULL`),
        ]);
        for (const row of rows) {
          const id = rowString(row.id)?.toLowerCase();
          const email = rowString(row.email);
          if (id && email) requesterEmails.set(id, email);
        }
      }
      for (const req of requests) {
        const requester = req.requesterUserId;
        req.selfRequest = Boolean(
          requester && ((person.userId !== null && person.userId === requester) || (contactEmail !== null && requesterEmails.get(requester) === contactEmail)),
        );
      }
      const facts: ReferentDeliveryFacts = {
        company: rowString(head?.company) ?? "",
        featureOn: referentAskEnabled(e.workspaceId, env),
        subprocessorsAuthorized: ack !== null,
        recipient: head && rowString(head.contact_id)
          ? {
              email: rowString(head.email),
              active: rowBool(head.is_active),
              anonymized: rowBool(head.anonymized),
              linkedUserIsLateralSpace: user?.isLateralSpace === true,
              teamAccess: person.teamAccess,
            }
          : null,
        replyTo,
        requests,
        contactRemindedToday: rowBool(reminded?.today),
      };
      return facts;
    },
    async issueToken(i) {
      const issued = newReferentToken();
      const [rows] = await executor.batch([
        toStatement(ucSql`INSERT INTO use_case_referent_tokens (request_id, workspace_id, token_hash, recipient_hash, issued_for, expires_at)
SELECT r.id, r.workspace_id, ${cast(issued.hash, "text")}, ${cast(i.recipientHash, "text")}, ${cast(i.issuedFor, "text")}, r.expires_at
FROM use_case_referent_requests r
WHERE r.id = ${cast(i.requestId, "uuid")} AND r.workspace_id = ${cast(i.workspaceId, "uuid")} AND r.status = 'inviata' AND r.revoked_at IS NULL AND r.expires_at > now()
RETURNING id`),
      ]);
      const tokenId = rowString(rows[0]?.id);
      return tokenId ? { ok: true, token: issued.token, tokenId: tokenId.toLowerCase() } : { ok: false, code: "richiesta_non_viva" };
    },
    async revokeToken(tokenId) {
      await executor.batch([toStatement(ucSql`UPDATE use_case_referent_tokens SET revoked_at = now() WHERE id = ${cast(tokenId, "uuid")} AND revoked_at IS NULL`)]);
    },
    async markSent(e, effects, tokenIds, dropped) {
      const ws = e.workspaceId;
      const statements: UcStatement[] = [
        toStatement(ucSql`UPDATE use_case_referent_emails SET status = 'inviata', sent_at = now(), lease_until = NULL, hold_reason = NULL, updated_at = now(),
  token_id = ${cast(e.template === "richiesta" && e.requestId ? (tokenIds[e.requestId] ?? null) : null, "uuid")}
WHERE id = ${cast(e.id, "uuid")}`),
      ];
      if (e.template === "promemoria") {
        for (const effect of effects) {
          statements.push(
            toStatement(ucSql`UPDATE use_case_referent_email_items SET state = 'inviata', token_id = ${cast(tokenIds[effect.requestId] ?? null, "uuid")}
WHERE email_id = ${cast(e.id, "uuid")} AND request_id = ${cast(effect.requestId, "uuid")}`),
          );
        }
        for (const d of dropped) {
          statements.push(
            toStatement(ucSql`UPDATE use_case_referent_email_items SET state = 'tolta', drop_reason = ${cast(code(d.reason), "text")}
WHERE email_id = ${cast(e.id, "uuid")} AND request_id = ${cast(d.requestId, "uuid")} AND state = 'in_coda'`),
          );
        }
      }
      const schedule = alertSchedule(clock());
      for (const effect of effects) {
        const req = cast(effect.requestId, "uuid");
        statements.push(
          toStatement(ucSql`UPDATE use_case_referent_requests SET last_email_at = now(),
  sent_at = ${effect.first ? raw("coalesce(sent_at, now())") : raw("sent_at")},
  reminder_count = ${effect.reminder === 1 ? raw("greatest(reminder_count, 1)") : effect.reminder === 2 ? raw("2") : raw("reminder_count")},
  last_reminder_at = ${effect.reminder !== null || effect.manual ? raw("now()") : raw("last_reminder_at")}
WHERE id = ${req} AND workspace_id = ${cast(ws, "uuid")}`),
        );
        const filter = ucSql`r.id = ${req} AND r.workspace_id = ${cast(ws, "uuid")}`;
        if (effect.reminder === 1) statements.push(referentEventsForRequestsSql({ filter, code: "promemoria_1", actor: { kind: "sistema" } }));
        if (effect.reminder === 2) statements.push(referentEventsForRequestsSql({ filter, code: "promemoria_2", actor: { kind: "sistema" } }));
        if (effect.manual) statements.push(referentEventsForRequestsSql({ filter, code: "promemoria", actor: { kind: "sistema" } }));
      }
      const last = effects.filter((x) => x.reminder === 2);
      if (last.length) {
        const [rows] = await executor.batch([
          toStatement(ucSql`SELECT r.id, r.use_case_id FROM use_case_referent_requests r WHERE r.workspace_id = ${cast(ws, "uuid")} AND r.id = ANY(${cast(last.map((x) => x.requestId), "uuid[]")})`),
        ]);
        for (const r of rows) {
          statements.push(
            notifyReviewersSql({
              workspaceId: ws,
              useCaseId: String(r.use_case_id),
              kind: "senza_risposta",
              followUp: "ultimo_promemoria",
              actorUserId: null,
              // D-B21: il referente revisore non riceve «Nessuna risposta» della propria richiesta.
              exceptReferentOfRequestId: String(r.id),
            }),
            queueRequesterAlertSql({
              workspaceId: ws,
              target: { requestId: String(r.id) },
              answers: 0,
              unknowns: 0,
              documents: 0,
              followUp: "ultimo_promemoria",
              actorUserId: null,
              immediate: false,
              schedule,
              now: clock(),
            }),
          );
        }
      }
      await executor.batch(statements);
    },
    async markFailed(e, failure) {
      await executor.batch([
        toStatement(ucSql`UPDATE use_case_referent_emails SET status = 'errore', attempts = least(3, attempts + 1), last_error_code = ${cast(code(failure), "text")},
  scheduled_at = scheduled_at + make_interval(mins => ${cast(RETRY_DELAY_MINUTES, "int")}), lease_until = NULL, updated_at = now()
WHERE id = ${cast(e.id, "uuid")} AND status IN ('in_coda', 'errore')`),
      ]);
    },
    async markHeld(e, reason) {
      await executor.batch([
        toStatement(ucSql`UPDATE use_case_referent_emails SET hold_reason = ${cast(code(reason), "text")}, lease_until = NULL, updated_at = now()
WHERE id = ${cast(e.id, "uuid")} AND status IN ('in_coda', 'errore')`),
      ]);
    },
    async markCancelled(e, reason) {
      await executor.batch([
        toStatement(ucSql`UPDATE use_case_referent_emails SET status = 'annullata', cancel_reason = ${cast(code(reason), "text")}, lease_until = NULL, updated_at = now()
WHERE id = ${cast(e.id, "uuid")} AND status IN ('in_coda', 'errore')`),
        toStatement(ucSql`UPDATE use_case_referent_email_items SET state = 'tolta', drop_reason = ${cast(code(reason), "text")}
WHERE email_id = ${cast(e.id, "uuid")} AND state = 'in_coda'`),
      ]);
    },
  };
}

/** Il giro di invio con uno store già pronto (il cron). */
export function runReferentDispatchWith(store: ReferentDispatchStore, o: ReferentDispatchOptions): Promise<ReferentDispatchSummary> {
  return runReferentDispatch(store, o);
}

const ZERO: ReferentDispatchSummary = { sent: 0, failed: 0, held: 0, cancelled: 0, notConfigured: 0 };

/**
 * Un giro di invio delle email ai referenti: dopo un comando (`requestId`, 5 righe) o dal cron (50).
 * Zeri con la funzione spenta (`USE_CASE_REFERENTS=off`) o in un'anteprima di Vercel.
 */
export async function dispatchReferentEmails(
  o: { requestId?: string | null; limit?: number; env?: DispatchEnv; now?: Date; mailer?: UcMailer; sendIntervalMs?: number } = {},
): Promise<ReferentDispatchSummary> {
  const env = (o.env ?? process.env) as Env;
  if (env.USE_CASE_REFERENTS?.trim() === "off" || env.VERCEL_ENV === "preview") return { ...ZERO };
  try {
    const executor = await getAppUcExecutor();
    return await runReferentDispatch(createReferentDispatchStore(executor, { env, now: o.now }), {
      env: env as DispatchEnv,
      lsDomains: lsDomainsOf(env),
      now: o.now,
      requestId: o.requestId ?? null,
      limit: o.limit ?? (o.requestId ? REFERENT_DISPATCH_AFTER_LIMIT : REFERENT_DISPATCH_LIMIT),
      mailer: o.mailer,
      sendIntervalMs: o.sendIntervalMs,
    });
  } catch (error) {
    logReferentError("invio_email", error);
    return { ...ZERO, failed: 1 };
  }
}
