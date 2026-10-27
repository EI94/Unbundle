import "server-only";
import { randomUUID } from "node:crypto";
import { getAppUcExecutor, type UcExecutor, type UcRow } from "@/lib/db/uc-executor";
import {
  guardedReferent,
  isUuid,
  logReferentError,
  readRequestReferentPerson,
  referentBatch,
  referentWriter,
  rfail,
  type Env,
  type ReferentFailure,
  type ReferentLink,
} from "@/lib/db/queries/use-case-referent-base";
import { inspectFile } from "@/lib/uc/files/inspect";
import { UC_ALLOWED_UPLOAD_MIME_TYPES } from "@/lib/uc/files/sniff";
import { servedMime, textForScan, UPLOAD_MESSAGES } from "@/lib/uc/files/upload";
import { rowBool, rowDate, rowJson, rowNumber, rowString } from "@/lib/uc/sql/readiness";
import { cast, jsonb, raw, requireRows, toStatement, ucSql, type SqlFragment, type UcStatement } from "@/lib/uc/sql/statement";
import { clientUploadAvailable, clientUploadToken, ucStore, type UcObjectStore } from "@/lib/uc/storage";
import { scanText } from "@/lib/uc/text/scan";
import { fail, ok, type Result } from "@/lib/uc/types";
import { abilitiesForUseCase, type UseCaseViewer } from "@/lib/use-cases/permissions";
import { alertSchedule } from "@/lib/use-cases/referent/alerts";
import { REFERENT_LIMITS, type ReferentClientTicket, type ReferentUploadResult } from "@/lib/use-cases/referent/contract";
import {
  PENDING_QUARANTINE_MS,
  REVIEW_TTL_MS,
  isReferentBlobPath,
  isReferentQuarantinePath,
  referentBlobPath,
  referentFileDecision,
  referentUploadCheck,
} from "@/lib/use-cases/referent/files";
import { REFERENT_ERROR_MESSAGES, REFERENT_PUBLIC_TEXT } from "@/lib/use-cases/referent/labels";
import { completeHandledRequestsStatements, infoCompleteSyncStatements, lockRequestsOfNeedSql, needTransitionSql, notifyReviewersSql, queueRequesterAlertSql, referentEventSql, type ReferentActor } from "@/lib/use-cases/referent/sql";
import type { ServiceResult, WriteContext } from "@/lib/use-cases/service";

/**
 * I file di «Chiedi al referente» (SPEC §2.3 `use-case-referent-files.ts`, §3.8, §3.9): la stessa
 * catena dei dossier (richiesta, tipo dal contenuto, controllo del testo, archivio privato) per i due
 * lati, il referente dal link e il team dalla scheda, più il download per i revisori.
 *
 * - **Riga prima dei byte**: la riga nasce in quarantena, legata a workspace, use case ed esigenza
 *   presi dal database (join esigenza/legame), alla richiesta (referente) o a chi carica (team).
 * - **Esiti**: pulito → `uc/s/<ws>/<uc>/<id>`; PDF con poco testo → `in_revisione`, spostato subito
 *   in `uc/s/` (la quarantena non durerebbe 7 giorni) e scaricabile solo da Lateral Space finché non
 *   lo accetta un'altra persona; rifiutato → nessun oggetto, solo il codice del motivo.
 * - **Nomi, email o telefoni** nel file: un avviso (`personal_warning`); il referente lo conferma.
 * - **Effetti** di un file del team pulito (o in revisione): l'esigenza passa a «Da verificare» (o
 *   «A posto» con «L'ho già verificata» e un file pulito), la Storia, e per un file pulito i
 *   «Nuovi documenti» ai revisori e l'avviso a chi ha chiesto; tutto nello stesso batch.
 * - **Download**: un 404 identico per ogni rifiuto; mai un file di un altro workspace o scheda.
 */

type Uploader = { kind: "referente"; link: ReferentLink } | { kind: "revisore"; userId: string; validate: boolean };

interface FileRow {
  id: string;
  workspaceId: string;
  useCaseId: string;
  needId: string;
  requestId: string | null;
  source: "referente" | "revisore";
  uploadedByUserId: string | null;
  fileName: string;
  maxBytes: number;
  scanStatus: string;
  quarantinePath: string | null;
  blobPath: string | null;
  sha256: string | null;
  createdAt: Date;
  personalWarning: boolean;
  warningConfirmed: boolean;
  submitted: boolean;
  deleted: boolean;
}

function fileRowOf(r: UcRow | undefined): FileRow | null {
  if (!r || !r.id) return null;
  const createdAt = rowDate(r.created_at);
  if (!createdAt) return null;
  return {
    id: String(r.id).toLowerCase(),
    workspaceId: String(r.workspace_id).toLowerCase(),
    useCaseId: String(r.use_case_id).toLowerCase(),
    needId: String(r.need_id).toLowerCase(),
    requestId: rowString(r.request_id)?.toLowerCase() ?? null,
    source: rowString(r.source) === "revisore" ? "revisore" : "referente",
    uploadedByUserId: rowString(r.uploaded_by_user_id)?.toLowerCase() ?? null,
    fileName: rowString(r.file_name) ?? "file",
    maxBytes: rowNumber(r.max_bytes) ?? REFERENT_LIMITS.serverMaxBytes,
    scanStatus: rowString(r.scan_status) ?? "in_quarantena",
    quarantinePath: rowString(r.quarantine_path),
    blobPath: rowString(r.blob_path),
    sha256: rowString(r.sha256),
    createdAt,
    personalWarning: rowBool(r.personal_warning),
    warningConfirmed: rowDate(r.warning_confirmed_at) !== null,
    submitted: rowDate(r.submitted_at) !== null,
    deleted: rowDate(r.deleted_at) !== null,
  };
}

