/**
 * Letture di Domande (DESIGN §3.6, WP3): la lista con segmenti, filtri e
 * conteggi, la selezione «tutte le N», la coda di «Verifica una alla volta» e
 * Documenti.
 *
 * Al posto dei vecchi caricatori del catalogo, della coda di verifica e dei
 * documenti di `uc-views.ts` (tolti da WP13): ordine per argomento, 50 righe,
 * gruppi di §2.6 e quattro occhi in SQL; le schede dataset con il loro file.
 *
 * Una pagina è un solo batch (una transazione): contesto del caso, referenti,
 * conteggi per argomento e la pagina di righe. L'accesso al workspace e al
 * caso lo controlla la pagina prima di chiamare queste funzioni; qui ogni
 * SELECT è filtrata per caso, i valori personali e sanitari non escono dal
 * database e il cliente non riceve mai le risposte (§3.6.8).
 *
 * Modulo senza import dell'app, come `uc-views.ts`: l'esecutore arriva da fuori.
 */
import { cast, toStatement, ucSql, type UcStatement } from "../../uc/sql/statement.ts";
import {
  catalogSizeSql,
  parseQuestionFilter,
  parseQuestionQuery,
  questionAudience,
  questionCountsSql,
  questionDefaults,
  questionKindFacetSql,
  questionPageSql,
  questionSelectionSql,
  QUESTION_SELECTION_MAX,
  QUESTIONS_PAGE_SIZE,
  requiredDocumentsCountSql,
  reviewQueueSql,
  type QuestionAudience,
  type QuestionDefaults,
  type QuestionFilter,
  type QuestionWhereContext,
} from "../../uc/views/catalog-filter.ts";
import {
  clientPlainText,
  questionGroups,
  questionSegmentItems,
  rowCount,
  rowsToFacet,
  rowsToQuestionCounts,
  rowsToSelection,
  rowToContact,
  rowToQuestionRow,
  type CaseViewContext,
  type ContactOption,
  type QuestionCounts,
  type QuestionGroupView,
  type QuestionRowView,
  type QuestionSegmentItem,
} from "../../uc/views/rows.ts";
import { rowsToCaseFiles, rowsToDatasets, rowsToRequiredDocuments, type CaseFileView, type DatasetView, type RequiredDocumentView } from "../../uc/views/documents.ts";
import { seesPersonalZoneMetadata, seesValidatedOnly } from "../../uc/views/page-access.ts";
import { caseFilesSql, contactsSql, requiredDocumentsSql } from "../../uc/views/sql.ts";
import { rowsToReviewQueue } from "../../uc/views/verification.ts";
import { CASE_STATUSES, isVocab, type CaseStatus, type ItemStatus } from "../../uc/vocab.ts";
import { caseViewContextReader } from "./uc-views.ts";
import type { UcExecutor } from "../uc-executor.ts";
import type { UcViewer } from "./uc-views.ts";

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

/** Stato prima della pausa: serve solo ai predefiniti di un caso in pausa. */
function statusBeforeSuspensionSql(v: UcViewer): UcStatement {
  return toStatement(ucSql`SELECT c.status_before_suspension FROM uc_cases c
WHERE c.id = ${cast(v.caseId, "uuid")} AND c.workspace_id = ${cast(v.workspaceId, "uuid")}`);
}

/** I predefiniti di Domande per il caso: con lo stato di prima solo se il caso è in pausa (un giro in più, raro). */
export async function loadQuestionDefaults(executor: UcExecutor, v: UcViewer, status: CaseStatus): Promise<{ audience: QuestionAudience; defaults: QuestionDefaults }> {
  const audience = questionAudience(v.roles);
  let before: CaseStatus | null = null;
  if (status === "sospeso" && audience !== "sviluppatore") {
    const [rows] = await executor.batch([statusBeforeSuspensionSql(v)]);
    const value = rows[0]?.status_before_suspension;
    before = isVocab(CASE_STATUSES, value) ? value : null;
  }
  return { audience, defaults: questionDefaults(status, before, audience) };
}

export interface QuestionsPageData {
  ctx: CaseViewContext;
  contacts: ContactOption[];
  audience: QuestionAudience;
  defaults: QuestionDefaults;
  /** Filtri applicati (quelli dell'URL, con i predefiniti; la pagina oltre l'ultima diventa l'ultima). */
  filter: QuestionFilter;
  rows: QuestionRowView[];
  /** Gruppi per argomento; null dove l'elenco non si raggruppa (Da verificare, cliente). */
  groups: QuestionGroupView[] | null;
  counts: QuestionCounts;
  /** Domande del segmento aperto, in tutte le pagine. */
  total: number;
  segments: QuestionSegmentItem[];
  /** Voci del caso di ogni tipo («Tutto il catalogo (2.812)»): solo Lateral Space. */
  catalogSize: number | null;
  /** Conteggio per tipo con il catalogo intero (opzioni di «Tipo»). */
  kindCounts: Record<string, number> | null;
}

