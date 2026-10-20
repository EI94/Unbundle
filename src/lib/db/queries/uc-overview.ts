/**
 * Letture della Panoramica e di «Via allo sviluppo» (DESIGN §3.4, §3.5), un
 * giro ciascuna (un batch: una richiesta, una transazione).
 *
 * - `loadOverview`: argomenti e ruoli dello schema, le sole domande
 *   indispensabili del via con le colonne che dicono se sono a posto (mai le
 *   2.812 voci del caso, mai valori né testi delle risposte), i blocchi attivi
 *   con le domande collegate, le tappe, «In breve» e le «Fasi» della
 *   descrizione. Con `blockerId` anche il pannello di quel blocco (le prime
 *   domande collegate per titolo), con `withFiles` i file utilizzabili come
 *   prova.
 * - `loadVia`: la prontezza dal vivo (condizioni, copertura del modello dati),
 *   le proposte del via con le firme per ruolo e le versioni del catalogo.
 *   Prende il posto di `getCaseOverview`, `listGateReviews`,
 *   `listCatalogVersions` e `loadProgressExtras` su questa pagina (DESIGN §8.1,
 *   regola 3: i caricatori nuovi stanno nel file nuovo del pacchetto).
 *
 * Le domande indispensabili sono quelle di `isRequired` (`gates.ts`): nel
 * via, `must`, nel contratto, utili al modello. Se sono a posto lo dice
 * `isItemOk`, la stessa funzione del calcolo del via: la somma degli
 * argomenti è il numero della testata.
 *
 * Solo letture filtrate per caso e per workspace; l'accesso al caso lo
 * controlla la pagina prima di chiamarle. Modulo senza import dell'app, come
 * `uc-cases.ts`: l'esecutore arriva da fuori.
 */
import { GATE_PHASE, isItemOk, type GateComputation, type LiteralCoverage } from "../../uc/gates.ts";
import {
  computeCaseReadiness,
  parseReadinessRows,
  readinessReadStatements,
  rowBool,
  rowDate,
  rowJson,
  rowNumber,
  rowObject,
  rowString,
  rowToGateItem,
  rowVocab,
  type CaseCore,
  type Row,
} from "../../uc/sql/readiness.ts";
import { cast, jsonb, toStatement, ucSql, type SqlFragment, type UcStatement } from "../../uc/sql/statement.ts";
import type { Approval, Json } from "../../uc/types.ts";
import { descriptionBlockDef, readBlock, readableContent, type DescriptionRecord } from "../../uc/views/description.ts";
import { blockerView } from "../../uc/views/privacy.ts";
import type { MilestoneLike, ModuleRef, OverviewBlockerInput, RequiredItemFact } from "../../uc/views/progress.ts";
import type { Audience } from "../../uc/views/status-groups.ts";
import { caseViewContextReader } from "./uc-views.ts";
import { BLOCKER_STATUSES, ITEM_STATUSES, type BlockerStatus, type CaseStatus, type ItemStatus } from "../../uc/vocab.ts";
import type { UcExecutor } from "../uc-executor.ts";
import { UUID } from "../../uc/ids.ts";

const uuid = (v: string) => cast(v.toLowerCase(), "uuid");

/** Il caso esiste, è completo ed è del workspace (ogni lettura lo ripete). */
function caseOf(workspaceId: string, caseId: string): SqlFragment {
  return ucSql`(SELECT c.id FROM uc_cases c WHERE c.id = ${uuid(caseId)} AND c.workspace_id = ${uuid(workspaceId)} AND c.setup_completed_at IS NOT NULL)`;
}

/** Domanda indispensabile del via (alias `i`): la regola di `isRequired` in `gates.ts`. */
function requiredForVia(): SqlFragment {
  return ucSql`(i.in_gate_scope AND i.priority = 'must' AND i.perimeter = 'in_contratto' AND i.serves_for @> ${jsonb([GATE_PHASE.G1])})`;
}

