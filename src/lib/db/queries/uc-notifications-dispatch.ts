/**
 * Invio della coda `uc_notifications` e campanella di Lateral Space (PIANO §7.1).
 *
 * - `claimDue` prende in carico le email arrivate a scadenza (lease di 10 minuti,
 *   `FOR UPDATE SKIP LOCKED`: due invii in parallelo non mandano la stessa
 *   email); `markSent` / `markFailed` / `markHeld` / `markCancelled` chiudono la
 *   riga, con l'evento `notifica.inviata` o `notifica.errore` nello stesso batch.
 * - `loadDeliveryFacts` legge solo quello che serve a decidere e a comporre
 *   l'email: caso, destinatario, richiesta (viva secondo `uc_request_live`),
 *   conteggi. Mai valori delle risposte.
 * - `dispatchDue` (dopo ogni comando, in `after()`, e nei cron) e
 *   `unreadForUser` (campanella nella barra in alto) sono gli ingressi
 *   dell'app: leggono l'ambiente e l'esecutore dell'app solo se non li riceve.
 *
 * Il motore e le regole di invio stanno in `src/lib/uc/notify/dispatch.ts`.
 * Modulo senza import dell'app (`@/…`, `server-only`): l'esecutore arriva da
 * fuori, così lo provano i test di integrazione sul harness locale.
 */
import { formatDateIt, type WeeklyCaseSummary } from "../../uc/notify/email-templates.ts";
import { toBellItems, type UcBellItem, type UcBellRow } from "../../uc/notify/bell.ts";
import {
  DISPATCH_AFTER_COMMAND_LIMIT,
  DISPATCH_LEASE_MINUTES,
  MAX_EMAIL_ATTEMPTS,
  RETRY_DELAY_MINUTES,
  WINDOWED_TEMPLATES,
  HOLD_EMAIL_NOT_CONFIGURED,
  runDispatch,
  type AfterSent,
  type ClaimedNotification,
  type DeliveryFacts,
  type DeliveryRequestFacts,
  type DispatchEnv,
  type DispatchScope,
  type DispatchStore,
  type DispatchSummary,
  type UcMailer,
} from "../../uc/notify/dispatch.ts";
import { checkSignerEmail } from "../../uc/permissions.ts";
import { parseLsDomains, userContextFrom } from "../../uc/lateral-space.ts";
import { cronWorkspaceFilter, ucCronWorkspaceScope } from "../../uc/platform.ts";
import { isUcWorkspaceEnabled } from "../../uc/rollout.ts";
import type { ResolvedLink } from "../../uc/public-rows.ts";
import { estimateMinutes } from "../../uc/request-state.ts";
import { caseModulesRow, caseModulesSql } from "../../uc/sql/request-commands.ts";
import { rowBool, rowDate, rowJson, rowNumber, rowObject, rowString, rowVocab, type Row } from "../../uc/sql/readiness.ts";
import { requestLiveSql } from "../../uc/sql/requests.ts";
import { cast, join, raw, toStatement, ucSql, type SqlFragment, type UcStatement } from "../../uc/sql/statement.ts";
import { templatePartsReader } from "../../uc/sql/template-parts.ts";
import type { Json } from "../../uc/types.ts";
import { CASE_STATUSES, ITEM_STATUSES, LS_CASE_ROLES, REQUEST_PURPOSES, REQUEST_STATUSES, type ItemStatus } from "../../uc/vocab.ts";
import { getAppUcExecutor, type UcExecutor } from "../uc-executor.ts";
import { isUuid, loadCaseCore, loadCaseReadiness, loadSignatureContext, loadUserContext } from "./uc-cases.ts";
import { eventInsertFromSql } from "./uc-events.ts";
import { loadApprovals } from "./uc-public.ts";
import { issueRequestToken, revokeIssuedToken } from "./uc-requests.ts";

export type { UcBellItem } from "../../uc/notify/bell.ts";
export type { DispatchSummary } from "../../uc/notify/dispatch.ts";

const LS_ROLES_SQL = raw(LS_CASE_ROLES.map((r) => `'${r}'`).join(", "));
const OPEN_ITEM_STATES_SQL = raw("'da_fare', 'bozza'");
const UUID_PATTERN_SQL = raw("'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'");

/** Owner del cliente di un caso (alias `c`): il contatto indicato, altrimenti il firmatario designato. */
export const CASE_OWNER_SQL = ucSql`coalesce(c.client_owner_contact_id, CASE WHEN (c.signers_designation -> 'owner' ->> 'contact_id') ~ ${UUID_PATTERN_SQL}
  THEN (c.signers_designation -> 'owner' ->> 'contact_id')::uuid END)`;

/** Filtro della parte di coda (caso e/o workspace) sulle righe `n`. */
function queueScope(scope: Partial<DispatchScope>): SqlFragment {
  const parts: SqlFragment[] = [];
  if (scope.caseId) {
    if (!isUuid(scope.caseId)) throw new Error("Caso non valido");
    parts.push(ucSql` AND n.case_id = ${cast(scope.caseId, "uuid")}`);
  }
  if (scope.workspaceId) {
    if (!isUuid(scope.workspaceId)) throw new Error("Workspace non valido");
    parts.push(ucSql` AND n.workspace_id = ${cast(scope.workspaceId, "uuid")}`);
  }
  return parts.length ? join(parts, "") : raw("");
}

