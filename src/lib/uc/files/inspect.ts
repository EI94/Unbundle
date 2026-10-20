/**
 * Controllo completo di un file in quarantena, senza I/O (PIANO §6.3).
 *
 * Mette in fila i passi puri della pipeline: tipo dal contenuto (`sniff.ts`),
 * lettura (`csv.ts`, `ooxml.ts`, `pdf-text.ts`), intestazioni e valori
 * (`header-check.ts`), termini sanitari nel testo, anteprima mascherata
 * (`mask.ts`). Restituisce l'esito da scrivere in `uc_files`:
 *
 * - `rifiutato`: tipo non ammesso o file illeggibile; contenuto sanitario
 *   (intestazione o testo, sempre); categorie particolari; colonne vietate
 *   dalla voce; dati personali prima di A.8 o in una voce della zona
 *   standard; PDF con testo scarso nella zona personale.
 * - `revisione_manuale`: PDF con testo scarso nella zona standard; resta in
 *   quarantena (`scan_findings.revisione_manuale = true`) finché un altro
 *   utente Lateral Space non lo segna pulito o rifiutato.
 * - `pulito`: anteprima mascherata (solo zona standard, solo CSV, TSV e XLSX).
 *
 * `findings` va in `uc_files.scan_findings`: solo etichette del lessico,
 * conteggi e codici, mai il contenuto. `extractedText` serve al chiamante per
 * la scansione del testo (`text/scan.ts`: nomi, discriminazioni, contatti) e
 * si salva solo per la zona standard (`uc_files.extracted_text`; il DDL lo
 * vieta nella zona personale). Un file rifiutato non restituisce mai il testo:
 * va cancellato, e nessuna parte del suo contenuto deve restare.
 *
 * Modulo puro (calcola anche lo sha256).
 */
import { createHash } from "node:crypto";
import type { StorageZone } from "../vocab.ts";
import { parseDelimited } from "./csv.ts";
import { checkTables, findHealthTerms, type CheckedTable, type ColumnFinding, type HeaderCategory } from "./header-check.ts";
import { maskedPreview, type MaskedPreview } from "./mask.ts";
import { readOoxml } from "./ooxml.ts";
import { extractPdfText, type LowTextReason } from "./pdf-text.ts";
import { decodeTextFile, sniffFile, UC_UPLOAD_LIMITS, type UcFileKind } from "./sniff.ts";

export const INSPECT_STATUSES = ["pulito", "rifiutato", "revisione_manuale"] as const;
export type InspectStatus = (typeof INSPECT_STATUSES)[number];

