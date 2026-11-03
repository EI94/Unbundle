import "server-only";
import { getAppUcExecutor, type UcExecutor, type UcRow } from "@/lib/db/uc-executor";
import {
  afterResponse,
  isUuid,
  readReferentPerson,
  referentBatch,
  referentStoreReady,
  type Env,
  type ReferentLink,
} from "@/lib/db/queries/use-case-referent-base";
import { dispatchRequesterAlerts } from "@/lib/db/queries/use-case-notifications";
import { dispatchReferentEmails } from "@/lib/db/queries/use-case-referent-dispatch";
import { deleteFileObjects, referentBeginClient, referentCompleteClient, referentUploadServer } from "@/lib/db/queries/use-case-referent-files";
import type { Issue } from "@/lib/uc/answers/issues";
import { romeDate } from "@/lib/uc/calendar";
import { RATE_LIMITS, type RateLimitKind, type RateLimitRule } from "@/lib/uc/http";
import { ucLog } from "@/lib/uc/log";
import { publicFail, type PublicOutcome } from "@/lib/uc/public-view";
import { rowBool, rowDate, rowNumber, rowString } from "@/lib/uc/sql/readiness";
import { cast, raw, toStatement, ucSql, type UcStatement } from "@/lib/uc/sql/statement";
import { clientUploadAvailable } from "@/lib/uc/storage";
import type { Result } from "@/lib/uc/types";
import { referentAskEnabled } from "@/lib/use-cases/referent/availability";
import { alertSchedule } from "@/lib/use-cases/referent/alerts";
import { cardSyncStatements } from "@/lib/use-cases/case-alerts/sql";
import {
  REFERENT_LIMITS,
  type CheckResult,
  type ReferentCheckView,
  type DraftResult,
  type ReferentAskView,
  type ReferentClientTicket,
  type ReferentFileView,
  type ReferentPageResult,
  type ReferentUploadResult,
  type SubmitResult,
} from "@/lib/use-cases/referent/contract";
import { PENDING_QUARANTINE_MS, rejectionMessage } from "@/lib/use-cases/referent/files";
import { REFERENT_ERROR_MESSAGES, REFERENT_PRIVACY_CONTACT, REFERENT_PRIVACY_NOTICE } from "@/lib/use-cases/referent/labels";
import {
  cancelQueuedForRequestsStatements,
  draftsCleanupStatements,
  needTransitionSql,
  notifyReviewersSql,
  openItemSql,
  openItemsCountSql,
  queueRequesterAlertSql,
  referentEventSql,
  referentEventsForRequestsSql,
  casTail,
  lockRequestSql,
} from "@/lib/use-cases/referent/sql";
import { HANDLED_NEED_STATUSES, privacyAccepted } from "@/lib/use-cases/referent/state";
import { checkDraftText, checkSubmitText } from "@/lib/use-cases/referent/text";
import { hashReferentToken, looksLikeReferentToken, RECIPIENT_HASH_SQL } from "@/lib/use-cases/referent/tokens";
import { toPublicView, type PublicFileRow, type PublicItemRow } from "@/lib/use-cases/referent/view";
import { referentDescription } from "@/lib/use-cases/referent/description";
import { REFERENT_NUMBER_MAX, referentNumber, sameTeamEstimate, teamEstimateOf, teamSnapshotOf, type TeamSnapshot } from "@/lib/use-cases/referent/estimate";
import { REFERENT_CHECK_LIMITS } from "@/lib/db/use-case-hub-referent-check-ddl";
import type { ReferentItemState, ReferentRequestStatus } from "@/lib/db/use-case-hub-referents-ddl";

/**
 * La pagina pubblica `/rispondi/<token>` (SPEC §2.3, §3.8, §4): l'unico modulo della funzione che le
 * rotte pubbliche importano. Il link arriva sempre da `resolveReferentToken`; ogni lettura filtra su
 * `link.workspaceId` e `link.requestId`. Nei log solo il nome dell'operazione e un codice: mai il
 * token, il corpo della richiesta o il testo di una risposta.
 */

export { referentStoreReady } from "@/lib/db/queries/use-case-referent-base";
export { referentAskEnabled, referentPublicWritesAvailable } from "@/lib/use-cases/referent/availability";
export type { ReferentLink } from "@/lib/db/queries/use-case-referent-base";

const REFERENT_ACTOR = { kind: "referente" } as const;

export function logReferentPublicError(op: string, error: unknown): void {
  const name = error instanceof Error ? error.name : typeof error;
  const pgCode = error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string" ? String((error as { code: string }).code).slice(0, 10) : null;
  ucLog({ level: "error", area: "use-case.rispondi", op: String(op).slice(0, 40), code: /^[A-Za-z]{1,40}$/.test(name) ? name : "errore", pgCode, workspaceId: null });
}

// ─── Il link ─────────────────────────────────────────────────────────

/** La risoluzione del token (§2.3): una lettura, nessuna scrittura. */
export async function resolveReferentToken(token: string, now: Date): Promise<{ access: "ok"; link: ReferentLink } | { access: "non_valido" | "revocato" | "scaduto" }> {
  if (!looksLikeReferentToken(token)) return { access: "non_valido" };
  const hash = hashReferentToken(token);
  const executor = await getAppUcExecutor();
  const [[row]] = await executor.batch([
    toStatement(ucSql`SELECT t.id AS token_id, t.revoked_at AS token_revoked_at, t.expires_at AS token_expires_at,
  r.id, r.workspace_id, r.use_case_id, r.contact_id, r.status, r.expires_at, r.privacy_accepted_at, r.privacy_notice_version,
  (c.id IS NOT NULL AND c.is_active AND c.anonymized_at IS NULL AND c.email IS NOT NULL
    AND ${raw(RECIPIENT_HASH_SQL("c.email"))} = t.recipient_hash) AS contact_ok
FROM use_case_referent_tokens t
JOIN use_case_referent_requests r ON r.id = t.request_id AND r.workspace_id = t.workspace_id
LEFT JOIN uc_contacts c ON c.id = r.contact_id AND c.workspace_id = r.workspace_id
WHERE t.token_hash = ${cast(hash, "text")}`),
  ]);
  if (!row) return { access: "non_valido" };
  if (!rowBool(row.contact_ok)) return { access: "non_valido" };
  const status = (rowString(row.status) ?? "inviata") as ReferentRequestStatus;
  if (rowDate(row.token_revoked_at) !== null || status === "revocata") return { access: "revocato" };
  const tokenExpires = rowDate(row.token_expires_at);
  const expiresAt = rowDate(row.expires_at);
  if (!tokenExpires || !expiresAt || tokenExpires.getTime() <= now.getTime() || expiresAt.getTime() <= now.getTime() || status === "scaduta") return { access: "scaduto" };
  if (status !== "inviata" && status !== "completata") return { access: "non_valido" };
  return {
    access: "ok",
    link: {
      tokenId: String(row.token_id).toLowerCase(),
      requestId: String(row.id).toLowerCase(),
      workspaceId: String(row.workspace_id).toLowerCase(),
      useCaseId: String(row.use_case_id).toLowerCase(),
      contactId: String(row.contact_id).toLowerCase(),
      status,
      privacyAccepted: privacyAccepted({ privacyAcceptedAt: rowDate(row.privacy_accepted_at), privacyNoticeVersion: rowString(row.privacy_notice_version) }),
      expiresAt,
    },
  };
}

