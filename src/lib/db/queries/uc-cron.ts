/**
 * Lavori notturni e quotidiani della sezione «Casi d'uso» (PIANO §5.7, §7.1).
 *
 * `runRemindersCron` (`/api/cron/uc-reminders`, lun–ven):
 * 1. richieste oltre `expires_at` → `scaduta`, e le loro voci ancora `chiesta`
 *    → `mancante` «Link scaduto senza risposta» (riga 7d), nello stesso batch;
 * 2. voci `chiesta` con scadenza passata dopo 2 promemoria → `mancante`
 *    «Scaduta dopo 2 promemoria» (riga 7a);
 * 3. solo nella finestra d'invio di Roma: promemoria 1 e 2 al referente e
 *    segnalazione all'Owner (`reminderAction`); senza Owner raggiungibile la
 *    campanella di Lateral Space dice «Owner da indicare»;
 * 4. il primo giorno lavorativo della settimana, nella finestra: riepilogo
 *    settimanale all'Owner del cliente e ai membri Lateral Space (email e
 *    campanella);
 * 5. invio della coda arrivata a scadenza (`dispatchQueue`).
 *
 * `runFreshnessCron` (`/api/cron/uc-freshness`, ogni notte):
 * 1. dati validati scaduti → `in_verifica` «dato scaduto» (riga 24), con la
 *    campanella `dato_scaduto` scritta da `applyItemTransitions`;
 * 2. cache `readiness` ricalcolata per ogni caso aperto;
 * 3. `uc_rate_limits` più vecchi di 2 giorni cancellati;
 * 4. pulizia della quarantena (`cleanupQuarantine`) e conservazione: file dei
 *    casi chiusi da oltre 30 giorni tolti dagli archivi (`expireRetainedFiles`);
 * 5. invio della coda (campanella).
 *
 * Tutte le transizioni passano da `applyItemTransitions` con l'attore
 * `sistema` (il job del cron): stesse guardie, stessi CAS, stessi eventi dei
 * comandi interni. Un errore su un caso non ferma gli altri: si conta e si
 * registra solo il codice. Le notifiche contengono solo chiavi, conteggi e id.
 *
 * Modulo senza import dell'app (`@/…`, `server-only`): l'esecutore arriva da
 * fuori, così lo provano i test di integrazione sul harness locale.
 */
import { itemsToExpire } from "../../uc/freshness.ts";
import { dedupeKey, bellPrefix } from "../../uc/notify/dedupe.ts";
import {
  DISPATCH_BATCH_LIMIT,
  RATE_LIMIT_CODE,
  ROME_WORKING_CALENDAR,
  SEND_INTERVAL_MS,
  createResendMailer,
  ucEmailConfig,
  type DispatchEnv,
  type DispatchSummary,
  type UcMailer,
} from "../../uc/notify/dispatch.ts";
import { inRomeSendWindow, itemsToMarkMissing, reminderAction, requestsToExpire, weeklySummaryDue } from "../../uc/notify/schedule.ts";
import { rowBool, rowDate, rowJson, rowNumber, rowString, rowVocab, type Row } from "../../uc/sql/readiness.ts";
import { requestLiveSql } from "../../uc/sql/requests.ts";
import { cast, raw, requireRows, toStatement, ucSql, type SqlFragment, type UcStatement } from "../../uc/sql/statement.ts";
import type { TransitionRequest } from "../../uc/sql/transitions.ts";
import { fail, type Result } from "../../uc/types.ts";
import { CASE_STATUSES, LS_CASE_ROLES, REQUEST_PURPOSES, REQUEST_STATUSES, type CaseStatus, type RequestPurpose, type RequestStatus } from "../../uc/vocab.ts";
import type { UcExecutor } from "../uc-executor.ts";
import { isUuid, refreshReadinessCache, runCommand, type UcCommandContext } from "./uc-cases.ts";
import { eventInsertSql } from "./uc-events.ts";
import { cleanupQuarantine, type UcFilesEnv } from "./uc-files.ts";
import { expireRetainedFiles, type RetentionSummary } from "./uc-retention.ts";
import { applyItemTransitions } from "./uc-items.ts";
import { CASE_OWNER_SQL, dispatchQueue } from "./uc-notifications-dispatch.ts";
import { enqueueForLsMembersSql, enqueueSql } from "./uc-notifications.ts";

const WAITING_SQL = raw("'inviata', 'aperta', 'in_corso'");
const OPEN_ITEM_STATES_SQL = raw("'da_fare', 'bozza'");
const LS_ROLES_SQL = raw(LS_CASE_ROLES.map((r) => `'${r}'`).join(", "));
/** Voci per batch di transizioni (come le azioni in blocco). */
const TRANSITION_CHUNK = 500;
/** Tempo che un cron si concede prima di lasciare il resto al giro dopo (`maxDuration = 120`). */
const DEFAULT_BUDGET_MS = 90_000;
/** Righe di `uc_rate_limits` più vecchie di così si cancellano. */
const RATE_LIMIT_RETENTION_MS = 2 * 86_400_000;

export type UcCronEnv = DispatchEnv & UcFilesEnv;

export interface UcCronOptions {
  env: UcCronEnv;
  lsDomains: readonly string[];
  now?: Date;
  /** Trasporto delle email (test); di default Resend con la chiave dell'ambiente. */
  mailer?: UcMailer;
  sendIntervalMs?: number;
  /** `false`: niente invio della coda alla fine (test). */
  dispatch?: boolean;
  /** Tempo massimo prima di lasciare il resto al giro dopo. */
  budgetMs?: number;
  /**
   * Solo un workspace (operatore, test sul harness). Senza, tutti. Con un
   * workspace le pulizie globali (limiti, quarantena) non girano e la
   * conservazione dei file guarda solo quel workspace.
   */
  workspaceId?: string | null;
  /**
   * Accensione per workspace (DESIGN §7.1 P0-1): i workspace di
   * `UC_WORKSPACE_IDS` (`ucCronWorkspaceScope`). `null` o assente = tutti; un
   * elenco vuoto = nessuno. Solleciti, riepiloghi, dati scaduti, prontezza e
   * invio della coda girano solo qui; le pulizie globali e la conservazione
   * dei file (un obbligo di privacy, non una funzione) girano comunque.
   */
  workspaceIds?: readonly string[] | null;
}