async function loadFile(executor: UcExecutor, workspaceId: string, fileId: string): Promise<FileRow | null> {
  if (!isUuid(fileId)) return null;
  const [[row]] = await executor.batch([
    toStatement(ucSql`SELECT id, workspace_id, use_case_id, need_id, request_id, source, uploaded_by_user_id, file_name, max_bytes, scan_status, quarantine_path, blob_path,
  sha256, created_at, personal_warning, warning_confirmed_at, submitted_at, deleted_at
FROM use_case_need_files WHERE id = ${cast(fileId, "uuid")} AND workspace_id = ${cast(workspaceId, "uuid")}`),
  ]);
  return fileRowOf(row);
}

function storeOf(env: Env): UcObjectStore | null {
  return ucStore("standard", env);
}

async function safeDelete(store: UcObjectStore | null, paths: readonly (string | null)[]): Promise<boolean> {
  const list = paths.filter((p): p is string => typeof p === "string" && p.length > 0);
  if (!store || list.length === 0) return list.length === 0;
  try {
    await store.delete(list);
    return true;
  } catch (error) {
    logReferentError("archivio_cancellazione", error);
    return false;
  }
}

const MESSAGES: Readonly<Record<string, string>> = {
  ...UPLOAD_MESSAGES,
  ...REFERENT_ERROR_MESSAGES,
  conflitto: "Il file è stato appena controllato da un'altra richiesta. Aggiorna la pagina.",
  caricamento_non_trovato: REFERENT_ERROR_MESSAGES.file_non_trovato,
  oggetto_mancante: "Il file non è arrivato. Riprova a caricarlo.",
};

function failCode<T>(code: string, message?: string): Result<T> {
  return fail(code, message ?? MESSAGES[code] ?? REFERENT_ERROR_MESSAGES.riprova);
}

/** I file che contano per il limite di 5 per domanda: non cancellati, non rifiutati, non quarantene abbandonate. */
function liveFilesCountSql(where: SqlFragment): SqlFragment {
  return ucSql`(SELECT count(*)::int FROM use_case_need_files f
  WHERE ${where} AND f.deleted_at IS NULL AND f.scan_status <> 'rifiutato'
    AND NOT (f.scan_status = 'in_quarantena' AND f.created_at <= now() - make_interval(secs => ${cast(PENDING_QUARANTINE_MS / 1000, "int")})))`;
}

/** La domanda (richiesta, esigenza) è aperta per il referente del link. */
function openItemForLinkSql(link: ReferentLink, needId: string): SqlFragment {
  return ucSql`EXISTS (SELECT 1 FROM use_case_referent_request_items i
  JOIN use_case_referent_requests r ON r.id = i.request_id AND r.workspace_id = i.workspace_id
  JOIN use_case_needs n ON n.id = i.need_id AND n.workspace_id = r.workspace_id
  JOIN use_case_need_links l ON l.need_id = n.id AND l.use_case_id = r.use_case_id
  WHERE i.request_id = ${cast(link.requestId, "uuid")} AND i.need_id = ${cast(needId, "uuid")} AND r.workspace_id = ${cast(link.workspaceId, "uuid")}
    AND r.status = 'inviata' AND r.expires_at > now() AND i.state = 'aperta' AND n.status = 'chiesta' AND n.archived_at IS NULL)`;
}

