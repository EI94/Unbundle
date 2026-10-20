/**
 * Costruttori SQL dei comandi interni sui casi, sulle voci, sui gate e sui
 * blocchi (PIANO §1.1, §3.2–§3.6, §5.3, §5.10).
 *
 * Regole di scrittura, uguali per tutti i comandi:
 * - ogni cambio di stato è un **compare-and-swap**: `UPDATE … WHERE status =
 *   <da> AND current_answer_id IS NOT DISTINCT FROM <letta> … RETURNING`, dentro
 *   una CTE che scrive l'evento solo per le righe davvero aggiornate e chiude con
 *   `uc_require(count(*) = n, 'conflitto')`: un CAS perso annulla tutto il batch;
 * - ogni batch che tocca il catalogo apre con `caseRevisionSql`: alza
 *   `uc_cases.catalog_revision` controllando lo stato del caso (e, per i gate, la
 *   revisione letta). Il lucchetto sulla riga del caso mette in fila i comandi
 *   dello stesso caso;
 * - `uc_events` si scrive nello stesso batch, con il payload ripulito da
 *   `eventPayload` (solo chiavi, stati, conteggi, codici).
 *
 * `planItemTransitions` chiama `checkItemTransition` per ogni voce e
 * `transitionStatements` raggruppa le transizioni uguali in un solo UPDATE
 * (es. 300 voci sbloccate da `a8`).
 *
 * Modulo puro: solo costruttori `{ text, params }` e funzioni senza I/O.
 */
import { eventActorFrom, eventInsertFromSql, eventInsertSql, type EventActor, type UcEventType } from "../../db/queries/uc-events.ts";
import { checkItemTransition, type ActorRequestItem, type IncomingAnswer, type ItemPatch, type ItemSideEffect, type ItemTransitionPlan, type ItemTrigger } from "../item-state.ts";
import type { CasePatch } from "../case-state.ts";
import { fail, ok, type Actor, type AnswerMeta, type Approval, type Fallback, type ItemSnapshot, type Json, type PartialNa, type Result, type UserContext, type Waiver } from "../types.ts";
import {
  ACTIVE_REQUEST_ITEM_STATES,
  ANSWER_KINDS,
  ANSWER_SOURCE_KINDS,
  BLOCKER_STATUSES,
  ITEM_BLOCKER_ORIGINS,
  ITEM_KINDS,
  ITEM_STATUSES,
  PERIMETERS,
  PHASES,
  PRIORITIES,
  PRIVACY_CLASSES,
  RESPONSE_TYPES,
  type AnswerKind,
  type BlockerStatus,
  type CaseStatus,
  type CommentKind,
  type CommentVisibility,
  type Confidence,
  type GateDecision,
  type GateKey,
  type ItemBlockerOrigin,
  type ItemStatus,
  type RequestItemState,
  type SourceBasis,
  type SourceKind,
  type ValidationKind,
  type ValidationOutcome,
} from "../vocab.ts";
import { rowBool, rowDate, rowIsoDate, rowJson, rowNumber, rowObject, rowString, rowStringArray, rowVocab, type Row } from "./readiness.ts";
import { cast, join, jsonb, raw, ref, requireRows, toStatement, ucSql, type SqlFragment, type UcStatement } from "./statement.ts";

const ACTIVE_STATES_SQL = ACTIVE_REQUEST_ITEM_STATES.map((s) => `'${s}'`).join(", ");
const CODE = /^[a-z0-9_]{1,60}$/;

function code(value: string | null | undefined): string | undefined {
  return value && CODE.test(value) ? value : undefined;
}

function ts(value: Date | null | undefined): SqlFragment {
  return cast(value ? value.toISOString() : null, "timestamptz");
}

function requireCount(expected: number, errorCode = "conflitto"): SqlFragment {
  if (!Number.isInteger(expected) || expected < 0) throw new Error("Numero di righe atteso non valido");
  if (!CODE.test(errorCode)) throw new Error("Codice uc non valido");
  return ucSql`uc_require(count(*) = ${cast(expected, "int")}, ${raw(`'${errorCode}'`)})`;
}

// ── Fotografia delle voci per i comandi ───────────────────────────────

/** Dati della riga che servono ai comandi oltre a `ItemSnapshot`. Mai valori delle risposte. */
export interface ItemRowExtra {
  title: string;
  section: string;
  statusReason: string | null;
  spec: Record<string, Json>;
  responseConfig: Record<string, Json>;
  availability: string[];
  levers: string[];
  requestModuleKey: string | null;
  valueVisibility: string | null;
  parentItemId: string | null;
  explanation: string | null;
  why: string | null;
  example: string | null;
  help: string | null;
  dueAt: Date | null;
  dueIsProposal: boolean;
  validatedAnswerId: string | null;
  validatedAnswerValidFrom: string | null;
  validatedAnswerCreatedAt: Date | null;
  waiverApprovedAt: Date | null;
  fallbackApprovedAt: Date | null;
  /** Richiesta attiva della voce (`uc_request_items` da_fare, bozza, inviata). */
  activeRequestId: string | null;
  /** Righe `uc_item_blockers` con lo stato del blocco. */
  blockerLinks: { blockerId: string; key: string; origin: ItemBlockerOrigin; status: BlockerStatus }[];
  healthRuleQuestion: boolean;
  updatedAt: Date | null;
}

export interface LoadedItem {
  snapshot: ItemSnapshot;
  extra: ItemRowExtra;
}

/**
 * Voci del caso (`itemIds` oppure tutte con uno stato tra `statuses`) con i
 * metadati della risposta corrente, chi ha risposto, chi ha copiato il link, i
 * blocchi e i chiarimenti aperti: tutto quello che serve ai controlli puri.
 */
