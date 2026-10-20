/**
 * Documenti e dataset del caso (PIANO §5.1, §6, `documenti/`): documenti
 * richiesti (fonti, documenti e voci con risposta «file» o «dataset») con
 * stato e referente, file caricati (solo metadati, stato dei controlli e
 * anteprima già mascherata della zona standard) e schede dataset.
 *
 * La zona personale: solo metadati e solo a chi la può vedere (la query la
 * esclude per gli altri); mai anteprime.
 *
 * Modulo puro.
 */
import { rowBool, rowDate, rowIsoDate, rowJson, rowNumber, rowObject, rowString, rowStringArray, rowVocab, type Row } from "../sql/readiness.ts";
import { DATASET_STATUSES, FILE_PERSONAL_DATA, ITEM_KINDS, ITEM_STATUSES, PRIORITIES, PRIVACY_CLASSES, RESPONSE_TYPES, SCAN_STATUSES, type CaseRole, type ItemKind, type ItemStatus, type Priority, type PrivacyClass, type ResponseType, type SemaforoColor } from "../vocab.ts";
import { formatBytes, formatDateIt, formatNumberIt, specText } from "./format.ts";
import { DATASET_STATUS_LABEL, FILE_PERSONAL_DATA_LABEL, SCAN_STATUS_LABEL } from "./labels.ts";
import { canOpenItem, isClientViewer } from "./page-access.ts";
import { clientPlainText, oneQuestionStateLabel, type ContactOption } from "./rows.ts";
import { statusView } from "./status-groups.ts";

export interface RequiredDocumentView {
  id: string;
  key: string;
  kind: ItemKind;
  title: string;
  explanation: string | null;
  /** Cosa chiediamo al cliente (testo del template). */
  request: string | null;
  status: ItemStatus;
  statusReason: string | null;
  priority: Priority | null;
  privacyClass: PrivacyClass;
  availability: string[];
  owner: string | null;
  assignee: string | null;
  responseType: ResponseType | null;
  method: string | null;
  period: string | null;
  format: string | null;
  afterA8: boolean;
  blockers: string[];
  files: number;
  datasets: number;
  due: string | null;
  dueIsProposal: boolean;
  canOpen: boolean;
}

export function rowsToRequiredDocuments(
  rows: readonly Row[],
  ctx: { roles: readonly CaseRole[]; roleLabels: Readonly<Record<string, string>>; contacts: ReadonlyMap<string, ContactOption> },
): RequiredDocumentView[] {
  return rows.map((r) => {
    const spec = rowObject(r.spec);
    const status = rowVocab(ITEM_STATUSES, r.status) ?? "da_chiedere";
    const blockers = rowStringArray(rowJson(r.active_blockers));
    const availability = rowStringArray(rowJson(r.availability));
    const role = rowString(r.owner_role_key);
    const assignee = rowString(r.assignee_contact_id);
    return {
      id: String(r.id),
      key: String(r.key),
      kind: rowVocab(ITEM_KINDS, r.kind) ?? "fonte",
      title: String(r.title ?? ""),
      explanation: rowString(r.explanation),
      request: rowString(r.help),
      status,
      statusReason: rowString(r.status_reason),
      priority: rowVocab(PRIORITIES, r.priority),
      privacyClass: rowVocab(PRIVACY_CLASSES, r.privacy_class) ?? "riservato_azienda",
      availability,
      owner: role ? (ctx.roleLabels[role] ?? role) : null,
      assignee: assignee ? (ctx.contacts.get(assignee)?.name ?? "Referente") : null,
      responseType: rowVocab(RESPONSE_TYPES, r.response_type),
      method: specText(spec, "metodo"),
      period: specText(spec, "periodo"),
      format: specText(spec, "formato"),
      afterA8: blockers.includes("a8") || availability.includes("dopo_a8"),
      blockers,
      files: rowNumber(r.files) ?? 0,
      datasets: rowNumber(r.datasets) ?? 0,
      due: formatDateIt(rowDate(r.due_at)),
      dueIsProposal: rowBool(r.due_is_proposal),
      canOpen: canOpenItem(ctx.roles, status),
    };
  });
}

export interface PreviewTable {
  columns: string[];
  rows: string[][];
  /** Indici delle colonne mascherate per intestazione. */
  maskedColumns: number[];
  totalRows: number | null;
  truncated: boolean;
}