type Job = "uc-reminders" | "uc-freshness";

function systemCtx(job: Job, workspaceId: string, caseId: string, o: { lsDomains: readonly string[]; now: Date }): UcCommandContext {
  return { workspaceId, caseId, actor: { type: "sistema", job }, user: null, lsDomains: o.lsDomains, now: o.now };
}

function at(now: Date) {
  return cast(now.toISOString(), "timestamptz");
}

/** Filtro sui workspace: uno (operatore), un elenco (accensione) o nessuno (`null` = tutti). */
export type WorkspaceFilter = string | readonly string[] | null | undefined;

/** Filtro facoltativo sul workspace dei casi (alias `c`). Un elenco vuoto non trova nulla. */
function inWorkspace(filter: WorkspaceFilter): SqlFragment {
  if (filter === null || filter === undefined || filter === "") return raw("");
  if (typeof filter === "string") {
    if (!isUuid(filter)) throw new Error("Workspace non valido");
    return ucSql` AND c.workspace_id = ${cast(filter, "uuid")}`;
  }
  if (filter.some((id) => !isUuid(id))) throw new Error("Workspace non valido");
  if (filter.length === 0) return raw(" AND false");
  return ucSql` AND c.workspace_id = ANY(${cast([...filter], "uuid[]")})`;
}

/** Il filtro di un giro: il workspace dell'operatore, dentro l'elenco acceso se c'è. */
export function cronWorkspaceFilterOf(o: Pick<UcCronOptions, "workspaceId" | "workspaceIds">): WorkspaceFilter {
  const list = o.workspaceIds ?? null;
  if (o.workspaceId) {
    if (list && !list.some((id) => id.toLowerCase() === o.workspaceId!.toLowerCase())) return [];
    return o.workspaceId;
  }
  return list;
}

const EMPTY_DISPATCH: DispatchSummary = { bell: 0, sent: 0, failed: 0, held: 0, cancelled: 0, notConfigured: 0 };

/**
 * Un solo trasporto per tutto il giro: la pausa tra due invii vale anche da un
 * workspace al successivo, e il primo «troppe richieste» resta visibile fuori
 * da `dispatchQueue`, che lo conta solo come `failed`.
 */
export function sharedMailer(inner: UcMailer, intervalMs: number): { mailer: UcMailer; rateLimited: () => boolean } {
  let lastCall = 0;
  let limited = false;
  return {
    rateLimited: () => limited,
    mailer: {
      async send(email, options) {
        const wait = lastCall + intervalMs - Date.now();
        if (lastCall > 0 && wait > 0) await new Promise<void>((resolve) => setTimeout(resolve, wait));
        try {
          const result = await inner.send(email, options);
          if (!result.ok && result.code === RATE_LIMIT_CODE) limited = true;
          return result;
        } finally {
          lastCall = Date.now();
        }
      },
    },
  };
}

/**
 * Invio sull'elenco acceso, un workspace alla volta, con un solo budget di
 * `limit` email per tutto il giro (come l'invio unico di prima dell'accensione
 * per workspace): ogni workspace ne prende una parte uguale di quelle che
 * restano, e quelle che non usa passano ai successivi. Il primo workspace parte
 * sempre; i successivi no dopo un «troppe richieste» o a tempo finito
 * (`deferred`: il resto al giro dopo).
 */
export async function dispatchAcrossWorkspaces(
  workspaceIds: readonly string[],
  send: (workspaceId: string, limit: number) => Promise<DispatchSummary>,
  o: { limit: number; timeLeft: () => boolean; rateLimited: () => boolean },
): Promise<{ summary: DispatchSummary; deferred: boolean }> {
  const summary: DispatchSummary = { ...EMPTY_DISPATCH };
  let remaining = o.limit;
  for (let i = 0; i < workspaceIds.length; i++) {
    if (i > 0) {
      if (remaining <= 0 || o.rateLimited()) break;
      if (!o.timeLeft()) return { summary, deferred: true };
    }
    const part = await send(workspaceIds[i], Math.ceil(remaining / (workspaceIds.length - i)));
    for (const key of Object.keys(summary) as (keyof DispatchSummary)[]) summary[key] += part[key];
    remaining -= part.sent + part.failed + part.held + part.cancelled;
  }
  return { summary, deferred: false };
}

/**
 * Invio della coda sui workspace del giro: uno solo, tutti, oppure l'elenco
 * acceso con un budget comune (`dispatchAcrossWorkspaces`; le righe dei
 * workspace spenti restano in coda).
 */
async function dispatchScoped(
  executor: UcExecutor,
  o: UcCronOptions,
  now: Date,
  filter: WorkspaceFilter,
  timeLeft: () => boolean,
): Promise<{ summary: DispatchSummary; deferred: boolean }> {
  const base = { env: o.env, lsDomains: o.lsDomains, now, sendIntervalMs: o.sendIntervalMs };
  if (filter === null || filter === undefined || typeof filter === "string") {
    return { summary: await dispatchQueue(executor, { ...base, mailer: o.mailer, workspaceId: filter ?? null }), deferred: false };
  }
  const configured = ucEmailConfig(o.env);
  const inner = o.mailer ?? (configured.ok ? createResendMailer(configured.config.apiKey) : null);
  const shared = inner ? sharedMailer(inner, Math.max(0, o.sendIntervalMs ?? SEND_INTERVAL_MS)) : null;
  return dispatchAcrossWorkspaces(filter, (workspaceId, limit) => dispatchQueue(executor, { ...base, mailer: shared?.mailer, workspaceId, limit }), {
    limit: DISPATCH_BATCH_LIMIT,
    timeLeft,
    rateLimited: () => shared?.rateLimited() ?? false,
  });
}

