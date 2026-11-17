import "server-only";
import { randomUUID } from "node:crypto";
import { getAppUcExecutor, type UcExecutor, type UcRow } from "@/lib/db/uc-executor";
import {
  afterResponse,
  guardedReferent,
  isUuid,
  logReferentError,
  referentBatch,
  referentWriter,
  rfail,
  templateFilesStoreReady,
  type Env,
  type ReferentFailure,
  type ReferentLink,
} from "@/lib/db/queries/use-case-referent-base";
import { anotherReviewerExists, failCode, safeDelete, storeOf } from "@/lib/db/queries/use-case-referent-files";
import { UC_ALLOWED_UPLOAD_MIME_TYPES } from "@/lib/uc/files/sniff";
import { attachmentHeader, servedMime, UPLOAD_MESSAGES } from "@/lib/uc/files/upload";
import { rowDate, rowNumber, rowString } from "@/lib/uc/sql/readiness";
import { cast, jsonb, raw, requireRows, toStatement, ucSql, type SqlFragment } from "@/lib/uc/sql/statement";
import { clientUploadAvailable, clientUploadToken } from "@/lib/uc/storage";
import { ok, type Result } from "@/lib/uc/types";
import { abilitiesForUseCase, type UseCaseViewer } from "@/lib/use-cases/permissions";
import type { ReferentClientTicket, ReferentUploadResult } from "@/lib/use-cases/referent/contract";
import { PENDING_QUARANTINE_MS, REVIEW_TTL_MS, checkReferentFile, isReferentBlobPath, isReferentQuarantinePath, referentBlobPath, referentUploadCheck } from "@/lib/use-cases/referent/files";
import { REFERENT_ERROR_MESSAGES } from "@/lib/use-cases/referent/labels";
import {
  templateAcceptedStatements,
  templateCheckedEffects,
  templateFirstDownloadStatement,
  templateInsertStatements,
  templateLockStatement,
  templateRejectedStatements,
  templateRemoveStatements,
  templateTargetOf,
} from "@/lib/use-cases/referent/template-sql";
import type { PublicTemplateRow, TemplateFact } from "@/lib/use-cases/referent/view";
import type { ServiceResult, WriteContext } from "@/lib/use-cases/service";

export { fillInQuestionsSql, requestTemplatesStatement } from "@/lib/use-cases/referent/template-sql";

/**
 * «File da compilare» (RUNBOOK §10.21): il team allega a una o più esigenze di «Cosa serve» un file che il referente
 * scarica dal suo link, compila e ricarica con il caricamento di sempre. I costruttori SQL sono puri, in
 * `referent/template-sql.ts`; qui la catena, i download, le letture e le pulizie.
 *
 * - **Non è una risposta.** Una tabella a parte (`use_case_template_files`, drizzle/0040): nessuna lettura delle
 *   risposte la vede. Nessun effetto da risposta: lo stato dell'esigenza non cambia, niente «Nuovi documenti», niente
 *   avvisi a chi ha chiesto, niente «Informazioni complete». Le sole scritture sono la riga del file, i suoi legami
 *   con le esigenze, il primo download e la Storia (`TEMPLATE_WRITTEN_TABLES`).
 * - **La stessa catena dei file di «Cosa serve»** (`use-case-referent-files.ts`): la riga nasce in quarantena con gli
 *   id dal database, poi il tipo dal contenuto, le intestazioni e il testo (`checkReferentFile`); un PDF con poco testo
 *   resta «in_revisione» finché un'altra persona non lo accetta, e il referente riceve solo un file pulito.
 * - **Un file, N esigenze** dello stesso use case (`use_case_template_links`). «Sostituisci» carica una versione nuova
 *   (`replaces_id`) che prende i legami della vecchia quando è pulita; fino ad allora il referente ha la vecchia.
 *   «Togli» toglie il file da un'esigenza; dall'ultima, il file si cancella.
 * - **Il download del referente** offre solo i file della sua pagina (`templateDownloadDecision`, in
 *   `use-case-referent-public.ts`): ogni altro caso è il 404 del link non valido. Il primo download di ogni versione per
 *   ogni richiesta scrive «scaricato dal referente».
 */

const TEMPLATE_MESSAGES: Readonly<Record<string, string>> = {
  ...UPLOAD_MESSAGES,
  ...REFERENT_ERROR_MESSAGES,
  conflitto: "Il file è stato appena controllato da un'altra richiesta. Aggiorna la pagina.",
};