/** Anteprima già mascherata (`uc_files.preview`, `unbundle.uc-preview/1`): al massimo 20 righe e 50 colonne. */
export function parsePreview(raw: unknown): PreviewTable | null {
  const p = rowJson<Record<string, unknown>>(raw);
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  const columns = Array.isArray(p.columns) ? p.columns.slice(0, 50).map((c) => (typeof c === "string" ? c : "")) : [];
  const rows = Array.isArray(p.rows)
    ? p.rows.slice(0, 20).map((r) => (Array.isArray(r) ? r.slice(0, 50).map((c) => (typeof c === "string" ? c : c === null || c === undefined ? "" : String(c))) : []))
    : [];
  const maskedColumns = Array.isArray(p.masked_columns) ? p.masked_columns.filter((m): m is number => typeof m === "number" && Number.isInteger(m) && m >= 0) : [];
  if (columns.length === 0 && rows.length === 0) return null;
  return { columns, rows, maskedColumns, totalRows: rowNumber(p.total_rows), truncated: p.truncated === true };
}

export interface CaseFileView {
  id: string;
  name: string;
  item: { id: string; key: string; title: string } | null;
  mime: string | null;
  size: string | null;
  zone: "standard" | "personale";
  personalData: string;
  scanLabel: string;
  scanState: "in_quarantena" | "pulito" | "rifiutato";
  findings: string[];
  usable: boolean;
  preview: PreviewTable | null;
  retentionUntil: string | null;
  at: string | null;
}

const FINDING_CATEGORY: Readonly<Record<string, string>> = {
  sanitario: "dati sanitari",
  personale: "dati personali",
  particolare: "dati particolari",
  vietata: "colonne vietate",
};

/** Esito dei controlli in parole: solo categorie, conteggi e codici (mai testo del file). */
function findingsOf(raw: unknown): string[] {
  const f = rowJson<Record<string, unknown>>(raw);
  if (!f || typeof f !== "object" || Array.isArray(f)) return [];
  const out: string[] = [];
  if (typeof f.categoria === "string") {
    const cols = typeof f.colonne === "number" ? f.colonne : null;
    out.push(`Trovati ${FINDING_CATEGORY[f.categoria] ?? f.categoria}${cols ? ` in ${cols} ${cols === 1 ? "colonna" : "colonne"}` : ""}`);
  }
  if (typeof f.nel_testo === "number" && f.nel_testo > 0) out.push(`Termini sanitari nel testo: ${f.nel_testo}`);
  if (f.valori && typeof f.valori === "object") {
    const n = Object.values(f.valori as Record<string, unknown>).reduce<number>((s, v) => s + (typeof v === "number" ? v : 0), 0);
    if (n > 0) out.push(`Valori personali riconosciuti: ${n}`);
  }
  if (f.revisione_manuale === true) out.push("Aspetta la revisione di un'altra persona di Lateral Space");
  if (typeof f.codice === "string") out.push(`Codice: ${f.codice}`);
  if (Array.isArray(f.avvisi)) for (const a of f.avvisi) if (typeof a === "string") out.push(`Avviso: ${a}`);
  return out.slice(0, 10);
}

export function rowsToCaseFiles(rows: readonly Row[], roles: readonly CaseRole[]): CaseFileView[] {
  const client = isClientViewer(roles);
  return rows.map((r) => {
    const scan = rowVocab(SCAN_STATUSES, r.scan_status) ?? "in_quarantena";
    const personal = rowVocab(FILE_PERSONAL_DATA, r.personal_data) ?? "sconosciuto";
    const itemId = rowString(r.item_id);
    const zone = rowString(r.storage_zone) === "personale" ? "personale" : "standard";
    return {
      id: String(r.id),
      name: rowString(r.file_name) ?? "file",
      item: itemId ? { id: itemId, key: String(r.item_key ?? ""), title: String(r.item_title ?? "") } : null,
      mime: rowString(r.mime),
      size: formatBytes(rowNumber(r.size_bytes)),
      zone,
      personalData: FILE_PERSONAL_DATA_LABEL[personal],
      scanLabel: SCAN_STATUS_LABEL[scan],
      scanState: scan,
      findings: findingsOf(r.scan_findings),
      usable: scan === "pulito" && (rowBool(r.content_scanned) || rowBool(r.reviewed)),
      preview: zone === "standard" ? parsePreview(r.preview) : null,
      retentionUntil: formatDateIt(rowIsoDate(r.retention_until)),
      at: client ? null : formatDateIt(rowDate(r.created_at)),
    };
  });
}

