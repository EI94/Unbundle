/**
 * Costruttori SQL dei file e dei dataset dei casi d'uso (PIANO §2.3 tabelle 12
 * e 13, §6; D43).
 *
 * - La riga `uc_files` nasce **prima** del caricamento (`quarantineInsertSql`),
 *   in quarantena, legata a caso, voce, richiesta o utente e al limite di
 *   dimensione; il completamento accetta solo quel `fileId`.
 * - Ogni esito è un CAS sulla riga ancora da controllare (`scan_status =
 *   'in_quarantena' AND sha256 IS NULL AND deleted_at IS NULL`) con l'evento
 *   nella stessa istruzione: l'audit esiste solo per le righe davvero cambiate.
 * - Gli eventi portano solo MIME, dimensione, zona, motivo, categoria ed esito:
 *   mai il nome del file, mai il contenuto.
 *
 * Modulo puro: solo costruttori `{ text, params }`.
 */
import { eventInsertFromSql, eventInsertSql, type EventActor } from "../../db/queries/uc-events.ts";
import { VISIBLE_REQUEST_ITEM_STATES } from "../public-view.ts";
import type { Json } from "../types.ts";
import type { DatasetStatus, FilePersonalData, PrivacyClass, StorageZone } from "../vocab.ts";
import { cast, jsonb, raw, requireRows, toStatement, ucSql, type SqlFragment, type UcStatement } from "./statement.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64 = /^[0-9a-f]{64}$/;
const CODE = /^[a-z0-9_]{1,60}$/;
const VISIBLE_SQL = VISIBLE_REQUEST_ITEM_STATES.map((s) => `'${s}'`).join(", ");

function uuid(value: string, what: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error(`Id non valido (${what})`);
  return value;
}

function optUuid(value: string | null | undefined, what: string): string | null {
  return value === null || value === undefined ? null : uuid(value, what);
}

function code(value: string, what: string): string {
  if (!CODE.test(value)) throw new Error(`Codice non valido (${what})`);
  return value;
}

function hex(value: string): string {
  if (!HEX64.test(value)) throw new Error("Impronta non valida");
  return value;
}

/** Riga del file nel suo caso e workspace. */
function fileWhere(i: { workspaceId: string; caseId: string; fileId: string }): SqlFragment {
  return ucSql`f.id = ${cast(uuid(i.fileId, "file"), "uuid")} AND f.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")} AND f.workspace_id = ${cast(uuid(i.workspaceId, "workspace"), "uuid")}`;
}

/** Riga ancora da controllare: in quarantena, senza impronta, non cancellata. */
const UNPROCESSED = raw("f.scan_status = 'in_quarantena' AND f.sha256 IS NULL AND f.deleted_at IS NULL");
/** PDF in attesa della revisione manuale. */
const IN_REVIEW = raw(
  "f.scan_status = 'in_quarantena' AND f.sha256 IS NOT NULL AND f.deleted_at IS NULL AND f.reviewed_at IS NULL AND jsonb_typeof(f.scan_findings) = 'object' AND (f.scan_findings ->> 'revisione_manuale') = 'true'",
);

// ── Destinazione del caricamento ──────────────────────────────────────

/**
 * Caso (aperto o no, stato, blocco `a8`, titolare dei dati) e, se indicata,
 * la voce del caso con classe privacy, visibilità, tipo di risposta e colonne
 * vietate (`spec.forbidden_columns`, scritte dal normalizzatore del template).
 * La definizione del template (MB di JSON) non si legge.
 */
export function uploadTargetSql(i: { workspaceId: string; caseId: string; itemId: string | null }): UcStatement {
  const caseId = cast(uuid(i.caseId, "caso"), "uuid");
  const itemId = cast(optUuid(i.itemId, "voce"), "uuid");
  return toStatement(ucSql`SELECT c.id AS case_id, c.status AS case_status, c.setup_completed_at IS NOT NULL AS ready, c.data_controller_label,
  (SELECT b.status FROM uc_blockers b WHERE b.case_id = c.id AND b.key = 'a8' LIMIT 1) AS a8_status,
  i.id AS item_id, i.key AS item_key, i.kind AS item_kind, i.title AS item_title, i.status AS item_status, i.privacy_class, i.value_visibility,
  i.response_type, i.assignee_contact_id,
  CASE WHEN jsonb_typeof(i.spec -> 'forbidden_columns') = 'array' THEN i.spec -> 'forbidden_columns' ELSE '[]'::jsonb END AS item_forbidden
FROM uc_cases c
LEFT JOIN uc_items i ON i.case_id = c.id AND i.id = ${itemId} AND i.deleted_at IS NULL
WHERE c.id = ${caseId} AND c.workspace_id = ${cast(uuid(i.workspaceId, "workspace"), "uuid")}`);
}