function templateFail<T>(code: string): Result<T> {
  return failCode<T>(code, TEMPLATE_MESSAGES[code]);
}

interface TemplateRow {
  id: string;
  workspaceId: string;
  useCaseId: string;
  replacesId: string | null;
  uploadedByUserId: string | null;
  fileName: string;
  maxBytes: number;
  scanStatus: string;
  quarantinePath: string | null;
  blobPath: string | null;
  sha256: string | null;
  createdAt: Date;
  deleted: boolean;
}

const TEMPLATE_COLUMNS = raw("id, workspace_id, use_case_id, replaces_id, uploaded_by_user_id, file_name, max_bytes, scan_status, quarantine_path, blob_path, sha256, created_at, deleted_at");

function templateRowOf(r: UcRow | undefined): TemplateRow | null {
  if (!r || !r.id) return null;
  const createdAt = rowDate(r.created_at);
  if (!createdAt) return null;
  return {
    id: String(r.id).toLowerCase(),
    workspaceId: String(r.workspace_id).toLowerCase(),
    useCaseId: String(r.use_case_id).toLowerCase(),
    replacesId: rowString(r.replaces_id)?.toLowerCase() ?? null,
    uploadedByUserId: rowString(r.uploaded_by_user_id)?.toLowerCase() ?? null,
    fileName: rowString(r.file_name) ?? "file",
    maxBytes: rowNumber(r.max_bytes) ?? 0,
    scanStatus: rowString(r.scan_status) ?? "in_quarantena",
    quarantinePath: rowString(r.quarantine_path),
    blobPath: rowString(r.blob_path),
    sha256: rowString(r.sha256),
    createdAt,
    deleted: rowDate(r.deleted_at) !== null,
  };
}

function uuidOf(value: string): SqlFragment {
  if (!isUuid(value)) throw new Error("Id non valido");
  return cast(value.toLowerCase(), "uuid");
}

async function loadTemplate(executor: UcExecutor, workspaceId: string, fileId: string): Promise<TemplateRow | null> {
  if (!isUuid(fileId) || !isUuid(workspaceId)) return null;
  const [[row]] = await executor.batch([
    toStatement(ucSql`SELECT ${TEMPLATE_COLUMNS} FROM use_case_template_files WHERE id = ${uuidOf(fileId)} AND workspace_id = ${uuidOf(workspaceId)}`),
  ]);
  return templateRowOf(row);
}

// ─── Il controllo ────────────────────────────────────────────────────

function resultOf(f: TemplateRow, status: ReferentUploadResult["status"], extra: { sizeBytes: number | null; message: string | null }): ReferentUploadResult {
  return { fileId: f.id, fileName: f.fileName, sizeBytes: extra.sizeBytes, status, usable: status !== "rifiutato", message: extra.message };
}

/**
 * Il controllo di un file da compilare in quarantena: i byte arrivati (modalità server) o l'oggetto della quarantena
 * (caricamento diretto), poi l'esito con CAS sulla riga e i suoi effetti (`templateCheckedEffects`) nello stesso batch.
 * Un rifiuto è un esito, non un errore: la riga resta «rifiutato» senza oggetto e senza legami.
 */