export function itemSnapshotsSql(caseId: string, filter: { itemIds: readonly string[] } | { statuses: readonly ItemStatus[] }): UcStatement {
  const where = "itemIds" in filter ? ucSql`i.id = ANY(${cast([...filter.itemIds], "uuid[]")})` : ucSql`i.status = ANY(${cast([...filter.statuses], "text[]")})`;
  return toStatement(ucSql`SELECT i.id, i.key, i.kind, i.section, i.status, i.status_reason, i.priority, i.perimeter, i.serves_for, i.in_gate_scope,
  i.privacy_class, i.value_visibility, i.response_type, i.response_config, i.owner_role_key, i.assignee_contact_id,
  i.requires_validity_period, i.freshness_days, i.stale_at, i.current_answer_id, i.validated_answer_id, i.confirmed_by_contact_id,
  i.na_reason, i.na_proposed_at, i.na_approved_by_user_id, i.na_client_approved_by_user_id, i.na_approved_by_contact_id, i.na_approved_at,
  i.waiver, i.waiver_approved_at, i.fallback, i.fallback_approved_at, i.partial_na, i.availability, i.levers, i.request_module_key, i.spec, i.title, i.explanation, i.why, i.example,
  i.help, i.parent_item_id, i.due_at, i.due_is_proposal, i.updated_at,
  a.id AS a_id, a.version AS a_version, a.kind AS a_kind, a.source_kind AS a_source_kind, a.responder_contact_id AS a_responder_contact_id,
  a.responder_user_id AS a_responder_user_id, a.request_id AS a_request_id, a.valid_from::text AS a_valid_from, a.created_at AS a_created_at,
  a.text_hash AS a_text_hash, (a.value_normalized IS NOT NULL OR a.value_encrypted IS NOT NULL) AS a_typed,
  r.acting_role_key AS responder_role_key,
  va.valid_from::text AS va_valid_from, va.created_at AS va_created_at,
  CASE WHEN i.confirmed_by_contact_id IS NULL THEN NULL ELSE (
    SELECT r2.acting_role_key FROM uc_answers ca JOIN uc_requests r2 ON r2.id = ca.request_id
    WHERE ca.item_id = i.id AND ca.responder_contact_id = i.confirmed_by_contact_id
    ORDER BY ca.version DESC LIMIT 1) END AS confirmed_by_role_key,
  coalesce((SELECT jsonb_agg(DISTINCT x.responder_user_id) FROM uc_answers x WHERE x.item_id = i.id AND x.responder_user_id IS NOT NULL), '[]'::jsonb) AS responder_user_ids,
  coalesce((SELECT jsonb_agg(DISTINCT t.issued_by_user_id) FROM uc_request_tokens t
    WHERE a.request_id IS NOT NULL AND t.request_id = a.request_id AND t.issued_by_user_id IS NOT NULL), '[]'::jsonb) AS token_issuer_user_ids,
  coalesce((SELECT jsonb_agg(jsonb_build_object('blocker_id', b.id, 'key', b.key, 'origin', ib.origin, 'status', b.status) ORDER BY b.key)
    FROM uc_item_blockers ib JOIN uc_blockers b ON b.id = ib.blocker_id WHERE ib.item_id = i.id), '[]'::jsonb) AS blocker_links,
  EXISTS (SELECT 1 FROM uc_comments cm WHERE cm.item_id = i.id AND cm.kind = 'chiarimento_richiesto' AND cm.resolved_at IS NULL) AS open_clarification,
  (SELECT ri.request_id FROM uc_request_items ri WHERE ri.item_id = i.id AND ri.state IN (${raw(ACTIVE_STATES_SQL)}) LIMIT 1) AS active_request_id,
  EXISTS (SELECT 1 FROM uc_validations v WHERE v.item_id = i.id AND v.answer_id = i.current_answer_id AND v.kind = 'automatica' AND v.outcome = 'errore') AS last_auto_check_error
FROM uc_items i
LEFT JOIN uc_answers a ON a.id = i.current_answer_id
LEFT JOIN uc_requests r ON r.id = a.request_id
LEFT JOIN uc_answers va ON va.id = i.validated_answer_id
WHERE i.case_id = ${cast(caseId, "uuid")} AND i.deleted_at IS NULL AND ${where}
ORDER BY i.sort_order, i.key`);
}

function answerMetaFromRow(row: Row): AnswerMeta | null {
  if (!row.a_id) return null;
  const kind = rowVocab(ANSWER_KINDS, row.a_kind);
  const sourceKind = rowVocab(ANSWER_SOURCE_KINDS, row.a_source_kind);
  if (!kind || !sourceKind) return null;
  return {
    id: String(row.a_id),
    version: rowNumber(row.a_version) ?? 1,
    kind,
    sourceKind,
    responderContactId: rowString(row.a_responder_contact_id),
    responderUserId: rowString(row.a_responder_user_id),
    requestId: rowString(row.a_request_id),
    validFrom: rowIsoDate(row.a_valid_from),
    createdAt: rowDate(row.a_created_at) ?? new Date(0),
    textHash: rowString(row.a_text_hash),
    typed: rowBool(row.a_typed),
  };
}

function objectOrNull<T>(v: unknown): T | null {
  const o = rowJson<T>(v);
  return o && typeof o === "object" && !Array.isArray(o) ? o : null;
}

/** Riga di `itemSnapshotsSql` → fotografia per i controlli puri + dati della riga. */
export function rowToLoadedItem(row: Row): LoadedItem {
  const blockerLinks = (rowJson<unknown[]>(row.blocker_links) ?? [])
    .filter((l): l is Record<string, unknown> => !!l && typeof l === "object")
    .map((l) => ({
      blockerId: String(l.blocker_id),
      key: String(l.key),
      origin: rowVocab(ITEM_BLOCKER_ORIGINS, l.origin) ?? "manuale",
      status: rowVocab(BLOCKER_STATUSES, l.status) ?? "attivo",
    }));
  const spec = rowObject(row.spec);
  const snapshot: ItemSnapshot = {
    id: String(row.id),
    key: String(row.key),
    kind: rowVocab(ITEM_KINDS, row.kind) ?? "domanda",
    status: rowVocab(ITEM_STATUSES, row.status) ?? "da_chiedere",
    priority: rowVocab(PRIORITIES, row.priority),
    perimeter: rowVocab(PERIMETERS, row.perimeter),
    servesFor: rowStringArray(rowJson(row.serves_for)).filter((p): p is (typeof PHASES)[number] => (PHASES as readonly string[]).includes(p)),
    inGateScope: rowBool(row.in_gate_scope),
    privacyClass: rowVocab(PRIVACY_CLASSES, row.privacy_class) ?? "riservato_azienda",
    responseType: rowVocab(RESPONSE_TYPES, row.response_type),
    ownerRoleKey: rowString(row.owner_role_key),
    assigneeContactId: rowString(row.assignee_contact_id),
    requiresValidityPeriod: rowBool(row.requires_validity_period),
    freshnessDays: rowNumber(row.freshness_days),
    staleAt: rowDate(row.stale_at),
    currentAnswer: answerMetaFromRow(row),
    answerResponderUserIds: rowStringArray(rowJson(row.responder_user_ids)),
    currentAnswerTokenIssuerUserIds: rowStringArray(rowJson(row.token_issuer_user_ids)),
    confirmedByContactId: rowString(row.confirmed_by_contact_id),
    confirmedByRoleKey: rowString(row.confirmed_by_role_key),
    responderRoleKey: rowString(row.responder_role_key),
    na: {
      reason: rowString(row.na_reason),
      proposedAt: rowDate(row.na_proposed_at),
      lsUserId: rowString(row.na_approved_by_user_id),
      clientUserId: rowString(row.na_client_approved_by_user_id),
      clientContactId: rowString(row.na_approved_by_contact_id),
      approvedAt: rowDate(row.na_approved_at),
    },
    waiver: objectOrNull<Waiver>(row.waiver),
    fallback: objectOrNull<Fallback>(row.fallback),
    partialNa: objectOrNull<PartialNa>(row.partial_na),
    activeBlockerKeys: blockerLinks.filter((l) => l.status === "attivo" || l.status === "permanente").map((l) => l.key),
    openClarification: rowBool(row.open_clarification),
    hasActiveRequestItem: row.active_request_id !== null && row.active_request_id !== undefined,
    lastAutoCheckError: rowBool(row.last_auto_check_error),
  };
  return {
    snapshot,
    extra: {
      title: String(row.title ?? ""),
      section: String(row.section ?? "modello_dati"),
      statusReason: rowString(row.status_reason),
      spec,
      responseConfig: rowObject(row.response_config),
      availability: rowStringArray(rowJson(row.availability)),
      levers: rowStringArray(rowJson(row.levers)),
      requestModuleKey: rowString(row.request_module_key),
      valueVisibility: rowString(row.value_visibility),
      parentItemId: rowString(row.parent_item_id),
      explanation: rowString(row.explanation),
      why: rowString(row.why),
      example: rowString(row.example),
      help: rowString(row.help),
      dueAt: rowDate(row.due_at),
      dueIsProposal: rowBool(row.due_is_proposal),
      validatedAnswerId: rowString(row.validated_answer_id),
      validatedAnswerValidFrom: rowIsoDate(row.va_valid_from),
      validatedAnswerCreatedAt: rowDate(row.va_created_at),
      waiverApprovedAt: rowDate(row.waiver_approved_at),
      fallbackApprovedAt: rowDate(row.fallback_approved_at),
      activeRequestId: rowString(row.active_request_id),
      blockerLinks,
      healthRuleQuestion: spec.health_rule_question === true,
      updatedAt: rowDate(row.updated_at),
    },
  };
}