/** Accesso dell'utente alla zona personale del caso (`personal_zone_access` su un ruolo di Lateral Space). */
export function memberZoneAccessSql(i: { caseId: string; userId: string }): UcStatement {
  return toStatement(ucSql`SELECT coalesce(bool_or(m.personal_zone_access), false) AS access FROM uc_case_members m
WHERE m.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")} AND m.user_id = ${cast(uuid(i.userId, "utente"), "uuid")}
  AND m.role IN ('ls_lead', 'ls_analista', 'ls_sviluppatore')`);
}

export interface QuarantineInsert {
  id: string;
  workspaceId: string;
  caseId: string;
  itemId: string | null;
  /** Richiesta del link (caricamento del referente). */
  requestId: string | null;
  contactId: string | null;
  /** Utente che carica dall'interno. */
  userId: string | null;
  fileName: string;
  zone: StorageZone;
  /** Percorso esatto della quarantena (modalità client-Blob); null nella modalità server. */
  quarantinePath: string | null;
  privacyClass: PrivacyClass;
  maxBytes: number;
  /** Riferimento della chiave della zona personale (CHECK `personal_encrypted`); null nella zona standard. */
  encryptionKeyRef?: string | null;
}

/**
 * La riga nasce in quarantena, prima del caricamento (D43). Solo su un caso
 * pronto e non chiuso, e con la voce del caso (non cancellata) se indicata;
 * altrimenti `uc:destinazione_non_valida` annulla il batch.
 */
export function quarantineInsertSql(i: QuarantineInsert): UcStatement {
  if (!Number.isInteger(i.maxBytes) || i.maxBytes <= 0) throw new Error("Limite di dimensione non valido");
  if ((i.userId === null) === (i.contactId === null)) throw new Error("Serve un solo autore: utente o referente");
  if (i.contactId !== null && i.requestId === null) throw new Error("Il referente carica da una richiesta");
  if (typeof i.fileName !== "string" || !i.fileName || i.fileName.length > 255) throw new Error("Nome del file non valido");
  if (i.zone === "personale" && !i.encryptionKeyRef) throw new Error("La zona personale vuole la cifratura");
  const itemId = optUuid(i.itemId, "voce");
  const itemJoin = itemId
    ? ucSql`JOIN uc_items it ON it.case_id = c.id AND it.id = ${cast(itemId, "uuid")} AND it.deleted_at IS NULL`
    : raw("");
  const insert = ucSql`INSERT INTO uc_files (id, workspace_id, case_id, item_id, request_id, uploaded_by_contact_id, uploaded_by_user_id, file_name,
  storage_zone, quarantine_path, encryption_key_ref, privacy_class, max_size_bytes, uploader_declaration, scan_status)
SELECT ${cast(uuid(i.id, "file"), "uuid")}, c.workspace_id, c.id, ${cast(itemId, "uuid")}, ${cast(optUuid(i.requestId, "richiesta"), "uuid")},
  ${cast(optUuid(i.contactId, "referente"), "uuid")}, ${cast(optUuid(i.userId, "utente"), "uuid")}, ${cast(i.fileName, "text")},
  ${cast(i.zone, "text")}, ${cast(i.quarantinePath, "text")}, ${cast(i.zone === "personale" ? i.encryptionKeyRef : null, "text")}, ${cast(i.privacyClass, "text")}, ${cast(i.maxBytes, "int")}, true, 'in_quarantena'
FROM uc_cases c ${itemJoin}
WHERE c.id = ${cast(uuid(i.caseId, "caso"), "uuid")} AND c.workspace_id = ${cast(uuid(i.workspaceId, "workspace"), "uuid")}
  AND c.setup_completed_at IS NOT NULL AND c.status <> 'chiuso'
RETURNING id`;
  return toStatement(requireRows(insert, 1, "destinazione_non_valida"));
}

// ── Lettura della riga ────────────────────────────────────────────────

/** La riga del file con la voce (stato, classe, visibilità, colonne vietate) e lo stato di `a8`. Mai la definizione del template. */
export function fileRowSql(i: { workspaceId: string; caseId: string; fileId: string }): UcStatement {
  return toStatement(ucSql`SELECT f.id, f.workspace_id, f.case_id, f.item_id, f.request_id, f.uploaded_by_contact_id, f.uploaded_by_user_id, f.file_name,
  f.mime, f.size_bytes, f.sha256, f.storage_zone, f.blob_path, f.quarantine_path, f.encryption_key_ref, f.privacy_class, f.max_size_bytes,
  f.scan_status, f.scan_findings, f.content_scanned, f.reviewed_at, f.deleted_at, f.created_at,
  (${IN_REVIEW}) AS in_review,
  it.key AS item_key, it.title AS item_title, it.status AS item_status, it.privacy_class AS item_privacy_class, it.value_visibility AS item_visibility,
  it.kind AS item_kind, it.response_type AS item_response_type,
  CASE WHEN jsonb_typeof(it.spec -> 'forbidden_columns') = 'array' THEN it.spec -> 'forbidden_columns' ELSE '[]'::jsonb END AS item_forbidden,
  (SELECT b.status FROM uc_blockers b WHERE b.case_id = f.case_id AND b.key = 'a8' LIMIT 1) AS a8_status,
  c.status AS case_status
FROM uc_files f
JOIN uc_cases c ON c.id = f.case_id
LEFT JOIN uc_items it ON it.id = f.item_id AND it.case_id = f.case_id
WHERE ${fileWhere(i)}`);
}