async function processTemplateFile(i: { workspaceId: string; fileId: string; bytes?: Uint8Array }, env: Env): Promise<Result<ReferentUploadResult>> {
  const executor = await getAppUcExecutor();
  const f = await loadTemplate(executor, i.workspaceId, i.fileId);
  if (!f || f.deleted || f.scanStatus !== "in_quarantena" || f.sha256 !== null || !f.uploadedByUserId) return templateFail("file_non_trovato");
  const uploader = f.uploadedByUserId;
  const store = storeOf(env);
  if (!store) return templateFail("archivio_non_configurato");
  const id = uuidOf(f.id);
  const ws = uuidOf(f.workspaceId);

  const reject = async (reason: string, message: string, extra: { mime?: string | null; size?: number | null; sha?: string | null; findings?: Record<string, unknown> } = {}): Promise<Result<ReferentUploadResult>> => {
    await safeDelete(store, [f.quarantinePath]);
    // I legami se ne vanno solo con la riga davvero rifiutata qui (una CTE): mai quelli di un file già controllato.
    const run = await referentBatch(executor, [
      toStatement(ucSql`WITH rejected AS (
  UPDATE use_case_template_files SET scan_status = 'rifiutato', rejection_reason = ${cast(reason.slice(0, 40), "text")}, mime = ${cast(extra.mime ?? null, "text")},
    size_bytes = ${cast(extra.size && extra.size > 0 ? extra.size : null, "int")}, sha256 = ${cast(extra.sha ?? null, "text")}, findings = ${jsonb(extra.findings ?? { codice: reason })},
    quarantine_path = NULL, checked_at = now()
  WHERE id = ${id} AND workspace_id = ${ws} AND scan_status = 'in_quarantena' AND deleted_at IS NULL
  RETURNING id
), unlinked AS (DELETE FROM use_case_template_links WHERE file_id IN (SELECT id FROM rejected) RETURNING file_id)
SELECT count(*)::int AS rejected FROM rejected`),
    ]);
    if (!run.ok) return templateFail(run.error);
    return ok(resultOf(f, "rifiutato", { sizeBytes: extra.size ?? null, message }));
  };

  let bytes = i.bytes ?? null;
  if (!bytes) {
    if (!f.quarantinePath || !isReferentQuarantinePath(f.quarantinePath, f.workspaceId, f.useCaseId)) return templateFail("file_non_trovato");
    const info = await store.head(f.quarantinePath);
    if (!info) return templateFail("oggetto_mancante");
    if (info.size > f.maxBytes) return reject("file_troppo_grande", UPLOAD_MESSAGES.file_troppo_grande);
    bytes = await store.read(f.quarantinePath, f.maxBytes);
    if (!bytes) return templateFail("oggetto_mancante");
  }
  if (bytes.byteLength > f.maxBytes) return reject("file_troppo_grande", UPLOAD_MESSAGES.file_troppo_grande);

  const { report, outcome } = checkReferentFile(bytes, f.fileName, f.maxBytes);
  if (outcome.status === "rifiutato") {
    return reject(outcome.reason ?? "rifiutato", outcome.message ?? "Il file non è stato accettato.", {
      mime: report.mime,
      size: report.sizeBytes,
      sha: report.sha256,
      findings: outcome.findings as Record<string, unknown>,
    });
  }
  // Un PDF da controllare lo controlla un'altra persona: se nel workspace non c'è, non arriverebbe mai al referente.
  if (outcome.status === "in_revisione" && !(await anotherReviewerExists(executor, f.workspaceId, uploader))) {
    return reject("nessun_altro_revisore", REFERENT_ERROR_MESSAGES.nessun_altro_revisore, { mime: report.mime, size: report.sizeBytes, sha: report.sha256 });
  }
  const mime = report.mime ?? "application/octet-stream";
  const finalPath = referentBlobPath("standard", f.workspaceId, f.useCaseId, f.id);
  await store.put(finalPath, bytes, { contentType: mime });
  const update = toStatement(
    requireRows(
      ucSql`UPDATE use_case_template_files SET scan_status = ${cast(outcome.status, "text")}, mime = ${cast(mime, "text")}, size_bytes = ${cast(report.sizeBytes > 0 ? report.sizeBytes : null, "int")},
  sha256 = ${cast(report.sha256, "text")}, findings = ${jsonb(outcome.findings)}, personal_warning = ${cast(outcome.personalWarning, "boolean")},
  blob_path = ${cast(finalPath, "text")}, quarantine_path = NULL, checked_at = now()
WHERE id = ${id} AND workspace_id = ${ws} AND scan_status = 'in_quarantena' AND deleted_at IS NULL AND sha256 IS NULL
RETURNING id`,
      1,
      "conflitto",
    ),
  );
  const effects = templateCheckedEffects({ workspaceId: f.workspaceId, useCaseId: f.useCaseId, fileId: f.id, replacesId: f.replacesId, userId: uploader, outcome: outcome.status });
  // Sotto il lock dello use case, come «Togli»: una sostituzione e un «Togli» insieme non si incrociano.
  let run: Awaited<ReturnType<typeof referentBatch>>;
  try {
    run = await referentBatch(executor, [templateLockStatement(f.useCaseId), update, ...effects]);
  } catch (error) {
    // La transazione è annullata: la riga non punta all'oggetto appena scritto, che non deve restare.
    await safeDelete(store, [finalPath]);
    throw error;
  }
  if (!run.ok) {
    const current = await loadTemplate(executor, f.workspaceId, f.id);
    if (!current || current.blobPath !== finalPath) await safeDelete(store, [finalPath]);
    return templateFail(run.error);
  }
  await safeDelete(store, [f.quarantinePath]);
  if (f.replacesId && outcome.status === "pulito") scheduleTemplateCleanup(f.workspaceId, env);
  return ok(resultOf(f, outcome.status, { sizeBytes: report.sizeBytes > 0 ? report.sizeBytes : null, message: outcome.message }));
}