// ── SET delle colonne di `uc_items` ───────────────────────────────────

type ColumnType = "text" | "uuid" | "timestamptz";

/** `ItemPatch` (camelCase) → colonne. */
export const ITEM_PATCH_COLUMNS: Readonly<Record<keyof ItemPatch, { column: string; type: ColumnType }>> = {
  status: { column: "status", type: "text" },
  statusReason: { column: "status_reason", type: "text" },
  statusChangedAt: { column: "status_changed_at", type: "timestamptz" },
  validatedAnswerId: { column: "validated_answer_id", type: "uuid" },
  validatedByUserId: { column: "validated_by_user_id", type: "uuid" },
  validatedAt: { column: "validated_at", type: "timestamptz" },
  staleAt: { column: "stale_at", type: "timestamptz" },
  naReason: { column: "na_reason", type: "text" },
  naProposedAt: { column: "na_proposed_at", type: "timestamptz" },
  naProposedByUserId: { column: "na_proposed_by_user_id", type: "uuid" },
  naProposedByContactId: { column: "na_proposed_by_contact_id", type: "uuid" },
  naApprovedByUserId: { column: "na_approved_by_user_id", type: "uuid" },
  naClientApprovedByUserId: { column: "na_client_approved_by_user_id", type: "uuid" },
  naApprovedByContactId: { column: "na_approved_by_contact_id", type: "uuid" },
  naApprovedAt: { column: "na_approved_at", type: "timestamptz" },
  confirmedByContactId: { column: "confirmed_by_contact_id", type: "uuid" },
};

/** Colonne che i comandi scrivono oltre a quelle delle transizioni. */
export interface ItemExtraSet {
  currentAnswerId?: string | null;
  waiver?: Waiver | null;
  waiverApprovedAt?: Date | null;
  fallback?: Fallback | null;
  fallbackApprovedAt?: Date | null;
  partialNa?: PartialNa | null;
}

function valueFragment(value: unknown, type: ColumnType): SqlFragment {
  if (type === "timestamptz") return ts(value instanceof Date ? value : value === null || value === undefined ? null : new Date(String(value)));
  return cast(value ?? null, type);
}

/** `col = $n, …, updated_at = now()` (solo le chiavi presenti). */
export function itemSetSql(patch: Partial<ItemPatch>, extra: ItemExtraSet = {}): SqlFragment {
  const parts: SqlFragment[] = [];
  for (const key of Object.keys(ITEM_PATCH_COLUMNS) as (keyof ItemPatch)[]) {
    if (!(key in patch) || patch[key] === undefined) continue;
    const { column, type } = ITEM_PATCH_COLUMNS[key];
    parts.push(ucSql`${raw(column)} = ${valueFragment(patch[key], type)}`);
  }
  if ("currentAnswerId" in extra && extra.currentAnswerId !== undefined) parts.push(ucSql`current_answer_id = ${cast(extra.currentAnswerId, "uuid")}`);
  if ("waiver" in extra && extra.waiver !== undefined) parts.push(ucSql`waiver = ${extra.waiver === null ? raw("NULL") : jsonb(extra.waiver)}`);
  if ("waiverApprovedAt" in extra && extra.waiverApprovedAt !== undefined) parts.push(ucSql`waiver_approved_at = ${ts(extra.waiverApprovedAt)}`);
  if ("fallback" in extra && extra.fallback !== undefined) parts.push(ucSql`fallback = ${extra.fallback === null ? raw("NULL") : jsonb(extra.fallback)}`);
  if ("fallbackApprovedAt" in extra && extra.fallbackApprovedAt !== undefined) parts.push(ucSql`fallback_approved_at = ${ts(extra.fallbackApprovedAt)}`);
  if ("partialNa" in extra && extra.partialNa !== undefined) parts.push(ucSql`partial_na = ${extra.partialNa === null ? raw("NULL") : jsonb(extra.partialNa)}`);
  parts.push(raw("updated_at = now()"));
  return join(parts, ", ");
}

// ── CAS sulle voci ────────────────────────────────────────────────────

/** Valori letti dal comando: la riga si aggiorna solo se sono ancora questi. */
export interface ItemCasTarget {
  id: string;
  currentAnswerId: string | null;
  /** Proposta NA letta (confronto al millisecondo); `undefined` = non controllata. */
  naProposedAt?: Date | null;
}

export interface ItemUpdateEvent {
  type: UcEventType;
  actor: EventActor;
  payload?: Record<string, unknown>;
  /** Scrive `from_state`/`to_state` (cambi di stato). */
  states?: boolean;
}

export interface ItemUpdateSpec {
  workspaceId: string;
  caseId: string;
  targets: readonly ItemCasTarget[];
  /** Stato atteso di ogni voce. */
  from: ItemStatus;
  set: SqlFragment;
  /** Condizioni in più sulla riga (alias `i`), es. nessun chiarimento aperto. */
  guards?: readonly SqlFragment[];
  /** Eventi per ogni riga aggiornata. */
  events: readonly ItemUpdateEvent[];
  errorCode?: string;
}

/**
 * CAS su una o più voci con lo stesso stato di partenza e lo stesso SET, più un
 * evento per ogni riga davvero aggiornata. Se anche una sola voce non si
 * aggiorna, `uc_require` annulla il batch.
 */
export function itemUpdateSql(spec: ItemUpdateSpec): UcStatement {
  if (spec.targets.length === 0) throw new Error("Nessuna voce da aggiornare");
  const targets = spec.targets.map((t) => ({
    id: t.id,
    cur: t.currentAnswerId,
    check_nap: t.naProposedAt !== undefined,
    nap: t.naProposedAt ? t.naProposedAt.toISOString() : null,
  }));
  const guards = (spec.guards ?? []).map((g) => ucSql` AND ${g}`);
  const events = spec.events.map((e, index) =>
    ucSql`, ${raw(`ev${index}`)} AS (${eventInsertFromSql({
      type: e.type,
      workspaceId: spec.workspaceId,
      caseId: spec.caseId,
      actor: e.actor,
      targetType: "voce",
      from: "u",
      targetIdColumn: "u.id",
      ...(e.states ? { fromStateColumn: "u.from_status", toStateColumn: "u.status" } : {}),
      payload: e.payload,
      rowPayload: { item_key: "u.key" },
    })})`,
  );
  return toStatement(ucSql`WITH x AS (
  SELECT * FROM jsonb_to_recordset(${jsonb(targets)}) AS x(id uuid, cur uuid, check_nap boolean, nap timestamptz)
), u AS (
  UPDATE uc_items i SET ${spec.set}
  FROM x
  WHERE i.id = x.id AND i.case_id = ${cast(spec.caseId, "uuid")} AND i.status = ${cast(spec.from, "text")} AND i.deleted_at IS NULL
    AND i.current_answer_id IS NOT DISTINCT FROM x.cur
    AND (NOT x.check_nap OR date_trunc('milliseconds', i.na_proposed_at) IS NOT DISTINCT FROM x.nap)${join(guards, "")}
  RETURNING i.id, i.key, i.status, ${cast(spec.from, "text")} AS from_status
)${join(events, "")}
SELECT ${requireCount(targets.length, spec.errorCode)} AS ok FROM u`);
}

/** Nessun chiarimento aperto sulla voce (guardia SQL della validazione). */
export const NO_OPEN_CLARIFICATION: SqlFragment = raw(
  "NOT EXISTS (SELECT 1 FROM uc_comments cm WHERE cm.item_id = i.id AND cm.kind = 'chiarimento_richiesto' AND cm.resolved_at IS NULL)",
);