// ── Esiti del controllo ───────────────────────────────────────────────

export interface FileEventInput {
  workspaceId: string;
  caseId: string;
  actor: EventActor;
  ipHash?: string | null;
  userAgent?: string | null;
}

function fileEvent(e: FileEventInput, type: "file.caricato" | "file.rifiutato" | "file.revisionato" | "file.cancellato", payload: Record<string, unknown>, from = "u"): SqlFragment {
  return eventInsertFromSql({
    type,
    workspaceId: e.workspaceId,
    caseId: e.caseId,
    actor: e.actor,
    targetType: "file",
    from,
    targetIdColumn: `${from}.id`,
    payload,
    ipHash: e.ipHash ?? null,
    userAgent: e.userAgent ?? null,
  });
}

/** Dimensione salvabile: positiva ed entro il limite della riga, altrimenti null (CHECK `size_positive`). */
function sizeOrNull(size: number | null, maxBytes: number): number | null {
  return size !== null && Number.isInteger(size) && size > 0 && size <= maxBytes ? size : null;
}

export interface CleanFileUpdate extends FileEventInput {
  fileId: string;
  zone: StorageZone;
  mime: string;
  sizeBytes: number;
  maxBytes: number;
  sha256: string;
  blobPath: string;
  encryptionKeyRef: string | null;
  personalData: FilePersonalData;
  findings: Json;
  preview: Json | null;
  contentScanned: boolean;
}

/** File pulito: oggetto definitivo, metadati, anteprima mascherata; evento `file.caricato`. */
export function markCleanSql(i: CleanFileUpdate): UcStatement {
  if (i.zone === "personale" && !i.encryptionKeyRef) throw new Error("La zona personale vuole la cifratura");
  const size = sizeOrNull(i.sizeBytes, i.maxBytes);
  if (size === null) throw new Error("Dimensione non valida");
  const ev = fileEvent(i, "file.caricato", { mime: i.mime, size_bytes: size, zona: i.zone, outcome: "pulito" });
  return toStatement(ucSql`WITH u AS (
  UPDATE uc_files f SET scan_status = 'pulito', mime = ${cast(i.mime, "text")}, size_bytes = ${cast(size, "int")}, sha256 = ${cast(hex(i.sha256), "text")},
    blob_path = ${cast(i.blobPath, "text")}, quarantine_path = NULL, encryption_key_ref = ${cast(i.encryptionKeyRef, "text")},
    personal_data = ${cast(i.personalData, "text")}, scan_findings = ${jsonb(i.findings)},
    preview = ${i.zone === "standard" && i.preview !== null ? jsonb(i.preview) : raw("NULL")}, content_scanned = ${cast(i.contentScanned, "boolean")}
  WHERE ${fileWhere(i)} AND ${UNPROCESSED} AND f.storage_zone = ${cast(i.zone, "text")}
  RETURNING f.id
), ev AS (${ev})
SELECT count(*)::int AS updated FROM u`);
}

export interface ReviewPendingUpdate extends FileEventInput {
  fileId: string;
  mime: string;
  sizeBytes: number;
  maxBytes: number;
  sha256: string;
  quarantinePath: string;
  personalData: FilePersonalData;
  findings: Json;
}

/** PDF con testo scarso: resta in quarantena (zona standard) per la revisione di un'altra persona di Lateral Space. */
export function markReviewPendingSql(i: ReviewPendingUpdate): UcStatement {
  const size = sizeOrNull(i.sizeBytes, i.maxBytes);
  if (size === null) throw new Error("Dimensione non valida");
  const ev = fileEvent(i, "file.caricato", { mime: i.mime, size_bytes: size, zona: "standard", outcome: "revisione_manuale" });
  return toStatement(ucSql`WITH u AS (
  UPDATE uc_files f SET mime = ${cast(i.mime, "text")}, size_bytes = ${cast(size, "int")}, sha256 = ${cast(hex(i.sha256), "text")},
    quarantine_path = ${cast(i.quarantinePath, "text")}, personal_data = ${cast(i.personalData, "text")}, scan_findings = ${jsonb(i.findings)},
    content_scanned = false
  WHERE ${fileWhere(i)} AND ${UNPROCESSED} AND f.storage_zone = 'standard'
  RETURNING f.id
), ev AS (${ev})
SELECT count(*)::int AS updated FROM u`);
}

