/**
 * Letture del catalogo per la prontezza, la testata e la fotografia
 * (PIANO §3.6, §3.7, §5.1, §5.10).
 *
 * - `readinessReadStatements`: la riga del caso **per prima** (con
 *   `catalog_revision`), poi le colonne di stato delle voci, i collegamenti
 *   `precisa`, i dataset e i blocchi. Leggere la revisione prima delle voci
 *   rende sicuro il controllo `catalog_revision = R` delle operazioni sul gate:
 *   ogni modifica successiva alla lettura alza la revisione e fa fallire il CAS.
 * - `computeCaseReadiness`: prontezza dal vivo con `computeReadiness` di
 *   `semaforo.ts`, la stessa funzione della cache `uc_cases.readiness`.
 * - `snapshotReadStatements`: tutto quello che serve a `buildCatalogSnapshot`
 *   (voci con i testi, risposta validata e corrente, collegamenti). I valori
 *   delle classi personali e sanitarie non escono mai dal database.
 *
 * Modulo puro: solo costruttori `{ text, params }` e funzioni di lettura delle righe.
 */
import { parseGatePolicy, type BlockerMeta, type CoverageLink, type DatasetMeta, type GateComputation, type GateDefaultField, type GateItem, type GatePolicy, type LiteralCoverage } from "../gates.ts";
import { computeReadiness, type Readiness } from "../semaforo.ts";
import type { SnapshotAnswerInput, SnapshotItemInput, SnapshotLinkInput } from "../snapshot.ts";
import type { Fallback, Json, Waiver } from "../types.ts";
import {
  ANSWER_KINDS,
  ANSWER_SOURCE_KINDS,
  BLOCKER_STATUSES,
  CASE_STATUSES,
  CONFIDENCE,
  DATASET_STATUSES,
  FILE_PERSONAL_DATA,
  HEALTH_PRIVACY_CLASS,
  ITEM_KINDS,
  ITEM_SECTIONS,
  ITEM_STATUSES,
  LEVERS,
  LINK_RELATIONS,
  PERIMETERS,
  PERSONAL_PRIVACY_CLASSES,
  PHASES,
  PRIORITIES,
  PRIVACY_CLASSES,
  RESPONSE_TYPES,
  SOURCE_BASIS,
  VALUE_VISIBILITY,
  isVocab,
  type BlockerStatus,
  type CaseStatus,
  type Lever,
  type Phase,
} from "../vocab.ts";
import { cast, jsonb, raw, toStatement, ucSql, type UcStatement } from "./statement.ts";

// ── Lettura delle righe ───────────────────────────────────────────────

/** Riga restituita dall'esecutore. */
export type Row = Record<string, unknown>;

export function rowString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return typeof v === "string" ? v : String(v);
}

export function rowDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string" && v.trim()) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Data `YYYY-MM-DD` (le colonne `date` si leggono con `::text`). */
export function rowIsoDate(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
}

export function rowNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export function rowBool(v: unknown): boolean {
  return v === true || v === "t" || v === "true";
}

/** Valore jsonb: già letto dal driver oppure testo JSON. */
export function rowJson<T = Json>(v: unknown): T | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  }
  return v as T;
}

/** Oggetto jsonb, `{}` se assente o non oggetto. */
export function rowObject(v: unknown): Record<string, Json> {
  const o = rowJson(v);
  return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, Json>) : {};
}

/** Elenco di stringhe da jsonb, da array di Postgres (`{a,b}`) o da un array già letto. */
export function rowStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x) => x !== null && x !== undefined).map((x) => String(x));
  if (typeof v === "string") {
    const t = v.trim();
    if (t.startsWith("[")) return rowStringArray(rowJson(t));
    if (t.startsWith("{") && t.endsWith("}")) {
      const inner = t.slice(1, -1);
      return inner ? inner.split(",").map((s) => s.replace(/^"|"$/g, "")) : [];
    }
  }
  return [];
}