// ─── Caricamenti del team (dalla scheda) ────────────────────────────

/** Chi carica: chi modifica «Cosa serve», con la 0040 applicata. */
async function templateWriter(ctx: WriteContext, useCaseId: string, env: Env): Promise<{ ok: true; userId: string } | ReferentFailure> {
  const writer = await referentWriter(ctx, env);
  if (!writer.ok) return writer;
  if (!(await templateFilesStoreReady())) return rfail("funzione_spenta");
  if (!isUuid(useCaseId)) return rfail("non_trovato");
  return writer;
}

/** Modalità server dalla scheda: «Aggiungi un file da compilare» o «Sostituisci» (fino a 4 MB). */
export async function uploadTemplateFileServer(ctx: WriteContext, useCaseId: string, input: { target: unknown; fileName: string; bytes: Uint8Array }, env: Env): Promise<Result<ReferentUploadResult>> {
  try {
    const writer = await templateWriter(ctx, useCaseId, env);
    if (!writer.ok) return failCode(writer.error, writer.message);
    const target = templateTargetOf(input.target);
    if (!target) return templateFail("domanda_non_disponibile");
    const request = referentUploadCheck({ fileName: input.fileName, size: input.bytes.byteLength, mode: "server" });
    if (!request.ok) return request;
    if (!storeOf(env)) return templateFail("archivio_non_configurato");
    const fileId = randomUUID();
    const executor = await getAppUcExecutor();
    const run = await referentBatch(
      executor,
      templateInsertStatements({ fileId, workspaceId: ctx.workspaceId, useCaseId, userId: writer.userId, ...target, fileName: request.value.fileName, kind: request.value.kind, maxBytes: request.value.maxBytes, mode: "server", quarantinePath: null }),
    );
    if (!run.ok) return templateFail(run.error);
    return await processTemplateFile({ workspaceId: ctx.workspaceId, fileId, bytes: input.bytes }, env);
  } catch (error) {
    logReferentError("da_compilare", error, { workspaceId: ctx.workspaceId });
    return templateFail("riprova");
  }
}

/** Caricamento diretto dalla scheda: la riga in quarantena (e i legami) e un token per quel solo percorso. */
export async function beginTemplateClientUpload(ctx: WriteContext, useCaseId: string, body: unknown, env: Env): Promise<Result<ReferentClientTicket>> {
  try {
    const writer = await templateWriter(ctx, useCaseId, env);
    if (!writer.ok) return failCode(writer.error, writer.message);
    if (!clientUploadAvailable(env)) return templateFail("modalita_non_disponibile");
    const target = templateTargetOf(body);
    if (!target) return templateFail("domanda_non_disponibile");
    const b = body as Record<string, unknown>;
    const request = referentUploadCheck({ fileName: b.fileName, size: b.size, mode: "client" });
    if (!request.ok) return request;
    const fileId = randomUUID();
    const pathname = referentBlobPath("quarantena", ctx.workspaceId, useCaseId, fileId);
    const executor = await getAppUcExecutor();
    const run = await referentBatch(
      executor,
      templateInsertStatements({ fileId, workspaceId: ctx.workspaceId, useCaseId, userId: writer.userId, ...target, fileName: request.value.fileName, kind: request.value.kind, maxBytes: request.value.maxBytes, mode: "client", quarantinePath: pathname }),
    );
    if (!run.ok) return templateFail(run.error);
    const clientToken = await clientUploadToken(env, { pathname, maxBytes: request.value.maxBytes, allowedContentTypes: UC_ALLOWED_UPLOAD_MIME_TYPES });
    return ok({ fileId, pathname, clientToken, contentType: request.value.mime });
  } catch (error) {
    logReferentError("da_compilare_diretto", error, { workspaceId: ctx.workspaceId });
    return templateFail("riprova");
  }
}