export interface RejectedFileUpdate extends FileEventInput {
  fileId: string;
  zone: StorageZone;
  mime: string | null;
  sizeBytes: number | null;
  maxBytes: number;
  sha256: string | null;
  /** `deletion_reason` e `motivo` dell'evento. */
  reason: string;
  /** Categoria per l'evento (es. `sanitario`). */
  category: string | null;
  findings: Json;
  personalData: FilePersonalData;
}

/**
 * File rifiutato: cancellato subito (nessun percorso resta), con l'esito dei
 * controlli (solo categorie e conteggi) ed evento `file.rifiutato` senza contenuto.
 */
export function markRejectedSql(i: RejectedFileUpdate): UcStatement {
  const size = sizeOrNull(i.sizeBytes, i.maxBytes);
  const mime = i.mime && /^[a-z0-9.+-]{1,60}\/[a-z0-9.+-]{1,80}$/.test(i.mime) ? i.mime : null;
  const ev = fileEvent(i, "file.rifiutato", { mime, size_bytes: size ?? undefined, zona: i.zone, motivo: code(i.reason, "motivo"), categoria: i.category ?? undefined });
  return toStatement(ucSql`WITH u AS (
  UPDATE uc_files f SET scan_status = 'rifiutato', mime = ${cast(mime, "text")}, size_bytes = ${cast(size, "int")},
    sha256 = ${cast(i.sha256 ? hex(i.sha256) : null, "text")}, blob_path = NULL, quarantine_path = NULL, preview = NULL, extracted_text = NULL,
    personal_data = ${cast(i.personalData, "text")}, scan_findings = ${jsonb(i.findings)}, deleted_at = now(), deletion_reason = ${cast(i.reason, "text")}
  WHERE ${fileWhere(i)} AND ${UNPROCESSED}
  RETURNING f.id
), ev AS (${ev})
SELECT count(*)::int AS updated FROM u`);
}

/**
 * File doppione di uno già caricato nella stessa voce e zona: la nuova riga si
 * chiude (l'indice unico sull'impronta la escluderebbe comunque) e si usa
 * quella esistente.
 */
export function markDuplicateSql(i: FileEventInput & { fileId: string; zone: StorageZone; mime: string; sizeBytes: number; maxBytes: number; sha256: string }): UcStatement {
  const size = sizeOrNull(i.sizeBytes, i.maxBytes);
  const ev = fileEvent(i, "file.caricato", { mime: i.mime, size_bytes: size ?? undefined, zona: i.zone, outcome: "doppione" });
  return toStatement(ucSql`WITH u AS (
  UPDATE uc_files f SET mime = ${cast(i.mime, "text")}, size_bytes = ${cast(size, "int")}, sha256 = ${cast(hex(i.sha256), "text")},
    blob_path = NULL, quarantine_path = NULL, deleted_at = now(), deletion_reason = 'doppione'
  WHERE ${fileWhere(i)} AND ${UNPROCESSED}
  RETURNING f.id
), ev AS (${ev})
SELECT count(*)::int AS updated FROM u`);
}

/**
 * Un file già caricato con la stessa impronta nella stessa voce (o tra i
 * documenti del caso) e nella stessa zona, ancora valido o in revisione.
 */
export function duplicateLookupSql(i: { caseId: string; itemId: string | null; zone: StorageZone; sha256: string; excludeFileId: string }): UcStatement {
  return toStatement(ucSql`SELECT f.id, f.file_name, f.scan_status, f.request_id, f.uploaded_by_user_id, f.uploaded_by_contact_id, f.size_bytes,
  f.content_scanned, f.reviewed_at IS NOT NULL AS reviewed
FROM uc_files f
WHERE f.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")} AND f.item_id IS NOT DISTINCT FROM ${cast(optUuid(i.itemId, "voce"), "uuid")}
  AND f.storage_zone = ${cast(i.zone, "text")} AND f.sha256 = ${cast(hex(i.sha256), "text")}
  AND f.deleted_at IS NULL AND f.scan_status <> 'rifiutato' AND f.id <> ${cast(uuid(i.excludeFileId, "file"), "uuid")}
ORDER BY f.created_at
LIMIT 1`);
}

// ── Revisione, cancellazione, lettura ─────────────────────────────────