/** La riga in quarantena, con gli id dal database. Fallisce con `domanda_non_disponibile` o `troppi_file`. */
function quarantineInsertSql(i: {
  fileId: string;
  workspaceId: string;
  useCaseId: string;
  needId: string;
  uploader: Uploader;
  fileName: string;
  kind: string;
  maxBytes: number;
  mode: "server" | "client";
  quarantinePath: string | null;
}): UcStatement[] {
  const ws = cast(i.workspaceId, "uuid");
  const need = cast(i.needId, "uuid");
  const uc = cast(i.useCaseId, "uuid");
  const referent = i.uploader.kind === "referente";
  const request = referent ? cast((i.uploader as { link: ReferentLink }).link.requestId, "uuid") : cast(null, "uuid");
  const uploader = referent ? cast(null, "uuid") : cast((i.uploader as { userId: string }).userId, "uuid");
  const scope = referent
    ? ucSql`f.request_id = ${request} AND f.need_id = ${need}`
    : ucSql`f.use_case_id = ${uc} AND f.need_id = ${need} AND f.source = 'revisore' AND f.workspace_id = ${ws}`;
  const open = referent ? ucSql` AND ${openItemForLinkSql((i.uploader as { link: ReferentLink }).link, i.needId)}` : raw("");
  // Un caricamento alla volta per domanda (richiesta del referente, oppure team su use case + esigenza):
  // due file in parallelo non contano entrambi «meno di 5». Il lock dura fino alla fine della transazione.
  const lockKey = referent
    ? ucSql`${cast(i.needId, "text")} || ':' || ${cast((i.uploader as { link: ReferentLink }).link.requestId, "text")}`
    : ucSql`${cast(i.needId, "text")} || ':team:' || ${cast(i.useCaseId, "text")}`;
  return [
    toStatement(ucSql`SELECT pg_advisory_xact_lock(hashtext('use_case_need_files'), hashtext(${lockKey})) IS NULL AS locked`),
    toStatement(ucSql`SELECT uc_require(${liveFilesCountSql(scope)} < ${cast(REFERENT_LIMITS.filesPerQuestion, "int")}, 'troppi_file') AS ok`),
    toStatement(
      requireRows(
        ucSql`INSERT INTO use_case_need_files (id, workspace_id, use_case_id, need_id, request_id, source, uploaded_by_user_id, file_name, kind, max_bytes, upload_mode, quarantine_path)
SELECT ${cast(i.fileId, "uuid")}, n.workspace_id, l.use_case_id, n.id, ${request}, ${cast(i.uploader.kind, "text")}, ${uploader}, ${cast(i.fileName.slice(0, 255), "text")},
  ${cast(i.kind, "text")}, ${cast(i.maxBytes, "int")}, ${cast(i.mode, "text")}, ${cast(i.quarantinePath, "text")}
FROM use_case_needs n JOIN use_case_need_links l ON l.need_id = n.id
WHERE n.id = ${need} AND n.workspace_id = ${ws} AND l.use_case_id = ${uc} AND n.archived_at IS NULL AND n.type = 'requisito'${open}
RETURNING id`,
        1,
        "domanda_non_disponibile",
      ),
    ),
  ];
}

function resultOf(f: FileRow, status: ReferentUploadResult["status"], extra: { sizeBytes: number | null; message: string | null; personalWarning: boolean }): ReferentUploadResult {
  const warning = extra.personalWarning ? REFERENT_PUBLIC_TEXT.fileWarning : null;
  return {
    fileId: f.id,
    fileName: f.fileName,
    sizeBytes: extra.sizeBytes,
    status,
    usable: status !== "rifiutato",
    message: extra.message,
    warning,
    needsConfirmation: f.source === "referente" && extra.personalWarning && status !== "rifiutato",
  };
}

/** Gli effetti di un file del team nello stesso batch dell'esito (§3.9, §P2.6.2). */
function reviewerEffects(f: FileRow, outcome: "pulito" | "in_revisione", validate: boolean): UcStatement[] {
  const userId = f.uploadedByUserId;
  if (!userId) return [];
  const actor: ReferentActor = { kind: "persona", userId };
  const out: UcStatement[] = [
    // Prima le richieste vive su questa esigenza, come revoca e scadenza (stesso ordine dei lock).
    lockRequestsOfNeedSql(f.workspaceId, f.needId),
    validate && outcome === "pulito"
      ? needTransitionSql({ workspaceId: f.workspaceId, needIds: [f.needId], from: ["da_chiedere", "chiesta", "mancante", "parziale", "in_verifica"], to: "validata", actor })
      : needTransitionSql({ workspaceId: f.workspaceId, needIds: [f.needId], from: ["da_chiedere", "chiesta", "mancante", "parziale"], to: "in_verifica", actor }),
    referentEventSql({ workspaceId: f.workspaceId, useCaseId: f.useCaseId, code: "file_team", actor }),
    // (Parte 3) La domanda del referente su questa esigenza è fatta: se non resta altro, la richiesta si completa.
    ...completeHandledRequestsStatements({ workspaceId: f.workspaceId, needId: f.needId }),
  ];
  if (outcome === "pulito") {
    const now = new Date();
    out.push(
      notifyReviewersSql({ workspaceId: f.workspaceId, useCaseId: f.useCaseId, kind: "documenti", documents: 1, actorUserId: userId }),
      queueRequesterAlertSql({
        workspaceId: f.workspaceId,
        target: { useCaseId: f.useCaseId, needId: f.needId },
        answers: 0,
        unknowns: 0,
        documents: 1,
        followUp: null,
        actorUserId: userId,
        immediate: false,
        schedule: alertSchedule(now),
        now,
      }),
    );
  }
  out.push(...infoCompleteSyncStatements({ workspaceId: f.workspaceId, useCaseIds: [f.useCaseId], needId: f.needId, actorUserId: userId }));
  return out;
}

/**
 * Il controllo di un file in quarantena (§2.3): i byte arrivati (modalità server) o l'oggetto della
 * quarantena (caricamento diretto), poi l'esito con CAS sulla riga. Un rifiuto è un esito, non un errore.
 */
