/**
 * I file che la rotta dell'export scrive in `ai_readiness_exports.export_type`
 * (`src/app/api/ai-readiness/assessments/[assessmentId]/export/route.ts`) e il loro nome in «Impostazioni › File
 * scaricati» (rilascio 10, ondata 7b). Un solo elenco per la rotta e per la pagina: un tipo nuovo ha subito il suo nome.
 * Un tipo che non si conosce (una riga vecchia) prende il nome dal formato, e senza formato un nome neutro: mai la chiave.
 *
 * Modulo puro: import relativi `.ts`.
 */
import { READINESS_TEXT } from "./dashboard-text.ts";

export const AI_READINESS_EXPORT_TYPES = Object.freeze({ pdf: "executive_pdf", excel: "excel_aggregated" } as const);

const S = READINESS_TEXT.settings;

const LABEL: Readonly<Record<string, string>> = Object.freeze({
  [AI_READINESS_EXPORT_TYPES.pdf]: S.exportPdf,
  [AI_READINESS_EXPORT_TYPES.excel]: S.exportExcel,
});

/** Il nome di un file scaricato: «Report in PDF», «Dati in Excel», oppure «File scaricato». */
export function exportTypeLabel(exportType: string): string {
  if (Object.hasOwn(LABEL, exportType)) return LABEL[exportType];
  if (/pdf/i.test(exportType)) return S.exportPdf;
  if (/excel|xlsx/i.test(exportType)) return S.exportExcel;
  return S.exportOther;
}