export async function loadReferentAskPage(token: string, o: { env: Env; now: Date }): Promise<ReferentPageResult> {
  if (o.env.USE_CASE_REFERENTS?.trim() === "off" || o.env.VERCEL_ENV === "preview") return { access: "non_disponibile" };
  if (!looksLikeReferentToken(token)) return { access: "non_valido" };
  try {
    if (!(await referentStoreReady())) return { access: "non_disponibile" };
    const resolved = await resolveReferentToken(token, o.now);
    if (resolved.access !== "ok") return { access: resolved.access };
    if (!referentAskEnabled(resolved.link.workspaceId, o.env)) return { access: "non_valido" };
    return { access: "ok", view: await loadReferentAskView(resolved.link, o) };
  } catch (error) {
    logReferentPublicError("pagina", error);
    return { access: "non_disponibile" };
  }
}

// ─── Letture della richiesta ─────────────────────────────────────────

interface ItemFact {
  needId: string;
  position: number;
  question: string;
  state: ReferentItemState;
  open: boolean;
  visible: boolean;
  /** (Parte 3) L'esigenza è già «Da verificare» o «A posto» (`itemHandledByTeam`). */
  handled: boolean;
  /** (Rilascio 5) «Serve un file». */
  fileRequired: boolean;
}

interface AnswerFact {
  needId: string;
  status: "bozza" | "inviata";
  body: string | null;
  dontKnow: boolean;
  /** (Rilascio 5) «È già allegato» e il commento. */
  alreadyAttached: boolean;
  comment: string | null;
  updatedAt: Date;
  submittedAt: Date | null;
}

interface FileFact extends PublicFileRow {
  needId: string;
  createdAt: Date;
  rejectionReason: string | null;
}

/** (Rilascio 5) La riga della conferma di una richiesta al referente, come è salvata. */
interface CheckFact {
  confirm: "si" | "correggi" | null;
  note: string | null;
  team: TeamSnapshot | null;
  estimate: "si" | "meno" | "piu" | null;
  timesPerMonth: number | null;
  minutesEach: number | null;
  updatedAt: Date;
  submittedAt: Date | null;
}

interface RequestFacts {
  status: ReferentRequestStatus;
  expiresAt: Date;
  privacyAcceptedAt: Date | null;
  privacyNoticeVersion: string | null;
  requesterName: string;
  requesterUserId: string | null;
  message: string | null;
  company: string;
  code: string | null;
  title: string;
  items: ItemFact[];
  answers: AnswerFact[];
  files: FileFact[];
  /** (Rilascio 5) La descrizione e il modello del valore dello use case, per la conferma e la stima. */
  description: string | null;
  valueModel: unknown;
  check: CheckFact | null;
}

function requestStatements(link: ReferentLink): UcStatement[] {
  const req = cast(link.requestId, "uuid");
  const ws = cast(link.workspaceId, "uuid");
  return [
    toStatement(ucSql`SELECT r.status, r.expires_at, r.privacy_accepted_at, r.privacy_notice_version, r.requester_name, r.requested_by_user_id, r.message,
  u.code, u.title, w.name AS company, u.description, u.value_model,
  c.request_id IS NOT NULL AS has_check, c.confirm, c.confirm_note, c.team_component_key, c.team_volume_year, c.team_minutes,
  c.estimate, c.times_per_month, c.minutes_each, c.updated_at AS check_updated_at, c.submitted_at AS check_submitted_at
FROM use_case_referent_requests r JOIN use_cases u ON u.id = r.use_case_id AND u.workspace_id = r.workspace_id JOIN workspaces w ON w.id = r.workspace_id
LEFT JOIN use_case_referent_checks c ON c.request_id = r.id AND c.workspace_id = r.workspace_id
WHERE r.id = ${req} AND r.workspace_id = ${ws}`),
    toStatement(ucSql`SELECT i.need_id, i.position, i.question, i.state, i.file_required, ${openItemSql("i", "r")} AS open,
  EXISTS (SELECT 1 FROM use_case_needs vn JOIN use_case_need_links vl ON vl.need_id = vn.id AND vl.use_case_id = r.use_case_id
          WHERE vn.id = i.need_id AND vn.workspace_id = r.workspace_id AND vn.archived_at IS NULL) AS visible,
  EXISTS (SELECT 1 FROM use_case_needs hn JOIN use_case_need_links hl ON hl.need_id = hn.id AND hl.use_case_id = r.use_case_id
          WHERE hn.id = i.need_id AND hn.workspace_id = r.workspace_id AND hn.archived_at IS NULL AND hn.status = ANY(${cast([...HANDLED_NEED_STATUSES], "text[]")})) AS handled
FROM use_case_referent_request_items i JOIN use_case_referent_requests r ON r.id = i.request_id
WHERE i.request_id = ${req} AND r.workspace_id = ${ws}
ORDER BY i.position`),
    toStatement(ucSql`SELECT a.need_id, a.status, a.body, a.dont_know, a.already_attached, a.comment, a.updated_at, a.submitted_at
FROM use_case_need_answers a
WHERE a.request_id = ${req} AND a.workspace_id = ${ws} AND a.removed_at IS NULL
ORDER BY a.created_at, a.id`),
    toStatement(ucSql`SELECT f.id, f.need_id, f.file_name, f.size_bytes, f.scan_status, f.rejection_reason, f.personal_warning, f.warning_confirmed_at, f.submitted_at, f.created_at
FROM use_case_need_files f
WHERE f.request_id = ${req} AND f.workspace_id = ${ws} AND f.deleted_at IS NULL
ORDER BY f.created_at, f.id`),
  ];
}

function fileStatusOf(value: unknown): ReferentFileView["status"] {
  const s = rowString(value);
  return s === "in_revisione" || s === "pulito" || s === "rifiutato" ? s : "in_quarantena";
}

