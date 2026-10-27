import "server-only";
import { after } from "next/server";
import { ensureDbSchema } from "@/lib/db/ensure-schema";
import { getAppUcExecutor, runUcBatch, type UcExecutor, type UcRow } from "@/lib/db/uc-executor";
import type { ReferentItemState, ReferentRequestStatus } from "@/lib/db/use-case-hub-referents-ddl";
import { logSafeError } from "@/lib/log/safe-error";
import { parseLsDomains } from "@/lib/uc/lateral-space";
import { ucLog } from "@/lib/uc/log";
import { rowBool, rowDate, rowJson, rowNumber, rowString } from "@/lib/uc/sql/readiness";
import { cast, raw, toStatement, ucSql, type UcStatement } from "@/lib/uc/sql/statement";
import { LS_CASE_ROLES } from "@/lib/uc/vocab";
import { silentNeedIds, type InfoAskFact } from "@/lib/use-cases/info-progress";
import type { NeedKind, NeedOwnerSide, NeedStatus, NeedType, NeedView } from "@/lib/use-cases/needs";
import { referentAskEnabled } from "@/lib/use-cases/referent/availability";
import { REFERENT_ERROR_MESSAGES, referentErrorMessage } from "@/lib/use-cases/referent/labels";
import { NO_PERSON, contactPeopleSql, emailPersonSql, personFactsOf, referentPersonOf, type ReferentPerson } from "@/lib/use-cases/referent/people";
import { personaWriter, type ServiceResult, type WriteContext } from "@/lib/use-cases/service";
import type { IsoDate } from "@/lib/use-cases/types";
import type { ValueModel } from "@/lib/use-cases/value-model";

/**
 * «Chiedi al referente»: le basi comuni ai moduli del servizio (`use-case-referents.ts`, la pagina
 * pubblica, i file, l'invio delle email): disponibilità degli archivi, errori, chi scrive, letture
 * della scheda, delle sue esigenze e delle richieste. Nessun testo nei log: nome dell'operazione,
 * codice, SQLSTATE e uuid.
 */