/** Nessun blocco attivo o permanente sulla voce (guardia SQL dello sblocco). */
export const NO_ACTIVE_BLOCKER: SqlFragment = raw(
  "NOT EXISTS (SELECT 1 FROM uc_item_blockers ib JOIN uc_blockers b ON b.id = ib.blocker_id WHERE ib.item_id = i.id AND b.status IN ('attivo', 'permanente'))",
);

/** `waiver` della voce ancora uguale a quello letto. */
export function waiverIs(value: Waiver | null): SqlFragment {
  return value === null ? raw("i.waiver IS NULL") : ucSql`i.waiver = ${jsonb(value)}`;
}

export function fallbackIs(value: Fallback | null): SqlFragment {
  return value === null ? raw("i.fallback IS NULL") : ucSql`i.fallback = ${jsonb(value)}`;
}

/** Colonne di firma NA ancora vuote (nessuno ha firmato nel frattempo). */
export function naSignatureColumnsAre(i: { ls: string | null; clientUser: string | null; clientContact: string | null }): SqlFragment {
  return ucSql`i.na_approved_by_user_id IS NOT DISTINCT FROM ${cast(i.ls, "uuid")}
    AND i.na_client_approved_by_user_id IS NOT DISTINCT FROM ${cast(i.clientUser, "uuid")}
    AND i.na_approved_by_contact_id IS NOT DISTINCT FROM ${cast(i.clientContact, "uuid")}`;
}

/** Stato delle righe `uc_request_items` delle voci. Senza `requestId` tocca solo le righe attive. */
export function requestItemsStateSql(i: { caseId: string; itemIds: readonly string[]; state: RequestItemState; requestId?: string | null }): UcStatement {
  const scope = i.requestId ? ucSql`request_id = ${cast(i.requestId, "uuid")}` : raw(`state IN (${ACTIVE_STATES_SQL})`);
  return toStatement(ucSql`UPDATE uc_request_items SET state = ${cast(i.state, "text")}
WHERE case_id = ${cast(i.caseId, "uuid")} AND item_id = ANY(${cast([...i.itemIds], "uuid[]")}) AND ${scope}`);
}

// ── Riga del caso ─────────────────────────────────────────────────────

/**
 * Apre ogni batch sul catalogo: alza `catalog_revision` solo se il caso è ancora
 * in uno degli stati attesi (e, per i gate, alla revisione letta). Il lucchetto
 * sulla riga mette in fila i comandi concorrenti dello stesso caso.
 */
export function caseRevisionSql(i: { workspaceId: string; caseId: string; expectStatus?: readonly CaseStatus[]; expectRevision?: number; bump?: boolean }): UcStatement {
  const status = i.expectStatus?.length ? ucSql` AND status = ANY(${cast([...i.expectStatus], "text[]")})` : raw("");
  const revision = i.expectRevision !== undefined ? ucSql` AND catalog_revision = ${cast(i.expectRevision, "int")}` : raw("");
  const set = i.bump === false ? raw("updated_at = now()") : raw("catalog_revision = catalog_revision + 1, updated_at = now()");
  return toStatement(
    requireRows(
      ucSql`UPDATE uc_cases SET ${set}
WHERE id = ${cast(i.caseId, "uuid")} AND workspace_id = ${cast(i.workspaceId, "uuid")} AND setup_completed_at IS NOT NULL${status}${revision}
RETURNING id`,
      1,
      "conflitto",
    ),
  );
}

/** Cambio di stato del caso con CAS su stato e stato prima della sospensione, più l'evento. */
export function caseTransitionSql(i: {
  workspaceId: string;
  caseId: string;
  from: CaseStatus;
  statusBeforeSuspension: CaseStatus | null;
  patch: CasePatch;
  actor: EventActor;
  reasonCode?: string | null;
  /** Revisione letta: il caso cambia solo se nessuno ha toccato il catalogo nel frattempo. */
  expectRevision?: number;
  extraSet?: SqlFragment;
}): UcStatement {
  const p = i.patch;
  const sets: SqlFragment[] = [ucSql`status = ${cast(p.status, "text")}`, ucSql`status_changed_at = ${ts(p.statusChangedAt)}`];
  if (p.statusBeforeSuspension !== undefined) sets.push(ucSql`status_before_suspension = ${cast(p.statusBeforeSuspension, "text")}`);
  if (p.suspensionReason !== undefined) sets.push(ucSql`suspension_reason = ${cast(p.suspensionReason, "text")}`);
  if (p.closedReason !== undefined) sets.push(ucSql`closed_reason = ${cast(p.closedReason, "text")}`);
  if (p.closedAt !== undefined) sets.push(ucSql`closed_at = ${ts(p.closedAt)}`);
  if (i.extraSet) sets.push(i.extraSet);
  sets.push(raw("catalog_revision = catalog_revision + 1, updated_at = now()"));
  const revision = i.expectRevision !== undefined ? ucSql` AND catalog_revision = ${cast(i.expectRevision, "int")}` : raw("");
  const event = eventInsertFromSql({
    type: "caso.stato_cambiato",
    workspaceId: i.workspaceId,
    caseId: i.caseId,
    actor: i.actor,
    targetType: "caso",
    from: "u",
    targetIdColumn: "u.id",
    fromStateColumn: "u.from_status",
    toStateColumn: "u.status",
    payload: { from: i.from, to: p.status, reason: code(i.reasonCode) },
  });
  return toStatement(ucSql`WITH u AS (
  UPDATE uc_cases SET ${join(sets, ", ")}
  WHERE id = ${cast(i.caseId, "uuid")} AND workspace_id = ${cast(i.workspaceId, "uuid")} AND setup_completed_at IS NOT NULL
    AND status = ${cast(i.from, "text")} AND status_before_suspension IS NOT DISTINCT FROM ${cast(i.statusBeforeSuspension, "text")}${revision}
  RETURNING id, status, ${cast(i.from, "text")} AS from_status
), ev AS (${event})
SELECT ${requireCount(1)} AS ok FROM u`);
}

/** Richieste del caso revocate (chiusura del caso), con un evento per richiesta. */
export function revokeCaseRequestsSql(i: { workspaceId: string; caseId: string; actor: EventActor; reasonCode: string }): UcStatement {
  const event = eventInsertFromSql({
    type: "richiesta.revocata",
    workspaceId: i.workspaceId,
    caseId: i.caseId,
    actor: i.actor,
    targetType: "richiesta",
    from: "u",
    targetIdColumn: "u.id",
    payload: { reason: code(i.reasonCode) },
  });
  return toStatement(ucSql`WITH u AS (
  UPDATE uc_requests SET status = 'revocata', revoked_at = now(), revoked_reason = ${cast(i.reasonCode, "text")}, next_reminder_at = NULL, updated_at = now()
  WHERE case_id = ${cast(i.caseId, "uuid")} AND revoked_at IS NULL AND status <> 'revocata'
  RETURNING id
), ev AS (${event})
SELECT count(*)::int AS revoked FROM u`);
}

/** Tutti i link del caso revocati. */
export function revokeCaseTokensSql(caseId: string): UcStatement {
  return toStatement(ucSql`UPDATE uc_request_tokens SET revoked_at = now() WHERE case_id = ${cast(caseId, "uuid")} AND revoked_at IS NULL`);
}

