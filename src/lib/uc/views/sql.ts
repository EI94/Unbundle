/**
 * Letture delle pagine interne del caso costruite da WP9 (PIANO §5.1), oggi
 * condivise con le letture di area (`uc-questions.ts`, `uc-solution.ts`,
 * `uc-value.ts`, `uc-overview.ts`…): contesto del caso, selezione del
 * catalogo, gruppi per ruolo, dettaglio voce, voci per tipo, documenti e
 * mappa. Solo SELECT, sempre filtrate per caso (e per workspace dove serve).
 *
 * I valori delle risposte delle classi personali e sanitarie, e quelli
 * cancellati per privacy, escono dal database sempre `NULL` (come nella
 * fotografia del catalogo): il valore cifrato non si legge mai da qui. La
 * visibilità per ruolo (`value_visibility`) si applica dopo, in `format.ts`.
 *
 * Modulo puro: solo costruttori `{ text, params }`.
 */
import { cast, raw, toStatement, ucSql, type SqlFragment, type UcStatement } from "../sql/statement.ts";
import type { ItemKind, ItemStatus } from "../vocab.ts";

/** Classi i cui valori non escono dal database. */
const HIDDEN_CLASSES = raw("i.privacy_class IN ('personale', 'personale_equipaggio', 'escluso_sanitario')");

function uuid(v: string): SqlFragment {
  return cast(v, "uuid");
}

// ── Contesto del caso ─────────────────────────────────────────────────

/**
 * Caso e template, con ruoli e moduli di richiesta del template dalle parti
 * lette una volta per impronta (DESIGN §7.1 P0-5 b): `parts` sono le colonne
 * di `templatePartsReader()` (`sql/template-parts.ts`), che escono come
 * `template_hash` e `template_parts`, e le parti solo per un'impronta che il
 * processo non conosce ancora. Mai la definizione intera, che può pesare
 * qualche MB. Chi legge passa da `caseViewContextReader` (`uc-views.ts`), che
 * rimette ruoli e moduli nella riga prima di `parseCaseViewContext`.
 */
export function caseViewContextSql(workspaceId: string, caseId: string, parts: SqlFragment): UcStatement {
  return toStatement(ucSql`SELECT c.id, c.code, c.title, c.status, c.settings, c.catalog_version, c.template_version,
  t.key AS template_key, t.name AS template_name,
  ${parts}
FROM uc_cases c JOIN uc_templates t ON t.id = c.template_id
WHERE c.id = ${uuid(caseId)} AND c.workspace_id = ${uuid(workspaceId)} AND c.setup_completed_at IS NOT NULL`);
}

/** Referenti del workspace: nome ed etichette, mai email o telefono. */
export function contactsSql(workspaceId: string): UcStatement {
  return toStatement(ucSql`SELECT ct.id, ct.display_name, ct.role_label, ct.template_role_key, ct.is_active, ct.anonymized_at IS NOT NULL AS anonymized
FROM uc_contacts ct WHERE ct.workspace_id = ${uuid(workspaceId)}
ORDER BY lower(ct.display_name), ct.id`);
}

// ── Catalogo ──────────────────────────────────────────────────────────

/** Massimo di voci in una selezione «tutti i risultati». */
export const CATALOG_SELECTION_MAX = 5000;

/** Id e stato delle voci che corrispondono ai filtri (una riga in più dice che il limite è superato). */
export function catalogSelectionSql(where: SqlFragment): UcStatement {
  return toStatement(ucSql`SELECT i.id, i.status FROM uc_items i WHERE ${where}
ORDER BY i.sort_order, i.key
LIMIT ${cast(CATALOG_SELECTION_MAX + 1, "int")}`);
}

/** Stati in cui una voce si può assegnare a un referente in blocco. */
export const ASSIGNABLE_STATUSES: readonly ItemStatus[] = ["da_chiedere", "mancante", "parziale", "in_verifica", "bloccata"];

/**
 * Voci da assegnare per ruolo titolare: quelle a cui risponde un referente
 * (domande dei moduli, fonti e documenti con una risposta), non ancora verdi o
 * blu.
 */
function roleGroupWhere(caseId: string): SqlFragment {
  return ucSql`i.case_id = ${uuid(caseId)} AND i.deleted_at IS NULL AND i.owner_role_key IS NOT NULL AND i.response_type IS NOT NULL
  AND (i.request_module_key IS NOT NULL OR i.kind IN ('fonte', 'documento'))
  AND i.status = ANY(${cast([...ASSIGNABLE_STATUSES], "text[]")})`;
}

