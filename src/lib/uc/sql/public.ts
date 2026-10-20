/**
 * Costruttori SQL delle API pubbliche a token (`/api/r/[token]/…`) e della
 * pagina del referente (PIANO §2.3 tabelle 9, 9-bis, 10, 11, 26; §5.4, §5.5).
 *
 * Regole:
 * - il link si legge in **una sola SQL**: impronta del token non revocato →
 *   richiesta con `uc_request_visible` (orologio del DB), referente attivo;
 * - ogni scrittura ripete nel batch la guardia del link (`linkGuardSql`: token
 *   non revocato e `uc_request_live`), così un link revocato a metà non scrive;
 * - nessun valore personale o sanitario esce dalle letture: per quelle classi
 *   `value` e `value_normalized` sono `NULL` già in SQL, e le bozze non si
 *   leggono né si scrivono;
 * - gli eventi passano da `eventInsertSql`/`eventInsertFromSql` (payload
 *   ripulito), con l'impronta dell'IP e lo user agent troncato, mai l'IP.
 *
 * Modulo puro: solo costruttori `{ text, params }`.
 */
import { eventInsertFromSql, eventInsertSql, type EventActor } from "../../db/queries/uc-events.ts";
import type { Json } from "../types.ts";
import {
  ACTIVE_REQUEST_ITEM_STATES,
  HEALTH_PRIVACY_CLASS,
  PERSONAL_PRIVACY_CLASSES,
  type AnswerDevice,
  type AnswerKind,
  type Confidence,
  type SourceBasis,
} from "../vocab.ts";
import { VISIBLE_REQUEST_ITEM_STATES } from "../public-view.ts";
import { REQUEST_LINK_TTL_DAYS, requestLiveSql, requestVisibleSql } from "./requests.ts";
import { cast, jsonb, raw, requireRows, toStatement, ucSql, type SqlFragment, type UcStatement } from "./statement.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64 = /^[0-9a-f]{64}$/;
const CODE = /^[a-z0-9_]{1,60}$/;

function uuid(value: string, what: string): string {
  if (!UUID.test(value)) throw new Error(`Id non valido (${what})`);
  return value;
}

function uuids(values: readonly string[], what: string): string[] {
  return values.map((v) => uuid(v, what));
}

function list(values: readonly string[]): string {
  return values.map((v) => `'${v}'`).join(", ");
}

/** Classi senza valori in chiaro: personali (solo cifrati) e sanitaria (mai). */
const NO_PLAINTEXT_SQL = list([...PERSONAL_PRIVACY_CLASSES, HEALTH_PRIVACY_CLASS]);
const ACTIVE_SQL = list(ACTIVE_REQUEST_ITEM_STATES);
const VISIBLE_SQL = list(VISIBLE_REQUEST_ITEM_STATES);
/** Stati della voce in cui il referente può ancora scrivere (vedi `referentCapabilities`). */
const ANSWERABLE_SQL = list(["chiesta", "mancante", "parziale", "validata"]);
/** Scadenza di un link dall'invio, in ore come in `request-commands.ts` (niente deriva al cambio d'ora). */
const EXPIRY_SQL = raw(`now() + interval '${REQUEST_LINK_TTL_DAYS * 24} hours'`);

// ── Lettura del link ──────────────────────────────────────────────────

/**
 * Il link dall'impronta del token, in una sola SQL. Nessuna riga = link non
 * valido (token sbagliato, revocato, richiesta scaduta o revocata, bozza,
 * epoca vecchia, caso chiuso, referente disattivato o anonimizzato). `live` è
 * falso solo con il caso in pausa (pagina in sola lettura).
 *
 * Il parametro dell'impronta non ha cast: Postgres lo legge come `char(64)` e usa
 * l'indice unico di `token_hash`.
 */
export function resolveTokenSql(tokenHash: string): UcStatement {
  if (!HEX64.test(tokenHash)) throw new Error("Impronta del token non valida");
  return toStatement(ucSql`SELECT t.id AS token_id, r.id AS request_id, r.case_id, c.workspace_id, r.contact_id, r.purpose, r.status,
  r.acting_role_key, r.delegation_depth, r.expires_at, r.first_opened_at IS NOT NULL AS opened, r.privacy_ack_at, r.privacy_notice_version,
  c.status AS case_status, c.code AS case_code, c.title AS case_title, w.name AS client_label, ct.email AS contact_email,
  ${requestLiveSql("r", "c")} AS live
FROM uc_request_tokens t
JOIN uc_requests r ON r.id = t.request_id AND r.case_id = t.case_id
JOIN uc_cases c ON c.id = r.case_id
JOIN workspaces w ON w.id = c.workspace_id
JOIN uc_contacts ct ON ct.id = r.contact_id AND ct.workspace_id = c.workspace_id
WHERE t.token_hash = ${tokenHash} AND t.revoked_at IS NULL AND ct.is_active AND ct.anonymized_at IS NULL
  AND ${requestVisibleSql("r", "c")}
LIMIT 1`);
}

/**
 * Guardia di ogni batch di scrittura: il token non è stato revocato e la
 * richiesta è ancora viva (`uc_request_live`). Altrimenti `uc:link_non_valido`
 * annulla tutto.
 */
