/**
 * File e dataset dei casi d'uso (PIANO §6; D20, D24, D43, D46).
 *
 * **Caricamento legato a un `fileId`** (D43). La riga `uc_files` nasce in
 * quarantena prima dei byte, legata a caso, voce, richiesta (referente) o
 * utente e al limite di dimensione:
 * - modalità server (≤ 4 MB, obbligatoria per la zona personale e usata dal
 *   harness): `uploadFromUser` / `uploadFromReferent` creano la riga e
 *   controllano subito i byte arrivati con la richiesta;
 * - modalità client-Blob (zona standard, ≤ 20 MB, solo con Vercel Blob):
 *   `beginUserUpload` / `beginReferentUpload` creano la riga e un token Blob
 *   valido solo per `uc/q/<ws>/<caso>/<fileId>`; `completeUserUpload` /
 *   `completeReferentUpload` accettano solo quel `fileId`, della stessa
 *   richiesta o dello stesso utente, ancora da controllare, e verificano
 *   l'oggetto con `head()` (esiste, entro il limite). Nessun altro percorso
 *   entra (niente IDOR).
 *
 * **Quarantena** (`processQuarantined`): `inspectFile` di WP4 (tipo dai magic
 * number, intestazioni, termini sanitari, anteprima mascherata) più la
 * scansione del testo estratto. Esiti, ognuno con CAS sulla riga ed evento
 * nella stessa istruzione:
 * - sanitario («visita medica»), dati personali fuori posto, colonne vietate,
 *   tipo non ammesso → rifiutato: niente resta in archivio, riga senza
 *   percorsi, evento `file.rifiutato` senza contenuto;
 * - PDF con testo scarso → in quarantena per la revisione di un'altra persona
 *   di Lateral Space (`reviewQuarantinedFile`); nella zona personale rifiutato;
 * - pulito → zona standard `uc/s/…`, oppure zona personale `uc/p/….enc`
 *   cifrata con la busta AES-256-GCM (KEK del workspace da
 *   `UC_PERSONAL_ZONE_KEY`, AAD `workspace|caso|file`); quarantena cancellata.
 * Un doppione (stessa impronta, stessa voce e zona) riusa il file esistente.
 *
 * **Zona personale** chiusa finché `a8` non è sciolto, o senza chiave o
 * archivio separato; dall'interno serve anche `personal_zone_access`, che si
 * attiva solo con la firma dell'approvatore privacy (comandi di WP6).
 *
 * Modulo senza import dell'app (`@/…`, `server-only`): l'esecutore e
 * l'ambiente arrivano dal chiamante (route handler, azioni, script, test).
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { deriveWorkspaceKek, ENCRYPTION_KEY_REF, envelopeAad, openEnvelope, personalZoneKeyConfigured, sealEnvelope } from "../../uc/crypto.ts";
import { ucBlobPath, isUcBlobPath } from "../../uc/files/filename.ts";
import { inspectFile } from "../../uc/files/inspect.ts";
import { profileDataset, profileJson, readTabularFile, TABULAR_MIME_TYPES } from "../../uc/files/profile.ts";
import { UC_ALLOWED_UPLOAD_MIME_TYPES, UC_UPLOAD_LIMITS } from "../../uc/files/sniff.ts";
import { tableTemplateFileName, tableTemplateWorkbook } from "../../uc/files/table-template.ts";
import {
  canReadFile,
  canReviewFile,
  canUploadTo,
  checkUploadRequest,
  checkZone,
  decideUpload,
  fileUsable,
  personalZoneOpen,
  textForScan,
  UPLOAD_MESSAGES,
  zoneForClass,
  type UploadMode,
  type UploadRequest,
  type ZoneState,
} from "../../uc/files/upload.ts";
import { INVALID_LINK_MESSAGE, PAUSED_CASE_MESSAGE, PRIVACY_PENDING_MESSAGE, REFERENT_PRIVACY_NOTICE, referentCapabilities } from "../../uc/public-view.ts";
import { privacyAcknowledged, type ResolvedLink } from "../../uc/public-rows.ts";
import {
  activeQuarantinePathsSql,
  datasetDecisionSql,
  datasetInsertSql,
  datasetRowSql,
  deleteFileSql,
  duplicateLookupSql,
  expireQuarantineSql,
  fileReadEventSql,
  fileRowSql,
  linkedFieldsSql,
  markCleanSql,
  markDuplicateSql,
  markRejectedSql,
  markReviewPendingSql,
  memberZoneAccessSql,
  panelDatasetsSql,
  panelFilesSql,
  quarantineInsertSql,
  referentTableItemSql,
  reviewDecisionSql,
  staleQuarantineSql,
  uploadTargetSql,
} from "../../uc/sql/files.ts";
import { linkGuardSql, requestItemRowSql } from "../../uc/sql/public.ts";
import { rowBool, rowDate, rowJson, rowNumber, rowString, rowStringArray, rowVocab, type Row } from "../../uc/sql/readiness.ts";
import type { UcStatement } from "../../uc/sql/statement.ts";
import { clientUploadAvailable, clientUploadToken, storeConfigured, ucStore, type UcObjectStore, type UcStorageEnv } from "../../uc/storage.ts";
import { scanText } from "../../uc/text/scan.ts";
import { fail, ok, type Json, type Result } from "../../uc/types.ts";
import {
  BLOCKER_STATUSES,
  ITEM_STATUSES,
  PRIVACY_CLASSES,
  REQUEST_ITEM_STATES,
  SCAN_STATUSES,
  VALUE_VISIBILITY,
  type CaseRole,
  type PrivacyClass,
  type StorageZone,
} from "../../uc/vocab.ts";
import type { UcExecutor, UcRow } from "../uc-executor.ts";
import { actorRoles, actorUserId, checkLsText, isUuid, runCommand, type UcCommandContext } from "./uc-cases.ts";
import { eventActorFrom, type EventActor } from "./uc-events.ts";

// ── Ambiente ──────────────────────────────────────────────────────────

/** Variabili dei file (il chiamante passa `process.env`): archivi e chiave della zona personale. */
export interface UcFilesEnv extends UcStorageEnv {
  UC_PERSONAL_ZONE_KEY?: string;
}

/** Metadati di rete del chiamante (solo l'impronta dell'IP, mai l'IP). */
export interface UcRequestMeta {
  ipHash?: string | null;
  userAgent?: string | null;
}

// ── Esiti ─────────────────────────────────────────────────────────────

/** Esito di un caricamento: solo metadati del file, mai il contenuto. */
export interface UploadResult {
  fileId: string;
  fileName: string;
  sizeBytes: number | null;
  /** `in_quarantena` = in revisione manuale. */
  status: "pulito" | "in_quarantena" | "rifiutato";
  /** Si può allegare a una risposta adesso. */
  usable: boolean;
  zone: StorageZone;
  /** Per chi ha caricato: motivo del rifiuto o della revisione. */
  message: string | null;
  /** Il file era già stato caricato: si usa quello (`fileId` è il suo). */
  duplicate: boolean;
}

/** Inizio di un caricamento diretto su Vercel Blob. */
export interface ClientUploadTicket {
  fileId: string;
  pathname: string;
  clientToken: string;
  maxBytes: number;
  contentType: string;
}