/** Fine del caricamento diretto dalla scheda: solo un file da compilare di chi chiama, in quarantena da meno di un'ora. */
export async function completeTemplateClientUpload(ctx: WriteContext, useCaseId: string, body: unknown, env: Env): Promise<Result<ReferentUploadResult>> {
  try {
    const writer = await templateWriter(ctx, useCaseId, env);
    if (!writer.ok) return failCode(writer.error, writer.message);
    const fileId = body && typeof body === "object" ? (body as Record<string, unknown>).fileId : null;
    if (!isUuid(fileId)) return templateFail("file_non_trovato");
    const executor = await getAppUcExecutor();
    const f = await loadTemplate(executor, ctx.workspaceId, fileId);
    if (
      !f ||
      f.useCaseId !== useCaseId.toLowerCase() ||
      f.uploadedByUserId !== writer.userId.toLowerCase() ||
      f.scanStatus !== "in_quarantena" ||
      f.deleted ||
      Date.now() - f.createdAt.getTime() > PENDING_QUARANTINE_MS
    ) {
      return templateFail("file_non_trovato");
    }
    return await processTemplateFile({ workspaceId: ctx.workspaceId, fileId: f.id }, env);
  } catch (error) {
    logReferentError("da_compilare_fine", error, { workspaceId: ctx.workspaceId });
    return templateFail("riprova");
  }
}

// ─── «Accetta il file», «Rifiuta il file» e «Togli» ─────────────────

/**
 * Il controllo di un PDF da compilare con poco testo, da parte di chi modifica «Cosa serve» e non l'ha caricato. Accetta:
 * pulito (e, per una versione nuova, la sostituzione). Rifiuta: prima l'oggetto, poi la riga senza percorso né legami.
 */
export const reviewTemplateFile = guardedReferent(
  "controllo_da_compilare",
  async function reviewTemplateFile(ctx: WriteContext, useCaseId: string, fileId: string, outcome: unknown, env: Env): Promise<ServiceResult<{ status: "pulito" | "rifiutato" }> | ReferentFailure> {
    const writer = await templateWriter(ctx, useCaseId, env);
    if (!writer.ok) return writer;
    if (outcome !== "accetta" && outcome !== "rifiuta") return rfail("revisione_non_ammessa");
    if (!isUuid(fileId)) return rfail("file_non_trovato");
    const executor = await getAppUcExecutor();
    const f = await loadTemplate(executor, ctx.workspaceId, fileId);
    if (!f || f.deleted || f.useCaseId !== useCaseId.toLowerCase() || f.scanStatus !== "in_revisione") return rfail("file_non_trovato");
    if (f.uploadedByUserId !== null && f.uploadedByUserId === writer.userId.toLowerCase()) return rfail("revisore_uguale");
    if (outcome === "accetta") {
      const run = await referentBatch(executor, templateAcceptedStatements({ workspaceId: f.workspaceId, useCaseId: f.useCaseId, fileId: f.id, replacesId: f.replacesId, reviewerUserId: writer.userId }));
      if (!run.ok) return run;
      if (f.replacesId) scheduleTemplateCleanup(f.workspaceId, env);
      return { ok: true, value: { status: "pulito" } };
    }
    if (!(await safeDelete(storeOf(env), [f.blobPath]))) return rfail("riprova");
    const run = await referentBatch(executor, templateRejectedStatements({ workspaceId: f.workspaceId, useCaseId: f.useCaseId, fileId: f.id, reviewerUserId: writer.userId }));
    if (!run.ok) return run;
    return { ok: true, value: { status: "rifiutato" } };
  },
);

/** «Togli»: il file da compilare non è più su questa esigenza; dall'ultima, si cancella (l'oggetto dopo la risposta). */
export const removeTemplateFromNeed = guardedReferent(
  "togli_da_compilare",
  async function removeTemplateFromNeed(ctx: WriteContext, useCaseId: string, fileId: string, needId: string, env: Env): Promise<ServiceResult<{ removed: true }> | ReferentFailure> {
    const writer = await templateWriter(ctx, useCaseId, env);
    if (!writer.ok) return writer;
    if (!isUuid(fileId) || !isUuid(needId)) return rfail("file_non_trovato");
    const executor = await getAppUcExecutor();
    const run = await referentBatch(executor, templateRemoveStatements({ workspaceId: ctx.workspaceId, useCaseId, fileId, needId, userId: writer.userId }));
    if (!run.ok) return run;
    scheduleTemplateCleanup(ctx.workspaceId, env);
    return { ok: true, value: { removed: true } };
  },
);

// ─── Download ────────────────────────────────────────────────────────

export interface TemplateDownload {
  body: ReadableStream<Uint8Array> | null;
  size: number | null;
  mime: string;
  /** `Content-Disposition`: sempre come allegato, con il nome ripulito. */
  disposition: string;
}

/**
 * Il download dalla scheda: un file da compilare pulito dello use case, oppure un PDF da controllare per chi modifica
 * «Cosa serve» e non l'ha caricato. Ogni rifiuto è lo stesso «File non trovato.».
 */