export type Env = Readonly<Record<string, string | undefined>>;
export type ReferentFailure = { ok: false; error: string; message: string; fieldErrors?: Record<string, string> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
export const isVersion = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

// ─── Disponibilità ───────────────────────────────────────────────────

let storeReady = false;

/**
 * Le tabelle uc che la funzione riusa (referenti, autorizzazioni, limiti di frequenza, i dossier per
 * i controlli sui referenti) e la funzione `uc_require` ci sono, e il self-heal dell'hub ha
 * applicato la 0024. Il risultato positivo si tiene per tutto il processo.
 */
export async function referentStoreReady(): Promise<boolean> {
  if (storeReady) return true;
  try {
    await ensureDbSchema();
    const executor = await getAppUcExecutor();
    const [[row]] = await executor.batch([
      toStatement(ucSql`SELECT (to_regclass('public.uc_contacts') IS NOT NULL AND to_regclass('public.uc_subprocessor_acks') IS NOT NULL
  AND to_regclass('public.uc_rate_limits') IS NOT NULL AND to_regclass('public.uc_requests') IS NOT NULL
  AND to_regclass('public.uc_cases') IS NOT NULL AND to_regclass('public.uc_events') IS NOT NULL
  AND to_regclass('public.uc_case_members') IS NOT NULL AND to_regprocedure('public.uc_require(boolean,text)') IS NOT NULL
  AND to_regclass('public.use_case_referent_requests') IS NOT NULL) AS ok`),
    ]);
    storeReady = rowBool(row?.ok);
    return storeReady;
  } catch (error) {
    logReferentError("archivi", error);
    return false;
  }
}

export class ReferentUnavailableError extends Error {
  readonly code: "spenta" | "non_disponibile";
  constructor(code: "spenta" | "non_disponibile") {
    super(code === "spenta" ? "Funzione spenta." : "Funzione non disponibile.");
    this.name = "ReferentUnavailableError";
    this.code = code;
  }
}

/** Funzione accesa per il workspace e archivi pronti; altrimenti `ReferentUnavailableError`. */
export async function ensureReferentAvailable(workspaceId: string, env: Env = process.env): Promise<void> {
  if (!referentAskEnabled(workspaceId, env)) throw new ReferentUnavailableError("spenta");
  if (!(await referentStoreReady())) throw new ReferentUnavailableError("non_disponibile");
}

// ─── Errori e log ────────────────────────────────────────────────────

export function rfail(code: string, message?: string, fieldErrors?: Record<string, string>): ReferentFailure {
  const out: ReferentFailure = { ok: false, error: code, message: message ?? REFERENT_ERROR_MESSAGES[code] ?? REFERENT_ERROR_MESSAGES.riprova };
  if (fieldErrors && Object.keys(fieldErrors).length) out.fieldErrors = fieldErrors;
  return out;
}

export function rfailVars(code: string, vars: Readonly<Record<string, string | number>>, fieldErrors?: Record<string, string>): ReferentFailure {
  return rfail(code, referentErrorMessage(code, vars), fieldErrors);
}

/** Una riga di log: solo l'operazione, il codice, lo SQLSTATE e gli uuid. */
export function logReferentError(op: string, error: unknown, ids: { workspaceId?: string | null } = {}): void {
  logSafeError("use-case.referenti", `${op}_failed`, error, ids.workspaceId && isUuid(ids.workspaceId) ? { workspaceId: ids.workspaceId } : {});
}

export function logReferentCode(op: string, code: string, ids: { workspaceId?: string | null } = {}): void {
  ucLog({ level: "warn", area: "use-case.referenti", op, code, workspaceId: ids.workspaceId ?? null });
}

/** Una funzione del servizio che non lancia: un errore del database diventa `riprova`. */
export function guardedReferent<A extends unknown[], T>(op: string, run: (...args: A) => Promise<T | ReferentFailure>): (...args: A) => Promise<T | ReferentFailure> {
  return async (...args: A) => {
    try {
      return await run(...args);
    } catch (error) {
      logReferentError(op, error);
      return rfail("riprova");
    }
  };
}

/** Un batch: le eccezioni `uc:<codice>` diventano un esito; i vincoli unici noti un codice. */
export async function referentBatch(executor: UcExecutor, statements: readonly UcStatement[]): Promise<{ ok: true; rows: UcRow[][] } | ReferentFailure> {
  try {
    const result = await runUcBatch(executor, statements);
    if (result.ok) return { ok: true, rows: result.rows };
    return rfail(result.code);
  } catch (error) {
    const text = error instanceof Error ? `${error.message} ${String((error as { constraint?: unknown }).constraint ?? "")}` : "";
    if (/use_case_referent_requests_live_unique/.test(text)) return rfail("richiesta_aperta");
    if (/uc_contacts_workspace_email_idx/.test(text)) return rfail("email_in_uso", undefined, { email: REFERENT_ERROR_MESSAGES.email_in_uso });
    throw error;
  }
}

/**
 * Un lavoro dopo la risposta (`after()` di Next). Fuori da una richiesta (test, script) `after`
 * non c'è: il lavoro non parte e lo finisce il cron (email in coda, oggetti da cancellare).
 */
export function afterResponse(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    // Nessuna richiesta in corso: ci pensa il prossimo giro del cron.
  }
}

// ─── Chi scrive ──────────────────────────────────────────────────────

/**
 * Le prime due porte di ogni scrittura del team (§3.1, 1 e 2): funzione accesa e archivi pronti,
 * poi un revisore con `canEditNeeds`, con ruolo e «Lateral Space» riletti adesso.
 */
export async function referentWriter(ctx: WriteContext, env: Env): Promise<{ ok: true; userId: string } | ReferentFailure> {
  if (!isUuid(ctx.workspaceId) || !referentAskEnabled(ctx.workspaceId, env) || !(await referentStoreReady())) return rfail("funzione_spenta");
  const writer = await personaWriter(ctx, "canEditNeeds");
  if (!writer.ok) return writer.error === "area_spenta" ? rfail("funzione_spenta") : rfail(writer.error, writer.message);
  return writer;
}