function errorCode(error: unknown): string {
  return error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : "errore";
}

function logFailure(job: Job, step: string, code: string): void {
  // Solo il passo e il codice: mai id di persone, indirizzi, link o valori.
  console.error(`[uc] ${job}: ${step} non riuscito`, code);
}

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function groupBy<T>(list: readonly T[], key: (x: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const x of list) {
    const k = key(x);
    const bucket = out.get(k);
    if (bucket) bucket.push(x);
    else out.set(k, [x]);
  }
  return out;
}

// ── Riga 7d: link scaduti ─────────────────────────────────────────────

export interface ExpiringRequest {
  id: string;
  caseId: string;
  workspaceId: string;
  status: RequestStatus;
  expiresAt: Date | null;
  reminderCount: number;
  /** Voci ancora `chiesta` con la riga della richiesta da fare o in bozza. */
  askedItemIds: string[];
}

/** Richieste in attesa oltre la scadenza, nei casi aperti e non in pausa. */
export function expiringRequestsSql(now: Date, limit = 500, workspaceId: WorkspaceFilter = null): UcStatement {
  return toStatement(ucSql`SELECT r.id, r.case_id, c.workspace_id, r.status, r.expires_at, r.reminder_count,
  coalesce((SELECT jsonb_agg(i.id ORDER BY i.id) FROM uc_request_items ri JOIN uc_items i ON i.id = ri.item_id AND i.case_id = ri.case_id
    WHERE ri.request_id = r.id AND ri.state IN (${OPEN_ITEM_STATES_SQL}) AND i.status = 'chiesta' AND i.deleted_at IS NULL), '[]'::jsonb) AS asked_items
FROM uc_requests r JOIN uc_cases c ON c.id = r.case_id
WHERE r.status IN (${WAITING_SQL}) AND r.revoked_at IS NULL AND r.expires_at IS NOT NULL AND r.expires_at <= ${at(now)}
  AND c.setup_completed_at IS NOT NULL AND c.status NOT IN ('chiuso', 'sospeso')${inWorkspace(workspaceId)}
ORDER BY r.expires_at, r.id
LIMIT ${cast(Math.max(1, Math.min(Math.trunc(limit), 2000)), "int")}`);
}

export function rowToExpiringRequest(row: Row): ExpiringRequest | null {
  const status = rowVocab(REQUEST_STATUSES, row.status);
  const id = rowString(row.id);
  const caseId = rowString(row.case_id);
  const workspaceId = rowString(row.workspace_id);
  if (!status || !isUuid(id) || !isUuid(caseId) || !isUuid(workspaceId)) return null;
  const asked = (rowJson<unknown[]>(row.asked_items) ?? []).filter((x): x is string => isUuid(x));
  return { id, caseId, workspaceId, status, expiresAt: rowDate(row.expires_at), reminderCount: rowNumber(row.reminder_count) ?? 0, askedItemIds: [...new Set(asked)] };
}

/** `scaduta` solo se è ancora in attesa, scaduta e il caso non è chiuso né in pausa (CAS). */
export function requestExpireSql(r: Pick<ExpiringRequest, "id" | "caseId">, now: Date): UcStatement {
  return toStatement(
    requireRows(
      ucSql`UPDATE uc_requests SET status = 'scaduta', next_reminder_at = NULL, updated_at = now()
WHERE id = ${cast(r.id, "uuid")} AND case_id = ${cast(r.caseId, "uuid")} AND status IN (${WAITING_SQL}) AND revoked_at IS NULL
  AND expires_at IS NOT NULL AND expires_at <= ${at(now)}
  AND EXISTS (SELECT 1 FROM uc_cases c WHERE c.id = uc_requests.case_id AND c.status NOT IN ('chiuso', 'sospeso'))
RETURNING id`,
      1,
      "conflitto",
    ),
  );
}

/** Le righe ancora attive della richiesta scaduta si liberano: la voce si può chiedere di nuovo. */
export function expiredRequestItemsReleaseSql(r: Pick<ExpiringRequest, "id" | "caseId">): UcStatement {
  return toStatement(ucSql`UPDATE uc_request_items SET state = 'riassegnata'
WHERE case_id = ${cast(r.caseId, "uuid")} AND request_id = ${cast(r.id, "uuid")} AND state IN (${OPEN_ITEM_STATES_SQL})`);
}

/** Notifiche ancora in coda della richiesta scaduta: annullate (nessun promemoria su un link morto). */
export function expiredRequestNotificationsCancelSql(r: Pick<ExpiringRequest, "id" | "caseId">): UcStatement {
  return toStatement(ucSql`UPDATE uc_notifications SET status = 'annullata', error = 'richiesta_scaduta', hold_reason = NULL
WHERE request_id = ${cast(r.id, "uuid")} AND case_id = ${cast(r.caseId, "uuid")} AND status IN ('in_coda', 'errore')`);
}

function requestExpiredEventSql(r: ExpiringRequest): UcStatement {
  return toStatement(
    eventInsertSql({
      type: "richiesta.scaduta",
      workspaceId: r.workspaceId,
      caseId: r.caseId,
      actor: { type: "sistema" },
      targetType: "richiesta",
      targetId: r.id,
      fromState: r.status,
      toState: "scaduta",
      payload: { items: r.askedItemIds.length },
    }),
  );
}

/**
 * Una richiesta scaduta: stato, evento, voci `chiesta` → `mancante` (riga 7d),
 * righe della richiesta liberate e coda annullata, tutto in un batch.
 */