function count(rows: readonly Row[] | undefined): number {
  return rowNumber(rows?.[0]?.n) ?? 0;
}

// ── Costruttori SQL ───────────────────────────────────────────────────

/** Campanella: le righe `in_app` in coda arrivate a scadenza diventano `inviata`. */
export function markInAppDeliveredSql(scope: Partial<DispatchScope> = {}): UcStatement {
  return toStatement(ucSql`WITH u AS (
  UPDATE uc_notifications n SET status = 'inviata', sent_at = now(), hold_reason = NULL
  WHERE n.channel = 'in_app' AND n.status = 'in_coda' AND n.scheduled_at <= now()${queueScope(scope)}
  RETURNING 1
)
SELECT count(*)::int AS n FROM u`);
}

/** Email senza servizio configurato: restano `in_coda` con il motivo `email_non_configurata`. */
export function holdUnconfiguredSql(scope: Partial<DispatchScope> = {}): UcStatement {
  return toStatement(ucSql`WITH u AS (
  UPDATE uc_notifications n SET hold_reason = ${cast(HOLD_EMAIL_NOT_CONFIGURED, "text")}
  WHERE n.channel = 'email' AND n.status = 'in_coda' AND n.hold_reason IS NULL${queueScope(scope)}
  RETURNING 1
)
SELECT count(*)::int AS n FROM u`);
}

/**
 * Email da inviare: in coda (anche quelle ferme per «email non configurata»)
 * oppure in errore con meno di 3 tentativi, arrivate a scadenza. Restano fuori
 * quelle ferme di un caso ancora sospeso e, fuori dalla finestra di Roma,
 * promemoria, segnalazioni e riepiloghi. Le righe prese si spostano avanti di
 * 10 minuti (lease): un secondo invio in parallelo non le vede.
 */
export function claimDueSql(i: Partial<DispatchScope> & { limit: number; includeWindowed: boolean }): UcStatement {
  const limit = Math.max(1, Math.min(Math.trunc(i.limit), 200));
  const windowed = i.includeWindowed ? raw("") : ucSql` AND n.template_key <> ALL(${cast([...WINDOWED_TEMPLATES], "text[]")})`;
  return toStatement(ucSql`WITH due AS (
  SELECT n.id FROM uc_notifications n
  LEFT JOIN uc_cases c ON c.id = n.case_id
  WHERE n.channel = 'email' AND n.scheduled_at <= now()
    AND (n.status = 'in_coda' OR (n.status = 'errore' AND n.attempts < ${cast(MAX_EMAIL_ATTEMPTS, "int")}))
    AND NOT (n.hold_reason IS NOT DISTINCT FROM 'caso_sospeso' AND c.status IS NOT DISTINCT FROM 'sospeso')${queueScope(i)}${windowed}
  ORDER BY n.scheduled_at, n.created_at, n.id
  LIMIT ${cast(limit, "int")}
  FOR UPDATE OF n SKIP LOCKED
)
UPDATE uc_notifications n SET scheduled_at = now() + ${raw(`interval '${DISPATCH_LEASE_MINUTES} minutes'`)}
FROM due WHERE n.id = due.id
RETURNING n.id, n.workspace_id, n.case_id, n.request_id, n.recipient_contact_id, n.recipient_user_id, n.template_key, n.payload, n.attempts, n.dedupe_key`);
}

export function rowToClaimed(row: Row): ClaimedNotification | null {
  const id = rowString(row.id);
  const workspaceId = rowString(row.workspace_id);
  const templateKey = rowString(row.template_key);
  const dedupeKey = rowString(row.dedupe_key);
  if (!isUuid(id) || !isUuid(workspaceId) || !templateKey || !dedupeKey) return null;
  return {
    id,
    workspaceId,
    caseId: rowString(row.case_id),
    requestId: rowString(row.request_id),
    recipientContactId: rowString(row.recipient_contact_id),
    recipientUserId: rowString(row.recipient_user_id),
    templateKey,
    payload: rowObject(row.payload),
    attempts: rowNumber(row.attempts) ?? 0,
    dedupeKey,
  };
}

function notificationEvent(n: ClaimedNotification, type: "notifica.inviata" | "notifica.errore", errorCode: string | null): SqlFragment {
  return eventInsertFromSql({
    type,
    workspaceId: n.workspaceId,
    caseId: n.caseId,
    actor: { type: "sistema" },
    targetType: "notifica",
    from: "u",
    targetIdColumn: "u.id",
    payload: { template_key: n.templateKey, channel: "email", error_code: errorCode ?? undefined },
    rowPayload: { attempts: "u.attempts" },
  });
}

/**
 * Email partita: `inviata` con l'evento `notifica.inviata`. Dopo un promemoria
 * la richiesta conta il promemoria e il prossimo (evento `richiesta.promemoria`);
 * dopo la segnalazione all'Owner la richiesta è segnalata.
 */