/** Voci attive delle richieste del caso → `riassegnata`. */
export function releaseCaseRequestItemsSql(caseId: string): UcStatement {
  return toStatement(ucSql`UPDATE uc_request_items SET state = 'riassegnata' WHERE case_id = ${cast(caseId, "uuid")} AND state IN (${raw(ACTIVE_STATES_SQL)})`);
}

/** Coda del caso annullata (chiusura). */
export function cancelCaseNotificationsSql(caseId: string): UcStatement {
  return toStatement(ucSql`UPDATE uc_notifications SET status = 'annullata' WHERE case_id = ${cast(caseId, "uuid")} AND status IN ('in_coda', 'errore')`);
}

/** Coda del caso ferma (sospensione): resta `in_coda` con un motivo chiaro. */
export function holdCaseNotificationsSql(caseId: string): UcStatement {
  return toStatement(ucSql`UPDATE uc_notifications SET hold_reason = 'caso_sospeso' WHERE case_id = ${cast(caseId, "uuid")} AND status = 'in_coda' AND hold_reason IS NULL`);
}

/** Coda del caso ripresa. */
export function releaseCaseNotificationsSql(caseId: string): UcStatement {
  return toStatement(ucSql`UPDATE uc_notifications SET hold_reason = NULL WHERE case_id = ${cast(caseId, "uuid")} AND status = 'in_coda' AND hold_reason = 'caso_sospeso'`);
}

/** Scope marcatore dei token MCP limitati a un caso (PIANO §5.8). */
export function caseTokenScope(caseId: string): string {
  return `uc:case:${caseId.toLowerCase()}`;
}

/** Token MCP del caso revocati (chiusura, «Revoca tutti i link»). */
export function revokeCaseMcpTokensSql(workspaceId: string, caseId: string): UcStatement {
  return toStatement(ucSql`UPDATE workspace_integration_tokens SET revoked_at = now(), updated_at = now()
WHERE workspace_id = ${cast(workspaceId, "uuid")} AND scopes ? ${cast(caseTokenScope(caseId), "text")} AND revoked_at IS NULL`);
}

/** Scheda di portafoglio collegata: CAS da `from` a `to` (0 o 1 riga, la scheda può essere già avanti). */
export function portfolioStatusSql(i: { workspaceId: string; caseId: string; from: "accepted" | "in_progress"; to: "in_progress" | "implemented" }): UcStatement {
  return toStatement(ucSql`UPDATE use_cases SET status = ${cast(i.to, "text")}::use_case_status, updated_at = now()
WHERE id = (SELECT portfolio_use_case_id FROM uc_cases WHERE id = ${cast(i.caseId, "uuid")} AND workspace_id = ${cast(i.workspaceId, "uuid")})
  AND workspace_id = ${cast(i.workspaceId, "uuid")} AND status::text = ${cast(i.from, "text")}`);
}

// ── Risposte, commenti, verifiche ─────────────────────────────────────

export interface AnswerInsert {
  id: string;
  workspaceId: string;
  caseId: string;
  itemId: string;
  kind: AnswerKind;
  value: Json | null;
  valueNormalized: Json | null;
  validFrom: string | null;
  validTo?: string | null;
  confidence: Confidence | null;
  note: string | null;
  sourceKind: SourceKind;
  sourceRef: string | null;
  sourceBasis: SourceBasis | null;
  responderUserId: string | null;
  responderContactId?: string | null;
  requestId?: string | null;
  supersedesAnswerId?: string | null;
  textHash: string | null;
  fileIds?: readonly string[];
  responseType: string | null;
  actor: EventActor;
}

/**
 * Risposta nuova (tabella a sola aggiunta): versione = massima + 1. Due risposte
 * concorrenti sulla stessa voce si scontrano su `UNIQUE(item_id, version)`.
 * Evento `risposta.inviata` senza valori.
 */
export function answerInsertSql(a: AnswerInsert): UcStatement {
  const event = eventInsertFromSql({
    type: "risposta.inviata",
    workspaceId: a.workspaceId,
    caseId: a.caseId,
    actor: a.actor,
    targetType: "risposta",
    from: "ins",
    targetIdColumn: "ins.id",
    payload: { kind: a.kind, response_type: code(a.responseType), source_kind: a.sourceKind },
    rowPayload: { item_key: "ins.key", version: "ins.version" },
  });
  return toStatement(ucSql`WITH ins AS (
  INSERT INTO uc_answers (id, case_id, item_id, version, kind, value, value_normalized, valid_from, valid_to, confidence, note,
    source_kind, source_ref, source_basis, responder_contact_id, responder_user_id, request_id, supersedes_answer_id, file_ids, text_hash)
  SELECT ${cast(a.id, "uuid")}, i.case_id, i.id, coalesce((SELECT max(x.version) FROM uc_answers x WHERE x.item_id = i.id), 0) + 1,
    ${cast(a.kind, "text")}, ${a.value === null ? raw("NULL::jsonb") : jsonb(a.value)}, ${a.valueNormalized === null ? raw("NULL::jsonb") : jsonb(a.valueNormalized)},
    ${cast(a.validFrom, "date")}, ${cast(a.validTo ?? null, "date")}, ${cast(a.confidence, "text")}, ${cast(a.note, "text")},
    ${cast(a.sourceKind, "text")}, ${cast(a.sourceRef, "text")}, ${cast(a.sourceBasis, "text")}, ${cast(a.responderContactId ?? null, "uuid")},
    ${cast(a.responderUserId, "uuid")}, ${cast(a.requestId ?? null, "uuid")}, ${cast(a.supersedesAnswerId ?? null, "uuid")},
    ${jsonb([...(a.fileIds ?? [])])}, ${cast(a.textHash, "text")}
  FROM uc_items i WHERE i.id = ${cast(a.itemId, "uuid")} AND i.case_id = ${cast(a.caseId, "uuid")} AND i.deleted_at IS NULL
  RETURNING id, version, (SELECT key FROM uc_items WHERE id = ${cast(a.itemId, "uuid")}) AS key
), ev AS (${event})
SELECT ${requireCount(1)} AS ok FROM ins`);
}

export function commentInsertSql(c: {
  id: string;
  workspaceId: string;
  caseId: string;
  itemId: string;
  itemKey: string;
  authorUserId: string;
  body: string;
  visibility: CommentVisibility;
  kind: CommentKind;
  parentCommentId?: string | null;
}): UcStatement[] {
  return [
    toStatement(ucSql`INSERT INTO uc_comments (id, case_id, item_id, author_user_id, parent_comment_id, body, visibility, kind)
VALUES (${cast(c.id, "uuid")}, ${cast(c.caseId, "uuid")}, ${cast(c.itemId, "uuid")}, ${cast(c.authorUserId, "uuid")}, ${cast(c.parentCommentId ?? null, "uuid")},
  ${cast(c.body, "text")}, ${cast(c.visibility, "text")}, ${cast(c.kind, "text")})`),
    toStatement(
      eventInsertSql({
        type: "commento.creato",
        workspaceId: c.workspaceId,
        caseId: c.caseId,
        actor: { type: "utente", userId: c.authorUserId },
        targetType: "commento",
        targetId: c.id,
        payload: { item_key: c.itemKey, kind: c.kind, visibility: c.visibility },
      }),
    ),
  ];
}