const MESSAGES: Readonly<Record<string, string>> = {
  ...UPLOAD_MESSAGES,
  destinazione_non_valida: "La voce non è più disponibile, oppure il caso è chiuso.",
  caso_chiuso: "Il caso è chiuso: non si caricano più file.",
  voce_non_trovata: "Voce non trovata.",
  voce_non_disponibile: "Questa domanda non è più nel tuo link.",
  link_non_valido: INVALID_LINK_MESSAGE,
  caso_sospeso: PAUSED_CASE_MESSAGE,
  informativa_da_leggere: PRIVACY_PENDING_MESSAGE,
  attore_non_ammesso: "Non hai i permessi per questa operazione sui file.",
  zona_personale_negata: "Per i file della zona personale serve l'accesso firmato dall'approvatore privacy.",
  caricamento_non_trovato: "Caricamento non trovato o già concluso. Riprova a caricare il file.",
  oggetto_mancante: "Il file non è arrivato. Riprova a caricarlo.",
  conflitto: "Il file è stato appena controllato da un'altra richiesta. Aggiorna la pagina.",
  file_in_uso: "Il file è una prova usata dal caso (risposta validata, designazione, scheda A.8 o gate): non si cancella.",
  non_in_revisione: "Questo file non aspetta una revisione.",
  dataset_non_trovato: "Scheda dataset non trovata.",
  dataset_gia_deciso: "La scheda dataset è già stata verificata.",
  file_non_utilizzabile: "Il file non è ancora utilizzabile: aspetta la fine dei controlli.",
  modalita_non_disponibile: "Il caricamento diretto non è disponibile qui: carica file fino a 4 MB.",
};

function failCode<T>(code: string, message?: string): Result<T> {
  return fail(code, message ?? MESSAGES[code] ?? "Operazione non riuscita. Riprova.");
}

function strings(v: unknown): string[] {
  return rowStringArray(rowJson(v));
}

// ── Stato delle zone ──────────────────────────────────────────────────

function zoneState(a8Status: unknown, env: UcFilesEnv): ZoneState {
  return {
    a8Status: rowVocab(BLOCKER_STATUSES, a8Status),
    zoneKeyConfigured: personalZoneKeyConfigured(env.UC_PERSONAL_ZONE_KEY),
    standardStoreConfigured: storeConfigured("standard", env),
    personalStoreConfigured: storeConfigured("personale", env),
  };
}

function storeFor(zone: StorageZone, env: UcFilesEnv): UcObjectStore {
  const store = ucStore(zone, env);
  if (!store) throw new Error("Archivio non configurato");
  return store;
}

// ── Destinazione del caricamento ──────────────────────────────────────

interface UploadTarget {
  workspaceId: string;
  caseId: string;
  itemId: string | null;
  itemKey: string | null;
  zone: StorageZone;
  privacyClass: PrivacyClass;
  zones: ZoneState;
}

interface TargetRow {
  row: Row;
  itemPresent: boolean;
}

async function loadTarget(executor: UcExecutor, i: { workspaceId: string; caseId: string; itemId: string | null }): Promise<Result<TargetRow>> {
  if (!isUuid(i.workspaceId) || !isUuid(i.caseId) || (i.itemId !== null && !isUuid(i.itemId))) return failCode("voce_non_trovata");
  const [[row]] = await executor.batch([uploadTargetSql(i)]);
  if (!row || !rowBool(row.ready)) return failCode("voce_non_trovata", "Caso non trovato.");
  if (rowString(row.case_status) === "chiuso") return failCode("caso_chiuso");
  const itemPresent = rowString(row.item_id) !== null;
  if (i.itemId !== null && !itemPresent) return failCode("voce_non_trovata");
  return ok({ row, itemPresent });
}

function targetFrom(i: { workspaceId: string; caseId: string; itemId: string | null }, t: TargetRow, env: UcFilesEnv): Result<UploadTarget> {
  const privacyClass: PrivacyClass = t.itemPresent ? (rowVocab(PRIVACY_CLASSES, t.row.privacy_class) ?? "riservato_azienda") : "riservato_azienda";
  const zone = zoneForClass(privacyClass);
  if (!zone) return failCode("valore_sanitario");
  return ok({
    workspaceId: i.workspaceId,
    caseId: i.caseId,
    itemId: t.itemPresent ? i.itemId : null,
    itemKey: rowString(t.row.item_key),
    zone,
    privacyClass,
    zones: zoneState(t.row.a8_status, env),
  });
}

/** Chi carica dall'interno: l'utente del comando, con i ruoli che valgono adesso. */
export interface UserUploader {
  workspaceId: string;
  caseId: string;
  userId: string;
  roles: readonly CaseRole[];
  isLateralSpace: boolean;
}

export function userUploader(ctx: UcCommandContext): Result<UserUploader> {
  const userId = actorUserId(ctx);
  if (!userId || !ctx.user || ctx.user.userId !== userId) return failCode("attore_non_ammesso");
  return ok({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, userId, roles: actorRoles(ctx), isLateralSpace: ctx.user.isLateralSpace });
}

async function personalAccess(executor: UcExecutor, caseId: string, userId: string): Promise<boolean> {
  const [[row]] = await executor.batch([memberZoneAccessSql({ caseId, userId })]);
  return rowBool(row?.access);
}

interface PreparedUpload {
  target: UploadTarget;
  request: UploadRequest;
}

const UploadInputSchema = z.object({
  itemId: z.string().regex(/^[0-9a-f-]{36}$/i).nullish(),
  fileName: z.string().max(1000),
  size: z.number().int().min(0).max(1_000_000_000),
  declaration: z.boolean(),
});

/** Controlli comuni del caricamento interno: ruolo, voce, zona (con l'accesso personale), richiesta. */
async function prepareUserUpload(executor: UcExecutor, u: UserUploader, input: unknown, mode: UploadMode, env: UcFilesEnv): Promise<Result<PreparedUpload>> {
  const parsed = UploadInputSchema.safeParse(input);
  if (!parsed.success) return failCode("nome_mancante");
  const itemId = parsed.data.itemId ?? null;
  if (!canUploadTo(u.roles, { itemId })) return failCode("attore_non_ammesso");
  const loaded = await loadTarget(executor, { workspaceId: u.workspaceId, caseId: u.caseId, itemId });
  if (!loaded.ok) return loaded;
  const target = targetFrom({ workspaceId: u.workspaceId, caseId: u.caseId, itemId }, loaded.value, env);
  if (!target.ok) return target;
  const zone = checkZone(target.value.zone, target.value.zones);
  if (!zone.ok) return zone;
  if (target.value.zone === "personale") {
    const lsRole = u.roles.some((r) => r === "ls_lead" || r === "ls_analista" || r === "ls_sviluppatore");
    if (!u.isLateralSpace || !lsRole || !(await personalAccess(executor, u.caseId, u.userId))) return failCode("zona_personale_negata");
  }
  const request = checkUploadRequest({ fileName: parsed.data.fileName, size: parsed.data.size, declaration: parsed.data.declaration, mode, zone: target.value.zone });
  if (!request.ok) return request;
  return ok({ target: target.value, request: request.value });
}

/** Il link può scrivere: caso non in pausa, informativa letta su questa richiesta, link di raccolta. */
function checkReferentLink(link: ResolvedLink): Result<void> {
  if (!link.live) return failCode("caso_sospeso");
  if (!privacyAcknowledged(link, REFERENT_PRIVACY_NOTICE.version)) return failCode("informativa_da_leggere");
  if (link.purpose !== "raccolta") return failCode("attore_non_ammesso", "Da questo link si danno solo approvazioni.");
  return ok(undefined);
}