function whereContext(v: UcViewer, audience: QuestionAudience): QuestionWhereContext {
  return { userId: v.user.userId, audience };
}

/**
 * Una pagina di Domande (50 righe) con i conteggi, in un batch. Le righe di
 * «Da verificare» vanno dalla risposta più vecchia e non si raggruppano; il
 * cliente legge un elenco semplice con l'argomento nella riga.
 */
export async function loadQuestionsPage(
  executor: UcExecutor,
  v: UcViewer,
  i: { searchParams: SearchParams; status: CaseStatus; now: Date },
): Promise<QuestionsPageData | null> {
  const { audience, defaults } = await loadQuestionDefaults(executor, v, i.status);
  let filter = parseQuestionFilter(i.searchParams, audience, defaults);
  const where = whereContext(v, audience);
  const ls = audience === "ls";
  const context = caseViewContextReader(v.workspaceId, v.caseId);
  const statements: UcStatement[] = [
    context.statement,
    contactsSql(v.workspaceId),
    questionCountsSql(v.caseId, filter, where),
    questionPageSql(v.caseId, filter, where),
  ];
  if (ls) statements.push(catalogSizeSql(v.caseId, audience), requiredDocumentsCountSql(v.caseId, audience));
  if (filter.catalogo) statements.push(questionKindFacetSql(v.caseId, filter, where));
  const rows = await executor.batch(statements);
  const ctx = context.parse(rows[0]);
  if (!ctx) return null;
  const contacts = rows[1].map(rowToContact);
  const counts = rowsToQuestionCounts(rows[2]);
  const total = counts.segments[filter.vista];
  let pageRows = rows[3];
  if (pageRows.length === 0 && total > 0 && filter.pagina > 1) {
    // Pagina oltre l'ultima (per esempio dopo un'azione che ha svuotato l'ultima): si mostra l'ultima.
    filter = { ...filter, pagina: Math.ceil(total / QUESTIONS_PAGE_SIZE) };
    [pageRows] = await executor.batch([questionPageSql(v.caseId, filter, where)]);
  }
  const contactMap = new Map(contacts.map((c) => [c.id, c]));
  // Il titolo dell'argomento accanto alla domanda: al cliente senza articoli, sigle o chiavi (DESIGN §6.2).
  const moduleTitles = new Map(ctx.modules.map((m) => [m.key, audience === "cliente" ? clientPlainText(m.title) || m.title : m.title]));
  const questionRows = pageRows.map((r) => rowToQuestionRow(r, { audience, roles: v.roles, contacts: contactMap, roleLabels: ctx.roleLabels, moduleTitles, now: i.now }));
  const grouped = audience !== "cliente" && filter.vista !== "da-verificare";
  return {
    ctx,
    contacts,
    audience,
    defaults,
    filter,
    rows: questionRows,
    groups: grouped ? questionGroups(questionRows, { counts: counts.byModule, modules: ctx.modules, roleLabels: ctx.roleLabels }) : null,
    counts,
    total,
    segments: questionSegmentItems({ audience, counts: counts.segments, active: filter.vista, defaultSegment: defaults.vista, documents: ls ? rowCount(rows[5]) : null }),
    catalogSize: ls ? rowCount(rows[4]) : null,
    kindCounts: filter.catalogo ? rowsToFacet(rows[ls ? 6 : 4]) : null,
  };
}

/**
 * I segmenti di Domande con la vista predefinita, per le pagine sotto Domande
 * che li mostrano senza la lista (Documenti, §3.6.6). Un giro.
 */
export async function loadQuestionSegments(
  executor: UcExecutor,
  v: UcViewer,
  status: CaseStatus,
): Promise<{ audience: QuestionAudience; defaults: QuestionDefaults; filter: QuestionFilter; segments: QuestionSegmentItem[] }> {
  const { audience, defaults } = await loadQuestionDefaults(executor, v, status);
  const filter = parseQuestionFilter({}, audience, defaults);
  if (audience === "sviluppatore") return { audience, defaults, filter, segments: [] };
  const ls = audience === "ls";
  const rows = await executor.batch([questionCountsSql(v.caseId, filter, whereContext(v, audience)), ...(ls ? [requiredDocumentsCountSql(v.caseId, audience)] : [])]);
  const counts = rowsToQuestionCounts(rows[0]);
  return {
    audience,
    defaults,
    filter,
    segments: questionSegmentItems({ audience, counts: counts.segments, active: filter.vista, defaultSegment: defaults.vista, documents: ls ? rowCount(rows[1]) : null }),
  };
}

export interface QuestionSelection {
  /** Domande selezionate (al massimo `QUESTION_SELECTION_MAX`). */
  total: number;
  /** Erano di più: si selezionano solo le prime. */
  truncated: boolean;
  /** Id per stato: chi agisce tiene solo gli stati che l'azione ammette. */
  byStatus: Partial<Record<ItemStatus, string[]>>;
}