export function rowVocab<const T extends readonly string[]>(vocab: T, v: unknown): T[number] | null {
  return isVocab(vocab, v) ? v : null;
}

function vocabList<const T extends readonly string[]>(vocab: T, v: unknown): T[number][] {
  return rowStringArray(v).filter((x): x is T[number] => isVocab(vocab, x));
}

const PERSONAL_OR_HEALTH_SQL = [...PERSONAL_PRIVACY_CLASSES, HEALTH_PRIVACY_CLASS].map((c) => `'${c}'`).join(", ");

// ── Caso ──────────────────────────────────────────────────────────────

export interface CaseCore {
  id: string;
  workspaceId: string;
  organizationId: string | null;
  code: string;
  title: string;
  status: CaseStatus;
  statusBeforeSuspension: CaseStatus | null;
  statusChangedAt: Date | null;
  catalogRevision: number;
  catalogVersion: number;
  shareEpoch: number;
  policy: GatePolicy;
  settings: Record<string, Json>;
  contractRefs: string[];
  /** Contatti designati con prova (`signers_designation`), per le firme dal link. */
  designated: { owner: string | null; privacy: string | null };
  signersDesignation: Record<string, Json>;
  ownerContactId: string | null;
  privacyApproverContactId: string | null;
  portfolioUseCaseId: string | null;
  aiEnvironmentApproved: boolean;
  templateId: string;
  templateVersion: string;
  lsLeadUserId: string | null;
}

/** Riga del caso, solo se completo (`setup_completed_at`) e del workspace indicato. */
export function caseCoreSql(workspaceId: string, caseId: string): UcStatement {
  return toStatement(ucSql`SELECT c.id, c.workspace_id, c.organization_id, c.code, c.title, c.status, c.status_before_suspension, c.status_changed_at,
  c.catalog_revision, c.catalog_version, c.share_epoch, c.settings, c.contract_refs, c.signers_designation,
  c.client_owner_contact_id, c.client_privacy_approver_contact_id, c.portfolio_use_case_id, c.ai_environment_approved,
  c.template_id, c.template_version, c.ls_lead_user_id
FROM uc_cases c
WHERE c.id = ${cast(caseId, "uuid")} AND c.workspace_id = ${cast(workspaceId, "uuid")} AND c.setup_completed_at IS NOT NULL`);
}

function designatedContact(designation: Record<string, Json>, key: "owner" | "privacy"): string | null {
  const d = designation[key];
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  const id = (d as Record<string, Json>).contact_id;
  return typeof id === "string" && id ? id : null;
}

export function parseCaseCore(row: Row | undefined): CaseCore | null {
  if (!row) return null;
  const status = rowVocab(CASE_STATUSES, row.status);
  if (!status) return null;
  const settings = rowObject(row.settings);
  const designation = rowObject(row.signers_designation);
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    organizationId: rowString(row.organization_id),
    code: String(row.code),
    title: String(row.title),
    status,
    statusBeforeSuspension: rowVocab(CASE_STATUSES, row.status_before_suspension),
    statusChangedAt: rowDate(row.status_changed_at),
    catalogRevision: rowNumber(row.catalog_revision) ?? 0,
    catalogVersion: rowNumber(row.catalog_version) ?? 0,
    shareEpoch: rowNumber(row.share_epoch) ?? 0,
    policy: parseGatePolicy(settings.gate_policy),
    settings,
    contractRefs: rowStringArray(rowJson(row.contract_refs)),
    designated: { owner: designatedContact(designation, "owner"), privacy: designatedContact(designation, "privacy") },
    signersDesignation: designation,
    ownerContactId: rowString(row.client_owner_contact_id),
    privacyApproverContactId: rowString(row.client_privacy_approver_contact_id),
    portfolioUseCaseId: rowString(row.portfolio_use_case_id),
    aiEnvironmentApproved: rowBool(row.ai_environment_approved),
    templateId: String(row.template_id),
    templateVersion: String(row.template_version),
    lsLeadUserId: rowString(row.ls_lead_user_id),
  };
}