async function readRequestFacts(executor: UcExecutor, link: ReferentLink): Promise<RequestFacts | null> {
  const [[r], items, answers, files] = await executor.batch(requestStatements(link));
  if (!r) return null;
  const expiresAt = rowDate(r.expires_at);
  if (!expiresAt) return null;
  return {
    status: (rowString(r.status) ?? "inviata") as ReferentRequestStatus,
    expiresAt,
    privacyAcceptedAt: rowDate(r.privacy_accepted_at),
    privacyNoticeVersion: rowString(r.privacy_notice_version),
    requesterName: rowString(r.requester_name) ?? "",
    requesterUserId: rowString(r.requested_by_user_id)?.toLowerCase() ?? null,
    message: rowString(r.message),
    company: rowString(r.company) ?? "",
    code: rowString(r.code),
    title: rowString(r.title) ?? "",
    items: items.map((i: UcRow) => ({
      needId: String(i.need_id).toLowerCase(),
      position: rowNumber(i.position) ?? 0,
      question: rowString(i.question) ?? "",
      state: (rowString(i.state) ?? "aperta") as ReferentItemState,
      open: rowBool(i.open),
      visible: rowBool(i.visible),
      handled: rowBool(i.handled),
      fileRequired: rowBool(i.file_required),
    })),
    answers: answers.map((a: UcRow) => ({
      needId: String(a.need_id).toLowerCase(),
      status: rowString(a.status) === "inviata" ? "inviata" : "bozza",
      body: rowString(a.body),
      dontKnow: rowBool(a.dont_know),
      alreadyAttached: rowBool(a.already_attached),
      comment: rowString(a.comment),
      updatedAt: rowDate(a.updated_at) ?? new Date(0),
      submittedAt: rowDate(a.submitted_at),
    })),
    files: files.map((f: UcRow) => {
      const scanStatus = fileStatusOf(f.scan_status);
      const rejectionReason = rowString(f.rejection_reason);
      return {
        id: String(f.id).toLowerCase(),
        needId: String(f.need_id).toLowerCase(),
        fileName: rowString(f.file_name) ?? "file",
        sizeBytes: rowNumber(f.size_bytes),
        scanStatus,
        message: scanStatus === "in_revisione" ? REFERENT_ERROR_MESSAGES.pdf_in_revisione : scanStatus === "rifiutato" ? rejectionMessage(rejectionReason) : null,
        personalWarning: rowBool(f.personal_warning),
        warningConfirmed: rowDate(f.warning_confirmed_at) !== null,
        submitted: rowDate(f.submitted_at) !== null,
        createdAt: rowDate(f.created_at) ?? new Date(0),
        rejectionReason,
      };
    }),
    description: rowString(r.description),
    valueModel: rowJsonValue(r.value_model),
    check: rowBool(r.has_check) ? checkFactOf(r) : null,
  };
}

/** Un numero di una colonna numeric (testo dal driver), oppure null. */
function rowNumeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value));
  return Number.isFinite(n) ? n : null;
}

/** Il modello del valore: jsonb arriva come testo dal driver locale, come oggetto da Neon. */
function rowJsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function checkFactOf(r: UcRow): CheckFact {
  const confirm = rowString(r.confirm);
  const estimate = rowString(r.estimate);
  const key = rowString(r.team_component_key);
  const volume = rowNumeric(r.team_volume_year);
  const minutes = rowNumeric(r.team_minutes);
  return {
    confirm: confirm === "si" || confirm === "correggi" ? confirm : null,
    note: rowString(r.confirm_note),
    team: key !== null && volume !== null && minutes !== null ? { key, volumeYear: volume, minutes } : null,
    estimate: estimate === "si" || estimate === "meno" || estimate === "piu" ? estimate : null,
    timesPerMonth: rowNumeric(r.times_per_month),
    minutesEach: rowNumeric(r.minutes_each),
    updatedAt: rowDate(r.check_updated_at) ?? new Date(0),
    submittedAt: rowDate(r.check_submitted_at),
  };
}

/** Il passo «Il tempo» è stato salvato (una scelta o un numero). */
function estimateSaved(c: CheckFact): boolean {
  return c.estimate !== null || c.timesPerMonth !== null || c.minutesEach !== null;
}

/**
 * (Rilascio 5, §6.1) La conferma e la stima come le vede il referente: la descrizione filtrata, la stima
 * del team di adesso, la sua bozza. Una stima salvata su un'istantanea che non è più quella di adesso
 * è «stale»: la pagina la mostra vuota con «Il team ha appena cambiato la stima: controlla di nuovo.».
 */
function checkViewOf(facts: RequestFacts): ReferentCheckView | null {
  const c = facts.check;
  if (!c) return null;
  const team = teamEstimateOf(facts.valueModel);
  const saved = estimateSaved(c);
  const stale = c.submittedAt === null && saved && !sameTeamEstimate(c.team, teamSnapshotOf(team));
  const any = c.confirm !== null || saved;
  return {
    description: referentDescription(facts.description).text,
    team: team ? { key: team.key, volumeYear: team.volumeYear, minutes: team.minutes, hours: team.hours, perMonth: team.perMonth, perYear: team.perYear, unit: team.unit, label: team.label } : null,
    draft: {
      confirm: c.confirm,
      note: c.note,
      estimate: stale ? null : c.estimate,
      timesPerMonth: stale ? null : c.timesPerMonth,
      minutesEach: stale ? null : c.minutesEach,
      stale,
      savedAt: any ? c.updatedAt.toISOString() : null,
    },
    submittedAt: c.submittedAt ? c.submittedAt.toISOString() : null,
  };
}

/** I file abbandonati in quarantena (più di un'ora) non si mostrano, non si contano, non si aspettano. */
function liveFile(f: FileFact, now: Date): boolean {
  return f.scanStatus !== "in_quarantena" || now.getTime() - f.createdAt.getTime() < PENDING_QUARANTINE_MS;
}

export async function loadReferentAskView(link: ReferentLink, o: { env: Env; now: Date }): Promise<ReferentAskView> {
  const executor = await getAppUcExecutor();
  const facts = await readRequestFacts(executor, link);
  if (!facts) throw new Error("richiesta_mancante");
  const items: PublicItemRow[] = facts.items.map((i) => {
    const draft = facts.answers.find((a) => a.needId === i.needId && a.status === "bozza") ?? null;
    const answer = facts.answers.find((a) => a.needId === i.needId && a.status === "inviata") ?? null;
    return {
      needId: i.needId,
      position: i.position,
      question: i.question,
      state: i.state,
      open: i.open && facts.status === "inviata" && facts.expiresAt.getTime() > o.now.getTime(),
      visible: i.visible,
      handled: i.handled,
      fileRequired: i.fileRequired,
      draft: draft ? { body: draft.body, dontKnow: draft.dontKnow, alreadyAttached: draft.alreadyAttached, comment: draft.comment, updatedAt: draft.updatedAt } : null,
      answer:
        answer && answer.submittedAt ? { body: answer.body, dontKnow: answer.dontKnow, alreadyAttached: answer.alreadyAttached, comment: answer.comment, submittedAt: answer.submittedAt } : null,
      files: facts.files.filter((f) => f.needId === i.needId && liveFile(f, o.now)),
    };
  });
  return toPublicView({
    request: {
      status: facts.status,
      expiresAt: facts.expiresAt,
      privacyAcceptedAt: facts.privacyAcceptedAt,
      privacyNoticeVersion: facts.privacyNoticeVersion,
      requesterName: facts.requesterName,
      message: facts.message,
    },
    company: facts.company,
    useCase: { code: facts.code, title: facts.title },
    items,
    privacyContact: REFERENT_PRIVACY_CONTACT(o.env),
    clientMode: clientUploadAvailable(o.env),
    check: checkViewOf(facts),
    now: o.now,
  });
}

