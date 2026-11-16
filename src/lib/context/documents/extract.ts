/**
 * Il testo di un file caricato, senza chiamare il modello (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §10.3).
 *
 * Word, Excel e PowerPoint si leggono con il lettore dei dossier (`src/lib/uc/files/ooxml.ts`: zip su zlib con i suoi
 * limiti; `xlsx` non si usa per leggere). Il PDF si legge prima senza modello: è più veloce, non costa, e non manda il
 * documento a un fornitore quando non serve. `lowText` dice quando il testo trovato non basta (una scansione): solo
 * allora, e solo con l'ok ai sub-responsabili, chi chiama può chiedere il testo al modello.
 *
 * Il tipo si riconosce dai primi byte e si confronta con l'estensione (`sniffFile`), mai dal tipo dichiarato dal
 * browser: file vuoti, vecchi formati Office, macro e contenuti che non coincidono si rifiutano con il loro messaggio.
 * Modulo puro.
 */
import { readOoxml } from "../../uc/files/ooxml.ts";
import { extractPdfText } from "../../uc/files/pdf-text.ts";
import { decodeTextFile, sniffFile, type UcFileKind } from "../../uc/files/sniff.ts";
import { cut } from "../normalize.ts";
import { CONTEXT_LIMITS } from "../vocab.ts";

export type ExtractedDocument =
  | { ok: true; text: string; via: "testo" | "office" | "pdf"; lowText: boolean; kind: UcFileKind; mime: string }
  | { ok: false; code: string; message: string }; // i codici e i messaggi di sniff.ts, ooxml.ts e pdf-text.ts

/** Il testo com'è salvato: a capo di un tipo solo, senza byte nulli, al massimo 100.000 caratteri. */
function clean(text: string): string {
  return cut(text.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim(), CONTEXT_LIMITS.documentTextMax);
}

/** Il testo di un file caricato, senza chiamare il modello. Al massimo 100.000 caratteri. */
export function extractDocumentText(bytes: Uint8Array, fileName: string): ExtractedDocument {
  const sniffed = sniffFile(bytes, fileName, { maxBytes: CONTEXT_LIMITS.uploadMaxBytes });
  if (!sniffed.ok) return { ok: false, code: sniffed.code, message: sniffed.message };
  const { kind, mime } = sniffed.value;
  if (kind === "pdf") {
    const pdf = extractPdfText(bytes);
    if (!pdf.ok) return { ok: false, code: pdf.code, message: pdf.message };
    return { ok: true, text: clean(pdf.value.text), via: "pdf", lowText: pdf.value.lowText, kind, mime };
  }
  if (kind === "docx" || kind === "xlsx" || kind === "pptx") {
    const office = readOoxml(bytes, kind);
    if (!office.ok) return { ok: false, code: office.code, message: office.message };
    return { ok: true, text: clean(office.value.text), via: "office", lowText: false, kind, mime };
  }
  // CSV, TSV, TXT, MD: `sniffFile` ha già riconosciuto la codifica (UTF-8 o Windows-1252).
  const encoding = sniffed.value.text;
  if (!encoding) return { ok: false, code: "testo_non_leggibile", message: "Il file di testo non è leggibile: salvalo in UTF-8." };
  return { ok: true, text: clean(decodeTextFile(bytes, encoding)), via: "testo", lowText: false, kind, mime };
}