export function linkGuardSql(i: { workspaceId: string; caseId: string; requestId: string; tokenId: string }): UcStatement {
  return toStatement(ucSql`SELECT uc_require(EXISTS (
  SELECT 1 FROM uc_request_tokens t
  JOIN uc_requests r ON r.id = t.request_id AND r.case_id = t.case_id
  JOIN uc_cases c ON c.id = r.case_id
  JOIN uc_contacts ct ON ct.id = r.contact_id
  WHERE t.id = ${cast(uuid(i.tokenId, "token"), "uuid")} AND t.revoked_at IS NULL
    AND r.id = ${cast(uuid(i.requestId, "richiesta"), "uuid")} AND r.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")}
    AND c.workspace_id = ${cast(uuid(i.workspaceId, "workspace"), "uuid")} AND ct.is_active AND ct.anonymized_at IS NULL
    AND ${requestLiveSql("r", "c")}
), 'link_non_valido') AS ok`);
}

// ── Limiti di frequenza (`uc_rate_limits`) ────────────────────────────

export interface RateLimitHit {
  bucket: string;
  unit: "minute" | "hour";
}

const BUCKET = /^[a-z]{1,10}:[A-Za-z0-9:_-]{1,100}$/;

/**
 * Conta una chiamata in ogni secchio, nella finestra corrente (minuto o ora),
 * e restituisce i conteggi aggiornati. I secchi devono essere diversi tra loro.
 */
export function rateLimitHitSql(hits: readonly RateLimitHit[]): UcStatement {
  if (hits.length === 0) throw new Error("Nessun secchio");
  const seen = new Set<string>();
  for (const h of hits) {
    if (!BUCKET.test(h.bucket) || h.bucket.length > 120) throw new Error("Secchio non valido");
    if (h.unit !== "minute" && h.unit !== "hour") throw new Error("Finestra non valida");
    if (seen.has(h.bucket)) throw new Error("Secchio ripetuto");
    seen.add(h.bucket);
  }
  return toStatement(ucSql`INSERT INTO uc_rate_limits (bucket, window_start, count)
SELECT x.bucket, date_trunc(x.unit, now()), 1 FROM jsonb_to_recordset(${jsonb(hits)}) AS x(bucket text, unit text)
ON CONFLICT (bucket, window_start) DO UPDATE SET count = uc_rate_limits.count + 1
RETURNING bucket, count`);
}

// ── Pagina del referente ──────────────────────────────────────────────

const NO_PLAINTEXT = raw(`i.privacy_class IN (${NO_PLAINTEXT_SQL})`);

/**
 * Voci della richiesta, solo quelle ancora del referente (riga attiva o «Non lo
 * so», voce assegnata a lui). Mai valori personali o sanitari, mai bozze delle
 * voci personali; dei file solo quelli caricati da questa richiesta.
 */
export function referentItemsSql(i: { caseId: string; requestId: string; contactId: string }): UcStatement {
  const caseId = cast(uuid(i.caseId, "caso"), "uuid");
  const requestId = cast(uuid(i.requestId, "richiesta"), "uuid");
  const contactId = cast(uuid(i.contactId, "referente"), "uuid");
  return toStatement(ucSql`SELECT ri.item_id, ri.state AS ri_state, CASE WHEN ${NO_PLAINTEXT} THEN NULL ELSE ri.draft END AS draft,
  i.key, i.title, i.explanation, i.why, i.example, i.help, i.spec, i.status, i.status_reason, i.response_type, i.response_config,
  i.privacy_class, i.value_visibility, i.request_module_key, i.requires_validity_period, i.assignee_contact_id, i.current_answer_id,
  a.kind AS a_kind, a.source_kind AS a_source_kind, a.source_ref AS a_source_ref, a.responder_contact_id AS a_responder_contact_id,
  CASE WHEN ${NO_PLAINTEXT} OR a.erased_at IS NOT NULL THEN NULL ELSE a.value END AS a_value,
  CASE WHEN ${NO_PLAINTEXT} OR a.erased_at IS NOT NULL THEN NULL ELSE a.value_normalized END AS a_value_normalized,
  (SELECT jsonb_build_object('kind', x.kind, 'version', x.version, 'confidence', x.confidence,
      'value', CASE WHEN ${NO_PLAINTEXT} OR x.erased_at IS NOT NULL THEN NULL ELSE x.value END, 'encrypted', x.value_encrypted IS NOT NULL)
    FROM uc_answers x WHERE x.item_id = i.id AND x.responder_contact_id = ${contactId} ORDER BY x.version DESC LIMIT 1) AS own_answer,
  (SELECT cm.body FROM uc_comments cm WHERE cm.item_id = i.id AND cm.kind = 'chiarimento_richiesto' AND cm.visibility = 'condiviso'
    AND cm.resolved_at IS NULL ORDER BY cm.created_at DESC LIMIT 1) AS clarification,
  coalesce((SELECT jsonb_agg(jsonb_build_object('id', f.id, 'name', f.file_name, 'size', f.size_bytes, 'status', f.scan_status,
      'usable', f.scan_status = 'pulito' AND (f.content_scanned OR f.reviewed_at IS NOT NULL)) ORDER BY f.created_at)
    FROM uc_files f WHERE f.case_id = i.case_id AND f.item_id = i.id AND f.request_id = ri.request_id AND f.deleted_at IS NULL), '[]'::jsonb) AS files
FROM uc_request_items ri
JOIN uc_items i ON i.id = ri.item_id AND i.case_id = ri.case_id
LEFT JOIN uc_answers a ON a.id = i.current_answer_id AND a.item_id = i.id
WHERE ri.request_id = ${requestId} AND ri.case_id = ${caseId} AND ri.state IN (${raw(VISIBLE_SQL)})
  AND i.deleted_at IS NULL AND i.assignee_contact_id = ${contactId}
ORDER BY i.sort_order, i.key`);
}