export async function expireRequest(executor: UcExecutor, r: ExpiringRequest, o: { lsDomains: readonly string[]; now: Date }): Promise<Result<{ items: number }>> {
  const before = [requestExpireSql(r, o.now), requestExpiredEventSql(r)];
  const after = [expiredRequestItemsReleaseSql(r), expiredRequestNotificationsCancelSql(r)];
  if (r.askedItemIds.length === 0) {
    const run = await runCommand(executor, [...before, ...after]);
    return run.ok ? { ok: true, value: { items: 0 } } : run;
  }
  if (r.askedItemIds.length > 5000) return fail("troppe_voci", "Troppe voci in una richiesta.");
  const request = { reminderCount: r.reminderCount, expiresAt: r.expiresAt };
  const applied = await applyItemTransitions(executor, systemCtx("uc-reminders", r.workspaceId, r.caseId, o), {
    itemIds: r.askedItemIds,
    transitions: r.askedItemIds.map((itemId): TransitionRequest => ({ itemId, to: "mancante", trigger: "scadenza", request })),
    before,
    after,
  });
  return applied.ok ? { ok: true, value: { items: applied.value.applied.length } } : applied;
}

// ── Riga 7a: scadute dopo 2 promemoria ────────────────────────────────

export interface OverdueItem {
  id: string;
  caseId: string;
  workspaceId: string;
  dueAt: Date | null;
  reminderCount: number;
  expiresAt: Date | null;
}

/** Voci `chiesta` con la scadenza passata in una richiesta con 2 promemoria già inviati. */
export function overdueItemsSql(now: Date, limit = 5000, workspaceId: WorkspaceFilter = null): UcStatement {
  return toStatement(ucSql`SELECT DISTINCT ON (i.id) i.id, i.case_id, c.workspace_id, i.status, i.due_at, r.reminder_count, r.expires_at
FROM uc_items i
JOIN uc_cases c ON c.id = i.case_id
JOIN uc_request_items ri ON ri.item_id = i.id AND ri.case_id = i.case_id AND ri.state IN (${OPEN_ITEM_STATES_SQL})
JOIN uc_requests r ON r.id = ri.request_id AND r.case_id = ri.case_id
WHERE i.status = 'chiesta' AND i.deleted_at IS NULL AND i.due_at IS NOT NULL AND i.due_at < ${at(now)} AND r.reminder_count >= 2
  AND c.setup_completed_at IS NOT NULL AND c.status NOT IN ('chiuso', 'sospeso')${inWorkspace(workspaceId)}
ORDER BY i.id, r.reminder_count DESC
LIMIT ${cast(Math.max(1, Math.min(Math.trunc(limit), 20_000)), "int")}`);
}

export function rowToOverdueItem(row: Row): OverdueItem | null {
  const id = rowString(row.id);
  const caseId = rowString(row.case_id);
  const workspaceId = rowString(row.workspace_id);
  if (!isUuid(id) || !isUuid(caseId) || !isUuid(workspaceId)) return null;
  return { id, caseId, workspaceId, dueAt: rowDate(row.due_at), reminderCount: rowNumber(row.reminder_count) ?? 0, expiresAt: rowDate(row.expires_at) };
}

async function markOverdueMissing(executor: UcExecutor, items: readonly OverdueItem[], o: { lsDomains: readonly string[]; now: Date }): Promise<Result<number>> {
  const first = items[0];
  const applied = await applyItemTransitions(executor, systemCtx("uc-reminders", first.workspaceId, first.caseId, o), {
    itemIds: items.map((i) => i.id),
    transitions: items.map(
      (i): TransitionRequest => ({ itemId: i.id, to: "mancante", trigger: "scadenza", request: { reminderCount: i.reminderCount, expiresAt: i.expiresAt }, dueAt: i.dueAt }),
    ),
  });
  return applied.ok ? { ok: true, value: applied.value.applied.length } : applied;
}

// ── Solleciti ─────────────────────────────────────────────────────────

export interface ReminderCandidate {
  requestId: string;
  caseId: string;
  workspaceId: string;
  caseCode: string;
  caseStatus: CaseStatus;
  status: RequestStatus;
  purpose: RequestPurpose;
  sentAt: Date | null;
  expiresAt: Date | null;
  reminderCount: number;
  escalatedAt: Date | null;
  contactId: string;
  /** Referente attivo, non anonimizzato, con un'email. */
  contactReachable: boolean;
  ownerContactId: string | null;
  /** Owner attivo, non anonimizzato, con un'email. */
  ownerReachable: boolean;
}

/** Richieste di raccolta vive, inviate, con voci ancora da fare. */
export function reminderCandidatesSql(limit = 2000, workspaceId: WorkspaceFilter = null): UcStatement {
  return toStatement(ucSql`SELECT r.id, r.case_id, c.workspace_id, c.code, c.status AS case_status, r.status, r.purpose, r.sent_at, r.expires_at,
  r.reminder_count, r.escalated_at, r.contact_id,
  (ct.email IS NOT NULL AND ct.is_active AND ct.anonymized_at IS NULL) AS contact_reachable,
  ${CASE_OWNER_SQL} AS owner_contact_id,
  EXISTS (SELECT 1 FROM uc_contacts o WHERE o.id = ${CASE_OWNER_SQL} AND o.workspace_id = c.workspace_id
    AND o.email IS NOT NULL AND o.is_active AND o.anonymized_at IS NULL) AS owner_reachable
FROM uc_requests r
JOIN uc_cases c ON c.id = r.case_id
JOIN uc_contacts ct ON ct.id = r.contact_id
WHERE r.purpose = 'raccolta' AND r.status IN (${WAITING_SQL}) AND r.sent_at IS NOT NULL AND ${requestLiveSql("r", "c")}${inWorkspace(workspaceId)}
  AND EXISTS (SELECT 1 FROM uc_request_items ri WHERE ri.request_id = r.id AND ri.case_id = r.case_id AND ri.state IN (${OPEN_ITEM_STATES_SQL}))
ORDER BY r.sent_at, r.id
LIMIT ${cast(Math.max(1, Math.min(Math.trunc(limit), 5000)), "int")}`);
}