export async function processReferentFile(i: { fileId: string; bytes?: Uint8Array; validate?: boolean; workspaceId?: string }, env: Env): Promise<Result<ReferentUploadResult>> {
  const executor = await getAppUcExecutor();
  const workspaceId = i.workspaceId;
  const f = workspaceId ? await loadFile(executor, workspaceId, i.fileId) : await loadFileAnyWorkspace(executor, i.fileId);
  if (!f || f.deleted || f.scanStatus !== "in_quarantena" || f.sha256 !== null) return failCode("file_non_trovato");
  const store = storeOf(env);
  if (!store) return failCode("archivio_non_configurato");
  const id = cast(f.id, "uuid");

  const reject = async (reason: string, message: string, extra: { mime?: string | null; size?: number | null; sha?: string | null; findings?: Record<string, unknown> } = {}): Promise<Result<ReferentUploadResult>> => {
    await safeDelete(store, [f.quarantinePath]);
    const run = await referentBatch(executor, [
      toStatement(ucSql`UPDATE use_case_need_files SET scan_status = 'rifiutato', rejection_reason = ${cast(reason.slice(0, 40), "text")}, mime = ${cast(extra.mime ?? null, "text")},
  size_bytes = ${cast(extra.size && extra.size > 0 ? extra.size : null, "int")}, sha256 = ${cast(extra.sha ?? null, "text")}, findings = ${jsonb(extra.findings ?? { codice: reason })},
  quarantine_path = NULL, checked_at = now()
WHERE id = ${id} AND scan_status = 'in_quarantena' AND deleted_at IS NULL`),
    ]);
    if (!run.ok) return failCode(run.error);
    return ok(resultOf(f, "rifiutato", { sizeBytes: extra.size ?? null, message, personalWarning: false }));
  };

  let bytes = i.bytes ?? null;
  if (!bytes) {
    if (!f.quarantinePath || !isReferentQuarantinePath(f.quarantinePath, f.workspaceId, f.useCaseId)) return failCode("file_non_trovato");
    const info = await store.head(f.quarantinePath);
    if (!info) return failCode("oggetto_mancante");
    if (info.size > f.maxBytes) return reject("file_troppo_grande", UPLOAD_MESSAGES.file_troppo_grande);
    bytes = await store.read(f.quarantinePath, f.maxBytes);
    if (!bytes) return failCode("oggetto_mancante");
  }
  if (bytes.byteLength > f.maxBytes) return reject("file_troppo_grande", UPLOAD_MESSAGES.file_troppo_grande);

  const report = inspectFile(bytes, f.fileName, { zone: "standard", a8Resolved: false, maxBytes: f.maxBytes });
  const scan = report.extractedText ? scanText(textForScan(report.extractedText), { context: "commento" }) : null;
  const outcome = referentFileDecision(report, scan);
  if (outcome.status === "rifiutato") {
    return reject(outcome.reason ?? "rifiutato", outcome.message ?? "Il file non è stato accettato.", {
      mime: report.mime,
      size: report.sizeBytes,
      sha: report.sha256,
      findings: outcome.findings as Record<string, unknown>,
    });
  }
  const mime = report.mime ?? "application/octet-stream";
  const finalPath = referentBlobPath("standard", f.workspaceId, f.useCaseId, f.id);
  await store.put(finalPath, bytes, { contentType: mime });
  const effects = f.source === "revisore" ? reviewerEffects(f, outcome.status, i.validate === true) : [];
  const update = toStatement(
    requireRows(
      ucSql`UPDATE use_case_need_files SET scan_status = ${cast(outcome.status, "text")}, mime = ${cast(mime, "text")}, size_bytes = ${cast(report.sizeBytes > 0 ? report.sizeBytes : null, "int")},
  sha256 = ${cast(report.sha256, "text")}, findings = ${jsonb(outcome.findings)}, personal_warning = ${cast(outcome.personalWarning, "boolean")},
  blob_path = ${cast(finalPath, "text")}, quarantine_path = NULL, checked_at = now()
WHERE id = ${id} AND scan_status = 'in_quarantena' AND deleted_at IS NULL AND sha256 IS NULL
RETURNING id`,
      1,
      "conflitto",
    ),
  );
  const run = await referentBatch(executor, [update, ...effects]);
  if (!run.ok) {
    const current = await loadFile(executor, f.workspaceId, f.id);
    if (!current || current.blobPath !== finalPath) await safeDelete(store, [finalPath]);
    return failCode(run.error);
  }
  await safeDelete(store, [f.quarantinePath]);
  return ok(resultOf(f, outcome.status, { sizeBytes: report.sizeBytes > 0 ? report.sizeBytes : null, message: outcome.message, personalWarning: outcome.personalWarning }));
}

async function loadFileAnyWorkspace(executor: UcExecutor, fileId: string): Promise<FileRow | null> {
  if (!isUuid(fileId)) return null;
  const [[row]] = await executor.batch([
    toStatement(ucSql`SELECT id, workspace_id, use_case_id, need_id, request_id, source, uploaded_by_user_id, file_name, max_bytes, scan_status, quarantine_path, blob_path,
  sha256, created_at, personal_warning, warning_confirmed_at, submitted_at, deleted_at
FROM use_case_need_files WHERE id = ${cast(fileId, "uuid")}`),
  ]);
  return fileRowOf(row);
}

// ─── Caricamenti del referente (dal link) ───────────────────────────

function needFromBody(body: unknown, key = "needId"): string | null {
  const v = body && typeof body === "object" ? (body as Record<string, unknown>)[key] : null;
  return isUuid(v) ? v.toLowerCase() : null;
}

/** Il link scrive? Informativa letta per la versione di adesso, richiesta viva. */
function linkWritable(link: ReferentLink): Result<void> {
  if (link.status !== "inviata") return failCode("domanda_non_disponibile", REFERENT_ERROR_MESSAGES.domanda_non_disponibile_pubblica);
  if (!link.privacyAccepted) return failCode("informativa_da_leggere");
  return ok(undefined);
}