/**
 * Moduli di richiesta del template del caso, con perché, istruzioni e tempo
 * stimato, dalle parti del template lette una volta per impronta (DESIGN §7.1
 * P0-5 b): `parts` sono le colonne di `templatePartsReader()` e i moduli si
 * leggono con `read(row)?.modules`.
 */
export function caseModulesDetailSql(i: { workspaceId: string; caseId: string }, parts: SqlFragment): UcStatement {
  return toStatement(ucSql`SELECT ${parts}
FROM uc_cases c JOIN uc_templates t ON t.id = c.template_id
WHERE c.id = ${cast(uuid(i.caseId, "caso"), "uuid")} AND c.workspace_id = ${cast(uuid(i.workspaceId, "workspace"), "uuid")}`);
}

/** Stato del blocco `a8` del caso (la zona personale è aperta solo con `sciolto`). */
export function a8StatusSql(caseId: string): UcStatement {
  return toStatement(ucSql`SELECT status FROM uc_blockers WHERE case_id = ${cast(uuid(caseId, "caso"), "uuid")} AND key = 'a8' LIMIT 1`);
}

/** Riga della voce nella richiesta del link (stato e bozza). */
export function requestItemRowSql(i: { caseId: string; requestId: string; itemId: string }): UcStatement {
  return toStatement(ucSql`SELECT ri.state, ri.draft IS NOT NULL AS has_draft FROM uc_request_items ri
WHERE ri.request_id = ${cast(uuid(i.requestId, "richiesta"), "uuid")} AND ri.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")}
  AND ri.item_id = ${cast(uuid(i.itemId, "voce"), "uuid")}`);
}

/** Valore di una risposta (per confermare il dichiarato), mai per le classi personali o sanitarie. */
export function answerValueSql(i: { caseId: string; itemId: string; answerId: string }): UcStatement {
  return toStatement(ucSql`SELECT a.id, a.kind, a.source_kind, a.source_ref, a.responder_contact_id,
  CASE WHEN ${NO_PLAINTEXT} OR a.erased_at IS NOT NULL THEN NULL ELSE a.value END AS value,
  CASE WHEN ${NO_PLAINTEXT} OR a.erased_at IS NOT NULL THEN NULL ELSE a.value_normalized END AS value_normalized
FROM uc_answers a JOIN uc_items i ON i.id = a.item_id AND i.case_id = a.case_id
WHERE a.id = ${cast(uuid(i.answerId, "risposta"), "uuid")} AND a.item_id = ${cast(uuid(i.itemId, "voce"), "uuid")} AND a.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")}`);
}

/** File utilizzabili della voce caricati da questa richiesta (allegati e risposte di tipo file). */
export function usableRequestFilesSql(i: { caseId: string; itemId: string; requestId: string }): UcStatement {
  return toStatement(ucSql`SELECT f.id FROM uc_files f
WHERE f.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")} AND f.item_id = ${cast(uuid(i.itemId, "voce"), "uuid")}
  AND f.request_id = ${cast(uuid(i.requestId, "richiesta"), "uuid")} AND f.deleted_at IS NULL
  AND f.scan_status = 'pulito' AND (f.content_scanned OR f.reviewed_at IS NOT NULL)
ORDER BY f.created_at`);
}

// ── Apertura e informativa ────────────────────────────────────────────

function requestCte(i: { workspaceId: string; caseId: string; requestId: string }): SqlFragment {
  return ucSql`SELECT r.id FROM uc_requests r JOIN uc_cases c ON c.id = r.case_id
  WHERE r.id = ${cast(uuid(i.requestId, "richiesta"), "uuid")} AND r.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")}
    AND c.workspace_id = ${cast(uuid(i.workspaceId, "workspace"), "uuid")} AND ${requestLiveSql("r", "c")}`;
}

/**
 * Apertura del link (solo `POST …/opened`, mai su GET): `first_opened_at` una
 * volta sola, `inviata → aperta`, evento `link.aperto` al massimo una volta al
 * giorno per richiesta (`since` = mezzanotte di Roma). Nessun tempo per persona.
 */