export function rowToReminderCandidate(row: Row): ReminderCandidate | null {
  const requestId = rowString(row.id);
  const caseId = rowString(row.case_id);
  const workspaceId = rowString(row.workspace_id);
  const contactId = rowString(row.contact_id);
  const caseStatus = rowVocab(CASE_STATUSES, row.case_status);
  const status = rowVocab(REQUEST_STATUSES, row.status);
  const purpose = rowVocab(REQUEST_PURPOSES, row.purpose);
  if (!isUuid(requestId) || !isUuid(caseId) || !isUuid(workspaceId) || !isUuid(contactId) || !caseStatus || !status || !purpose) return null;
  const owner = rowString(row.owner_contact_id);
  return {
    requestId,
    caseId,
    workspaceId,
    caseCode: String(row.code ?? ""),
    caseStatus,
    status,
    purpose,
    sentAt: rowDate(row.sent_at),
    expiresAt: rowDate(row.expires_at),
    reminderCount: rowNumber(row.reminder_count) ?? 0,
    escalatedAt: rowDate(row.escalated_at),
    contactId,
    contactReachable: rowBool(row.contact_reachable),
    ownerContactId: isUuid(owner) ? owner : null,
    ownerReachable: rowBool(row.owner_reachable),
  };
}

export type ReminderStep =
  | { kind: "promemoria"; reminder: 1 | 2 }
  | { kind: "segnalazione_owner"; ownerContactId: string }
  | { kind: "owner_da_indicare" }
  | { kind: "senza_email" };

/**
 * Che cosa fare oggi per la richiesta (funzione pura): promemoria al referente
 * (solo se ha un'email), segnalazione all'Owner (contatto diverso dal
 * referente, con un'email) oppure campanella «Owner da indicare». Null: niente.
 */
export function reminderStep(c: ReminderCandidate, now: Date): ReminderStep | null {
  const action = reminderAction(
    {
      status: c.status,
      purpose: c.purpose,
      sentAt: c.sentAt,
      expiresAt: c.expiresAt,
      revokedAt: null,
      reminderCount: c.reminderCount,
      escalatedAt: c.escalatedAt,
      caseStatus: c.caseStatus,
    },
    now,
    ROME_WORKING_CALENDAR,
  );
  if (!action) return null;
  if (action === "segnalazione_owner") {
    return c.ownerContactId && c.ownerReachable && c.ownerContactId !== c.contactId
      ? { kind: "segnalazione_owner", ownerContactId: c.ownerContactId }
      : { kind: "owner_da_indicare" };
  }
  if (!c.contactReachable) return { kind: "senza_email" };
  return { kind: "promemoria", reminder: action === "promemoria_1" ? 1 : 2 };
}

/** Le righe da mettere in coda per il passo (nessun token: lo emette l'invio). */
export function reminderStatements(c: ReminderCandidate, step: ReminderStep): UcStatement[] {
  const base = { workspaceId: c.workspaceId, caseId: c.caseId, requestId: c.requestId };
  const caseCode = /^[A-Z0-9][A-Z0-9-]{1,39}$/.test(c.caseCode) ? c.caseCode : undefined;
  switch (step.kind) {
    case "promemoria":
      return [
        toStatement(
          enqueueSql({
            ...base,
            recipient: { contactId: c.contactId },
            channel: "email",
            templateKey: step.reminder === 1 ? "promemoria_1" : "promemoria_2",
            payload: { reminder: step.reminder, case_code: caseCode },
            dedupeKey: dedupeKey.promemoria(c.requestId, step.reminder),
          }),
        ),
      ];
    case "segnalazione_owner":
      return [
        toStatement(
          enqueueSql({
            ...base,
            recipient: { contactId: step.ownerContactId },
            channel: "email",
            templateKey: "segnalazione_owner",
            payload: { case_code: caseCode },
            dedupeKey: dedupeKey.owner(c.requestId),
          }),
        ),
      ];
    case "owner_da_indicare":
      return [
        toStatement(
          enqueueForLsMembersSql({
            ...base,
            templateKey: "owner_da_indicare",
            payload: { case_code: caseCode },
            dedupeKeyPrefix: bellPrefix.ownerDaIndicare(c.requestId),
          }),
        ),
      ];
    case "senza_email":
      return [];
  }
}

// ── Riepilogo settimanale ─────────────────────────────────────────────

/** Owner del cliente dei casi in raccolta o oltre: uno per workspace, se vuole il riepilogo. */
export function weeklyOwnerRecipientsSql(workspaceId: WorkspaceFilter = null): UcStatement {
  return toStatement(ucSql`SELECT DISTINCT c.workspace_id, o.id AS contact_id
FROM uc_cases c
JOIN uc_contacts o ON o.id = ${CASE_OWNER_SQL} AND o.workspace_id = c.workspace_id
WHERE c.setup_completed_at IS NOT NULL AND c.status NOT IN ('bozza', 'chiuso', 'sospeso')
  AND o.is_active AND o.anonymized_at IS NULL AND o.email IS NOT NULL AND NOT o.digest_opt_out${inWorkspace(workspaceId)}
ORDER BY c.workspace_id, o.id
LIMIT 5000`);
}

/** Membri Lateral Space dei casi non chiusi: uno per workspace. */
export function weeklyLsRecipientsSql(workspaceId: WorkspaceFilter = null): UcStatement {
  return toStatement(ucSql`SELECT DISTINCT c.workspace_id, m.user_id
FROM uc_cases c
JOIN uc_case_members m ON m.case_id = c.id AND m.role IN (${LS_ROLES_SQL})
WHERE c.setup_completed_at IS NOT NULL AND c.status <> 'chiuso'${inWorkspace(workspaceId)}
ORDER BY c.workspace_id, m.user_id
LIMIT 5000`);
}

