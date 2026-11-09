import "server-only";
import { randomUUID } from "node:crypto";
import { getAppUcExecutor, type UcExecutor, type UcRow } from "@/lib/db/uc-executor";
import { REFERENT_CHECK_SWEEP_SQL } from "@/lib/db/use-case-hub-referent-check-ddl";
import { REFERENT_BENEFITS_SWEEP_SQL } from "@/lib/db/use-case-hub-referent-benefits-ddl";
import { REFERENT_THREAD_SWEEP_SQL } from "@/lib/db/use-case-hub-referent-thread-ddl";
import { loadUserContext } from "@/lib/db/queries/uc-cases";
import { loadSubprocessorAck } from "@/lib/db/queries/uc-subprocessors";
import {
  guardedReferent,
  isUuid,
  isVersion,
  lsDomainsOf,
  readAsksForNeeds,
  readCard,
  readCardNeeds,
  readContact,
  readEmailPerson,
  readLsMemberEmails,
  readPersonContacts,
  readReferentPerson,
  readReferentPeople,
  readWorkspaceMembers,
  referentBatch,
  referentStoreReady,
  referentWriter,
  rfail,
  rfailVars,
  silentOf,
  logReferentError,
  type AskRow,
  type Env,
  type ReferentFailure,
} from "@/lib/db/queries/use-case-referent-base";
import { createReferentDispatchStore, runReferentDispatchWith } from "@/lib/db/queries/use-case-referent-dispatch";
import { processReferentSuggestions } from "@/lib/db/queries/use-case-referent-ai";
import { REFERENT_AI_LIMITS, referentAiSuggestionsOn } from "@/lib/use-cases/referent/ai-followup";
import { cleanupPendingFiles, deleteFileObjects, collectDeletedFileRows } from "@/lib/db/queries/use-case-referent-files";
import { dispatchRequesterAlerts, purgeOldNotifications } from "@/lib/db/queries/use-case-notifications";
import {
  dispatchCaseAlerts,
  noticeSubprocessorsWait,
  purgeOldCaseAlerts,
  readinessSyncFor,
  subprocessorsNoticeFor,
  syncReadyCards,
  syncSubprocessorsNotices,
} from "@/lib/db/queries/use-case-alerts";
import { cardSyncStatements, subprocessorsWaitNoticeStatements } from "@/lib/use-cases/case-alerts/sql";
import { clientNoticesEnabled } from "@/lib/use-cases/client-notices";
import { inRomeSendWindow, romeDate } from "@/lib/uc/calendar";
import { userContextFrom } from "@/lib/uc/lateral-space";
import { subprocessorDeclarerOf } from "@/lib/uc/legal/subprocessors";
import { ucEmailConfig, type UcMailer } from "@/lib/uc/notify/dispatch";
import { checkContactEmail } from "@/lib/uc/permissions";
import { rowBool, rowDate, rowJson, rowNumber, rowString } from "@/lib/uc/sql/readiness";
import { checkContactDraft, contactEmailTakenSql, contactInsertSql, contactUpdateSql, prepareContact, type ContactDraft } from "@/lib/uc/sql/request-commands";
import { cast, raw, requireRows, toStatement, ucSql, type SqlFragment, type UcStatement } from "@/lib/uc/sql/statement";
import { clientUploadAvailable } from "@/lib/uc/storage";
import { abilitiesForUseCase, type UseCaseViewer } from "@/lib/use-cases/permissions";
import { alertSchedule } from "@/lib/use-cases/referent/alerts";
import { referentAskEnabled, referentPublicWritesAvailable } from "@/lib/use-cases/referent/availability";
import {
  REFERENT_LIMITS,
  reviewerFileHref,
  subprocessorsSettingsHref,
  type NeedAnswerView,
  type NeedFileView,
  type NeedReferentView,
  type ReferentContactOption,
  type ReferentGate,
  type ReferentMemberOption,
  type ReferentBlockView,
  type ReferentRequestView,
  type UseCaseReferentPanel,
} from "@/lib/use-cases/referent/contract";
import { contactHubOnlyReadSql, contactHubOnlySql, contactUseCasesSql, referentEraseStatements, referentPurgeStatements } from "@/lib/use-cases/referent/erase";
import { REFERENT_ERROR_MESSAGES, REFERENT_THREAD_TEXT, REFERENT_UI_TEXT, companyLabel, fillText } from "@/lib/use-cases/referent/labels";
import { gapsOf, missingPreparedQuestions, preparedNeedInput } from "@/lib/use-cases/referent/prepare";
import { askableNeeds, answerableNeeds } from "@/lib/use-cases/referent/questions";
import { manualReminderCheck, referentReminderDue, retentionDue, sameRomeDay, isStaleEmail, type ReminderState } from "@/lib/use-cases/referent/schedule";
import {
  cancelQueuedForRequestsStatements as cancelQueuedRaw,
  casTail,
  completeHandledRequestsStatements,
  draftsCleanupStatements,
  expireStatements,
  lockRequestsOfNeedSql,
  needTransitionSql,
  openItemSql,
  openItemsCountSql,
  validLinkSql,
  activeRequestSql,
  queueThreadEmailItemSql,
  renewLinkStatements,
  reopenRequestStatements,
  REFERENT_LINK_RENEW_DAYS,
  referentEventSql,
  revokeStatements,
  uuidOf,
  type ReferentActor,
} from "@/lib/use-cases/referent/sql";
import {
  NO_PERSON,
  canSeeWorkspacePeople,
  isSelfRequest,
  linkNewContactUserSql,
  memberDisplayName,
  pickerMembersOf,
  relinkCorrectedContactSql,
  requestReferentUserSql,
  type WorkspaceMemberFacts,
} from "@/lib/use-cases/referent/people";
import { reviewerStatus } from "@/lib/use-cases/referent/state";
import { referentBlockOf, referentContactOf, type BlockRequestFact, type ReferentCheckRow } from "@/lib/use-cases/referent/block";
import { teamEstimateOf } from "@/lib/use-cases/referent/estimate";
import { BENEFITS_FLAG_SQL, impactRowsOf, storedBenefitOf } from "@/lib/use-cases/referent/impact";
import { eligibleForReferent, latestRequest } from "@/lib/use-cases/referent/use-case-state";
import { dossierStateForUseCase } from "@/lib/db/queries/use-case-dossiers";
import { phaseOfUseCase } from "@/lib/use-cases/phase";
import { romeToday } from "@/lib/use-cases/quarter";
import { phaseInputOf } from "@/lib/use-cases/views";
import { checkQuestionTitle, checkRequestMessage, checkReviewerAnswer } from "@/lib/use-cases/referent/text";
import {
  clarifyTargetOf,
  threadFactsByRequest,
  threadMessageViewsOf,
  threadMessagesSql,
  threadRowOf,
  threadSuggestionViewsOf,
  threadSuggestionsSql,
  type ThreadRow,
} from "@/lib/db/queries/use-case-referent-thread";
import { threadEmailAt, waitsForReferent } from "@/lib/use-cases/referent/thread";
import { formatFileSize } from "@/lib/use-cases/referent/upload-transport";
import { maskEmail, needReferentLine, referentDateLabel, requestLines, requestWordOf, type LatestAskForNeed } from "@/lib/use-cases/referent/view";
import type { UseCaseNeedLists } from "@/lib/use-cases/needs";
import type { ServiceResult, WriteContext } from "@/lib/use-cases/service";

/**
 * «Chiedi al referente»: il servizio dei revisori (SPEC §2.3, §3): il pannello del capitolo «Cosa
 * serve», «Prepara le domande», «Chiedi al referente», «Aggiungi domande», «Manda un promemoria»,
 * «Revoca il link», «Riprova l'invio», «Correggi l'email», «Cancella i dati di questa persona», le
 * risposte e i file del team, e il cron di scadenze e promemoria.
 *
 * - **Chi**: solo i revisori (`canEditNeeds` per scrivere, `canSeeNeeds` per leggere), ruolo riletto
 *   a ogni chiamata. Contributori e partecipanti ai corsi non ricevono niente.
 * - **Una transazione**: ogni scrittura è un batch (`UcExecutor.batch`) con la sua Storia, gli stati
 *   delle esigenze, le notifiche, la coda; le email partono dopo la risposta (`after()`).
 * - **Id dal database**: ogni inserimento prende workspace, use case ed esigenza dalla join
 *   esigenza/legame, mai dall'ingresso.
 * - **Art. 15.4**: nessun conteggio, ordinamento o raggruppamento per persona; liste per data o id;
 *   nessuna differenza tra date delle richieste. Il raggruppamento dei promemoria per referente
 *   (un'email al giorno per persona) si fa in TypeScript, solo nel cron.
 *
 * Questo modulo non legge «Cosa serve» con `listWorkspaceNeeds` (regola di `needs.source.test.ts`):
 * la pagina passa le esigenze; le scritture le rileggono con la loro SQL.
 */

export type { Env, ReferentFailure } from "@/lib/db/queries/use-case-referent-base";
export { ReferentUnavailableError, ensureReferentAvailable, referentStoreReady } from "@/lib/db/queries/use-case-referent-base";

const T = REFERENT_UI_TEXT;
const RESULT_CAP = 20;

// ─── Piccoli aiuti ───────────────────────────────────────────────────

const ok = <V>(value: V): { ok: true; value: V } => ({ ok: true, value });

function persona(userId: string): ReferentActor {
  return { kind: "persona", userId };
}

/** (Referente già iscritto) Una persona del workspace è di Lateral Space? Le regole dei referenti (`checkContactEmail`). */
function memberIsLateralSpace(m: Pick<WorkspaceMemberFacts, "userId" | "email">, lsDomains: readonly string[], lsMembers: readonly string[]): boolean {
  const user = userContextFrom({ id: m.userId, email: m.email, emailVerified: true }, lsDomains);
  return !checkContactEmail({ email: m.email, user, lsDomains, lsMemberEmails: lsMembers }).ok;
}

/**
 * Le persone del workspace di «A chi», dopo i referenti (`pickerMembersOf`), solo per
 * `listReferentPickerPeople`: una voce per persona, mai chi è già un referente (per account, per email
 * verificata o per email del contatto), mai chi guarda, mai Lateral Space; nome, email coperta e «Fa
 * parte del team». Con `learners` anche i partecipanti ai corsi del workspace, senza niente che li distingua.
 */
function pickerOptionsOf(i: {
  all: readonly WorkspaceMemberFacts[];
  known: readonly { userId: string | null; email: string | null }[];
  people: ReadonlyMap<string, { userId: string | null }>;
  viewerUserId: string;
  lsDomains: readonly string[];
  lsMembers: readonly string[];
  learners: boolean;
}): ReferentMemberOption[] {
  const contactUserIds = new Set<string>();
  for (const c of i.known) if (c.userId) contactUserIds.add(c.userId);
  for (const person of i.people.values()) if (person.userId) contactUserIds.add(person.userId);
  const contactEmails = new Set(i.known.map((c) => c.email).filter((e): e is string => Boolean(e)));
  return pickerMembersOf(i.all, {
    viewerUserId: i.viewerUserId,
    dedupe: { contactEmails, contactUserIds },
    isLateralSpace: (m) => memberIsLateralSpace(m, i.lsDomains, i.lsMembers),
    learners: i.learners,
  }).map((m) => ({ userId: m.userId, displayName: m.displayName, emailMasked: maskEmail(m.email), team: m.team }));
}

/** Il prossimo stato da `reviewerStatus` per una riga letta. */
function statusOf(row: UcRow, now: Date): "inviata" | "completata" | "scaduta" | "revocata" {
  const status = (rowString(row.status) ?? "inviata") as "inviata" | "completata" | "scaduta" | "revocata";
  const expiresAt = rowDate(row.expires_at) ?? now;
  return reviewerStatus({ status, expiresAt }, now);
}