export function markSentStatements(n: ClaimedNotification, after: AfterSent): UcStatement[] {
  const out: UcStatement[] = [
    toStatement(ucSql`WITH u AS (
  UPDATE uc_notifications SET status = 'inviata', sent_at = now(), attempts = attempts + 1, hold_reason = NULL, error = NULL
  WHERE id = ${cast(n.id, "uuid")} AND status <> 'inviata'
  RETURNING id, attempts
), ev AS (${notificationEvent(n, "notifica.inviata", null)})
SELECT count(*)::int AS n FROM u`),
  ];
  if (after && n.requestId && n.caseId && isUuid(n.requestId) && isUuid(n.caseId)) {
    if (after.kind === "promemoria") {
      const event = eventInsertFromSql({
        type: "richiesta.promemoria",
        workspaceId: n.workspaceId,
        caseId: n.caseId,
        actor: { type: "sistema" },
        targetType: "richiesta",
        from: "r",
        targetIdColumn: "r.id",
        payload: { reminder: after.reminder },
      });
      out.push(
        toStatement(ucSql`WITH r AS (
  UPDATE uc_requests SET reminder_count = ${cast(after.reminder, "int")}, last_reminder_at = now(),
    next_reminder_at = ${cast(after.nextReminderAt ? after.nextReminderAt.toISOString() : null, "timestamptz")}, updated_at = now()
  WHERE id = ${cast(n.requestId, "uuid")} AND case_id = ${cast(n.caseId, "uuid")} AND reminder_count = ${cast(after.reminder - 1, "int")}
  RETURNING id
), ev AS (${event})
SELECT count(*)::int AS n FROM r`),
      );
    } else {
      out.push(
        toStatement(ucSql`UPDATE uc_requests SET escalated_at = now(), next_reminder_at = NULL, updated_at = now()
WHERE id = ${cast(n.requestId, "uuid")} AND case_id = ${cast(n.caseId, "uuid")} AND escalated_at IS NULL`),
      );
    }
  }
  return out;
}

/** Invio non riuscito: `errore`, un tentativo in più, il prossimo tra 15 minuti (al massimo 3). */
export function markFailedSql(n: ClaimedNotification, errorCode: string): UcStatement {
  const code = /^[a-z0-9_]{1,60}$/.test(errorCode) ? errorCode : "errore_invio";
  return toStatement(ucSql`WITH u AS (
  UPDATE uc_notifications SET status = 'errore', attempts = attempts + 1, error = ${cast(code, "text")}, hold_reason = NULL,
    scheduled_at = now() + ${raw(`interval '${RETRY_DELAY_MINUTES} minutes'`)}
  WHERE id = ${cast(n.id, "uuid")} AND status IN ('in_coda', 'errore')
  RETURNING id, attempts
), ev AS (${notificationEvent(n, "notifica.errore", code)})
SELECT count(*)::int AS n FROM u`);
}

/** Riga ferma con un motivo (es. `caso_sospeso`): resta in coda, di nuovo pronta appena il motivo cade. */
export function markHeldSql(n: ClaimedNotification, reason: string): UcStatement {
  if (!/^[a-z0-9_]{1,60}$/.test(reason)) throw new Error("Motivo di attesa non valido");
  return toStatement(ucSql`UPDATE uc_notifications SET hold_reason = ${cast(reason, "text")}, scheduled_at = now()
WHERE id = ${cast(n.id, "uuid")} AND status IN ('in_coda', 'errore')`);
}

/** Riga che non ha più senso (richiesta non più viva, caso chiuso…): `annullata`, con il codice del motivo. */
export function markCancelledSql(n: ClaimedNotification, reason: string): UcStatement {
  const code = /^[a-z0-9_]{1,60}$/.test(reason) ? reason : "annullata";
  return toStatement(ucSql`UPDATE uc_notifications SET status = 'annullata', error = ${cast(code, "text")}, hold_reason = NULL
WHERE id = ${cast(n.id, "uuid")} AND status IN ('in_coda', 'errore')`);
}

// ── Prendere in carico e chiudere ─────────────────────────────────────

export async function claimDue(executor: UcExecutor, i: Partial<DispatchScope> & { limit: number; includeWindowed: boolean }): Promise<ClaimedNotification[]> {
  const [rows] = await executor.batch([claimDueSql(i)]);
  return rows.map(rowToClaimed).filter((n): n is ClaimedNotification => n !== null);
}

export async function markSent(executor: UcExecutor, n: ClaimedNotification, after: AfterSent): Promise<void> {
  await executor.batch(markSentStatements(n, after));
}

// ── Fatti per l'invio ─────────────────────────────────────────────────

function factsSql(n: ClaimedNotification): UcStatement {
  return toStatement(ucSql`SELECT w.name AS client_name,
  c.id AS case_id, c.code, c.title, c.status AS case_status, ${CASE_OWNER_SQL} AS owner_contact_id, c.signers_designation,
  ct.id AS contact_id, ct.email AS contact_email, coalesce(ct.is_active AND ct.anonymized_at IS NULL, false) AS contact_reachable, coalesce(ct.digest_opt_out, false) AS digest_opt_out,
  u.id AS user_id, u.email AS user_email, u.email_verified AS user_email_verified,
  r.id AS request_id, r.purpose, r.status AS request_status, r.contact_id AS request_contact_id, r.delegated_by_contact_id,
  r.sent_at, r.expires_at, r.reminder_count, r.escalated_at, r.acting_role_key, r.message,
  coalesce(${requestLiveSql("r", "c")}, false) AS request_live,
  coalesce((SELECT jsonb_agg(coalesce(i.request_module_key, '')) FROM uc_request_items ri JOIN uc_items i ON i.id = ri.item_id AND i.case_id = ri.case_id
    WHERE ri.request_id = r.id AND ri.state IN (${OPEN_ITEM_STATES_SQL})), '[]'::jsonb) AS open_modules
FROM uc_notifications n
JOIN workspaces w ON w.id = n.workspace_id
LEFT JOIN uc_cases c ON c.id = n.case_id AND c.workspace_id = n.workspace_id AND c.setup_completed_at IS NOT NULL
LEFT JOIN uc_contacts ct ON ct.id = n.recipient_contact_id AND ct.workspace_id = n.workspace_id
LEFT JOIN users u ON u.id = n.recipient_user_id
LEFT JOIN uc_requests r ON r.id = n.request_id AND r.case_id = c.id
WHERE n.id = ${cast(n.id, "uuid")}`);
}