/** Righe del riepilogo: email all'Owner; email e campanella a Lateral Space. */
export function weeklyStatements(
  workspaceId: string,
  recipients: { contacts: readonly string[]; users: readonly string[] },
  now: Date,
  week: string,
): UcStatement[] {
  const out: UcStatement[] = [];
  for (const contactId of recipients.contacts) {
    out.push(
      toStatement(
        enqueueSql({
          workspaceId,
          recipient: { contactId },
          channel: "email",
          templateKey: "riepilogo_settimanale",
          payload: { week },
          dedupeKey: dedupeKey.riepilogo(workspaceId, now, { contactId }),
        }),
      ),
    );
  }
  for (const userId of recipients.users) {
    out.push(
      toStatement(
        enqueueSql({
          workspaceId,
          recipient: { userId },
          channel: "email",
          templateKey: "riepilogo_settimanale",
          payload: { week },
          dedupeKey: dedupeKey.riepilogo(workspaceId, now, { userId }),
        }),
      ),
      toStatement(
        enqueueSql({
          workspaceId,
          recipient: { userId },
          channel: "in_app",
          templateKey: "riepilogo_settimanale",
          payload: { week },
          dedupeKey: `${bellPrefix.riepilogo(workspaceId, now)}:${userId.toLowerCase()}`,
        }),
      ),
    );
  }
  return out;
}

// ── Cron dei solleciti ────────────────────────────────────────────────

export interface RemindersCronSummary {
  /** Lun–ven 9–18 a Roma, festivi esclusi: solo allora partono solleciti e riepiloghi. */
  inWindow: boolean;
  expiredRequests: number;
  /** Voci diventate `mancante` per link scaduto (7d). */
  missingAfterExpiry: number;
  /** Voci diventate `mancante` dopo 2 promemoria (7a). */
  missingAfterReminders: number;
  /** Promemoria messi in coda (la chiave di deduplica evita i doppioni). */
  reminders: number;
  escalations: number;
  ownerToDesignate: number;
  /** Promemoria saltati: referente senza email (il link si manda a mano). */
  withoutEmail: number;
  weekly: { due: boolean; week: string; emails: number; bells: number };
  /** Passi non riusciti (si riprovano al giro dopo). */
  errors: number;
  /** Lavoro lasciato al giro dopo per mancanza di tempo. */
  deferred: boolean;
  dispatch: DispatchSummary | null;
}