/** Le giornate (Roma) in cui il referente ha già un promemoria partito o in coda, su ogni richiesta. */
async function readRemindedOn(executor: UcExecutor, workspaceId: string, contactIds: readonly string[], excludeEmailId: string | null = null): Promise<Map<string, Set<string>>> {
  const ids = contactIds.filter(isUuid).map((x) => x.toLowerCase());
  const out = new Map<string, Set<string>>();
  if (!ids.length) return out;
  const exclude = excludeEmailId ? ucSql` AND e.id <> ${cast(excludeEmailId, "uuid")}` : raw("");
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT e.contact_id, e.status, e.sent_at, e.scheduled_at
FROM use_case_referent_emails e
WHERE e.workspace_id = ${cast(workspaceId, "uuid")} AND e.template = 'promemoria' AND e.contact_id = ANY(${cast(ids, "uuid[]")})
  AND ((e.status = 'inviata' AND e.sent_at > now() - interval '10 days') OR e.status = 'in_coda' OR (e.status = 'errore' AND e.attempts < 3))${exclude}`),
  ]);
  for (const r of rows) {
    const contact = String(r.contact_id).toLowerCase();
    const at = rowString(r.status) === "inviata" ? rowDate(r.sent_at) : rowDate(r.scheduled_at);
    if (!at) continue;
    const set = out.get(contact) ?? new Set<string>();
    set.add(romeDate(at));
    out.set(contact, set);
  }
  return out;
}

/**
 * Un elemento di promemoria per una richiesta: si aggiunge al promemoria ancora in coda della persona
 * (un'email al giorno), altrimenti nasce una riga nuova con la chiave del giorno. Un promemoria
 * automatico prende il posto di un elemento «a mano» o «domande nuove» della stessa richiesta.
 */
export function queueReminderItemSql(i: {
  workspaceId: string;
  contactId: string;
  requestId: string;
  kind: "primo" | "ultimo" | "manuale" | "nuove";
  newQuestions?: number;
  dedupeKey: string;
  at: Date;
}): UcStatement {
  const ws = cast(uuidOf(i.workspaceId, "workspace"), "uuid");
  const contact = cast(uuidOf(i.contactId, "referente"), "uuid");
  const at = cast(i.at.toISOString(), "timestamptz");
  const fresh = i.kind === "nuove" ? Math.max(1, Math.min(20, Math.floor(i.newQuestions ?? 1))) : 0;
  return toStatement(ucSql`WITH pending AS (
  SELECT e.id FROM use_case_referent_emails e
  WHERE e.workspace_id = ${ws} AND e.contact_id = ${contact} AND e.template = 'promemoria'
    AND (e.status = 'in_coda' OR (e.status = 'errore' AND e.attempts < 3)) AND (e.lease_until IS NULL OR e.lease_until <= now())
  ORDER BY e.created_at, e.id
  LIMIT 1
), created AS (
  INSERT INTO use_case_referent_emails (workspace_id, contact_id, request_id, template, dedupe_key, due_at, scheduled_at)
  SELECT ${ws}, ${contact}, NULL, 'promemoria', ${cast(i.dedupeKey, "text")}, ${at}, ${at}
  WHERE NOT EXISTS (SELECT 1 FROM pending)
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id
), target AS (
  SELECT id FROM pending UNION ALL SELECT id FROM created
)
INSERT INTO use_case_referent_email_items (email_id, request_id, workspace_id, kind, new_questions)
SELECT t.id, ${cast(uuidOf(i.requestId, "richiesta"), "uuid")}, ${ws}, ${cast(i.kind, "text")}, ${cast(fresh, "int")} FROM target t
ON CONFLICT (email_id, request_id) DO UPDATE SET
  kind = CASE WHEN use_case_referent_email_items.kind = 'nuove' AND EXCLUDED.kind = 'nuove' THEN 'nuove' ELSE EXCLUDED.kind END,
  new_questions = CASE WHEN EXCLUDED.kind = 'nuove' AND use_case_referent_email_items.kind = 'nuove'
    THEN least(20, use_case_referent_email_items.new_questions + EXCLUDED.new_questions) ELSE EXCLUDED.new_questions END,
  state = 'in_coda', drop_reason = NULL
WHERE use_case_referent_email_items.kind IN ('manuale', 'nuove') OR use_case_referent_email_items.state = 'tolta'
RETURNING request_id`);
}

/**
 * La scadenza pigra all'inizio di un batch dei revisori (§3.3), con le richieste chieste di nuovo.
 * Una scadenza la causa il tempo, non chi agisce: nessuno è escluso dalla notifica «Nessuna risposta»
 * né dall'avviso a chi ha chiesto (`reask` salta già la richiesta che questo batch chiede di nuovo).
 */
function lazyExpiry(ctx: WriteContext, useCaseId: string, now: Date, reask?: { previousRequestId: string | null; needIds: readonly string[] }): UcStatement[] {
  return expireStatements({ workspaceId: ctx.workspaceId, useCaseId, actorUserId: null, reask, schedule: alertSchedule(now), now });
}

// ─── Le porte comuni (§3.1, 3–5) ─────────────────────────────────────

async function subprocessorsGate(executor: UcExecutor, workspaceId: string, company: string): Promise<ReferentFailure | null> {
  const ack = await loadSubprocessorAck(executor, workspaceId);
  return ack ? null : rfailVars("sub_responsabili_mancanti", { Azienda: companyLabel(company) });
}

async function deliveryGates(executor: UcExecutor, workspaceId: string, company: string, env: Env): Promise<ReferentFailure | null> {
  const sub = await subprocessorsGate(executor, workspaceId, company);
  if (sub) return sub;
  if (!ucEmailConfig(env).ok) return rfail("email_non_configurata");
  // Senza le scritture della pagina pubblica (`UC_SECRET` su Vercel) il referente leggerebbe le domande
  // ma non potrebbe rispondere: niente richieste né promemoria finché non tornano.
  if (!referentPublicWritesAvailable(env)) return rfail("risposte_non_attive");
  return null;
}

/**
 * (0025) Chi agisce è di Lateral Space, riletto adesso (email verificata di un dominio di
 * `UC_LS_EMAIL_DOMAINS`): solo le sue azioni fanno partire «Autorizza i fornitori».
 */
async function actsAsLateralSpace(executor: UcExecutor, userId: string, env: Env): Promise<boolean> {
  return (await loadUserContext(executor, userId, lsDomainsOf(env)))?.isLateralSpace === true;
}

/**
 * (0025) Una porta di invio ha rifiutato perché manca l'«ok sui sub-responsabili»: se chi ha provato
 * è di Lateral Space, l'avviso «Autorizza i fornitori» a chi può darlo (in un batch suo, mai un
 * errore in più). Il rifiuto torna com'è.
 */
async function gateRefused(executor: UcExecutor, ctx: WriteContext, userId: string, useCaseId: string, gate: ReferentFailure, env: Env): Promise<ReferentFailure> {
  if (gate.error === "sub_responsabili_mancanti" && clientNoticesEnabled(ctx.workspaceId, env) && (await actsAsLateralSpace(executor, userId, env))) {
    await noticeSubprocessorsWait(ctx.workspaceId, useCaseId, env);
  }
  return gate;
}

// ─── Il pannello (§5) ────────────────────────────────────────────────

interface RequestRow {
  id: string;
  version: number;
  contactId: string;
  contactName: string;
  roleLabel: string | null;
  contactEmail: string | null;
  contactActive: boolean;
  status: "inviata" | "completata" | "scaduta" | "revocata";
  storedStatus: "inviata" | "completata" | "scaduta" | "revocata";
  createdAt: Date;
  sentAt: Date | null;
  expiresAt: Date;
  lastEmailAt: Date | null;
  lastReminderAt: Date | null;
  /** (Rilascio 6) L'ultima riapertura (domande nuove o un chiarimento dopo «Invia»): i promemoria ripartono da lì. */
  reopenedAt: Date | null;
  reminderCount: number;
  completedAt: Date | null;
  expiredAt: Date | null;
  revokedAt: Date | null;
  openItems: number;
  needIds: string[];
  hasValidToken: boolean;
  richiesta: { pending: boolean; sent: boolean; total: number };
  /** (Rilascio 5) Le domande ancora aperte (quelle che un cambio di referente porta). */
  openNeedIds: string[];
  /** (Rilascio 5) La conferma e la stima, solo per una richiesta al referente. */
  check: ReferentCheckRow | null;
  /** (Rilascio 6) Attiva: «inviata» o «completata», link non scaduto, dati non cancellati (il filo si scrive qui). */
  active: boolean;
}

const uuidList = (value: unknown): string[] =>
  String(value ?? "")
    .replace(/[{}]/g, "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(isUuid);

/** (Rilascio 5) La riga della conferma letta con la richiesta (colonne `k_*`), oppure null. */
function checkRowOf(r: UcRow): ReferentCheckRow | null {
  if (!rowBool(r.has_check)) return null;
  const num = (v: unknown) => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const confirm = rowString(r.k_confirm);
  const estimate = rowString(r.k_estimate);
  const outcome = rowString(r.k_outcome);
  const submittedAt = rowDate(r.k_submitted_at);
  // La bozza resta del referente fino a «Invia» (la query già non la legge): qui una seconda chiusura.
  const sent = submittedAt !== null;
  return {
    submittedAt,
    confirm: sent && (confirm === "si" || confirm === "correggi") ? confirm : null,
    confirmNote: sent ? rowString(r.k_note) : null,
    estimate: sent && (estimate === "si" || estimate === "meno" || estimate === "piu") ? estimate : null,
    timesPerMonth: sent ? num(r.k_times) : null,
    minutesEach: sent ? num(r.k_minutes) : null,
    teamComponentKey: sent ? rowString(r.k_team_key) : null,
    teamVolumeYear: sent ? num(r.k_team_volume) : null,
    teamMinutes: sent ? num(r.k_team_minutes) : null,
    correctionDoneAt: rowDate(r.k_correction_done_at),
    estimateOutcome: outcome === "adottata" || outcome === "tenuta" ? outcome : null,
    estimateOutcomeAt: rowDate(r.k_outcome_at),
    // (Rilascio 5.1) Le risposte per beneficio arrivano dopo, da `benefitsSql` (solo quelle inviate).
    benefits: sent && rowBool(r.k_benefits) ? [] : null,
  };
}

function requestRowOf(r: UcRow, now: Date): RequestRow | null {
  const createdAt = rowDate(r.created_at);
  const expiresAt = rowDate(r.expires_at);
  if (!createdAt || !expiresAt) return null;
  const stored = (rowString(r.status) ?? "inviata") as RequestRow["status"];
  const needIds = String(r.need_ids ?? "")
    .replace(/[{}]/g, "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(isUuid);
  return {
    id: String(r.id).toLowerCase(),
    version: rowNumber(r.version) ?? 1,
    contactId: String(r.contact_id).toLowerCase(),
    contactName: rowString(r.contact_name) || T.referentAuthorFallback,
    roleLabel: rowString(r.role_label),
    contactEmail: rowString(r.contact_email),
    contactActive: rowBool(r.contact_active),
    status: reviewerStatus({ status: stored, expiresAt }, now),
    storedStatus: stored,
    createdAt,
    sentAt: rowDate(r.sent_at),
    expiresAt,
    lastEmailAt: rowDate(r.last_email_at),
    lastReminderAt: rowDate(r.last_reminder_at),
    reopenedAt: rowDate(r.reopened_at),
    reminderCount: rowNumber(r.reminder_count) ?? 0,
    completedAt: rowDate(r.completed_at),
    expiredAt: rowDate(r.expired_at),
    revokedAt: rowDate(r.revoked_at),
    openItems: rowNumber(r.open_items) ?? 0,
    needIds,
    hasValidToken: rowBool(r.has_valid_token),
    richiesta: { pending: rowBool(r.richiesta_pending), sent: rowBool(r.richiesta_sent), total: rowNumber(r.richiesta_total) ?? 0 },
    openNeedIds: uuidList(r.open_need_ids),
    check: checkRowOf(r),
    active: rowBool(r.active),
  };
}

/**
 * (Rilascio 5) Una colonna della bozza del referente (la conferma, la nota, la stima, i numeri e
 * l'istantanea della stima del team), letta solo quando il referente ha premuto «Invia»: prima resta
 * sua e non lascia mai il database (§6.2: il team vede solo quello che il referente invia).
 */
const sentOnly = (column: string) => `CASE WHEN k.submitted_at IS NOT NULL THEN ${column} END`;

function requestsSql(workspaceId: string, useCaseId: string): UcStatement {
  return toStatement(ucSql`SELECT r.id, r.version, r.contact_id, r.status, r.created_at, r.sent_at, r.expires_at, r.last_email_at, r.last_reminder_at, r.reminder_count,
  r.completed_at, r.expired_at, r.revoked_at, r.reopened_at,
  c.display_name AS contact_name, c.role_label, c.email AS contact_email, (c.is_active AND c.anonymized_at IS NULL) AS contact_active,
  ${openItemsCountSql("r")} AS open_items,
  (SELECT array_agg(it.need_id::text ORDER BY it.position) FROM use_case_referent_request_items it WHERE it.request_id = r.id) AS need_ids,
  ${validLinkSql("r")} AS has_valid_token, ${activeRequestSql("r")} AS active,
  EXISTS (SELECT 1 FROM use_case_referent_emails e WHERE e.request_id = r.id AND e.template = 'richiesta'
    AND (e.status = 'in_coda' OR (e.status = 'errore' AND e.attempts < 3))) AS richiesta_pending,
  EXISTS (SELECT 1 FROM use_case_referent_emails e WHERE e.request_id = r.id AND e.template = 'richiesta' AND e.status = 'inviata') AS richiesta_sent,
  (SELECT count(*)::int FROM use_case_referent_emails e WHERE e.request_id = r.id AND e.template = 'richiesta') AS richiesta_total,
  (SELECT array_agg(oi2.need_id::text ORDER BY oi2.position) FROM use_case_referent_request_items oi2 WHERE oi2.request_id = r.id AND ${openItemSql("oi2", "r")}) AS open_need_ids,
  (k.request_id IS NOT NULL) AS has_check, k.submitted_at AS k_submitted_at,
  ${raw(sentOnly("k.confirm"))} AS k_confirm, ${raw(sentOnly("k.confirm_note"))} AS k_note, ${raw(sentOnly("k.estimate"))} AS k_estimate,
  ${raw(sentOnly("k.times_per_month"))} AS k_times, ${raw(sentOnly("k.minutes_each"))} AS k_minutes, ${raw(sentOnly("k.team_component_key"))} AS k_team_key,
  ${raw(sentOnly("k.team_volume_year"))} AS k_team_volume, ${raw(sentOnly("k.team_minutes"))} AS k_team_minutes,
  k.correction_done_at AS k_correction_done_at, k.estimate_outcome AS k_outcome, k.estimate_outcome_at AS k_outcome_at,
  ${raw(sentOnly(BENEFITS_FLAG_SQL("k")))} AS k_benefits
FROM use_case_referent_requests r
LEFT JOIN uc_contacts c ON c.id = r.contact_id AND c.workspace_id = r.workspace_id
LEFT JOIN use_case_referent_checks k ON k.request_id = r.id
WHERE r.workspace_id = ${cast(workspaceId, "uuid")} AND r.use_case_id = ${cast(useCaseId, "uuid")}
ORDER BY r.created_at DESC, r.id
LIMIT ${cast(RESULT_CAP, "int")}`);
}

/**
 * (Rilascio 5.1) Le risposte per beneficio delle conferme inviate di questo use case, nell'ordine delle
 * righe: prima di «Invia» restano del referente (la stessa regola di `sentOnly`).
 */
function benefitsSql(workspaceId: string, useCaseId: string): UcStatement {
  return toStatement(ucSql`SELECT b.request_id, b.component_key, b.position, b.kind, b.label, b.team_volume_year, b.team_minutes, b.team_eur_year, b.answer,
  b.times_per_month, b.minutes_each, b.eur_year, b.comment, b.outcome, b.outcome_at
FROM use_case_referent_check_benefits b
JOIN use_case_referent_checks k ON k.request_id = b.request_id
JOIN use_case_referent_requests r ON r.id = k.request_id
WHERE r.workspace_id = ${cast(workspaceId, "uuid")} AND r.use_case_id = ${cast(useCaseId, "uuid")} AND b.workspace_id = r.workspace_id AND k.submitted_at IS NOT NULL
ORDER BY b.request_id, b.position, b.component_key`);
}

function contactsSql(workspaceId: string): UcStatement {
  return toStatement(ucSql`SELECT c.id, c.display_name, c.role_label, c.email, c.user_id,
  EXISTS (SELECT 1 FROM use_case_referent_requests r WHERE r.contact_id = c.id AND r.workspace_id = c.workspace_id AND r.status = 'inviata' AND r.expires_at > now()) AS has_live
FROM uc_contacts c
WHERE c.workspace_id = ${cast(workspaceId, "uuid")} AND c.is_active AND c.anonymized_at IS NULL
ORDER BY c.created_at, c.id`);
}

function liveOnUseCaseSql(workspaceId: string, useCaseId: string): UcStatement {
  return toStatement(ucSql`SELECT r.id, r.contact_id, EXISTS (SELECT 1 FROM use_case_referent_checks k WHERE k.request_id = r.id) AS referent_request FROM use_case_referent_requests r
WHERE r.workspace_id = ${cast(workspaceId, "uuid")} AND r.use_case_id = ${cast(useCaseId, "uuid")} AND r.status = 'inviata' AND r.expires_at > now()`);
}

function answersSql(workspaceId: string, useCaseId: string): UcStatement {
  return toStatement(ucSql`SELECT a.id, a.need_id, a.source, a.body, a.dont_know, a.submitted_at, a.request_id, a.comment, a.already_attached, a.edited_at,
  coalesce(c.display_name, '') AS contact_name, coalesce(nullif(btrim(u.name), ''), '') AS author_name
FROM use_case_need_answers a
LEFT JOIN use_case_referent_requests r ON r.id = a.request_id
LEFT JOIN uc_contacts c ON c.id = r.contact_id AND c.workspace_id = a.workspace_id
LEFT JOIN users u ON u.id = a.author_user_id
WHERE a.workspace_id = ${cast(workspaceId, "uuid")} AND a.use_case_id = ${cast(useCaseId, "uuid")} AND a.status = 'inviata' AND a.removed_at IS NULL
ORDER BY a.submitted_at DESC, a.id`);
}

function filesSql(workspaceId: string, useCaseId: string): UcStatement {
  return toStatement(ucSql`SELECT f.id, f.need_id, f.source, f.file_name, f.size_bytes, f.scan_status, f.created_at, f.submitted_at,
  f.uploaded_by_user_id, coalesce(c.display_name, '') AS contact_name, coalesce(nullif(btrim(u.name), ''), '') AS author_name,
  CASE WHEN f.source = 'referente' THEN ${requestReferentUserSql("r")} ELSE f.uploaded_by_user_id END AS owner_user_id
FROM use_case_need_files f
LEFT JOIN use_case_referent_requests r ON r.id = f.request_id
LEFT JOIN uc_contacts c ON c.id = r.contact_id AND c.workspace_id = f.workspace_id
LEFT JOIN users u ON u.id = f.uploaded_by_user_id
WHERE f.workspace_id = ${cast(workspaceId, "uuid")} AND f.use_case_id = ${cast(useCaseId, "uuid")} AND f.deleted_at IS NULL AND f.blob_path IS NOT NULL
  AND (f.source = 'revisore' OR f.submitted_at IS NOT NULL) AND f.scan_status IN ('pulito', 'in_revisione')
ORDER BY f.created_at DESC, f.id`);
}

/**
 * Le esigenze il cui ultimo file è un PDF non controllato in tempo (`revisione_scaduta`, il cron dopo
 * 7 giorni) e dopo il quale non è arrivato altro: la scheda lo dice, così si chiede di ricaricarlo.
 */
function expiredReviewsSql(workspaceId: string, useCaseId: string): UcStatement {
  return toStatement(ucSql`SELECT DISTINCT f.need_id FROM use_case_need_files f
JOIN use_case_needs n ON n.id = f.need_id AND n.workspace_id = f.workspace_id
WHERE f.workspace_id = ${cast(workspaceId, "uuid")} AND f.use_case_id = ${cast(useCaseId, "uuid")} AND f.deleted_at IS NULL
  AND f.scan_status = 'rifiutato' AND f.rejection_reason = 'revisione_scaduta'
  AND (f.source = 'revisore' OR f.submitted_at IS NOT NULL)
  AND n.archived_at IS NULL AND n.status NOT IN ('validata', 'non_applicabile')
  AND NOT EXISTS (SELECT 1 FROM use_case_need_files g WHERE g.workspace_id = f.workspace_id AND g.use_case_id = f.use_case_id AND g.need_id = f.need_id
    AND g.deleted_at IS NULL AND g.scan_status IN ('pulito', 'in_revisione') AND g.created_at > f.created_at)`);
}

function importKeysSql(workspaceId: string, useCaseId: string): UcStatement {
  return toStatement(ucSql`SELECT import_key FROM use_case_needs WHERE workspace_id = ${cast(workspaceId, "uuid")} AND import_key LIKE ${cast(`referente:${useCaseId.toLowerCase()}:%`, "text")}`);
}

function emptyPanel(available: boolean, canAsk: boolean): UseCaseReferentPanel {
  return {
    available,
    canAsk,
    canReviewFiles: false,
    gates: [],
    contacts: [],
    requests: [],
    needs: {},
    askableNeedIds: [],
    answerableNeedIds: [],
    preparable: [],
    requester: { name: "", email: null },
    upload: { clientMode: false },
    limits: REFERENT_LIMITS,
  };
}

/**
 * Il pannello di «Chiedi al referente» per il capitolo «Cosa serve» della scheda; null a chi non vede
 * «Cosa serve» (contributori, partecipanti ai corsi). Con la funzione spenta: `available: false`.
 * Le email dei referenti arrivano mascherate; non si legge mai se il referente ha aperto il link.
 */
export async function loadUseCaseReferentPanel(i: {
  workspaceId: string;
  useCaseId: string;
  viewer: UseCaseViewer;
  session: { id: string; name: string | null; email: string; emailVerified: boolean };
  role: string | null;
  needs: UseCaseNeedLists;
  /** (Rilascio 5) Lo use case ha un referente da scegliere (`eligibleForReferent`): il blocco «Referente». */
  eligible?: boolean;
  env?: Env;
  now?: Date;
}): Promise<UseCaseReferentPanel | null> {
  const abilities = abilitiesForUseCase(i.viewer);
  if (!abilities.canSeeNeeds || !isUuid(i.workspaceId) || !isUuid(i.useCaseId)) return null;
  const env = i.env ?? process.env;
  const now = i.now ?? new Date();
  const canAsk = abilities.canEditNeeds;
  if (!referentAskEnabled(i.workspaceId, env) || !(await referentStoreReady())) return emptyPanel(false, canAsk);
  const ws = i.workspaceId.toLowerCase();
  const uc = i.useCaseId.toLowerCase();
  try {
    const executor = await getAppUcExecutor();
    const card = await readCard(executor, ws, uc);
    if (!card) return emptyPanel(false, canAsk);
    const cardNeeds = [...i.needs.requirements, ...i.needs.steps];
    const requirementIds = i.needs.requirements.map((n) => n.id.toLowerCase());
    const [requestRows, contactRows, liveRows, answerRows, fileRows, keyRows, expiredRows, benefitRows, threadMessageRows, suggestionRows] = await executor.batch([
      requestsSql(ws, uc),
      contactsSql(ws),
      liveOnUseCaseSql(ws, uc),
      answersSql(ws, uc),
      filesSql(ws, uc),
      importKeysSql(ws, uc),
      expiredReviewsSql(ws, uc),
      benefitsSql(ws, uc),
      // (Rilascio 6) Il filo con i referenti e le proposte dell'AI.
      threadMessagesSql(ws, uc),
      threadSuggestionsSql(ws, uc),
    ]);
    const threadRows: ThreadRow[] = threadMessageRows.map(threadRowOf).filter((r): r is ThreadRow => r !== null);
    const threadByRequest = threadFactsByRequest(threadRows);
    const reviewExpired = new Set(expiredRows.map((r) => String(r.need_id).toLowerCase()));
    const [asks, ack, lsMembers] = await Promise.all([
      readAsksForNeeds(executor, ws, requirementIds),
      loadSubprocessorAck(executor, ws),
      readLsMemberEmails(executor, ws),
    ]);
    const lsDomains = lsDomainsOf(env);
    const requests = requestRows.map((r) => requestRowOf(r, now)).filter((r): r is RequestRow => r !== null);
    // (Rilascio 5.1) Le risposte per beneficio inviate, sulla conferma della loro richiesta.
    for (const row of benefitRows) {
      const check = requests.find((r) => r.id === String(row.request_id).toLowerCase())?.check;
      if (check?.benefits) check.benefits.push(storedBenefitOf(row));
    }
    const hubOnly = new Map<string, boolean>();
    const contactIds = [...new Set(requests.map((r) => r.contactId))];
    if (contactIds.length) {
      const rows = await executor.batch(contactIds.map((c) => contactHubOnlyReadSql(ws, c)));
      contactIds.forEach((c, index) => hubOnly.set(c, rowBool(rows[index]?.[0]?.hub_only)));
    }
    const remindedOn = await readRemindedOn(executor, ws, contactIds);

    // Le porte, tutte e in ordine: prima l'autorizzazione (§3.1).
    const company = companyLabel(card.company);
    const silent = silentOf(i.needs.requirements, asks, now);
    const askable = askableNeeds(cardNeeds, uc, { silentNeedIds: silent });
    const gates: ReferentGate[] = [];
    if (!ack) {
      const declarer = userContextFrom({ id: i.session.id, email: i.session.email, emailVerified: i.session.emailVerified }, lsDomains);
      // (Rilascio 5.1) Anche Lateral Space, con un ruolo da revisore che autorizza, arriva al pulsante: per conto del cliente.
      const who = subprocessorDeclarerOf(declarer, i.role, lsDomains);
      const canDeclare = who !== null;
      gates.push({
        code: "sub_responsabili_mancanti",
        message: fillText(who === "cliente" ? T.gates.subprocessorsCanDeclare : who === "lateral_space" ? T.gates.subprocessorsLsCanDeclare : T.gates.subprocessorsOther, { Azienda: company }),
        canDeclare,
        settingsHref: subprocessorsSettingsHref(ws),
        linkLabel: T.gates.subprocessorsLink,
      });
    }
    const emailOk = ucEmailConfig(env).ok;
    if (!emailOk) gates.push({ code: "email_non_configurata", message: T.gates.emailNotConfigured });
    const publicWritesOn = referentPublicWritesAvailable(env);
    if (!publicWritesOn) gates.push({ code: "risposte_non_attive", message: T.gates.publicWritesOff });
    if (!i.session.emailVerified) gates.push({ code: "email_non_verificata", message: T.gates.emailNotVerified });
    if (askable.length === 0) gates.push({ code: "nessuna_domanda", message: T.gates.noQuestions });
    const deliveryBlocked = !ack || !emailOk || !publicWritesOn;

    // Referenti: attivi, in ordine di arrivo, email mascherate.
    const liveHere = new Set(liveRows.map((r) => String(r.contact_id).toLowerCase()));
    // (Rilascio 5) La richiesta viva di ogni persona qui: «(è il referente)» o «(ha già delle domande aperte)».
    const liveByContact = new Map<string, { id: string; kind: "referente" | "domande" }>();
    for (const r of liveRows) {
      const contact = String(r.contact_id).toLowerCase();
      const kind = rowBool(r.referent_request) ? "referente" : "domande";
      if (!liveByContact.has(contact) || kind === "referente") liveByContact.set(contact, { id: String(r.id).toLowerCase(), kind });
    }
    const userCtx = new Map<string, Awaited<ReturnType<typeof loadUserContext>>>();
    for (const r of contactRows) {
      const userId = rowString(r.user_id);
      if (userId && !userCtx.has(userId)) userCtx.set(userId, await loadUserContext(executor, userId, lsDomains));
    }
    // (Parte 3) Chi è ogni contatto in Unbundle, adesso: solo «Fa parte del team» e «(sei tu)», niente altro.
    const people = await readReferentPeople(executor, ws, contactRows.map((r) => String(r.id)));
    const contacts: ReferentContactOption[] = contactRows.map((r) => {
      const id = String(r.id).toLowerCase();
      const email = rowString(r.email);
      const userId = rowString(r.user_id);
      const person = people.get(id) ?? NO_PERSON;
      const ls = !checkContactEmail({ email, user: userId ? (userCtx.get(userId) ?? null) : null, lsDomains, lsMemberEmails: lsMembers }).ok;
      const reason: ReferentContactOption["reason"] = !email
        ? "senza_email"
        : ls
          ? "lateral_space"
          : isSelfRequest(person, i.session.id)
            ? "sei_tu"
            : liveHere.has(id)
              ? "richiesta_aperta"
              : null;
      return {
        id,
        displayName: rowString(r.display_name) ?? "",
        roleLabel: rowString(r.role_label),
        emailMasked: maskEmail(email),
        selectable: reason === null,
        reason,
        team: person.reviewer,
        hasOtherRequests: rowBool(r.has_live) && !liveHere.has(id),
        liveRequest: liveByContact.get(id) ?? null,
      };
    });

    // (Rilascio 4) Le persone del workspace non stanno nel pannello di ogni scheda: la finestra le legge
    // quando si apre (`listReferentPickerPeople`), con i partecipanti ai corsi del workspace.

    // Richieste.
    const today = romeDate(now);
    const askableIds = new Set(askable.map((n) => n.id.toLowerCase()));
    const requestViews: ReferentRequestView[] = requests.map((r) => {
      const live = r.status === "inviata";
      const silentRequest = live && r.reminderCount >= 2 && r.openItems > 0;
      const notices: string[] = [];
      if (live && !ack) notices.push(T.notices.remindersStopped);
      if (live && r.sentAt && !r.hasValidToken) notices.push(T.notices.emailChanged);
      const emailState: ReferentRequestView["email"] =
        r.sentAt || r.richiesta.sent
          ? { state: "partita", label: null }
          : r.richiesta.pending
            ? { state: "in_partenza", label: T.emailState.in_partenza }
            : { state: "non_partita", label: T.emailState.non_partita };
      const reminderState: ReminderState = {
        status: r.storedStatus,
        sentAt: r.sentAt,
        expiresAt: r.expiresAt,
        revokedAt: r.revokedAt,
        reminderCount: r.reminderCount,
        lastEmailAt: r.lastEmailAt,
        openItems: r.openItems,
        addressChanged: r.sentAt !== null && !r.hasValidToken,
        remindFrom: r.reopenedAt,
      };
      const name = r.contactName;
      let remind: { allowed: boolean; reason: string | null } = { allowed: false, reason: null };
      if (canAsk && live) {
        if (deliveryBlocked) remind = { allowed: false, reason: T.remindReasons.gate };
        else {
          const check = manualReminderCheck(reminderState, now, { remindedOn: remindedOn.get(r.contactId) ?? new Set() });
          remind = check.ok
            ? { allowed: true, reason: null }
            : {
                allowed: false,
                reason:
                  check.code === "promemoria_gia_inviato"
                    ? fillText(T.remindReasons.alreadyToday, { Nome: name })
                    : check.code === "non_ancora_inviata"
                      ? T.remindReasons.notSent
                      : check.code === "nessuna_domanda_aperta"
                        ? T.remindReasons.noOpen
                        : T.remindReasons.closed,
              };
        }
      }
      const addable = [...askableIds].filter((id) => !r.needIds.includes(id));
      // (Rilascio 6) Anche una richiesta completata con il link valido accetta domande nuove: torna «inviata».
      // Non quando la stessa persona ha già un'altra richiesta «inviata» qui: le domande nuove vanno lì.
      const otherLive = requests.some((o) => o.id !== r.id && o.contactId === r.contactId && o.storedStatus === "inviata");
      const addOpen = live || (r.active && !otherLive);
      const add = !canAsk || !addOpen
        ? { allowed: false, reason: addOpen || otherLive ? null : T.addReasons.closed }
        : r.needIds.length >= REFERENT_LIMITS.questionsPerRequest
          ? { allowed: false, reason: T.addReasons.full }
          : addable.length === 0
            ? { allowed: false, reason: T.addReasons.nothing }
            : deliveryBlocked
              ? { allowed: false, reason: T.remindReasons.gate }
              : { allowed: true, reason: null };
      const contactOk = r.contactActive && Boolean(r.contactEmail);
      return {
        id: r.id,
        version: r.version,
        contact: { id: r.contactId, name, roleLabel: r.roleLabel, emailMasked: maskEmail(r.contactEmail), hubOnly: hubOnly.get(r.contactId) === true },
        status: r.status,
        statusLabel: requestWordOf({ status: r.status, silent: silentRequest, openItems: r.openItems }),
        silent: silentRequest,
        lines: requestLines(
          {
            status: r.storedStatus,
            createdAt: r.createdAt,
            sentAt: r.sentAt,
            expiresAt: r.expiresAt,
            lastEmailAt: r.lastEmailAt,
            lastReminderAt: r.lastReminderAt,
            reminderCount: r.reminderCount,
            completedAt: r.completedAt,
            expiredAt: r.expiredAt,
            revokedAt: r.revokedAt,
            openItems: r.openItems,
            remindFrom: r.reopenedAt,
          },
          today,
          now,
        ),
        notices,
        email: emailState,
        needIds: r.needIds,
        openNeedIds: r.openNeedIds,
        kind: r.check ? "referente" : "domande",
        actions: {
          remind,
          add,
          revoke: canAsk && (r.status === "inviata" || r.status === "completata"),
          askAgain: canAsk && contactOk && (r.status === "scaduta" || silentRequest),
          retry: canAsk && live && !r.sentAt && !r.richiesta.pending && !r.richiesta.sent && r.richiesta.total < 4 && !deliveryBlocked,
          correctEmail: canAsk && r.contactActive && hubOnly.get(r.contactId) === true,
          erase: canAsk,
        },
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        sentAt: r.sentAt ? r.sentAt.toISOString() : null,
        lastReminderAt: r.lastReminderAt ? r.lastReminderAt.toISOString() : null,
      };
    });

    // Esigenze: la riga, le risposte e i file.
    const needsView: Record<string, NeedReferentView> = {};
    // I PDF con poco testo li controllano i revisori del workspace (chi modifica «Cosa serve»), non
    // solo Lateral Space: in un workspace senza persone di Lateral Space nessuno li vedrebbe mai.
    const canReviewFiles = canAsk;
    for (const need of i.needs.requirements) {
      const id = need.id.toLowerCase();
      const own = asks.filter((a) => a.needId === id);
      const latestLine = latestForLine(own, now);
      const silentNeed = silent.has(id);
      const answers: NeedAnswerView[] = answerRows
        .filter((a) => String(a.need_id).toLowerCase() === id)
        // Una domanda risposta solo con un file: la riga della risposta non ha testo, si vede solo il file.
        // (Rilascio 5) «È già allegato» e un commento sono voci anche senza testo.
        .filter((a) => rowBool(a.dont_know) || rowBool(a.already_attached) || Boolean(rowString(a.body)?.trim()) || Boolean(rowString(a.comment)?.trim()))
        .map((a) => {
          const source = rowString(a.source) === "revisore" ? "revisore" : "referente";
          const at = rowDate(a.submitted_at) ?? now;
          return {
            id: String(a.id).toLowerCase(),
            source,
            authorLabel:
              source === "revisore"
                ? rowString(a.author_name)
                  ? fillText(T.teamAuthor, { Nome: String(a.author_name) })
                  : T.teamAuthorFallback
                : rowString(a.contact_name) || T.referentAuthorFallback,
            dateLabel: referentDateLabel(at, today),
            text: rowBool(a.dont_know) ? null : rowString(a.body),
            dontKnow: rowBool(a.dont_know),
            alreadyAttached: rowBool(a.already_attached) && !rowBool(a.dont_know),
            comment: rowString(a.comment)?.trim() || null,
            canRemove: canAsk,
            // (Rilascio 6) «Chiedi un chiarimento» sulla risposta del referente, sulla sua richiesta attiva.
            clarify:
              source === "referente" && rowString(a.request_id)
                ? (() => {
                    const request = requests.find((r) => r.id === String(a.request_id).toLowerCase());
                    return request
                      ? clarifyTargetOf(threadRows, {
                          requestId: request.id,
                          requestActive: request.active,
                          contactName: request.contactName,
                          anchor: { anchor: "domanda", needId: id, componentKey: null },
                          quote: rowBool(a.dont_know) ? T.dontKnowAnswer : (rowString(a.body) ?? rowString(a.comment) ?? ""),
                          canAct: canAsk,
                        })
                      : null;
                  })()
                : null,
            editedLabel: rowDate(a.edited_at) ? fillText(REFERENT_THREAD_TEXT.updated, { data: referentDateLabel(rowDate(a.edited_at)!, today) }) : null,
          };
        });
      const files: NeedFileView[] = fileRows
        .filter((f) => String(f.need_id).toLowerCase() === id)
        .filter((f) => rowString(f.scan_status) === "pulito" || canReviewFiles)
        .map((f) => {
          const fileId = String(f.id).toLowerCase();
          const source = rowString(f.source) === "revisore" ? "revisore" : "referente";
          const status = rowString(f.scan_status) === "in_revisione" ? "in_revisione" : "pulito";
          // Chi ha dato il file (il referente con un account, anche revisore, o chi l'ha caricato dalla scheda) non lo controlla.
          const owner = rowString(f.owner_user_id)?.toLowerCase() ?? null;
          const at = rowDate(f.submitted_at) ?? rowDate(f.created_at) ?? now;
          const reviewable = status === "in_revisione" && canReviewFiles && owner !== i.session.id.toLowerCase();
          return {
            id: fileId,
            name: rowString(f.file_name) ?? "file",
            sizeLabel: formatFileSize(rowNumber(f.size_bytes)),
            dateLabel: referentDateLabel(at, today),
            source,
            authorLabel:
              source === "revisore"
                ? rowString(f.author_name)
                  ? fillText(T.teamAuthor, { Nome: String(f.author_name) })
                  : T.teamAuthorFallback
                : rowString(f.contact_name) || T.referentAuthorFallback,
            status,
            href: status === "pulito" || reviewable ? reviewerFileHref(ws, uc, fileId) : null,
            canDelete: canAsk,
            canReview: reviewable,
          };
        });
      needsView[id] = { needId: id, line: needReferentLine(latestLine, today, uc), silent: silentNeed, answers, files, reviewExpired: reviewExpired.has(id) };
    }

    // (Rilascio 5, §9.5) Il referente dello use case, dalle richieste: mai salvato, mai contato per persona.
    let referent: ReferentBlockView | null = null;
    const latestReferentRequestId = latestRequest(requests.filter((r) => r.check !== null))?.id ?? null;
    if (i.eligible === true) {
      const facts: BlockRequestFact[] = requests.map((r) => ({
        id: r.id,
        version: r.version,
        contactId: r.contactId,
        contactName: r.contactName,
        roleLabel: r.roleLabel,
        emailMasked: maskEmail(r.contactEmail),
        team: people.get(r.contactId)?.reviewer ?? false,
        status: r.storedStatus,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        reminderCount: r.reminderCount,
        openTask: r.openItems,
        check: r.check,
        // (Rilascio 6) Il filo della richiesta e le voci con un chiarimento in attesa.
        thread: threadByRequest.get(r.id) ?? null,
        clarifyingKeys: threadRows.filter((m) => m.requestId === r.id && m.requestActive && m.anchor === "beneficio" && m.componentKey && waitsForReferent(m)).map((m) => m.componentKey!),
      }));
      const referentContact = referentContactOf(facts);
      const declined = referentContact ? await readDeclinedNeedIds(executor, ws, uc, referentContact) : new Set<string>();
      const referentRequestIds = new Set(requests.filter((r) => r.contactId === referentContact).map((r) => r.id));
      const hints = referentContact
        ? answerRows
            .filter((a) => rowBool(a.dont_know) && rowString(a.comment)?.trim() && referentRequestIds.has(String(a.request_id ?? "").toLowerCase()) && declined.has(String(a.need_id).toLowerCase()))
            .map((a) => String(a.comment).replace(/\s+/g, " ").trim())
        : [];
      referent = referentBlockOf({
        eligible: true,
        requests: facts,
        clientRequirementToVerify: i.needs.requirements.some((n) => n.status === "in_verifica" && !n.archivedAt && [null, "cliente", "insieme"].includes(n.ownerSide ?? null)),
        teamNow: teamEstimateOf(card.valueModel),
        rowsNow: impactRowsOf(card.valueModel),
        now,
        declinedNeedIds: [...declined],
        hints,
        askableNeedIds: askable.map((n) => n.id.toLowerCase()),
      });
      // (Rilascio 6) «Chiedi un chiarimento» sulla conferma e su ogni voce della risposta di R*.
      const star = referent ? requests.find((r) => r.id === referent!.referentRequestId) : null;
      if (referent?.check && star) {
        const target = (anchor: { anchor: "beneficio" | "generale"; componentKey: string | null }, quote: string) =>
          clarifyTargetOf(threadRows, { requestId: star.id, requestActive: star.active, contactName: star.contactName, anchor: { ...anchor, needId: null }, quote, canAct: canAsk });
        if (referent.check.submittedAt) referent.check.clarify = target({ anchor: "generale", componentKey: null }, referent.check.note ? `Lo use case: ${referent.check.note}` : referent.check.confirm === "si" ? "Lo use case: sì, è così." : "");
        for (const b of referent.check.benefits ?? []) b.clarify = target({ anchor: "beneficio", componentKey: b.key }, b.label);
      }
    }

    const existingKeys = new Set(keyRows.map((r) => String(r.import_key)));
    const preparable = missingPreparedQuestions({ useCaseId: uc, intake: card.intake, valueModel: card.valueModel, linkedNeeds: cardNeeds, existingImportKeys: existingKeys }).map((q) => q.key);
    const prepareGaps = gapsOf({ useCaseId: uc, intake: card.intake, valueModel: card.valueModel, linkedNeeds: cardNeeds }).length > 0;

    return {
      available: true,
      canAsk,
      canReviewFiles,
      gates,
      contacts,
      requests: requestViews,
      needs: needsView,
      askableNeedIds: askable.map((n) => n.id.toLowerCase()),
      answerableNeedIds: answerableNeeds(cardNeeds, uc).map((n) => n.id.toLowerCase()),
      preparable,
      prepareGaps,
      requester: { name: i.session.name?.trim() || "", email: i.session.email ? i.session.email.toLowerCase() : null },
      upload: { clientMode: clientUploadAvailable(env) },
      limits: REFERENT_LIMITS,
      eligible: i.eligible === true,
      referent,
      latestReferentRequestId,
      thread: {
        messages: threadMessageViewsOf(threadRows, { today, canAct: canAsk }),
        // Con l'aiuto dell'AI spento (`USE_CASE_REFERENT_AI=off`) niente a schermo, nemmeno le proposte già calcolate.
        suggestions: canAsk && referentAiSuggestionsOn(env) ? threadSuggestionViewsOf(suggestionRows) : [],
      },
    };
  } catch (error) {
    logReferentError("pannello", error, { workspaceId: ws });
    return emptyPanel(false, canAsk);
  }
}

/** L'ultima richiesta di un'esigenza per la sua riga (anche revocata), con lo stato dei revisori. */
function latestForLine(asks: readonly AskRow[], now: Date): LatestAskForNeed | null {
  let best: AskRow | null = null;
  for (const a of asks) {
    if (!best || a.createdAt.getTime() > best.createdAt.getTime() || (a.createdAt.getTime() === best.createdAt.getTime() && a.requestId > best.requestId)) best = a;
  }
  if (!best) return null;
  return {
    contactName: best.contactName || T.referentAuthorFallback,
    useCaseId: best.useCaseId,
    useCaseCode: best.useCaseCode,
    status: reviewerStatus(best, now),
    createdAt: best.createdAt,
    sentAt: best.sentAt,
    expiresAt: best.expiresAt,
    expiredAt: best.expiredAt,
    revokedAt: best.revokedAt,
    reminderCount: best.reminderCount,
    lastReminderAt: best.lastReminderAt,
    itemState: best.itemState,
    answeredAt: best.answeredAt,
  };
}

// ─── «Prepara le domande» (§6) ───────────────────────────────────────

/** Le domande standard che mancano alla scheda, in un solo statement; una seconda volta: niente. */
export const prepareReferentQuestions = guardedReferent(
  "prepara_domande",
  async function prepareReferentQuestions(
    ctx: WriteContext,
    useCaseId: string,
    env: Env = process.env,
    /** (Rilascio 5, D32) Le domande standard da non aggiungere: «Scegli il referente» salta frequenza e tempo, che chiede già la stima. */
    skip: readonly string[] = [],
  ): Promise<ServiceResult<{ added: number; gaps: number }> | ReferentFailure> {
    const writer = await referentWriter(ctx, env);
    if (!writer.ok) return writer;
    if (!isUuid(useCaseId)) return rfail("non_trovato");
    const executor = await getAppUcExecutor();
    const card = await readCard(executor, ctx.workspaceId, useCaseId);
    if (!card) return rfail("non_trovato");
    const needs = await readCardNeeds(executor, ctx.workspaceId, card.id);
    const gaps = gapsOf({ useCaseId: card.id, intake: card.intake, valueModel: card.valueModel, linkedNeeds: needs });
    const [keyRows] = await executor.batch([importKeysSql(ctx.workspaceId, card.id)]);
    const skipped = new Set(skip);
    const missing = missingPreparedQuestions({
      useCaseId: card.id,
      intake: card.intake,
      valueModel: card.valueModel,
      linkedNeeds: needs,
      existingImportKeys: new Set(keyRows.map((r) => String(r.import_key))),
    }).filter((q) => !skipped.has(q.key));
    // (0025) «Prepara le domande» di Lateral Space: se il lavoro aspetta l'ok del cliente, «Autorizza i fornitori».
    const supplierNotice = await subprocessorsNoticeFor(ctx.workspaceId, env);
    const notice = supplierNotice && (await actsAsLateralSpace(executor, writer.userId, env)) ? supplierNotice : null;
    if (missing.length === 0) {
      if (notice) await noticeSubprocessorsWait(ctx.workspaceId, card.id, env);
      return ok({ added: 0, gaps: gaps.length });
    }
    const values = missing.map((q) => preparedNeedInput(q, card.id));
    const ws = cast(ctx.workspaceId, "uuid");
    const ucId = cast(card.id, "uuid");
    const insert = toStatement(ucSql`WITH input AS (
  SELECT * FROM jsonb_to_recordset(${cast(JSON.stringify(values.map((v) => ({ kind: v.kind, title: v.title, detail: v.detail, sort_order: v.sortOrder, import_key: v.importKey }))), "text")}::jsonb)
    AS x(kind text, title text, detail text, sort_order int, import_key text)
), ins AS (
  INSERT INTO use_case_needs (workspace_id, type, kind, title, detail, owner_side, status, availability, sort_order, import_key)
  SELECT ${ws}, 'requisito', x.kind, x.title, x.detail, 'cliente', 'da_chiedere', 'subito', x.sort_order, x.import_key
  FROM input x JOIN use_cases u ON u.id = ${ucId} AND u.workspace_id = ${ws}
  ON CONFLICT (workspace_id, import_key) DO NOTHING
  RETURNING id, type, status
), lnk AS (
  INSERT INTO use_case_need_links (need_id, use_case_id) SELECT ins.id, ${ucId} FROM ins ON CONFLICT DO NOTHING RETURNING need_id
), ev AS (
  INSERT INTO use_case_events (workspace_id, use_case_id, actor_user_id, actor_kind, channel, action, fields, phase_before, phase_after)
  SELECT ${ws}, ${ucId}, ${cast(writer.userId, "uuid")}, 'persona', 'pagina', 'modificato', ARRAY['cosa_serve']::text[], NULL, 'aggiunta.requisito.da_chiedere'
  FROM ins
  RETURNING 1
)
SELECT id FROM ins`);
    const readiness = await readinessSyncFor(ctx.workspaceId, env);
    const run = await referentBatch(executor, [
      insert,
      ...cardSyncStatements({ workspaceId: ctx.workspaceId, useCaseIds: [card.id], actorUserId: writer.userId, readiness }),
      ...(notice ? subprocessorsWaitNoticeStatements({ workspaceId: ctx.workspaceId, useCaseId: card.id, notice }) : []),
    ]);
    if (!run.ok) return run;
    return ok({ added: run.rows[0].length, gaps: gaps.length });
  },
);

// ─── «Chiedi al referente» (§3.1, §3.2) ──────────────────────────────

const MAX_QUESTIONS = REFERENT_LIMITS.questionsPerRequest;

type ContactInput =
  | { kind: "esistente"; contactId: string }
  | { kind: "nuovo"; displayName: string; email: string; roleLabel: string | null }
  | { kind: "membro"; userId: string };

interface ParsedSendInput {
  ok: true;
  contact: ContactInput;
  needIds: string[];
  message: string | null;
  previousRequestId: string | null;
  /** (Rilascio 5) «referente» o «domande» (assente = «domande», il rilascio 4). */
  kind: "referente" | "domande";
  /** (Rilascio 5) Le domande con «Serve un file» (un sottoinsieme di `needIds`). */
  fileRequired: string[];
  /** (Rilascio 5) L'ultima richiesta al referente come la vedeva la finestra; undefined: non detta. */
  expectedReferentRequestId: string | null | undefined;
  replaceReferent: boolean;
}

function parseSendInput(raw: unknown): ParsedSendInput | ReferentFailure {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return rfail("dati_non_validi", REFERENT_ERROR_MESSAGES.riprova);
  const r = raw as Record<string, unknown>;
  const c = r.contact as Record<string, unknown> | undefined;
  let contact: ContactInput;
  if (c && c.kind === "esistente" && isUuid(c.contactId)) contact = { kind: "esistente", contactId: c.contactId.toLowerCase() };
  else if (c && c.kind === "nuovo") {
    contact = {
      kind: "nuovo",
      displayName: typeof c.displayName === "string" ? c.displayName : "",
      email: typeof c.email === "string" ? c.email : "",
      roleLabel: typeof c.roleLabel === "string" ? c.roleLabel : null,
    };
  } else if (c && c.kind === "membro" && isUuid(c.userId)) contact = { kind: "membro", userId: c.userId.toLowerCase() };
  else return rfail("referente_non_valido");
  const ids = Array.isArray(r.needIds) ? r.needIds : [];
  if (!ids.every(isUuid)) return rfail("domande_cambiate");
  const message = r.message === undefined || r.message === null ? null : typeof r.message === "string" ? r.message : null;
  const previous = r.previousRequestId === undefined || r.previousRequestId === null ? null : isUuid(r.previousRequestId) ? r.previousRequestId.toLowerCase() : "x";
  if (previous === "x") return rfail("richiesta_chiusa");
  // (Rilascio 5) Il tipo, «Serve un file», la richiesta al referente vista dalla finestra, «Cambia referente».
  if (r.kind !== undefined && r.kind !== null && r.kind !== "referente" && r.kind !== "domande") return rfail("dati_non_validi", REFERENT_ERROR_MESSAGES.riprova);
  const kind = r.kind === "referente" ? "referente" : "domande";
  const files = r.fileRequired === undefined || r.fileRequired === null ? [] : r.fileRequired;
  if (!Array.isArray(files) || !files.every(isUuid)) return rfail("domande_cambiate");
  const expected = r.expectedReferentRequestId === undefined ? undefined : r.expectedReferentRequestId === null ? null : isUuid(r.expectedReferentRequestId) ? r.expectedReferentRequestId.toLowerCase() : "x";
  if (expected === "x") return rfail("referente_gia_scelto");
  if (r.replaceReferent !== undefined && typeof r.replaceReferent !== "boolean") return rfail("dati_non_validi", REFERENT_ERROR_MESSAGES.riprova);
  return {
    ok: true,
    contact,
    needIds: (ids as string[]).map((x) => x.toLowerCase()),
    message,
    previousRequestId: previous,
    kind,
    fileRequired: (files as string[]).map((x) => x.toLowerCase()),
    expectedReferentRequestId: expected,
    replaceReferent: r.replaceReferent === true,
  };
}

/** (Rilascio 5) L'ultima richiesta al referente dello use case (R*, §3.1), per data e poi id: mai per persona. */
function latestReferentRequestSql(workspaceId: string, useCaseId: string): UcStatement {
  return toStatement(ucSql`SELECT r.id, r.contact_id, r.status, r.requested_by_user_id, (now() - r.created_at) < interval '60 seconds' AS recent
FROM use_case_referent_requests r JOIN use_case_referent_checks c ON c.request_id = r.id
WHERE r.workspace_id = ${cast(workspaceId, "uuid")} AND r.use_case_id = ${cast(useCaseId, "uuid")}
ORDER BY r.created_at DESC, r.id DESC
LIMIT 1`);
}

interface LatestReferentRequest {
  id: string;
  contactId: string;
  revoked: boolean;
  requestedBy: string | null;
  recent: boolean;
}

async function readLatestReferentRequest(executor: UcExecutor, workspaceId: string, useCaseId: string): Promise<LatestReferentRequest | null> {
  const [[row]] = await executor.batch([latestReferentRequestSql(workspaceId, useCaseId)]);
  if (!row) return null;
  return {
    id: String(row.id).toLowerCase(),
    contactId: String(row.contact_id).toLowerCase(),
    revoked: rowString(row.status) === "revocata",
    requestedBy: rowString(row.requested_by_user_id)?.toLowerCase() ?? null,
    recent: rowBool(row.recent),
  };
}

/**
 * (Rilascio 5, §3.1) Un referente alla volta: nel batch di invio, prima di tutto, il lock dello use case
 * e la richiesta al referente più recente uguale a quella che la finestra aveva visto. Il batch gira a
 * READ COMMITTED (uc-executor non passa opzioni): ogni statement dopo il lock vede quello che le
 * transazioni prima hanno scritto, quindi due invii insieme non fanno due referenti.
 */
function referentCasStatements(workspaceId: string, useCaseId: string, expected: string | null): UcStatement[] {
  return [
    toStatement(ucSql`SELECT pg_advisory_xact_lock(hashtext('ucref:' || ${cast(useCaseId, "text")}))`),
    toStatement(ucSql`SELECT uc_require((SELECT r.id FROM use_case_referent_requests r JOIN use_case_referent_checks c ON c.request_id = r.id
  WHERE r.workspace_id = ${cast(workspaceId, "uuid")} AND r.use_case_id = ${cast(useCaseId, "uuid")}
  ORDER BY r.created_at DESC, r.id DESC LIMIT 1) IS NOT DISTINCT FROM ${cast(expected, "uuid")}, 'referente_gia_scelto') AS ok`),
  ];
}

/**
 * (Rilascio 5, §3.7) Le domande a cui il referente ha risposto «Non ce l'ho»: l'ultima sua domanda su
 * quell'esigenza, tra le sue richieste su questo use case, è «non_so» e l'esigenza è ancora da chiedere.
 * La scelta dell'ultima è in TypeScript; la lettura filtra sul referente, non conta né ordina per persona.
 */
async function readDeclinedNeedIds(executor: UcExecutor, workspaceId: string, useCaseId: string, contactId: string): Promise<Set<string>> {
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT i.need_id, i.state, r.id AS request_id, r.created_at, n.status AS need_status
FROM use_case_referent_request_items i
JOIN use_case_referent_requests r ON r.id = i.request_id AND r.workspace_id = i.workspace_id
JOIN use_case_needs n ON n.id = i.need_id AND n.workspace_id = r.workspace_id
WHERE r.workspace_id = ${cast(workspaceId, "uuid")} AND r.use_case_id = ${cast(useCaseId, "uuid")} AND r.contact_id = ${cast(contactId, "uuid")}`),
  ]);
  const latest = new Map<string, { at: number; id: string; state: string; needStatus: string }>();
  for (const row of rows) {
    const needId = String(row.need_id).toLowerCase();
    const at = rowDate(row.created_at)?.getTime() ?? 0;
    const id = String(row.request_id).toLowerCase();
    const best = latest.get(needId);
    if (!best || at > best.at || (at === best.at && id > best.id)) latest.set(needId, { at, id, state: rowString(row.state) ?? "", needStatus: rowString(row.need_status) ?? "" });
  }
  return new Set([...latest].filter(([, v]) => v.state === "non_so" && ["mancante", "da_chiedere", "parziale"].includes(v.needStatus)).map(([id]) => id));
}