/** Controlli del caricamento dal link: la voce è del referente e si può ancora rispondere. */
async function prepareReferentUpload(executor: UcExecutor, link: ResolvedLink, input: unknown, mode: UploadMode, env: UcFilesEnv): Promise<Result<PreparedUpload>> {
  const writable = checkReferentLink(link);
  if (!writable.ok) return writable;
  const parsed = UploadInputSchema.safeParse(input);
  if (!parsed.success || !parsed.data.itemId) return failCode(parsed.success ? "voce_non_disponibile" : "nome_mancante");
  const itemId = parsed.data.itemId;
  const [loaded, [[ri]]] = await Promise.all([
    loadTarget(executor, { workspaceId: link.workspaceId, caseId: link.caseId, itemId }),
    executor.batch([requestItemRowSql({ caseId: link.caseId, requestId: link.requestId, itemId })]),
  ]);
  if (!loaded.ok) return loaded.code === "caso_chiuso" ? failCode("link_non_valido") : failCode("voce_non_disponibile");
  const state = rowVocab(REQUEST_ITEM_STATES, ri?.state);
  if (!state) return failCode("voce_non_disponibile");
  const target = targetFrom({ workspaceId: link.workspaceId, caseId: link.caseId, itemId }, loaded.value, env);
  if (!target.ok) return target;
  const row = loaded.value.row;
  const caps = referentCapabilities({
    status: rowVocab(ITEM_STATUSES, row.item_status) ?? "da_chiedere",
    requestItemState: state,
    assignedToMe: rowString(row.assignee_contact_id) === link.contactId,
    privacyClass: target.value.privacyClass,
    personalZoneOpen: personalZoneOpen(target.value.zones),
    writable: link.live,
    delegationDepth: link.delegationDepth,
  });
  if (!caps.answer) return failCode("voce_non_disponibile", caps.lockedReason ?? MESSAGES.voce_non_disponibile);
  const zone = checkZone(target.value.zone, target.value.zones);
  if (!zone.ok) return zone;
  const request = checkUploadRequest({ fileName: parsed.data.fileName, size: parsed.data.size, declaration: parsed.data.declaration, mode, zone: target.value.zone });
  if (!request.ok) return request;
  return ok({ target: target.value, request: request.value });
}

function referentGuard(link: ResolvedLink): UcStatement {
  return linkGuardSql({ workspaceId: link.workspaceId, caseId: link.caseId, requestId: link.requestId, tokenId: link.tokenId });
}

async function insertQuarantineRow(
  executor: UcExecutor,
  p: PreparedUpload,
  who: { userId: string } | { link: ResolvedLink },
  quarantinePath: string | null,
  fileId: string,
): Promise<Result<void>> {
  const insert = quarantineInsertSql({
    id: fileId,
    workspaceId: p.target.workspaceId,
    caseId: p.target.caseId,
    itemId: p.target.itemId,
    requestId: "link" in who ? who.link.requestId : null,
    contactId: "link" in who ? who.link.contactId : null,
    userId: "userId" in who ? who.userId : null,
    fileName: p.request.fileName,
    zone: p.target.zone,
    quarantinePath,
    privacyClass: p.target.privacyClass,
    maxBytes: p.request.maxBytes,
    encryptionKeyRef: p.target.zone === "personale" ? ENCRYPTION_KEY_REF : null,
  });
  const run = await runCommand(executor, "link" in who ? [referentGuard(who.link), insert] : [insert], MESSAGES);
  return run.ok ? ok(undefined) : run;
}

// ── Quarantena ────────────────────────────────────────────────────────

interface FileRow {
  id: string;
  workspaceId: string;
  caseId: string;
  itemId: string | null;
  requestId: string | null;
  uploadedByContactId: string | null;
  uploadedByUserId: string | null;
  fileName: string;
  mime: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  zone: StorageZone;
  blobPath: string | null;
  quarantinePath: string | null;
  maxBytes: number;
  scanStatus: (typeof SCAN_STATUSES)[number];
  contentScanned: boolean;
  reviewed: boolean;
  deleted: boolean;
  inReview: boolean;
  forbidden: string[];
  a8Status: string | null;
  item: { key: string; title: string; status: (typeof ITEM_STATUSES)[number]; privacyClass: PrivacyClass; valueVisibility: (typeof VALUE_VISIBILITY)[number]; kind: string | null; responseType: string | null } | null;
}

function parseFileRow(r: Row | undefined): FileRow | null {
  if (!r || !r.id) return null;
  const itemKey = rowString(r.item_key);
  return {
    id: String(r.id),
    workspaceId: String(r.workspace_id),
    caseId: String(r.case_id),
    itemId: rowString(r.item_id),
    requestId: rowString(r.request_id),
    uploadedByContactId: rowString(r.uploaded_by_contact_id),
    uploadedByUserId: rowString(r.uploaded_by_user_id),
    fileName: rowString(r.file_name) ?? "file",
    mime: rowString(r.mime),
    sizeBytes: rowNumber(r.size_bytes),
    sha256: rowString(r.sha256)?.trim() ?? null,
    zone: rowString(r.storage_zone) === "personale" ? "personale" : "standard",
    blobPath: rowString(r.blob_path),
    quarantinePath: rowString(r.quarantine_path),
    maxBytes: rowNumber(r.max_size_bytes) ?? UC_UPLOAD_LIMITS.serverMaxBytes,
    scanStatus: rowVocab(SCAN_STATUSES, r.scan_status) ?? "in_quarantena",
    contentScanned: rowBool(r.content_scanned),
    reviewed: rowDate(r.reviewed_at) !== null,
    deleted: rowDate(r.deleted_at) !== null,
    inReview: rowBool(r.in_review),
    forbidden: strings(r.item_forbidden),
    a8Status: rowString(r.a8_status),
    item: itemKey
      ? {
          key: itemKey,
          title: rowString(r.item_title) ?? itemKey,
          status: rowVocab(ITEM_STATUSES, r.item_status) ?? "da_chiedere",
          privacyClass: rowVocab(PRIVACY_CLASSES, r.item_privacy_class) ?? "riservato_azienda",
          valueVisibility: rowVocab(VALUE_VISIBILITY, r.item_visibility) ?? "owner_e_ls",
          kind: rowString(r.item_kind),
          responseType: rowString(r.item_response_type),
        }
      : null,
  };
}

async function loadFileRow(executor: UcExecutor, i: { workspaceId: string; caseId: string; fileId: string }): Promise<FileRow | null> {
  if (!isUuid(i.workspaceId) || !isUuid(i.caseId) || !isUuid(i.fileId)) return null;
  const [[row]] = await executor.batch([fileRowSql(i)]);
  return parseFileRow(row);
}

function resultOf(f: FileRow, status: UploadResult["status"], extra: Partial<UploadResult> = {}): UploadResult {
  return {
    fileId: f.id,
    fileName: f.fileName,
    sizeBytes: extra.sizeBytes ?? f.sizeBytes,
    status,
    usable: status === "pulito",
    zone: f.zone,
    message: null,
    duplicate: false,
    ...extra,
  };
}

function updatedCount(rows: UcRow[][]): number {
  return rowNumber(rows[rows.length - 1]?.[0]?.updated) ?? 0;
}

async function safeDelete(store: UcObjectStore | null, paths: (string | null)[]): Promise<void> {
  const list = paths.filter((p): p is string => typeof p === "string" && p.length > 0);
  if (!store || list.length === 0) return;
  try {
    await store.delete(list);
  } catch (error) {
    console.error("[uc] cancellazione dall'archivio non riuscita", error instanceof Error ? error.name : "errore");
  }
}

export interface ProcessInput extends UcRequestMeta {
  workspaceId: string;
  caseId: string;
  fileId: string;
  /** Byte già arrivati (modalità server); altrimenti si leggono dalla quarantena. */
  bytes?: Uint8Array;
  actor: EventActor;
}

/**
 * Pipeline di quarantena (PIANO §6.3) su una riga ancora da controllare.
 * Restituisce l'esito per chi ha caricato; un rifiuto è un esito, non un errore.
 */