export async function openTeamTemplateDownload(
  i: { workspaceId: string; useCaseId: string; fileId: string; viewer: UseCaseViewer; userId: string },
  env: Env,
): Promise<Result<TemplateDownload>> {
  const notFound = templateFail<TemplateDownload>("file_non_trovato");
  const abilities = abilitiesForUseCase(i.viewer);
  if (!abilities.canSeeNeeds || !isUuid(i.workspaceId) || !isUuid(i.useCaseId) || !isUuid(i.fileId) || !isUuid(i.userId)) return notFound;
  if (!(await templateFilesStoreReady())) return notFound;
  const executor = await getAppUcExecutor();
  const [[row]] = await executor.batch([
    toStatement(ucSql`SELECT f.blob_path, f.mime, f.file_name, f.size_bytes FROM use_case_template_files f
WHERE f.id = ${uuidOf(i.fileId)} AND f.workspace_id = ${uuidOf(i.workspaceId)} AND f.use_case_id = ${uuidOf(i.useCaseId)}
  AND f.deleted_at IS NULL AND f.blob_path IS NOT NULL
  AND (f.scan_status = 'pulito' OR (f.scan_status = 'in_revisione' AND ${cast(abilities.canEditNeeds, "boolean")} AND f.uploaded_by_user_id IS DISTINCT FROM ${uuidOf(i.userId)}))`),
  ]);
  return streamTemplate(row, i.workspaceId, i.useCaseId, env, true);
}

async function streamTemplate(row: UcRow | undefined, workspaceId: string, useCaseId: string, env: Env, withBody: boolean): Promise<Result<TemplateDownload>> {
  const notFound = templateFail<TemplateDownload>("file_non_trovato");
  const path = rowString(row?.blob_path);
  if (!row || !path || !isReferentBlobPath(path, workspaceId, useCaseId)) return notFound;
  const store = storeOf(env);
  if (!store) return notFound;
  const mime = servedMime(rowString(row.mime));
  const disposition = attachmentHeader(rowString(row.file_name) ?? "file");
  if (!withBody) {
    const info = await store.head(path);
    if (!info) return notFound;
    return ok({ body: null, size: info.size, mime, disposition });
  }
  const object = await store.stream(path);
  if (!object) return notFound;
  return ok({ body: object.stream, size: object.size ?? rowNumber(row.size_bytes), mime, disposition });
}

/**
 * Il file per il referente, dopo `templateDownloadDecision` (il file è sulla sua pagina): pulito, non cancellato, di
 * questo workspace e di questo use case. Con `record` (una GET, mai una HEAD) il primo download di questa versione per
 * questa richiesta scrive «file da compilare scaricato dal referente»: un errore lì non ferma il download.
 */
export async function openLinkTemplateDownload(link: ReferentLink, fileId: string, o: { env: Env; record: boolean }): Promise<TemplateDownload | null> {
  if (!isUuid(fileId)) return null;
  const executor = await getAppUcExecutor();
  const [[row]] = await executor.batch([
    toStatement(ucSql`SELECT f.blob_path, f.mime, f.file_name, f.size_bytes FROM use_case_template_files f
WHERE f.id = ${uuidOf(fileId)} AND f.workspace_id = ${uuidOf(link.workspaceId)} AND f.use_case_id = ${uuidOf(link.useCaseId)}
  AND f.deleted_at IS NULL AND f.scan_status = 'pulito' AND f.blob_path IS NOT NULL`),
  ]);
  const file = await streamTemplate(row, link.workspaceId, link.useCaseId, o.env, o.record);
  if (!file.ok) return null;
  if (o.record) {
    try {
      await executor.batch([templateFirstDownloadStatement(link, fileId)]);
    } catch (error) {
      logReferentError("scaricato_da_compilare", error, { workspaceId: link.workspaceId });
    }
  }
  return file.value;
}

// ─── Letture ─────────────────────────────────────────────────────────

const scanOf = (value: unknown): PublicTemplateRow["scanStatus"] => {
  const s = rowString(value);
  return s === "pulito" || s === "in_revisione" || s === "rifiutato" ? s : "in_quarantena";
};

/** Le righe di `requestTemplatesStatement`, per esigenza. */
export function requestTemplatesByNeed(rows: readonly UcRow[]): Map<string, PublicTemplateRow[]> {
  const out = new Map<string, PublicTemplateRow[]>();
  for (const r of rows) {
    const needId = String(r.need_id).toLowerCase();
    const list = out.get(needId) ?? [];
    list.push({ id: String(r.id).toLowerCase(), fileName: rowString(r.file_name) ?? "file", sizeBytes: rowNumber(r.size_bytes), scanStatus: scanOf(r.scan_status) });
    out.set(needId, list);
  }
  return out;
}