// ── Voci per i gate ───────────────────────────────────────────────────

/**
 * Colonne di stato di tutte le voci non cancellate del caso (mai valori né
 * testi). La risposta di riferimento è quella validata per le voci validate,
 * altrimenti la corrente; il ruolo di chi ha risposto è `acting_role_key` della
 * sua richiesta; il ruolo di chi ha confermato è quello della richiesta da cui il
 * contatto ha confermato.
 */
export function gateItemsSql(caseId: string): UcStatement {
  const c = cast(caseId, "uuid");
  return toStatement(ucSql`WITH ab AS (
  SELECT ib.item_id, jsonb_agg(b.key ORDER BY b.key) AS keys
  FROM uc_item_blockers ib JOIN uc_blockers b ON b.id = ib.blocker_id
  WHERE b.case_id = ${c} AND b.status IN ('attivo', 'permanente')
  GROUP BY ib.item_id
), oc AS (
  SELECT DISTINCT item_id FROM uc_comments WHERE case_id = ${c} AND kind = 'chiarimento_richiesto' AND resolved_at IS NULL
)
SELECT i.id, i.key, i.kind, i.status, i.status_reason, i.priority, i.perimeter, i.serves_for, i.in_gate_scope,
  i.spec -> 'defaults_applied' AS defaults_applied, coalesce(i.spec ->> 'health_rule_question', 'false') = 'true' AS health_rule_question,
  i.privacy_class, i.response_type, i.request_module_key, i.owner_role_key, i.assignee_contact_id, i.stale_at, i.na_approved_at,
  i.waiver, i.waiver_approved_at, i.fallback, i.fallback_approved_at,
  coalesce(ab.keys, '[]'::jsonb) AS active_blocker_keys, oc.item_id IS NOT NULL AS open_clarification,
  ref.text_hash AS answer_text_hash, ref.version AS answer_version, r.acting_role_key AS responder_role_key,
  CASE WHEN i.confirmed_by_contact_id IS NULL THEN NULL ELSE (
    SELECT r2.acting_role_key FROM uc_answers ca JOIN uc_requests r2 ON r2.id = ca.request_id
    WHERE ca.item_id = i.id AND ca.responder_contact_id = i.confirmed_by_contact_id
    ORDER BY ca.version DESC LIMIT 1) END AS confirmed_by_role_key
FROM uc_items i
LEFT JOIN ab ON ab.item_id = i.id
LEFT JOIN oc ON oc.item_id = i.id
LEFT JOIN uc_answers cur ON cur.id = i.current_answer_id
LEFT JOIN uc_requests r ON r.id = cur.request_id
LEFT JOIN uc_answers ref ON ref.id = coalesce(CASE WHEN i.status = 'validata' THEN i.validated_answer_id END, i.current_answer_id)
WHERE i.case_id = ${c} AND i.deleted_at IS NULL
ORDER BY i.sort_order, i.key`);
}

const GATE_DEFAULT_FIELDS: readonly GateDefaultField[] = ["serves_for", "perimeter"];