/**
 * Le domande indispensabili del via con le colonne che `isItemOk` guarda:
 * stato, scadenza, «non si applica» firmato, deroga e ripiego con le firme,
 * blocchi attivi. Le colonne mancanti di `GateItem` restano vuote.
 */
function requiredItemsSql(c: SqlFragment): UcStatement {
  return toStatement(ucSql`WITH ab AS (
  SELECT ib.item_id, jsonb_agg(b.key ORDER BY b.key) AS keys
  FROM uc_item_blockers ib JOIN uc_blockers b ON b.id = ib.blocker_id
  WHERE b.case_id = ${c} AND b.status IN ('attivo', 'permanente')
  GROUP BY ib.item_id
)
SELECT i.id, i.key, i.kind, i.status, i.status_reason, i.privacy_class, i.request_module_key, i.stale_at, i.na_approved_at,
  i.waiver, i.waiver_approved_at, i.fallback, i.fallback_approved_at,
  coalesce(i.spec ->> 'health_rule_question', 'false') = 'true' AS health_rule_question,
  coalesce(ab.keys, '[]'::jsonb) AS active_blocker_keys
FROM uc_items i
LEFT JOIN ab ON ab.item_id = i.id
WHERE i.case_id = ${c} AND i.deleted_at IS NULL AND ${requiredForVia()}
ORDER BY i.sort_order, i.key`);
}

/**
 * Blocchi attivi, con le domande collegate non cancellate dello stesso caso e
 * le firme (per la scheda privacy). Il conteggio è quello del pannello
 * (`blockerQuestionsSql`): una domanda d'altri non entra in nessuno dei due.
 */
function activeBlockersSql(c: SqlFragment, blockerId?: string): UcStatement {
  const only = blockerId ? ucSql`b.id = ${uuid(blockerId)}` : ucSql`b.status = 'attivo'`;
  return toStatement(ucSql`SELECT b.id, b.key, b.label, b.status, b.evidence, b.approvals, b.resolved_at, b.fallback_allowed,
  (SELECT count(*) FROM uc_item_blockers ib JOIN uc_items i ON i.id = ib.item_id AND i.deleted_at IS NULL AND i.case_id = b.case_id WHERE ib.blocker_id = b.id)::int AS items
FROM uc_blockers b WHERE b.case_id = ${c} AND ${only} ORDER BY b.created_at, b.key`);
}

function milestonesSql(c: SqlFragment): UcStatement {
  return toStatement(ucSql`SELECT key, title, planned_date::text AS planned_date, planned_label, is_proposal, to_confirm, done_at
FROM uc_milestones WHERE case_id = ${c} ORDER BY sort_order, planned_date NULLS LAST, key`);
}

/**
 * Solo «In breve» e «Fasi» della descrizione, non la cronologia delle versioni.
 * Dentro un oggetto: un testo jsonb da solo tornerebbe già letto come stringa.
 */
function descriptionPartsSql(c: SqlFragment): UcStatement {
  return toStatement(ucSql`SELECT jsonb_build_object('in_breve', cs.description -> 'in_breve', 'fasi', cs.description -> 'fasi') AS parts FROM uc_cases cs WHERE cs.id = ${c}`);
}

/** Le prime domande collegate a un blocco, per titolo, nell'ordine del caso. */
function blockerQuestionsSql(c: SqlFragment, blockerId: string, limit: number): UcStatement {
  return toStatement(ucSql`SELECT i.id, i.title FROM uc_item_blockers ib
JOIN uc_items i ON i.id = ib.item_id AND i.deleted_at IS NULL
WHERE ib.blocker_id = ${uuid(blockerId)} AND i.case_id = ${c}
ORDER BY i.sort_order, i.key LIMIT ${cast(limit, "int")}`);
}

/** File del caso utilizzabili come prova (puliti, zona standard): come `loadUsableCaseFiles`. */
function usableFilesSql(c: SqlFragment): UcStatement {
  return toStatement(ucSql`SELECT f.id, f.file_name FROM uc_files f
WHERE f.case_id = ${c} AND f.deleted_at IS NULL AND f.storage_zone = 'standard'
  AND f.scan_status = 'pulito' AND (f.content_scanned OR f.reviewed_at IS NOT NULL)
ORDER BY f.created_at DESC LIMIT 200`);
}