export interface ReviewDecision extends FileEventInput {
  fileId: string;
  reviewerUserId: string;
  outcome: "pulito" | "rifiutato";
  /** Percorso definitivo (solo per `pulito`). */
  blobPath: string | null;
  mime: string | null;
  sizeBytes: number | null;
}

/**
 * Revisione manuale di un PDF in quarantena (§6.3): un'altra persona di
 * Lateral Space lo segna pulito (copiato nella zona standard) o rifiutato
 * (cancellato). Il CHECK del database vieta comunque che revisore e autore
 * coincidano.
 */
export function reviewDecisionSql(i: ReviewDecision): UcStatement {
  const reviewer = cast(uuid(i.reviewerUserId, "revisore"), "uuid");
  if (i.outcome === "pulito" && !i.blobPath) throw new Error("Percorso definitivo mancante");
  const set =
    i.outcome === "pulito"
      ? ucSql`scan_status = 'pulito', blob_path = ${cast(i.blobPath, "text")}, quarantine_path = NULL`
      : raw("scan_status = 'rifiutato', blob_path = NULL, quarantine_path = NULL, preview = NULL, deleted_at = now(), deletion_reason = 'revisione_rifiutata'");
  const ev = fileEvent(i, "file.revisionato", { mime: i.mime ?? undefined, size_bytes: i.sizeBytes ?? undefined, zona: "standard", outcome: i.outcome });
  return toStatement(ucSql`WITH u AS (
  UPDATE uc_files f SET ${set}, reviewed_by_user_id = ${reviewer}, reviewed_at = now()
  WHERE ${fileWhere(i)} AND ${IN_REVIEW} AND f.storage_zone = 'standard'
    AND f.uploaded_by_user_id IS DISTINCT FROM ${reviewer}
  RETURNING f.id
), ev AS (${ev})
SELECT count(*)::int AS updated FROM u`);
}

/**
 * Cancellazione di un file da parte di Lateral Space: solo se non è una prova
 * usata dal caso (risposta validata, designazione dei firmatari, prove dei
 * blocchi, prova scritta di un gate). La riga resta, senza percorsi.
 */
export function deleteFileSql(i: FileEventInput & { fileId: string; reason: string }): UcStatement {
  const reason = code(i.reason, "motivo");
  const id = cast(uuid(i.fileId, "file"), "uuid");
  const ev = fileEvent(i, "file.cancellato", { motivo: reason }, "u");
  return toStatement(ucSql`WITH used AS (
  SELECT 1 FROM uc_items it JOIN uc_answers a ON a.id = it.validated_answer_id
  WHERE it.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")} AND jsonb_typeof(a.file_ids) = 'array' AND a.file_ids ? (${id}::text)
  UNION ALL
  SELECT 1 FROM uc_cases c CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(c.signers_designation) = 'object' THEN c.signers_designation ELSE '{}'::jsonb END) d
  WHERE c.id = ${cast(uuid(i.caseId, "caso"), "uuid")} AND jsonb_typeof(d.value) = 'object' AND d.value ->> 'evidence_file_id' = (${id}::text)
  UNION ALL
  SELECT 1 FROM uc_blockers b WHERE b.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")} AND jsonb_typeof(b.evidence) = 'object' AND b.evidence ->> 'file_id' = (${id}::text)
  UNION ALL
  SELECT 1 FROM uc_gate_reviews g WHERE g.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")} AND g.written_evidence_file_id = ${id}
), u AS (
  UPDATE uc_files f SET blob_path = NULL, quarantine_path = NULL, preview = NULL, extracted_text = NULL, deleted_at = now(), deletion_reason = ${cast(reason, "text")}
  WHERE ${fileWhere(i)} AND f.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM used)
  RETURNING f.id
), ev AS (${ev})
SELECT (SELECT count(*) FROM u)::int AS updated, EXISTS (SELECT 1 FROM used) AS in_use`);
}

/** Evento di lettura (download o apertura per la revisione). */
export function fileReadEventSql(i: FileEventInput & { fileId: string; zone: StorageZone; mime: string | null; sizeBytes: number | null; motivo: "download" | "revisione" }): UcStatement {
  return toStatement(
    eventInsertSql({
      type: "file.scaricato",
      workspaceId: i.workspaceId,
      caseId: i.caseId,
      actor: i.actor,
      targetType: "file",
      targetId: uuid(i.fileId, "file"),
      payload: { mime: i.mime ?? undefined, size_bytes: i.sizeBytes ?? undefined, zona: i.zone, motivo: i.motivo },
      ipHash: i.ipHash ?? null,
      userAgent: i.userAgent ?? null,
    }),
  );
}

// ── Pulizia della quarantena ──────────────────────────────────────────

/**
 * Righe da chiudere: caricamenti mai completati (in quarantena, senza
 * impronta) più vecchi di `abandonedBefore`; PDF in revisione mai rivisti più
 * vecchi di `reviewBefore`.
 */
