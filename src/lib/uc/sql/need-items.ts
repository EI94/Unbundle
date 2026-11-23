/**
 * Le voci dei dossier «Dal caso d'uso» seguono «Cosa serve» (docs/dossier/SCHEMA-DI-PARTENZA.md, R1).
 *
 * Una voce collegata ha `shared_item_id` = id dell'informazione e `template_item_key` = `need.<id>`
 * (`src/lib/uc/template/from-use-case.ts`). Queste istruzioni la tengono uguale all'informazione:
 * titolo, argomento (il tipo), indispensabile o facoltativa, ordine e stato. Il dettaglio no: resta
 * in «Cosa serve» (la spiegazione della voce è sempre vuota). Si eseguono
 * in coda a ogni scrittura di «Cosa serve» (`cardSyncStatements`, nella stessa transazione), alla
 * creazione del dossier e al cambio di schema.
 *
 * - Solo i dossier creati da «Dal caso d'uso» (la chiave del template), non chiusi, con la scheda
 *   di portafoglio; solo i requisiti (i passi non sono domande).
 * - Stato: lo stesso dell'informazione. «validata» chiede alla voce una risposta validata
 *   (`uc_items_validata_complete_chk`): si aggiunge una risposta di sistema (`source_kind = 'import'`,
 *   `source_ref = 'use_case_need:<id>'`, senza valore) con chi ha scritto in «Cosa serve» (o il
 *   responsabile del dossier) come validatore. Senza nessuno dei due la voce resta «in verifica».
 *   «mancante» porta il motivo fisso; «non applicabile», archiviata o scollegata: la voce esce dal
 *   dossier (`deleted_at`) e ci torna se l'informazione torna.
 * - Un'informazione nuova collegata allo use case diventa una voce nuova (`needItemsInsertSql`).
 * - Ogni dossier toccato alza `catalog_revision`: la prontezza in cache diventa vecchia e la testata
 *   la ricalcola dal vivo (come dopo un comando sul catalogo).
 * - Una scrittura che non cambia niente non tocca righe.
 *
 * Modulo puro: solo costruttori `{ text, params }`.
 */
import { FROM_USE_CASE_TEMPLATE, NEED_MISSING_REASON, NEED_TOPICS, NEED_VALIDATED_NOTE } from "../template/from-use-case.ts";
import { cast, raw, toStatement, ucSql, type SqlFragment, type UcStatement } from "./statement.ts";