export function linkOpenedSql(i: {
  workspaceId: string;
  caseId: string;
  requestId: string;
  contactId: string;
  since: Date;
  ipHash: string | null;
  userAgent: string | null;
}): UcStatement {
  const event = eventInsertFromSql({
    type: "link.aperto",
    workspaceId: i.workspaceId,
    caseId: i.caseId,
    actor: { type: "referente", contactId: uuid(i.contactId, "referente") },
    targetType: "richiesta",
    from: "fresh",
    targetIdColumn: "fresh.id",
    ipHash: i.ipHash,
    userAgent: i.userAgent,
  });
  return toStatement(ucSql`WITH req AS (${requestCte(i)}),
u AS (
  UPDATE uc_requests r SET first_opened_at = coalesce(r.first_opened_at, now()),
    status = CASE WHEN r.status = 'inviata' THEN 'aperta' ELSE r.status END, updated_at = now()
  FROM req WHERE r.id = req.id AND (r.first_opened_at IS NULL OR r.status = 'inviata')
  RETURNING r.id
),
fresh AS (
  SELECT req.id FROM req WHERE NOT EXISTS (
    SELECT 1 FROM uc_events e WHERE e.case_id = ${cast(i.caseId, "uuid")} AND e.created_at >= ${cast(i.since.toISOString(), "timestamptz")}
      AND e.event_type = 'link.aperto' AND e.target_id = req.id)
),
ev AS (${event})
SELECT (SELECT count(*) FROM req)::int AS live, (SELECT count(*) FROM u)::int AS updated, (SELECT count(*) FROM fresh)::int AS logged`);
}

/**
 * «Ho letto» sull'informativa: la prova sta sulla richiesta (`privacy_ack_at`,
 * `privacy_notice_version`); sul referente solo l'ultima vista. Una versione
 * nuova dell'informativa rinnova la data. Evento `informativa.vista`.
 */
export function privacyAckSql(i: {
  workspaceId: string;
  caseId: string;
  requestId: string;
  contactId: string;
  version: string;
  ipHash: string | null;
  userAgent: string | null;
}): UcStatement {
  if (!/^[A-Za-z0-9_.:-]{1,20}$/.test(i.version)) throw new Error("Versione dell'informativa non valida");
  const version = cast(i.version, "text");
  const event = eventInsertFromSql({
    type: "informativa.vista",
    workspaceId: i.workspaceId,
    caseId: i.caseId,
    actor: { type: "referente", contactId: uuid(i.contactId, "referente") },
    targetType: "richiesta",
    from: "u",
    targetIdColumn: "u.id",
    payload: { notice_version: i.version },
    ipHash: i.ipHash,
    userAgent: i.userAgent,
  });
  return toStatement(ucSql`WITH req AS (${requestCte(i)}),
u AS (
  UPDATE uc_requests r SET
    privacy_ack_at = CASE WHEN r.privacy_ack_at IS NULL OR r.privacy_notice_version IS DISTINCT FROM ${version} THEN now() ELSE r.privacy_ack_at END,
    privacy_notice_version = ${version}, updated_at = now()
  FROM req WHERE r.id = req.id AND (r.privacy_ack_at IS NULL OR r.privacy_notice_version IS DISTINCT FROM ${version})
  RETURNING r.id
),
ct AS (
  UPDATE uc_contacts SET privacy_notice_version = ${version}, privacy_notice_seen_at = now(), updated_at = now()
  WHERE id = ${cast(uuid(i.contactId, "referente"), "uuid")} AND EXISTS (SELECT 1 FROM u)
  RETURNING id
),
ev AS (${event})
SELECT (SELECT count(*) FROM req)::int AS live, (SELECT count(*) FROM u)::int AS updated`);
}

// ── Bozze ─────────────────────────────────────────────────────────────

/**
 * La voce è ancora del referente, in uno stato in cui può scrivere, e non è
 * personale né sanitaria (niente bozze sul server per quelle classi).
 */
export function draftItemGuardSql(i: { caseId: string; itemId: string; contactId: string }): UcStatement {
  return toStatement(ucSql`SELECT uc_require(EXISTS (
  SELECT 1 FROM uc_items i WHERE i.id = ${cast(uuid(i.itemId, "voce"), "uuid")} AND i.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")}
    AND i.deleted_at IS NULL AND i.assignee_contact_id = ${cast(uuid(i.contactId, "referente"), "uuid")}
    AND i.status IN (${raw(ANSWERABLE_SQL)}) AND NOT (${NO_PLAINTEXT})
), 'voce_non_disponibile') AS ok`);
}

/** Bozza salvata sulla riga della voce; `da_fare → bozza`, gli altri stati restano. */
export function draftSaveSql(i: { caseId: string; requestId: string; itemId: string; draft: Json }): UcStatement {
  return toStatement(
    requireRows(
      ucSql`UPDATE uc_request_items SET draft = ${jsonb(i.draft)}, draft_updated_at = now(),
  state = CASE WHEN state = 'da_fare' THEN 'bozza' ELSE state END
WHERE request_id = ${cast(uuid(i.requestId, "richiesta"), "uuid")} AND case_id = ${cast(uuid(i.caseId, "caso"), "uuid")}
  AND item_id = ${cast(uuid(i.itemId, "voce"), "uuid")} AND state IN (${raw(VISIBLE_SQL)})
RETURNING item_id`,
      1,
      "voce_non_disponibile",
    ),
  );
}

/** Bozza tolta dopo l'invio della risposta. */
export function draftClearSql(i: { caseId: string; requestId: string; itemId: string }): UcStatement {
  return toStatement(ucSql`UPDATE uc_request_items SET draft = NULL, draft_updated_at = NULL
WHERE request_id = ${cast(uuid(i.requestId, "richiesta"), "uuid")} AND case_id = ${cast(uuid(i.caseId, "caso"), "uuid")}
  AND item_id = ${cast(uuid(i.itemId, "voce"), "uuid")}`);
}