export function staleQuarantineSql(i: { abandonedBefore: Date; reviewBefore: Date; limit?: number }): UcStatement {
  return toStatement(ucSql`SELECT f.id, f.workspace_id, f.case_id, f.storage_zone, f.quarantine_path, f.mime, f.size_bytes,
  CASE WHEN f.sha256 IS NULL THEN 'quarantena_scaduta' ELSE 'revisione_scaduta' END AS reason
FROM uc_files f
WHERE f.scan_status = 'in_quarantena' AND f.deleted_at IS NULL
  AND ((f.sha256 IS NULL AND f.created_at < ${cast(i.abandonedBefore, "timestamptz")})
    OR (f.sha256 IS NOT NULL AND f.created_at < ${cast(i.reviewBefore, "timestamptz")}))
ORDER BY f.created_at
LIMIT ${cast(Math.min(Math.max(i.limit ?? 500, 1), 2000), "int")}`);
}

/** Chiude una riga di quarantena scaduta, con l'evento `file.cancellato` (attore: sistema). */
export function expireQuarantineSql(i: { workspaceId: string; caseId: string; fileId: string; reason: "quarantena_scaduta" | "revisione_scaduta"; zone: StorageZone }): UcStatement {
  const ev = fileEvent({ workspaceId: i.workspaceId, caseId: i.caseId, actor: { type: "sistema" } }, "file.cancellato", { motivo: i.reason, zona: i.zone });
  return toStatement(ucSql`WITH u AS (
  UPDATE uc_files f SET quarantine_path = NULL, blob_path = NULL, preview = NULL, deleted_at = now(), deletion_reason = ${cast(i.reason, "text")}
  WHERE ${fileWhere(i)} AND f.scan_status = 'in_quarantena' AND f.deleted_at IS NULL
  RETURNING f.id
), ev AS (${ev})
SELECT count(*)::int AS updated FROM u`);
}

/** Percorsi di quarantena ancora legati a una riga attiva (gli altri oggetti si possono cancellare). */
export function activeQuarantinePathsSql(paths: readonly string[]): UcStatement {
  return toStatement(ucSql`SELECT f.quarantine_path FROM uc_files f
WHERE f.quarantine_path = ANY(${cast([...paths], "text[]")}) AND f.scan_status = 'in_quarantena' AND f.deleted_at IS NULL`);
}

// ── Dataset ───────────────────────────────────────────────────────────

/** Campi collegati alla voce della fonte (per la proposta di mappatura delle colonne). */
export function linkedFieldsSql(i: { caseId: string; itemId: string }): UcStatement {
  const caseId = cast(uuid(i.caseId, "caso"), "uuid");
  const itemId = cast(uuid(i.itemId, "voce"), "uuid");
  return toStatement(ucSql`SELECT DISTINCT x.key, x.title FROM uc_item_links l
JOIN uc_items x ON x.case_id = l.case_id AND x.id = CASE WHEN l.from_item_id = ${itemId} THEN l.to_item_id ELSE l.from_item_id END
WHERE l.case_id = ${caseId} AND (l.from_item_id = ${itemId} OR l.to_item_id = ${itemId}) AND x.kind = 'campo' AND x.deleted_at IS NULL
ORDER BY x.key
LIMIT 500`);
}

export interface DatasetInsert {
  id: string;
  workspaceId: string;
  caseId: string;
  itemId: string | null;
  fileId: string;
  sourceKey: string;
  periodFrom: string | null;
  periodTo: string | null;
  extractedAt: string | null;
  extractionMethod: string | null;
  timezone: string | null;
  currency: string | null;
  rowCount: number;
  columnMapping: Json;
  schema: Json;
  pseudonymized: boolean;
  pseudonymizationMethod: string | null;
  personalData: FilePersonalData;
  piiColumns: Json;
  dataControllerLabel: string;
  quality: Json;
  actor: EventActor;
  /** Controlli di qualità automatici da registrare (solo con la voce). */
  checks: { checkKey: string; outcome: "ok" | "avviso" | "errore"; message: string; details: Json }[];
}

/**
 * Scheda dataset con versione progressiva per fonte (`max + 1` nella stessa
 * istruzione; l'indice unico fa fallire un doppio inserimento concorrente),
 * evento `dataset.creato` e, con la voce, i controlli di qualità automatici in
 * `uc_validations`. Solo da un file utilizzabile del caso.
 */