/** Riga di `gateItemsSql` → `GateItem` (con il referente assegnato per i conteggi). */
export function rowToGateItem(row: Row): GateItem & { assigneeContactId: string | null } {
  const waiver = rowJson<Waiver>(row.waiver);
  const fallback = rowJson<Fallback>(row.fallback);
  return {
    id: String(row.id),
    key: String(row.key),
    kind: rowVocab(ITEM_KINDS, row.kind) ?? "domanda",
    status: rowVocab(ITEM_STATUSES, row.status) ?? "da_chiedere",
    statusReason: rowString(row.status_reason),
    priority: rowVocab(PRIORITIES, row.priority),
    perimeter: rowVocab(PERIMETERS, row.perimeter),
    servesFor: vocabList(PHASES, rowJson(row.serves_for)),
    inGateScope: rowBool(row.in_gate_scope),
    defaultsApplied: rowStringArray(rowJson(row.defaults_applied)).filter((f): f is GateDefaultField => (GATE_DEFAULT_FIELDS as readonly string[]).includes(f)),
    privacyClass: rowVocab(PRIVACY_CLASSES, row.privacy_class) ?? "riservato_azienda",
    responseType: rowVocab(RESPONSE_TYPES, row.response_type),
    requestModuleKey: rowString(row.request_module_key),
    ownerRoleKey: rowString(row.owner_role_key),
    responderRoleKey: rowString(row.responder_role_key),
    confirmedByRoleKey: rowString(row.confirmed_by_role_key),
    answerTextHash: rowString(row.answer_text_hash),
    answerVersion: rowNumber(row.answer_version),
    staleAt: rowDate(row.stale_at),
    naApprovedAt: rowDate(row.na_approved_at),
    waiver: waiver && typeof waiver === "object" ? waiver : null,
    waiverApprovedAt: rowDate(row.waiver_approved_at),
    fallback: fallback && typeof fallback === "object" ? fallback : null,
    fallbackApprovedAt: rowDate(row.fallback_approved_at),
    activeBlockerKeys: rowStringArray(rowJson(row.active_blocker_keys)),
    openClarification: rowBool(row.open_clarification),
    healthRuleQuestion: rowBool(row.health_rule_question),
    assigneeContactId: rowString(row.assignee_contact_id),
  };
}

/** Collegamenti `precisa` (domanda → voce del modello) per la copertura del modello dati. */
export function coverageLinksSql(caseId: string): UcStatement {
  return toStatement(ucSql`SELECT from_item_id, to_item_id, relation FROM uc_item_links WHERE case_id = ${cast(caseId, "uuid")} AND relation = 'precisa'`);
}

export function rowToCoverageLink(row: Row): CoverageLink {
  return { fromItemId: String(row.from_item_id), toItemId: String(row.to_item_id), relation: rowVocab(LINK_RELATIONS, row.relation) ?? "precisa" };
}

/** Dataset del caso con l'esito dei controlli di qualità (mai righe di dati). */
export function datasetsMetaSql(caseId: string): UcStatement {
  return toStatement(ucSql`SELECT d.id, d.item_id, d.status, d.personal_data, d.period_from::text AS period_from, d.period_to::text AS period_to,
  d.deleted_at IS NOT NULL AS deleted,
  EXISTS (SELECT 1 FROM uc_validations v WHERE v.dataset_id = d.id AND v.outcome = 'errore') AS dq_error
FROM uc_datasets d WHERE d.case_id = ${cast(caseId, "uuid")}`);
}

export function rowToDatasetMeta(row: Row): DatasetMeta {
  return {
    itemId: rowString(row.item_id),
    status: rowVocab(DATASET_STATUSES, row.status) ?? "ricevuto",
    dqError: rowBool(row.dq_error),
    personalData: rowVocab(FILE_PERSONAL_DATA, row.personal_data),
    periodFrom: rowIsoDate(row.period_from),
    periodTo: rowIsoDate(row.period_to),
    deleted: rowBool(row.deleted),
  };
}

/** Blocchi del caso, nell'ordine di creazione. */
export function caseBlockersSql(caseId: string): UcStatement {
  return toStatement(ucSql`SELECT b.id, b.key, b.label, b.status, b.scope, b.fallback_allowed, b.evidence, b.approvals, b.resolved_at, b.updated_at,
  (SELECT count(*) FROM uc_item_blockers ib WHERE ib.blocker_id = b.id) AS items
FROM uc_blockers b WHERE b.case_id = ${cast(caseId, "uuid")} ORDER BY b.created_at, b.key`);
}

export interface CaseBlockerRow {
  id: string;
  key: string;
  label: string;
  status: BlockerStatus;
  scope: Record<string, Json>;
  fallbackAllowed: string | null;
  evidence: Record<string, Json> | null;
  approvals: Json[];
  resolvedAt: Date | null;
  items: number;
}