interface CaseModules {
  modules: { key: string; estimatedMinutes: number | null }[];
  roleLabels: Map<string, string>;
}

function parseCaseModules(row: Row | undefined): CaseModules {
  const modules = (rowJson<unknown[]>(row?.modules) ?? [])
    .filter((m): m is Record<string, unknown> => !!m && typeof m === "object" && typeof (m as Record<string, unknown>).key === "string")
    .map((m) => ({ key: String(m.key), estimatedMinutes: typeof m.estimated_minutes === "number" && Number.isFinite(m.estimated_minutes) ? m.estimated_minutes : null }));
  const fromCase = rowObject(row?.role_labels);
  const roleLabels = new Map<string, string>();
  for (const r of rowJson<unknown[]>(row?.roles) ?? []) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.key !== "string") continue;
    const custom = fromCase[o.key];
    const label = typeof custom === "string" && custom.trim() ? custom : typeof o.label === "string" && o.label.trim() ? o.label : null;
    if (label) roleLabels.set(o.key, label.trim().slice(0, 120));
  }
  return { modules, roleLabels };
}

function openItemsSql(caseId: string, requestId: string): UcStatement {
  return toStatement(ucSql`SELECT i.key, i.title FROM uc_request_items ri JOIN uc_items i ON i.id = ri.item_id AND i.case_id = ri.case_id
WHERE ri.case_id = ${cast(caseId, "uuid")} AND ri.request_id = ${cast(requestId, "uuid")} AND ri.state IN (${OPEN_ITEM_STATES_SQL}) AND i.deleted_at IS NULL
ORDER BY i.sort_order, i.key LIMIT 200`);
}

function itemTitleSql(caseId: string, itemId: string): UcStatement {
  return toStatement(ucSql`SELECT title FROM uc_items WHERE id = ${cast(itemId, "uuid")} AND case_id = ${cast(caseId, "uuid")} AND deleted_at IS NULL`);
}

const NEXT_MILESTONE_SQL = raw(`(SELECT jsonb_build_object('title', ms.title, 'planned_date', ms.planned_date::text, 'planned_label', ms.planned_label,
    'is_proposal', ms.is_proposal, 'to_confirm', ms.to_confirm)
   FROM uc_milestones ms WHERE ms.case_id = c.id AND ms.done_at IS NULL ORDER BY ms.sort_order, ms.planned_date NULLS LAST, ms.key LIMIT 1)`);

/** Casi del riepilogo: all'Owner i suoi casi in raccolta o oltre (non sospesi); a Lateral Space i suoi casi non chiusi. */
function weeklyCasesSql(i: { workspaceId: string; recipient: { contactId: string } | { userId: string } }): UcStatement {
  const who =
    "contactId" in i.recipient
      ? ucSql`c.status NOT IN ('bozza', 'chiuso', 'sospeso') AND ${CASE_OWNER_SQL} = ${cast(i.recipient.contactId, "uuid")}`
      : ucSql`c.status <> 'chiuso' AND EXISTS (SELECT 1 FROM uc_case_members m WHERE m.case_id = c.id AND m.user_id = ${cast(i.recipient.userId, "uuid")} AND m.role IN (${LS_ROLES_SQL}))`;
  const red =
    "contactId" in i.recipient
      ? raw(`coalesce((SELECT jsonb_agg(jsonb_build_object('key', x.key, 'title', x.title)) FROM (
      SELECT it.key, it.title FROM uc_items it WHERE it.case_id = c.id AND it.status = 'mancante' AND it.request_module_key IS NOT NULL AND it.deleted_at IS NULL
      ORDER BY it.sort_order, it.key LIMIT 10) x), '[]'::jsonb)`)
      : raw("'[]'::jsonb");
  return toStatement(ucSql`SELECT c.id, c.code, c.title, c.readiness, ${NEXT_MILESTONE_SQL} AS next_milestone, ${red} AS red_items
FROM uc_cases c
WHERE c.workspace_id = ${cast(i.workspaceId, "uuid")} AND c.setup_completed_at IS NOT NULL AND ${who}
ORDER BY c.code
LIMIT 50`);
}

function milestoneLabel(m: Record<string, Json>): string | null {
  if (typeof m.planned_label === "string" && m.planned_label.trim()) return m.planned_label.trim();
  if (typeof m.planned_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(m.planned_date)) return formatDateIt(new Date(`${m.planned_date}T12:00:00Z`));
  return null;
}