// ─── Comandi ─────────────────────────────────────────────────────────

const MSG = REFERENT_ERROR_MESSAGES;
const pfail = <T>(code: string, message?: string, issues?: Issue[]): PublicOutcome<T> => publicFail<T>(code, message ?? MSG[code] ?? MSG.riprova, issues);
const notAvailable = <T>() => pfail<T>("domanda_non_disponibile", MSG.domanda_non_disponibile_pubblica);

function field(body: unknown, key: string): unknown {
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>)[key] : undefined;
}

/** La richiesta si può ancora scrivere: viva, non scaduta. */
function writable(link: ReferentLink, now: Date): boolean {
  return link.status === "inviata" && link.expiresAt.getTime() > now.getTime();
}

export async function acceptReferentPrivacy(link: ReferentLink, body: unknown, now: Date): Promise<PublicOutcome<{ accepted: true }>> {
  const version = field(body, "version");
  if (version !== REFERENT_PRIVACY_NOTICE.version) return pfail("informativa_cambiata");
  if (link.status !== "inviata" && link.status !== "completata") return pfail("link_non_valido");
  if (link.privacyAccepted) return { ok: true, value: { accepted: true } };
  void now;
  const executor = await getAppUcExecutor();
  const run = await referentBatch(executor, [
    toStatement(ucSql`UPDATE use_case_referent_requests SET privacy_accepted_at = now(), privacy_notice_version = ${cast(REFERENT_PRIVACY_NOTICE.version, "text")}
WHERE id = ${cast(link.requestId, "uuid")} AND workspace_id = ${cast(link.workspaceId, "uuid")} AND status IN ('inviata', 'completata')
  AND privacy_notice_version IS DISTINCT FROM ${cast(REFERENT_PRIVACY_NOTICE.version, "text")}`),
  ]);
  if (!run.ok) return pfail(run.error, run.message);
  return { ok: true, value: { accepted: true } };
}

/**
 * La bozza di una domanda: il testo, «Non ce l'ho» (`dontKnow`), «È già allegato» (`alreadyAttached`) e il
 * commento (rilascio 5, §3.6, §6.2). «Non ce l'ho» ed «È già allegato» si escludono e tolgono il testo; il
 * commento c'è solo con una delle due o con un file che si può inviare. Le regole stanno qui e nell'invio,
 * con i test: nessun CHECK nuovo sulla tabella (la regola di §0 della SPEC).
 */
export async function saveReferentDraft(link: ReferentLink, body: unknown, now: Date): Promise<PublicOutcome<DraftResult>> {
  if (!link.privacyAccepted) return pfail("informativa_da_leggere");
  if (!writable(link, now)) return notAvailable();
  const needId = field(body, "needId");
  const rawText = field(body, "text");
  const dontKnowRaw = field(body, "dontKnow");
  const attachedRaw = field(body, "alreadyAttached");
  const rawComment = field(body, "comment");
  if (
    !isUuid(needId) ||
    (rawText !== null && rawText !== undefined && typeof rawText !== "string") ||
    (dontKnowRaw !== undefined && typeof dontKnowRaw !== "boolean") ||
    (attachedRaw !== undefined && typeof attachedRaw !== "boolean") ||
    (rawComment !== null && rawComment !== undefined && typeof rawComment !== "string")
  ) {
    return pfail("dati_non_validi", "Dati non validi.");
  }
  const dontKnow = dontKnowRaw === true;
  const alreadyAttached = attachedRaw === true;
  if (dontKnow && alreadyAttached) return pfail("dati_non_validi", "Dati non validi.");
  let text: string | null = typeof rawText === "string" ? rawText.replace(/\r\n?/g, "\n").trim() : null;
  if (!text || dontKnow || alreadyAttached) text = null;
  if (text && text.length > REFERENT_LIMITS.answerMax) return pfail("testo_troppo_lungo");
  let comment: string | null = typeof rawComment === "string" ? rawComment.replace(/\r\n?/g, "\n").trim() : null;
  if (!comment) comment = null;
  if (comment && comment.length > REFERENT_CHECK_LIMITS.commentMax) return pfail("nota_troppo_lunga");
  let warnings: Issue[] = [];
  for (const value of [text, comment]) {
    if (!value) continue;
    const check = checkDraftText(value);
    if (!check.ok) return pfail(check.issues[0]?.code ?? "risposte_da_correggere", check.issues[0]?.message, check.issues);
    warnings = [...warnings, ...check.warnings];
  }
  const executor = await getAppUcExecutor();
  const need = cast(needId.toLowerCase(), "uuid");
  const req = cast(link.requestId, "uuid");
  const [[state]] = await executor.batch([
    toStatement(ucSql`SELECT ${openItemSql("i", "r")} AS open,
  (SELECT a.status FROM use_case_need_answers a WHERE a.request_id = r.id AND a.need_id = i.need_id) AS answer_status,
  EXISTS (SELECT 1 FROM use_case_need_files f WHERE f.request_id = r.id AND f.need_id = i.need_id AND f.deleted_at IS NULL AND f.submitted_at IS NULL
          AND f.scan_status IN ('pulito', 'in_revisione')) AS has_file
FROM use_case_referent_request_items i JOIN use_case_referent_requests r ON r.id = i.request_id
WHERE i.request_id = ${req} AND i.need_id = ${need} AND r.workspace_id = ${cast(link.workspaceId, "uuid")} AND r.status = 'inviata' AND r.expires_at > now()`),
  ]);
  if (!state) return notAvailable();
  if (rowString(state.answer_status) === "inviata") return pfail("gia_inviata");
  if (!rowBool(state.open)) return notAvailable();
  // Il commento solo con una chiusura senza testo: «Non ce l'ho», «È già allegato» o un file.
  if (comment && !dontKnow && !alreadyAttached && !rowBool(state.has_file)) return pfail("dati_non_validi", "Dati non validi.");
  const run = await referentBatch(executor, [
    toStatement(ucSql`INSERT INTO use_case_need_answers (workspace_id, use_case_id, need_id, request_id, source, body, dont_know, already_attached, comment, status)
SELECT n.workspace_id, l.use_case_id, n.id, r.id, 'referente', ${cast(text, "text")}, ${cast(dontKnow, "boolean")}, ${cast(alreadyAttached, "boolean")}, ${cast(comment, "text")}, 'bozza'
FROM use_case_referent_request_items i
JOIN use_case_referent_requests r ON r.id = i.request_id
JOIN use_case_needs n ON n.id = i.need_id AND n.workspace_id = r.workspace_id
JOIN use_case_need_links l ON l.need_id = n.id AND l.use_case_id = r.use_case_id
WHERE i.request_id = ${req} AND i.need_id = ${need} AND r.workspace_id = ${cast(link.workspaceId, "uuid")} AND r.status = 'inviata' AND r.expires_at > now()
  AND i.state = 'aperta' AND n.status = 'chiesta' AND n.archived_at IS NULL AND n.type = 'requisito'
ON CONFLICT (request_id, need_id) WHERE request_id IS NOT NULL DO UPDATE SET body = EXCLUDED.body, dont_know = EXCLUDED.dont_know,
  already_attached = EXCLUDED.already_attached, comment = EXCLUDED.comment, updated_at = now()
  WHERE use_case_need_answers.status = 'bozza'
RETURNING updated_at`),
  ]);
  if (!run.ok) return pfail(run.error, run.message);
  const savedAt = rowDate(run.rows[0]?.[0]?.updated_at);
  if (!savedAt) return pfail("gia_inviata");
  return { ok: true, value: { savedAt: savedAt.toISOString(), warnings } };
}