export async function runRemindersCron(executor: UcExecutor, o: UcCronOptions): Promise<RemindersCronSummary> {
  const now = o.now ?? new Date();
  const ws = cronWorkspaceFilterOf(o);
  const deadline = Date.now() + (o.budgetMs ?? DEFAULT_BUDGET_MS);
  const timeLeft = () => Date.now() < deadline;
  const ctx = { lsDomains: o.lsDomains, now };
  const weeklyPlan = weeklySummaryDue(now, ROME_WORKING_CALENDAR);
  const s: RemindersCronSummary = {
    inWindow: inRomeSendWindow(now, ROME_WORKING_CALENDAR),
    expiredRequests: 0,
    missingAfterExpiry: 0,
    missingAfterReminders: 0,
    reminders: 0,
    escalations: 0,
    ownerToDesignate: 0,
    withoutEmail: 0,
    weekly: { due: weeklyPlan.due, week: weeklyPlan.week, emails: 0, bells: 0 },
    errors: 0,
    deferred: false,
    dispatch: null,
  };
  const touched = new Map<string, string>();

  // 1. Link scaduti (7d).
  try {
    const [rows] = await executor.batch([expiringRequestsSql(now, 500, ws)]);
    const candidates = rows.map(rowToExpiringRequest).filter((r): r is ExpiringRequest => r !== null);
    const due = new Set(requestsToExpire(candidates, now));
    for (const r of candidates) {
      if (!due.has(r.id)) continue;
      if (!timeLeft()) {
        s.deferred = true;
        break;
      }
      try {
        const done = await expireRequest(executor, r, ctx);
        if (!done.ok) {
          s.errors++;
          logFailure("uc-reminders", "scadenza della richiesta", done.code);
          continue;
        }
        s.expiredRequests++;
        s.missingAfterExpiry += done.value.items;
        touched.set(r.caseId, r.workspaceId);
      } catch (error) {
        s.errors++;
        logFailure("uc-reminders", "scadenza della richiesta", errorCode(error));
      }
    }
  } catch (error) {
    s.errors++;
    logFailure("uc-reminders", "lettura delle richieste scadute", errorCode(error));
  }

  // 2. Scadute dopo 2 promemoria (7a).
  try {
    const [rows] = await executor.batch([overdueItemsSql(now, 5000, ws)]);
    const overdue = rows.map(rowToOverdueItem).filter((r): r is OverdueItem => r !== null);
    const due = new Set(itemsToMarkMissing(overdue.map((i) => ({ id: i.id, status: "chiesta" as const, dueAt: i.dueAt, requestReminderCount: i.reminderCount })), now));
    for (const items of groupBy(overdue.filter((i) => due.has(i.id)), (i) => i.caseId).values()) {
      for (const part of chunks(items, TRANSITION_CHUNK)) {
        if (!timeLeft()) {
          s.deferred = true;
          break;
        }
        try {
          const done = await markOverdueMissing(executor, part, ctx);
          if (!done.ok) {
            s.errors++;
            logFailure("uc-reminders", "voci scadute dopo i promemoria", done.code);
            continue;
          }
          s.missingAfterReminders += done.value;
          touched.set(part[0].caseId, part[0].workspaceId);
        } catch (error) {
          s.errors++;
          logFailure("uc-reminders", "voci scadute dopo i promemoria", errorCode(error));
        }
      }
    }
  } catch (error) {
    s.errors++;
    logFailure("uc-reminders", "lettura delle voci scadute", errorCode(error));
  }

  // 3. Solleciti, solo nella finestra d'invio.
  if (s.inWindow) {
    try {
      const [rows] = await executor.batch([reminderCandidatesSql(2000, ws)]);
      const candidates = rows.map(rowToReminderCandidate).filter((c): c is ReminderCandidate => c !== null);
      for (const group of groupBy(candidates, (c) => c.caseId).values()) {
        if (!timeLeft()) {
          s.deferred = true;
          break;
        }
        const statements: UcStatement[] = [];
        const counts = { reminders: 0, escalations: 0, ownerToDesignate: 0, withoutEmail: 0 };
        for (const c of group) {
          const step = reminderStep(c, now);
          if (!step) continue;
          if (step.kind === "promemoria") counts.reminders++;
          else if (step.kind === "segnalazione_owner") counts.escalations++;
          else if (step.kind === "owner_da_indicare") counts.ownerToDesignate++;
          else counts.withoutEmail++;
          statements.push(...reminderStatements(c, step));
        }
        try {
          if (statements.length > 0) await executor.batch(statements);
          s.reminders += counts.reminders;
          s.escalations += counts.escalations;
          s.ownerToDesignate += counts.ownerToDesignate;
          s.withoutEmail += counts.withoutEmail;
        } catch (error) {
          s.errors++;
          logFailure("uc-reminders", "coda dei solleciti", errorCode(error));
        }
      }
    } catch (error) {
      s.errors++;
      logFailure("uc-reminders", "lettura delle richieste da sollecitare", errorCode(error));
    }
  }

  // 4. Riepilogo settimanale (il lunedì, o il primo giorno lavorativo della settimana).
  if (weeklyPlan.due) {
    try {
      const [owners, members] = await executor.batch([weeklyOwnerRecipientsSql(ws), weeklyLsRecipientsSql(ws)]);
      const byWorkspace = new Map<string, { contacts: string[]; users: string[] }>();
      const entry = (ws: string) => {
        let e = byWorkspace.get(ws);
        if (!e) byWorkspace.set(ws, (e = { contacts: [], users: [] }));
        return e;
      };
      for (const r of owners) {
        const ws = rowString(r.workspace_id);
        const contact = rowString(r.contact_id);
        if (isUuid(ws) && isUuid(contact)) entry(ws).contacts.push(contact);
      }
      for (const r of members) {
        const ws = rowString(r.workspace_id);
        const user = rowString(r.user_id);
        if (isUuid(ws) && isUuid(user)) entry(ws).users.push(user);
      }
      for (const [ws, recipients] of byWorkspace) {
        try {
          await executor.batch(weeklyStatements(ws, recipients, now, weeklyPlan.week));
          s.weekly.emails += recipients.contacts.length + recipients.users.length;
          s.weekly.bells += recipients.users.length;
        } catch (error) {
          s.errors++;
          logFailure("uc-reminders", "coda del riepilogo", errorCode(error));
        }
      }
    } catch (error) {
      s.errors++;
      logFailure("uc-reminders", "lettura dei destinatari del riepilogo", errorCode(error));
    }
  }

  // La testata dei casi toccati mostra subito i nuovi conteggi.
  for (const [caseId, workspaceId] of touched) {
    if (!timeLeft()) {
      s.deferred = true;
      break;
    }
    try {
      await refreshReadinessCache(executor, workspaceId, caseId, now);
    } catch (error) {
      s.errors++;
      logFailure("uc-reminders", "prontezza", errorCode(error));
    }
  }

  // 5. Invio della coda.
  if (o.dispatch !== false) {
    try {
      const sent = await dispatchScoped(executor, o, now, ws, timeLeft);
      s.dispatch = sent.summary;
      if (sent.deferred) s.deferred = true;
    } catch (error) {
      s.errors++;
      logFailure("uc-reminders", "invio della coda", errorCode(error));
    }
  }
  return s;
}

// ── Cron della freschezza ─────────────────────────────────────────────

export interface StaleItem {
  id: string;
  caseId: string;
  workspaceId: string;
  staleAt: Date | null;
}

/** Voci validate con il dato scaduto, nei casi non chiusi. */
export function staleItemsSql(now: Date, limit = 10_000, workspaceId: WorkspaceFilter = null): UcStatement {
  return toStatement(ucSql`SELECT i.id, i.case_id, c.workspace_id, i.stale_at
FROM uc_items i JOIN uc_cases c ON c.id = i.case_id
WHERE i.status = 'validata' AND i.stale_at IS NOT NULL AND i.stale_at <= ${at(now)} AND i.deleted_at IS NULL
  AND c.setup_completed_at IS NOT NULL AND c.status <> 'chiuso'${inWorkspace(workspaceId)}
ORDER BY i.case_id, i.id
LIMIT ${cast(Math.max(1, Math.min(Math.trunc(limit), 50_000)), "int")}`);
}

/** Casi di cui ricalcolare la prontezza: tutti quelli pronti e non chiusi. */
export function openCasesSql(limit = 2000, workspaceId: WorkspaceFilter = null): UcStatement {
  return toStatement(ucSql`SELECT c.id, c.workspace_id FROM uc_cases c
WHERE c.setup_completed_at IS NOT NULL AND c.status <> 'chiuso'${inWorkspace(workspaceId)}
ORDER BY c.id
LIMIT ${cast(Math.max(1, Math.min(Math.trunc(limit), 10_000)), "int")}`);
}

export function rateLimitCleanupSql(now: Date): UcStatement {
  return toStatement(ucSql`WITH d AS (DELETE FROM uc_rate_limits WHERE window_start < ${at(new Date(now.getTime() - RATE_LIMIT_RETENTION_MS))} RETURNING 1)
SELECT count(*)::int AS n FROM d`);
}