async function weeklyCases(executor: UcExecutor, n: ClaimedNotification, now: Date): Promise<(WeeklyCaseSummary & { caseId: string })[]> {
  const recipient = n.recipientContactId ? { contactId: n.recipientContactId } : n.recipientUserId ? { userId: n.recipientUserId } : null;
  if (!recipient) return [];
  const [rows] = await executor.batch([weeklyCasesSql({ workspaceId: n.workspaceId, recipient })]);
  const out: (WeeklyCaseSummary & { caseId: string })[] = [];
  for (const row of rows) {
    const caseId = String(row.id);
    let readiness = rowObject(row.readiness);
    if (!readiness.per_stato) {
      const live = await loadCaseReadiness(executor, n.workspaceId, caseId, now);
      readiness = live ? (live.readiness as unknown as Record<string, Json>) : {};
    }
    const perStato = rowObject(readiness.per_stato);
    const counts: Partial<Record<ItemStatus, number>> = {};
    for (const s of ITEM_STATUSES) {
      const v = rowNumber(perStato[s]);
      if (v !== null) counts[s] = v;
    }
    const g1 = rowObject(readiness.G1);
    const milestone = rowObject(row.next_milestone);
    out.push({
      caseId,
      code: String(row.code),
      title: String(row.title),
      total: rowNumber(readiness.scope_total) ?? 0,
      counts,
      greenPct: rowNumber(readiness.green_pct) ?? 0,
      g1: typeof g1.required === "number" ? { required: g1.required, ok: rowNumber(g1.ok) ?? 0 } : null,
      redItems: (rowJson<{ key: unknown; title: unknown }[]>(row.red_items) ?? [])
        .filter((x) => x && typeof x.key === "string" && typeof x.title === "string")
        .map((x) => ({ key: String(x.key), title: String(x.title) })),
      nextMilestone:
        typeof milestone.title === "string"
          ? { title: milestone.title, label: milestoneLabel(milestone), isProposal: milestone.is_proposal === true, toConfirm: milestone.to_confirm === true }
          : null,
    });
  }
  return out;
}

/**
 * Fatti di una riga email: caso, destinatario, richiesta e quello che serve al
 * modello. Nessun valore delle risposte; le email dei destinatari non escono da
 * qui se non verso il trasporto.
 */
export async function loadDeliveryFacts(executor: UcExecutor, n: ClaimedNotification, o: { lsDomains: readonly string[]; now: Date }): Promise<DeliveryFacts> {
  const statements: UcStatement[] = [factsSql(n)];
  const template = templatePartsReader();
  if (n.caseId && isUuid(n.caseId)) statements.push(caseModulesSql({ workspaceId: n.workspaceId, caseId: n.caseId }, template.columns));
  const [factRows, moduleRows] = await executor.batch(statements);
  const row = factRows[0];
  if (!row) throw new Error("Notifica non trovata");
  const caseStatus = rowVocab(CASE_STATUSES, row.case_status);
  const caseId = rowString(row.case_id);
  const designation = rowObject(row.signers_designation);
  const designated = (key: "owner" | "privacy"): string | null => {
    const d = designation[key];
    const id = d && typeof d === "object" && !Array.isArray(d) ? (d as Record<string, Json>).contact_id : null;
    return typeof id === "string" && isUuid(id) ? id : null;
  };
  const facts: DeliveryFacts = {
    clientName: String(row.client_name ?? ""),
    case:
      caseId && caseStatus
        ? {
            id: caseId,
            code: String(row.code ?? ""),
            title: String(row.title ?? ""),
            status: caseStatus,
            ownerContactId: rowString(row.owner_contact_id),
            designated: { owner: designated("owner"), privacy: designated("privacy") },
          }
        : null,
    recipient: null,
    request: null,
  };

  const contactId = rowString(row.contact_id);
  const userId = rowString(row.user_id);
  if (contactId) {
    facts.recipient = { kind: "contact", id: contactId, email: rowString(row.contact_email), reachable: rowBool(row.contact_reachable), digestOptOut: rowBool(row.digest_opt_out), lateralSpace: false };
  } else if (userId) {
    const user = userContextFrom({ id: userId, email: rowString(row.user_email), emailVerified: (row.user_email_verified as Date | string | null) ?? null }, o.lsDomains);
    facts.recipient = { kind: "user", id: userId, email: rowString(row.user_email), reachable: true, digestOptOut: false, lateralSpace: user.isLateralSpace };
  }

  const modules = parseCaseModules(caseModulesRow(moduleRows?.[0], template.read(moduleRows?.[0])));
  const requestId = rowString(row.request_id);
  const purpose = rowVocab(REQUEST_PURPOSES, row.purpose);
  const status = rowVocab(REQUEST_STATUSES, row.request_status);
  if (requestId && purpose && status) {
    const openModules = (rowJson<unknown[]>(row.open_modules) ?? []).map((m) => (typeof m === "string" && m ? m : null));
    const roleKey = rowString(row.acting_role_key);
    const request: DeliveryRequestFacts = {
      id: requestId,
      purpose,
      status,
      contactId: String(row.request_contact_id),
      delegatedByContactId: rowString(row.delegated_by_contact_id),
      live: rowBool(row.request_live),
      sentAt: rowDate(row.sent_at),
      expiresAt: rowDate(row.expires_at),
      reminderCount: rowNumber(row.reminder_count) ?? 0,
      escalatedAt: rowDate(row.escalated_at),
      openItems: openModules.length,
      minutes: openModules.length > 0 ? estimateMinutes(modules.modules, openModules.map((moduleKey) => ({ moduleKey }))) : null,
      message: rowString(row.message),
      roleLabel: roleKey ? (modules.roleLabels.get(roleKey) ?? null) : null,
    };
    facts.request = request;
  }

  if (!facts.case) {
    if (n.templateKey === "riepilogo_settimanale") facts.weekly = { cases: await weeklyCases(executor, n, o.now) };
    return facts;
  }
  const c = facts.case;
  switch (n.templateKey) {
    case "chiarimento": {
      const itemId = typeof n.payload.item_id === "string" && isUuid(n.payload.item_id) ? n.payload.item_id : null;
      if (itemId) {
        const [[item]] = await executor.batch([itemTitleSql(c.id, itemId)]);
        facts.itemTitle = rowString(item?.title);
      }
      break;
    }
    case "segnalazione_owner": {
      if (facts.request) {
        const [rows] = await executor.batch([openItemsSql(c.id, facts.request.id)]);
        facts.openItemList = rows.map((r) => ({ key: String(r.key), title: String(r.title ?? "") }));
      }
      break;
    }
    case "richiesta_approvazione": {
      const r = facts.request;
      const recipient = facts.recipient;
      if (r && recipient?.kind === "contact" && r.expiresAt) {
        const link: ResolvedLink = {
          tokenId: "",
          requestId: r.id,
          caseId: c.id,
          workspaceId: n.workspaceId,
          contactId: recipient.id,
          contactEmail: recipient.email,
          purpose: r.purpose,
          status: r.status,
          actingRoleKey: null,
          delegationDepth: 0,
          expiresAt: r.expiresAt,
          opened: false,
          privacyAckAt: null,
          privacyNoticeVersion: null,
          caseStatus: c.status,
          caseCode: c.code,
          caseTitle: c.title,
          clientLabel: facts.clientName,
          live: r.live,
        };
        const core = await loadCaseCore(executor, n.workspaceId, c.id);
        const pending = (await loadApprovals(executor, link)).length;
        const signature = core ? await loadSignatureContext(executor, core, o.lsDomains) : null;
        facts.approvals = {
          pending,
          signer: signature ? checkSignerEmail(recipient.email, o.lsDomains, signature.lsMemberEmails) : { ok: false, code: "caso_assente", message: "" },
        };
      }
      break;
    }
    case "riepilogo_settimanale":
      facts.weekly = { cases: await weeklyCases(executor, n, o.now) };
      break;
  }
  return facts;
}