export async function processQuarantined(executor: UcExecutor, i: ProcessInput, env: UcFilesEnv): Promise<Result<UploadResult>> {
  const f = await loadFileRow(executor, i);
  if (!f || f.deleted || f.scanStatus !== "in_quarantena" || f.sha256 !== null) return failCode("caricamento_non_trovato");
  const standard = ucStore("standard", env);
  const ev = { workspaceId: f.workspaceId, caseId: f.caseId, actor: i.actor, ipHash: i.ipHash ?? null, userAgent: i.userAgent ?? null };

  const reject = async (
    reason: string,
    message: string,
    extra: { category?: string | null; findings?: Json; mime?: string | null; size?: number | null; sha256?: string | null } = {},
  ): Promise<Result<UploadResult>> => {
    const run = await runCommand(executor, [
      markRejectedSql({
        ...ev,
        fileId: f.id,
        zone: f.zone,
        mime: extra.mime ?? null,
        sizeBytes: extra.size ?? null,
        maxBytes: f.maxBytes,
        sha256: extra.sha256 ?? null,
        reason,
        category: extra.category ?? null,
        findings: extra.findings ?? { codice: reason },
        personalData: "sconosciuto",
      }),
    ]);
    await safeDelete(standard, [f.quarantinePath]);
    if (!run.ok) return run;
    if (updatedCount(run.value) === 0) return failCode("conflitto");
    return ok(resultOf(f, "rifiutato", { message, sizeBytes: extra.size ?? null, usable: false }));
  };

  let bytes = i.bytes ?? null;
  if (!bytes) {
    if (!f.quarantinePath || !isUcBlobPath(f.quarantinePath, "quarantena") || !standard) return failCode("caricamento_non_trovato");
    const info = await standard.head(f.quarantinePath);
    if (!info) return failCode("oggetto_mancante");
    if (info.size > f.maxBytes) return reject("file_troppo_grande", `Il file supera il limite di ${Math.floor(f.maxBytes / (1024 * 1024))} MB.`);
    bytes = await standard.read(f.quarantinePath, f.maxBytes);
    if (!bytes) return failCode("oggetto_mancante");
  }
  if (bytes.byteLength > f.maxBytes) return reject("file_troppo_grande", `Il file supera il limite di ${Math.floor(f.maxBytes / (1024 * 1024))} MB.`);

  const a8Resolved = f.a8Status === "sciolto";
  if (f.zone === "personale" && !personalZoneOpen(zoneState(f.a8Status, env))) {
    return reject("zona_personale_chiusa", UPLOAD_MESSAGES.zona_personale_chiusa);
  }
  const report = inspectFile(bytes, f.fileName, { zone: f.zone, a8Resolved, forbiddenColumns: f.forbidden, maxBytes: f.maxBytes });
  const textScan = report.extractedText ? scanText(textForScan(report.extractedText), { context: "commento" }) : null;
  const decision = decideUpload(report, textScan, { zone: f.zone, a8Resolved });

  if (decision.status === "rifiutato") {
    return reject(decision.reason ?? "rifiutato", decision.message ?? "Il file non è stato accettato.", {
      category: decision.findings.categoria ?? null,
      findings: decision.findings as Json,
      mime: report.mime,
      size: report.sizeBytes,
      sha256: report.sha256,
    });
  }
  const mime = report.mime!;

  // Doppione nella stessa voce e zona: si riusa il file esistente (stessa richiesta, o tra utenti interni).
  const [[dup]] = await executor.batch([duplicateLookupSql({ caseId: f.caseId, itemId: f.itemId, zone: f.zone, sha256: report.sha256, excludeFileId: f.id })]);
  if (dup) {
    const run = await runCommand(executor, [markDuplicateSql({ ...ev, fileId: f.id, zone: f.zone, mime, sizeBytes: report.sizeBytes, maxBytes: f.maxBytes, sha256: report.sha256 })]);
    await safeDelete(standard, [f.quarantinePath]);
    if (!run.ok) return run;
    const sameSource = f.requestId !== null ? rowString(dup.request_id) === f.requestId : rowString(dup.request_id) === null && rowString(dup.uploaded_by_contact_id) === null;
    if (!sameSource) return failCode("gia_caricato");
    const dupStatus = rowString(dup.scan_status) === "pulito" ? "pulito" : "in_quarantena";
    const usable = dupStatus === "pulito" && (rowBool(dup.content_scanned) || rowBool(dup.reviewed));
    return ok({
      fileId: String(dup.id),
      fileName: rowString(dup.file_name) ?? f.fileName,
      sizeBytes: rowNumber(dup.size_bytes),
      status: dupStatus,
      usable,
      zone: f.zone,
      message: UPLOAD_MESSAGES.gia_caricato,
      duplicate: true,
    });
  }

  if (decision.status === "revisione_manuale") {
    // Solo zona standard (nella personale `decideUpload` rifiuta): il PDF aspetta in quarantena.
    if (!standard) return failCode("archivio_non_configurato");
    const qPath = f.quarantinePath ?? ucBlobPath("quarantena", f.workspaceId, f.caseId, f.id);
    if (!f.quarantinePath) await standard.put(qPath, bytes, { contentType: mime });
    const run = await runCommand(executor, [
      markReviewPendingSql({
        ...ev,
        fileId: f.id,
        mime,
        sizeBytes: report.sizeBytes,
        maxBytes: f.maxBytes,
        sha256: report.sha256,
        quarantinePath: qPath,
        personalData: decision.personalData,
        findings: decision.findings as Json,
      }),
    ]);
    if (!run.ok || updatedCount(run.value) === 0) {
      if (!f.quarantinePath) await safeDelete(standard, [qPath]);
      return run.ok ? failCode("conflitto") : run;
    }
    return ok(resultOf(f, "in_quarantena", { sizeBytes: report.sizeBytes, message: decision.message, usable: false }));
  }

  // Pulito: oggetto definitivo, legato all'id del file.
  let finalPath: string;
  let store: UcObjectStore;
  let encryptionKeyRef: string | null = null;
  if (f.zone === "personale") {
    const kek = deriveWorkspaceKek(env.UC_PERSONAL_ZONE_KEY, f.workspaceId);
    if (!kek.ok) return reject("zona_personale_chiusa", UPLOAD_MESSAGES.zona_personale_non_configurata);
    store = storeFor("personale", env);
    finalPath = ucBlobPath("personale", f.workspaceId, f.caseId, f.id);
    const sealed = sealEnvelope(kek.value, bytes, envelopeAad({ workspaceId: f.workspaceId, caseId: f.caseId, objectId: f.id }));
    await store.put(finalPath, sealed, { contentType: "application/octet-stream" });
    encryptionKeyRef = ENCRYPTION_KEY_REF;
  } else {
    store = storeFor("standard", env);
    finalPath = ucBlobPath("standard", f.workspaceId, f.caseId, f.id);
    await store.put(finalPath, bytes, { contentType: mime });
  }
  const run = await runCommand(executor, [
    markCleanSql({
      ...ev,
      fileId: f.id,
      zone: f.zone,
      mime,
      sizeBytes: report.sizeBytes,
      maxBytes: f.maxBytes,
      sha256: report.sha256,
      blobPath: finalPath,
      encryptionKeyRef,
      personalData: decision.personalData,
      findings: decision.findings as Json,
      preview: decision.preview as unknown as Json | null,
      contentScanned: decision.contentScanned,
    }),
  ]);
  if (!run.ok || updatedCount(run.value) === 0) {
    // La riga non è più da controllare (pulizia o un'altra richiesta): l'oggetto resta solo se la riga lo usa.
    const now = await loadFileRow(executor, { workspaceId: f.workspaceId, caseId: f.caseId, fileId: f.id });
    if (!now || now.blobPath !== finalPath) await safeDelete(store, [finalPath]);
    return run.ok ? failCode("conflitto") : run;
  }
  await safeDelete(standard, [f.quarantinePath]);
  return ok(resultOf(f, "pulito", { sizeBytes: report.sizeBytes }));
}

// ── Caricamento dall'interno ──────────────────────────────────────────