/** «Chiedi al referente» e «Chiedi di nuovo»: una richiesta, le sue domande, le esigenze «chiesta», la Storia e l'email in coda. */
export const sendReferentRequest = guardedReferent(
  "chiedi_al_referente",
  (ctx: WriteContext, useCaseId: string, input: unknown, deps: SendReferentDeps) => sendReferentRequestOnce(ctx, useCaseId, input, deps, false),
);

type SendReferentDeps = { env: Env; requester: { name: string | null; emailVerified: boolean }; now?: Date };

/**
 * (Rilascio 5, D22) Lo use case ha adesso un referente da scegliere, con la stessa regola della scheda
 * (`eligibleForReferent` sulla fase di oggi, dossier compreso): mai su «Da diffondere», né dopo
 * l'avvio della realizzazione o l'archiviazione. Una finestra rimasta aperta, o una chiamata fatta a
 * mano, non manda così un'email «sei il referente» per uno use case il cui blocco non la mostrerebbe.
 */
async function referentEligibleNow(executor: UcExecutor, workspaceId: string, useCaseId: string, now: Date): Promise<boolean> {
  const [[row]] = await executor.batch([
    toStatement(ucSql`SELECT status, portfolio_review_status, reviewed_by, public_note, intake, review_by::text AS review_by, portfolio_kind, target_quarter
FROM use_cases WHERE id = ${cast(useCaseId, "uuid")} AND workspace_id = ${cast(workspaceId, "uuid")}`),
  ]);
  if (!row) return false;
  // Come la scheda (service.ts loadCard): senza la lettura del dossier la fase si calcola senza.
  const read = await dossierStateForUseCase(workspaceId, useCaseId);
  const portfolioKind = rowString(row.portfolio_kind);
  const input = phaseInputOf(
    {
      status: rowString(row.status),
      portfolioReviewStatus: rowString(row.portfolio_review_status),
      reviewedBy: rowString(row.reviewed_by),
      publicNote: rowString(row.public_note),
      intake: rowJson(row.intake),
      reviewBy: rowString(row.review_by),
      portfolioKind,
      targetQuarter: rowString(row.target_quarter),
    } as Parameters<typeof phaseInputOf>[0],
    read.ok ? read.dossier : null,
    romeToday(now),
  );
  return eligibleForReferent({ portfolioKind, phase: phaseOfUseCase(input).phase });
}

