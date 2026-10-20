/**
 * Riconoscimento del tipo di file dal contenuto (PIANO §6.3, passo 1).
 *
 * Il tipo dichiarato dal browser non conta: conta ciò che c'è nei byte, e deve
 * coincidere con l'estensione del nome.
 * - PDF: `%PDF-` all'inizio.
 * - DOCX, XLSX, PPTX: zip `PK\x03\x04` con `[Content_Types].xml` e la parte
 *   principale del tipo; controllati con gli stessi limiti del lettore OOXML
 *   (bombe zip, percorsi, cifratura) e senza macro.
 * - CSV, TSV, TXT, MD: testo UTF-8 valido (con o senza BOM), senza byte nulli,
 *   al più 5 MB (il testo si scansiona per intero). Si accetta anche il testo a
 *   8 bit di Windows (CP1252, quello di «Salva come CSV» di Excel), purché quasi
 *   privo di caratteri di controllo [D].
 * - Tutto il resto, compresi i vecchi `.xls`/`.doc`/`.ppt` (contenitore OLE,
 *   anche i file Office protetti da password), si rifiuta.
 *
 * Modulo puro.
 */
import { fail, ok, type Result } from "../types.ts";
import { decodeWindows1252 } from "./charset.ts";
import { fileExtension } from "./filename.ts";
import { ooxmlHasMacros, ooxmlKind, openZip, OOXML_LIMITS, looksLikeZip, type OoxmlKind } from "./ooxml.ts";

const MIB = 1024 * 1024;

export const UC_FILE_TYPES = {
  pdf: { mime: "application/pdf", extensions: ["pdf"] },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extensions: ["docx"] },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extensions: ["xlsx"] },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", extensions: ["pptx"] },
  csv: { mime: "text/csv", extensions: ["csv"] },
  tsv: { mime: "text/tab-separated-values", extensions: ["tsv"] },
  txt: { mime: "text/plain", extensions: ["txt"] },
  md: { mime: "text/markdown", extensions: ["md", "markdown"] },
} as const;
export type UcFileKind = keyof typeof UC_FILE_TYPES;

export const UC_FILE_KINDS = Object.keys(UC_FILE_TYPES) as UcFileKind[];
export const TEXT_FILE_KINDS = ["csv", "tsv", "txt", "md"] as const satisfies readonly UcFileKind[];
export type TextFileKind = (typeof TEXT_FILE_KINDS)[number];

/** Tipi ammessi al caricamento (es. `allowedContentTypes` del token Blob). */
export const UC_ALLOWED_UPLOAD_MIME_TYPES: readonly string[] = Object.freeze([...new Set(UC_FILE_KINDS.map((k) => UC_FILE_TYPES[k].mime))]);

/** Limiti di caricamento (PIANO §6.2–6.3). */
export const UC_UPLOAD_LIMITS = Object.freeze({
  /** Modalità client-Blob (zona standard). */
  clientBlobMaxBytes: 20 * MIB,
  /** Modalità server, obbligatoria per la zona personale. */
  serverMaxBytes: 4 * MIB,
  /** Testo (CSV, TSV, TXT, MD) scansionato per intero: oltre non si accetta. */
  textScanMaxBytes: 5 * MIB,
});

export const SNIFF_MESSAGES = {
  file_vuoto: "Il file è vuoto.",
  file_troppo_grande: "Il file è troppo grande.",
  estensione_non_ammessa: "Questo tipo di file non è ammesso. Carica un PDF, un file Word (.docx), Excel (.xlsx) o PowerPoint (.pptx), un CSV, un TXT o un MD.",
  tipo_non_coincide: "Il contenuto del file non corrisponde alla sua estensione.",
  formato_office_vecchio: "I file .xls, .doc e .ppt e i file Office protetti da password non sono ammessi: salvalo come .xlsx, .docx o .pptx senza password.",
  testo_non_leggibile: "Il file di testo non è leggibile: salvalo in UTF-8.",
  macro_non_ammesse: "Il file contiene macro: salvalo senza macro (.xlsx, .docx o .pptx).",
} as const;
export type SniffErrorCode = keyof typeof SNIFF_MESSAGES;

function failWith<T>(code: SniffErrorCode, message: string = SNIFF_MESSAGES[code]): Result<T> {
  return fail(code, message);
}

export type TextEncoding = "utf-8" | "windows-1252";

export interface SniffedFile {
  kind: UcFileKind;
  /** MIME dal contenuto (mai quello dichiarato dal client). */
  mime: string;
  extension: string;
  /** Solo per i file di testo. */
  text?: { encoding: TextEncoding; bom: boolean };
}

/** Tipo atteso dall'estensione del nome, oppure null se non è ammessa. */
export function kindFromFileName(name: string): UcFileKind | null {
  const ext = fileExtension(name);
  if (!ext) return null;
  for (const kind of UC_FILE_KINDS) if ((UC_FILE_TYPES[kind].extensions as readonly string[]).includes(ext)) return kind;
  return null;
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((b, i) => bytes[i] === b);
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const UTF8_BOM = [0xef, 0xbb, 0xbf];
/** Altri formati binari comuni: mai ammessi, qualunque sia l'estensione. */
const OTHER_BINARY_MAGIC: readonly (readonly number[])[] = [
  [0x89, 0x50, 0x4e, 0x47], // PNG
  [0xff, 0xd8, 0xff], // JPEG
  [0x47, 0x49, 0x46, 0x38], // GIF8
  [0x1f, 0x8b], // gzip
  [0x37, 0x7a, 0xbc, 0xaf], // 7z
  [0x52, 0x61, 0x72, 0x21], // Rar!
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0x50, 0x4b, 0x05, 0x06], // empty zip
  [0x50, 0x4b, 0x07, 0x08], // spanned zip
];