/** Modalità server: riga in quarantena e controllo dei byte arrivati con la richiesta. */
export async function uploadFromUser(
  executor: UcExecutor,
  u: UserUploader,
  input: { itemId?: string | null; fileName: string; declaration: boolean; bytes: Uint8Array },
  env: UcFilesEnv,
): Promise<Result<UploadResult>> {
  const prepared = await prepareUserUpload(executor, u, { itemId: input.itemId ?? null, fileName: input.fileName, size: input.bytes.byteLength, declaration: input.declaration }, "server", env);
  if (!prepared.ok) return prepared;
  const fileId = randomUUID();
  const inserted = await insertQuarantineRow(executor, prepared.value, { userId: u.userId }, null, fileId);
  if (!inserted.ok) return inserted;
  return processQuarantined(executor, { workspaceId: u.workspaceId, caseId: u.caseId, fileId, bytes: input.bytes, actor: { type: "utente", userId: u.userId } }, env);
}

async function beginClient(executor: UcExecutor, prepared: PreparedUpload, who: { userId: string } | { link: ResolvedLink }, env: UcFilesEnv): Promise<Result<ClientUploadTicket>> {
  if (prepared.target.zone !== "standard" || !clientUploadAvailable(env)) return failCode("modalita_non_disponibile");
  const fileId = randomUUID();
  const pathname = ucBlobPath("quarantena", prepared.target.workspaceId, prepared.target.caseId, fileId);
  const inserted = await insertQuarantineRow(executor, prepared, who, pathname, fileId);
  if (!inserted.ok) return inserted;
  const clientToken = await clientUploadToken(env, { pathname, maxBytes: prepared.request.maxBytes, allowedContentTypes: UC_ALLOWED_UPLOAD_MIME_TYPES });
  return ok({ fileId, pathname, clientToken, maxBytes: prepared.request.maxBytes, contentType: prepared.request.mime });
}

/** Modalità client-Blob (zona standard, ≤ 20 MB): riga in quarantena e token per quel solo percorso. */
export async function beginUserUpload(executor: UcExecutor, u: UserUploader, input: unknown, env: UcFilesEnv): Promise<Result<ClientUploadTicket>> {
  const prepared = await prepareUserUpload(executor, u, input, "client", env);
  if (!prepared.ok) return prepared;
  return beginClient(executor, prepared.value, { userId: u.userId }, env);
}

const CompleteSchema = z.object({ fileId: z.string().regex(/^[0-9a-f-]{36}$/i) });

/** Fine del caricamento diretto: solo il `fileId` emesso per lo stesso utente, ancora da controllare. */
export async function completeUserUpload(executor: UcExecutor, u: UserUploader, input: unknown, env: UcFilesEnv): Promise<Result<UploadResult>> {
  const parsed = CompleteSchema.safeParse(input);
  if (!parsed.success) return failCode("caricamento_non_trovato");
  const f = await loadFileRow(executor, { workspaceId: u.workspaceId, caseId: u.caseId, fileId: parsed.data.fileId });
  if (!f || f.uploadedByUserId !== u.userId || f.requestId !== null || f.deleted || f.sha256 !== null || f.scanStatus !== "in_quarantena" || !f.quarantinePath) {
    return failCode("caricamento_non_trovato");
  }
  return processQuarantined(executor, { workspaceId: u.workspaceId, caseId: u.caseId, fileId: f.id, actor: { type: "utente", userId: u.userId } }, env);
}

// ── Caricamento dal link del referente ────────────────────────────────

/** Modalità server dal link: la voce è del referente e ancora da rispondere. */
export async function uploadFromReferent(
  executor: UcExecutor,
  link: ResolvedLink,
  input: { itemId: string; fileName: string; declaration: boolean; bytes: Uint8Array },
  meta: UcRequestMeta,
  env: UcFilesEnv,
): Promise<Result<UploadResult>> {
  const prepared = await prepareReferentUpload(executor, link, { itemId: input.itemId, fileName: input.fileName, size: input.bytes.byteLength, declaration: input.declaration }, "server", env);
  if (!prepared.ok) return prepared;
  const fileId = randomUUID();
  const inserted = await insertQuarantineRow(executor, prepared.value, { link }, null, fileId);
  if (!inserted.ok) return inserted;
  return processQuarantined(
    executor,
    { workspaceId: link.workspaceId, caseId: link.caseId, fileId, bytes: input.bytes, actor: { type: "referente", contactId: link.contactId }, ...meta },
    env,
  );
}

/** Modalità client-Blob dal link (zona standard). */
export async function beginReferentUpload(executor: UcExecutor, link: ResolvedLink, input: unknown, env: UcFilesEnv): Promise<Result<ClientUploadTicket>> {
  const prepared = await prepareReferentUpload(executor, link, input, "client", env);
  if (!prepared.ok) return prepared;
  return beginClient(executor, prepared.value, { link }, env);
}

/** Fine del caricamento diretto dal link: solo un `fileId` emesso per questa richiesta e questo referente. */
export async function completeReferentUpload(executor: UcExecutor, link: ResolvedLink, input: unknown, meta: UcRequestMeta, env: UcFilesEnv): Promise<Result<UploadResult>> {
  const writable = checkReferentLink(link);
  if (!writable.ok) return writable;
  const parsed = CompleteSchema.safeParse(input);
  if (!parsed.success) return failCode("caricamento_non_trovato");
  const f = await loadFileRow(executor, { workspaceId: link.workspaceId, caseId: link.caseId, fileId: parsed.data.fileId });
  if (!f || f.requestId !== link.requestId || f.uploadedByContactId !== link.contactId || f.deleted || f.sha256 !== null || f.scanStatus !== "in_quarantena" || !f.quarantinePath) {
    return failCode("caricamento_non_trovato");
  }
  const guard = await runCommand(executor, [referentGuard(link)], MESSAGES);
  if (!guard.ok) return guard;
  return processQuarantined(executor, { workspaceId: link.workspaceId, caseId: link.caseId, fileId: f.id, actor: { type: "referente", contactId: link.contactId }, ...meta }, env);
}

/** Modello Excel di una domanda di tipo tabella del link (sola lettura: niente eventi). */
export async function referentTableTemplate(executor: UcExecutor, link: ResolvedLink, itemId: unknown): Promise<Result<{ fileName: string; bytes: Buffer }>> {
  if (link.purpose !== "raccolta" || !isUuid(itemId)) return failCode("voce_non_disponibile");
  const [[row]] = await executor.batch([referentTableItemSql({ caseId: link.caseId, requestId: link.requestId, contactId: link.contactId, itemId })]);
  if (!row || rowString(row.response_type) !== "tabella") return failCode("voce_non_disponibile");
  const config = rowJson<Record<string, Json>>(row.response_config);
  const bytes = tableTemplateWorkbook({ title: rowString(row.title) ?? "", config: config && typeof config === "object" && !Array.isArray(config) ? config : {} });
  return ok({ fileName: tableTemplateFileName(String(row.key)), bytes });
}

// ── Revisione, cancellazione, download ────────────────────────────────

const ReviewSchema = z.object({ fileId: z.string().regex(/^[0-9a-f-]{36}$/i), outcome: z.enum(["pulito", "rifiutato"]) });

/**
 * Revisione manuale di un PDF in quarantena (§6.3): Lateral Space, mai chi
 * l'ha caricato. `pulito` lo copia nella zona standard e lo rende utilizzabile;
 * `rifiutato` lo cancella.
 */