/** Modalità server dal link: la riga in quarantena e il controllo dei byte arrivati. */
export async function referentUploadServer(link: ReferentLink, input: { needId: string; fileName: string; declaration: boolean; bytes: Uint8Array }, env: Env): Promise<Result<ReferentUploadResult>> {
  const writable = linkWritable(link);
  if (!writable.ok) return writable;
  if (!isUuid(input.needId)) return failCode("domanda_non_disponibile", REFERENT_ERROR_MESSAGES.domanda_non_disponibile_pubblica);
  const request = referentUploadCheck({ fileName: input.fileName, size: input.bytes.byteLength, declaration: input.declaration, mode: "server" });
  if (!request.ok) return request;
  if (!storeOf(env)) return failCode("archivio_non_configurato");
  const fileId = randomUUID();
  const executor = await getAppUcExecutor();
  const run = await referentBatch(
    executor,
    quarantineInsertSql({ fileId, workspaceId: link.workspaceId, useCaseId: link.useCaseId, needId: input.needId, uploader: { kind: "referente", link }, fileName: request.value.fileName, kind: request.value.kind, maxBytes: request.value.maxBytes, mode: "server", quarantinePath: null }),
  );
  if (!run.ok) return failCode(run.error, run.error === "domanda_non_disponibile" ? REFERENT_ERROR_MESSAGES.domanda_non_disponibile_pubblica : undefined);
  return processReferentFile({ fileId, bytes: input.bytes, workspaceId: link.workspaceId }, env);
}

/** Caricamento diretto dal link: la riga in quarantena e un token per quel solo percorso. */
export async function referentBeginClient(link: ReferentLink, body: unknown, env: Env): Promise<Result<ReferentClientTicket>> {
  const writable = linkWritable(link);
  if (!writable.ok) return writable;
  if (!clientUploadAvailable(env)) return failCode("modalita_non_disponibile");
  const needId = needFromBody(body);
  if (!needId) return failCode("domanda_non_disponibile", REFERENT_ERROR_MESSAGES.domanda_non_disponibile_pubblica);
  const b = body as Record<string, unknown>;
  const request = referentUploadCheck({ fileName: b.fileName, size: b.size, declaration: b.declaration, mode: "client" });
  if (!request.ok) return request;
  const fileId = randomUUID();
  const pathname = referentBlobPath("quarantena", link.workspaceId, link.useCaseId, fileId);
  const executor = await getAppUcExecutor();
  const run = await referentBatch(
    executor,
    quarantineInsertSql({ fileId, workspaceId: link.workspaceId, useCaseId: link.useCaseId, needId, uploader: { kind: "referente", link }, fileName: request.value.fileName, kind: request.value.kind, maxBytes: request.value.maxBytes, mode: "client", quarantinePath: pathname }),
  );
  if (!run.ok) return failCode(run.error, run.error === "domanda_non_disponibile" ? REFERENT_ERROR_MESSAGES.domanda_non_disponibile_pubblica : undefined);
  const clientToken = await clientUploadToken(env, { pathname, maxBytes: request.value.maxBytes, allowedContentTypes: UC_ALLOWED_UPLOAD_MIME_TYPES });
  return ok({ fileId, pathname, clientToken, contentType: request.value.mime });
}

/** Fine del caricamento diretto dal link: solo un file di questa richiesta, del referente, in quarantena da meno di un'ora, su una domanda aperta. */
export async function referentCompleteClient(link: ReferentLink, body: unknown, env: Env): Promise<Result<ReferentUploadResult>> {
  const writable = linkWritable(link);
  if (!writable.ok) return writable;
  const fileId = needFromBody(body, "fileId");
  if (!fileId) return failCode("file_non_trovato");
  const executor = await getAppUcExecutor();
  const f = await loadFile(executor, link.workspaceId, fileId);
  if (!f || f.requestId !== link.requestId || f.source !== "referente" || f.scanStatus !== "in_quarantena" || f.deleted || Date.now() - f.createdAt.getTime() > PENDING_QUARANTINE_MS) {
    return failCode("file_non_trovato");
  }
  const [[open]] = await executor.batch([toStatement(ucSql`SELECT ${openItemForLinkSql(link, f.needId)} AS ok`)]);
  if (!rowBool(open?.ok)) return failCode("file_non_trovato");
  return processReferentFile({ fileId: f.id, workspaceId: link.workspaceId }, env);
}

// ─── Caricamenti del team (dalla scheda) ────────────────────────────

/** Le esigenze che accettano un file del team: requisito, non archiviato, collegato alla scheda. */
async function reviewerTarget(ctx: WriteContext, useCaseId: string, env: Env): Promise<{ ok: true; userId: string } | ReferentFailure> {
  const writer = await referentWriter(ctx, env);
  if (!writer.ok) return writer;
  if (!isUuid(useCaseId)) return rfail("non_trovato");
  return writer;
}

function fromFailure<T>(f: ReferentFailure): Result<T> {
  return fail(f.error, f.message);
}