/**
 * I file da compilare vivi (puliti o in controllo) di uno use case con le loro esigenze, dal più vecchio; [] senza la
 * 0040. Solo per chi vede «Cosa serve»: lo controlla chi chiama.
 */
export async function readUseCaseTemplates(executor: UcExecutor, workspaceId: string, useCaseId: string): Promise<TemplateFact[]> {
  if (!isUuid(workspaceId) || !isUuid(useCaseId) || !(await templateFilesStoreReady())) return [];
  const ws = uuidOf(workspaceId);
  const uc = uuidOf(useCaseId);
  const [files, links] = await executor.batch([
    toStatement(ucSql`SELECT f.id, f.replaces_id, f.file_name, f.size_bytes, f.scan_status, f.uploaded_by_user_id FROM use_case_template_files f
WHERE f.workspace_id = ${ws} AND f.use_case_id = ${uc} AND f.deleted_at IS NULL AND f.blob_path IS NOT NULL AND f.scan_status IN ('pulito', 'in_revisione')
ORDER BY f.created_at, f.id`),
    toStatement(ucSql`SELECT l.file_id, l.need_id FROM use_case_template_links l WHERE l.workspace_id = ${ws} AND l.use_case_id = ${uc}`),
  ]);
  return templateFactsOf(files, links);
}

/** I file da compilare vivi legati alle esigenze `needIds` di un workspace (per `list_needs`), su qualunque use case. */
export async function readNeedTemplates(executor: UcExecutor, workspaceId: string, needIds: readonly string[]): Promise<TemplateFact[]> {
  const ids = needIds.filter(isUuid).map((id) => id.toLowerCase());
  if (!isUuid(workspaceId) || ids.length === 0 || !(await templateFilesStoreReady())) return [];
  const ws = uuidOf(workspaceId);
  const [files, links] = await executor.batch([
    toStatement(ucSql`SELECT f.id, f.replaces_id, f.file_name, f.size_bytes, f.scan_status, f.uploaded_by_user_id FROM use_case_template_files f
WHERE f.workspace_id = ${ws} AND f.deleted_at IS NULL AND f.blob_path IS NOT NULL AND f.scan_status IN ('pulito', 'in_revisione')
  AND EXISTS (SELECT 1 FROM use_case_template_links l WHERE l.file_id = f.id AND l.need_id = ANY(${cast(ids, "uuid[]")}))
ORDER BY f.created_at, f.id`),
    toStatement(ucSql`SELECT l.file_id, l.need_id FROM use_case_template_links l WHERE l.workspace_id = ${ws} AND l.need_id = ANY(${cast(ids, "uuid[]")})`),
  ]);
  return templateFactsOf(files, links);
}

function templateFactsOf(files: readonly UcRow[], links: readonly UcRow[]): TemplateFact[] {
  const byFile = new Map<string, string[]>();
  for (const l of links) {
    const fileId = String(l.file_id).toLowerCase();
    byFile.set(fileId, [...(byFile.get(fileId) ?? []), String(l.need_id).toLowerCase()]);
  }
  return files.map((f) => {
    const id = String(f.id).toLowerCase();
    return {
      id,
      replacesId: rowString(f.replaces_id)?.toLowerCase() ?? null,
      name: rowString(f.file_name) ?? "file",
      sizeBytes: rowNumber(f.size_bytes),
      status: rowString(f.scan_status) === "in_revisione" ? "in_revisione" : "pulito",
      uploadedByUserId: rowString(f.uploaded_by_user_id)?.toLowerCase() ?? null,
      needIds: byFile.get(id) ?? [],
    };
  });
}

// ─── Pulizie ─────────────────────────────────────────────────────────

/** Dopo la risposta: gli oggetti dei file da compilare appena cancellati (sostituiti o tolti) di questo workspace. */
function scheduleTemplateCleanup(workspaceId: string, env: Env): void {
  afterResponse(async () => {
    try {
      await cleanupDeletedTemplates({ workspaceId, limit: 50 }, env);
    } catch (error) {
      logReferentError("pulizia_da_compilare", error, { workspaceId });
    }
  });
}