export function rowToCaseBlocker(row: Row): CaseBlockerRow {
  const evidence = rowJson(row.evidence);
  const approvals = rowJson(row.approvals);
  return {
    id: String(row.id),
    key: String(row.key),
    label: String(row.label ?? row.key),
    status: rowVocab(BLOCKER_STATUSES, row.status) ?? "attivo",
    scope: rowObject(row.scope),
    fallbackAllowed: rowString(row.fallback_allowed),
    evidence: evidence && typeof evidence === "object" && !Array.isArray(evidence) ? (evidence as Record<string, Json>) : null,
    approvals: Array.isArray(approvals) ? approvals : [],
    resolvedAt: rowDate(row.resolved_at),
    items: rowNumber(row.items) ?? 0,
  };
}

// ── Prontezza ─────────────────────────────────────────────────────────

/** Letture della prontezza, nell'ordine: caso (revisione), voci, collegamenti, dataset, blocchi. */
export function readinessReadStatements(workspaceId: string, caseId: string): UcStatement[] {
  return [caseCoreSql(workspaceId, caseId), gateItemsSql(caseId), coverageLinksSql(caseId), datasetsMetaSql(caseId), caseBlockersSql(caseId)];
}

export interface ReadinessInput {
  core: CaseCore;
  items: (GateItem & { assigneeContactId: string | null })[];
  links: CoverageLink[];
  datasets: DatasetMeta[];
  blockers: CaseBlockerRow[];
}

/** Righe di `readinessReadStatements` → ingressi del calcolo; null se il caso non c'è. */
export function parseReadinessRows(rows: readonly Row[][]): ReadinessInput | null {
  const core = parseCaseCore(rows[0]?.[0]);
  if (!core) return null;
  return {
    core,
    items: (rows[1] ?? []).map(rowToGateItem),
    links: (rows[2] ?? []).map(rowToCoverageLink),
    datasets: (rows[3] ?? []).map(rowToDatasetMeta),
    blockers: (rows[4] ?? []).map(rowToCaseBlocker),
  };
}

export interface CaseReadiness {
  readiness: Readiness;
  g1: GateComputation;
  coverage: LiteralCoverage;
}

/** Prontezza dal vivo: la stessa funzione della cache, sulle righe appena lette. */
export function computeCaseReadiness(input: ReadinessInput, now: Date): CaseReadiness {
  const blockers: BlockerMeta[] = input.blockers.map((b) => ({ key: b.key, status: b.status }));
  return computeReadiness({
    items: input.items,
    links: input.links,
    datasets: input.datasets,
    blockers,
    now,
    catalogRevision: input.core.catalogRevision,
    caseCode: input.core.code,
    caseStatus: input.core.status,
    statusBeforeSuspension: input.core.statusBeforeSuspension,
    policy: input.core.policy,
  });
}

/**
 * Scrive la cache solo se la revisione è ancora quella letta: una cache più
 * vecchia non sovrascrive mai una più nuova (nessun evento, è solo una copia).
 */
export function readinessCacheSql(caseId: string, readiness: Readiness): UcStatement {
  return toStatement(ucSql`UPDATE uc_cases SET readiness = ${jsonb(readiness)}
WHERE id = ${cast(caseId, "uuid")} AND catalog_revision = ${cast(readiness.catalog_revision, "int")}
RETURNING id`);
}

// ── Fotografia del catalogo ───────────────────────────────────────────

/** Caso e template per la fotografia. */
export function snapshotCaseSql(workspaceId: string, caseId: string): UcStatement {
  return toStatement(ucSql`SELECT c.id, c.workspace_id, c.code, c.title, c.perimeter_label, c.contract_refs, c.data_controller_label,
  t.key AS template_key, c.template_version, t.definition_hash AS template_hash
FROM uc_cases c JOIN uc_templates t ON t.id = c.template_id
WHERE c.id = ${cast(caseId, "uuid")} AND c.workspace_id = ${cast(workspaceId, "uuid")} AND c.setup_completed_at IS NOT NULL`);
}