function fileRows(rows: readonly Row[] | undefined): { id: string; name: string }[] {
  return (rows ?? []).map((r) => ({ id: String(r.id), name: String(r.file_name) }));
}

/** Blocco della riga SQL, con chi deve ancora firmare la scheda privacy. */
function toBlocker(r: Row): OverviewBlockerInput & { status: BlockerStatus } {
  const status = rowVocab(BLOCKER_STATUSES, r.status) ?? "attivo";
  const evidence = rowJson(r.evidence);
  const approvals = rowJson(r.approvals);
  const items = rowNumber(r.items) ?? 0;
  const key = String(r.key);
  const view = blockerView({
    id: String(r.id),
    key,
    label: String(r.label ?? key),
    status,
    items,
    evidence: evidence && typeof evidence === "object" && !Array.isArray(evidence) ? (evidence as Record<string, Json>) : null,
    approvals: Array.isArray(approvals) ? (approvals as Json[]) : [],
    resolvedAt: rowDate(r.resolved_at)?.toISOString() ?? null,
    fallbackAllowed: rowString(r.fallback_allowed),
  });
  return { id: view.id, key, label: String(r.label ?? key), status, items, a8WaitingFor: view.a8?.waitingFor ?? null };
}

function toMilestone(r: Row): MilestoneLike {
  return {
    key: String(r.key),
    title: String(r.title),
    plannedDate: rowString(r.planned_date),
    plannedLabel: rowString(r.planned_label),
    isProposal: rowBool(r.is_proposal),
    toConfirm: rowBool(r.to_confirm),
    done: r.done_at !== null && r.done_at !== undefined,
  };
}

// ── Panoramica ────────────────────────────────────────────────────────

export interface OverviewData {
  status: CaseStatus;
  modules: ModuleRef[];
  /** Etichette dei ruoli dello schema (chi risponde), con quelle del caso sopra. */
  roleLabels: Record<string, string>;
  /** Le domande indispensabili del via, con argomento, stato e se sono a posto adesso. */
  required: (RequiredItemFact & { itemId: string })[];
  /** Blocchi attivi del caso, nell'ordine di creazione. */
  blockers: OverviewBlockerInput[];
  milestones: MilestoneLike[];
  /** «In breve» come lo legge chi guarda: mai codici dei fatti; al cliente nemmeno articoli e chiavi (P0-12). */
  inBreve: string | null;
  /** Le «Fasi» della descrizione (fase, quando, cosa si fa, si chiude con), ripulite come «In breve». */
  phases: DescriptionRecord[];
  /** Il blocco del pannello aperto (`?apri=blocco:<id>`), con le prime domande collegate. */
  blocker: (OverviewBlockerInput & { status: BlockerStatus; questions: { id: string; title: string }[] }) | null;
  /** File utilizzabili come prova (solo con `withFiles`). */
  files: { id: string; name: string }[];
}

/**
 * La Panoramica in un giro. Null se il dossier non c'è o non è di questo
 * workspace. `blockerId` apre il pannello di un blocco (le prime
 * `blockerQuestions` domande); `withFiles` aggiunge i file per le prove.
 * `audience` è il pubblico di chi guarda per i testi della descrizione: senza,
 * quello del cliente, che toglie di più (DESIGN §7.1 P0-12).
 */