// ── Motore sull'esecutore ─────────────────────────────────────────────

/** `DispatchStore` sul database. */
export function createDispatchStore(executor: UcExecutor, o: { lsDomains: readonly string[]; now: Date }): DispatchStore {
  return {
    async markInAppDelivered(scope) {
      const [rows] = await executor.batch([markInAppDeliveredSql(scope)]);
      return count(rows);
    },
    async holdUnconfigured(scope) {
      const [rows] = await executor.batch([holdUnconfiguredSql(scope)]);
      return count(rows);
    },
    claimDue: (i) => claimDue(executor, i),
    loadFacts: (n) => loadDeliveryFacts(executor, n, o),
    async issueToken(i) {
      const r = await issueRequestToken(executor, i);
      return r.ok ? { ok: true, token: r.value.token, tokenId: r.value.tokenId } : { ok: false, code: r.code };
    },
    revokeToken: (i) => revokeIssuedToken(executor, i),
    markSent: (n, after) => markSent(executor, n, after),
    async markFailed(n, code) {
      await executor.batch([markFailedSql(n, code)]);
    },
    async markHeld(n, reason) {
      await executor.batch([markHeldSql(n, reason)]);
    },
    async markCancelled(n, reason) {
      await executor.batch([markCancelledSql(n, reason)]);
    },
  };
}

export interface DispatchQueueOptions {
  env: DispatchEnv;
  lsDomains?: readonly string[];
  now?: Date;
  caseId?: string | null;
  workspaceId?: string | null;
  limit?: number;
  mailer?: UcMailer;
  sendIntervalMs?: number;
}

/** Un giro di invio sull'esecutore indicato (cron, test). */
export async function dispatchQueue(executor: UcExecutor, o: DispatchQueueOptions): Promise<DispatchSummary> {
  const now = o.now ?? new Date();
  const lsDomains = o.lsDomains ?? parseLsDomains(o.env.UC_LS_EMAIL_DOMAINS);
  return runDispatch(createDispatchStore(executor, { lsDomains, now }), {
    env: o.env,
    lsDomains,
    now,
    caseId: o.caseId ?? null,
    workspaceId: o.workspaceId ?? null,
    limit: o.limit,
    mailer: o.mailer,
    sendIntervalMs: o.sendIntervalMs,
  });
}

const EMPTY_SUMMARY: DispatchSummary = { bell: 0, sent: 0, failed: 0, held: 0, cancelled: 0, notConfigured: 0 };

/**
 * Invia la coda arrivata a scadenza (dopo un comando, in `after()`, e nei cron).
 * Con la sezione spenta non fa nulla. Dopo un comando (`caseId`) il giro è più
 * corto: le righe in più partono col cron.
 */