export interface NeedItemsScope {
  workspaceId: string;
  /** I dossier di questi use case. */
  useCaseIds?: readonly string[];
  /** I dossier degli use case collegati a questa informazione, e quelli che hanno già la sua voce. */
  needId?: string | null;
  /** Un dossier preciso (creazione, cambio di schema). */
  caseId?: string | null;
  /** Chi scrive: validatore della risposta di sistema. */
  actorUserId?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuids = (ids: readonly string[] | undefined) => (ids ?? []).filter((id) => UUID_RE.test(id)).map((id) => id.toLowerCase());

/** Gli stati che passano così come sono dall'informazione alla voce. */
const SAME_STATUSES = ["da_chiedere", "chiesta", "mancante", "parziale", "in_verifica", "bloccata"] as const;
const TOPIC_KINDS = NEED_TOPICS.map((t) => t.kind);

function scopeFilter(s: NeedItemsScope): SqlFragment {
  const parts: SqlFragment[] = [];
  if (s.caseId && UUID_RE.test(s.caseId)) parts.push(ucSql`c.id = ${cast(s.caseId.toLowerCase(), "uuid")}`);
  const useCases = uuids(s.useCaseIds);
  if (useCases.length) parts.push(ucSql`c.portfolio_use_case_id = ANY(${cast(useCases, "uuid[]")})`);
  if (s.needId && UUID_RE.test(s.needId)) {
    const need = cast(s.needId.toLowerCase(), "uuid");
    parts.push(ucSql`c.portfolio_use_case_id IN (SELECT l.use_case_id FROM use_case_need_links l WHERE l.need_id = ${need})`);
    parts.push(ucSql`EXISTS (SELECT 1 FROM uc_items si WHERE si.case_id = c.id AND si.shared_item_id = ${need})`);
  }
  if (parts.length === 0) return raw("false");
  let out = parts[0];
  for (const p of parts.slice(1)) out = ucSql`${out} OR ${p}`;
  return ucSql`(${out})`;
}

/** I dossier «Dal caso d'uso» dell'ambito e le informazioni (requisiti) dei loro use case. */
function scopeCtes(s: NeedItemsScope): SqlFragment {
  const actor = cast(s.actorUserId && UUID_RE.test(s.actorUserId) ? s.actorUserId.toLowerCase() : null, "uuid");
  return ucSql`cs AS (
  SELECT c.id, c.workspace_id, c.portfolio_use_case_id AS use_case_id,
    coalesce(${actor}, c.ls_lead_user_id, c.created_by_user_id) AS validator
  FROM uc_cases c
  JOIN uc_templates t ON t.id = c.template_id AND t.key = ${cast(FROM_USE_CASE_TEMPLATE.key, "text")}
  WHERE c.workspace_id = ${cast(s.workspaceId.toLowerCase(), "uuid")} AND c.portfolio_use_case_id IS NOT NULL AND c.status <> 'chiuso'
    AND ${scopeFilter(s)}
), src AS (
  SELECT cs.id AS case_id, n.id AS need_id, n.title, n.kind, n.status, n.sort_order, n.archived_at,
    (n.title ~* '^\\s*facoltativ[ao]\\s*:' OR n.sort_order BETWEEN 500 AND 900) AS optional,
    'cs.' || CASE WHEN n.kind = ANY(${cast(TOPIC_KINDS, "text[]")}) THEN n.kind ELSE 'altro' END AS topic
  FROM cs
  JOIN use_case_need_links l ON l.use_case_id = cs.use_case_id
  JOIN use_case_needs n ON n.id = l.need_id AND n.workspace_id = cs.workspace_id AND n.type = 'requisito'
)`;
}

/** Le voci delle informazioni collegate che il dossier non ha ancora (stato iniziale «da chiedere»). */
export function needItemsInsertSql(s: NeedItemsScope): UcStatement {
  const actor = cast(s.actorUserId && UUID_RE.test(s.actorUserId) ? s.actorUserId.toLowerCase() : null, "uuid");
  return toStatement(ucSql`WITH ${scopeCtes(s)}, ins AS (
INSERT INTO uc_items (id, case_id, key, template_item_key, kind, section, title, explanation, spec, priority, serves_for,
  privacy_class, availability, perimeter, levers, response_config, request_module_key, in_gate_scope, status, source_refs,
  shared_item_id, sort_order, created_by_user_id)
SELECT gen_random_uuid(), src.case_id, 'need.' || src.need_id::text, 'need.' || src.need_id::text, 'domanda', 'documenti_dataset',
  left(src.title, 600), NULL,
  jsonb_build_object('need_id', src.need_id::text, 'from', 'cosa_serve'),
  CASE WHEN src.optional THEN 'could' ELSE 'must' END, '["modello"]'::jsonb, 'riservato_azienda', '[]'::jsonb, 'in_contratto',
  '[]'::jsonb, '{}'::jsonb, src.topic, true, 'da_chiedere', jsonb_build_array('use_case_need:' || src.need_id::text),
  src.need_id, src.sort_order, ${actor}
FROM src
WHERE src.archived_at IS NULL AND src.status <> 'non_applicabile'
  AND NOT EXISTS (SELECT 1 FROM uc_items i WHERE i.case_id = src.case_id AND i.shared_item_id = src.need_id)
ON CONFLICT (case_id, key) DO NOTHING
RETURNING case_id
), bump AS (
  UPDATE uc_cases c SET catalog_revision = c.catalog_revision + 1, updated_at = now()
  WHERE c.id IN (SELECT DISTINCT case_id FROM ins)
  RETURNING c.id
)
SELECT (SELECT count(*) FROM ins)::int AS items, (SELECT count(*) FROM bump)::int AS cases`);
}

/**
 * Le voci collegate già nel dossier prendono titolo, dettaglio, argomento, priorità, ordine e stato
 * dell'informazione; escono se l'informazione è archiviata, non si applica o non è più collegata.
 * Restituisce `items` (voci cambiate) e `cases` (dossier con `catalog_revision` alzata).
 */
export function needItemsUpdateSql(s: NeedItemsScope): UcStatement {
  return toStatement(ucSql`WITH ${scopeCtes(s)}, cur AS (
  SELECT i.id, i.case_id, i.shared_item_id AS need_id, i.status, i.deleted_at, i.validated_answer_id, cs.validator
  FROM uc_items i JOIN cs ON cs.id = i.case_id
  WHERE i.shared_item_id IS NOT NULL AND i.template_item_key LIKE 'need.%'
), want AS (
  SELECT cur.id AS item_id, cur.case_id, cur.need_id, cur.status AS cur_status, cur.validated_answer_id AS cur_answer, cur.validator,
    (src.need_id IS NULL OR src.archived_at IS NOT NULL OR src.status = 'non_applicabile') AS gone,
    left(src.title, 600) AS title, src.topic, src.sort_order,
    CASE WHEN src.optional THEN 'could' ELSE 'must' END AS priority,
    CASE
      WHEN src.status = 'validata' AND cur.validator IS NOT NULL THEN 'validata'
      WHEN src.status = 'validata' THEN 'in_verifica'
      WHEN src.status = ANY(${cast([...SAME_STATUSES], "text[]")}) THEN src.status
      ELSE 'da_chiedere'
    END AS status
  FROM cur LEFT JOIN src ON src.case_id = cur.case_id AND src.need_id = cur.need_id
), ans AS (
  INSERT INTO uc_answers (case_id, item_id, version, kind, source_kind, source_ref, responder_user_id, note)
  SELECT w.case_id, w.item_id, coalesce((SELECT max(a.version) FROM uc_answers a WHERE a.item_id = w.item_id), 0) + 1,
    'conferma', 'import', 'use_case_need:' || w.need_id::text, w.validator, ${cast(NEED_VALIDATED_NOTE, "text")}
  FROM want w
  WHERE NOT w.gone AND w.status = 'validata' AND (w.cur_status <> 'validata' OR w.cur_answer IS NULL)
  RETURNING id, item_id
), upd AS (
  UPDATE uc_items i SET
    title = CASE WHEN w.gone THEN i.title ELSE w.title END,
    explanation = NULL,
    priority = CASE WHEN w.gone THEN i.priority ELSE w.priority END,
    request_module_key = CASE WHEN w.gone THEN i.request_module_key ELSE w.topic END,
    sort_order = CASE WHEN w.gone THEN i.sort_order ELSE w.sort_order END,
    status = CASE WHEN w.gone THEN i.status ELSE w.status END,
    status_reason = CASE WHEN w.gone THEN i.status_reason WHEN w.status = 'mancante' THEN ${cast(NEED_MISSING_REASON, "text")} ELSE NULL END,
    status_changed_at = CASE WHEN NOT w.gone AND w.status <> i.status THEN now() ELSE i.status_changed_at END,
    current_answer_id = CASE WHEN w.gone THEN i.current_answer_id WHEN w.status = 'validata' THEN coalesce(ans.id, i.current_answer_id) ELSE NULL END,
    validated_answer_id = CASE WHEN w.gone THEN i.validated_answer_id WHEN w.status = 'validata' THEN coalesce(ans.id, i.validated_answer_id) ELSE NULL END,
    validated_by_user_id = CASE WHEN w.gone THEN i.validated_by_user_id
      WHEN w.status = 'validata' THEN CASE WHEN ans.id IS NULL THEN coalesce(i.validated_by_user_id, w.validator) ELSE w.validator END
      ELSE NULL END,
    validated_at = CASE WHEN w.gone THEN i.validated_at
      WHEN w.status = 'validata' THEN CASE WHEN ans.id IS NULL THEN coalesce(i.validated_at, now()) ELSE now() END
      ELSE NULL END,
    deleted_at = CASE WHEN w.gone THEN coalesce(i.deleted_at, now()) ELSE NULL END,
    updated_at = now()
  FROM want w LEFT JOIN ans ON ans.item_id = w.item_id
  WHERE i.id = w.item_id AND (
    (w.gone AND i.deleted_at IS NULL)
    OR (NOT w.gone AND (
      i.deleted_at IS NOT NULL OR ans.id IS NOT NULL OR i.status IS DISTINCT FROM w.status
      OR i.title IS DISTINCT FROM w.title OR i.explanation IS NOT NULL OR i.priority IS DISTINCT FROM w.priority
      OR i.request_module_key IS DISTINCT FROM w.topic OR i.sort_order IS DISTINCT FROM w.sort_order
      OR (w.status <> 'validata' AND (i.validated_answer_id IS NOT NULL OR i.current_answer_id IS NOT NULL))
      OR (w.status = 'mancante' AND i.status_reason IS DISTINCT FROM ${cast(NEED_MISSING_REASON, "text")}))))
  RETURNING i.case_id
), bump AS (
  UPDATE uc_cases c SET catalog_revision = c.catalog_revision + 1, updated_at = now()
  WHERE c.id IN (SELECT DISTINCT case_id FROM upd)
  RETURNING c.id
)
SELECT (SELECT count(*) FROM upd)::int AS items, (SELECT count(*) FROM bump)::int AS cases`);
}

// ── Le voci collegate si gestiscono solo in «Cosa serve» ────────────────

/** Codice uc (e di `Result`) di un comando del dossier su una voce collegata a «Cosa serve». */
export const LINKED_ITEM_CODE = "voce_da_cosa_serve";

/** Voce collegata (alias `li`): l'informazione è in `shared_item_id`, la chiave è `need.<id>`. */
const LINKED = raw("li.shared_item_id IS NOT NULL AND li.template_item_key LIKE 'need.%'");

/**
 * Guardia per la SELECT finale di un'istruzione che chiede, assegna o risponde (prima del controllo
 * del conteggio, così vince il messaggio giusto): nessuna delle voci `ids` (un frammento che
 * restituisce uuid) del caso è collegata a «Cosa serve», altrimenti `uc:voce_da_cosa_serve` e
 * l'istruzione intera non scrive. Non dipende dalle righe: si valuta sempre, una volta.
 */
export function linkedItemsGuard(caseId: SqlFragment, ids: SqlFragment): SqlFragment {
  return ucSql`uc_require(NOT EXISTS (SELECT 1 FROM uc_items li WHERE li.case_id = ${caseId} AND li.id IN (${ids}) AND ${LINKED}), ${raw(`'${LINKED_ITEM_CODE}'`)})`;
}

/** Quali tra queste voci del caso sono collegate a «Cosa serve» (per rifiutare prima, con il messaggio giusto). */
export function linkedItemIdsSql(caseId: string, itemIds: readonly string[]): UcStatement {
  return toStatement(ucSql`SELECT li.id FROM uc_items li
WHERE li.case_id = ${cast(caseId.toLowerCase(), "uuid")} AND li.id = ANY(${cast(uuids(itemIds), "uuid[]")}) AND ${LINKED}`);
}

/** Prima le voci nuove, poi lo stato di tutte (la seconda istruzione vede le righe della prima). */
export function needItemsSyncStatements(s: NeedItemsScope): UcStatement[] {
  return [needItemsInsertSql(s), needItemsUpdateSql(s)];
}