export interface DatasetView {
  id: string;
  sourceKey: string;
  itemId: string | null;
  /** Il file da cui viene la scheda; null se il file è stato cancellato (o la query non lo legge). */
  fileId: string | null;
  version: number;
  period: string | null;
  extractedAt: string | null;
  rows: string | null;
  personalData: string;
  pseudonymized: boolean;
  piiColumns: number;
  controller: string;
  status: string;
  statusKey: (typeof DATASET_STATUSES)[number];
  validatedAt: string | null;
  retentionUntil: string | null;
  zone: "standard" | "personale";
  dqError: boolean;
}

export function rowsToDatasets(rows: readonly Row[]): DatasetView[] {
  return rows.map((r) => {
    const status = rowVocab(DATASET_STATUSES, r.status) ?? "ricevuto";
    const personal = rowVocab(FILE_PERSONAL_DATA, r.personal_data) ?? "sconosciuto";
    const from = formatDateIt(rowIsoDate(r.period_from));
    const to = formatDateIt(rowIsoDate(r.period_to));
    const rowCount = rowNumber(r.row_count);
    return {
      id: String(r.id),
      sourceKey: String(r.source_key),
      itemId: rowString(r.item_id),
      fileId: rowString(r.file_id),
      version: rowNumber(r.dataset_version) ?? 1,
      period: from && to ? `${from} – ${to}` : (from ?? to),
      extractedAt: formatDateIt(rowDate(r.extracted_at)),
      rows: rowCount === null ? null : formatNumberIt(rowCount),
      personalData: FILE_PERSONAL_DATA_LABEL[personal],
      pseudonymized: rowBool(r.pseudonymized),
      piiColumns: rowNumber(r.pii_columns) ?? 0,
      controller: rowString(r.data_controller_label) ?? "da indicare",
      status: DATASET_STATUS_LABEL[status],
      statusKey: status,
      validatedAt: formatDateIt(rowDate(r.validated_at)),
      retentionUntil: formatDateIt(rowIsoDate(r.retention_until)),
      zone: rowString(r.storage_zone) === "personale" ? "personale" : "standard",
      dqError: rowBool(r.dq_error),
    };
  });
}

// ── Documenti di Domande (DESIGN §3.6.6) ──────────────────────────────

export interface RequiredDocumentRow {
  id: string;
  title: string;
  tone: SemaforoColor;
  /** Lo stato per chi guarda (gruppo per Lateral Space, parola del cliente). */
  label: string;
  /** «Mario Rossi», «File caricato», «Senza referente». */
  who: string;
  /** Manca il referente: in ambra. */
  missing: boolean;
  personal: boolean;
  canOpen: boolean;
}

/** Al cliente un titolo vuoto non mostra la chiave (§6.2). */
const UNTITLED_DOCUMENT = "Documento senza titolo";
const UNTITLED_QUESTION = "Domanda senza titolo";

/** Il titolo per chi guarda: al cliente senza codici dei fatti, articoli né chiavi, e mai la chiave al posto del titolo. */
function titleFor(title: string, key: string, audience: "ls" | "cliente", untitled: string): string {
  if (audience === "ls") return title || key;
  return clientPlainText(title) || untitled;
}

/** I documenti richiesti in una riga: chi lo fornisce, oppure «File caricato» appena c'è un file (§3.6.6). */
export function requiredDocumentRows(docs: readonly RequiredDocumentView[], audience: "ls" | "cliente"): RequiredDocumentRow[] {
  return docs.map((d) => {
    const view = statusView(d.status, audience);
    const arrived = d.files > 0 || d.datasets > 0;
    return {
      id: d.id,
      title: titleFor(d.title, d.key, audience, UNTITLED_DOCUMENT),
      tone: view.tone,
      label: oneQuestionStateLabel(view, audience),
      who: arrived ? "File caricato" : (d.assignee ?? "Senza referente"),
      missing: !arrived && !d.assignee,
      personal: d.privacyClass === "personale" || d.privacyClass === "personale_equipaggio" || d.afterA8,
      canOpen: d.canOpen,
    };
  });
}