export function validationInsertSql(v: {
  workspaceId: string;
  caseId: string;
  itemId: string;
  itemKey: string;
  answerId: string | null;
  checkKey: string;
  kind: ValidationKind;
  outcome: ValidationOutcome;
  message: string;
  byUserId: string | null;
}): UcStatement[] {
  return [
    toStatement(ucSql`INSERT INTO uc_validations (case_id, item_id, answer_id, check_key, kind, outcome, message, by_user_id)
VALUES (${cast(v.caseId, "uuid")}, ${cast(v.itemId, "uuid")}, ${cast(v.answerId, "uuid")}, ${cast(v.checkKey, "text")}, ${cast(v.kind, "text")},
  ${cast(v.outcome, "text")}, ${cast(v.message, "text")}, ${cast(v.byUserId, "uuid")})`),
    toStatement(
      eventInsertSql({
        type: "validazione.registrata",
        workspaceId: v.workspaceId,
        caseId: v.caseId,
        actor: v.byUserId ? { type: "utente", userId: v.byUserId } : { type: "sistema" },
        targetType: "voce",
        targetId: v.itemId,
        payload: { item_key: v.itemKey, check_key: v.checkKey, kind: v.kind, outcome: v.outcome },
      }),
    ),
  ];
}

// ── Firme in attesa tolte (cambio di firmatario, persona rimossa) ─────

/** Chi esce dalle firme in attesa: un utente (rimosso) o un contatto (non più designato). */
export type ApprovalMatch = { userId: string } | { contactId: string };

function approvalsFilter(column: string, match: ApprovalMatch): SqlFragment {
  const [field, value] = "userId" in match ? ["user_id", match.userId] : ["contact_id", match.contactId];
  return ucSql`(SELECT coalesce(jsonb_agg(a ORDER BY n), '[]'::jsonb) FROM jsonb_array_elements(coalesce(${raw(column)}, '[]'::jsonb)) WITH ORDINALITY AS e(a, n)
  WHERE a ->> ${raw(`'${field}'`)} IS DISTINCT FROM ${cast(value.toLowerCase(), "text")})`;
}

function approvalsContain(column: string, match: ApprovalMatch): SqlFragment {
  const [field, value] = "userId" in match ? ["user_id", match.userId] : ["contact_id", match.contactId];
  return ucSql`EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(${raw(column)}, '[]'::jsonb)) a WHERE a ->> ${raw(`'${field}'`)} = ${cast(value.toLowerCase(), "text")})`;
}

/**
 * Toglie le firme **in attesa** di una persona o di un contatto: NA non ancora
 * approvate, deroghe, ripieghi e parti NA non approvati, proposte di gate,
 * blocchi attivi, concessioni della zona personale non attive. Le decisioni già
 * prese restano (e restano negli eventi).
 *
 * `scope`: un caso, oppure tutti i casi di un workspace (rimozione dal workspace).
 */
export function dropPendingApprovalsSql(i: { scope: { caseId: string } | { workspaceId: string }; match: ApprovalMatch }): UcStatement[] {
  const caseFilter = (alias: string) =>
    "caseId" in i.scope
      ? ucSql`${ref(`${alias}.case_id`)} = ${cast(i.scope.caseId, "uuid")}`
      : ucSql`${ref(`${alias}.case_id`)} IN (SELECT id FROM uc_cases WHERE workspace_id = ${cast(i.scope.workspaceId, "uuid")})`;
  const m: ApprovalMatch = "userId" in i.match ? { userId: i.match.userId.toLowerCase() } : { contactId: i.match.contactId.toLowerCase() };
  const out: UcStatement[] = [];
  if ("userId" in m) {
    out.push(
      toStatement(ucSql`UPDATE uc_items i SET
  na_approved_by_user_id = CASE WHEN i.na_approved_by_user_id = ${cast(m.userId, "uuid")} THEN NULL ELSE i.na_approved_by_user_id END,
  na_client_approved_by_user_id = CASE WHEN i.na_client_approved_by_user_id = ${cast(m.userId, "uuid")} THEN NULL ELSE i.na_client_approved_by_user_id END,
  updated_at = now()
WHERE ${caseFilter("i")} AND i.na_approved_at IS NULL
  AND (i.na_approved_by_user_id = ${cast(m.userId, "uuid")} OR i.na_client_approved_by_user_id = ${cast(m.userId, "uuid")})`),
    );
  } else {
    out.push(
      toStatement(ucSql`UPDATE uc_items i SET na_approved_by_contact_id = NULL, updated_at = now()
WHERE ${caseFilter("i")} AND i.na_approved_at IS NULL AND i.na_approved_by_contact_id = ${cast(m.contactId, "uuid")}`),
    );
  }
  for (const [column, approvedAt] of [
    ["waiver", "waiver_approved_at"],
    ["fallback", "fallback_approved_at"],
  ] as const) {
    out.push(
      toStatement(ucSql`UPDATE uc_items i SET ${raw(column)} = jsonb_set(i.${raw(column)}, '{approvazioni}', ${approvalsFilter(`i.${column} -> 'approvazioni'`, m)}), updated_at = now()
WHERE ${caseFilter("i")} AND i.${raw(column)} IS NOT NULL AND i.${raw(approvedAt)} IS NULL AND ${approvalsContain(`i.${column} -> 'approvazioni'`, m)}`),
    );
  }
  out.push(
    toStatement(ucSql`UPDATE uc_items i SET partial_na = jsonb_set(i.partial_na, '{approvazioni}', ${approvalsFilter("i.partial_na -> 'approvazioni'", m)}), updated_at = now()
WHERE ${caseFilter("i")} AND i.partial_na IS NOT NULL AND (i.partial_na ->> 'approved_at') IS NULL AND ${approvalsContain("i.partial_na -> 'approvazioni'", m)}`),
    toStatement(ucSql`UPDATE uc_gate_reviews g SET approvals = ${approvalsFilter("g.approvals", m)}
WHERE ${caseFilter("g")} AND g.decision = 'proposto' AND ${approvalsContain("g.approvals", m)}`),
    toStatement(ucSql`UPDATE uc_blockers b SET approvals = ${approvalsFilter("b.approvals", m)}, updated_at = now()
WHERE ${caseFilter("b")} AND b.status = 'attivo' AND ${approvalsContain("b.approvals", m)}`),
    toStatement(ucSql`UPDATE uc_case_members cm SET personal_zone_grant = jsonb_set(cm.personal_zone_grant, '{approvals}', ${approvalsFilter("cm.personal_zone_grant -> 'approvals'", m)})
WHERE ${caseFilter("cm")} AND cm.personal_zone_grant IS NOT NULL AND cm.personal_zone_access = false
  AND ${approvalsContain("cm.personal_zone_grant -> 'approvals'", m)}`),
  );
  return out;
}

/** Link di approvazione di un contatto revocati (cambio di firmatario o della sua email). */
export function revokeApprovalLinksSql(i: { caseId: string; contactId: string; reasonCode: string }): UcStatement[] {
  return [
    toStatement(ucSql`UPDATE uc_request_tokens t SET revoked_at = now()
FROM uc_requests r
WHERE t.request_id = r.id AND r.case_id = ${cast(i.caseId, "uuid")} AND r.purpose = 'approvazioni' AND r.contact_id = ${cast(i.contactId, "uuid")} AND t.revoked_at IS NULL`),
    toStatement(ucSql`UPDATE uc_requests SET status = 'revocata', revoked_at = now(), revoked_reason = ${cast(i.reasonCode, "text")}, next_reminder_at = NULL, updated_at = now()
WHERE case_id = ${cast(i.caseId, "uuid")} AND purpose = 'approvazioni' AND contact_id = ${cast(i.contactId, "uuid")} AND revoked_at IS NULL`),
  ];
}

// ── Gate e versioni del catalogo ──────────────────────────────────────