/** Modalità server dalla scheda: «Allega un file» del team. */
export async function uploadReviewerFileServer(
  ctx: WriteContext,
  useCaseId: string,
  input: { needId: string; fileName: string; declaration: boolean; bytes: Uint8Array; validate?: boolean },
  env: Env,
): Promise<Result<ReferentUploadResult>> {
  try {
    const writer = await reviewerTarget(ctx, useCaseId, env);
    if (!writer.ok) return fromFailure(writer);
    if (!isUuid(input.needId)) return failCode("domanda_non_disponibile");
    const request = referentUploadCheck({ fileName: input.fileName, size: input.bytes.byteLength, declaration: input.declaration, mode: "server" });
    if (!request.ok) return request;
    if (!storeOf(env)) return failCode("archivio_non_configurato");
    const fileId = randomUUID();
    const executor = await getAppUcExecutor();
    const run = await referentBatch(
      executor,
      quarantineInsertSql({ fileId, workspaceId: ctx.workspaceId, useCaseId, needId: input.needId, uploader: { kind: "revisore", userId: writer.userId, validate: input.validate === true }, fileName: request.value.fileName, kind: request.value.kind, maxBytes: request.value.maxBytes, mode: "server", quarantinePath: null }),
    );
    if (!run.ok) return failCode(run.error);
    return await processReferentFile({ fileId, bytes: input.bytes, validate: input.validate === true, workspaceId: ctx.workspaceId }, env);
  } catch (error) {
    logReferentError("file_del_team", error, { workspaceId: ctx.workspaceId });
    return failCode("riprova");
  }
}

/** Caricamento diretto dalla scheda: la riga in quarantena e un token per quel solo percorso. */
export async function beginReviewerClientUpload(ctx: WriteContext, useCaseId: string, body: unknown, env: Env): Promise<Result<ReferentClientTicket>> {
  try {
    const writer = await reviewerTarget(ctx, useCaseId, env);
    if (!writer.ok) return fromFailure(writer);
    if (!clientUploadAvailable(env)) return failCode("modalita_non_disponibile");
    const needId = needFromBody(body);
    if (!needId) return failCode("domanda_non_disponibile");
    const b = body as Record<string, unknown>;
    const request = referentUploadCheck({ fileName: b.fileName, size: b.size, declaration: b.declaration, mode: "client" });
    if (!request.ok) return request;
    const fileId = randomUUID();
    const pathname = referentBlobPath("quarantena", ctx.workspaceId, useCaseId, fileId);
    const executor = await getAppUcExecutor();
    const run = await referentBatch(
      executor,
      quarantineInsertSql({ fileId, workspaceId: ctx.workspaceId, useCaseId, needId, uploader: { kind: "revisore", userId: writer.userId, validate: b.validate === true }, fileName: request.value.fileName, kind: request.value.kind, maxBytes: request.value.maxBytes, mode: "client", quarantinePath: pathname }),
    );
    if (!run.ok) return failCode(run.error);
    const clientToken = await clientUploadToken(env, { pathname, maxBytes: request.value.maxBytes, allowedContentTypes: UC_ALLOWED_UPLOAD_MIME_TYPES });
    return ok({ fileId, pathname, clientToken, contentType: request.value.mime });
  } catch (error) {
    logReferentError("file_del_team_diretto", error, { workspaceId: ctx.workspaceId });
    return failCode("riprova");
  }
}

/** Fine del caricamento diretto dalla scheda: solo un file del team di chi chiama, in quarantena da meno di un'ora. */
export async function completeReviewerClientUpload(ctx: WriteContext, useCaseId: string, body: unknown, env: Env): Promise<Result<ReferentUploadResult>> {
  try {
    const writer = await reviewerTarget(ctx, useCaseId, env);
    if (!writer.ok) return fromFailure(writer);
    const fileId = needFromBody(body, "fileId");
    if (!fileId) return failCode("file_non_trovato");
    const executor = await getAppUcExecutor();
    const f = await loadFile(executor, ctx.workspaceId, fileId);
    if (
      !f ||
      f.useCaseId !== useCaseId.toLowerCase() ||
      f.source !== "revisore" ||
      f.uploadedByUserId !== writer.userId.toLowerCase() ||
      f.scanStatus !== "in_quarantena" ||
      f.deleted ||
      Date.now() - f.createdAt.getTime() > PENDING_QUARANTINE_MS
    ) {
      return failCode("file_non_trovato");
    }
    const validate = Boolean(body && typeof body === "object" && (body as Record<string, unknown>).validate === true);
    return await processReferentFile({ fileId: f.id, validate, workspaceId: ctx.workspaceId }, env);
  } catch (error) {
    logReferentError("file_del_team_fine", error, { workspaceId: ctx.workspaceId });
    return failCode("riprova");
  }
}

// ─── Controllo di un PDF con poco testo da parte del team (§3.9) ─────