/** Le azioni di Lateral Space su un file, dal pannello di caricamento (`loadUploadPanel`). */
export interface FileManagementIndex {
  /** File da cui si può creare la scheda dataset. */
  datasetCandidates: ReadonlySet<string>;
  /** File → scheda da verificare, e se chi guarda la può decidere (non l'ha caricato). */
  datasetsToDecide: ReadonlyMap<string, { datasetId: string; canDecide: boolean }>;
  /** File che si possono cancellare (responsabile Lateral Space). */
  deletable: ReadonlySet<string>;
}

export interface CaseFileRow {
  id: string;
  name: string;
  /** «Controllato · 2 MB · 3 ott». */
  meta: string;
  zone: "standard" | "personale";
  usable: boolean;
  findings: string[];
  preview: PreviewTable | null;
  item: { id: string; title: string } | null;
  /** La scheda dataset del file, se c'è: periodo, titolare, conservazione. */
  dataset: DatasetCard | null;
  actions: { download: boolean; createDataset: boolean; decide: { datasetId: string } | null; decideBlocked: boolean; delete: boolean };
}

/** Una scheda dataset come la legge la pagina: stato, periodo, righe, titolare, conservazione. */
export interface DatasetCard {
  status: string;
  period: string | null;
  controller: string;
  rows: string | null;
  retention: string | null;
}

function datasetCard(d: DatasetView): DatasetCard {
  return { status: d.status, period: d.period, controller: d.controller, rows: d.rows, retention: d.retentionUntil };
}

/**
 * I file caricati come righe (§3.6.6): nome, esito e misura in una riga
 * grigia; si aprono su anteprima mascherata e scheda dataset; le azioni di
 * Lateral Space stanno nel «⋯». La scheda di un file è quella fatta da quel
 * file (`file_id`), la versione più nuova: due file della stessa domanda hanno
 * ognuno la sua, e un documento del caso (senza domanda) ha la sua.
 */
export function caseFileRows(files: readonly CaseFileView[], datasets: readonly DatasetView[], manage: FileManagementIndex | null, audience: "ls" | "cliente" = "ls"): CaseFileRow[] {
  return files.map((f) => {
    const dataset = datasets.find((d) => d.fileId === f.id) ?? null;
    const decide = manage?.datasetsToDecide.get(f.id) ?? null;
    return {
      id: f.id,
      name: f.name,
      meta: [f.scanLabel, f.size, f.at].filter(Boolean).join(" · "),
      zone: f.zone,
      usable: f.usable,
      findings: f.findings,
      preview: f.preview,
      item: f.item ? { id: f.item.id, title: titleFor(f.item.title, f.item.key, audience, UNTITLED_QUESTION) } : null,
      dataset: dataset ? datasetCard(dataset) : null,
      actions: {
        download: f.usable && f.zone === "standard",
        createDataset: manage?.datasetCandidates.has(f.id) ?? false,
        decide: decide?.canDecide ? { datasetId: decide.datasetId } : null,
        decideBlocked: decide !== null && !decide.canDecide,
        delete: manage?.deletable.has(f.id) ?? false,
      },
    };
  });
}

export interface DatasetWithoutFileRow extends DatasetCard {
  id: string;
  /** La fonte per titolo (la chiave solo per Lateral Space, se la fonte non è nel catalogo). */
  title: string;
}

/**
 * «Schede senza file»: le schede dataset il cui file non è in elenco (cancellato,
 * oppure fuori da ciò che chi guarda vede). Una per fonte, la versione più nuova.
 */
export function datasetsWithoutFile(
  files: readonly CaseFileView[],
  datasets: readonly DatasetView[],
  sources: ReadonlyMap<string, string>,
  audience: "ls" | "cliente",
): DatasetWithoutFileRow[] {
  const listed = new Set(files.map((f) => f.id));
  const seen = new Set<string>();
  const out: DatasetWithoutFileRow[] = [];
  for (const d of datasets) {
    if (d.fileId !== null && listed.has(d.fileId)) continue;
    if (seen.has(d.sourceKey)) continue;
    seen.add(d.sourceKey);
    out.push({ id: d.id, title: titleFor(sources.get(d.sourceKey) ?? "", d.sourceKey, audience, "Scheda dataset"), ...datasetCard(d) });
  }
  return out;
}

/** «2 file da controllare a mano» (solo Lateral Space, solo se ce ne sono). */
export function reviewsText(n: number): string | null {
  if (n <= 0) return null;
  return n === 1 ? "1 file da controllare a mano" : `${formatNumberIt(n)} file da controllare a mano`;
}