/**
 * «Seleziona tutte le N»: id e stato delle domande della vista, con la query
 * della pagina (che porta sempre `vista` e `indispensabili`). Solo letture: i
 * comandi ricontrollano ogni domanda.
 */
export async function loadQuestionSelection(executor: UcExecutor, v: UcViewer, query: string): Promise<QuestionSelection> {
  const audience = questionAudience(v.roles);
  const filter = { ...parseQuestionQuery(query, audience, { vista: "tutte", soloIndispensabili: false }), pagina: 1 };
  const [rows] = await executor.batch([questionSelectionSql(v.caseId, filter, whereContext(v, audience))]);
  return rowsToSelection(rows, QUESTION_SELECTION_MAX);
}

/**
 * La coda di «Verifica una alla volta» (§3.6.4): gli id delle risposte da
 * verificare per chi guarda, dalla più vecchia, e quante sono sue (le verifica
 * un collega). Un giro.
 */
export async function loadReviewQueue(executor: UcExecutor, v: UcViewer): Promise<{ ids: string[]; mine: number }> {
  const [rows] = await executor.batch([reviewQueueSql(v.caseId, v.user.userId)]);
  return rowsToReviewQueue(rows);
}

// ── Documenti (DESIGN §3.6.6) ─────────────────────────────────────────

/**
 * Schede dataset del caso con il loro file (`file_id`), mai righe di dati: la
 * pagina le mette sotto il file da cui vengono. Come `caseDatasetsSql` di
 * `views/sql.ts` (congelato), con il file e l'ordine dalla versione più nuova.
 */
function documentDatasetsSql(caseId: string, includePersonalZone: boolean): UcStatement {
  return toStatement(ucSql`SELECT d.id, d.item_id, d.file_id, it.key AS item_key, d.source_key, d.dataset_version, d.period_from::text AS period_from,
  d.period_to::text AS period_to, d.extracted_at, d.row_count, d.personal_data, d.pseudonymized,
  CASE WHEN jsonb_typeof(d.pii_columns) = 'array' THEN jsonb_array_length(d.pii_columns) ELSE 0 END AS pii_columns,
  d.data_controller_label, d.status, d.validated_at, d.retention_until::text AS retention_until, f.storage_zone,
  EXISTS (SELECT 1 FROM uc_validations v WHERE v.dataset_id = d.id AND v.outcome = 'errore') AS dq_error
FROM uc_datasets d
LEFT JOIN uc_items it ON it.id = d.item_id
LEFT JOIN uc_files f ON f.id = d.file_id
WHERE d.case_id = ${cast(caseId, "uuid")} AND d.deleted_at IS NULL
  AND (${cast(includePersonalZone, "boolean")} OR f.storage_zone IS NULL OR f.storage_zone = 'standard')
ORDER BY d.dataset_version DESC, d.created_at DESC, d.id
LIMIT 500`);
}

export interface QuestionDocumentsData {
  ctx: CaseViewContext;
  required: RequiredDocumentView[];
  files: CaseFileView[];
  datasets: DatasetView[];
  /** I file della zona personale sono in elenco (solo metadati). */
  personalZoneShown: boolean;
}

/**
 * Documenti di Domande in un batch: documenti richiesti, file caricati e
 * schede dataset con il loro file. Lo sviluppatore vede solo il catalogo
 * validato: file delle domande a posto e dataset validati.
 */
export async function loadQuestionDocuments(executor: UcExecutor, v: UcViewer): Promise<QuestionDocumentsData | null> {
  const personalZone = seesPersonalZoneMetadata(v.roles);
  const validatedOnly = seesValidatedOnly(v.roles);
  const context = caseViewContextReader(v.workspaceId, v.caseId);
  const rows = await executor.batch([
    context.statement,
    contactsSql(v.workspaceId),
    requiredDocumentsSql(v.caseId, validatedOnly),
    caseFilesSql(v.caseId, personalZone),
    documentDatasetsSql(v.caseId, personalZone),
  ]);
  const ctx = context.parse(rows[0]);
  if (!ctx) return null;
  const contacts = new Map(rows[1].map(rowToContact).map((c) => [c.id, c]));
  const required = rowsToRequiredDocuments(rows[2], { roles: v.roles, roleLabels: ctx.roleLabels, contacts });
  const files = rowsToCaseFiles(rows[3], v.roles);
  const datasets = rowsToDatasets(rows[4]);
  const validatedIds = new Set(required.map((d) => d.id));
  return {
    ctx,
    required,
    files: validatedOnly ? files.filter((f) => f.item !== null && validatedIds.has(f.item.id) && f.usable) : files,
    datasets: validatedOnly ? datasets.filter((d) => d.statusKey === "validato") : datasets,
    personalZoneShown: personalZone,
  };
}