// ─── La conferma e la stima (rilascio 5, §6.2) ───────────────────────

function teamSeenOf(value: unknown): { ok: true; value: TeamSnapshot | null } | { ok: false } {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== "object" || Array.isArray(value)) return { ok: false };
  const v = value as Record<string, unknown>;
  if (typeof v.key !== "string" || !v.key || v.key.length > 40) return { ok: false };
  if (typeof v.volumeYear !== "number" || !Number.isFinite(v.volumeYear) || typeof v.minutes !== "number" || !Number.isFinite(v.minutes)) return { ok: false };
  return { ok: true, value: { key: v.key, volumeYear: v.volumeYear, minutes: v.minutes } };
}

/** Lo statement della bozza: solo sulla riga di una richiesta viva, mai dopo l'invio. */
function checkUpdateSql(link: ReferentLink, set: ReturnType<typeof ucSql>): UcStatement {
  return toStatement(ucSql`UPDATE use_case_referent_checks c SET ${set}, updated_at = now()
FROM use_case_referent_requests r
WHERE c.request_id = ${cast(link.requestId, "uuid")} AND c.workspace_id = ${cast(link.workspaceId, "uuid")} AND r.id = c.request_id
  AND r.status = 'inviata' AND r.expires_at > now() AND c.submitted_at IS NULL
RETURNING c.updated_at`);
}

/**
 * (Rilascio 5, §6.2) La bozza del passo «Lo use case» (`{ step: 1, confirm, note }`) o del passo «Il
 * tempo» (`{ step: 2, teamSeen, estimate, timesPerMonth, minutesEach }`).
 * - Il passo 1 scrive solo la conferma e la nota: non legge mai la stima, così un cambio del team non lo
 *   respinge. La nota passa dai controlli delle risposte (dati sanitari rifiutati, il resto avvisi).
 * - Il passo 2 legge la stima del team di adesso: se non è quella che il referente ha visto (`teamSeen`)
 *   non scrive niente e risponde `stima_cambiata`; altrimenti un solo UPDATE scrive l'istantanea e la
 *   risposta (quello che manca diventa NULL), così un cambio dell'istantanea toglie sempre la risposta di prima.
 */
export async function saveReferentCheck(link: ReferentLink, body: unknown, now: Date): Promise<PublicOutcome<CheckResult>> {
  if (!link.privacyAccepted) return pfail("informativa_da_leggere");
  if (!writable(link, now)) return notAvailable();
  const step = field(body, "step");
  if (step !== 1 && step !== 2) return pfail("dati_non_validi", "Dati non validi.");
  const executor = await getAppUcExecutor();
  const facts = await readRequestFacts(executor, link);
  if (!facts || facts.status !== "inviata" || !facts.check) return notAvailable();
  if (facts.check.submittedAt) return pfail("gia_inviata");
  let warnings: Issue[] = [];
  let statement: UcStatement;
  if (step === 1) {
    const confirm = field(body, "confirm");
    const rawNote = field(body, "note");
    if ((confirm !== null && confirm !== "si" && confirm !== "correggi") || (rawNote !== null && rawNote !== undefined && typeof rawNote !== "string")) {
      return pfail("dati_non_validi", "Dati non validi.");
    }
    let note: string | null = typeof rawNote === "string" ? rawNote.replace(/\r\n?/g, "\n").trim() : null;
    if (!note || confirm !== "correggi") note = null;
    if (note && note.length > REFERENT_CHECK_LIMITS.noteMax) return pfail("nota_troppo_lunga");
    if (note) {
      const check = checkDraftText(note);
      if (!check.ok) return pfail(check.issues[0]?.code ?? "risposte_da_correggere", check.issues[0]?.message, check.issues);
      warnings = check.warnings;
    }
    statement = checkUpdateSql(link, ucSql`confirm = ${cast(confirm, "text")}, confirm_note = ${cast(note, "text")}`);
  } else {
    const seen = teamSeenOf(field(body, "teamSeen"));
    const estimate = field(body, "estimate");
    if (!seen.ok || (estimate !== null && estimate !== undefined && estimate !== "si" && estimate !== "meno" && estimate !== "piu")) return pfail("dati_non_validi", "Dati non validi.");
    const times = referentNumber(field(body, "timesPerMonth"), REFERENT_NUMBER_MAX.timesPerMonth);
    const minutes = referentNumber(field(body, "minutesEach"), REFERENT_NUMBER_MAX.minutesEach);
    if (!times.ok || !minutes.ok) return pfail("numero_non_valido");
    const current = teamSnapshotOf(teamEstimateOf(facts.valueModel));
    if (!sameTeamEstimate(seen.value, current)) return pfail("stima_cambiata");
    const choice = estimate === undefined ? null : estimate;
    if (current === null && choice !== null) return pfail("dati_non_validi", "Dati non validi.");
    // «Sì» (o nessuna scelta, con la stima del team) non porta numeri: quelli sono del team.
    const numbers = current !== null && (choice === "si" || choice === null) ? { t: null, m: null } : { t: times.value, m: minutes.value };
    statement = checkUpdateSql(
      link,
      ucSql`team_component_key = ${cast(current?.key ?? null, "text")}, team_volume_year = ${cast(current?.volumeYear ?? null, "numeric")}, team_minutes = ${cast(current?.minutes ?? null, "numeric")},
  estimate = ${cast(choice, "text")}, times_per_month = ${cast(numbers.t, "numeric")}, minutes_each = ${cast(numbers.m, "numeric")}`,
    );
  }
  const run = await referentBatch(executor, [statement]);
  if (!run.ok) return pfail(run.error, run.message);
  const savedAt = rowDate(run.rows[0]?.[0]?.updated_at);
  if (!savedAt) return notAvailable();
  return { ok: true, value: { savedAt: savedAt.toISOString(), warnings } };
}

interface Target {
  needId: string;
  dontKnow: boolean;
  /** (Rilascio 5) «È già allegato»: conta come una risposta, l'esigenza va «Da verificare». */
  alreadyAttached: boolean;
  hasDraft: boolean;
  /** C'è un testo: solo così conta come «risposta» (un file da solo conta tra i documenti). */
  hasText: boolean;
  documents: number;
}