export const reviewNeedFile = guardedReferent(
  "controllo_file",
  async function reviewNeedFile(ctx: WriteContext, useCaseId: string, fileId: string, outcome: unknown, env: Env): Promise<ServiceResult<{ status: "pulito" | "rifiutato" }> | ReferentFailure> {
    const writer = await referentWriter(ctx, env);
    if (!writer.ok) return writer;
    if (outcome !== "accetta" && outcome !== "rifiuta") return rfail("revisione_non_ammessa");
    if (!isUuid(useCaseId) || !isUuid(fileId)) return rfail("file_non_trovato");
    const executor = await getAppUcExecutor();
    // Chi modifica «Cosa serve» (`referentWriter`), Lateral Space o revisore del cliente: mai chi l'ha caricato.
    const f = await loadFile(executor, ctx.workspaceId, fileId);
    if (!f || f.deleted || f.useCaseId !== useCaseId.toLowerCase() || f.scanStatus !== "in_revisione" || (f.source === "referente" && !f.submitted)) return rfail("file_non_trovato");
    if (f.uploadedByUserId !== null && f.uploadedByUserId === writer.userId.toLowerCase()) return rfail("revisore_uguale");
    const actor: ReferentActor = { kind: "persona", userId: writer.userId };
    const id = cast(f.id, "uuid");
    if (outcome === "accetta") {
      const now = new Date();
      // (Parte 3) Chi ha dato il documento (il referente, se ha un account, o chi l'ha caricato dalla
      // scheda) non riceve la notifica né l'avviso del suo documento accettato.
      const owner = f.source === "referente" && f.requestId ? (await readRequestReferentPerson(executor, f.workspaceId, f.requestId)).userId : f.uploadedByUserId;
      const alsoExceptUserId = owner && owner !== writer.userId.toLowerCase() ? owner : null;
      // Un file del referente l'hanno già annunciato le sue risposte (i revisori lo vedono «Da controllare»
      // dall'arrivo): accettarlo non manda una seconda notifica. Un file del team si annuncia qui.
      const announce = f.source === "revisore";
      const run = await referentBatch(executor, [
        toStatement(
          requireRows(
            ucSql`UPDATE use_case_need_files SET scan_status = 'pulito', reviewed_at = now(), reviewed_by_user_id = ${cast(writer.userId, "uuid")}, checked_at = now()
WHERE id = ${id} AND scan_status = 'in_revisione' AND deleted_at IS NULL RETURNING id`,
            1,
            "conflitto",
          ),
        ),
        referentEventSql({ workspaceId: f.workspaceId, useCaseId: f.useCaseId, code: "file_accettato", actor }),
        ...(announce
          ? [
              notifyReviewersSql({ workspaceId: f.workspaceId, useCaseId: f.useCaseId, kind: "documenti", documents: 1, actorUserId: writer.userId, alsoExceptUserId }),
              queueRequesterAlertSql({
                workspaceId: f.workspaceId,
                target: f.requestId ? { requestId: f.requestId } : { useCaseId: f.useCaseId, needId: f.needId },
                answers: 0,
                unknowns: 0,
                documents: 1,
                followUp: null,
                actorUserId: writer.userId,
                alsoExceptUserId,
                immediate: false,
                schedule: alertSchedule(now),
                now,
              }),
            ]
          : []),
      ]);
      if (!run.ok) return run;
      return { ok: true, value: { status: "pulito" } };
    }
    // Rifiuta: prima l'oggetto, poi la riga senza percorso (un oggetto non si perde mai di vista).
    const store = storeOf(env);
    if (!(await safeDelete(store, [f.blobPath]))) return rfail("riprova");
    const run = await referentBatch(executor, [
      toStatement(
        requireRows(
          ucSql`UPDATE use_case_need_files SET scan_status = 'rifiutato', rejection_reason = 'revisione_rifiutata', blob_path = NULL, reviewed_at = now(), reviewed_by_user_id = ${cast(writer.userId, "uuid")}
WHERE id = ${id} AND scan_status = 'in_revisione' AND deleted_at IS NULL RETURNING id`,
          1,
          "conflitto",
        ),
      ),
      referentEventSql({ workspaceId: f.workspaceId, useCaseId: f.useCaseId, code: "file_rifiutato", actor }),
    ]);
    if (!run.ok) return run;
    return { ok: true, value: { status: "rifiutato" } };
  },
);

// ─── Download per i revisori ─────────────────────────────────────────

/**
 * Il download di un file per un revisore (§2.3): un file pulito della scheda (del team, o del
 * referente dopo l'invio), oppure un PDF in revisione per un revisore che modifica «Cosa serve» e non l'ha
 * caricato. Ogni rifiuto, un contributore compreso, è lo stesso «File non trovato.».
 */
export async function openReviewerFileDownload(
  i: { workspaceId: string; useCaseId: string; fileId: string; viewer: UseCaseViewer; userId: string },
  env: Env,
): Promise<Result<{ body: ReadableStream<Uint8Array>; size: number | null; mime: string; fileName: string }>> {
  const notFound = failCode<{ body: ReadableStream<Uint8Array>; size: number | null; mime: string; fileName: string }>("file_non_trovato");
  const abilities = abilitiesForUseCase(i.viewer);
  if (!abilities.canSeeNeeds || !isUuid(i.workspaceId) || !isUuid(i.useCaseId) || !isUuid(i.fileId) || !isUuid(i.userId)) return notFound;
  // I PDF da controllare li apre chi li controlla: un revisore che modifica «Cosa serve» e non li ha caricati.
  const teamReviewer = abilities.canEditNeeds;
  const executor = await getAppUcExecutor();
  const [[row]] = await executor.batch([
    toStatement(ucSql`SELECT f.id, f.blob_path, f.mime, f.file_name, f.size_bytes
FROM use_case_need_files f
WHERE f.id = ${cast(i.fileId, "uuid")} AND f.workspace_id = ${cast(i.workspaceId, "uuid")} AND f.use_case_id = ${cast(i.useCaseId, "uuid")}
  AND f.deleted_at IS NULL AND f.blob_path IS NOT NULL
  AND (f.source = 'revisore' OR f.submitted_at IS NOT NULL)
  AND (f.scan_status = 'pulito'
       OR (f.scan_status = 'in_revisione' AND ${cast(teamReviewer, "boolean")} AND f.uploaded_by_user_id IS DISTINCT FROM ${cast(i.userId, "uuid")}))`),
  ]);
  const path = rowString(row?.blob_path);
  if (!row || !path || !isReferentBlobPath(path, i.workspaceId, i.useCaseId)) return notFound;
  const store = storeOf(env);
  if (!store) return notFound;
  const object = await store.stream(path);
  if (!object) return notFound;
  return ok({ body: object.stream, size: object.size ?? rowNumber(row.size_bytes), mime: servedMime(rowString(row.mime)), fileName: rowString(row.file_name) ?? "file" });
}