export function datasetInsertSql(i: DatasetInsert): UcStatement {
  if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(i.sourceKey)) throw new Error("Chiave della fonte non valida");
  const caseId = cast(uuid(i.caseId, "caso"), "uuid");
  const id = cast(uuid(i.id, "dataset"), "uuid");
  const itemId = optUuid(i.itemId, "voce");
  const ev = eventInsertFromSql({
    type: "dataset.creato",
    workspaceId: uuid(i.workspaceId, "workspace"),
    caseId: i.caseId,
    actor: i.actor,
    targetType: "dataset",
    from: "d",
    targetIdColumn: "d.id",
    payload: { source_key: i.sourceKey, rows: i.rowCount },
    rowPayload: { dataset_version: "d.dataset_version" },
  });
  const checks = itemId && i.checks.length > 0
    ? ucSql`, v AS (
  INSERT INTO uc_validations (case_id, item_id, dataset_id, check_key, kind, outcome, message, details, by_user_id)
  SELECT d.case_id, d.item_id, d.id, x.check_key, 'automatica', x.outcome, x.message, x.details, NULL
  FROM d CROSS JOIN jsonb_to_recordset(${jsonb(i.checks.map((c) => ({ check_key: c.checkKey, outcome: c.outcome, message: c.message, details: c.details })))})
    AS x(check_key text, outcome text, message text, details jsonb)
  WHERE d.item_id IS NOT NULL
)`
    : raw("");
  return toStatement(ucSql`WITH src AS (
  SELECT f.id FROM uc_files f
  WHERE f.id = ${cast(uuid(i.fileId, "file"), "uuid")} AND f.case_id = ${caseId} AND f.deleted_at IS NULL
    AND f.scan_status = 'pulito' AND (f.content_scanned OR f.reviewed_at IS NOT NULL)
), d AS (
  INSERT INTO uc_datasets (id, case_id, item_id, file_id, source_key, dataset_version, period_from, period_to, extracted_at, extraction_method,
    timezone, currency, row_count, column_mapping, schema, pseudonymized, pseudonymization_method, personal_data, pii_columns,
    data_controller_label, quality, status)
  SELECT ${id}, ${caseId}, ${cast(itemId, "uuid")}, src.id, ${cast(i.sourceKey, "text")},
    coalesce((SELECT max(x.dataset_version) FROM uc_datasets x WHERE x.case_id = ${caseId} AND x.source_key = ${cast(i.sourceKey, "text")}), 0) + 1,
    ${cast(i.periodFrom, "date")}, ${cast(i.periodTo, "date")}, ${cast(i.extractedAt, "timestamptz")}, ${cast(i.extractionMethod, "text")},
    ${cast(i.timezone, "text")}, ${cast(i.currency, "text")}, ${cast(i.rowCount, "int")}, ${jsonb(i.columnMapping)}, ${jsonb(i.schema)},
    ${cast(i.pseudonymized, "boolean")}, ${cast(i.pseudonymizationMethod, "text")}, ${cast(i.personalData, "text")}, ${jsonb(i.piiColumns)},
    ${cast(i.dataControllerLabel, "text")}, ${jsonb(i.quality)}, 'ricevuto'
  FROM src
  RETURNING id, case_id, item_id, dataset_version
)${checks}, ev AS (${ev})
SELECT d.id, d.dataset_version FROM d`);
}

/** Scheda dataset con il file da cui viene (autore, zona, utilizzabilità). */
export function datasetRowSql(i: { workspaceId: string; caseId: string; datasetId: string }): UcStatement {
  return toStatement(ucSql`SELECT d.id, d.source_key, d.dataset_version, d.status, d.row_count, d.item_id, d.file_id,
  f.uploaded_by_user_id, f.storage_zone
FROM uc_datasets d
JOIN uc_cases c ON c.id = d.case_id
LEFT JOIN uc_files f ON f.id = d.file_id AND f.case_id = d.case_id
WHERE d.id = ${cast(uuid(i.datasetId, "dataset"), "uuid")} AND d.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")}
  AND c.workspace_id = ${cast(uuid(i.workspaceId, "workspace"), "uuid")} AND d.deleted_at IS NULL`);
}

/**
 * Esito della verifica della scheda (Lateral Space, mai chi ha caricato il
 * file): `ricevuto|profilato|in_verifica → validato|rifiutato`, evento
 * `dataset.validato` con lo stato di arrivo nella colonna `to_state`.
 */