/**
 * (Rilascio 5, §3.6) Una domanda aperta è chiusa da: un testo (non su «Serve un file»), un file che si
 * può inviare, «Non ce l'ho» o «È già allegato». Il messaggio di quello che manca, per domanda.
 */
function closureOf(i: { fileRequired: boolean }, draft: AnswerFact | null, files: number): "testo" | "file" | "non_so" | "allegato" | null {
  if (draft?.dontKnow) return "non_so";
  if (draft?.alreadyAttached) return "allegato";
  if (files > 0) return "file";
  if (!i.fileRequired && draft?.body?.trim()) return "testo";
  return null;
}

/**
 * L'invio (§3.8; rilascio 5 §6.2): tutto in un batch, oppure niente; e (D17) solo quando ogni domanda
 * aperta è chiusa, la conferma data e la stima completa. Altrimenti `domande_aperte` con una voce per
 * domanda che manca; una domanda aggiunta dal team mentre la pagina era aperta (`shown` non la ha) dà
 * `domande_nuove` e la pagina si rilegge.
 */
export async function submitReferentAnswers(link: ReferentLink, body: unknown, now: Date): Promise<PublicOutcome<SubmitResult>> {
  if (!link.privacyAccepted) return pfail("informativa_da_leggere");
  if (!writable(link, now)) return notAvailable();
  const idsOf = (raw: unknown): string[] | null | "x" => {
    if (raw === undefined || raw === null) return null;
    if (!Array.isArray(raw) || raw.length > REFERENT_LIMITS.questionsPerRequest || !raw.every(isUuid)) return "x";
    return [...new Set(raw.map((x) => (x as string).toLowerCase()))];
  };
  const wanted = idsOf(field(body, "needIds"));
  const shown = idsOf(field(body, "shown"));
  if (wanted === "x" || shown === "x") return pfail("dati_non_validi", "Dati non validi.");
  const executor = await getAppUcExecutor();
  const facts = await readRequestFacts(executor, link);
  if (!facts || facts.status !== "inviata") return notAvailable();
  if (!privacyAccepted(facts)) return pfail("informativa_da_leggere");

  const openItems = facts.items.filter((i) => i.open);
  const openIds = new Set(openItems.map((i) => i.needId));
  const pending = (needId: string) => facts.files.filter((f) => f.needId === needId && !f.submitted && liveFile(f, now));
  const usable = (needId: string) => pending(needId).filter((f) => f.scanStatus === "pulito" || f.scanStatus === "in_revisione");
  const draftOf = (needId: string) => facts.answers.find((a) => a.needId === needId && a.status === "bozza") ?? null;
  // `needIds` del rilascio 4: solo domande ancora aperte (le altre non sono più per il referente).
  if (wanted && wanted.some((id) => !openIds.has(id))) return notAvailable();
  // Una domanda aperta che la pagina non mostrava: aggiunta dal team intanto.
  if (shown) {
    const fresh = openItems.filter((i) => !shown.includes(i.needId));
    if (fresh.length) return pfail("domande_nuove", undefined, fresh.map((i) => ({ code: "domande_nuove", message: MSG.domande_nuove, field: i.needId })));
  }

  const issues: Issue[] = [];
  const missing: Issue[] = [];
  const ready: Target[] = [];
  for (const item of openItems) {
    const needId = item.needId;
    const draft = draftOf(needId);
    const files = usable(needId);
    const closure = closureOf(item, draft, files.length);
    if (closure === "non_so" && files.length > 0) return pfail("non_so_con_file");
    if (closure === null) {
      missing.push({ code: "domanda_aperta", message: item.fileRequired ? MSG.domanda_aperta_file : MSG.domanda_aperta, field: needId });
      continue;
    }
    if (pending(needId).some((f) => f.scanStatus === "in_quarantena")) return pfail("file_in_controllo");
    if (files.some((f) => f.personalWarning && !f.warningConfirmed)) return pfail("file_da_confermare");
    const text = closure === "testo" || (closure === "file" && !item.fileRequired && draft?.body?.trim()) ? (draft?.body ?? null) : null;
    for (const [value, where] of [[text, needId], [closure !== "testo" ? (draft?.comment ?? null) : null, `${needId}.commento`]] as const) {
      if (!value) continue;
      const check = checkSubmitText(value, where);
      if (!check.ok) issues.push(...check.issues);
    }
    ready.push({ needId, dontKnow: closure === "non_so", alreadyAttached: closure === "allegato", hasDraft: draft !== null, hasText: text !== null, documents: files.length });
  }
  // (Rilascio 5, §6.2 punto 2) La conferma e la stima, quando la richiesta è al referente: la conferma
  // data (con «Correggi», una nota), il passo «Il tempo» completo per la sua istantanea. Mai un confronto
  // con la stima di adesso: un cambio dopo la risposta lo vede il team sulla scheda.
  const check = facts.check && !facts.check.submittedAt ? facts.check : null;
  if (check) {
    const note = check.note?.trim() ?? "";
    if (!check.confirm || (check.confirm === "correggi" && note.length < 2)) return pfail("conferma_mancante");
    if (check.confirm === "correggi") {
      const text = checkSubmitText(note, "conferma");
      if (!text.ok) issues.push(...text.issues);
    }
    const complete = check.team ? check.estimate !== null : check.timesPerMonth !== null && check.minutesEach !== null;
    if (!complete) return pfail("stima_mancante");
  }
  if (missing.length > 0) return pfail("domande_aperte", missing.length === 1 ? MSG.domande_aperte_una : MSG.domande_aperte, missing);
  if (issues.length > 0) return pfail("risposte_da_correggere", undefined, issues);
  if (ready.length === 0 && !check) return pfail("nessuna_risposta");

  // (Parte 3) Chi risponde, se è anche una persona di Unbundle: non riceve la notifica né l'avviso di
  // quello che ha fatto lui. Si rilegge adesso (ruolo e account di questo momento); la Storia resta «Referente».
  const actorUserId = (await readReferentPerson(executor, link.workspaceId, link.contactId)).userId;
  const ws = cast(link.workspaceId, "uuid");
  const req = cast(link.requestId, "uuid");
  const all = ready.map((t) => t.needId);
  const unknownIds = ready.filter((t) => t.dontKnow).map((t) => t.needId);
  const answerIds = ready.filter((t) => !t.dontKnow).map((t) => t.needId);
  // (Rilascio 5) Un testo che non chiude la domanda (con un file su «Serve un file») non parte; il
  // commento parte solo con una chiusura senza testo.
  const textless = ready.filter((t) => !t.hasText && t.hasDraft).map((t) => t.needId);
  const commentless = ready.filter((t) => t.hasText && t.hasDraft).map((t) => t.needId);
  const drafted = ready.filter((t) => t.hasDraft).map((t) => t.needId);
  const fileOnly = ready.filter((t) => !t.hasDraft).map((t) => t.needId);
  // Le risposte con un testo; una domanda con solo file conta tra i documenti, mai due volte.
  // (Rilascio 5, §13) La conferma inviata conta come una risposta: la campanella e l'avviso partono
  // anche quando il referente ha detto solo «Sì» e «Sì».
  const answers = ready.filter((t) => t.hasText || t.alreadyAttached).length + (check ? 1 : 0);
  const unknowns = unknownIds.length;
  const documents = ready.reduce((n, t) => n + t.documents, 0);
  const completedFilter = ucSql`r.id = ${req} AND r.workspace_id = ${ws} AND r.status = 'completata' AND r.completed_at = now()`;

  // Prima la riga della richiesta, come revoca e scadenza: le due transazioni si mettono in fila.
  const statements: UcStatement[] = [lockRequestSql(link.workspaceId, link.requestId)];
  if (drafted.length) {
    statements.push(
      toStatement(ucSql`WITH upd AS (
  UPDATE use_case_need_answers SET status = 'inviata', submitted_at = now(), updated_at = now(),
    body = CASE WHEN need_id = ANY(${cast(textless, "uuid[]")}) THEN NULL ELSE body END,
    comment = CASE WHEN need_id = ANY(${cast(commentless, "uuid[]")}) THEN NULL ELSE comment END
  WHERE request_id = ${req} AND workspace_id = ${ws} AND need_id = ANY(${cast(drafted, "uuid[]")}) AND status = 'bozza'
  RETURNING id
)
${casTail("upd", drafted.length, "conflitto")}`),
    );
  }
  if (fileOnly.length) {
    statements.push(
      toStatement(ucSql`WITH ins AS (
  INSERT INTO use_case_need_answers (workspace_id, use_case_id, need_id, request_id, source, body, dont_know, status, submitted_at)
  SELECT n.workspace_id, l.use_case_id, n.id, ${req}, 'referente', NULL, false, 'inviata', now()
  FROM use_case_needs n JOIN use_case_need_links l ON l.need_id = n.id
  WHERE n.id = ANY(${cast(fileOnly, "uuid[]")}) AND n.workspace_id = ${ws} AND l.use_case_id = ${cast(link.useCaseId, "uuid")} AND n.archived_at IS NULL AND n.type = 'requisito'
  RETURNING id
)
${casTail("ins", fileOnly.length, "domanda_non_disponibile")}`),
    );
  }
  if (all.length) {
    statements.push(
      toStatement(ucSql`WITH upd AS (
  UPDATE use_case_referent_request_items i
  SET state = CASE WHEN i.need_id = ANY(${cast(unknownIds, "uuid[]")}) THEN 'non_so' ELSE 'risposta' END, answered_at = now()
  FROM use_case_referent_requests r
  WHERE r.id = i.request_id AND i.request_id = ${req} AND r.workspace_id = ${ws} AND r.status = 'inviata' AND r.expires_at > now()
    AND i.need_id = ANY(${cast(all, "uuid[]")}) AND ${openItemSql("i", "r")}
  RETURNING i.need_id
)
${casTail("upd", all.length, "conflitto")}`),
      toStatement(ucSql`UPDATE use_case_need_files SET submitted_at = now()
WHERE request_id = ${req} AND workspace_id = ${ws} AND need_id = ANY(${cast(all, "uuid[]")})
  AND deleted_at IS NULL AND submitted_at IS NULL AND scan_status IN ('pulito', 'in_revisione')`),
    );
  }
  if (check) {
    // La conferma e la stima inviate, prima del completamento (che conta ancora la conferma da inviare).
    statements.push(
      toStatement(ucSql`WITH upd AS (
  UPDATE use_case_referent_checks SET submitted_at = now(), updated_at = now()
  WHERE request_id = ${req} AND workspace_id = ${ws} AND submitted_at IS NULL
  RETURNING request_id
)
${casTail("upd", 1, "conflitto")}`),
    );
  }
  if (answerIds.length) statements.push(needTransitionSql({ workspaceId: link.workspaceId, needIds: answerIds, from: ["chiesta"], to: "in_verifica", actor: REFERENT_ACTOR }));
  if (unknownIds.length) statements.push(needTransitionSql({ workspaceId: link.workspaceId, needIds: unknownIds, from: ["chiesta"], to: "mancante", actor: REFERENT_ACTOR }));
  if (check) {
    statements.push(referentEventSql({ workspaceId: link.workspaceId, useCaseId: link.useCaseId, code: check.confirm === "correggi" ? "correzione" : "conferma", actor: REFERENT_ACTOR }));
    if (check.estimate !== "si") statements.push(referentEventSql({ workspaceId: link.workspaceId, useCaseId: link.useCaseId, code: "stima_diversa", actor: REFERENT_ACTOR }));
  }
  statements.push(
    referentEventSql({ workspaceId: link.workspaceId, useCaseId: link.useCaseId, code: "risposte", actor: REFERENT_ACTOR }),
    toStatement(ucSql`UPDATE use_case_referent_requests r SET status = 'completata', completed_at = now(), version = version + 1
WHERE r.id = ${req} AND r.workspace_id = ${ws} AND r.status = 'inviata' AND ${openItemsCountSql("r")} = 0`),
    ...cancelQueuedForRequestsStatements({ workspaceId: link.workspaceId, filter: completedFilter, reason: "completata" }),
    ...draftsCleanupStatements({ workspaceId: link.workspaceId, filter: completedFilter }),
    referentEventsForRequestsSql({ filter: completedFilter, code: "completata", actor: REFERENT_ACTOR }),
    toStatement(ucSql`INSERT INTO use_case_referent_emails (workspace_id, contact_id, request_id, template, dedupe_key, due_at, scheduled_at)
SELECT r.workspace_id, r.contact_id, r.id, 'conferma', ${cast(`conf:${link.requestId}:${romeDate(now)}`, "text")}, now(), now()
FROM use_case_referent_requests r WHERE r.id = ${req} AND r.workspace_id = ${ws}
ON CONFLICT (dedupe_key) DO NOTHING`),
    notifyReviewersSql({ workspaceId: link.workspaceId, useCaseId: link.useCaseId, kind: "risposte", answers, unknowns, documents, actorUserId }),
    queueRequesterAlertSql({
      workspaceId: link.workspaceId,
      target: { requestId: link.requestId },
      answers,
      unknowns,
      documents,
      followUp: null,
      actorUserId,
      immediate: true,
      schedule: alertSchedule(now),
      now,
    }),
    // Le risposte del referente non chiudono mai un'esigenza («Da verificare», «Manca il dato»): niente
    // «Pronto da avviare» da controllare qui (`readiness: null`), solo «Informazioni complete».
    ...cardSyncStatements({ workspaceId: link.workspaceId, useCaseIds: [link.useCaseId], actorUserId, readiness: null }),
    toStatement(ucSql`SELECT r.status, ${openItemsCountSql("r")} AS open_items FROM use_case_referent_requests r WHERE r.id = ${req} AND r.workspace_id = ${ws}`),
  );
  const run = await referentBatch(executor, statements);
  if (!run.ok) {
    if (run.error === "conflitto" || run.error === "domanda_non_disponibile") return notAvailable();
    return pfail(run.error, run.message);
  }
  const last = run.rows[run.rows.length - 1]?.[0];
  const open = rowNumber(last?.open_items) ?? 0;
  return { ok: true, value: { submitted: ready.length + (check ? 1 : 0), open, state: rowString(last?.status) === "completata" || open === 0 ? "completata" : "aperta" } };
}