/**
 * Stato della richiesta dopo una bozza, una risposta o una delega: `completata`
 * quando non restano voci `da_fare` o `bozza`, altrimenti `in_corso`. Va dopo
 * le istruzioni che cambiano le righe delle voci, nello stesso batch.
 */
export function requestProgressSql(i: { caseId: string; requestId: string }): UcStatement {
  const open = ucSql`EXISTS (SELECT 1 FROM uc_request_items ri WHERE ri.request_id = r.id AND ri.state IN ('da_fare', 'bozza'))`;
  return toStatement(ucSql`UPDATE uc_requests r SET
  status = CASE WHEN ${open} THEN 'in_corso' ELSE 'completata' END,
  completed_at = CASE WHEN ${open} THEN NULL ELSE coalesce(r.completed_at, now()) END,
  updated_at = now()
WHERE r.id = ${cast(uuid(i.requestId, "richiesta"), "uuid")} AND r.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")}
  AND r.status IN ('inviata', 'aperta', 'in_corso', 'completata')
  AND r.status IS DISTINCT FROM (CASE WHEN ${open} THEN 'in_corso' ELSE 'completata' END)`);
}

// ── Risposte ──────────────────────────────────────────────────────────

export interface PublicAnswerInsert {
  id: string;
  workspaceId: string;
  caseId: string;
  itemId: string;
  requestId: string;
  contactId: string;
  kind: AnswerKind;
  value: Json | null;
  valueNormalized: Json | null;
  /** Busta AES-256-GCM in base64 (voci personali): allora `value` e `valueNormalized` sono null. */
  valueEncryptedB64: string | null;
  validFrom: string | null;
  confidence: Confidence | null;
  note: string | null;
  sourceBasis: SourceBasis | null;
  supersedesAnswerId: string | null;
  fileIds: readonly string[];
  textHash: string | null;
  responseType: string | null;
  ipHash: string | null;
  userAgent: string | null;
  device: AnswerDevice | null;
}

/**
 * Risposta del referente dal link (tabella a sola aggiunta): versione = massima
 * + 1, fonte `referente`, richiesta e referente registrati, impronta dell'IP,
 * user agent e dispositivo. Evento `risposta.inviata` senza valori.
 */
export function publicAnswerInsertSql(a: PublicAnswerInsert): UcStatement {
  if (a.valueEncryptedB64 !== null && (a.value !== null || a.valueNormalized !== null)) {
    throw new Error("Un valore cifrato non ha copia in chiaro");
  }
  if (a.valueEncryptedB64 !== null && !/^[A-Za-z0-9+/]+={0,2}$/.test(a.valueEncryptedB64)) throw new Error("Busta non valida");
  if (a.textHash !== null && !HEX64.test(a.textHash)) throw new Error("Impronta del testo non valida");
  const event = eventInsertFromSql({
    type: "risposta.inviata",
    workspaceId: a.workspaceId,
    caseId: a.caseId,
    actor: { type: "referente", contactId: uuid(a.contactId, "referente") },
    targetType: "risposta",
    from: "ins",
    targetIdColumn: "ins.id",
    payload: { kind: a.kind, response_type: a.responseType && CODE.test(a.responseType) ? a.responseType : undefined, source_kind: "referente" },
    rowPayload: { item_key: "ins.key", version: "ins.version" },
    ipHash: a.ipHash,
    userAgent: a.userAgent,
  });
  const encrypted = a.valueEncryptedB64 === null ? raw("NULL::bytea") : ucSql`decode(${cast(a.valueEncryptedB64, "text")}, 'base64')`;
  return toStatement(ucSql`WITH ins AS (
  INSERT INTO uc_answers (id, case_id, item_id, version, kind, value, value_normalized, value_encrypted, valid_from, confidence, note,
    source_kind, source_basis, responder_contact_id, request_id, supersedes_answer_id, file_ids, text_hash, ip_hash, user_agent, device)
  SELECT ${cast(uuid(a.id, "risposta"), "uuid")}, i.case_id, i.id, coalesce((SELECT max(x.version) FROM uc_answers x WHERE x.item_id = i.id), 0) + 1,
    ${cast(a.kind, "text")}, ${a.value === null ? raw("NULL::jsonb") : jsonb(a.value)}, ${a.valueNormalized === null ? raw("NULL::jsonb") : jsonb(a.valueNormalized)},
    ${encrypted}, ${cast(a.validFrom, "date")}, ${cast(a.confidence, "text")}, ${cast(a.note, "text")},
    'referente', ${cast(a.sourceBasis, "text")}, ${cast(uuid(a.contactId, "referente"), "uuid")}, ${cast(uuid(a.requestId, "richiesta"), "uuid")},
    ${cast(a.supersedesAnswerId === null ? null : uuid(a.supersedesAnswerId, "risposta"), "uuid")}, ${jsonb(uuids(a.fileIds, "file"))},
    ${cast(a.textHash, "text")}, ${cast(a.ipHash, "text")}, ${cast(a.userAgent ? a.userAgent.slice(0, 300) : null, "text")}, ${cast(a.device, "text")}
  FROM uc_items i WHERE i.id = ${cast(uuid(a.itemId, "voce"), "uuid")} AND i.case_id = ${cast(uuid(a.caseId, "caso"), "uuid")} AND i.deleted_at IS NULL
  RETURNING id, version, (SELECT key FROM uc_items WHERE id = ${cast(a.itemId, "uuid")}) AS key
), ev AS (${event})
SELECT uc_require(count(*) = 1, 'conflitto') AS ok FROM ins`);
}