export function datasetDecisionSql(i: { workspaceId: string; caseId: string; datasetId: string; userId: string; outcome: Extract<DatasetStatus, "validato" | "rifiutato">; actor: EventActor }): UcStatement {
  const user = cast(uuid(i.userId, "utente"), "uuid");
  const ev = eventInsertFromSql({
    type: "dataset.validato",
    workspaceId: uuid(i.workspaceId, "workspace"),
    caseId: i.caseId,
    actor: i.actor,
    targetType: "dataset",
    from: "u",
    targetIdColumn: "u.id",
    fromStateColumn: "u.prev",
    toStateColumn: "u.status",
    rowPayload: { source_key: "u.source_key", dataset_version: "u.dataset_version", rows: "u.row_count" },
  });
  return toStatement(ucSql`WITH prev AS (
  SELECT d.id, d.status AS prev FROM uc_datasets d
  WHERE d.id = ${cast(uuid(i.datasetId, "dataset"), "uuid")} AND d.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")} AND d.deleted_at IS NULL
    AND d.status IN ('ricevuto', 'profilato', 'in_verifica')
), u AS (
  UPDATE uc_datasets d SET status = ${cast(i.outcome, "text")}, validated_by_user_id = ${i.outcome === "validato" ? user : raw("NULL")},
    validated_at = ${i.outcome === "validato" ? raw("now()") : raw("NULL")}, updated_at = now()
  FROM prev
  WHERE d.id = prev.id AND NOT EXISTS (SELECT 1 FROM uc_files f WHERE f.id = d.file_id AND f.uploaded_by_user_id = ${user})
  RETURNING d.id, d.status, prev.prev, d.source_key, d.dataset_version, d.row_count
), ev AS (${ev})
SELECT count(*)::int AS updated FROM u`);
}

// ── Modello Excel delle tabelle (link del referente) ──────────────────

/** Voce del link (riga visibile, ancora assegnata al referente) con il titolo e la configurazione della risposta. */
export function referentTableItemSql(i: { caseId: string; requestId: string; contactId: string; itemId: string }): UcStatement {
  return toStatement(ucSql`SELECT i.id, i.key, i.title, i.response_type, i.response_config FROM uc_request_items ri
JOIN uc_items i ON i.id = ri.item_id AND i.case_id = ri.case_id
WHERE ri.request_id = ${cast(uuid(i.requestId, "richiesta"), "uuid")} AND ri.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")}
  AND ri.item_id = ${cast(uuid(i.itemId, "voce"), "uuid")} AND ri.state IN (${raw(VISIBLE_SQL)})
  AND i.assignee_contact_id = ${cast(uuid(i.contactId, "referente"), "uuid")} AND i.deleted_at IS NULL`);
}

// ── Pannello di caricamento ───────────────────────────────────────────

/**
 * File del pannello (caso intero o una voce): in revisione, utilizzabili per
 * una scheda dataset, cancellabili. Solo metadati.
 */
export function panelFilesSql(i: { caseId: string; itemId: string | null; includePersonalZone: boolean }): UcStatement {
  const caseId = cast(uuid(i.caseId, "caso"), "uuid");
  const scope = i.itemId ? ucSql`AND f.item_id = ${cast(uuid(i.itemId, "voce"), "uuid")}` : raw("");
  return toStatement(ucSql`SELECT f.id, f.file_name, f.mime, f.size_bytes, f.storage_zone, f.scan_status, f.content_scanned, f.reviewed_at IS NOT NULL AS reviewed,
  f.uploaded_by_user_id, f.uploaded_by_contact_id IS NOT NULL AS from_referent, f.created_at, f.item_id, it.key AS item_key, it.title AS item_title,
  it.kind AS item_kind, it.response_type AS item_response_type, (${IN_REVIEW}) AS in_review,
  EXISTS (SELECT 1 FROM uc_datasets d WHERE d.file_id = f.id AND d.deleted_at IS NULL) AS has_dataset
FROM uc_files f
LEFT JOIN uc_items it ON it.id = f.item_id AND it.case_id = f.case_id
WHERE f.case_id = ${caseId} AND f.deleted_at IS NULL AND f.scan_status <> 'rifiutato' ${scope}
  AND (${cast(i.includePersonalZone, "boolean")} OR f.storage_zone = 'standard')
ORDER BY f.created_at DESC
LIMIT 200`);
}

/** Schede dataset da verificare (caso intero o una voce). */
export function panelDatasetsSql(i: { caseId: string; itemId: string | null }): UcStatement {
  const caseId = cast(uuid(i.caseId, "caso"), "uuid");
  const scope = i.itemId ? ucSql`AND d.item_id = ${cast(uuid(i.itemId, "voce"), "uuid")}` : raw("");
  return toStatement(ucSql`SELECT d.id, d.source_key, d.dataset_version, d.status, d.row_count, d.file_id, f.uploaded_by_user_id, f.file_name,
  EXISTS (SELECT 1 FROM uc_validations v WHERE v.dataset_id = d.id AND v.outcome = 'errore') AS dq_error
FROM uc_datasets d
LEFT JOIN uc_files f ON f.id = d.file_id
WHERE d.case_id = ${caseId} AND d.deleted_at IS NULL AND d.status IN ('ricevuto', 'profilato', 'in_verifica') ${scope}
ORDER BY d.created_at DESC
LIMIT 100`);
}