// ─── File del referente ──────────────────────────────────────────────

export async function uploadReferentFileServer(
  link: ReferentLink,
  input: { needId: string; fileName: string; declaration: boolean; bytes: Uint8Array },
  env: Env,
): Promise<Result<ReferentUploadResult>> {
  return referentUploadServer(link, input, env);
}

export async function beginReferentClientUpload(link: ReferentLink, body: unknown, env: Env): Promise<Result<ReferentClientTicket>> {
  return referentBeginClient(link, body, env);
}

export async function completeReferentClientUpload(link: ReferentLink, body: unknown, env: Env): Promise<Result<ReferentUploadResult>> {
  return referentCompleteClient(link, body, env);
}

interface OwnFile {
  id: string;
  submitted: boolean;
  personalWarning: boolean;
  blobPath: string | null;
  quarantinePath: string | null;
}

async function ownFile(executor: UcExecutor, link: ReferentLink, fileId: unknown): Promise<OwnFile | null> {
  if (!isUuid(fileId)) return null;
  const [[row]] = await executor.batch([
    toStatement(ucSql`SELECT id, submitted_at, personal_warning, blob_path, quarantine_path FROM use_case_need_files
WHERE id = ${cast(fileId.toLowerCase(), "uuid")} AND request_id = ${cast(link.requestId, "uuid")} AND workspace_id = ${cast(link.workspaceId, "uuid")}
  AND source = 'referente' AND deleted_at IS NULL`),
  ]);
  if (!row) return null;
  return {
    id: String(row.id).toLowerCase(),
    submitted: rowDate(row.submitted_at) !== null,
    personalWarning: rowBool(row.personal_warning),
    blobPath: rowString(row.blob_path),
    quarantinePath: rowString(row.quarantine_path),
  };
}

