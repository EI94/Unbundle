/**
 * File dell'export del catalogo (PIANO §5.9): JSON (la fotografia), Markdown
 * (dizionario dati e catalogo, `catalogToMarkdown`) ed Excel (`catalogToSheets`
 * scritto con `xlsx`, come `portfolio/export/route.ts`).
 *
 * - `parseStoredSnapshot`: legge una fotografia congelata da `uc_catalog_versions`
 *   e controlla che sia proprio quella del caso chiesto.
 * - `withoutPersonalValues`: difesa in profondità. La fotografia nasce già senza
 *   valori personali o sanitari (`buildCatalogSnapshot`), ma l'export li toglie
 *   di nuovo prima di uscire: un valore personale non esce mai da qui.
 * - `renderCatalogExport`: il file pronto per la risposta.
 * - `encodeForTransfer`: gzip per il trasporto, se il browser lo accetta.
 *
 * La fotografia arriva già filtrata per il ruolo (`snapshotForViewer`): qui non
 * si decide chi vede cosa. Modulo puro (solo `xlsx` per scrivere il foglio).
 */
import { gzipSync } from "node:zlib";
import * as XLSX from "xlsx";
import { CATALOG_SNAPSHOT_SCHEMA, isPersonalClass, type CatalogSnapshot, type SnapshotItem } from "../snapshot.ts";
import { fail, ok, type Result } from "../types.ts";
import { PRIVACY_CLASSES, isVocab } from "../vocab.ts";
import { catalogToMarkdown } from "./markdown.ts";
import { EXPORT_CONTENT_TYPES, exportFileName, type ExportFormat } from "./request.ts";
import { catalogToSheets, type CatalogSheet } from "./sheets.ts";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Una classe sconosciuta si tratta come personale: meglio un valore nascosto che uno di troppo. */
function personalOrUnknown(privacyClass: unknown): boolean {
  return !isVocab(PRIVACY_CLASSES, privacyClass) || isPersonalClass(privacyClass);
}

/** Copia della fotografia senza alcun valore delle classi personali e sanitarie. */
export function withoutPersonalValues(snapshot: CatalogSnapshot): CatalogSnapshot {
  return {
    ...snapshot,
    items: snapshot.items.map((item): SnapshotItem => {
      if (!item.answer || !personalOrUnknown(item.privacy_class)) return item;
      return { ...item, answer: { ...item.answer, value: null, value_normalized: null, value_hidden: "personale" } };
    }),
  };
}

const STORED_ERROR = "La versione salvata del catalogo non si legge. Avvisa Lateral Space.";

/**
 * Fotografia congelata letta dal DB (`uc_catalog_versions.snapshot`). Deve
 * essere del formato `unbundle.uc-catalog/1`, della versione chiesta e dello
 * stesso caso e workspace (una riga di un altro caso non esce mai).
 */
export function parseStoredSnapshot(raw: unknown, expect: { caseId: string; workspaceId: string; version: number }): Result<CatalogSnapshot> {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return fail("versione_illeggibile", STORED_ERROR);
    }
  }
  if (!isObject(value) || value.schema !== CATALOG_SNAPSHOT_SCHEMA) return fail("versione_illeggibile", STORED_ERROR);
  const c = value.case;
  if (!isObject(c) || c.id !== expect.caseId || c.workspace_id !== expect.workspaceId) return fail("versione_illeggibile", STORED_ERROR);
  if (value.version !== expect.version || typeof value.frozen_at !== "string") return fail("versione_illeggibile", STORED_ERROR);
  if (!Array.isArray(value.items) || !Array.isArray(value.links) || !isObject(value.template) || !isObject(value.counts)) {
    return fail("versione_illeggibile", STORED_ERROR);
  }
  for (const item of value.items) {
    if (!isObject(item) || typeof item.key !== "string" || typeof item.kind !== "string" || typeof item.status !== "string" || !isObject(item.spec ?? {})) {
      return fail("versione_illeggibile", STORED_ERROR);
    }
    if (item.answer !== null && item.answer !== undefined && !isObject(item.answer)) return fail("versione_illeggibile", STORED_ERROR);
  }
  return ok(withoutPersonalValues(value as unknown as CatalogSnapshot));
}

/** Fogli → file Excel (`XLSX.write` con `type: "buffer"`). Le celle sono già protette da `sheetText`. */
export function sheetsToXlsx(sheets: readonly CatalogSheet[]): Uint8Array {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sheet.rows), sheet.name);
  }
  const out = XLSX.write(workbook, { bookType: "xlsx", type: "buffer", compression: true }) as Uint8Array;
  return new Uint8Array(out);
}

export interface RenderedExport {
  body: Uint8Array;
  contentType: string;
  fileName: string;
}

/** Sotto questa soglia non conviene comprimere. */
const GZIP_MIN_BYTES = 32 * 1024;

/**
 * Compressione gzip per il trasporto quando il browser la accetta. Il JSON di
 * un catalogo grande (migliaia di voci con i testi) supera facilmente il limite
 * di 4,5 MB delle risposte di una funzione Vercel; compresso resta sotto il
 * megabyte. Il browser lo decomprime da solo: il file salvato è quello originale.
 * L'Excel è già compresso e resta com'è.
 */
export function encodeForTransfer(file: RenderedExport, acceptEncoding: string | null): { body: Uint8Array; contentEncoding: "gzip" | null } {
  const accepts = (acceptEncoding ?? "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .some((part) => part === "gzip" || (part.startsWith("gzip;") && !/;\s*q=0(\.0*)?$/.test(part)));
  if (!accepts || file.body.byteLength < GZIP_MIN_BYTES || file.contentType === EXPORT_CONTENT_TYPES.xlsx) {
    return { body: file.body, contentEncoding: null };
  }
  return { body: new Uint8Array(gzipSync(file.body)), contentEncoding: "gzip" };
}

/** Il file dell'export. La bozza (`version: "bozza"`) segna «non validata» ogni voce non a posto. */
export function renderCatalogExport(snapshot: CatalogSnapshot, format: ExportFormat): RenderedExport {
  const safe = withoutPersonalValues(snapshot);
  const draft = safe.version === "bozza";
  const fileName = exportFileName(safe.case.code, safe.version, format);
  const contentType = EXPORT_CONTENT_TYPES[format];
  if (format === "xlsx") return { body: sheetsToXlsx(catalogToSheets(safe, { draft })), contentType, fileName };
  const text = format === "md" ? catalogToMarkdown(safe, { draft }) : `${JSON.stringify(safe, null, 2)}\n`;
  return { body: new TextEncoder().encode(text), contentType, fileName };
}