/**
 * Risposta del referente a un chiarimento ancora aperto: commento condiviso
 * `risposta_chiarimento` sotto la domanda di Lateral Space, con evento senza
 * testo. Il chiarimento lo chiude Lateral Space.
 */
export function clarificationReplySql(i: {
  id: string;
  workspaceId: string;
  caseId: string;
  itemId: string;
  contactId: string;
  body: string;
  ipHash: string | null;
  userAgent: string | null;
}): UcStatement {
  if (i.body.length > 4000) throw new Error("Commento troppo lungo");
  const event = eventInsertFromSql({
    type: "commento.creato",
    workspaceId: i.workspaceId,
    caseId: i.caseId,
    actor: { type: "referente", contactId: uuid(i.contactId, "referente") },
    targetType: "commento",
    from: "ins",
    targetIdColumn: "ins.id",
    payload: { kind: "risposta_chiarimento", visibility: "condiviso" },
    rowPayload: { item_key: "ins.key" },
    ipHash: i.ipHash,
    userAgent: i.userAgent,
  });
  return toStatement(ucSql`WITH parent AS (
  SELECT cm.id FROM uc_comments cm WHERE cm.item_id = ${cast(uuid(i.itemId, "voce"), "uuid")} AND cm.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")}
    AND cm.kind = 'chiarimento_richiesto' AND cm.visibility = 'condiviso' AND cm.resolved_at IS NULL
  ORDER BY cm.created_at DESC LIMIT 1
), ins AS (
  INSERT INTO uc_comments (id, case_id, item_id, author_contact_id, parent_comment_id, body, visibility, kind)
  SELECT ${cast(uuid(i.id, "commento"), "uuid")}, ${cast(i.caseId, "uuid")}, ${cast(i.itemId, "uuid")}, ${cast(uuid(i.contactId, "referente"), "uuid")},
    parent.id, ${cast(i.body, "text")}, 'condiviso', 'risposta_chiarimento'
  FROM parent
  RETURNING id, (SELECT key FROM uc_items WHERE id = ${cast(i.itemId, "uuid")}) AS key
), ev AS (${event})
SELECT count(*)::int AS n FROM ins`);
}

// ── Deleghe ───────────────────────────────────────────────────────────

/** Voci che il referente può girare a un collega: ancora `chiesta`, sue, con la riga attiva in questo link. */
export function delegableItemsSql(i: { caseId: string; requestId: string; contactId: string }): UcStatement {
  return toStatement(ucSql`SELECT ri.item_id, ri.state FROM uc_request_items ri
JOIN uc_items i ON i.id = ri.item_id AND i.case_id = ri.case_id
WHERE ri.request_id = ${cast(uuid(i.requestId, "richiesta"), "uuid")} AND ri.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")}
  AND ri.state IN (${raw(ACTIVE_SQL)}) AND i.deleted_at IS NULL AND i.status = 'chiesta'
  AND i.assignee_contact_id = ${cast(uuid(i.contactId, "referente"), "uuid")}
ORDER BY i.sort_order, i.key`);
}

/** Domini delle email dei referenti del caso (richieste o voci assegnate), senza portare fuori le email. */
export function caseContactDomainsSql(i: { workspaceId: string; caseId: string }): UcStatement {
  const caseId = cast(uuid(i.caseId, "caso"), "uuid");
  return toStatement(ucSql`SELECT DISTINCT lower(substring(ct.email from '@([^@]+)$')) AS domain FROM uc_contacts ct
WHERE ct.workspace_id = ${cast(uuid(i.workspaceId, "workspace"), "uuid")} AND ct.email IS NOT NULL AND ct.anonymized_at IS NULL
  AND (EXISTS (SELECT 1 FROM uc_requests r WHERE r.case_id = ${caseId} AND r.contact_id = ct.id)
    OR EXISTS (SELECT 1 FROM uc_items i WHERE i.case_id = ${caseId} AND i.assignee_contact_id = ct.id))`);
}

/** Referente del workspace con questa email (non anonimizzato), per riusarlo nella delega. */
export function contactByEmailSql(i: { workspaceId: string; email: string }): UcStatement {
  return toStatement(ucSql`SELECT id, is_active, user_id FROM uc_contacts
WHERE workspace_id = ${cast(uuid(i.workspaceId, "workspace"), "uuid")} AND lower(email) = lower(${cast(i.email, "text")}) AND anonymized_at IS NULL
LIMIT 1`);
}