export async function removeReferentFile(link: ReferentLink, body: unknown, env: Env): Promise<PublicOutcome<{ removed: true }>> {
  if (!link.privacyAccepted) return pfail("informativa_da_leggere");
  const executor = await getAppUcExecutor();
  const file = await ownFile(executor, link, field(body, "fileId"));
  if (!file) return pfail("file_non_trovato");
  if (file.submitted) return pfail("file_gia_inviato");
  const [rows] = await executor.batch([
    toStatement(ucSql`UPDATE use_case_need_files SET deleted_at = now(), deleted_reason = 'referente'
WHERE id = ${cast(file.id, "uuid")} AND request_id = ${cast(link.requestId, "uuid")} AND deleted_at IS NULL AND submitted_at IS NULL RETURNING id`),
  ]);
  if (rows.length !== 1) return pfail("file_gia_inviato");
  afterResponse(async () => {
    try {
      await deleteFileObjects([{ id: file.id, blobPath: file.blobPath, quarantinePath: file.quarantinePath }], env);
    } catch (error) {
      logReferentPublicError("file_tolto", error);
    }
  });
  return { ok: true, value: { removed: true } };
}

export async function confirmReferentFile(link: ReferentLink, body: unknown): Promise<PublicOutcome<{ confirmed: true }>> {
  if (!link.privacyAccepted) return pfail("informativa_da_leggere");
  const executor = await getAppUcExecutor();
  const file = await ownFile(executor, link, field(body, "fileId"));
  if (!file || file.submitted || !file.personalWarning) return pfail("file_non_trovato");
  const [rows] = await executor.batch([
    toStatement(ucSql`UPDATE use_case_need_files SET warning_confirmed_at = coalesce(warning_confirmed_at, now())
WHERE id = ${cast(file.id, "uuid")} AND request_id = ${cast(link.requestId, "uuid")} AND deleted_at IS NULL AND submitted_at IS NULL AND personal_warning RETURNING id`),
  ]);
  if (rows.length !== 1) return pfail("file_non_trovato");
  return { ok: true, value: { confirmed: true } };
}

// ─── Limiti, invio dopo la risposta, codici HTTP ─────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Il secchio del link del referente per il tipo di chiamata (`ucq:<token>:<tipo>`). */
export function referentRateRule(tokenId: string, kind: RateLimitKind): RateLimitRule {
  if (!UUID.test(tokenId)) throw new Error("Link non valido");
  const spec = RATE_LIMITS[kind];
  return { bucket: `ucq:${tokenId.toLowerCase()}:${kind}`, unit: spec.unit, limit: spec.limit };
}

/**
 * Dopo la risposta: le email in coda di questa richiesta (al massimo 5), poi l'avviso a chi ha
 * chiesto (al massimo 3). Gli errori finiscono nel log con un codice.
 */
export function scheduleReferentDispatch(requestId: string): void {
  if (!isUuid(requestId)) return;
  afterResponse(async () => {
    try {
      await dispatchReferentEmails({ requestId, limit: 5 });
    } catch (error) {
      logReferentPublicError("invio_dopo_risposta", error);
    }
    try {
      const executor = await getAppUcExecutor();
      const [[row]] = await executor.batch([toStatement(ucSql`SELECT requested_by_user_id FROM use_case_referent_requests WHERE id = ${cast(requestId, "uuid")}`)]);
      const userId = rowString(row?.requested_by_user_id);
      if (userId) await dispatchRequesterAlerts({ recipientUserId: userId, limit: 3 });
    } catch (error) {
      logReferentPublicError("avviso_dopo_risposta", error);
    }
  });
}

/** I codici HTTP della pagina pubblica (§4.3); gli altri da `publicStatusFor`/`uploadStatusFor`. */
export const REFERENT_PUBLIC_STATUS: Readonly<Record<string, number>> = Object.freeze({
  link_non_valido: 404,
  informativa_da_leggere: 409,
  informativa_cambiata: 409,
  domanda_non_disponibile: 404,
  gia_inviata: 409,
  // (Rilascio 5) Le domande ancora da chiudere, o domande nuove del team.
  domande_aperte: 422,
  domande_nuove: 409,
  risposte_da_correggere: 422,
  nessuna_risposta: 409,
  risposta_vuota: 422,
  non_so_con_file: 409,
  file_in_controllo: 409,
  file_da_confermare: 409,
  troppi_file: 409,
  file_gia_inviato: 409,
  file_non_trovato: 404,
  testo_troppo_lungo: 422,
  modalita_non_disponibile: 409,
  // (Rilascio 5) La conferma e la stima.
  conferma_mancante: 422,
  stima_mancante: 422,
  stima_cambiata: 409,
  numero_non_valido: 422,
  nota_troppo_lunga: 422,
});