export async function reviewQuarantinedFile(executor: UcExecutor, ctx: UcCommandContext, input: unknown, env: UcFilesEnv): Promise<Result<{ fileId: string; outcome: "pulito" | "rifiutato" }>> {
  const u = userUploader(ctx);
  if (!u.ok) return u;
  const parsed = ReviewSchema.safeParse(input);
  if (!parsed.success) return failCode("non_in_revisione");
  const f = await loadFileRow(executor, { workspaceId: ctx.workspaceId, caseId: ctx.caseId, fileId: parsed.data.fileId });
  if (!f || !f.inReview || f.zone !== "standard" || !f.quarantinePath) return failCode("non_in_revisione");
  const allowed = canReviewFile({ roles: u.value.roles, isLateralSpace: u.value.isLateralSpace, userId: u.value.userId, uploadedByUserId: f.uploadedByUserId });
  if (!allowed.ok) return allowed;
  const store = storeFor("standard", env);
  const ev = { workspaceId: f.workspaceId, caseId: f.caseId, actor: eventActorFrom(ctx.actor) };
  let finalPath: string | null = null;
  if (parsed.data.outcome === "pulito") {
    const bytes = await store.read(f.quarantinePath, f.maxBytes);
    if (!bytes) return failCode("oggetto_mancante");
    finalPath = ucBlobPath("standard", f.workspaceId, f.caseId, f.id);
    await store.put(finalPath, bytes, { contentType: f.mime ?? "application/pdf" });
  }
  const run = await runCommand(executor, [
    reviewDecisionSql({ ...ev, fileId: f.id, reviewerUserId: u.value.userId, outcome: parsed.data.outcome, blobPath: finalPath, mime: f.mime, sizeBytes: f.sizeBytes }),
  ]);
  if (!run.ok || updatedCount(run.value) === 0) {
    if (finalPath) await safeDelete(store, [finalPath]);
    return run.ok ? failCode("non_in_revisione") : run;
  }
  await safeDelete(store, [f.quarantinePath]);
  return ok({ fileId: f.id, outcome: parsed.data.outcome });
}

const DeleteSchema = z.object({ fileId: z.string().regex(/^[0-9a-f-]{36}$/i) });

/** Cancellazione di un file del caso (Responsabile del caso), salvo le prove usate dal caso. */
export async function deleteCaseFile(executor: UcExecutor, ctx: UcCommandContext, input: unknown, env: UcFilesEnv): Promise<Result<{ fileId: string }>> {
  const u = userUploader(ctx);
  if (!u.ok) return u;
  if (!u.value.roles.includes("ls_lead") || !u.value.isLateralSpace) return failCode("attore_non_ammesso");
  const parsed = DeleteSchema.safeParse(input);
  if (!parsed.success) return failCode("file_non_trovato");
  const f = await loadFileRow(executor, { workspaceId: ctx.workspaceId, caseId: ctx.caseId, fileId: parsed.data.fileId });
  if (!f || f.deleted) return failCode("file_non_trovato");
  const run = await runCommand(executor, [deleteFileSql({ workspaceId: f.workspaceId, caseId: f.caseId, actor: eventActorFrom(ctx.actor), fileId: f.id, reason: "cancellato_da_ls" })]);
  if (!run.ok) return run;
  const row = run.value[0]?.[0];
  if (rowBool(row?.in_use)) return failCode("file_in_uso");
  if ((rowNumber(row?.updated) ?? 0) === 0) return failCode("file_non_trovato");
  await safeDelete(ucStore(f.zone, env), [f.blobPath]);
  if (f.quarantinePath) await safeDelete(ucStore("standard", env), [f.quarantinePath]);
  return ok({ fileId: f.id });
}

/** Chi legge un file dall'interno. */
export interface FileReader {
  workspaceId: string;
  caseId: string;
  userId: string;
  roles: readonly CaseRole[];
  isLateralSpace: boolean;
}

export interface FileDownload {
  fileName: string;
  mime: string | null;
  size: number | null;
  zone: StorageZone;
  body: ReadableStream<Uint8Array>;
}

/**
 * Download (§6.7): 404 identico per «assente», «non tuo», «non utilizzabile»;
 * il PDF in revisione si apre solo per la revisione. L'evento `file.scaricato`
 * si scrive prima di servire il file: senza audit niente file. La zona
 * personale si decifra qui, sul server.
 */
export async function openFileDownload(executor: UcExecutor, reader: FileReader, fileId: unknown, env: UcFilesEnv): Promise<Result<FileDownload>> {
  if (!isUuid(fileId)) return failCode("file_non_trovato");
  const f = await loadFileRow(executor, { workspaceId: reader.workspaceId, caseId: reader.caseId, fileId });
  if (!f) return failCode("file_non_trovato");
  const zones = zoneState(f.a8Status, env);
  const access = f.zone === "personale" ? await personalAccess(executor, f.caseId, reader.userId) : false;
  const allowed = canReadFile({
    roles: reader.roles,
    userId: reader.userId,
    isLateralSpace: reader.isLateralSpace,
    personalZoneAccess: access,
    zoneOpen: personalZoneOpen(zones),
    file: {
      zone: f.zone,
      scanStatus: f.scanStatus,
      contentScanned: f.contentScanned,
      reviewed: f.reviewed,
      manualReview: f.inReview,
      deleted: f.deleted,
      uploadedByUserId: f.uploadedByUserId,
      item: f.item ? { status: f.item.status, privacyClass: f.item.privacyClass, valueVisibility: f.item.valueVisibility } : null,
    },
  });
  if (!allowed.ok) return allowed;
  const path = allowed.value.motivo === "revisione" ? f.quarantinePath : f.blobPath;
  const store = ucStore(f.zone, env);
  if (!path || !store) return failCode("file_non_trovato");

  let body: ReadableStream<Uint8Array>;
  let size: number | null = f.sizeBytes;
  if (f.zone === "personale") {
    const kek = deriveWorkspaceKek(env.UC_PERSONAL_ZONE_KEY, f.workspaceId);
    if (!kek.ok) return failCode("file_non_trovato");
    const sealed = await store.read(path, f.maxBytes + 4096);
    if (!sealed) return failCode("file_non_trovato");
    const opened = openEnvelope(kek.value, sealed, envelopeAad({ workspaceId: f.workspaceId, caseId: f.caseId, objectId: f.id }));
    if (!opened.ok) return failCode("file_non_trovato");
    const plain = opened.value;
    size = plain.byteLength;
    body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(plain));
        plain.fill(0);
        controller.close();
      },
    });
  } else {
    const streamed = await store.stream(path);
    if (!streamed) return failCode("file_non_trovato");
    body = streamed.stream;
    size = streamed.size ?? size;
  }
  try {
    await executor.batch([
      fileReadEventSql({ workspaceId: f.workspaceId, caseId: f.caseId, actor: { type: "utente", userId: reader.userId }, fileId: f.id, zone: f.zone, mime: f.mime, sizeBytes: f.sizeBytes, motivo: allowed.value.motivo }),
    ]);
  } catch (error) {
    await body.cancel().catch(() => undefined);
    throw error;
  }
  return ok({ fileName: f.fileName, mime: f.mime, size, zone: f.zone, body });
}

// ── Dataset ───────────────────────────────────────────────────────────

const optText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((s) => s.trim())
    .nullish()
    .transform((s) => (s ? s : null));