export async function dispatchDue(
  options: { caseId?: string | null; limit?: number; executor?: UcExecutor; env?: DispatchEnv; now?: Date; mailer?: UcMailer } = {},
): Promise<DispatchSummary> {
  const env: DispatchEnv = options.env ?? process.env;
  if (env.UC_ENABLED !== "true") return { ...EMPTY_SUMMARY };
  if (options.caseId && !isUuid(options.caseId)) return { ...EMPTY_SUMMARY };
  const executor = options.executor ?? (await getAppUcExecutor());
  const limit = options.limit ?? (options.caseId ? DISPATCH_AFTER_COMMAND_LIMIT : undefined);
  return dispatchQueue(executor, { env, now: options.now, caseId: options.caseId ?? null, limit, mailer: options.mailer });
}

// ── Campanella ────────────────────────────────────────────────────────

/** Inizio del giorno di Roma di un istante SQL, come `timestamptz`. */
function romeDayStart(at: string): SqlFragment {
  return raw(`(date_trunc('day', ${at} AT TIME ZONE 'Europe/Rome') AT TIME ZONE 'Europe/Rome')`);
}

/**
 * Inizio del giorno dopo a Roma, come `timestamptz`. Il giorno si aggiunge
 * all'ora locale prima di tornare a `timestamptz`: un `timestamptz + interval
 * '1 day'` segue il `TimeZone` della sessione (UTC su Neon) e sbaglia di un'ora
 * nei giorni del cambio d'ora, che a Roma durano 23 o 25 ore.
 */
function romeNextDayStart(at: string): SqlFragment {
  return raw(`((date_trunc('day', ${at} AT TIME ZONE 'Europe/Rome') + interval '1 day') AT TIME ZONE 'Europe/Rome')`);
}

/**
 * Ultime notifiche non lette dell'utente: solo `in_app`, solo dove è ancora
 * membro Lateral Space del caso (o di un caso del workspace, per il riepilogo).
 * Con ogni riga si leggono adesso, non dal payload: codice e titolo del dossier
 * e della scheda madre (`to_jsonb(u) ->> 'code'`: senza la colonna vale NULL) e,
 * per le risposte, quante ne sono arrivate quel giorno dai referenti.
 * `workspaceIds`: solo i workspace accesi (null = tutti).
 */
export function unreadBellSql(i: { userId: string; workspaceId: string | null; limit: number; workspaceIds?: readonly string[] | null }): UcStatement {
  const limit = Math.max(1, Math.min(Math.trunc(i.limit), 50));
  const workspace = i.workspaceId ? ucSql` AND n.workspace_id = ${cast(i.workspaceId, "uuid")}` : raw("");
  const enabled = i.workspaceIds ? ucSql` AND n.workspace_id = ANY(${cast([...i.workspaceIds], "uuid[]")})` : raw("");
  const user = cast(i.userId, "uuid");
  const dayStart = romeDayStart("n.created_at");
  const nextDayStart = romeNextDayStart("n.created_at");
  return toStatement(ucSql`SELECT n.id, n.workspace_id, n.case_id, n.template_key, n.payload, n.created_at,
  c.code AS case_code, c.title AS case_title, to_jsonb(u) ->> 'code' AS use_case_code, u.title AS use_case_title,
  CASE WHEN n.template_key = 'risposta_ricevuta' AND n.case_id IS NOT NULL THEN (
    SELECT count(DISTINCT a.item_id)::int FROM uc_answers a
    WHERE a.case_id = n.case_id AND a.responder_contact_id IS NOT NULL
      AND a.created_at >= ${dayStart} AND a.created_at < ${nextDayStart}
  ) END AS answers
FROM uc_notifications n
LEFT JOIN uc_cases c ON c.id = n.case_id
LEFT JOIN use_cases u ON u.id = c.portfolio_use_case_id AND u.workspace_id = c.workspace_id
WHERE n.recipient_user_id = ${user} AND n.channel = 'in_app' AND n.read_at IS NULL
  AND n.status IN ('in_coda', 'inviata') AND n.scheduled_at <= now()${workspace}${enabled}
  AND CASE WHEN n.case_id IS NOT NULL
    THEN EXISTS (SELECT 1 FROM uc_case_members m JOIN uc_cases mc ON mc.id = m.case_id
      WHERE m.case_id = n.case_id AND m.user_id = n.recipient_user_id AND m.role IN (${LS_ROLES_SQL}) AND mc.setup_completed_at IS NOT NULL)
    ELSE EXISTS (SELECT 1 FROM uc_case_members m JOIN uc_cases mc ON mc.id = m.case_id
      WHERE mc.workspace_id = n.workspace_id AND m.user_id = n.recipient_user_id AND m.role IN (${LS_ROLES_SQL}) AND mc.setup_completed_at IS NOT NULL)
  END
ORDER BY n.created_at DESC, n.id
LIMIT ${cast(limit, "int")}`);
}

/**
 * Segna lette le notifiche della campanella dell'utente: tutte quelle del
 * workspace, oppure una riga. Una riga di risposte raggruppate (stesso
 * dossier, stesso giorno a Roma) si segna tutta insieme, così la campanella non
 * la ripropone con le altre notifiche del gruppo.
 */