/** Collega nuovo come referente del workspace (nome ed email dalla delega). */
export function delegateContactInsertSql(i: { id: string; workspaceId: string; displayName: string; email: string }): UcStatement {
  return toStatement(
    requireRows(
      ucSql`INSERT INTO uc_contacts (id, workspace_id, display_name, email, preferred_channel)
VALUES (${cast(uuid(i.id, "referente"), "uuid")}, ${cast(uuid(i.workspaceId, "workspace"), "uuid")}, ${cast(i.displayName, "text")}, ${cast(i.email, "text")}, 'email')
ON CONFLICT DO NOTHING
RETURNING id`,
      1,
      "conflitto",
    ),
  );
}

/**
 * Richiesta nuova per il collega, figlia della richiesta del link: stesso ruolo
 * (`acting_role_key` ereditato), profondità + 1, epoca corrente del caso. Con
 * `send` parte subito (30 giorni); altrimenti resta in bozza finché Lateral Space
 * non approva la delega (`approveDelegation`). La richiesta del link deve essere
 * ancora viva.
 */
export function delegationRequestInsertSql(i: {
  id: string;
  workspaceId: string;
  caseId: string;
  parentRequestId: string;
  contactId: string;
  message: string | null;
  send: boolean;
  nextReminderAt: Date | null;
}): UcStatement {
  return toStatement(
    requireRows(
      ucSql`INSERT INTO uc_requests (id, case_id, contact_id, purpose, share_epoch, acting_role_key, status, message, channel,
  delegated_from_request_id, delegated_by_contact_id, delegation_depth, sent_at, expires_at, next_reminder_at)
SELECT ${cast(uuid(i.id, "richiesta"), "uuid")}, p.case_id, ct.id, 'raccolta', c.share_epoch, p.acting_role_key, ${raw(i.send ? "'inviata'" : "'bozza'")},
  ${cast(i.message, "text")}, 'email', p.id, p.contact_id, p.delegation_depth + 1,
  ${raw(i.send ? "now()" : "NULL::timestamptz")}, ${i.send ? EXPIRY_SQL : raw("NULL::timestamptz")},
  ${cast(i.send && i.nextReminderAt ? i.nextReminderAt.toISOString() : null, "timestamptz")}
FROM uc_requests p
JOIN uc_cases c ON c.id = p.case_id
JOIN uc_contacts ct ON ct.id = ${cast(uuid(i.contactId, "referente"), "uuid")} AND ct.workspace_id = c.workspace_id AND ct.is_active AND ct.anonymized_at IS NULL
WHERE p.id = ${cast(uuid(i.parentRequestId, "richiesta"), "uuid")} AND p.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")}
  AND c.workspace_id = ${cast(uuid(i.workspaceId, "workspace"), "uuid")} AND p.purpose = 'raccolta' AND p.delegation_depth < 2
  AND ${requestLiveSql("p", "c")}
RETURNING id`,
      1,
      "conflitto",
    ),
  );
}

/**
 * Voci della delega nella richiesta nuova (`da_fare`), solo se ancora `chiesta`.
 * La riga della richiesta del link è già passata a `delegata` nello stesso
 * batch: l'indice unico «una richiesta attiva per voce» resta rispettato.
 */
export function delegationItemsInsertSql(i: { caseId: string; requestId: string; itemIds: readonly string[] }): UcStatement {
  const items = [...new Set(uuids(i.itemIds, "voce"))];
  if (items.length === 0) throw new Error("Nessuna voce da delegare");
  return toStatement(ucSql`WITH ins AS (
  INSERT INTO uc_request_items (case_id, request_id, item_id, state)
  SELECT i.case_id, ${cast(uuid(i.requestId, "richiesta"), "uuid")}, i.id, 'da_fare'
  FROM uc_items i
  WHERE i.case_id = ${cast(uuid(i.caseId, "caso"), "uuid")} AND i.id = ANY(${cast(items, "uuid[]")}) AND i.deleted_at IS NULL AND i.status = 'chiesta'
    AND NOT EXISTS (SELECT 1 FROM uc_request_items x WHERE x.item_id = i.id AND x.state IN (${raw(ACTIVE_SQL)}))
  ON CONFLICT DO NOTHING
  RETURNING item_id
)
SELECT uc_require(count(*) = ${cast(items.length, "int")}, 'conflitto') AS ok FROM ins`);
}

/** Al massimo `max` deleghe al giorno dalla stessa richiesta (contando quella appena creata). */
export function delegationsPerDayGuardSql(i: { caseId: string; parentRequestId: string; since: Date; max: number }): UcStatement {
  if (!Number.isInteger(i.max) || i.max < 1) throw new Error("Limite non valido");
  return toStatement(ucSql`SELECT uc_require((
  SELECT count(*) FROM uc_requests WHERE case_id = ${cast(uuid(i.caseId, "caso"), "uuid")}
    AND delegated_from_request_id = ${cast(uuid(i.parentRequestId, "richiesta"), "uuid")} AND status <> 'revocata'
    AND created_at >= ${cast(i.since.toISOString(), "timestamptz")}
) <= ${cast(i.max, "int")}, 'troppe_deleghe') AS ok`);
}