const DatasetSchema = z.object({
  fileId: z.string().regex(/^[0-9a-f-]{36}$/i),
  sourceKey: z
    .string()
    .regex(/^[A-Za-z0-9_.:-]{1,160}$/)
    .nullish(),
  periodFrom: z.iso.date().nullish(),
  periodTo: z.iso.date().nullish(),
  extractedAt: z.iso.date().nullish(),
  extractionMethod: optText(500),
  timezone: z
    .string()
    .regex(/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$|^UTC$/)
    .max(64)
    .nullish(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullish(),
  dataControllerLabel: z.string().trim().min(2).max(255),
  pseudonymized: z.boolean().optional(),
  pseudonymizationMethod: optText(120),
});

/**
 * Scheda dataset da un file tabellare utilizzabile del caso (§6.5): versione
 * progressiva per fonte, righe, colonne, qualità minima, dati personali dalle
 * intestazioni, mappatura proposta, titolare dei dati obbligatorio. Stato
 * `ricevuto`; i controlli di qualità automatici vanno in `uc_validations`.
 */
export async function createDataset(executor: UcExecutor, ctx: UcCommandContext, input: unknown, env: UcFilesEnv): Promise<Result<{ datasetId: string; version: number; rows: number }>> {
  const u = userUploader(ctx);
  if (!u.ok) return u;
  if (!u.value.isLateralSpace || !(u.value.roles.includes("ls_lead") || u.value.roles.includes("ls_analista"))) return failCode("attore_non_ammesso");
  const parsed = DatasetSchema.safeParse(input);
  if (!parsed.success) return failCode("dati_non_validi", "Controlla la scheda: titolare dei dati, periodo e data di estrazione.");
  const v = parsed.data;
  if (v.periodFrom && v.periodTo && v.periodFrom > v.periodTo) return failCode("periodo_non_valido", "Il periodo finisce prima di iniziare.");
  const text = checkLsText({ method: v.extractionMethod ?? "", controller: v.dataControllerLabel, pseudo: v.pseudonymizationMethod ?? "" });
  if (!text.ok) return text;
  const f = await loadFileRow(executor, { workspaceId: ctx.workspaceId, caseId: ctx.caseId, fileId: v.fileId });
  if (!f || !fileUsable(f) || !f.blobPath) return failCode("file_non_utilizzabile");
  if (!f.mime || !TABULAR_MIME_TYPES.includes(f.mime)) return failCode("non_tabellare", "La scheda dataset si crea da un CSV o da un file Excel (.xlsx).");
  const sourceKey = v.sourceKey ?? f.item?.key ?? null;
  if (!sourceKey) return failCode("fonte_mancante", "Indica la chiave della fonte (es. src.sistema.tabella).");

  let bytes: Uint8Array | null;
  if (f.zone === "personale") {
    if (!(await personalAccess(executor, f.caseId, u.value.userId)) || !personalZoneOpen(zoneState(f.a8Status, env))) return failCode("zona_personale_negata");
    const kek = deriveWorkspaceKek(env.UC_PERSONAL_ZONE_KEY, f.workspaceId);
    if (!kek.ok) return failCode("zona_personale_negata");
    const sealed = await storeFor("personale", env).read(f.blobPath, f.maxBytes + 4096);
    const opened = sealed ? openEnvelope(kek.value, sealed, envelopeAad({ workspaceId: f.workspaceId, caseId: f.caseId, objectId: f.id })) : null;
    bytes = opened?.ok ? opened.value : null;
  } else {
    bytes = await storeFor("standard", env).read(f.blobPath, f.maxBytes);
  }
  if (!bytes) return failCode("oggetto_mancante", "Il file non si trova nell'archivio.");
  const table = readTabularFile(bytes, f.fileName);
  if (f.zone === "personale") bytes.fill(0);
  if (!table.ok) return table;
  const fields = f.itemId ? (await executor.batch([linkedFieldsSql({ caseId: f.caseId, itemId: f.itemId })]))[0].map((r) => ({ key: String(r.key), title: rowString(r.title) })) : [];
  const profile = profileDataset(table.value, { forbiddenColumns: f.forbidden, fields, pseudonymized: v.pseudonymized === true });
  if (!profile.ok) return profile;
  const p = profile.value;
  const json = profileJson(p);
  const checks: { checkKey: string; outcome: "ok" | "avviso" | "errore"; message: string; details: Json }[] = [
    { checkKey: "dq.righe", outcome: "ok", message: "Il file contiene righe di dati.", details: { righe: p.rowCount } },
  ];
  if (p.quality.fusi_orari_misti) checks.push({ checkKey: "dq.fusi_orari", outcome: "avviso", message: "Alcune date hanno il fuso orario e altre no: indica il fuso della scheda.", details: {} });
  if (p.quality.colonne_vuote.length > 0) checks.push({ checkKey: "dq.colonne_vuote", outcome: "avviso", message: "Alcune colonne sono vuote.", details: { colonne: p.quality.colonne_vuote.length } });

  const insert = (id: string) =>
    datasetInsertSql({
      id,
      workspaceId: ctx.workspaceId,
      caseId: ctx.caseId,
      itemId: f.itemId,
      fileId: f.id,
      sourceKey,
      periodFrom: v.periodFrom ?? null,
      periodTo: v.periodTo ?? null,
      extractedAt: v.extractedAt ?? null,
      extractionMethod: v.extractionMethod,
      timezone: v.timezone ?? null,
      currency: v.currency ?? null,
      rowCount: p.rowCount,
      columnMapping: json.column_mapping,
      schema: json.schema,
      pseudonymized: v.pseudonymized === true,
      pseudonymizationMethod: v.pseudonymizationMethod,
      personalData: p.personalData,
      piiColumns: json.pii_columns,
      dataControllerLabel: v.dataControllerLabel,
      quality: json.quality,
      actor: eventActorFrom(ctx.actor),
      checks,
    });
  for (let attempt = 0; attempt < 2; attempt++) {
    const id = randomUUID();
    const run = await runCommand(executor, [insert(id)]);
    if (!run.ok) {
      if (run.code === "conflitto" && attempt === 0) continue;
      return run;
    }
    const row = run.value[0]?.[0];
    if (!row) return failCode("file_non_utilizzabile");
    return ok({ datasetId: String(row.id), version: rowNumber(row.dataset_version) ?? 1, rows: p.rowCount });
  }
  return failCode("conflitto");
}

const DatasetDecisionSchema = z.object({ datasetId: z.string().regex(/^[0-9a-f-]{36}$/i), outcome: z.enum(["validato", "rifiutato"]) });

/** Verifica della scheda dataset: Lateral Space, mai chi ha caricato il file. */
export async function validateDataset(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<{ datasetId: string; status: "validato" | "rifiutato" }>> {
  const u = userUploader(ctx);
  if (!u.ok) return u;
  if (!u.value.isLateralSpace || !(u.value.roles.includes("ls_lead") || u.value.roles.includes("ls_analista"))) return failCode("attore_non_ammesso");
  const parsed = DatasetDecisionSchema.safeParse(input);
  if (!parsed.success) return failCode("dataset_non_trovato");
  const [[row]] = await executor.batch([datasetRowSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, datasetId: parsed.data.datasetId })]);
  if (!row) return failCode("dataset_non_trovato");
  if (rowString(row.uploaded_by_user_id) === u.value.userId) return failCode("revisore_uguale", "La scheda la verifica un'altra persona di Lateral Space, non chi ha caricato il file.");
  if (!["ricevuto", "profilato", "in_verifica"].includes(String(row.status))) return failCode("dataset_gia_deciso");
  const run = await runCommand(executor, [
    datasetDecisionSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, datasetId: parsed.data.datasetId, userId: u.value.userId, outcome: parsed.data.outcome, actor: eventActorFrom(ctx.actor) }),
  ]);
  if (!run.ok) return run;
  if (updatedCount(run.value) === 0) return failCode("dataset_gia_deciso");
  return ok({ datasetId: parsed.data.datasetId, status: parsed.data.outcome });
}

// ── Pulizia della quarantena ──────────────────────────────────────────

/** Una riga di quarantena abbandonata si chiude dopo 1 ora; un PDF in revisione dopo 7 giorni (PIANO §5.7). */
export const QUARANTINE_TTL_MS = 60 * 60 * 1000;
export const REVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Pulizia per il cron `uc-freshness` (§5.7, D43): righe di quarantena mai
 * completate (1 ora) e PDF mai rivisti (7 giorni) si chiudono con
 * `file.cancellato`; gli oggetti `uc/q/**` più vecchi di 1 ora senza una riga
 * attiva si cancellano.
 */