export async function loadOverview(
  executor: UcExecutor,
  i: { workspaceId: string; caseId: string; now?: Date; blockerId?: string | null; blockerQuestions?: number; withFiles?: boolean; audience?: Audience },
): Promise<OverviewData | null> {
  if (!UUID.test(i.workspaceId) || !UUID.test(i.caseId)) return null;
  const now = i.now ?? new Date();
  const c = caseOf(i.workspaceId, i.caseId);
  const blockerId = i.blockerId && UUID.test(i.blockerId) ? i.blockerId : null;
  const context = caseViewContextReader(i.workspaceId.toLowerCase(), i.caseId.toLowerCase());
  const statements: UcStatement[] = [
    context.statement,
    requiredItemsSql(c),
    activeBlockersSql(c),
    milestonesSql(c),
    descriptionPartsSql(c),
  ];
  if (blockerId) statements.push(activeBlockersSql(c, blockerId), blockerQuestionsSql(c, blockerId, Math.max(1, Math.min(50, i.blockerQuestions ?? 10))));
  if (i.withFiles) statements.push(usableFilesSql(c));
  const rows = await executor.batch(statements);
  const ctx = context.parse(rows[0]);
  if (!ctx) return null;
  const required = (rows[1] ?? []).map((r) => {
    const item = rowToGateItem(r);
    return { itemId: item.id, moduleKey: item.requestModuleKey, status: rowVocab(ITEM_STATUSES, r.status) ?? ("da_chiedere" as ItemStatus), ok: isItemOk(item, "G1", now).ok };
  });
  const parts = rowObject(rows[4]?.[0]?.parts);
  // Come la Descrizione di Soluzione (`descriptionView`): il testo salvato tiene i codici dei fatti, chi legge no.
  const audience = i.audience ?? "cliente";
  const inBreve = readableContent(readBlock(descriptionBlockDef("in_breve")!, parts.in_breve), audience);
  const phases = readableContent(readBlock(descriptionBlockDef("fasi")!, parts.fasi), audience);
  let blocker: OverviewData["blocker"] = null;
  let next = 5;
  if (blockerId) {
    const head = rows[next]?.[0];
    blocker = head ? { ...toBlocker(head), questions: (rows[next + 1] ?? []).map((q) => ({ id: String(q.id), title: String(q.title) })) } : null;
    next += 2;
  }
  return {
    status: ctx.status,
    modules: ctx.modules,
    roleLabels: ctx.roleLabels,
    required,
    blockers: (rows[2] ?? []).map(toBlocker),
    milestones: (rows[3] ?? []).map(toMilestone),
    inBreve: inBreve.kind === "testo" ? inBreve.text : null,
    phases: phases.kind === "schede" ? phases.records : [],
    blocker,
    files: i.withFiles ? fileRows(rows[next]) : [],
  };
}

// ── Via allo sviluppo ─────────────────────────────────────────────────

export interface ViaReview {
  id: string;
  decision: string;
  proposedAt: string | null;
  decidedAt: string | null;
  catalogVersion: number | null;
  /** Solo ruoli, date e metodo: nessun nome. */
  signatures: { ruolo: string; at: string; metodo: string }[];
  writtenEvidence: boolean;
  /** Proposta respinta: il ruolo di chi l'ha chiusa (dall'evento `gate.respinto`), altrimenti null. */
  rejectedBy: string | null;
}

export interface ViaCatalogVersion {
  version: number;
  reason: string;
  createdAt: string | null;
  changeNote: string | null;
  diff: { added: number; removed: number; changed: number };
}

export interface ViaData {
  core: CaseCore;
  g1: GateComputation;
  coverage: LiteralCoverage;
  /** Indispensabili in verifica e non ancora a posto: la parte gialla della barra. */
  inReview: number;
  /** Le proposte del via, dalla più recente. */
  reviews: ViaReview[];
  /** La proposta in attesa delle firme (la più recente), oppure null. */
  pending: ViaReview | null;
  versions: ViaCatalogVersion[];
  /** File utilizzabili come prova scritta (solo con `withFiles`). */
  files: { id: string; name: string }[];
}

/**
 * Le proposte del via, dalla più recente. Per quelle respinte anche il ruolo
 * di chi le ha chiuse, dall'evento `gate.respinto` della stessa proposta:
 * «Ritira la proposta» di Lateral Space e «Non approvo» del cliente scrivono
 * la stessa decisione.
 */
