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
import {
  REFERENT_LIMITS,
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
  infoCompleteSyncStatements,
  needTransitionSql,
  notifyReviewersSql,
  openItemSql,
  openItemsCountSql,
  queueRequesterAlertSql,
  referentEventSql,
  referentEventsForRequestsSql,
  casTail,
} from "@/lib/use-cases/referent/sql";
import { HANDLED_NEED_STATUSES, privacyAccepted } from "@/lib/use-cases/referent/state";
import { checkDraftText, checkSubmitText } from "@/lib/use-cases/referent/text";
import { hashReferentToken, looksLikeReferentToken, RECIPIENT_HASH_SQL } from "@/lib/use-cases/referent/tokens";
import { toPublicView, type PublicFileRow, type PublicItemRow } from "@/lib/use-cases/referent/view";
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
}

interface AnswerFact {
  needId: string;
  status: "bozza" | "inviata";
  body: string | null;
  dontKnow: boolean;
  updatedAt: Date;
  submittedAt: Date | null;
}

interface FileFact extends PublicFileRow {
  needId: string;
  createdAt: Date;
  rejectionReason: string | null;
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
}

function requestStatements(link: ReferentLink): UcStatement[] {
  const req = cast(link.requestId, "uuid");
  const ws = cast(link.workspaceId, "uuid");
  return [
    toStatement(ucSql`SELECT r.status, r.expires_at, r.privacy_accepted_at, r.privacy_notice_version, r.requester_name, r.requested_by_user_id, r.message,
  u.code, u.title, w.name AS company
FROM use_case_referent_requests r JOIN use_cases u ON u.id = r.use_case_id AND u.workspace_id = r.workspace_id JOIN workspaces w ON w.id = r.workspace_id
WHERE r.id = ${req} AND r.workspace_id = ${ws}`),
    toStatement(ucSql`SELECT i.need_id, i.position, i.question, i.state, ${openItemSql("i", "r")} AS open,
  EXISTS (SELECT 1 FROM use_case_needs vn JOIN use_case_need_links vl ON vl.need_id = vn.id AND vl.use_case_id = r.use_case_id
          WHERE vn.id = i.need_id AND vn.workspace_id = r.workspace_id AND vn.archived_at IS NULL) AS visible,
  EXISTS (SELECT 1 FROM use_case_needs hn JOIN use_case_need_links hl ON hl.need_id = hn.id AND hl.use_case_id = r.use_case_id
          WHERE hn.id = i.need_id AND hn.workspace_id = r.workspace_id AND hn.archived_at IS NULL AND hn.status = ANY(${cast([...HANDLED_NEED_STATUSES], "text[]")})) AS handled
FROM use_case_referent_request_items i JOIN use_case_referent_requests r ON r.id = i.request_id
WHERE i.request_id = ${req} AND r.workspace_id = ${ws}
ORDER BY i.position`),
    toStatement(ucSql`SELECT a.need_id, a.status, a.body, a.dont_know, a.updated_at, a.submitted_at
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
    })),
    answers: answers.map((a: UcRow) => ({
      needId: String(a.need_id).toLowerCase(),
      status: rowString(a.status) === "inviata" ? "inviata" : "bozza",
      body: rowString(a.body),
      dontKnow: rowBool(a.dont_know),
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
      draft: draft ? { body: draft.body, dontKnow: draft.dontKnow, updatedAt: draft.updatedAt } : null,
      answer: answer && answer.submittedAt ? { body: answer.body, dontKnow: answer.dontKnow, submittedAt: answer.submittedAt } : null,
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

export async function saveReferentDraft(link: ReferentLink, body: unknown, now: Date): Promise<PublicOutcome<DraftResult>> {
  if (!link.privacyAccepted) return pfail("informativa_da_leggere");
  if (!writable(link, now)) return notAvailable();
  const needId = field(body, "needId");
  const rawText = field(body, "text");
  const dontKnowRaw = field(body, "dontKnow");
  if (!isUuid(needId) || (rawText !== null && rawText !== undefined && typeof rawText !== "string") || (dontKnowRaw !== undefined && typeof dontKnowRaw !== "boolean")) {
    return pfail("dati_non_validi", "Dati non validi.");
  }
  const dontKnow = dontKnowRaw === true;
  let text: string | null = typeof rawText === "string" ? rawText.replace(/\r\n?/g, "\n").trim() : null;
  if (!text || dontKnow) text = null;
  if (text && text.length > REFERENT_LIMITS.answerMax) return pfail("testo_troppo_lungo");
  let warnings: Issue[] = [];
  if (text) {
    const check = checkDraftText(text);
    if (!check.ok) return pfail(check.issues[0]?.code ?? "risposte_da_correggere", check.issues[0]?.message, check.issues);
    warnings = check.warnings;
  }
  const executor = await getAppUcExecutor();
  const need = cast(needId.toLowerCase(), "uuid");
  const req = cast(link.requestId, "uuid");
  const [[state]] = await executor.batch([
    toStatement(ucSql`SELECT ${openItemSql("i", "r")} AS open,
  (SELECT a.status FROM use_case_need_answers a WHERE a.request_id = r.id AND a.need_id = i.need_id) AS answer_status
FROM use_case_referent_request_items i JOIN use_case_referent_requests r ON r.id = i.request_id
WHERE i.request_id = ${req} AND i.need_id = ${need} AND r.workspace_id = ${cast(link.workspaceId, "uuid")} AND r.status = 'inviata' AND r.expires_at > now()`),
  ]);
  if (!state) return notAvailable();
  if (rowString(state.answer_status) === "inviata") return pfail("gia_inviata");
  if (!rowBool(state.open)) return notAvailable();
  const run = await referentBatch(executor, [
    toStatement(ucSql`INSERT INTO use_case_need_answers (workspace_id, use_case_id, need_id, request_id, source, body, dont_know, status)
SELECT n.workspace_id, l.use_case_id, n.id, r.id, 'referente', ${cast(text, "text")}, ${cast(dontKnow, "boolean")}, 'bozza'
FROM use_case_referent_request_items i
JOIN use_case_referent_requests r ON r.id = i.request_id
JOIN use_case_needs n ON n.id = i.need_id AND n.workspace_id = r.workspace_id
JOIN use_case_need_links l ON l.need_id = n.id AND l.use_case_id = r.use_case_id
WHERE i.request_id = ${req} AND i.need_id = ${need} AND r.workspace_id = ${cast(link.workspaceId, "uuid")} AND r.status = 'inviata' AND r.expires_at > now()
  AND i.state = 'aperta' AND n.status = 'chiesta' AND n.archived_at IS NULL AND n.type = 'requisito'
ON CONFLICT (request_id, need_id) WHERE request_id IS NOT NULL DO UPDATE SET body = EXCLUDED.body, dont_know = EXCLUDED.dont_know, updated_at = now()
  WHERE use_case_need_answers.status = 'bozza'
RETURNING updated_at`),
  ]);
  if (!run.ok) return pfail(run.error, run.message);
  const savedAt = rowDate(run.rows[0]?.[0]?.updated_at);
  if (!savedAt) return pfail("gia_inviata");
  return { ok: true, value: { savedAt: savedAt.toISOString(), warnings } };
}

interface Target {
  needId: string;
  dontKnow: boolean;
  hasDraft: boolean;
  documents: number;
}

/** L'invio delle risposte (§3.8): tutto in un batch, oppure niente. */
export async function submitReferentAnswers(link: ReferentLink, body: unknown, now: Date): Promise<PublicOutcome<SubmitResult>> {
  if (!link.privacyAccepted) return pfail("informativa_da_leggere");
  if (!writable(link, now)) return notAvailable();
  const rawIds = field(body, "needIds");
  let wanted: string[] | null = null;
  if (rawIds !== undefined && rawIds !== null) {
    if (!Array.isArray(rawIds) || rawIds.length === 0 || rawIds.length > REFERENT_LIMITS.questionsPerRequest || !rawIds.every(isUuid)) return pfail("dati_non_validi", "Dati non validi.");
    wanted = [...new Set(rawIds.map((x) => (x as string).toLowerCase()))];
  }
  const executor = await getAppUcExecutor();
  const facts = await readRequestFacts(executor, link);
  if (!facts || facts.status !== "inviata") return notAvailable();
  if (!privacyAccepted(facts)) return pfail("informativa_da_leggere");

  const openIds = new Set(facts.items.filter((i) => i.open).map((i) => i.needId));
  const pending = (needId: string) => facts.files.filter((f) => f.needId === needId && !f.submitted && liveFile(f, now));
  const usable = (needId: string) => pending(needId).filter((f) => f.scanStatus === "pulito" || f.scanStatus === "in_revisione");
  const draftOf = (needId: string) => facts.answers.find((a) => a.needId === needId && a.status === "bozza") ?? null;

  let candidates: string[];
  if (wanted) {
    if (wanted.some((id) => !openIds.has(id))) return notAvailable();
    candidates = wanted;
  } else {
    candidates = facts.items.filter((i) => i.open && (draftOf(i.needId) !== null || usable(i.needId).length > 0)).map((i) => i.needId);
  }

  const issues: Issue[] = [];
  const ready: Target[] = [];
  for (const needId of candidates) {
    const draft = draftOf(needId);
    const files = usable(needId);
    const dontKnow = draft?.dontKnow === true;
    const text = draft?.body?.trim() ? draft.body : null;
    if (dontKnow && files.length > 0) return pfail("non_so_con_file");
    if (!dontKnow && !text && files.length === 0) {
      if (wanted) return pfail("risposta_vuota", MSG.risposta_vuota_pubblica);
      continue;
    }
    if (pending(needId).some((f) => f.scanStatus === "in_quarantena")) return pfail("file_in_controllo");
    if (files.some((f) => f.personalWarning && !f.warningConfirmed)) return pfail("file_da_confermare");
    if (text) {
      const check = checkSubmitText(text, needId);
      if (!check.ok) issues.push(...check.issues);
    }
    ready.push({ needId, dontKnow, hasDraft: draft !== null, documents: files.filter((f) => f.scanStatus === "pulito").length });
  }
  if (issues.length > 0) return pfail("risposte_da_correggere", undefined, issues);
  if (ready.length === 0) return pfail("nessuna_risposta");

  // (Parte 3) Chi risponde, se è anche una persona di Unbundle: non riceve la notifica né l'avviso di
  // quello che ha fatto lui. Si rilegge adesso (ruolo e account di questo momento); la Storia resta «Referente».
  const actorUserId = (await readReferentPerson(executor, link.workspaceId, link.contactId)).userId;
  const ws = cast(link.workspaceId, "uuid");
  const req = cast(link.requestId, "uuid");
  const all = ready.map((t) => t.needId);
  const unknownIds = ready.filter((t) => t.dontKnow).map((t) => t.needId);
  const answerIds = ready.filter((t) => !t.dontKnow).map((t) => t.needId);
  const drafted = ready.filter((t) => t.hasDraft).map((t) => t.needId);
  const fileOnly = ready.filter((t) => !t.hasDraft).map((t) => t.needId);
  const answers = answerIds.length;
  const unknowns = unknownIds.length;
  const documents = ready.reduce((n, t) => n + t.documents, 0);
  const completedFilter = ucSql`r.id = ${req} AND r.workspace_id = ${ws} AND r.status = 'completata' AND r.completed_at = now()`;

  const statements: UcStatement[] = [];
  if (drafted.length) {
    statements.push(
      toStatement(ucSql`WITH upd AS (
  UPDATE use_case_need_answers SET status = 'inviata', submitted_at = now(), updated_at = now()
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
  if (answerIds.length) statements.push(needTransitionSql({ workspaceId: link.workspaceId, needIds: answerIds, from: ["chiesta"], to: "in_verifica", actor: REFERENT_ACTOR }));
  if (unknownIds.length) statements.push(needTransitionSql({ workspaceId: link.workspaceId, needIds: unknownIds, from: ["chiesta"], to: "mancante", actor: REFERENT_ACTOR }));
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
    ...infoCompleteSyncStatements({ workspaceId: link.workspaceId, useCaseIds: [link.useCaseId], actorUserId }),
    toStatement(ucSql`SELECT r.status, ${openItemsCountSql("r")} AS open_items FROM use_case_referent_requests r WHERE r.id = ${req} AND r.workspace_id = ${ws}`),
  );
  const run = await referentBatch(executor, statements);
  if (!run.ok) {
    if (run.error === "conflitto" || run.error === "domanda_non_disponibile") return notAvailable();
    return pfail(run.error, run.message);
  }
  const last = run.rows[run.rows.length - 1]?.[0];
  const open = rowNumber(last?.open_items) ?? 0;
  return { ok: true, value: { submitted: ready.length, open, state: rowString(last?.status) === "completata" || open === 0 ? "completata" : "aperta" } };
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
});