// ─── Oggetti dell'archivio ───────────────────────────────────────────

/** Cancella gli oggetti dei file indicati, poi toglie i percorsi delle righe di cui ha cancellato l'oggetto. */
export async function deleteFileObjects(rows: readonly { id: string; blobPath: string | null; quarantinePath: string | null }[], env: Env): Promise<number> {
  const valid = rows.filter((r) => isUuid(r.id));
  if (!valid.length) return 0;
  const store = storeOf(env);
  if (!store) return 0;
  let done = 0;
  const executor = await getAppUcExecutor();
  for (const r of valid) {
    const paths = [r.blobPath, r.quarantinePath].filter((p): p is string => typeof p === "string" && /^uc\/[qs]\//.test(p));
    if (!(await safeDelete(store, paths))) continue;
    await executor.batch([
      toStatement(ucSql`UPDATE use_case_need_files SET blob_path = NULL, quarantine_path = NULL WHERE id = ${cast(r.id, "uuid")} AND deleted_at IS NOT NULL`),
    ]);
    done++;
  }
  return done;
}

/** Le righe cancellate che hanno ancora un oggetto nell'archivio (al massimo `limit`). */
export async function collectDeletedFileRows(workspaceId: string | null, limit = 200): Promise<{ id: string; blobPath: string | null; quarantinePath: string | null }[]> {
  const executor = await getAppUcExecutor();
  const ws = workspaceId && isUuid(workspaceId) ? ucSql` AND workspace_id = ${cast(workspaceId, "uuid")}` : raw("");
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT id, blob_path, quarantine_path FROM use_case_need_files
WHERE deleted_at IS NOT NULL AND (blob_path IS NOT NULL OR quarantine_path IS NOT NULL)${ws}
ORDER BY deleted_at, id LIMIT ${cast(Math.max(1, Math.min(500, limit)), "int")}`),
  ]);
  return rows.map((r) => ({ id: String(r.id), blobPath: rowString(r.blob_path), quarantinePath: rowString(r.quarantine_path) }));
}

/** Dopo la risposta: gli oggetti dei file appena segnati come cancellati. */
export async function cleanupDeletedFiles(i: { workspaceId: string | null; limit?: number }, env: Env): Promise<number> {
  return deleteFileObjects(await collectDeletedFileRows(i.workspaceId, i.limit ?? 50), env);
}

/**
 * Cron, passo 6: le quarantene di più di un'ora diventano «rifiutato» (`quarantena_scaduta`) senza
 * oggetto; i PDF in revisione da più di 7 giorni «rifiutato» (`revisione_scaduta`), oggetto cancellato.
 */
export async function cleanupPendingFiles(env: Env, now: Date): Promise<number> {
  const executor = await getAppUcExecutor();
  const store = storeOf(env);
  const [quarantine, review] = await executor.batch([
    toStatement(ucSql`SELECT id, quarantine_path FROM use_case_need_files
WHERE scan_status = 'in_quarantena' AND deleted_at IS NULL AND created_at <= ${cast(new Date(now.getTime() - PENDING_QUARANTINE_MS).toISOString(), "timestamptz")}
ORDER BY created_at, id LIMIT 200`),
    toStatement(ucSql`SELECT id, blob_path FROM use_case_need_files
WHERE scan_status = 'in_revisione' AND deleted_at IS NULL AND created_at <= ${cast(new Date(now.getTime() - REVIEW_TTL_MS).toISOString(), "timestamptz")}
ORDER BY created_at, id LIMIT 200`),
  ]);
  let done = 0;
  for (const r of quarantine) {
    const path = rowString(r.quarantine_path);
    if (path && !(await safeDelete(store, [path]))) continue;
    const [rows] = await executor.batch([
      toStatement(ucSql`UPDATE use_case_need_files SET scan_status = 'rifiutato', rejection_reason = 'quarantena_scaduta', quarantine_path = NULL
WHERE id = ${cast(String(r.id), "uuid")} AND scan_status = 'in_quarantena' RETURNING id`),
    ]);
    done += rows.length;
  }
  for (const r of review) {
    const path = rowString(r.blob_path);
    if (path && !(await safeDelete(store, [path]))) continue;
    const [rows] = await executor.batch([
      toStatement(ucSql`UPDATE use_case_need_files SET scan_status = 'rifiutato', rejection_reason = 'revisione_scaduta', blob_path = NULL
WHERE id = ${cast(String(r.id), "uuid")} AND scan_status = 'in_revisione' RETURNING id`),
    ]);
    done += rows.length;
  }
  return done;
}

void rowJson;