export interface FreshnessCronSummary {
  /** Voci validate tornate in verifica perché il dato è scaduto. */
  expiredData: number;
  readinessRefreshed: number;
  rateLimitRowsDeleted: number;
  quarantine: { rows: number; objects: number } | null;
  /** File dei casi chiusi tolti alla fine della conservazione (P0-8). */
  retention: RetentionSummary | null;
  errors: number;
  deferred: boolean;
  dispatch: DispatchSummary | null;
}

export async function runFreshnessCron(executor: UcExecutor, o: UcCronOptions): Promise<FreshnessCronSummary> {
  const now = o.now ?? new Date();
  const ws = cronWorkspaceFilterOf(o);
  const deadline = Date.now() + (o.budgetMs ?? DEFAULT_BUDGET_MS);
  const timeLeft = () => Date.now() < deadline;
  const ctx = { lsDomains: o.lsDomains, now };
  const s: FreshnessCronSummary = { expiredData: 0, readinessRefreshed: 0, rateLimitRowsDeleted: 0, quarantine: null, retention: null, errors: 0, deferred: false, dispatch: null };

  // 1. Dati scaduti (riga 24).
  try {
    const [rows] = await executor.batch([staleItemsSql(now, 10_000, ws)]);
    const stale: StaleItem[] = [];
    for (const r of rows) {
      const id = rowString(r.id);
      const caseId = rowString(r.case_id);
      const workspaceId = rowString(r.workspace_id);
      if (isUuid(id) && isUuid(caseId) && isUuid(workspaceId)) stale.push({ id, caseId, workspaceId, staleAt: rowDate(r.stale_at) });
    }
    const due = new Set(itemsToExpire(stale.map((i) => ({ id: i.id, status: "validata" as const, staleAt: i.staleAt })), now));
    for (const items of groupBy(stale.filter((i) => due.has(i.id)), (i) => i.caseId).values()) {
      for (const part of chunks(items, TRANSITION_CHUNK)) {
        if (!timeLeft()) {
          s.deferred = true;
          break;
        }
        try {
          const applied = await applyItemTransitions(executor, systemCtx("uc-freshness", part[0].workspaceId, part[0].caseId, ctx), {
            itemIds: part.map((i) => i.id),
            transitions: part.map((i): TransitionRequest => ({ itemId: i.id, to: "in_verifica", trigger: "dato_scaduto" })),
          });
          if (!applied.ok) {
            s.errors++;
            logFailure("uc-freshness", "dati scaduti", applied.code);
            continue;
          }
          s.expiredData += applied.value.applied.length;
        } catch (error) {
          s.errors++;
          logFailure("uc-freshness", "dati scaduti", errorCode(error));
        }
      }
    }
  } catch (error) {
    s.errors++;
    logFailure("uc-freshness", "lettura dei dati scaduti", errorCode(error));
  }

  // 2. Prontezza di ogni caso aperto.
  try {
    const [rows] = await executor.batch([openCasesSql(2000, ws)]);
    for (const r of rows) {
      const caseId = rowString(r.id);
      const workspaceId = rowString(r.workspace_id);
      if (!isUuid(caseId) || !isUuid(workspaceId)) continue;
      if (!timeLeft()) {
        s.deferred = true;
        break;
      }
      try {
        if (await refreshReadinessCache(executor, workspaceId, caseId, now)) s.readinessRefreshed++;
      } catch (error) {
        s.errors++;
        logFailure("uc-freshness", "prontezza", errorCode(error));
      }
    }
  } catch (error) {
    s.errors++;
    logFailure("uc-freshness", "lettura dei casi", errorCode(error));
  }

  // 3–4. Pulizie globali: limiti di frequenza vecchi e quarantena (mai per il solo workspace
  // dell'operatore; con l'elenco acceso sì, perché toccano tutti i workspace allo stesso modo).
  if (!o.workspaceId) {
    try {
      const [rows] = await executor.batch([rateLimitCleanupSql(now)]);
      s.rateLimitRowsDeleted = rowNumber(rows[0]?.n) ?? 0;
    } catch (error) {
      s.errors++;
      logFailure("uc-freshness", "pulizia dei limiti", errorCode(error));
    }
    if (timeLeft()) {
      try {
        s.quarantine = await cleanupQuarantine(executor, o.env, now);
      } catch (error) {
        s.errors++;
        logFailure("uc-freshness", "pulizia della quarantena", errorCode(error));
      }
    } else {
      s.deferred = true;
    }
  }

  // 4b. Conservazione (P0-8): file dei casi chiusi oltre i 30 giorni, in ogni workspace
  // (anche spento), oppure solo in quello dell'operatore.
  if (timeLeft()) {
    try {
      s.retention = await expireRetainedFiles(executor, o.env, { now, workspaceId: o.workspaceId ?? null, timeLeft });
      if (s.retention.deferred) s.deferred = true;
      if (s.retention.failed > 0) {
        s.errors++;
        logFailure("uc-freshness", "conservazione dei file", "archivio");
      }
      // Righe di un archivio tolto: non un errore del giro, ma un passo dell'operatore (RUNBOOK §6.2).
      if (s.retention.unreachable > 0) console.warn("[uc] uc-freshness: conservazione dei file", "archivio_non_configurato", s.retention.unreachable);
    } catch (error) {
      s.errors++;
      logFailure("uc-freshness", "conservazione dei file", errorCode(error));
    }
  } else {
    s.deferred = true;
  }

  // 5. Campanella (e le email non legate alla finestra).
  if (o.dispatch !== false) {
    try {
      const sent = await dispatchScoped(executor, o, now, ws, timeLeft);
      s.dispatch = sent.summary;
      if (sent.deferred) s.deferred = true;
    } catch (error) {
      s.errors++;
      logFailure("uc-freshness", "invio della coda", errorCode(error));
    }
  }
  return s;
}