/** Gruppi per ruolo titolare: solo conteggi (gli id si chiedono al momento di assegnare). */
export function roleGroupsSql(caseId: string): UcStatement {
  return toStatement(ucSql`SELECT i.owner_role_key AS role_key, count(*)::int AS items,
  count(*) FILTER (WHERE i.assignee_contact_id IS NULL)::int AS unassigned
FROM uc_items i
WHERE ${roleGroupWhere(caseId)}
GROUP BY i.owner_role_key
ORDER BY i.owner_role_key`);
}

/** Id delle voci di un gruppo per ruolo; di base solo quelle senza referente. */
export function roleGroupItemsSql(caseId: string, roleKey: string, includeAssigned: boolean): UcStatement {
  return toStatement(ucSql`SELECT i.id, i.status FROM uc_items i
WHERE ${roleGroupWhere(caseId)} AND i.owner_role_key = ${cast(roleKey, "text")}
  AND (${cast(includeAssigned, "boolean")} OR i.assignee_contact_id IS NULL)
ORDER BY i.sort_order, i.key
LIMIT ${cast(CATALOG_SELECTION_MAX + 1, "int")}`);
}

// ── Dettaglio della voce ──────────────────────────────────────────────

/** Colonne della voce che i comandi non leggono: provenienza, padre, referente. */
export function itemDetailSql(caseId: string, itemId: string): UcStatement {
  return toStatement(ucSql`SELECT i.id, i.template_item_key, i.source_refs, i.status_changed_at, i.validated_at, i.created_at,
  (i.na_proposed_by_user_id IS NOT NULL OR i.na_proposed_by_contact_id IS NOT NULL) AS na_proposed,
  p.id AS parent_id, p.key AS parent_key, p.title AS parent_title, p.status AS parent_status,
  vu.name AS validated_by_name
FROM uc_items i
LEFT JOIN uc_items p ON p.id = i.parent_item_id AND p.deleted_at IS NULL
LEFT JOIN users vu ON vu.id = i.validated_by_user_id
WHERE i.case_id = ${uuid(caseId)} AND i.id = ${uuid(itemId)} AND i.deleted_at IS NULL`);
}

/** Tutte le versioni della risposta, dalla più recente. */
export function itemAnswersSql(caseId: string, itemId: string): UcStatement {
  return toStatement(ucSql`SELECT a.id, a.version, a.kind,
  CASE WHEN ${HIDDEN_CLASSES} OR a.erased_at IS NOT NULL THEN NULL ELSE a.value END AS value,
  CASE WHEN ${HIDDEN_CLASSES} OR a.erased_at IS NOT NULL THEN NULL ELSE a.note END AS note,
  a.value_encrypted IS NOT NULL AS encrypted, a.erased_at IS NOT NULL AS erased,
  a.valid_from::text AS valid_from, a.valid_to::text AS valid_to, a.confidence, a.source_kind, a.source_ref, a.source_basis,
  a.responder_contact_id, rc.display_name AS responder_contact_name, a.responder_user_id, ru.name AS responder_user_name,
  r.acting_role_key, a.supersedes_answer_id,
  CASE WHEN jsonb_typeof(a.file_ids) = 'array' THEN jsonb_array_length(a.file_ids) ELSE 0 END AS files,
  a.text_hash, a.created_at
FROM uc_answers a
JOIN uc_items i ON i.id = a.item_id AND i.case_id = a.case_id
LEFT JOIN uc_contacts rc ON rc.id = a.responder_contact_id
LEFT JOIN users ru ON ru.id = a.responder_user_id
LEFT JOIN uc_requests r ON r.id = a.request_id
WHERE a.case_id = ${uuid(caseId)} AND a.item_id = ${uuid(itemId)}
ORDER BY a.version DESC
LIMIT 100`);
}

/** File della voce: solo metadati. La zona personale solo a chi la può vedere. */
export function itemFilesSql(caseId: string, itemId: string, includePersonalZone: boolean): UcStatement {
  return toStatement(ucSql`SELECT f.id, f.file_name, f.mime, f.size_bytes, f.storage_zone, f.scan_status, f.content_scanned,
  f.reviewed_at IS NOT NULL AS reviewed, f.personal_data, f.created_at, f.answer_id
FROM uc_files f
WHERE f.case_id = ${uuid(caseId)} AND f.item_id = ${uuid(itemId)} AND f.deleted_at IS NULL
  AND (${cast(includePersonalZone, "boolean")} OR f.storage_zone = 'standard')
ORDER BY f.created_at DESC
LIMIT 100`);
}

export function itemValidationsSql(caseId: string, itemId: string): UcStatement {
  return toStatement(ucSql`SELECT v.id, v.check_key, v.kind, v.outcome, v.message, v.answer_id, v.created_at, u.name AS by_name
FROM uc_validations v LEFT JOIN users u ON u.id = v.by_user_id
WHERE v.case_id = ${uuid(caseId)} AND v.item_id = ${uuid(itemId)}
ORDER BY v.created_at DESC
LIMIT 50`);
}