/** Evento `delega.creata` (voci, profondità, da approvare), senza nomi né email. */
export function delegationEventSql(i: {
  workspaceId: string;
  caseId: string;
  contactId: string;
  requestId: string;
  items: number;
  depth: number;
  needsApproval: boolean;
  ipHash: string | null;
  userAgent: string | null;
}): UcStatement {
  return toStatement(
    eventInsertSql({
      type: "delega.creata",
      workspaceId: i.workspaceId,
      caseId: i.caseId,
      actor: { type: "referente", contactId: uuid(i.contactId, "referente") },
      targetType: "richiesta",
      targetId: uuid(i.requestId, "richiesta"),
      toState: i.needsApproval ? "bozza" : "inviata",
      payload: { items: i.items, depth: i.depth, needs_approval: i.needsApproval },
      ipHash: i.ipHash,
      userAgent: i.userAgent,
    }),
  );
}

// ── Firme dal link di approvazione ────────────────────────────────────

/** Proposte «non applicabile» del caso ancora senza le due firme. */
export function pendingNaSql(caseId: string): UcStatement {
  return toStatement(ucSql`SELECT i.id, i.key, i.title, i.na_reason, i.na_proposed_at, i.na_proposed_by_contact_id IS NOT NULL AS by_referent,
  i.na_approved_by_user_id IS NOT NULL AS ls_signed, i.na_client_approved_by_user_id IS NOT NULL AS client_user_signed,
  i.na_approved_by_contact_id AS client_contact_id
FROM uc_items i
WHERE i.case_id = ${cast(uuid(caseId, "caso"), "uuid")} AND i.deleted_at IS NULL AND i.na_proposed_at IS NOT NULL
  AND i.na_approved_at IS NULL AND i.na_reason IS NOT NULL
ORDER BY i.sort_order, i.key`);
}

/** Deroghe e ripieghi proposti e non ancora approvati. */
export function pendingWaiversAndFallbacksSql(caseId: string): UcStatement {
  return toStatement(ucSql`SELECT i.id, i.key, i.title,
  CASE WHEN i.waiver IS NOT NULL AND i.waiver_approved_at IS NULL THEN i.waiver END AS waiver,
  CASE WHEN i.fallback IS NOT NULL AND i.fallback_approved_at IS NULL THEN i.fallback END AS fallback
FROM uc_items i
WHERE i.case_id = ${cast(uuid(caseId, "caso"), "uuid")} AND i.deleted_at IS NULL
  AND ((i.waiver IS NOT NULL AND i.waiver_approved_at IS NULL) OR (i.fallback IS NOT NULL AND i.fallback_approved_at IS NULL))
ORDER BY i.sort_order, i.key`);
}

/** Proposte di gate aperte. */
export function pendingGateSql(caseId: string): UcStatement {
  return toStatement(ucSql`SELECT g.id, g.gate_key, g.computed, g.summary_text_hash, g.approvals, g.written_evidence_file_id IS NOT NULL AS has_evidence
FROM uc_gate_reviews g WHERE g.case_id = ${cast(uuid(caseId, "caso"), "uuid")} AND g.decision = 'proposto'
ORDER BY g.created_at`);
}

/**
 * Blocco `a8` attivo con le prove già registrate da Lateral Space, con i nomi
 * delle persone di Lateral Space a cui le prove danno accesso alla zona personale.
 */
export function pendingA8Sql(caseId: string): UcStatement {
  return toStatement(ucSql`SELECT b.id, b.key, b.evidence, b.approvals,
  coalesce((SELECT jsonb_agg(coalesce(nullif(trim(u.name), ''), 'Persona di Lateral Space') ORDER BY u.name)
    FROM users u WHERE u.id::text IN (
      SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(b.evidence -> 'accesso_zona_personale') = 'array' THEN b.evidence -> 'accesso_zona_personale' ELSE '[]'::jsonb END))
  ), '[]'::jsonb) AS access_names
FROM uc_blockers b
WHERE b.case_id = ${cast(uuid(caseId, "caso"), "uuid")} AND b.key = 'a8' AND b.status = 'attivo' AND b.evidence IS NOT NULL`);
}

/** Concessioni della zona personale in attesa della firma dell'approvatore privacy. */
export function pendingZoneGrantsSql(caseId: string): UcStatement {
  return toStatement(ucSql`SELECT DISTINCT ON (m.user_id) m.user_id, m.personal_zone_grant, coalesce(nullif(trim(u.name), ''), 'Persona di Lateral Space') AS name
FROM uc_case_members m JOIN users u ON u.id = m.user_id
WHERE m.case_id = ${cast(uuid(caseId, "caso"), "uuid")} AND m.personal_zone_grant IS NOT NULL AND NOT m.personal_zone_access
ORDER BY m.user_id`);
}

/** Evento senza dati della persona per un gate respinto dal link dell'Owner. */
export function gateRejectedEventSql(i: { workspaceId: string; caseId: string; contactId: string; reviewId: string; gate: string; summaryTextHash: string; ipHash: string | null; userAgent: string | null }): UcStatement {
  return toStatement(
    eventInsertSql({
      type: "gate.respinto",
      workspaceId: i.workspaceId,
      caseId: i.caseId,
      actor: { type: "referente", contactId: uuid(i.contactId, "referente") } satisfies EventActor,
      targetType: "gate",
      targetId: uuid(i.reviewId, "gate"),
      fromState: "proposto",
      toState: "respinto",
      payload: { gate: i.gate, summary_text_hash: i.summaryTextHash, ruolo: "owner_cliente" },
      ipHash: i.ipHash,
      userAgent: i.userAgent,
    }),
  );
}