export function failureOf(result: ServiceResult<unknown> | ReferentFailure): ReferentFailure | null {
  return result.ok ? null : (result as ReferentFailure);
}

export function lsDomainsOf(env: Env): string[] {
  return parseLsDomains(env.UC_LS_EMAIL_DOMAINS);
}

// ─── Letture ─────────────────────────────────────────────────────────

export interface CardRow {
  id: string;
  workspaceId: string;
  code: string | null;
  title: string;
  company: string;
  intake: Record<string, unknown> | null;
  valueModel: ValueModel | null;
}

/** La scheda del workspace, con il nome dell'azienda (workspace). */
export async function readCard(executor: UcExecutor, workspaceId: string, useCaseId: string): Promise<CardRow | null> {
  if (!isUuid(workspaceId) || !isUuid(useCaseId)) return null;
  const [[row]] = await executor.batch([
    toStatement(ucSql`SELECT u.id, u.workspace_id, u.code, u.title, u.intake, u.value_model, w.name AS company
FROM use_cases u JOIN workspaces w ON w.id = u.workspace_id
WHERE u.id = ${cast(useCaseId, "uuid")} AND u.workspace_id = ${cast(workspaceId, "uuid")}`),
  ]);
  if (!row) return null;
  const intake = rowJson<Record<string, unknown>>(row.intake);
  return {
    id: String(row.id).toLowerCase(),
    workspaceId: String(row.workspace_id).toLowerCase(),
    code: rowString(row.code),
    title: rowString(row.title) ?? "",
    company: rowString(row.company) ?? "",
    intake: intake && typeof intake === "object" && !Array.isArray(intake) ? intake : null,
    valueModel: rowJson<ValueModel>(row.value_model),
  };
}

function iso(value: unknown): string | null {
  const d = rowDate(value);
  return d ? d.toISOString() : null;
}

/** Un'esigenza letta qui come `NeedView` (le letture di «Cosa serve» restano in `use-case-needs.ts`). */
function needOf(row: UcRow, useCaseIds: string[]): NeedView {
  return {
    id: String(row.id).toLowerCase(),
    type: (rowString(row.type) ?? "requisito") as NeedType,
    kind: (rowString(row.kind) ?? "altro") as NeedKind,
    title: rowString(row.title) ?? "",
    detail: null,
    ownerLabel: null,
    ownerSide: (rowString(row.owner_side) as NeedOwnerSide | null) ?? null,
    status: (rowString(row.status) ?? "da_chiedere") as NeedStatus,
    availability: null,
    dueOn: (rowString(row.due_on)?.slice(0, 10) ?? null) as IsoDate | null,
    dueLabel: null,
    dueIsProposal: false,
    forLabel: null,
    sortOrder: rowNumber(row.sort_order) ?? 0,
    version: rowNumber(row.version) ?? 1,
    importKey: rowString(row.import_key),
    createdAt: iso(row.created_at) ?? "",
    updatedAt: iso(row.updated_at) ?? "",
    doneAt: null,
    archivedAt: iso(row.archived_at),
    archiveReason: null,
    useCaseIds,
  };
}