/**
 * Un tentativo di `sendReferentRequest`. `retried`: è il secondo, dopo una corsa sul referente nuovo
 * (un'altra persona lo ha appena creato con la stessa email): al secondo giro lo si ritrova e si usa quello.
 */
async function sendReferentRequestOnce(
  ctx: WriteContext,
  useCaseId: string,
  input: unknown,
  deps: SendReferentDeps,
  retried: boolean,
): Promise<ServiceResult<{ requestId: string; contactName: string }> | ReferentFailure> {
  const now = deps.now ?? new Date();
  const writer = await referentWriter(ctx, deps.env);
  if (!writer.ok) return writer;
  if (!isUuid(useCaseId)) return rfail("non_trovato");
  const executor = await getAppUcExecutor();
  const card = await readCard(executor, ctx.workspaceId, useCaseId);
  if (!card) return rfail("non_trovato");
  const gate = await deliveryGates(executor, ctx.workspaceId, card.company, deps.env);
  if (gate) return gateRefused(executor, ctx, writer.userId, card.id, gate, deps.env);
  if (!deps.requester.emailVerified) return rfail("email_non_verificata");
  const parsed = parseSendInput(input);
  if (!parsed.ok) return parsed;
  // (Rilascio 5) Il referente c'è solo dove la scheda lo offre; le richieste di sole domande restano come nel rilascio 4.
  if (parsed.kind === "referente" && !(await referentEligibleNow(executor, ctx.workspaceId, card.id, now))) return rfail("referente_non_previsto");
  const lsDomains = lsDomainsOf(deps.env);
  const lsMembers = await readLsMemberEmails(executor, ctx.workspaceId);

  // 6. Il referente.
  let contactId = "";
  let contactName = "";
  let newContact: { id: string; draft: ContactDraft; userId: string | null } | null = null;
  /** Un contatto esistente del workspace (scelto, oppure ritrovato dall'email o dalla persona): le regole di sempre. */
  const takeContact = async (id: string, onEmail: boolean): Promise<ReferentFailure | null> => {
    const field = (code: string) => (onEmail ? { email: REFERENT_ERROR_MESSAGES[code] ?? REFERENT_ERROR_MESSAGES.riprova } : undefined);
    const contact = await readContact(executor, ctx.workspaceId, id);
    // Un'email scritta in «+ Nuovo referente» che è di un referente disattivato: la finestra resta
    // aperta con l'errore sotto «Email» (`referente_disattivato` non rilegge la pagina).
    if (onEmail && contact && !contact.anonymized && !contact.isActive) return rfail("referente_disattivato", undefined, field("referente_disattivato"));
    if (!contact || !contact.isActive || contact.anonymized) return rfail("referente_non_valido", undefined, field("referente_non_valido"));
    if (!contact.email) return rfail("email_mancante", REFERENT_ERROR_MESSAGES.email_mancante_esistente);
    const user = contact.userId ? await loadUserContext(executor, contact.userId, lsDomains) : null;
    const check = checkContactEmail({ email: contact.email, user, lsDomains, lsMemberEmails: lsMembers });
    if (!check.ok) return rfail(check.code, undefined, field(check.code));
    // 6b (Parte 3). Chi chiede a se stesso: niente email, risponde dalla scheda.
    if (isSelfRequest(await readReferentPerson(executor, ctx.workspaceId, contact.id), writer.userId)) return rfail("referente_sei_tu", undefined, field("referente_sei_tu"));
    contactId = contact.id;
    contactName = contact.displayName;
    return null;
  };
  if (parsed.contact.kind === "esistente") {
    const refused = await takeContact(parsed.contact.contactId, false);
    if (refused) return refused;
  } else if (parsed.contact.kind === "nuovo") {
    const draft = prepareContact({ displayName: parsed.contact.displayName, email: parsed.contact.email, roleLabel: parsed.contact.roleLabel });
    if (!draft.ok) {
      const field = draft.code === "email_non_valida" ? "email" : "displayName";
      return rfail(draft.code, field === "displayName" ? REFERENT_ERROR_MESSAGES.dati_non_validi : REFERENT_ERROR_MESSAGES.email_non_valida, { [field]: field === "displayName" ? REFERENT_ERROR_MESSAGES.dati_non_validi : REFERENT_ERROR_MESSAGES.email_non_valida });
    }
    if (draft.value.email === null) return rfail("email_mancante", undefined, { email: REFERENT_ERROR_MESSAGES.email_mancante });
    const check = checkContactDraft(draft.value, { lsDomains, lsMemberEmails: lsMembers, user: null });
    if (!check.ok) return rfail(check.code, undefined, { email: REFERENT_ERROR_MESSAGES[check.code] ?? check.message });
    // 6b (Parte 3). La propria email come referente nuovo: niente email, risponde dalla scheda.
    const typedPerson = await readEmailPerson(executor, ctx.workspaceId, draft.value.email);
    if (isSelfRequest(typedPerson, writer.userId)) {
      return rfail("referente_sei_tu", undefined, { email: REFERENT_ERROR_MESSAGES.referente_sei_tu });
    }
    // (Referente già iscritto) L'email è già di un referente del workspace: si usa quello, con il nome
    // che ha già; un referente disattivato resta un errore chiaro. Nessun dato del contatto cambia.
    const [same] = await readPersonContacts(executor, ctx.workspaceId, { email: draft.value.email, userId: null });
    if (same) {
      const refused = await takeContact(same.id, true);
      if (refused) return refused;
    } else {
      // (Referente già iscritto) L'email è di una persona del workspace con l'email verificata: il
      // referente nuovo si collega al suo account, se nessun altro referente lo è già.
      let linkUserId: string | null = null;
      if (typedPerson.member && typedPerson.userId) {
        const linked = await readPersonContacts(executor, ctx.workspaceId, { email: null, userId: typedPerson.userId });
        if (linked.length === 0) linkUserId = typedPerson.userId;
      }
      contactId = randomUUID();
      contactName = draft.value.displayName;
      newContact = { id: contactId, draft: draft.value, userId: linkUserId };
    }
  } else {
    // (Referente già iscritto) Una persona del workspace scelta dall'elenco: tutto si ricontrolla qui.
    // Chi guarda deve già vedere le persone del workspace (Impostazioni › Persone); la persona è ancora
    // del workspace (rilascio 4: anche come partecipante ai corsi di questo workspace), con l'email
    // verificata, non è di Lateral Space e non è chi chiede. Il suo referente si riusa se c'è (per
    // account o per email), altrimenti nasce collegato al suo account; l'email gli dice che ha già un
    // account (`accountNotice`), mai un link alla dashboard.
    // Il ruolo di chi chiede si rilegge qui (`readWorkspaceMembers` senza opzione vuole un ruolo diverso da `learner`).
    const [self] = await readWorkspaceMembers(executor, ctx.workspaceId, writer.userId);
    if (!self || !canSeeWorkspacePeople(self.role)) return rfail("permesso_mancante");
    // Una persona che non si può più scegliere (tolta dal workspace o dal corso, email non più
    // verificata, un id inventato): non è mai stata un referente, quindi un testo suo.
    const [member] = await readWorkspaceMembers(executor, ctx.workspaceId, parsed.contact.userId, { learners: true });
    if (!member) return rfail("persona_non_disponibile");
    if (memberIsLateralSpace(member, lsDomains, lsMembers)) return rfail("referente_lateral_space");
    if (member.userId === writer.userId.toLowerCase()) return rfail("referente_sei_tu");
    const known = await readPersonContacts(executor, ctx.workspaceId, { email: member.email, userId: member.userId });
    const active = known.find((c) => c.isActive);
    if (active) {
      const refused = await takeContact(active.id, false);
      if (refused) return refused;
    } else if (known.length > 0) {
      return rfail("referente_non_valido");
    } else {
      const draft = prepareContact({ displayName: memberDisplayName(member), email: member.email, roleLabel: null });
      if (!draft.ok || draft.value.email === null) return rfail("persona_non_disponibile");
      contactId = randomUUID();
      contactName = draft.value.displayName;
      newContact = { id: contactId, draft: draft.value, userId: member.userId };
    }
  }

  // (Rilascio 5, §3.1) Un referente alla volta: la richiesta al referente più recente è quella che la
  // finestra aveva visto. Un secondo invio uguale entro 60 secondi (doppio clic, rete lenta) dà la
  // stessa richiesta senza scrivere niente.
  const referentKind = parsed.kind === "referente";
  const latestReferent = await readLatestReferentRequest(executor, ctx.workspaceId, card.id);
  const referentContact = latestReferent && !latestReferent.revoked ? latestReferent.contactId : null;
  if (referentKind) {
    const expected = parsed.expectedReferentRequestId ?? null;
    if ((latestReferent?.id ?? null) !== expected) {
      if (latestReferent && latestReferent.recent && latestReferent.requestedBy === writer.userId.toLowerCase() && latestReferent.contactId === contactId) {
        return ok({ requestId: latestReferent.id, contactName });
      }
      return rfail("referente_gia_scelto");
    }
    if (parsed.replaceReferent) {
      if (!referentContact) return rfail("referente_gia_scelto");
      if (referentContact === contactId) return rfail("referente_uguale");
    } else if (referentContact && referentContact !== contactId) return rfail("referente_gia_scelto");
  }

  // 11 (prima della 7 quando c'è): la richiesta di prima.
  let replaceLive: { id: string; version: number } | null = null;
  if (parsed.previousRequestId) {
    const [[prev]] = await executor.batch([
      toStatement(ucSql`SELECT r.id, r.version, r.status, r.expires_at, r.reminder_count, ${openItemsCountSql("r")} AS open_items
FROM use_case_referent_requests r
WHERE r.id = ${cast(parsed.previousRequestId, "uuid")} AND r.workspace_id = ${cast(ctx.workspaceId, "uuid")} AND r.use_case_id = ${cast(card.id, "uuid")} AND r.contact_id = ${cast(contactId, "uuid")}`),
    ]);
    if (!prev) return rfail("richiesta_chiusa");
    const status = statusOf(prev, now);
    if (status === "inviata") {
      if ((rowNumber(prev.reminder_count) ?? 0) < 2 || (rowNumber(prev.open_items) ?? 0) <= 0) return rfail("richiesta_chiusa");
      replaceLive = { id: String(prev.id).toLowerCase(), version: rowNumber(prev.version) ?? 1 };
    } else if (status !== "scaduta") return rfail("richiesta_chiusa");
  }

  // (Rilascio 6) Domande a una persona che ha già una richiesta attiva su questo use case (viva, o completata
  // con il link ancora valido): entrano lì, sotto «Nuove domande», invece di una richiesta nuova.
  if (!referentKind && !parsed.previousRequestId && !newContact) {
    const activeId = await readActiveRequestId(executor, ctx.workspaceId, card.id, contactId);
    const active = activeId ? await readRequest(executor, ctx.workspaceId, card.id, activeId, now) : null;
    if (active?.active) {
      const message = checkRequestMessage(parsed.message);
      if (!message.ok) return rfail(message.code, message.message, { message: message.message });
      const joined = await addQuestionsToRequest({
        ctx,
        executor,
        card,
        request: active,
        expectedVersion: active.version,
        needIds: parsed.needIds,
        fileRequired: parsed.fileRequired,
        message: message.value,
        writerId: writer.userId,
        deps: { env: deps.env, now },
      });
      if (!joined.ok) return joined;
      return ok({ requestId: joined.value.requestId, contactName: active.contactName || contactName });
    }
  }

  // 7. Nessun'altra richiesta viva per questa persona su questo use case (un referente che c'era già).
  // (Rilascio 5, D48, D49) Una richiesta al referente revoca, nello stesso batch, le richieste vive di
  // sole domande della persona scelta e, con «Cambia referente», ogni richiesta viva del referente di
  // prima su questo use case; le loro domande aperte passano alla richiesta nuova.
  const revokeTargets: { id: string; version: number }[] = [];
  if (!newContact || referentKind) {
    const [live] = await executor.batch([
      toStatement(ucSql`SELECT r.id, r.version, r.contact_id, EXISTS (SELECT 1 FROM use_case_referent_checks k WHERE k.request_id = r.id) AS referent_request
FROM use_case_referent_requests r
WHERE r.workspace_id = ${cast(ctx.workspaceId, "uuid")} AND r.use_case_id = ${cast(card.id, "uuid")}
AND r.status = 'inviata' AND r.expires_at > now()`),
    ]);
    const others = live.filter((r) => String(r.id).toLowerCase() !== replaceLive?.id);
    const mine = others.filter((r) => String(r.contact_id).toLowerCase() === contactId);
    const target = (r: UcRow) => ({ id: String(r.id).toLowerCase(), version: rowNumber(r.version) ?? 1 });
    if (referentKind) {
      if (mine.some((r) => rowBool(r.referent_request))) return rfail("richiesta_aperta");
      revokeTargets.push(...mine.map(target));
      if (parsed.replaceReferent && referentContact) revokeTargets.push(...others.filter((r) => String(r.contact_id).toLowerCase() === referentContact).map(target));
    } else if (mine.length > 0) return rfail("richiesta_aperta");
  }
  // Le domande aperte delle richieste da revocare che nessun'altra richiesta viva chiede ancora.
  let carried: string[] = [];
  if (revokeTargets.length) {
    const revokeIds = cast(revokeTargets.map((t) => t.id), "uuid[]");
    const [rows] = await executor.batch([
      toStatement(ucSql`SELECT DISTINCT it.need_id FROM use_case_referent_request_items it JOIN use_case_referent_requests r ON r.id = it.request_id AND r.workspace_id = it.workspace_id
WHERE r.workspace_id = ${cast(ctx.workspaceId, "uuid")} AND r.id = ANY(${revokeIds}) AND ${openItemSql("it", "r")}
  AND NOT EXISTS (SELECT 1 FROM use_case_referent_request_items o JOIN use_case_referent_requests ro ON ro.id = o.request_id
    WHERE o.need_id = it.need_id AND o.state = 'aperta' AND ro.status = 'inviata' AND ro.expires_at > now() AND ro.id <> ALL(${revokeIds}))`),
    ]);
    carried = rows.map((r) => String(r.need_id).toLowerCase());
  }
  const carriedSet = new Set(carried);

  // 8. Le domande. (Rilascio 5) Una richiesta al referente può non averne: riceve la conferma e la stima.
  const unique = [...new Set(parsed.needIds)];
  if (unique.length === 0 && !referentKind) return rfail("nessuna_domanda", undefined, { needIds: REFERENT_ERROR_MESSAGES.nessuna_domanda });
  if (unique.length !== parsed.needIds.length) return rfail("domande_cambiate");
  if (unique.length > MAX_QUESTIONS) return rfail("troppe_domande", undefined, { needIds: REFERENT_ERROR_MESSAGES.troppe_domande });
  const fileRequired = [...new Set(parsed.fileRequired)];
  if (!fileRequired.every((id) => unique.includes(id))) return rfail("domande_cambiate");
  const needs = await readCardNeeds(executor, ctx.workspaceId, card.id);
  const asks = await readAsksForNeeds(executor, ctx.workspaceId, needs.map((n) => n.id));
  const silent = silentOf(needs, asks, now);
  const askable = new Map(askableNeeds(needs, card.id, { silentNeedIds: silent }).map((n) => [n.id.toLowerCase(), n]));
  // (Rilascio 5) Le domande portate dalle richieste revocate si possono chiedere anche se sono «Chiesta».
  for (const need of needs) if (carriedSet.has(need.id.toLowerCase()) && !askable.has(need.id.toLowerCase())) askable.set(need.id.toLowerCase(), need);
  if (!unique.every((id) => askable.has(id))) return rfail("domande_cambiate");
  // (Rilascio 5, §3.7) Al referente non si richiede una domanda a cui ha già risposto «Non ce l'ho».
  if (!referentKind && referentContact !== null && referentContact === contactId) {
    const declined = await readDeclinedNeedIds(executor, ctx.workspaceId, card.id, referentContact);
    if (unique.some((id) => declined.has(id))) return rfail("domande_cambiate");
  }
  // 9. I titoli. 10. Il messaggio.
  for (const id of unique) {
    const title = askable.get(id)!.title;
    const check = checkQuestionTitle(title);
    if (!check.ok) return rfail(check.code, `Nella domanda «${title.slice(0, 60)}»: ${check.message}`, { needIds: check.message });
  }
  const message = checkRequestMessage(parsed.message);
  if (!message.ok) return rfail(message.code, message.message, { message: message.message });
  const silentIds = unique.filter((id) => silent.has(id) && !carriedSet.has(id));

  // Il batch (§3.2). (Rilascio 5) Una richiesta al referente parte con il lock e il controllo del referente.
  const requestId = randomUUID();
  const ws = cast(ctx.workspaceId, "uuid");
  const ucId = cast(card.id, "uuid");
  const actor = persona(writer.userId);
  const statements: UcStatement[] = referentKind ? referentCasStatements(ctx.workspaceId, card.id, parsed.expectedReferentRequestId ?? null) : [];
  statements.push(...lazyExpiry(ctx, card.id, now, { previousRequestId: parsed.previousRequestId, needIds: unique }));
  if (replaceLive) {
    statements.push(...revokeStatements({ workspaceId: ctx.workspaceId, target: { requestId: replaceLive.id, version: replaceLive.version, statuses: ["inviata"] }, reason: "sostituita", actor, failCode: "richiesta_chiusa" }));
  }
  if (revokeTargets.length) {
    // Le domande aperte tornano «Non ancora chiesta» e la transizione qui sotto le chiede subito di nuovo.
    statements.push(...revokeStatements({ workspaceId: ctx.workspaceId, target: { requests: revokeTargets }, reason: "revisore", actor, failCode: "versione_superata" }));
  }
  if (silentIds.length) statements.push(silentGuardSql(ctx.workspaceId, silentIds));
  if (newContact) {
    statements.push(contactInsertSql({ id: newContact.id, workspaceId: ctx.workspaceId, draft: newContact.draft, createdByUserId: writer.userId }));
    if (newContact.userId) statements.push(linkNewContactUserSql(ctx.workspaceId, newContact.id, newContact.userId));
  }
  const requesterName = (deps.requester.name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  statements.push(
    toStatement(
      requireRows(
        ucSql`INSERT INTO use_case_referent_requests (id, workspace_id, use_case_id, contact_id, requested_by_user_id, requester_name, message, expires_at, previous_request_id)
SELECT ${cast(requestId, "uuid")}, w.id, u.id, ${cast(contactId, "uuid")}, ${cast(writer.userId, "uuid")},
coalesce(nullif(${cast(requesterName, "text")}, ''), left('Il team di ' || w.name, 120)), ${cast(message.value, "text")}, now() + interval '30 days', ${cast(parsed.previousRequestId, "uuid")}
FROM workspaces w JOIN use_cases u ON u.workspace_id = w.id AND u.id = ${ucId}
WHERE w.id = ${ws}
RETURNING id`,
        1,
        "non_trovato",
      ),
    ),
  );
  if (unique.length) statements.push(itemsInsertSql(ctx.workspaceId, card.id, requestId, unique, 0, fileRequired));
  if (referentKind) {
    // La riga della conferma nasce con la richiesta: la segna come richiesta al referente.
    statements.push(
      toStatement(ucSql`INSERT INTO use_case_referent_checks (request_id, workspace_id, use_case_id) VALUES (${cast(requestId, "uuid")}, ${ws}, ${ucId})`),
    );
  }
  if (unique.length) {
    statements.push(
      needTransitionSql({
        workspaceId: ctx.workspaceId,
        needIds: unique,
        from: ["da_chiedere", "mancante", "parziale"],
        silentIds,
        to: "chiesta",
        actor,
        expect: { count: unique.length, code: "domande_cambiate" },
      }),
    );
  }
  statements.push(
    referentEventSql({ workspaceId: ctx.workspaceId, useCaseId: card.id, code: referentKind ? (parsed.replaceReferent ? "referente_cambiato" : "referente") : "inviata", actor }),
    toStatement(ucSql`INSERT INTO use_case_referent_emails (workspace_id, contact_id, request_id, template, dedupe_key, due_at, scheduled_at)
VALUES (${ws}, ${cast(contactId, "uuid")}, ${cast(requestId, "uuid")}, 'richiesta', ${cast(`ric:${requestId}:1`, "text")}, now(), now())`),
    ...cardSyncStatements({ workspaceId: ctx.workspaceId, useCaseIds: [card.id], actorUserId: writer.userId, readiness: await readinessSyncFor(ctx.workspaceId, deps.env, now) }),
  );
  const run = await referentBatch(executor, statements);
  if (!run.ok) {
    // (Rilascio 5) Un altro invio è arrivato prima, dentro il lock: se era lo stesso (doppio clic con un
    // referente nuovo) il secondo giro ritrova il referente e la richiesta appena creati, senza scrivere.
    if (run.error === "referente_gia_scelto" && referentKind && !retried) return sendReferentRequestOnce(ctx, useCaseId, input, deps, true);
    if (run.error === "email_in_uso") {
      // (Corsa) Fra i controlli e il batch un'altra persona ha creato il referente con la stessa
      // email (per esempio due revisori scelgono insieme la stessa persona): il batch non ha scritto
      // niente. Si rifà tutto una volta: adesso il referente c'è e si usa quello, con le regole di sempre.
      if (newContact && !retried) return sendReferentRequestOnce(ctx, useCaseId, input, deps, true);
      return rfail("email_in_uso", undefined, { email: REFERENT_ERROR_MESSAGES.email_in_uso });
    }
    return run;
  }
  return ok({ requestId, contactName });
}

/**
 * Le domande nuove della richiesta, alle posizioni dopo `offset`, con il titolo dell'esigenza di adesso.
 * (Rilascio 5) Con «Serve un file» per quelle in `fileRequired`.
 */
function itemsInsertSql(workspaceId: string, useCaseId: string, requestId: string, needIds: readonly string[], offset: number, fileRequired: readonly string[] = []): UcStatement {
  const ws = cast(workspaceId, "uuid");
  return toStatement(ucSql`WITH ins AS (
  INSERT INTO use_case_referent_request_items (request_id, need_id, workspace_id, position, question, file_required, follow_up)
  SELECT ${cast(requestId, "uuid")}, n.id, n.workspace_id, (${cast(offset, "int")} + x.ord)::smallint, n.title, n.id = ANY(${cast([...fileRequired], "uuid[]")}),
    -- (Rilascio 6) Dopo il primo «Invia» del referente le domande stanno sotto «Nuove domande».
    coalesce((SELECT rr.completed_at IS NOT NULL FROM use_case_referent_requests rr WHERE rr.id = ${cast(requestId, "uuid")}), false)
  FROM unnest(${cast([...needIds], "uuid[]")}) WITH ORDINALITY AS x(id, ord)
  JOIN use_case_needs n ON n.id = x.id
  JOIN use_case_need_links l ON l.need_id = n.id AND l.use_case_id = ${cast(useCaseId, "uuid")}
  WHERE n.workspace_id = ${ws} AND n.archived_at IS NULL AND n.type = 'requisito'
  RETURNING 1
)
${casTail("ins", needIds.length, "domande_cambiate")}`);
}

/**
 * (Parte 2) Le esigenze «Senza risposta» chieste di nuovo: nessun'altra richiesta viva e non
 * «senza risposta» le chiede ancora. Prima dell'inserimento della richiesta nuova.
 */
function silentGuardSql(workspaceId: string, silentIds: readonly string[]): UcStatement {
  return toStatement(ucSql`WITH ok AS (
  SELECT n.id FROM use_case_needs n
  WHERE n.id = ANY(${cast([...silentIds], "uuid[]")}) AND n.workspace_id = ${cast(workspaceId, "uuid")} AND n.status = 'chiesta' AND n.archived_at IS NULL AND n.type = 'requisito'
    AND NOT EXISTS (
      SELECT 1 FROM use_case_referent_request_items i JOIN use_case_referent_requests r ON r.id = i.request_id AND r.workspace_id = i.workspace_id
      WHERE i.need_id = n.id AND i.state = 'aperta' AND r.status = 'inviata' AND r.expires_at > now() AND r.reminder_count < 2)
)
${casTail("ok", silentIds.length, "domande_cambiate")}`);
}

// ─── Una richiesta viva: lettura con la versione ─────────────────────

interface LiveRequest {
  id: string;
  version: number;
  contactId: string;
  contactName: string;
  status: "inviata" | "completata" | "scaduta" | "revocata";
  storedStatus: "inviata" | "completata" | "scaduta" | "revocata";
  sentAt: Date | null;
  expiresAt: Date;
  revokedAt: Date | null;
  reminderCount: number;
  lastEmailAt: Date | null;
  openItems: number;
  needIds: string[];
  richiestaPending: boolean;
  richiestaSent: boolean;
  richiestaTotal: number;
  hasValidToken: boolean;
  /** (Rilascio 6) Attiva: «inviata» o «completata», link non scaduto, dati non cancellati. */
  active: boolean;
}

async function readRequest(executor: UcExecutor, workspaceId: string, useCaseId: string, requestId: string, now: Date): Promise<LiveRequest | null> {
  if (!isUuid(requestId)) return null;
  const [[r]] = await executor.batch([
    toStatement(ucSql`SELECT r.id, r.version, r.contact_id, r.status, r.sent_at, r.expires_at, r.revoked_at, r.reminder_count, r.last_email_at,
  coalesce(c.display_name, '') AS contact_name, ${openItemsCountSql("r")} AS open_items, ${validLinkSql("r")} AS has_valid_token, ${activeRequestSql("r")} AS active,
  (SELECT array_agg(it.need_id::text ORDER BY it.position) FROM use_case_referent_request_items it WHERE it.request_id = r.id) AS need_ids,
  EXISTS (SELECT 1 FROM use_case_referent_emails e WHERE e.request_id = r.id AND e.template = 'richiesta' AND (e.status = 'in_coda' OR (e.status = 'errore' AND e.attempts < 3))) AS richiesta_pending,
  EXISTS (SELECT 1 FROM use_case_referent_emails e WHERE e.request_id = r.id AND e.template = 'richiesta' AND e.status = 'inviata') AS richiesta_sent,
  (SELECT count(*)::int FROM use_case_referent_emails e WHERE e.request_id = r.id AND e.template = 'richiesta') AS richiesta_total
FROM use_case_referent_requests r
LEFT JOIN uc_contacts c ON c.id = r.contact_id AND c.workspace_id = r.workspace_id
WHERE r.id = ${cast(requestId, "uuid")} AND r.workspace_id = ${cast(workspaceId, "uuid")} AND r.use_case_id = ${cast(useCaseId, "uuid")}`),
  ]);
  if (!r) return null;
  const expiresAt = rowDate(r.expires_at);
  if (!expiresAt) return null;
  const stored = (rowString(r.status) ?? "inviata") as LiveRequest["status"];
  return {
    id: String(r.id).toLowerCase(),
    version: rowNumber(r.version) ?? 1,
    contactId: String(r.contact_id).toLowerCase(),
    contactName: rowString(r.contact_name) || T.referentAuthorFallback,
    status: reviewerStatus({ status: stored, expiresAt }, now),
    storedStatus: stored,
    sentAt: rowDate(r.sent_at),
    expiresAt,
    revokedAt: rowDate(r.revoked_at),
    reminderCount: rowNumber(r.reminder_count) ?? 0,
    lastEmailAt: rowDate(r.last_email_at),
    openItems: rowNumber(r.open_items) ?? 0,
    needIds: String(r.need_ids ?? "")
      .replace(/[{}]/g, "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(isUuid),
    richiestaPending: rowBool(r.richiesta_pending),
    richiestaSent: rowBool(r.richiesta_sent),
    richiestaTotal: rowNumber(r.richiesta_total) ?? 0,
    hasValidToken: rowBool(r.has_valid_token),
    active: rowBool(r.active),
  };
}

function versionCasSql(workspaceId: string, requestId: string, version: number): UcStatement {
  return toStatement(
    requireRows(
      ucSql`UPDATE use_case_referent_requests SET version = version + 1
WHERE id = ${cast(requestId, "uuid")} AND workspace_id = ${cast(workspaceId, "uuid")} AND version = ${cast(version, "int")} AND status = 'inviata' AND expires_at > now()
RETURNING id`,
      1,
      "versione_superata",
    ),
  );
}

function reminderStateOf(r: LiveRequest): ReminderState {
  return {
    status: r.storedStatus,
    sentAt: r.sentAt,
    expiresAt: r.expiresAt,
    revokedAt: r.revokedAt,
    reminderCount: r.reminderCount,
    lastEmailAt: r.lastEmailAt,
    openItems: r.openItems,
    addressChanged: r.sentAt !== null && !r.hasValidToken,
  };
}

// ─── «Aggiungi domande» (§3.4) ───────────────────────────────────────

/** (Rilascio 6) La versione letta di una richiesta attiva («inviata» o «completata», non scaduta, non cancellata). */
function activeVersionCasSql(workspaceId: string, requestId: string, version: number): UcStatement {
  return toStatement(
    requireRows(
      ucSql`UPDATE use_case_referent_requests r SET version = version + 1
WHERE r.id = ${cast(requestId, "uuid")} AND r.workspace_id = ${cast(workspaceId, "uuid")} AND r.version = ${cast(version, "int")} AND ${activeRequestSql("r")}
RETURNING id`,
      1,
      "versione_superata",
    ),
  );
}

/**
 * Le domande nuove nella richiesta attiva di una persona su questo use case: «Aggiungi domande» e (rilascio 6)
 * «Chiedi al referente» o «Scegli il referente» verso chi ha già una richiesta attiva qui. Una richiesta
 * «completata» torna «inviata» (sulla pagina del referente le domande stanno sotto «Nuove domande»), il link
 * si rinnova per 30 giorni, un messaggio nuovo prende il posto di quello di prima, e l'email «nuove» parte
 * con la regola di sempre: in orario d'ufficio, un'email al giorno per persona.
 */
async function addQuestionsToRequest(i: {
  ctx: WriteContext;
  executor: UcExecutor;
  card: { id: string };
  request: LiveRequest;
  expectedVersion: number;
  needIds: readonly string[];
  fileRequired: readonly string[];
  message: string | null;
  writerId: string;
  deps: { env: Env; now?: Date };
}): Promise<ServiceResult<{ added: number; emailQueued: boolean; contactName: string; requestId: string }> | ReferentFailure> {
  const { ctx, executor, card, request } = i;
  const now = i.deps.now ?? new Date();
  if (!request.active) return rfail("richiesta_chiusa");
  if (request.version !== i.expectedVersion) return rfail("versione_superata");
  const unique = [...new Set(i.needIds.map((x) => x.toLowerCase()))];
  if (unique.length === 0) return rfail("nessuna_domanda", undefined, { needIds: REFERENT_ERROR_MESSAGES.nessuna_domanda });
  if (unique.length !== i.needIds.length || unique.some((id) => request.needIds.includes(id))) return rfail("domande_cambiate");
  const fileRequired = [...new Set(i.fileRequired.map((x) => x.toLowerCase()))];
  if (!fileRequired.every((id) => unique.includes(id))) return rfail("domande_cambiate");
  if (request.needIds.length + unique.length > MAX_QUESTIONS) return rfail("troppe_domande", undefined, { needIds: REFERENT_ERROR_MESSAGES.troppe_domande });
  const needs = await readCardNeeds(executor, ctx.workspaceId, card.id);
  const asks = await readAsksForNeeds(executor, ctx.workspaceId, needs.map((n) => n.id));
  const silent = silentOf(needs, asks, now);
  const askable = new Map(askableNeeds(needs, card.id, { silentNeedIds: silent }).map((n) => [n.id.toLowerCase(), n]));
  if (!unique.every((id) => askable.has(id))) return rfail("domande_cambiate");
  // (Rilascio 5, §3.7) Alla richiesta del referente non si aggiunge una domanda a cui ha risposto «Non ce l'ho».
  const latestReferent = await readLatestReferentRequest(executor, ctx.workspaceId, card.id);
  if (latestReferent && !latestReferent.revoked && latestReferent.contactId === request.contactId) {
    const declined = await readDeclinedNeedIds(executor, ctx.workspaceId, card.id, request.contactId);
    if (unique.some((id) => declined.has(id))) return rfail("domande_cambiate");
  }
  for (const id of unique) {
    const title = askable.get(id)!.title;
    const check = checkQuestionTitle(title);
    if (!check.ok) return rfail(check.code, `Nella domanda «${title.slice(0, 60)}»: ${check.message}`, { needIds: check.message });
  }
  const silentIds = unique.filter((id) => silent.has(id));
  // L'email della novità, sulla richiesta com'è dopo questo batch: «inviata», con il link rinnovato.
  const remindedOn = await readRemindedOn(executor, ctx.workspaceId, [request.contactId]);
  const renewed = new Date(Math.max(request.expiresAt.getTime(), now.getTime() + REFERENT_LINK_RENEW_DAYS * 86_400_000));
  const emailAt = threadEmailAt(
    { status: "inviata", revokedAt: request.revokedAt, expiresAt: renewed, sentAt: request.sentAt, lastEmailAt: request.lastEmailAt, addressChanged: request.sentAt !== null && !request.hasValidToken },
    now,
    remindedOn.get(request.contactId) ?? new Set(),
  );
  const actor = persona(i.writerId);
  const ws = cast(ctx.workspaceId, "uuid");
  const req = cast(request.id, "uuid");
  const statements: UcStatement[] = [
    ...lazyExpiry(ctx, card.id, now),
    activeVersionCasSql(ctx.workspaceId, request.id, i.expectedVersion),
    ...reopenRequestStatements({ workspaceId: ctx.workspaceId, requestId: request.id }),
    // Una richiesta completata non si riapre quando la stessa persona ne ha un'altra «inviata» qui: le domande
    // nuove vanno a quella (la scheda offre «Aggiungi domande» solo lì), mai in una richiesta che resta completata.
    toStatement(ucSql`SELECT uc_require(EXISTS (SELECT 1 FROM use_case_referent_requests r WHERE r.id = ${req} AND r.workspace_id = ${ws} AND r.status = 'inviata'), 'richiesta_aperta') AS ok`),
    ...renewLinkStatements({ workspaceId: ctx.workspaceId, requestId: request.id }),
  ];
  if (i.message) statements.push(toStatement(ucSql`UPDATE use_case_referent_requests SET message = ${cast(i.message, "text")} WHERE id = ${req} AND workspace_id = ${ws}`));
  if (silentIds.length) statements.push(silentGuardSql(ctx.workspaceId, silentIds));
  statements.push(
    itemsInsertSql(ctx.workspaceId, card.id, request.id, unique, request.needIds.length, fileRequired),
    needTransitionSql({ workspaceId: ctx.workspaceId, needIds: unique, from: ["da_chiedere", "mancante", "parziale"], silentIds, to: "chiesta", actor, expect: { count: unique.length, code: "domande_cambiate" } }),
    referentEventSql({ workspaceId: ctx.workspaceId, useCaseId: card.id, code: "domande_aggiunte", actor }),
    ...cardSyncStatements({ workspaceId: ctx.workspaceId, useCaseIds: [card.id], actorUserId: i.writerId, readiness: await readinessSyncFor(ctx.workspaceId, i.deps.env, now) }),
  );
  if (emailAt) {
    statements.push(
      queueThreadEmailItemSql({
        workspaceId: ctx.workspaceId,
        contactId: request.contactId,
        requestId: request.id,
        newQuestions: unique.length,
        // Dopo «Correggi l'email» la chiave cambia a ogni versione: un promemoria partito oggi al vecchio indirizzo non la blocca.
        dedupeKey: request.sentAt && !request.hasValidToken ? `pm:${request.id}:${romeDate(emailAt)}:v${i.expectedVersion}` : `pm:${request.id}:${romeDate(emailAt)}`,
        at: emailAt,
      }),
    );
  }
  const run = await referentBatch(executor, statements);
  if (!run.ok) return run;
  return ok({ added: unique.length, emailQueued: emailAt !== null && emailAt.getTime() <= now.getTime(), contactName: request.contactName, requestId: request.id });
}

export const addToReferentRequest = guardedReferent(
  "aggiungi_domande",
  async function addToReferentRequest(
    ctx: WriteContext,
    useCaseId: string,
    requestId: string,
    expectedVersion: number,
    input: unknown,
    deps: { env: Env; now?: Date },
  ): Promise<ServiceResult<{ added: number; emailQueued: boolean; contactName: string }> | ReferentFailure> {
    const now = deps.now ?? new Date();
    const writer = await referentWriter(ctx, deps.env);
    if (!writer.ok) return writer;
    if (!isUuid(useCaseId) || !isUuid(requestId) || !isVersion(expectedVersion)) return rfail("non_trovato");
    const executor = await getAppUcExecutor();
    const card = await readCard(executor, ctx.workspaceId, useCaseId);
    if (!card) return rfail("non_trovato");
    const gate = await deliveryGates(executor, ctx.workspaceId, card.company, deps.env);
    if (gate) return gateRefused(executor, ctx, writer.userId, card.id, gate, deps.env);
    const request = await readRequest(executor, ctx.workspaceId, card.id, requestId, now);
    // (Rilascio 6) Anche una richiesta completata il cui link è ancora valido: torna «inviata».
    if (!request || !request.active) return rfail("richiesta_chiusa");
    if (request.version !== expectedVersion) return rfail("versione_superata");
    const body = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
    const raw = body.needIds;
    const ids = Array.isArray(raw) && raw.every(isUuid) ? (raw as string[]).map((x) => x.toLowerCase()) : null;
    if (!ids || ids.length === 0) return rfail("nessuna_domanda", undefined, { needIds: REFERENT_ERROR_MESSAGES.nessuna_domanda });
    // (Rilascio 5) «Serve un file» sulle domande nuove: un sottoinsieme di quelle aggiunte.
    const rawFiles = body.fileRequired === undefined || body.fileRequired === null ? [] : body.fileRequired;
    if (!Array.isArray(rawFiles) || !rawFiles.every(isUuid)) return rfail("domande_cambiate");
    const result = await addQuestionsToRequest({ ctx, executor, card, request, expectedVersion, needIds: ids, fileRequired: rawFiles as string[], message: null, writerId: writer.userId, deps: { ...deps, now } });
    if (!result.ok) return result;
    return ok({ added: result.value.added, emailQueued: result.value.emailQueued, contactName: result.value.contactName });
  },
);

/** (Rilascio 6) La richiesta attiva più recente di una persona su questo use case, oppure null. */
async function readActiveRequestId(executor: UcExecutor, workspaceId: string, useCaseId: string, contactId: string): Promise<string | null> {
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT r.id, r.status, r.created_at FROM use_case_referent_requests r
WHERE r.workspace_id = ${cast(workspaceId, "uuid")} AND r.use_case_id = ${cast(useCaseId, "uuid")} AND r.contact_id = ${cast(contactId, "uuid")} AND ${activeRequestSql("r")}`),
  ]);
  // Una richiesta viva vince; poi la più recente (per data, poi id: in TypeScript, mai un ORDER BY per persona).
  let best: UcRow | null = null;
  const rank = (r: UcRow) => (rowString(r.status) === "inviata" ? 1 : 0);
  for (const r of rows) {
    const at = rowDate(r.created_at)?.getTime() ?? 0;
    const bestAt = best ? (rowDate(best.created_at)?.getTime() ?? 0) : -1;
    if (!best || rank(r) > rank(best) || (rank(r) === rank(best) && (at > bestAt || (at === bestAt && String(r.id) > String(best.id))))) best = r;
  }
  return best ? String(best.id).toLowerCase() : null;
}

// ─── «Manda un promemoria» (§3.6) ────────────────────────────────────

export const remindReferentRequest = guardedReferent(
  "promemoria_a_mano",
  async function remindReferentRequest(
    ctx: WriteContext,
    useCaseId: string,
    requestId: string,
    expectedVersion: number,
    deps: { env: Env; now?: Date },
  ): Promise<ServiceResult<{ scheduledAt: string; now: boolean }> | ReferentFailure> {
    const now = deps.now ?? new Date();
    const writer = await referentWriter(ctx, deps.env);
    if (!writer.ok) return writer;
    if (!isUuid(useCaseId) || !isUuid(requestId) || !isVersion(expectedVersion)) return rfail("non_trovato");
    const executor = await getAppUcExecutor();
    const card = await readCard(executor, ctx.workspaceId, useCaseId);
    if (!card) return rfail("non_trovato");
    const gate = await deliveryGates(executor, ctx.workspaceId, card.company, deps.env);
    if (gate) return gateRefused(executor, ctx, writer.userId, card.id, gate, deps.env);
    const request = await readRequest(executor, ctx.workspaceId, card.id, requestId, now);
    if (!request) return rfail("richiesta_chiusa");
    if (request.version !== expectedVersion && request.status === "inviata") return rfail("versione_superata");
    const remindedOn = await readRemindedOn(executor, ctx.workspaceId, [request.contactId]);
    const check = manualReminderCheck(reminderStateOf(request), now, { remindedOn: remindedOn.get(request.contactId) ?? new Set() });
    if (!check.ok) return check.code === "promemoria_gia_inviato" ? rfailVars(check.code, { Nome: request.contactName }) : rfail(check.code);
    const run = await referentBatch(executor, [
      ...lazyExpiry(ctx, card.id, now),
      versionCasSql(ctx.workspaceId, request.id, expectedVersion),
      queueReminderItemSql({
        workspaceId: ctx.workspaceId,
        contactId: request.contactId,
        requestId: request.id,
        kind: "manuale",
        // Dopo «Correggi l'email» la chiave cambia a ogni versione: un promemoria partito oggi al vecchio indirizzo non la blocca.
        dedupeKey: request.sentAt && !request.hasValidToken ? `pm:${request.id}:${romeDate(check.scheduledAt)}:v${expectedVersion}` : `pm:${request.id}:${romeDate(check.scheduledAt)}`,
        at: check.scheduledAt,
      }),
    ]);
    if (!run.ok) return run;
    return ok({ scheduledAt: check.scheduledAt.toISOString(), now: check.scheduledAt.getTime() <= now.getTime() });
  },
);

// ─── «Revoca il link» (§3.3) ─────────────────────────────────────────

export const revokeReferentRequest = guardedReferent(
  "revoca",
  async function revokeReferentRequest(ctx: WriteContext, useCaseId: string, requestId: string, expectedVersion: number, env: Env = process.env): Promise<ServiceResult<null> | ReferentFailure> {
    const now = new Date();
    const writer = await referentWriter(ctx, env);
    if (!writer.ok) return writer;
    if (!isUuid(useCaseId) || !isUuid(requestId) || !isVersion(expectedVersion)) return rfail("non_trovato");
    const executor = await getAppUcExecutor();
    const card = await readCard(executor, ctx.workspaceId, useCaseId);
    if (!card) return rfail("non_trovato");
    const request = await readRequest(executor, ctx.workspaceId, card.id, requestId, now);
    if (!request || (request.status !== "inviata" && request.status !== "completata")) return rfail("richiesta_chiusa");
    if (request.version !== expectedVersion) return rfail("versione_superata");
    const run = await referentBatch(executor, [
      ...lazyExpiry(ctx, card.id, now),
      ...revokeStatements({
        workspaceId: ctx.workspaceId,
        target: { requestId: request.id, version: expectedVersion },
        reason: "revisore",
        actor: persona(writer.userId),
        failCode: "versione_superata",
      }),
      ...cardSyncStatements({ workspaceId: ctx.workspaceId, useCaseIds: [card.id], actorUserId: writer.userId, readiness: await readinessSyncFor(ctx.workspaceId, env, now) }),
    ]);
    if (!run.ok) return run;
    return ok(null);
  },
);

// ─── «Riprova l'invio» (§3.6) ────────────────────────────────────────

export const retryReferentRequestEmail = guardedReferent(
  "riprova_invio",
  async function retryReferentRequestEmail(
    ctx: WriteContext,
    useCaseId: string,
    requestId: string,
    expectedVersion: number,
    deps: { env: Env; now?: Date },
  ): Promise<ServiceResult<null> | ReferentFailure> {
    const now = deps.now ?? new Date();
    const writer = await referentWriter(ctx, deps.env);
    if (!writer.ok) return writer;
    if (!isUuid(useCaseId) || !isUuid(requestId) || !isVersion(expectedVersion)) return rfail("non_trovato");
    const executor = await getAppUcExecutor();
    const card = await readCard(executor, ctx.workspaceId, useCaseId);
    if (!card) return rfail("non_trovato");
    const gate = await deliveryGates(executor, ctx.workspaceId, card.company, deps.env);
    if (gate) return gate;
    const request = await readRequest(executor, ctx.workspaceId, card.id, requestId, now);
    if (!request || request.status !== "inviata") return rfail("richiesta_chiusa");
    if (request.version !== expectedVersion) return rfail("versione_superata");
    if (request.sentAt || request.richiestaPending || request.richiestaSent || request.richiestaTotal >= 4) return rfail("riprova_non_ammessa");
    const run = await referentBatch(executor, [
      ...lazyExpiry(ctx, card.id, now),
      versionCasSql(ctx.workspaceId, request.id, expectedVersion),
      toStatement(ucSql`INSERT INTO use_case_referent_emails (workspace_id, contact_id, request_id, template, dedupe_key, due_at, scheduled_at)
VALUES (${cast(ctx.workspaceId, "uuid")}, ${cast(request.contactId, "uuid")}, ${cast(request.id, "uuid")}, 'richiesta', ${cast(`ric:${request.id}:${request.richiestaTotal + 1}`, "text")}, now(), now())`),
    ]);
    if (!run.ok) return run;
    return ok(null);
  },
);

// ─── Referenti: indirizzo, correzione, cancellazione (§3.10) ─────────

/**
 * L'indirizzo intero di un referente del workspace, solo per i revisori (il riepilogo della finestra).
 * Solo per i referenti degli use case (scritti dai revisori del workspace): un referente che è anche
 * in un dossier resta coperto per i ruoli del cliente, come in «Persone» del dossier (`listContacts`:
 * ai ruoli del cliente niente email); lo vede intero solo una persona di Lateral Space. La scheda
 * deve esistere nel workspace. `email: null` → la finestra mostra l'indirizzo coperto.
 */
export const revealReferentContactEmail = guardedReferent(
  "indirizzo_referente",
  async function revealReferentContactEmail(ctx: WriteContext, useCaseId: string, contactId: string, env: Env = process.env): Promise<ServiceResult<{ email: string | null }> | ReferentFailure> {
    const writer = await referentWriter(ctx, env);
    if (!writer.ok) return writer;
    if (!isUuid(useCaseId) || !isUuid(contactId)) return rfail("non_trovato");
    const executor = await getAppUcExecutor();
    const card = await readCard(executor, ctx.workspaceId, useCaseId);
    if (!card) return rfail("non_trovato");
    const contact = await readContact(executor, ctx.workspaceId, contactId);
    if (!contact || !contact.isActive || contact.anonymized) return rfail("referente_non_valido");
    const email = contact.email ? contact.email.trim().toLowerCase() : null;
    if (!email) return ok({ email: null });
    const [[hub]] = await executor.batch([contactHubOnlyReadSql(ctx.workspaceId, contact.id)]);
    if (rowBool(hub?.hub_only)) return ok({ email });
    const viewer = await loadUserContext(executor, writer.userId, lsDomainsOf(env));
    return ok({ email: viewer?.isLateralSpace === true ? email : null });
  },
);

/**
 * (Rilascio 4) Le persone del workspace per «A chi» della finestra «Chiedi al referente», lette quando
 * la finestra si apre (mai nel pannello di ogni scheda): i membri e i partecipanti ai corsi di questo
 * workspace con un account verificato, che non sono già referenti, non sono di Lateral Space e non
 * sono chi guarda, in ordine alfabetico; nome, email coperta e «Fa parte del team». Solo a chi può
 * chiedere (`canEditNeeds`) e vede già le persone del workspace; agli altri un elenco vuoto. Nessun
 * dato dei corsi, nessun conteggio; nei log solo l'operazione e il codice.
 */
export const listReferentPickerPeople = guardedReferent(
  "persone_selettore",
  async function listReferentPickerPeople(ctx: WriteContext, useCaseId: string, env: Env = process.env): Promise<ServiceResult<{ members: ReferentMemberOption[] }> | ReferentFailure> {
    const writer = await referentWriter(ctx, env);
    if (!writer.ok) return writer;
    if (!isUuid(useCaseId)) return rfail("non_trovato");
    const executor = await getAppUcExecutor();
    const card = await readCard(executor, ctx.workspaceId, useCaseId);
    if (!card) return rfail("non_trovato");
    const ws = ctx.workspaceId.toLowerCase();
    // Il ruolo di chi guarda, riletto adesso: senza le persone in Impostazioni, nessuna persona qui.
    const [self] = await readWorkspaceMembers(executor, ws, writer.userId);
    if (!self || !canSeeWorkspacePeople(self.role)) return ok({ members: [] });
    const [contactRows] = await executor.batch([contactsSql(ws)]);
    const [people, known, lsMembers, all] = await Promise.all([
      readReferentPeople(executor, ws, contactRows.map((r) => String(r.id))),
      readPersonContacts(executor, ws),
      readLsMemberEmails(executor, ws),
      readWorkspaceMembers(executor, ws, null, { learners: true }),
    ]);
    return ok({ members: pickerOptionsOf({ all, known, people, viewerUserId: writer.userId, lsDomains: lsDomainsOf(env), lsMembers, learners: true }) });
  },
);

/**
 * (Rilascio 4) L'indirizzo intero della persona scelta in «A chi», per «A» di «Controlla e invia»:
 * solo per una persona che l'elenco può proporre (anche un partecipante ai corsi del workspace), mai
 * Lateral Space, mai chi guarda, e solo a chi vede già le persone del workspace. Una persona alla
 * volta: gli indirizzi dell'elenco non arrivano mai insieme al browser. Solo lettura.
 */
export const revealReferentMemberEmail = guardedReferent(
  "indirizzo_persona",
  async function revealReferentMemberEmail(ctx: WriteContext, useCaseId: string, userId: string, env: Env = process.env): Promise<ServiceResult<{ email: string }> | ReferentFailure> {
    const writer = await referentWriter(ctx, env);
    if (!writer.ok) return writer;
    if (!isUuid(useCaseId) || !isUuid(userId)) return rfail("non_trovato");
    const executor = await getAppUcExecutor();
    const card = await readCard(executor, ctx.workspaceId, useCaseId);
    if (!card) return rfail("non_trovato");
    const [self] = await readWorkspaceMembers(executor, ctx.workspaceId, writer.userId);
    if (!self || !canSeeWorkspacePeople(self.role)) return rfail("permesso_mancante");
    const [member] = await readWorkspaceMembers(executor, ctx.workspaceId, userId, { learners: true });
    if (!member) return rfail("persona_non_disponibile");
    if (memberIsLateralSpace(member, lsDomainsOf(env), await readLsMemberEmails(executor, ctx.workspaceId))) return rfail("referente_lateral_space");
    if (member.userId === writer.userId.toLowerCase()) return rfail("referente_sei_tu");
    return ok({ email: member.email });
  },
);

export const correctReferentEmail = guardedReferent(
  "correggi_email",
  async function correctReferentEmail(ctx: WriteContext, useCaseId: string, contactId: string, input: unknown, deps: { env: Env }): Promise<ServiceResult<{ contactName: string }> | ReferentFailure> {
    const writer = await referentWriter(ctx, deps.env);
    if (!writer.ok) return writer;
    if (!isUuid(useCaseId) || !isUuid(contactId)) return rfail("non_trovato");
    const executor = await getAppUcExecutor();
    const contact = await readContact(executor, ctx.workspaceId, contactId);
    if (!contact || !contact.isActive || contact.anonymized) return rfail("referente_non_valido");
    const [[hub]] = await executor.batch([contactHubOnlyReadSql(ctx.workspaceId, contact.id)]);
    if (!rowBool(hub?.hub_only)) return rfail("referente_in_dossier");
    const email = input && typeof input === "object" && typeof (input as { email?: unknown }).email === "string" ? (input as { email: string }).email : "";
    const draft = prepareContact({ displayName: contact.displayName, email });
    if (!draft.ok) return rfail(draft.code === "email_non_valida" ? "email_non_valida" : "email_non_valida", undefined, { email: REFERENT_ERROR_MESSAGES.email_non_valida });
    if (draft.value.email === null) return rfail("email_mancante", undefined, { email: REFERENT_ERROR_MESSAGES.email_mancante });
    const lsDomains = lsDomainsOf(deps.env);
    const user = contact.userId ? await loadUserContext(executor, contact.userId, lsDomains) : null;
    const check = checkContactEmail({ email: draft.value.email, user, lsDomains, lsMemberEmails: await readLsMemberEmails(executor, ctx.workspaceId) });
    if (!check.ok) return rfail(check.code, undefined, { email: REFERENT_ERROR_MESSAGES[check.code] ?? check.message });
    const [[taken]] = await executor.batch([contactEmailTakenSql({ workspaceId: ctx.workspaceId, email: draft.value.email, excludeContactId: contact.id })]);
    if (rowBool(taken?.taken)) return rfail("email_in_uso", undefined, { email: REFERENT_ERROR_MESSAGES.email_in_uso });
    const ws = cast(ctx.workspaceId, "uuid");
    const c = cast(contact.id, "uuid");
    // (Parte 3) Mai l'indirizzo di chi ha chiesto: i promemoria di una richiesta viva gli arriverebbero come referente di se stesso.
    const [requesterRows] = await executor.batch([
      toStatement(ucSql`SELECT DISTINCT r.requested_by_user_id::text AS user_id FROM use_case_referent_requests r
WHERE r.workspace_id = ${ws} AND r.contact_id = ${c} AND r.status = 'inviata' AND r.expires_at > now() AND r.requested_by_user_id IS NOT NULL`),
    ]);
    const requesters = new Set(requesterRows.map((r) => String(r.user_id).toLowerCase()));
    const newPerson = await readEmailPerson(executor, ctx.workspaceId, draft.value.email);
    if (isSelfRequest(newPerson, writer.userId)) return rfail("referente_sei_tu", undefined, { email: REFERENT_ERROR_MESSAGES.referente_sei_tu });
    if (newPerson.userId && requesters.has(newPerson.userId)) return rfail("email_di_chi_chiede", undefined, { email: REFERENT_ERROR_MESSAGES.email_di_chi_chiede });
    const run = await referentBatch(executor, [
      contactHubOnlySql(ctx.workspaceId, contact.id),
      contactUpdateSql({ workspaceId: ctx.workspaceId, contactId: contact.id, patch: { email: draft.value.email }, expect: { email: contact.email, isActive: true } }),
      // (Referente già iscritto) Il collegamento all'account segue l'indirizzo nuovo (solo dell'hub: la riga sopra lo garantisce).
      relinkCorrectedContactSql(ctx.workspaceId, contact.id),
      toStatement(ucSql`UPDATE use_case_referent_tokens t SET revoked_at = now()
FROM use_case_referent_requests r
WHERE t.request_id = r.id AND r.workspace_id = ${ws} AND r.contact_id = ${c} AND t.revoked_at IS NULL`),
      toStatement(ucSql`INSERT INTO use_case_events (workspace_id, use_case_id, actor_user_id, actor_kind, channel, action, fields, phase_before, phase_after)
SELECT DISTINCT r.workspace_id, r.use_case_id, ${cast(writer.userId, "uuid")}, 'persona', 'pagina', 'modificato', ARRAY['richiesta_referente']::text[], NULL, 'email_corretta'
FROM use_case_referent_requests r
WHERE r.workspace_id = ${ws} AND r.contact_id = ${c} AND r.status = 'inviata' AND r.expires_at > now()`),
    ]);
    if (!run.ok) return run.error === "conflitto" ? rfail("versione_superata") : run;
    return ok({ contactName: contact.displayName });
  },
);

export const eraseReferentData = guardedReferent(
  "cancella_dati_referente",
  async function eraseReferentData(ctx: WriteContext, useCaseId: string, contactId: string, deps: { env: Env }): Promise<ServiceResult<{ contactAnonymized: boolean }> | ReferentFailure> {
    const writer = await referentWriter(ctx, deps.env);
    if (!writer.ok) return writer;
    if (!isUuid(useCaseId) || !isUuid(contactId)) return rfail("non_trovato");
    const executor = await getAppUcExecutor();
    const contact = await readContact(executor, ctx.workspaceId, contactId);
    if (!contact) return rfail("referente_non_valido");
    const [[hub], cards] = await executor.batch([contactHubOnlyReadSql(ctx.workspaceId, contact.id), contactUseCasesSql(ctx.workspaceId, contact.id)]);
    const hubOnly = rowBool(hub?.hub_only);
    const run = await referentBatch(
      executor,
      referentEraseStatements({
        workspaceId: ctx.workspaceId,
        contactId: contact.id,
        actorUserId: writer.userId,
        reason: "cancellazione",
        anonymizeContact: hubOnly && !contact.anonymized,
        useCaseIds: cards.map((r) => String(r.use_case_id)),
        readiness: await readinessSyncFor(ctx.workspaceId, deps.env),
      }),
    );
    if (!run.ok) return run.error === "referente_in_dossier" || run.error === "richieste_aperte" || run.error === "firmatario_designato" ? rfail("riprova") : run;
    return ok({ contactAnonymized: hubOnly });
  },
);

// ─── Risposte e file del team (§3.9) ─────────────────────────────────

export const addReviewerAnswer = guardedReferent(
  "risposta_del_team",
  async function addReviewerAnswer(ctx: WriteContext, useCaseId: string, needId: string, input: unknown, env: Env = process.env): Promise<ServiceResult<{ answerId: string }> | ReferentFailure> {
    const writer = await referentWriter(ctx, env);
    if (!writer.ok) return writer;
    if (!isUuid(useCaseId) || !isUuid(needId)) return rfail("domanda_non_disponibile");
    const record = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
    const text = checkReviewerAnswer(typeof record.text === "string" ? record.text : "");
    if (!text.ok) return rfail(text.code, text.message, { text: text.message });
    const validate = record.validate === true;
    const answerId = randomUUID();
    const executor = await getAppUcExecutor();
    const actor = persona(writer.userId);
    const ws = cast(ctx.workspaceId, "uuid");
    const run = await referentBatch(executor, [
      // Prima le richieste vive su questa esigenza, come revoca e scadenza (stesso ordine dei lock).
      lockRequestsOfNeedSql(ctx.workspaceId, needId),
      toStatement(
        requireRows(
          ucSql`INSERT INTO use_case_need_answers (id, workspace_id, use_case_id, need_id, request_id, source, author_user_id, body, dont_know, status, submitted_at)
SELECT ${cast(answerId, "uuid")}, n.workspace_id, l.use_case_id, n.id, NULL, 'revisore', ${cast(writer.userId, "uuid")}, ${cast(text.value, "text")}, false, 'inviata', now()
FROM use_case_needs n JOIN use_case_need_links l ON l.need_id = n.id
WHERE n.id = ${cast(needId, "uuid")} AND n.workspace_id = ${ws} AND l.use_case_id = ${cast(useCaseId, "uuid")} AND n.archived_at IS NULL AND n.type = 'requisito'
RETURNING id`,
          1,
          "domanda_non_disponibile",
        ),
      ),
      validate
        ? needTransitionSql({ workspaceId: ctx.workspaceId, needIds: [needId], from: ["da_chiedere", "chiesta", "mancante", "parziale", "in_verifica"], to: "validata", actor })
        : needTransitionSql({ workspaceId: ctx.workspaceId, needIds: [needId], from: ["da_chiedere", "chiesta", "mancante", "parziale"], to: "in_verifica", actor }),
      referentEventSql({ workspaceId: ctx.workspaceId, useCaseId, code: "risposta_team", actor }),
      // (Parte 3) La domanda del referente su questa esigenza è fatta: se non resta altro, la richiesta si completa.
      ...completeHandledRequestsStatements({ workspaceId: ctx.workspaceId, needId }),
      ...cardSyncStatements({ workspaceId: ctx.workspaceId, useCaseIds: [useCaseId], needId, actorUserId: writer.userId, readiness: await readinessSyncFor(ctx.workspaceId, env) }),
    ]);
    if (!run.ok) return run;
    return ok({ answerId });
  },
);

export const removeNeedAnswer = guardedReferent(
  "risposta_tolta",
  async function removeNeedAnswer(ctx: WriteContext, useCaseId: string, answerId: string, env: Env = process.env): Promise<ServiceResult<null> | ReferentFailure> {
    const writer = await referentWriter(ctx, env);
    if (!writer.ok) return writer;
    if (!isUuid(useCaseId) || !isUuid(answerId)) return rfail("risposta_non_trovata");
    const executor = await getAppUcExecutor();
    const run = await referentBatch(executor, [
      toStatement(
        requireRows(
          ucSql`UPDATE use_case_need_answers SET body = NULL, comment = NULL, removed_at = now(), removed_by_user_id = ${cast(writer.userId, "uuid")}, removed_reason = 'revisore', updated_at = now()
WHERE id = ${cast(answerId, "uuid")} AND workspace_id = ${cast(ctx.workspaceId, "uuid")} AND use_case_id = ${cast(useCaseId, "uuid")} AND removed_at IS NULL AND status = 'inviata'
RETURNING id`,
          1,
          "risposta_non_trovata",
        ),
      ),
      referentEventSql({ workspaceId: ctx.workspaceId, useCaseId, code: "risposta_tolta", actor: persona(writer.userId) }),
    ]);
    if (!run.ok) return run;
    return ok(null);
  },
);

export const deleteNeedFile = guardedReferent(
  "file_tolto",
  async function deleteNeedFile(ctx: WriteContext, useCaseId: string, fileId: string, env: Env): Promise<ServiceResult<null> | ReferentFailure> {
    const writer = await referentWriter(ctx, env);
    if (!writer.ok) return writer;
    if (!isUuid(useCaseId) || !isUuid(fileId)) return rfail("file_non_trovato");
    const executor = await getAppUcExecutor();
    const run = await referentBatch(executor, [
      toStatement(
        requireRows(
          ucSql`UPDATE use_case_need_files SET deleted_at = now(), deleted_by_user_id = ${cast(writer.userId, "uuid")}, deleted_reason = 'revisore'
WHERE id = ${cast(fileId, "uuid")} AND workspace_id = ${cast(ctx.workspaceId, "uuid")} AND use_case_id = ${cast(useCaseId, "uuid")} AND deleted_at IS NULL
RETURNING id`,
          1,
          "file_non_trovato",
        ),
      ),
      referentEventSql({ workspaceId: ctx.workspaceId, useCaseId, code: "file_tolto", actor: persona(writer.userId) }),
    ]);
    if (!run.ok) return run;
    return ok(null);
  },
);

export { reviewNeedFile } from "@/lib/db/queries/use-case-referent-files";

// ─── Il cron (§3.7) ──────────────────────────────────────────────────

export interface ReferentCronCounts {
  expired: number;
  completed: number;
  revoked: number;
  cleaned: number;
  quarantine: number;
  blobs: number;
  purged: number;
  queued: number;
  sent: number;
  failed: number;
  held: number;
  cancelled: number;
  errors: number;
  alertsSent: number;
  alertsHeld: number;
  alertsCancelled: number;
  notificationsPurged: number;
  /** (0025) Use case diventati «Pronto da avviare» che nessuna scrittura aveva visto. */
  readyAnnounced: number;
  /** (0025) Email «Pronto da avviare» e «Autorizza i fornitori» partite, in attesa, annullate. */
  caseAlertsSent: number;
  caseAlertsHeld: number;
  caseAlertsCancelled: number;
  /** (0029, rilascio 7) Fotografie del mese di «Programma» scritte, e righe «Da rivedere» nella campanella. */
  programSnapshots: number;
  programReviewNotices: number;
}

async function eachBatch(executor: UcExecutor, groups: readonly (readonly UcStatement[])[], counts: ReferentCronCounts, op: string): Promise<number> {
  let done = 0;
  for (const statements of groups) {
    try {
      const run = await referentBatch(executor, statements);
      if (run.ok) done++;
      else {
        counts.errors++;
        logReferentCode(op, run.error);
      }
    } catch (error) {
      counts.errors++;
      logReferentError(op, error);
    }
  }
  return done;
}

function logReferentCode(op: string, code: string): void {
  logReferentError(op, Object.assign(new Error(code), { name: code }));
}

/** I requisiti del batch di una richiesta: lo use case e il workspace dalla riga letta. */
interface CronRequest {
  id: string;
  workspaceId: string;
  useCaseId: string;
  contactId: string;
}

function cronRequestOf(r: UcRow): CronRequest {
  return { id: String(r.id).toLowerCase(), workspaceId: String(r.workspace_id).toLowerCase(), useCaseId: String(r.use_case_id).toLowerCase(), contactId: String(r.contact_id).toLowerCase() };
}

/**
 * Il cron dei giorni feriali (`/api/cron/use-case-referents`), nell'ordine di §3.7: righe vecchie
 * della coda, referenti non più raggiungibili, scadenze, richieste complete, bozze, file in attesa,
 * oggetti dell'archivio, conservazione, promemoria (solo nella finestra di Roma, solo con l'email
 * configurata e l'autorizzazione ai fornitori), limiti di frequenza, invio, avvisi a chi ha chiesto,
 * (0025) «Pronto da avviare», «Autorizza i fornitori» e le loro email, notifiche vecchie. Ogni passo
 * conta i suoi errori senza fermare gli altri. Solo conteggi.
 */
export async function runReferentCron(o: { env: Env; now?: Date; mailer?: UcMailer; lsDomains?: readonly string[] }): Promise<ReferentCronCounts> {
  const now = o.now ?? new Date();
  const env = o.env;
  const lsDomains = o.lsDomains ?? lsDomainsOf(env);
  const counts: ReferentCronCounts = {
    expired: 0,
    completed: 0,
    revoked: 0,
    cleaned: 0,
    quarantine: 0,
    blobs: 0,
    purged: 0,
    queued: 0,
    sent: 0,
    failed: 0,
    held: 0,
    cancelled: 0,
    errors: 0,
    alertsSent: 0,
    alertsHeld: 0,
    alertsCancelled: 0,
    notificationsPurged: 0,
    readyAnnounced: 0,
    caseAlertsSent: 0,
    caseAlertsHeld: 0,
    caseAlertsCancelled: 0,
    programSnapshots: 0,
    programReviewNotices: 0,
  };
  const executor = await getAppUcExecutor();
  const store = createReferentDispatchStore(executor, { env, now });
  const schedule = alertSchedule(now);
  const step = async (op: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (error) {
      counts.errors++;
      logReferentError(op, error);
    }
  };

  // 1. Righe della coda troppo vecchie.
  await step("cron_coda_vecchia", async () => {
    counts.cancelled += await store.cancelStale(now, (dueAt) => isStaleEmail(dueAt, now));
  });

  // 2. Referenti non più raggiungibili; link a un indirizzo cambiato.
  await step("cron_referenti", async () => {
    const [gone] = await executor.batch([
      toStatement(ucSql`SELECT r.id, r.workspace_id, r.use_case_id, r.contact_id FROM use_case_referent_requests r
LEFT JOIN uc_contacts c ON c.id = r.contact_id AND c.workspace_id = r.workspace_id
WHERE r.status = 'inviata' AND (c.id IS NULL OR NOT c.is_active OR c.anonymized_at IS NOT NULL OR c.email IS NULL)
LIMIT 200`),
    ]);
    const requests = gone.map(cronRequestOf);
    const readiness = new Map<string, Awaited<ReturnType<typeof readinessSyncFor>>>();
    for (const r of requests) if (!readiness.has(r.workspaceId)) readiness.set(r.workspaceId, await readinessSyncFor(r.workspaceId, env, now));
    counts.revoked += await eachBatch(
      executor,
      requests.map((r) => [
        ...revokeStatements({ workspaceId: r.workspaceId, target: { requestId: r.id, statuses: ["inviata"] }, reason: "referente_non_attivo", actor: { kind: "sistema" } }),
        ...cardSyncStatements({ workspaceId: r.workspaceId, useCaseIds: [r.useCaseId], actorUserId: null, readiness: readiness.get(r.workspaceId) ?? null }),
      ]),
      counts,
      "cron_revoca",
    );
    await executor.batch([
      toStatement(ucSql`UPDATE use_case_referent_tokens t SET revoked_at = now()
FROM use_case_referent_requests r, uc_contacts c
WHERE t.request_id = r.id AND c.id = r.contact_id AND c.workspace_id = r.workspace_id AND r.status = 'inviata' AND t.revoked_at IS NULL
  AND (c.email IS NULL OR t.recipient_hash <> encode(sha256(convert_to(lower(btrim(c.email)), 'UTF8')), 'hex'))`),
    ]);
  });

  // 3. Scadenze, una richiesta per batch.
  await step("cron_scadenze", async () => {
    const [rows] = await executor.batch([
      toStatement(ucSql`SELECT r.id, r.workspace_id, r.use_case_id, r.contact_id FROM use_case_referent_requests r WHERE r.status = 'inviata' AND r.expires_at <= now() ORDER BY r.expires_at, r.id LIMIT 200`),
    ]);
    counts.expired += await eachBatch(
      executor,
      rows.map(cronRequestOf).map((r) => expireStatements({ workspaceId: r.workspaceId, useCaseId: r.useCaseId, requestId: r.id, actorUserId: null, schedule, now })),
      counts,
      "cron_scadenza",
    );
  });

  // 4. Richieste senza più domande aperte: completate (nessuna email).
  await step("cron_complete", async () => {
    const [rows] = await executor.batch([
      toStatement(ucSql`SELECT r.id, r.workspace_id, r.use_case_id, r.contact_id FROM use_case_referent_requests r
WHERE r.status = 'inviata' AND r.expires_at > now() AND ${openItemsCountSql("r")} = 0
LIMIT 200`),
    ]);
    counts.completed += await eachBatch(
      executor,
      rows.map(cronRequestOf).map((r) => {
        const filter = ucSql`r.id = ${cast(r.id, "uuid")} AND r.workspace_id = ${cast(r.workspaceId, "uuid")} AND r.status = 'completata' AND r.completed_at = now()`;
        return [
          toStatement(
            requireRows(
              ucSql`UPDATE use_case_referent_requests r SET status = 'completata', completed_at = now(), version = version + 1
WHERE r.id = ${cast(r.id, "uuid")} AND r.status = 'inviata' AND ${openItemsCountSql("r")} = 0
RETURNING id`,
              1,
              "conflitto",
            ),
          ),
          ...cancelQueued(r.workspaceId, filter, "completata"),
          ...drafts(r.workspaceId, filter),
          referentEventSql({ workspaceId: r.workspaceId, useCaseId: r.useCaseId, code: "completata", actor: { kind: "sistema" } }),
        ];
      }),
      counts,
      "cron_completa",
    );
  });

  // 5. Bozze delle richieste finite.
  await step("cron_bozze", async () => {
    const [rows] = await executor.batch([
      toStatement(ucSql`SELECT DISTINCT r.workspace_id FROM use_case_referent_requests r WHERE r.status <> 'inviata' AND r.drafts_cleared_at IS NULL LIMIT 200`),
    ]);
    counts.cleaned += await eachBatch(
      executor,
      rows.map((r) => drafts(String(r.workspace_id), ucSql`r.status <> 'inviata' AND r.drafts_cleared_at IS NULL`)),
      counts,
      "cron_bozza",
    );
  });

  // 6. File in quarantena abbandonati, PDF non controllati in tempo. 7. Oggetti dei file cancellati.
  await step("cron_file", async () => {
    counts.quarantine += await cleanupPendingFiles(env, now);
    const rows = await collectDeletedFileRows(null, 200);
    counts.blobs += await deleteFileObjects(rows, env);
  });

  // 8. Conservazione: 12 mesi dopo la fine, senza esigenze ancora da verificare.
  await step("cron_conservazione", async () => {
    const [rows] = await executor.batch([
      // (Rilascio 6) La fine di una richiesta è anche il suo ultimo messaggio nel filo, se viene dopo.
      toStatement(ucSql`SELECT r.id, r.workspace_id,
  greatest(coalesce(r.completed_at, r.expired_at, r.revoked_at), (SELECT max(m.created_at) FROM use_case_referent_messages m WHERE m.request_id = r.id)) AS ended_at
FROM use_case_referent_requests r
WHERE r.status <> 'inviata' AND r.purged_at IS NULL AND coalesce(r.completed_at, r.expired_at, r.revoked_at) < now() - interval '360 days'
  AND NOT EXISTS (SELECT 1 FROM use_case_referent_messages lm WHERE lm.request_id = r.id AND lm.created_at >= now() - interval '360 days')
  AND (r.status <> 'completata' OR r.expires_at <= now())
  AND NOT EXISTS (SELECT 1 FROM use_case_referent_request_items i JOIN use_case_needs n ON n.id = i.need_id
                  WHERE i.request_id = r.id AND i.state <> 'aperta' AND n.status = 'in_verifica')
LIMIT 200`),
    ]);
    const due = rows.filter((r) => {
      const ended = rowDate(r.ended_at);
      return ended !== null && retentionDue(ended, now);
    });
    counts.purged += await eachBatch(
      executor,
      due.map((r) => referentPurgeStatements({ workspaceId: String(r.workspace_id), requestId: String(r.id) })),
      counts,
      "cron_conservazione_richiesta",
    );
    if (due.length) counts.blobs += await deleteFileObjects(await collectDeletedFileRows(null, 200), env);
    // (Rilascio 5) La pulizia di RUNBOOK §10.9 punto 6, idempotente: sul codice nuovo non trova niente;
    // dopo un ritorno indietro toglie i commenti e le note che il codice di prima ha lasciato.
    await executor.batch(REFERENT_CHECK_SWEEP_SQL.map((text) => ({ text, params: [] })));
    // (Rilascio 5.1) La pulizia di RUNBOOK §10.10 punto 6, dopo quella della 0026: i commenti per
    // beneficio delle richieste cancellate e le bozze per beneficio delle richieste finite senza invio.
    await executor.batch(REFERENT_BENEFITS_SWEEP_SQL.map((text) => ({ text, params: [] })));
    // (Rilascio 6) La pulizia di RUNBOOK §10.15, dopo quella della 0027: i testi del filo e le proposte dell'AI
    // delle richieste che il codice di prima ha cancellato.
    await executor.batch(REFERENT_THREAD_SWEEP_SQL.map((text) => ({ text, params: [] })));
  });

  // 9. Promemoria: un'email al giorno per persona, con tutte le sue richieste dovute.
  await step("cron_promemoria", async () => {
    if (!ucEmailConfig(env).ok || !inRomeSendWindow(now)) return;
    counts.queued += await queueDueReminders(executor, env, now, counts);
  });

  // 10. Limiti di frequenza più vecchi di due giorni.
  await step("cron_limiti", async () => {
    await executor.batch([
      toStatement(ucSql`DELETE FROM uc_rate_limits WHERE window_start < now() - interval '2 days' AND (bucket LIKE 'ucq:%' OR bucket LIKE 'ip:%')`),
    ]);
  });

  // 11. Invio. 11b. Avvisi a chi ha chiesto. 12. Notifiche vecchie.
  await step("cron_invio", async () => {
    const sent = await runReferentDispatchWith(store, { env, lsDomains, now, limit: 50, mailer: o.mailer });
    counts.sent += sent.sent;
    counts.failed += sent.failed;
    counts.held += sent.held + sent.notConfigured;
    counts.cancelled += sent.cancelled;
  });
  await step("cron_avvisi", async () => {
    const alerts = await dispatchRequesterAlerts({ env, now, limit: 50, mailer: o.mailer });
    counts.alertsSent += alerts.sent;
    counts.alertsHeld += alerts.held + alerts.notConfigured;
    counts.alertsCancelled += alerts.cancelled;
    counts.failed += alerts.failed;
  });
  // 11c (0025). «Pronto da avviare»: ogni use case approvato si ricontrolla (un trimestre passato, un
  // dossier collegato dai dossier, un passaggio che nessuna scrittura ha visto), senza doppioni. 11d.
  // Le email degli avvisi della 0025.
  await step("cron_pronti", async () => {
    const ready = await syncReadyCards({ env, now });
    counts.readyAnnounced += ready.announced;
    counts.errors += ready.errors;
  });
  // 11e (0025). «Autorizza i fornitori» dove l'interruttore del cliente è acceso: si ripete ogni 7
  // giorni finché il lavoro aspetta l'ok; con l'ok niente.
  await step("cron_fornitori", async () => {
    counts.errors += (await syncSubprocessorsNotices({ env, now })).errors;
  });
  await step("cron_avvisi_use_case", async () => {
    const alerts = await dispatchCaseAlerts({ env, now, limit: 50, mailer: o.mailer });
    counts.caseAlertsSent += alerts.sent;
    counts.caseAlertsHeld += alerts.held + alerts.notConfigured;
    counts.caseAlertsCancelled += alerts.cancelled;
    counts.failed += alerts.failed;
  });
  await step("cron_notifiche_vecchie", async () => {
    const purged = await purgeOldNotifications(now);
    counts.notificationsPurged += purged.notifications;
    await purgeOldCaseAlerts(now);
  });
  // 11e (rilascio 7). «Programma»: la fotografia del mese di ogni workspace e «Da rivedere» a Lateral Space,
  // con un tetto di tempo suo; prima dell'AI, che ha il suo.
  await step("cron_programma", async () => {
    const { runProgramCron, PROGRAM_CRON_BUDGET_MS } = await import("@/lib/db/queries/use-case-program");
    const program = await runProgramCron({ env, now, budgetMs: PROGRAM_CRON_BUDGET_MS });
    counts.programSnapshots += program.snapshots;
    counts.programReviewNotices += program.reviewNotices;
    counts.errors += program.errors;
  });
  // 11f (rilascio 6). Le proposte dell'AI non ancora calcolate (dopo un errore, o un `after()` che non è partito).
  // Per ultime, dopo le pulizie: un modello lento non le salta mai.
  await step("cron_ai", async () => {
    await processReferentSuggestions({ env, limit: 20, budgetMs: REFERENT_AI_LIMITS.cronBudgetMs });
  });
  return counts;
}

function cancelQueued(workspaceId: string, filter: SqlFragment, reason: string): UcStatement[] {
  return cancelQueuedRaw({ workspaceId, filter, reason });
}

function drafts(workspaceId: string, filter: SqlFragment): UcStatement[] {
  return draftsCleanupStatements({ workspaceId, filter });
}

/**
 * Il passo 9: le richieste vive inviate, i promemoria dovuti (`referentReminderDue`), raggruppati per
 * referente in TypeScript; una riga per persona e giorno, `pa:<referente>:<giorno>`. Una persona che
 * oggi ha già avuto un promemoria aspetta il giorno dopo. Solo nei workspace con la funzione accesa
 * e l'autorizzazione ai fornitori.
 */
async function queueDueReminders(executor: UcExecutor, env: Env, now: Date, counts: ReferentCronCounts): Promise<number> {
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT r.id, r.workspace_id, r.use_case_id, r.contact_id, r.status, r.sent_at, r.expires_at, r.revoked_at, r.reminder_count, r.last_email_at, r.reopened_at,
  ${openItemsCountSql("r")} AS open_items,
  -- (Rilascio 6) Dopo una riapertura contano solo i promemoria partiti da lì: tornano i soliti due.
  EXISTS (SELECT 1 FROM use_case_referent_email_items it JOIN use_case_referent_emails e ON e.id = it.email_id
          WHERE it.request_id = r.id AND it.kind = 'primo' AND ((it.state = 'inviata' AND (r.reopened_at IS NULL OR e.sent_at >= r.reopened_at))
            OR (it.state = 'in_coda' AND (e.status = 'in_coda' OR (e.status = 'errore' AND e.attempts < 3))))) AS primo_taken,
  EXISTS (SELECT 1 FROM use_case_referent_email_items it JOIN use_case_referent_emails e ON e.id = it.email_id
          WHERE it.request_id = r.id AND it.kind = 'ultimo' AND ((it.state = 'inviata' AND (r.reopened_at IS NULL OR e.sent_at >= r.reopened_at))
            OR (it.state = 'in_coda' AND (e.status = 'in_coda' OR (e.status = 'errore' AND e.attempts < 3))))) AS ultimo_taken
FROM use_case_referent_requests r
WHERE r.status = 'inviata' AND r.sent_at IS NOT NULL AND r.revoked_at IS NULL AND r.expires_at > now()
ORDER BY r.created_at, r.id
LIMIT 500`),
  ]);
  const ackCache = new Map<string, boolean>();
  const due: Array<{ workspaceId: string; contactId: string; requestId: string; kind: "primo" | "ultimo" }> = [];
  for (const r of rows) {
    const workspaceId = String(r.workspace_id).toLowerCase();
    if (!referentAskEnabled(workspaceId, env)) continue;
    if (!ackCache.has(workspaceId)) ackCache.set(workspaceId, (await loadSubprocessorAck(executor, workspaceId)) !== null);
    if (!ackCache.get(workspaceId)) continue;
    const expiresAt = rowDate(r.expires_at);
    if (!expiresAt) continue;
    const state: ReminderState = {
      status: "inviata",
      sentAt: rowDate(r.sent_at),
      expiresAt,
      revokedAt: rowDate(r.revoked_at),
      reminderCount: rowNumber(r.reminder_count) ?? 0,
      lastEmailAt: rowDate(r.last_email_at),
      openItems: rowNumber(r.open_items) ?? 0,
      remindFrom: rowDate(r.reopened_at),
    };
    const kind = referentReminderDue(state, now);
    if (!kind) continue;
    if (kind === "primo" && rowBool(r.primo_taken)) continue;
    if (kind === "ultimo" && rowBool(r.ultimo_taken)) continue;
    due.push({ workspaceId, contactId: String(r.contact_id).toLowerCase(), requestId: String(r.id).toLowerCase(), kind });
  }
  // Per persona (solo per la sua casella: niente si mostra, si conta o si ordina per persona).
  const byContact = new Map<string, typeof due>();
  for (const d of due) byContact.set(`${d.workspaceId}:${d.contactId}`, [...(byContact.get(`${d.workspaceId}:${d.contactId}`) ?? []), d]);
  const today = romeDate(now);
  let queued = 0;
  for (const items of byContact.values()) {
    const { workspaceId, contactId } = items[0];
    const sentToday = await readRemindedOn(executor, workspaceId, [contactId]);
    const days = sentToday.get(contactId) ?? new Set<string>();
    if (days.has(today) && (await contactHadReminderToday(executor, workspaceId, contactId, now))) continue;
    const statements = items.map((d) =>
      queueReminderItemSql({ workspaceId, contactId, requestId: d.requestId, kind: d.kind, dedupeKey: `pa:${contactId}:${today}`, at: now }),
    );
    queued += (await eachBatch(executor, [statements], counts, "cron_promemoria_coda")) ? items.length : 0;
  }
  return queued;
}

/** Oggi (Roma) alla persona è già partito un promemoria. */
async function contactHadReminderToday(executor: UcExecutor, workspaceId: string, contactId: string, now: Date): Promise<boolean> {
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT e.sent_at FROM use_case_referent_emails e
WHERE e.workspace_id = ${cast(workspaceId, "uuid")} AND e.contact_id = ${cast(contactId, "uuid")} AND e.template = 'promemoria' AND e.status = 'inviata'
  AND e.sent_at > now() - interval '2 days'`),
  ]);
  return rows.some((r) => {
    const at = rowDate(r.sent_at);
    return at !== null && sameRomeDay(at, now);
  });
}