/** Le righe cancellate che hanno ancora un oggetto nell'archivio (al massimo `limit`). */
export async function collectDeletedTemplateRows(workspaceId: string | null, limit = 200): Promise<{ id: string; blobPath: string | null; quarantinePath: string | null }[]> {
  if (!(await templateFilesStoreReady())) return [];
  const executor = await getAppUcExecutor();
  const ws = workspaceId && isUuid(workspaceId) ? ucSql` AND workspace_id = ${uuidOf(workspaceId)}` : raw("");
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT id, blob_path, quarantine_path FROM use_case_template_files
WHERE deleted_at IS NOT NULL AND (blob_path IS NOT NULL OR quarantine_path IS NOT NULL)${ws}
ORDER BY deleted_at, id LIMIT ${cast(Math.max(1, Math.min(500, limit)), "int")}`),
  ]);
  return rows.map((r) => ({ id: String(r.id), blobPath: rowString(r.blob_path), quarantinePath: rowString(r.quarantine_path) }));
}

/** Cancella gli oggetti dei file indicati, poi toglie i percorsi delle righe di cui ha cancellato l'oggetto. */
export async function deleteTemplateObjects(rows: readonly { id: string; blobPath: string | null; quarantinePath: string | null }[], env: Env): Promise<number> {
  const valid = rows.filter((r) => isUuid(r.id));
  if (!valid.length) return 0;
  const store = storeOf(env);
  if (!store) return 0;
  const executor = await getAppUcExecutor();
  let done = 0;
  for (const r of valid) {
    const paths = [r.blobPath, r.quarantinePath].filter((p): p is string => typeof p === "string" && /^uc\/[qs]\//.test(p));
    if (!(await safeDelete(store, paths))) continue;
    await executor.batch([toStatement(ucSql`UPDATE use_case_template_files SET blob_path = NULL, quarantine_path = NULL WHERE id = ${uuidOf(r.id)} AND deleted_at IS NOT NULL`)]);
    done++;
  }
  return done;
}

export async function cleanupDeletedTemplates(i: { workspaceId: string | null; limit?: number }, env: Env): Promise<number> {
  return deleteTemplateObjects(await collectDeletedTemplateRows(i.workspaceId, i.limit ?? 50), env);
}

/**
 * Cron, con il passo dei file: le quarantene di più di un'ora diventano «rifiutato» (`quarantena_scaduta`), i PDF in
 * controllo da più di 7 giorni «rifiutato» (`revisione_scaduta`, oggetto cancellato); in tutti e due i casi senza legami.
 * Poi gli oggetti dei file cancellati. Senza la 0040: niente.
 */
export async function cleanupPendingTemplateFiles(env: Env, now: Date): Promise<number> {
  if (!(await templateFilesStoreReady())) return 0;
  const executor = await getAppUcExecutor();
  const store = storeOf(env);
  const [quarantine, review] = await executor.batch([
    toStatement(ucSql`SELECT id, quarantine_path FROM use_case_template_files
WHERE scan_status = 'in_quarantena' AND deleted_at IS NULL AND created_at <= ${cast(new Date(now.getTime() - PENDING_QUARANTINE_MS).toISOString(), "timestamptz")}
ORDER BY created_at, id LIMIT 200`),
    toStatement(ucSql`SELECT id, blob_path FROM use_case_template_files
WHERE scan_status = 'in_revisione' AND deleted_at IS NULL AND created_at <= ${cast(new Date(now.getTime() - REVIEW_TTL_MS).toISOString(), "timestamptz")}
ORDER BY created_at, id LIMIT 200`),
  ]);
  let done = 0;
  for (const [rows, column, reason, status] of [
    [quarantine, "quarantine_path", "quarantena_scaduta", "in_quarantena"],
    [review, "blob_path", "revisione_scaduta", "in_revisione"],
  ] as const) {
    for (const r of rows) {
      const path = rowString(r[column]);
      if (path && !(await safeDelete(store, [path]))) continue;
      // Come sopra: i legami se ne vanno solo con la riga davvero scaduta qui.
      const [updated] = await executor.batch([
        toStatement(ucSql`WITH expired AS (
  UPDATE use_case_template_files SET scan_status = 'rifiutato', rejection_reason = ${cast(reason, "text")}, ${raw(column)} = NULL
  WHERE id = ${uuidOf(String(r.id))} AND scan_status = ${cast(status, "text")} AND deleted_at IS NULL
  RETURNING id
), unlinked AS (DELETE FROM use_case_template_links WHERE file_id IN (SELECT id FROM expired) RETURNING file_id)
SELECT id FROM expired`),
      ]);
      done += updated.length;
    }
  }
  done += await deleteTemplateObjects(await collectDeletedTemplateRows(null, 200), env);
  return done;
}