function answerColumns(alias: "va" | "ca"): string {
  const hidden = `i.privacy_class IN (${PERSONAL_OR_HEALTH_SQL}) OR ${alias}.erased_at IS NOT NULL`;
  return [
    `${alias}.id AS ${alias}_id`,
    `${alias}.version AS ${alias}_version`,
    `${alias}.kind AS ${alias}_kind`,
    `CASE WHEN ${hidden} THEN NULL ELSE ${alias}.value END AS ${alias}_value`,
    `CASE WHEN ${hidden} THEN NULL ELSE ${alias}.value_normalized END AS ${alias}_value_normalized`,
    `${alias}.source_kind AS ${alias}_source_kind`,
    `${alias}.source_ref AS ${alias}_source_ref`,
    `${alias}.source_basis AS ${alias}_source_basis`,
    `${alias}.confidence AS ${alias}_confidence`,
    `${alias}.valid_from::text AS ${alias}_valid_from`,
    `${alias}.valid_to::text AS ${alias}_valid_to`,
    `${alias}.text_hash AS ${alias}_text_hash`,
    `${alias}.created_at AS ${alias}_created_at`,
    `${alias}.erased_at AS ${alias}_erased_at`,
  ].join(", ");
}

/**
 * Voci con i testi e le due risposte (validata e corrente). I valori delle
 * classi personali e sanitarie e quelli cancellati per privacy restano nel
 * database: qui arrivano sempre `NULL`.
 */
export function snapshotItemsSql(caseId: string): UcStatement {
  return toStatement(ucSql`SELECT i.key, i.kind, i.section, p.key AS parent_key, i.title, i.explanation, i.why, i.example, i.help, i.spec, i.priority,
  i.serves_for, i.privacy_class, i.value_visibility, i.availability, i.perimeter, i.levers, i.response_type, i.response_config,
  i.request_module_key, i.owner_role_key, i.in_gate_scope, i.status, i.status_reason, i.stale_at, i.validated_at, i.na_reason,
  i.na_approved_at, i.waiver, i.waiver_approved_at, i.fallback, i.fallback_approved_at, i.source_refs,
  ${raw(answerColumns("va"))},
  ${raw(answerColumns("ca"))}
FROM uc_items i
LEFT JOIN uc_items p ON p.id = i.parent_item_id
LEFT JOIN uc_answers va ON va.id = i.validated_answer_id
LEFT JOIN uc_answers ca ON ca.id = i.current_answer_id
WHERE i.case_id = ${cast(caseId, "uuid")} AND i.deleted_at IS NULL
ORDER BY i.key`);
}

export function snapshotLinksSql(caseId: string): UcStatement {
  return toStatement(ucSql`SELECT f.key AS from_key, t.key AS to_key, l.relation, l.cardinality, l.note
FROM uc_item_links l
JOIN uc_items f ON f.id = l.from_item_id
JOIN uc_items t ON t.id = l.to_item_id
WHERE l.case_id = ${cast(caseId, "uuid")} AND f.deleted_at IS NULL AND t.deleted_at IS NULL`);
}

/** Ultima versione congelata, per la differenza con la nuova. */
export function latestCatalogVersionSql(caseId: string): UcStatement {
  return toStatement(ucSql`SELECT version, snapshot, snapshot_hash FROM uc_catalog_versions WHERE case_id = ${cast(caseId, "uuid")} ORDER BY version DESC LIMIT 1`);
}

export function snapshotReadStatements(workspaceId: string, caseId: string): UcStatement[] {
  return [snapshotCaseSql(workspaceId, caseId), snapshotItemsSql(caseId), snapshotLinksSql(caseId), latestCatalogVersionSql(caseId)];
}