export async function cleanupQuarantine(executor: UcExecutor, env: UcFilesEnv, now: Date = new Date()): Promise<{ rows: number; objects: number }> {
  const standard = ucStore("standard", env);
  const [stale] = await executor.batch([
    staleQuarantineSql({ abandonedBefore: new Date(now.getTime() - QUARANTINE_TTL_MS), reviewBefore: new Date(now.getTime() - REVIEW_TTL_MS) }),
  ]);
  let rows = 0;
  for (const r of stale) {
    const reason = rowString(r.reason) === "revisione_scaduta" ? "revisione_scaduta" : "quarantena_scaduta";
    const zone: StorageZone = rowString(r.storage_zone) === "personale" ? "personale" : "standard";
    const [res] = await executor.batch([expireQuarantineSql({ workspaceId: String(r.workspace_id), caseId: String(r.case_id), fileId: String(r.id), reason, zone })]);
    if ((rowNumber(res[0]?.updated) ?? 0) > 0) {
      rows++;
      await safeDelete(standard, [rowString(r.quarantine_path)]);
    }
  }
  let objects = 0;
  if (standard) {
    const listed = (await standard.list("uc/q/", 2000)).filter((o) => now.getTime() - o.uploadedAt.getTime() > QUARANTINE_TTL_MS);
    for (let i = 0; i < listed.length; i += 200) {
      const chunk = listed.slice(i, i + 200).map((o) => o.path);
      const [active] = await executor.batch([activeQuarantinePathsSql(chunk)]);
      const keep = new Set(active.map((a) => String(a.quarantine_path)));
      const orphans = chunk.filter((p) => !keep.has(p));
      await safeDelete(standard, orphans);
      objects += orphans.length;
    }
  }
  return { rows, objects };
}

// ── Pannello di caricamento ───────────────────────────────────────────

export interface PanelFile {
  id: string;
  name: string;
  size: number | null;
  zone: StorageZone;
  itemKey: string | null;
  itemTitle: string | null;
  createdAt: string | null;
  uploadedByMe: boolean;
  fromReferent: boolean;
}

export interface UploadPanelData {
  /** Dove si carica: la voce (con chiave e titolo) o i documenti del caso. */
  target: { itemId: string | null; itemKey: string | null; itemTitle: string | null; zone: StorageZone };
  upload: { allowed: boolean; reason: string | null; clientMode: boolean; serverMaxBytes: number; clientMaxBytes: number };
  /** PDF in revisione manuale. */
  reviews: (PanelFile & { canReview: boolean; reviewReason: string | null })[];
  /** File tabellari utilizzabili senza scheda dataset. */
  datasetCandidates: (PanelFile & { suggestedSourceKey: string | null })[];
  /** Schede da verificare. */
  datasets: { id: string; sourceKey: string; version: number; rows: number | null; fileId: string | null; fileName: string | null; canDecide: boolean; dqError: boolean }[];
  /** File cancellabili (solo il Responsabile del caso). */
  deletable: PanelFile[];
  dataControllerLabel: string | null;
  canManage: boolean;
}

/**
 * Dati del pannello di caricamento (vista Lateral Space): solo metadati, mai
 * contenuti. La zona personale solo a chi ha l'accesso firmato.
 */
export async function loadUploadPanel(
  executor: UcExecutor,
  i: { workspaceId: string; caseId: string; itemId: string | null; userId: string; roles: readonly CaseRole[]; isLateralSpace: boolean; readOnly: boolean },
  env: UcFilesEnv,
): Promise<UploadPanelData | null> {
  const loaded = await loadTarget(executor, { workspaceId: i.workspaceId, caseId: i.caseId, itemId: i.itemId });
  const closed = !loaded.ok && loaded.code === "caso_chiuso";
  if (!loaded.ok && !closed) return null;
  const targetRow = loaded.ok ? loaded.value.row : null;
  const privacyClass = targetRow && i.itemId ? (rowVocab(PRIVACY_CLASSES, targetRow.privacy_class) ?? "riservato_azienda") : "riservato_azienda";
  const zone = zoneForClass(privacyClass);
  const zones = zoneState(targetRow?.a8_status ?? null, env);
  const isLs = i.isLateralSpace && i.roles.some((r) => r === "ls_lead" || r === "ls_analista");
  const access = isLs ? await personalAccess(executor, i.caseId, i.userId) : false;

  let reason: string | null = null;
  if (closed) reason = MESSAGES.caso_chiuso;
  else if (i.readOnly || !canUploadTo(i.roles, { itemId: i.itemId })) reason = MESSAGES.attore_non_ammesso;
  else if (!zone) reason = UPLOAD_MESSAGES.valore_sanitario;
  else {
    const z = checkZone(zone, zones);
    if (!z.ok) reason = z.message;
    else if (zone === "personale" && !access) reason = MESSAGES.zona_personale_negata;
  }

  const [files, datasets] = await executor.batch([
    panelFilesSql({ caseId: i.caseId, itemId: i.itemId, includePersonalZone: access }),
    panelDatasetsSql({ caseId: i.caseId, itemId: i.itemId }),
  ]);
  const toFile = (r: Row): PanelFile => ({
    id: String(r.id),
    name: rowString(r.file_name) ?? "file",
    size: rowNumber(r.size_bytes),
    zone: rowString(r.storage_zone) === "personale" ? "personale" : "standard",
    itemKey: rowString(r.item_key),
    itemTitle: rowString(r.item_title),
    createdAt: rowDate(r.created_at)?.toISOString() ?? null,
    uploadedByMe: rowString(r.uploaded_by_user_id) === i.userId,
    fromReferent: rowBool(r.from_referent),
  });
  const manage = isLs && !i.readOnly && !closed;
  const reviews = manage
    ? files
        .filter((r) => rowBool(r.in_review))
        .map((r) => {
          const can = canReviewFile({ roles: i.roles, isLateralSpace: i.isLateralSpace, userId: i.userId, uploadedByUserId: rowString(r.uploaded_by_user_id) });
          return { ...toFile(r), canReview: can.ok, reviewReason: can.ok ? null : can.message };
        })
    : [];
  const datasetCandidates = manage
    ? files
        .filter((r) => rowString(r.scan_status) === "pulito" && (rowBool(r.content_scanned) || rowBool(r.reviewed)) && !rowBool(r.has_dataset) && TABULAR_MIME_TYPES.includes(rowString(r.mime) ?? ""))
        .map((r) => ({ ...toFile(r), suggestedSourceKey: rowString(r.item_key) }))
    : [];
  const deletable = manage && i.roles.includes("ls_lead") ? files.map(toFile).slice(0, 100) : [];
  return {
    target: { itemId: i.itemId, itemKey: rowString(targetRow?.item_key), itemTitle: rowString(targetRow?.item_title), zone: zone ?? "standard" },
    upload: {
      allowed: reason === null,
      reason,
      clientMode: zone === "standard" && clientUploadAvailable(env),
      serverMaxBytes: UC_UPLOAD_LIMITS.serverMaxBytes,
      clientMaxBytes: UC_UPLOAD_LIMITS.clientBlobMaxBytes,
    },
    reviews,
    datasetCandidates,
    datasets: manage
      ? datasets.map((r) => ({
          id: String(r.id),
          sourceKey: String(r.source_key),
          version: rowNumber(r.dataset_version) ?? 1,
          rows: rowNumber(r.row_count),
          fileId: rowString(r.file_id),
          fileName: rowString(r.file_name),
          canDecide: rowString(r.uploaded_by_user_id) !== i.userId,
          dqError: rowBool(r.dq_error),
        }))
      : [],
    deletable,
    dataControllerLabel: rowString(targetRow?.data_controller_label),
    canManage: manage,
  };
}