/** Commenti e chiarimenti; quelli interni di Lateral Space solo a chi li vede. */
export function itemCommentsSql(caseId: string, itemId: string, includeInternal: boolean): UcStatement {
  return toStatement(ucSql`SELECT cm.id, cm.body, cm.visibility, cm.kind, cm.parent_comment_id, cm.created_at, cm.resolved_at,
  cm.author_user_id, u.name AS author_user_name, cm.author_contact_id, ct.display_name AS author_contact_name
FROM uc_comments cm
LEFT JOIN users u ON u.id = cm.author_user_id
LEFT JOIN uc_contacts ct ON ct.id = cm.author_contact_id
WHERE cm.case_id = ${uuid(caseId)} AND cm.item_id = ${uuid(itemId)}
  AND (${cast(includeInternal, "boolean")} OR cm.visibility = 'condiviso')
ORDER BY cm.created_at
LIMIT 200`);
}

/** Collegamenti in uscita e in entrata, con la voce dall'altra parte. */
export function itemLinksSql(caseId: string, itemId: string): UcStatement {
  return toStatement(ucSql`SELECT 'out' AS dir, l.relation, l.cardinality, l.note, o.id, o.key, o.title, o.kind, o.status
FROM uc_item_links l JOIN uc_items o ON o.id = l.to_item_id
WHERE l.case_id = ${uuid(caseId)} AND l.from_item_id = ${uuid(itemId)} AND o.deleted_at IS NULL
UNION ALL
SELECT 'in' AS dir, l.relation, l.cardinality, l.note, o.id, o.key, o.title, o.kind, o.status
FROM uc_item_links l JOIN uc_items o ON o.id = l.from_item_id
WHERE l.case_id = ${uuid(caseId)} AND l.to_item_id = ${uuid(itemId)} AND o.deleted_at IS NULL
ORDER BY 1, 2, 6
LIMIT 500`);
}

/**
 * Cronologia della voce. Per i ruoli del cliente (art. 15.4) niente eventi dei
 * referenti, delle aperture dei link e dell'informativa.
 */
export function itemEventsSql(caseId: string, itemId: string, clientViewer: boolean): UcStatement {
  return toStatement(ucSql`SELECT e.id, e.event_type, e.from_state, e.to_state, e.actor_type, e.actor_user_id, u.name AS actor_name, e.payload, e.created_at
FROM uc_events e LEFT JOIN users u ON u.id = e.actor_user_id
WHERE e.case_id = ${uuid(caseId)} AND e.target_id = ${uuid(itemId)}
  AND NOT (${cast(clientViewer, "boolean")} AND (e.actor_type = 'referente' OR e.event_type IN ('link.aperto', 'informativa.vista')))
ORDER BY e.created_at DESC
LIMIT 100`);
}

// ── Voci per tipo (Valore, Soluzione) ─────────────────────────────────

/** Voci di certi tipi con i testi e la classificazione (mai valori). */
export function itemsOfKindsSql(caseId: string, kinds: readonly ItemKind[]): UcStatement {
  return toStatement(ucSql`SELECT i.id, i.key, i.kind, i.title, i.explanation, i.why, i.example, i.help, i.spec, i.status, i.status_reason, i.priority,
  i.perimeter, i.serves_for, i.levers, i.privacy_class, i.availability, i.owner_role_key, i.response_type, i.source_refs,
  i.parent_item_id, i.assignee_contact_id, va.text_hash AS confirmed_text_hash,
  coalesce((SELECT jsonb_agg(b.key ORDER BY b.key) FROM uc_item_blockers ib JOIN uc_blockers b ON b.id = ib.blocker_id
    WHERE ib.item_id = i.id AND b.status IN ('attivo', 'permanente')), '[]'::jsonb) AS active_blockers
FROM uc_items i
LEFT JOIN uc_answers va ON va.id = i.validated_answer_id
WHERE i.case_id = ${uuid(caseId)} AND i.deleted_at IS NULL AND i.kind = ANY(${cast([...kinds], "text[]")})
ORDER BY i.sort_order, i.key`);
}

/** Collegamenti che toccano voci di certi tipi, con le due voci. */
export function linksTouchingKindsSql(caseId: string, kinds: readonly ItemKind[]): UcStatement {
  return toStatement(ucSql`SELECT l.from_item_id, l.to_item_id, l.relation, l.cardinality, l.note,
  f.key AS f_key, f.title AS f_title, f.kind AS f_kind, f.status AS f_status, f.availability AS f_availability, f.response_type AS f_response_type,
  t.key AS t_key, t.title AS t_title, t.kind AS t_kind, t.status AS t_status, t.availability AS t_availability, t.response_type AS t_response_type,
  (SELECT x.text_hash FROM uc_answers x WHERE x.id = f.validated_answer_id) AS f_confirmed_hash
FROM uc_item_links l
JOIN uc_items f ON f.id = l.from_item_id
JOIN uc_items t ON t.id = l.to_item_id
WHERE l.case_id = ${uuid(caseId)} AND f.deleted_at IS NULL AND t.deleted_at IS NULL
  AND (f.kind = ANY(${cast([...kinds], "text[]")}) OR t.kind = ANY(${cast([...kinds], "text[]")}))`);
}