/** Le esigenze non archiviate collegate alla scheda (requisiti e passi), con la sola scheda tra gli use case. */
export async function readCardNeeds(executor: UcExecutor, workspaceId: string, useCaseId: string): Promise<NeedView[]> {
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT n.id, n.type, n.kind, n.title, n.owner_side, n.status, n.archived_at, n.sort_order, n.due_on, n.version, n.import_key, n.created_at, n.updated_at
FROM use_case_needs n JOIN use_case_need_links l ON l.need_id = n.id
WHERE l.use_case_id = ${cast(useCaseId, "uuid")} AND n.workspace_id = ${cast(workspaceId, "uuid")} AND n.archived_at IS NULL`),
  ]);
  return rows.map((row) => needOf(row, [useCaseId.toLowerCase()]));
}

/** Le domande delle richieste (di ogni scheda) su queste esigenze: per «Senza risposta» e per la riga dell'esigenza. */
export interface AskRow extends InfoAskFact {
  useCaseId: string;
  useCaseCode: string | null;
  contactId: string;
  contactName: string;
  expiredAt: Date | null;
  revokedAt: Date | null;
  answeredAt: Date | null;
}

export async function readAsksForNeeds(executor: UcExecutor, workspaceId: string, needIds: readonly string[]): Promise<AskRow[]> {
  const ids = needIds.filter(isUuid).map((x) => x.toLowerCase());
  if (!ids.length) return [];
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT i.need_id, r.id AS request_id, r.use_case_id, u.code AS use_case_code, r.status, r.expires_at, r.created_at, r.sent_at,
  r.reminder_count, r.last_reminder_at, r.expired_at, r.revoked_at, i.state, i.answered_at, r.contact_id,
  coalesce(c.display_name, '') AS contact_name
FROM use_case_referent_request_items i
JOIN use_case_referent_requests r ON r.id = i.request_id AND r.workspace_id = i.workspace_id
JOIN use_cases u ON u.id = r.use_case_id AND u.workspace_id = r.workspace_id
LEFT JOIN uc_contacts c ON c.id = r.contact_id AND c.workspace_id = r.workspace_id
WHERE r.workspace_id = ${cast(workspaceId, "uuid")} AND i.need_id = ANY(${cast(ids, "uuid[]")})`),
  ]);
  return rows.flatMap((r): AskRow[] => {
    const expiresAt = rowDate(r.expires_at);
    const createdAt = rowDate(r.created_at);
    if (!expiresAt || !createdAt) return [];
    return [
      {
        needId: String(r.need_id).toLowerCase(),
        requestId: String(r.request_id).toLowerCase(),
        useCaseId: String(r.use_case_id).toLowerCase(),
        useCaseCode: rowString(r.use_case_code),
        status: (rowString(r.status) ?? "inviata") as ReferentRequestStatus,
        expiresAt,
        createdAt,
        sentAt: rowDate(r.sent_at),
        reminderCount: rowNumber(r.reminder_count) ?? 0,
        lastReminderAt: rowDate(r.last_reminder_at),
        itemState: (rowString(r.state) ?? "aperta") as ReferentItemState,
        contactId: String(r.contact_id).toLowerCase(),
        contactName: rowString(r.contact_name) ?? "",
        expiredAt: rowDate(r.expired_at),
        revokedAt: rowDate(r.revoked_at),
        answeredAt: rowDate(r.answered_at),
      },
    ];
  });
}

/** Le esigenze «chiesta» della scheda la cui ultima richiesta è senza risposta: si possono chiedere di nuovo. */
export function silentOf(needs: readonly NeedView[], asks: readonly InfoAskFact[], now: Date): Set<string> {
  return silentNeedIds(
    needs.filter((n) => n.type === "requisito").map((n) => ({ id: n.id, status: n.status })),
    asks,
    now,
  );
}