/** `upTo` (solo «Segna tutte come lette» della campanella): non oltre le righe che la persona ha visto. */
export function markBellReadSql(i: { userId: string; workspaceId: string; notificationId?: string | null; upTo?: Date | null }): UcStatement {
  const one = i.notificationId
    ? ucSql` AND (id = ${cast(i.notificationId, "uuid")} OR (template_key = 'risposta_ricevuta' AND EXISTS (
    SELECT 1 FROM uc_notifications t
    WHERE t.id = ${cast(i.notificationId, "uuid")} AND t.recipient_user_id = uc_notifications.recipient_user_id
      AND t.template_key = 'risposta_ricevuta' AND t.case_id = uc_notifications.case_id
      AND ${romeDayStart("t.created_at")} = ${romeDayStart("uc_notifications.created_at")})))`
    : raw("");
  // Troncato ai millisecondi come `latestAt` del payload (ISO), altrimenti l'ultima riga vista resterebbe fuori.
  const upTo =
    i.upTo instanceof Date && !Number.isNaN(i.upTo.getTime())
      ? ucSql` AND date_trunc('milliseconds', created_at) <= least(${cast(i.upTo.toISOString(), "timestamptz")}, now())`
      : raw("");
  return toStatement(ucSql`WITH u AS (
  UPDATE uc_notifications SET read_at = now()
  WHERE recipient_user_id = ${cast(i.userId, "uuid")} AND workspace_id = ${cast(i.workspaceId, "uuid")} AND channel = 'in_app' AND read_at IS NULL${one}${upTo}
  RETURNING 1
)
SELECT count(*)::int AS n FROM u`);
}

export async function listUnreadBell(
  executor: UcExecutor,
  i: { userId: string; workspaceId?: string | null; limit?: number; workspaceIds?: readonly string[] | null; now?: Date },
): Promise<UcBellItem[]> {
  if (!isUuid(i.userId) || (i.workspaceId && !isUuid(i.workspaceId))) return [];
  if (i.workspaceIds && i.workspaceIds.length === 0) return [];
  const [rows] = await executor.batch([unreadBellSql({ userId: i.userId, workspaceId: i.workspaceId ?? null, limit: i.limit ?? 20, workspaceIds: i.workspaceIds ?? null })]);
  const out: UcBellRow[] = [];
  for (const r of rows) {
    const id = rowString(r.id);
    const workspaceId = rowString(r.workspace_id);
    const templateKey = rowString(r.template_key);
    if (!isUuid(id) || !isUuid(workspaceId) || !templateKey) continue;
    out.push({
      id,
      workspaceId,
      caseId: rowString(r.case_id),
      templateKey,
      payload: rowObject(r.payload),
      createdAt: rowDate(r.created_at) ?? new Date(0),
      caseCode: rowString(r.case_code),
      caseTitle: rowString(r.case_title),
      useCaseCode: rowString(r.use_case_code),
      useCaseTitle: rowString(r.use_case_title),
      answers: rowNumber(r.answers),
    });
  }
  return toBellItems(out, i.now ?? new Date());
}

export async function markBellRead(executor: UcExecutor, i: { userId: string; workspaceId: string; notificationId?: string | null; upTo?: Date | null }): Promise<number> {
  if (!isUuid(i.userId) || !isUuid(i.workspaceId) || (i.notificationId && !isUuid(i.notificationId))) return 0;
  const [rows] = await executor.batch([markBellReadSql(i)]);
  return count(rows);
}

/** Le tabelle della campanella esistono? Il self-heal uc parte solo dalle query uc (§5.2). */
async function bellTablesPresent(executor: UcExecutor): Promise<boolean> {
  const [[row]] = await executor.batch([
    toStatement(ucSql`SELECT to_regclass('public.uc_notifications') IS NOT NULL AND to_regclass('public.uc_case_members') IS NOT NULL
  AND to_regclass('public.uc_cases') IS NOT NULL AND to_regclass('public.uc_answers') IS NOT NULL AS ok`),
  ]);
  return rowBool(row?.ok);
}

/**
 * Ultime notifiche non lette della campanella per l'utente: solo con la sezione
 * accesa per il workspace (`UC_ENABLED` e `UC_WORKSPACE_IDS`, P0-1), le tabelle
 * presenti e l'utente di Lateral Space (email verificata in un dominio di
 * `UC_LS_EMAIL_DOMAINS`, ricontrollata adesso). Senza `workspaceId`, solo i
 * workspace accesi.
 */
export async function unreadForUser(
  userId: string,
  options: { workspaceId?: string; limit?: number; executor?: UcExecutor; env?: DispatchEnv; now?: Date } = {},
): Promise<UcBellItem[]> {
  const env: DispatchEnv = options.env ?? process.env;
  if (env.UC_ENABLED !== "true" || !isUuid(userId)) return [];
  if (options.workspaceId !== undefined && !isUuid(options.workspaceId)) return [];
  const rollout = { UC_WORKSPACE_IDS: env.UC_WORKSPACE_IDS, VERCEL_ENV: env.VERCEL_ENV };
  if (options.workspaceId !== undefined && !isUcWorkspaceEnabled(options.workspaceId, rollout)) return [];
  const workspaceIds = options.workspaceId !== undefined ? null : cronWorkspaceFilter(ucCronWorkspaceScope(rollout));
  if (workspaceIds && workspaceIds.length === 0) return [];
  const executor = options.executor ?? (await getAppUcExecutor());
  if (!(await bellTablesPresent(executor))) return [];
  const user = await loadUserContext(executor, userId, parseLsDomains(env.UC_LS_EMAIL_DOMAINS));
  if (!user?.isLateralSpace) return [];
  return listUnreadBell(executor, { userId, workspaceId: options.workspaceId ?? null, limit: options.limit ?? 20, workspaceIds, now: options.now });
}