/** Bytes di Windows-1252 senza carattere assegnato. */
const CP1252_UNDEFINED = new Set([0x81, 0x8d, 0x8f, 0x90, 0x9d]);

/** Massima quota di caratteri di controllo in un file di testo. */
const MAX_CONTROL_RATIO = 0.01;

function isControl(byte: number): boolean {
  return (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x0c) || byte === 0x7f;
}

/**
 * Codifica di un file di testo, oppure null se non è testo. Un BOM UTF-16 o
 * un byte nullo: non è testo che sappiamo leggere.
 */
export function detectTextEncoding(bytes: Uint8Array): { encoding: TextEncoding; bom: boolean } | null {
  if (startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff])) return null;
  if (bytes.includes(0)) return null;
  const bom = startsWith(bytes, UTF8_BOM);
  const body = bom ? bytes.subarray(3) : bytes;
  let controls = 0;
  for (let i = 0; i < body.length; i++) if (isControl(body[i])) controls++;
  if (body.length > 0 && controls / body.length > MAX_CONTROL_RATIO) return null;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(body);
    return { encoding: "utf-8", bom };
  } catch {
    if (bom) return null;
  }
  let undefinedBytes = 0;
  for (let i = 0; i < body.length; i++) if (CP1252_UNDEFINED.has(body[i])) undefinedBytes++;
  if ((controls + undefinedBytes) / body.length > MAX_CONTROL_RATIO) return null;
  return { encoding: "windows-1252", bom: false };
}

/** Testo di un file già riconosciuto, senza BOM e con gli a capo normalizzati a `\n`. */
export function decodeTextFile(bytes: Uint8Array, text: { encoding: TextEncoding; bom: boolean }): string {
  const body = text.bom ? bytes.subarray(3) : bytes;
  const decoded = text.encoding === "utf-8" ? new TextDecoder("utf-8").decode(body) : decodeWindows1252(body);
  return decoded.replace(/\r\n?/g, "\n");
}

/**
 * Riconosce il file e lo confronta con l'estensione. Rifiuta file vuoti,
 * troppo grandi, estensioni non ammesse, contenuti che non coincidono, vecchi
 * formati Office, zip non sicuri e documenti con macro.
 */
export function sniffFile(bytes: Uint8Array, fileName: string, options: { maxBytes?: number } = {}): Result<SniffedFile> {
  const maxBytes = options.maxBytes ?? UC_UPLOAD_LIMITS.clientBlobMaxBytes;
  if (bytes.length === 0) return failWith("file_vuoto");
  if (bytes.length > maxBytes) {
    return failWith("file_troppo_grande", `Il file supera il limite di ${Math.floor(maxBytes / MIB)} MB.`);
  }
  const expected = kindFromFileName(fileName);
  const extension = fileExtension(fileName);
  if (!expected || !extension) return failWith("estensione_non_ammessa");
  const mismatch = () => failWith<SniffedFile>("tipo_non_coincide");
  const found = (kind: UcFileKind, text?: SniffedFile["text"]): Result<SniffedFile> =>
    kind === expected ? ok({ kind, mime: UC_FILE_TYPES[kind].mime, extension, ...(text ? { text } : {}) }) : mismatch();

  if (startsWith(bytes, PDF_MAGIC)) return found("pdf");
  if (startsWith(bytes, OLE_MAGIC)) return failWith("formato_office_vecchio");
  if (OTHER_BINARY_MAGIC.some((magic) => startsWith(bytes, magic))) return mismatch();
  if (looksLikeZip(bytes)) {
    if (!["docx", "xlsx", "pptx"].includes(expected)) return mismatch();
    const archive = openZip(bytes, OOXML_LIMITS);
    if (!archive.ok) return archive;
    const kind: OoxmlKind | null = ooxmlKind(archive.value);
    if (!kind) return mismatch();
    const macros = ooxmlHasMacros(archive.value);
    if (!macros.ok) return macros;
    if (macros.value) return failWith("macro_non_ammesse");
    return found(kind);
  }
  const text = detectTextEncoding(bytes);
  if (!text) return (TEXT_FILE_KINDS as readonly string[]).includes(expected) ? failWith("testo_non_leggibile") : mismatch();
  if (!(TEXT_FILE_KINDS as readonly string[]).includes(expected)) return mismatch();
  // Text is scanned in full: beyond 5 MB it is not accepted.
  if (bytes.length > UC_UPLOAD_LIMITS.textScanMaxBytes) {
    return failWith("file_troppo_grande", `Il file di testo supera il limite di ${Math.floor(UC_UPLOAD_LIMITS.textScanMaxBytes / MIB)} MB: dividilo in file più piccoli.`);
  }
  return found(expected, text);
}