/** Le email (in minuscolo) delle persone di Lateral Space dei dossier del workspace: non possono essere referenti. */
export async function readLsMemberEmails(executor: UcExecutor, workspaceId: string): Promise<string[]> {
  const roles = LS_CASE_ROLES.map((r) => `'${r}'`).join(", ");
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT DISTINCT lower(u.email) AS email FROM uc_case_members m JOIN uc_cases c ON c.id = m.case_id JOIN users u ON u.id = m.user_id
WHERE c.workspace_id = ${cast(workspaceId, "uuid")} AND m.role IN (${raw(roles)}) AND u.email IS NOT NULL`),
  ]);
  return rows.map((r) => String(r.email));
}

export interface ContactRow {
  id: string;
  displayName: string;
  roleLabel: string | null;
  email: string | null;
  isActive: boolean;
  anonymized: boolean;
  userId: string | null;
}

/** Un referente del workspace (`uc_contacts`), o null. */
export async function readContact(executor: UcExecutor, workspaceId: string, contactId: string): Promise<ContactRow | null> {
  if (!isUuid(contactId)) return null;
  const [[row]] = await executor.batch([
    toStatement(ucSql`SELECT id, display_name, role_label, email, is_active, anonymized_at IS NOT NULL AS anonymized, user_id
FROM uc_contacts WHERE id = ${cast(contactId, "uuid")} AND workspace_id = ${cast(workspaceId, "uuid")}`),
  ]);
  if (!row) return null;
  return {
    id: String(row.id).toLowerCase(),
    displayName: rowString(row.display_name) ?? "",
    roleLabel: rowString(row.role_label),
    email: rowString(row.email),
    isActive: rowBool(row.is_active),
    anonymized: rowBool(row.anonymized),
    userId: rowString(row.user_id),
  };
}

// ─── Ruoli che si sovrappongono (Parte 3, §P3.1) ─────────────────────

const personOfRow = (row: UcRow | undefined): ReferentPerson => referentPersonOf(personFactsOf(row ? { ...row, email_match: rowBool(row.email_match) } : undefined));

/**
 * Chi è adesso, in Unbundle, il referente di ogni contatto: l'account (collegato, o con la stessa
 * email verificata) e se ha un ruolo da revisore nel workspace. Si legge a ogni invio e a ogni
 * notifica, mai salvato. Un contatto senza account (o non trovato) non è nella mappa.
 */
export async function readReferentPeople(executor: UcExecutor, workspaceId: string, contactIds: readonly string[]): Promise<Map<string, ReferentPerson>> {
  const ids = [...new Set(contactIds.filter(isUuid).map((x) => x.toLowerCase()))];
  const out = new Map<string, ReferentPerson>();
  if (!ids.length || !isUuid(workspaceId)) return out;
  const [rows] = await executor.batch([contactPeopleSql(workspaceId, ids)]);
  for (const row of rows) {
    const person = personOfRow(row);
    if (person.userId) out.set(String(row.contact_id).toLowerCase(), person);
  }
  return out;
}

/** La persona di un solo contatto; `NO_PERSON` senza account. */
export async function readReferentPerson(executor: UcExecutor, workspaceId: string, contactId: string): Promise<ReferentPerson> {
  return (await readReferentPeople(executor, workspaceId, [contactId])).get(contactId.toLowerCase()) ?? NO_PERSON;
}

/** La persona del referente di una richiesta del workspace; `NO_PERSON` senza account o senza richiesta. */
export async function readRequestReferentPerson(executor: UcExecutor, workspaceId: string, requestId: string): Promise<ReferentPerson> {
  if (!isUuid(workspaceId) || !isUuid(requestId)) return NO_PERSON;
  const [[row]] = await executor.batch([
    toStatement(ucSql`SELECT r.contact_id::text AS contact_id FROM use_case_referent_requests r WHERE r.id = ${cast(requestId, "uuid")} AND r.workspace_id = ${cast(workspaceId, "uuid")}`),
  ]);
  const contactId = rowString(row?.contact_id);
  return contactId ? readReferentPerson(executor, workspaceId, contactId) : NO_PERSON;
}

/** La persona di un'email che non è ancora un contatto (il referente nuovo). */
export async function readEmailPerson(executor: UcExecutor, workspaceId: string, email: string): Promise<ReferentPerson> {
  if (!isUuid(workspaceId) || !email.trim()) return NO_PERSON;
  const [[row]] = await executor.batch([emailPersonSql(workspaceId, email)]);
  return personOfRow(row);
}

// ─── Il link pubblico ────────────────────────────────────────────────

/** Il link del referente, risolto dal token (`resolveReferentToken`): i soli fatti che servono ai comandi pubblici. */
export interface ReferentLink {
  tokenId: string;
  requestId: string;
  workspaceId: string;
  useCaseId: string;
  contactId: string;
  status: "inviata" | "completata";
  privacyAccepted: boolean;
  expiresAt: Date;
}