function answerFromRow(row: Row, alias: "va" | "ca"): SnapshotAnswerInput | null {
  if (!row[`${alias}_id`]) return null;
  const kind = rowVocab(ANSWER_KINDS, row[`${alias}_kind`]);
  const sourceKind = rowVocab(ANSWER_SOURCE_KINDS, row[`${alias}_source_kind`]);
  const version = rowNumber(row[`${alias}_version`]);
  if (!kind || !sourceKind || version === null) return null;
  return {
    version,
    kind,
    value: rowJson(row[`${alias}_value`]),
    valueNormalized: rowJson(row[`${alias}_value_normalized`]),
    sourceKind,
    sourceRef: rowString(row[`${alias}_source_ref`]),
    sourceBasis: rowVocab(SOURCE_BASIS, row[`${alias}_source_basis`]),
    confidence: rowVocab(CONFIDENCE, row[`${alias}_confidence`]),
    validFrom: rowIsoDate(row[`${alias}_valid_from`]),
    validTo: rowIsoDate(row[`${alias}_valid_to`]),
    textHash: rowString(row[`${alias}_text_hash`]),
    createdAt: rowDate(row[`${alias}_created_at`]) ?? new Date(0),
    erasedAt: rowDate(row[`${alias}_erased_at`]),
  };
}

export function rowToSnapshotItem(row: Row): SnapshotItemInput {
  const waiver = rowJson<Waiver>(row.waiver);
  const fallback = rowJson<Fallback>(row.fallback);
  const sourceRefs = rowJson(row.source_refs);
  return {
    key: String(row.key),
    kind: rowVocab(ITEM_KINDS, row.kind) ?? "domanda",
    section: rowVocab(ITEM_SECTIONS, row.section) ?? "modello_dati",
    parentKey: rowString(row.parent_key),
    title: String(row.title ?? ""),
    explanation: rowString(row.explanation),
    why: rowString(row.why),
    example: rowString(row.example),
    help: rowString(row.help),
    spec: rowObject(row.spec),
    priority: rowVocab(PRIORITIES, row.priority),
    servesFor: vocabList(PHASES, rowJson(row.serves_for)) as Phase[],
    privacyClass: rowVocab(PRIVACY_CLASSES, row.privacy_class) ?? "riservato_azienda",
    valueVisibility: rowVocab(VALUE_VISIBILITY, row.value_visibility) ?? "owner_e_ls",
    availability: rowStringArray(rowJson(row.availability)),
    perimeter: rowVocab(PERIMETERS, row.perimeter),
    levers: vocabList(LEVERS, rowJson(row.levers)) as Lever[],
    responseType: rowVocab(RESPONSE_TYPES, row.response_type),
    responseConfig: rowObject(row.response_config),
    requestModuleKey: rowString(row.request_module_key),
    ownerRoleKey: rowString(row.owner_role_key),
    inGateScope: rowBool(row.in_gate_scope),
    status: rowVocab(ITEM_STATUSES, row.status) ?? "da_chiedere",
    statusReason: rowString(row.status_reason),
    staleAt: rowDate(row.stale_at),
    validatedAt: rowDate(row.validated_at),
    naReason: rowString(row.na_reason),
    naApprovedAt: rowDate(row.na_approved_at),
    waiver: waiver && typeof waiver === "object" ? waiver : null,
    waiverApprovedAt: rowDate(row.waiver_approved_at),
    fallback: fallback && typeof fallback === "object" ? fallback : null,
    fallbackApprovedAt: rowDate(row.fallback_approved_at),
    sourceRefs: Array.isArray(sourceRefs) ? (sourceRefs as Json[]) : [],
    validatedAnswer: answerFromRow(row, "va"),
    currentAnswer: answerFromRow(row, "ca"),
  };
}

export function rowToSnapshotLink(row: Row): SnapshotLinkInput {
  return {
    fromKey: String(row.from_key),
    toKey: String(row.to_key),
    relation: rowVocab(LINK_RELATIONS, row.relation) ?? "usa",
    cardinality: rowString(row.cardinality),
    note: rowString(row.note),
  };
}