// ── Documenti e dataset ───────────────────────────────────────────────

/** Documenti richiesti: fonti, documenti e voci con risposta «file» o «dataset». */
export function requiredDocumentsSql(caseId: string, validatedOnly: boolean): UcStatement {
  return toStatement(ucSql`SELECT i.id, i.key, i.kind, i.title, i.explanation, i.help, i.status, i.status_reason, i.priority, i.privacy_class,
  i.availability, i.owner_role_key, i.assignee_contact_id, i.response_type, i.spec, i.due_at, i.due_is_proposal,
  coalesce((SELECT jsonb_agg(b.key ORDER BY b.key) FROM uc_item_blockers ib JOIN uc_blockers b ON b.id = ib.blocker_id
    WHERE ib.item_id = i.id AND b.status IN ('attivo', 'permanente')), '[]'::jsonb) AS active_blockers,
  (SELECT count(*)::int FROM uc_files f WHERE f.item_id = i.id AND f.deleted_at IS NULL AND f.scan_status <> 'rifiutato') AS files,
  (SELECT count(*)::int FROM uc_datasets d WHERE d.item_id = i.id AND d.deleted_at IS NULL) AS datasets
FROM uc_items i
WHERE i.case_id = ${uuid(caseId)} AND i.deleted_at IS NULL
  AND (i.kind IN ('fonte', 'documento') OR i.response_type IN ('file', 'dataset'))
  AND (NOT ${cast(validatedOnly, "boolean")} OR i.status IN ('validata', 'non_applicabile'))
ORDER BY i.sort_order, i.key`);
}

/** File del caso (metadati e anteprima già mascherata della zona standard). */
export function caseFilesSql(caseId: string, includePersonalZone: boolean): UcStatement {
  return toStatement(ucSql`SELECT f.id, f.item_id, it.key AS item_key, it.title AS item_title, f.file_name, f.mime, f.size_bytes, f.storage_zone,
  f.personal_data, f.scan_status, f.scan_findings, f.content_scanned, f.reviewed_at IS NOT NULL AS reviewed,
  CASE WHEN f.storage_zone = 'standard' AND f.scan_status = 'pulito' THEN f.preview END AS preview,
  f.retention_until::text AS retention_until, f.created_at
FROM uc_files f
LEFT JOIN uc_items it ON it.id = f.item_id
WHERE f.case_id = ${uuid(caseId)} AND f.deleted_at IS NULL
  AND (${cast(includePersonalZone, "boolean")} OR f.storage_zone = 'standard')
ORDER BY f.created_at DESC
LIMIT 500`);
}

/** Schede dataset del caso (mai righe di dati). */
export function caseDatasetsSql(caseId: string, includePersonalZone: boolean): UcStatement {
  return toStatement(ucSql`SELECT d.id, d.item_id, it.key AS item_key, d.source_key, d.dataset_version, d.period_from::text AS period_from,
  d.period_to::text AS period_to, d.extracted_at, d.row_count, d.personal_data, d.pseudonymized,
  CASE WHEN jsonb_typeof(d.pii_columns) = 'array' THEN jsonb_array_length(d.pii_columns) ELSE 0 END AS pii_columns,
  d.data_controller_label, d.status, d.validated_at, d.retention_until::text AS retention_until, f.storage_zone,
  EXISTS (SELECT 1 FROM uc_validations v WHERE v.dataset_id = d.id AND v.outcome = 'errore') AS dq_error
FROM uc_datasets d
LEFT JOIN uc_items it ON it.id = d.item_id
LEFT JOIN uc_files f ON f.id = d.file_id
WHERE d.case_id = ${uuid(caseId)} AND d.deleted_at IS NULL
  AND (${cast(includePersonalZone, "boolean")} OR f.storage_zone IS NULL OR f.storage_zone = 'standard')
ORDER BY d.source_key, d.dataset_version DESC
LIMIT 500`);
}

// ── Mappa ─────────────────────────────────────────────────────────────

/** Mappe correnti del caso (soluzione, processi, esempio). */
export function currentMapsSql(caseId: string): UcStatement {
  return toStatement(ucSql`SELECT m.kind, m.title, m.graph, m.version, m.source
FROM uc_maps m WHERE m.case_id = ${uuid(caseId)} AND m.is_current
ORDER BY m.kind`);
}