function reviewsSql(c: SqlFragment): UcStatement {
  return toStatement(ucSql`SELECT r.id, r.decision, r.proposed_at, r.decided_at, r.catalog_version, r.approvals, r.written_evidence_file_id IS NOT NULL AS evidence,
  CASE WHEN r.decision = 'respinto' THEN (
    SELECT e.payload ->> 'ruolo' FROM uc_events e
    WHERE e.case_id = r.case_id AND e.event_type = 'gate.respinto' AND e.target_id = r.id
    ORDER BY e.created_at DESC LIMIT 1
  ) END AS rejected_by
FROM uc_gate_reviews r WHERE r.case_id = ${c} AND r.gate_key = 'G1' ORDER BY r.created_at DESC`);
}

function versionsSql(c: SqlFragment): UcStatement {
  return toStatement(ucSql`SELECT version, reason, created_at, change_note,
  jsonb_array_length(coalesce(diff -> 'added', '[]'::jsonb)) AS added, jsonb_array_length(coalesce(diff -> 'removed', '[]'::jsonb)) AS removed,
  jsonb_array_length(coalesce(diff -> 'changed', '[]'::jsonb)) AS changed
FROM uc_catalog_versions WHERE case_id = ${c} ORDER BY version DESC`);
}

function toReview(r: Row): ViaReview {
  return {
    id: String(r.id),
    decision: String(r.decision),
    proposedAt: rowDate(r.proposed_at)?.toISOString() ?? null,
    decidedAt: rowDate(r.decided_at)?.toISOString() ?? null,
    catalogVersion: rowNumber(r.catalog_version),
    signatures: (rowJson<Approval[]>(r.approvals) ?? [])
      .filter((a) => a && typeof a === "object" && typeof a.ruolo === "string")
      .map((a) => ({ ruolo: String(a.ruolo), at: String(a.at ?? ""), metodo: String(a.metodo ?? "") })),
    writtenEvidence: r.evidence === true,
    rejectedBy: rowString(r.rejected_by),
  };
}

/**
 * La pagina del via in un giro: la prontezza dal vivo (la stessa funzione
 * della cache) più proposte, firme e versioni del catalogo. Null se il dossier
 * non c'è o non è di questo workspace.
 */
export async function loadVia(executor: UcExecutor, i: { workspaceId: string; caseId: string; now?: Date; withFiles?: boolean }): Promise<ViaData | null> {
  if (!UUID.test(i.workspaceId) || !UUID.test(i.caseId)) return null;
  const now = i.now ?? new Date();
  const [workspaceId, caseId] = [i.workspaceId.toLowerCase(), i.caseId.toLowerCase()];
  const c = caseOf(workspaceId, caseId);
  const readiness = readinessReadStatements(workspaceId, caseId);
  const statements = [...readiness, reviewsSql(c), versionsSql(c), ...(i.withFiles ? [usableFilesSql(c)] : [])];
  const rows = await executor.batch(statements);
  const input = parseReadinessRows(rows.slice(0, readiness.length));
  if (!input) return null;
  const live = computeCaseReadiness(input, now);
  const reviews = (rows[readiness.length] ?? []).map(toReview);
  const versions = (rows[readiness.length + 1] ?? []).map(
    (r): ViaCatalogVersion => ({
      version: rowNumber(r.version) ?? 0,
      reason: String(r.reason),
      createdAt: rowDate(r.created_at)?.toISOString() ?? null,
      changeNote: rowString(r.change_note),
      diff: { added: rowNumber(r.added) ?? 0, removed: rowNumber(r.removed) ?? 0, changed: rowNumber(r.changed) ?? 0 },
    }),
  );
  return {
    core: input.core,
    g1: live.g1,
    coverage: live.coverage,
    inReview: live.g1.missing.filter((m) => m.status === "in_verifica").length,
    reviews,
    pending: reviews.find((r) => r.decision === "proposto") ?? null,
    versions,
    files: i.withFiles ? fileRows(rows[readiness.length + 2]) : [],
  };
}