export const REJECT_REASONS = [
  "file_non_ammesso",
  "file_non_leggibile",
  "sanitario",
  "dati_particolari",
  "colonne_vietate",
  "dati_personali",
  "testo_scarso",
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

/** Messaggi per chi ha caricato il file (i rifiuti per tipo usano quelli di sniff, OOXML e PDF). */
export const INSPECT_MESSAGES = {
  sanitario: "Il file contiene dati sanitari e non possiamo tenerlo: l'abbiamo cancellato. Toglili e caricalo di nuovo.",
  dati_particolari:
    "Il file contiene dati che non raccogliamo (religione, origine, orientamento, iscrizione a un sindacato, dati genetici o biometrici): l'abbiamo cancellato. Togli quelle colonne e caricalo di nuovo.",
  colonne_vietate: "Il file contiene colonne che per questa domanda non si raccolgono: l'abbiamo cancellato. Toglile e caricalo di nuovo.",
  dati_personali:
    "Il file contiene dati personali (nomi, email, telefoni, documenti) che qui non possiamo tenere: l'abbiamo cancellato. Usa codici al posto dei nomi e caricalo di nuovo.",
  testo_scarso: "Non riusciamo a leggere il testo di questo PDF e nella zona personale non può restare in attesa: carica un CSV o un XLSX.",
  revisione_manuale: "Non riusciamo a leggere bene il testo di questo PDF: prima di usarlo lo controlla una persona di Lateral Space.",
} as const;

/** `uc_files.scan_findings`: solo etichette del lessico, conteggi e codici. */
export interface ScanFindings {
  categoria?: HeaderCategory;
  /** Colonne con un esito della categoria. */
  colonne?: number;
  /** Etichette del lessico (o dei modelli vietati del template), mai testo del file. */
  termini?: string[];
  /** Termini sanitari trovati nel testo. */
  nel_testo?: number;
  /** Celle riconosciute per tipo di valore personale. */
  valori?: Record<string, number>;
  revisione_manuale?: true;
  motivi_revisione?: LowTextReason[];
  /** Codice del rifiuto per tipo o lettura (es. `tipo_non_coincide`, `pdf_cifrato`). */
  codice?: string;
  avvisi?: string[];
}

export interface InspectOptions {
  /** Zona della voce: `personale` per le classi personali. */
  zone: StorageZone;
  /** Blocco `a8` sciolto (scheda A.8 approvata). I dati personali valgono solo con questo e nella zona personale. */
  a8Resolved: boolean;
  /** `spec.forbidden_columns` della voce più `forbidden_columns_patterns` del template. */
  forbiddenColumns?: readonly string[] | null;
  /** Dimensione massima; predefinita 4 MB nella zona personale (modalità server), 20 MB altrove. */
  maxBytes?: number;
}

export interface InspectReport {
  status: InspectStatus;
  reason: RejectReason | null;
  /** Codice tecnico (sniff, OOXML, PDF) o motivo. */
  code: string | null;
  message: string | null;
  sizeBytes: number;
  sha256: string;
  /** Tipo dal contenuto; null se il file è stato rifiutato prima di riconoscerlo. */
  kind: UcFileKind | null;
  mime: string | null;
  /** Il contenuto è stato letto per intero (falso per i PDF con testo scarso). */
  contentScanned: boolean;
  /** Ci sono colonne o valori personali (anche quando sono ammessi). */
  personalDetected: boolean;
  findings: ScanFindings;
  /** Anteprima mascherata per `uc_files.preview`; null nella zona personale e per i documenti. */
  preview: MaskedPreview | null;
  /** Testo estratto, per la scansione del testo del chiamante. Mai salvato per la zona personale; sempre null per un file rifiutato. */
  extractedText: string | null;
}

function columnCount(findings: readonly ColumnFinding[]): number {
  return new Set(findings.map((f) => `${f.table}:${f.column}`)).size;
}

function terms(findings: readonly ColumnFinding[]): string[] {
  return [...new Set(findings.map((f) => f.term))].sort();
}

/** Controlla un file in quarantena e decide l'esito. */
export function inspectFile(bytes: Uint8Array, fileName: string, options: InspectOptions): InspectReport {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const base = { sizeBytes: bytes.length, sha256 };
  const maxBytes = options.maxBytes ?? (options.zone === "personale" ? UC_UPLOAD_LIMITS.serverMaxBytes : UC_UPLOAD_LIMITS.clientBlobMaxBytes);

  const reject = (
    reason: RejectReason,
    code: string,
    message: string,
    extra: Partial<Pick<InspectReport, "kind" | "mime" | "contentScanned" | "personalDetected">> & { findings?: ScanFindings } = {},
  ): InspectReport => ({
    status: "rifiutato",
    reason,
    code,
    message,
    ...base,
    kind: extra.kind ?? null,
    mime: extra.mime ?? null,
    contentScanned: extra.contentScanned ?? false,
    personalDetected: extra.personalDetected ?? false,
    findings: extra.findings ?? { codice: code },
    preview: null,
    // A rejected file is deleted: its text (health data, names…) is never handed back.
    extractedText: null,
  });

  const sniffed = sniffFile(bytes, fileName, { maxBytes });
  if (!sniffed.ok) return reject("file_non_ammesso", sniffed.code, sniffed.message);
  const { kind, mime } = sniffed.value;
  const known = { kind, mime };

  let text = "";
  let tables: (CheckedTable & { truncated?: boolean })[] = [];
  let lowText: LowTextReason[] = [];
  const warnings: string[] = [];

  switch (kind) {
    case "csv":
    case "tsv":
    case "txt":
    case "md": {
      text = decodeTextFile(bytes, sniffed.value.text!);
      if (sniffed.value.text!.encoding !== "utf-8") warnings.push("codifica_windows_1252");
      if (kind === "csv" || kind === "tsv") {
        const parsed = parseDelimited(text, { kind });
        if (!parsed.ok) return reject("file_non_leggibile", parsed.code, parsed.message, known);
        tables = [{ name: null, rows: parsed.value.rows, truncated: parsed.value.truncated }];
        warnings.push(...parsed.value.warnings);
        if (parsed.value.truncated) warnings.push("tabella_troncata");
      }
      break;
    }
    case "docx":
    case "xlsx":
    case "pptx": {
      const doc = readOoxml(bytes, kind);
      if (!doc.ok) return reject("file_non_leggibile", doc.code, doc.message, known);
      text = doc.value.text;
      tables = doc.value.tables;
      if (doc.value.embedded > 0) warnings.push("documenti_incorporati");
      break;
    }
    case "pdf": {
      const pdf = extractPdfText(bytes);
      if (!pdf.ok) return reject("file_non_leggibile", pdf.code, pdf.message, known);
      text = pdf.value.text;
      lowText = pdf.value.lowText ? pdf.value.reasons : [];
      if (pdf.value.truncated) warnings.push("testo_troncato");
      break;
    }
  }

  const personalAllowed = options.zone === "personale" && options.a8Resolved;
  const check = checkTables(tables, { personalAllowed, forbiddenColumns: options.forbiddenColumns });
  const personalDetected = check.findings.some((f) => f.category === "personale");
  const scanned = { ...known, contentScanned: lowText.length === 0, personalDetected };
  const byCategory = (category: HeaderCategory) => check.blocking.filter((f) => f.category === category);

  const healthColumns = byCategory("sanitario");
  const healthText = findHealthTerms(text);
  if (healthColumns.length > 0 || healthText.length > 0) {
    const termini = [...new Set([...terms(healthColumns), ...healthText.map((h) => h.term)])].sort();
    return reject("sanitario", "sanitario", INSPECT_MESSAGES.sanitario, {
      ...scanned,
      findings: { categoria: "sanitario", colonne: columnCount(healthColumns), termini, nel_testo: healthText.reduce((n, h) => n + h.count, 0) },
    });
  }
  for (const [category, reason] of [
    ["particolare", "dati_particolari"],
    ["vietata", "colonne_vietate"],
  ] as const) {
    const found = byCategory(category);
    if (found.length > 0) {
      return reject(reason, reason, INSPECT_MESSAGES[reason], { ...scanned, findings: { categoria: category, colonne: columnCount(found), termini: terms(found) } });
    }
  }
  const personal = byCategory("personale");
  if (personal.length > 0) {
    const valori: Record<string, number> = {};
    for (const f of personal) if (f.source === "valori") valori[f.term] = (valori[f.term] ?? 0) + (f.count ?? 0);
    return reject("dati_personali", "dati_personali", INSPECT_MESSAGES.dati_personali, {
      ...scanned,
      findings: {
        categoria: "personale",
        colonne: columnCount(personal),
        termini: terms(personal),
        ...(Object.keys(valori).length > 0 ? { valori } : {}),
      },
    });
  }

  if (lowText.length > 0) {
    if (options.zone === "personale") {
      return reject("testo_scarso", "testo_scarso", INSPECT_MESSAGES.testo_scarso, { ...scanned, findings: { revisione_manuale: true, motivi_revisione: lowText } });
    }
    return {
      status: "revisione_manuale",
      reason: null,
      code: "revisione_manuale",
      message: INSPECT_MESSAGES.revisione_manuale,
      ...base,
      ...known,
      contentScanned: false,
      personalDetected,
      findings: { revisione_manuale: true, motivi_revisione: lowText, ...(warnings.length > 0 ? { avvisi: warnings } : {}) },
      preview: null,
      extractedText: text,
    };
  }

  const previewSource = options.zone === "standard" && (kind === "csv" || kind === "tsv" || kind === "xlsx") ? tables.find((t) => t.rows.length > 0) : undefined;
  return {
    status: "pulito",
    reason: null,
    code: null,
    message: null,
    ...base,
    ...known,
    contentScanned: true,
    personalDetected,
    findings: warnings.length > 0 ? { avvisi: warnings } : {},
    preview: previewSource ? maskedPreview(previewSource, { forbiddenColumns: options.forbiddenColumns }) : null,
    extractedText: text,
  };
}