export function gateReviewInsertSql(i: {
  id: string;
  workspaceId: string;
  caseId: string;
  gate: GateKey;
  computed: Json;
  catalogRevision: number;
  summaryTextHash: string;
  waivers: readonly string[];
  approvals: readonly Approval[];
  writtenEvidenceFileId: string | null;
  proposedByUserId: string;
  required: number;
  ok: number;
}): UcStatement[] {
  return [
    toStatement(ucSql`INSERT INTO uc_gate_reviews (id, case_id, gate_key, computed, catalog_revision, summary_text_hash, decision, waivers, approvals,
  written_evidence_file_id, proposed_by_user_id, proposed_at)
VALUES (${cast(i.id, "uuid")}, ${cast(i.caseId, "uuid")}, ${cast(i.gate, "text")}, ${jsonb(i.computed)}, ${cast(i.catalogRevision, "int")},
  ${cast(i.summaryTextHash, "text")}, 'proposto', ${jsonb([...i.waivers])}, ${jsonb([...i.approvals])}, ${cast(i.writtenEvidenceFileId, "uuid")},
  ${cast(i.proposedByUserId, "uuid")}, now())`),
    toStatement(
      eventInsertSql({
        type: "gate.proposto",
        workspaceId: i.workspaceId,
        caseId: i.caseId,
        actor: { type: "utente", userId: i.proposedByUserId },
        targetType: "gate",
        targetId: i.id,
        toState: "proposto",
        payload: { gate: i.gate, required: i.required, ok: i.ok, summary_text_hash: i.summaryTextHash, waivers: i.waivers.length, ruolo: "ls_lead" },
      }),
    ),
  ];
}

/** Firme (ed eventualmente la prova scritta) di una proposta ancora aperta, con CAS sulle firme lette. */
export function gateReviewApprovalsSql(i: {
  reviewId: string;
  caseId: string;
  oldApprovals: readonly Approval[];
  approvals: readonly Approval[];
  writtenEvidenceFileId?: string | null;
}): UcStatement {
  const evidence = i.writtenEvidenceFileId !== undefined ? ucSql`, written_evidence_file_id = ${cast(i.writtenEvidenceFileId, "uuid")}` : raw("");
  return toStatement(
    requireRows(
      ucSql`UPDATE uc_gate_reviews SET approvals = ${jsonb([...i.approvals])}${evidence}
WHERE id = ${cast(i.reviewId, "uuid")} AND case_id = ${cast(i.caseId, "uuid")} AND decision = 'proposto' AND approvals = ${jsonb([...i.oldApprovals])}
RETURNING id`,
      1,
      "conflitto",
    ),
  );
}

/** Decisione su una proposta aperta (approvazione o rifiuto), con CAS sulle firme lette. */
export function gateReviewDecideSql(i: {
  reviewId: string;
  caseId: string;
  decision: Exclude<GateDecision, "proposto">;
  oldApprovals: readonly Approval[];
  approvals: readonly Approval[];
  catalogVersion: number | null;
  snapshotHash: string | null;
  notes?: string | null;
  writtenEvidenceFileId?: string | null;
}): UcStatement {
  const evidence = i.writtenEvidenceFileId ? ucSql`, written_evidence_file_id = ${cast(i.writtenEvidenceFileId, "uuid")}` : raw("");
  return toStatement(
    requireRows(
      ucSql`UPDATE uc_gate_reviews SET decision = ${cast(i.decision, "text")}, approvals = ${jsonb([...i.approvals])}, decided_at = now()${evidence},
  catalog_version = ${cast(i.catalogVersion, "int")}, catalog_snapshot_hash = ${cast(i.snapshotHash, "text")}, notes = coalesce(${cast(i.notes ?? null, "text")}, notes)
WHERE id = ${cast(i.reviewId, "uuid")} AND case_id = ${cast(i.caseId, "uuid")} AND decision = 'proposto' AND approvals = ${jsonb([...i.oldApprovals])}
RETURNING id`,
      1,
      "conflitto",
    ),
  );
}

/**
 * Congelamento sul caso: `catalog_version = N` solo se la revisione è ancora
 * quella letta al ricalcolo e la versione precedente è N−1. Con `toStatus` il
 * caso passa anche a pronto_sviluppo (prima approvazione di G1).
 */
export function catalogFreezeCaseSql(i: {
  workspaceId: string;
  caseId: string;
  expectRevision: number;
  version: number;
  fromStatus: CaseStatus;
  toStatus: CaseStatus | null;
}): UcStatement {
  const status = i.toStatus ? ucSql`, status = ${cast(i.toStatus, "text")}, status_changed_at = now()` : raw("");
  return toStatement(
    requireRows(
      ucSql`UPDATE uc_cases SET catalog_version = ${cast(i.version, "int")}${status}, updated_at = now()
WHERE id = ${cast(i.caseId, "uuid")} AND workspace_id = ${cast(i.workspaceId, "uuid")} AND setup_completed_at IS NOT NULL
  AND catalog_revision = ${cast(i.expectRevision, "int")} AND catalog_version = ${cast(i.version - 1, "int")} AND status = ${cast(i.fromStatus, "text")}
RETURNING id`,
      1,
      "conflitto",
    ),
  );
}

export function catalogVersionInsertSql(i: {
  caseId: string;
  version: number;
  reason: "gate" | "correzione";
  gateReviewId: string;
  changeNote: string | null;
  diff: Json;
  snapshot: Json;
  snapshotHash: string;
  approvedBy: readonly Approval[];
  createdByUserId: string | null;
}): UcStatement {
  return toStatement(ucSql`INSERT INTO uc_catalog_versions (case_id, version, reason, gate_review_id, change_note, diff, snapshot, snapshot_hash, approved_by, created_by_user_id)
VALUES (${cast(i.caseId, "uuid")}, ${cast(i.version, "int")}, ${cast(i.reason, "text")}, ${cast(i.gateReviewId, "uuid")}, ${cast(i.changeNote, "text")},
  ${jsonb(i.diff)}, ${jsonb(i.snapshot)}, ${cast(i.snapshotHash, "text")}, ${jsonb([...i.approvedBy])}, ${cast(i.createdByUserId, "uuid")})`);
}

// ── Blocchi ───────────────────────────────────────────────────────────

/**
 * Aggiornamento di un blocco con CAS su stato e firme lette. `set` sono le
 * colonne da scrivere (stato, prove, firme, chi ha sciolto).
 */
export function blockerUpdateSql(i: {
  blockerId: string;
  caseId: string;
  fromStatus: BlockerStatus;
  oldApprovals: readonly unknown[];
  status: BlockerStatus;
  evidence?: Json | null;
  approvals: readonly unknown[];
  resolvedByUserId?: string | null;
  resolved: boolean | null;
}): UcStatement {
  const sets: SqlFragment[] = [ucSql`status = ${cast(i.status, "text")}`, ucSql`approvals = ${jsonb([...i.approvals])}`];
  if (i.evidence !== undefined) sets.push(ucSql`evidence = ${i.evidence === null ? raw("NULL::jsonb") : jsonb(i.evidence)}`);
  if (i.resolved === true) sets.push(ucSql`resolved_by_user_id = ${cast(i.resolvedByUserId ?? null, "uuid")}`, raw("resolved_at = now()"));
  if (i.resolved === false) sets.push(raw("resolved_by_user_id = NULL"), raw("resolved_at = NULL"));
  sets.push(raw("updated_at = now()"));
  return toStatement(
    requireRows(
      ucSql`UPDATE uc_blockers SET ${join(sets, ", ")}
WHERE id = ${cast(i.blockerId, "uuid")} AND case_id = ${cast(i.caseId, "uuid")} AND status = ${cast(i.fromStatus, "text")} AND approvals = ${jsonb([...i.oldApprovals])}
RETURNING id`,
      1,
      "conflitto",
    ),
  );
}

/** Zona personale richiusa per tutti (riattivazione di `a8`). */
export function closePersonalZoneSql(caseId: string): UcStatement {
  return toStatement(ucSql`UPDATE uc_case_members SET personal_zone_access = false, personal_zone_grant = NULL
WHERE case_id = ${cast(caseId, "uuid")} AND (personal_zone_access OR personal_zone_grant IS NOT NULL)`);
}

/** Righe `uc_item_blockers` aggiunte (riclassificazione, blocco manuale). */
export function itemBlockerLinksInsertSql(rows: readonly { itemId: string; blockerId: string; origin: ItemBlockerOrigin }[]): UcStatement {
  return toStatement(ucSql`INSERT INTO uc_item_blockers (item_id, blocker_id, origin)
SELECT r.item_id, r.blocker_id, r.origin FROM jsonb_to_recordset(${jsonb(rows.map((r) => ({ item_id: r.itemId, blocker_id: r.blockerId, origin: r.origin })))}) AS r(item_id uuid, blocker_id uuid, origin text)
ON CONFLICT (item_id, blocker_id) DO NOTHING`);
}

/** Righe di blocchi **sciolti** tolte (il trigger rifiuta quelle di blocchi attivi o permanenti). */
export function itemBlockerLinksDeleteSql(itemId: string, blockerIds: readonly string[]): UcStatement {
  return toStatement(ucSql`DELETE FROM uc_item_blockers ib USING uc_blockers b
WHERE ib.blocker_id = b.id AND ib.item_id = ${cast(itemId, "uuid")} AND ib.blocker_id = ANY(${cast([...blockerIds], "uuid[]")}) AND b.status = 'sciolto'`);
}

// ── Piano delle transizioni ───────────────────────────────────────────

/** Una transizione chiesta da un comando. */
export interface TransitionRequest {
  itemId: string;
  to: ItemStatus;
  trigger: ItemTrigger;
  reason?: string | null;
  answer?: IncomingAnswer | null;
  /** Fatti che il batch stesso crea prima della transizione (es. la richiesta di conferma). */
  overrides?: Partial<ItemSnapshot>;
  blockerKeys?: readonly string[] | null;
  request?: { reminderCount: number; expiresAt: Date | null } | null;
  dueAt?: Date | null;
  actorRequestItem?: ActorRequestItem | null;
  /** Colonne scritte insieme alla transizione (es. la nuova risposta corrente). */
  extraSet?: ItemExtraSet;
  /** Altri campi della patch (es. la firma NA che completa le due firme). */
  extraPatch?: Partial<ItemPatch>;
  /** Condizioni SQL in più sulla riga. */
  guards?: readonly SqlFragment[];
  /**
   * Con `guards`: richieste con la stessa chiave hanno le stesse guardie e si
   * possono raggruppare in un solo UPDATE (es. sblocco di molte voci).
   */
  guardGroup?: string;
  /** Proposta NA letta, controllata nel CAS. */
  checkNaProposal?: boolean;
}

export interface PlannedTransition {
  request: TransitionRequest;
  item: ItemSnapshot;
  from: ItemStatus;
  plan: ItemTransitionPlan;
}

/**
 * Controlla tutte le transizioni con `checkItemTransition`. La prima che non
 * passa ferma tutto: il messaggio porta la chiave della voce.
 */
export function planItemTransitions(i: {
  items: ReadonlyMap<string, ItemSnapshot>;
  requests: readonly TransitionRequest[];
  actor: Actor;
  user?: UserContext | null;
  now: Date;
  case: { status: CaseStatus; statusBeforeSuspension: CaseStatus | null };
  designatedOwnerContactId?: string | null;
}): Result<PlannedTransition[]> {
  const seen = new Set<string>();
  const out: PlannedTransition[] = [];
  for (const request of i.requests) {
    if (seen.has(request.itemId)) return fail("voce_ripetuta", "La stessa voce compare due volte nella richiesta.");
    seen.add(request.itemId);
    const base = i.items.get(request.itemId);
    if (!base) return fail("voce_non_trovata", "Voce non trovata in questo caso.");
    const item: ItemSnapshot = request.overrides ? { ...base, ...request.overrides } : base;
    const r = checkItemTransition({
      item,
      to: request.to,
      trigger: request.trigger,
      actor: i.actor,
      user: i.user ?? null,
      now: i.now,
      reason: request.reason ?? null,
      case: { status: i.case.status, statusBeforeSuspension: i.case.statusBeforeSuspension },
      answer: request.answer ?? null,
      blockerKeys: request.blockerKeys ?? null,
      request: request.request ?? null,
      dueAt: request.dueAt ?? null,
      actorRequestItem: request.actorRequestItem ?? null,
      ...(i.designatedOwnerContactId !== undefined ? { designatedOwnerContactId: i.designatedOwnerContactId } : {}),
    });
    if (!r.ok) return i.requests.length > 1 ? fail(r.code, `${base.key}: ${r.message}`) : r;
    out.push({ request, item, from: base.status, plan: r.value });
  }
  return ok(out);
}

function stableKey(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (v instanceof Date) return v.toISOString();
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    return v;
  });
}

/**
 * Istruzioni delle transizioni pianificate. Le transizioni con la stessa
 * partenza, la stessa patch e lo stesso effetto sulle richieste diventano un solo
 * UPDATE (CAS su tutte le voci del gruppo); quelle con guardie proprie restano
 * singole. Per ogni gruppo: l'evento `voce.stato_cambiato` (o `voce.assegnata`)
 * e lo stato delle righe `uc_request_items`.
 */
export function transitionStatements(i: { workspaceId: string; caseId: string; actor: Actor; planned: readonly PlannedTransition[] }): UcStatement[] {
  const eventActor = eventActorFrom(i.actor);
  const groups = new Map<string, PlannedTransition[]>();
  let solo = 0;
  for (const p of i.planned) {
    const patch = { ...p.plan.patch, ...p.request.extraPatch };
    const shape = stableKey({ from: p.from, patch, extra: p.request.extraSet ?? {}, ri: p.plan.requestItemState, ev: p.plan.eventType, trigger: p.request.trigger, nap: !!p.request.checkNaProposal });
    const key = p.request.guards?.length ? (p.request.guardGroup ? `guard:${p.request.guardGroup}:${shape}` : `solo:${solo++}`) : shape;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const out: UcStatement[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    const patch = { ...first.plan.patch, ...first.request.extraPatch };
    out.push(
      itemUpdateSql({
        workspaceId: i.workspaceId,
        caseId: i.caseId,
        targets: group.map((p) => ({
          id: p.item.id,
          currentAnswerId: p.item.currentAnswer?.id ?? null,
          ...(p.request.checkNaProposal ? { naProposedAt: p.item.na.proposedAt } : {}),
        })),
        from: first.from,
        set: itemSetSql(patch, first.request.extraSet),
        guards: first.request.guards,
        events: [{ type: first.plan.eventType, actor: eventActor, states: first.plan.eventType === "voce.stato_cambiato", payload: { trigger: first.request.trigger } }],
      }),
    );
    const riState = first.plan.requestItemState;
    if (riState) {
      out.push(
        requestItemsStateSql({
          caseId: i.caseId,
          itemIds: group.map((p) => p.item.id),
          state: riState,
          requestId: i.actor.type === "referente" ? i.actor.requestId : null,
        }),
      );
    }
  }
  return out;
}

/** Effetti di tutte le transizioni, senza doppioni. */
export function plannedSideEffects(planned: readonly PlannedTransition[]): ItemSideEffect[] {
  return [...new Set(planned.flatMap((p) => p.plan.sideEffects))];
}
