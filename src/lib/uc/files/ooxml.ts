/**
 * Lettore minimo di file Office (XLSX, DOCX, PPTX), scritto in casa (PIANO §6.3 [D]).
 *
 * I file caricati dai referenti non sono fidati: niente parser xlsx di terze
 * parti su questi input. Qui si legge solo ciò che serve ai controlli:
 *
 * - zip dalla **directory centrale** (mai dalle testate locali), con
 *   `zlib.inflateRawSync` e limiti: ≤ 2.000 voci, ≤ 50 MB decompressi in
 *   tutto, rapporto di compressione ≤ 100 (oltre 1 MB), niente zip64, niente
 *   cifratura, niente percorsi con `..`, assoluti o con `\`, niente nomi
 *   doppi, niente voci sovrapposte; CRC e dimensioni verificati;
 * - XML con un lettore a eventi senza DTD (un `<!DOCTYPE` rifiuta il file) e
 *   senza espansione di entità personalizzate;
 * - XLSX: stringhe condivise e **tutti** i fogli nell'ordine del workbook
 *   (griglia), più commenti e grafici; DOCX: corpo, intestazioni, piè di
 *   pagina, note, commenti e testo cancellato con revisioni, tabelle come
 *   griglie; PPTX: diapositive, note, commenti, tabelle;
 * - documenti Office incorporati (es. i dati di un grafico) letti un livello
 *   sotto, con lo stesso budget; altri oggetti incorporati rifiutano il file,
 *   perché non si possono controllare.
 *
 * Modulo puro.
 */
import { inflateRawSync } from "node:zlib";
import { fail, ok, type Result } from "../types.ts";

// ── Limiti ────────────────────────────────────────────────────────────

const MIB = 1024 * 1024;

export interface ZipLimits {
  maxEntries: number;
  maxTotalUncompressedBytes: number;
  maxRatio: number;
  /** Il rapporto si controlla solo sopra questa dimensione: un file piccolo non è una bomba. */
  ratioCheckFromBytes: number;
}

export const ZIP_LIMITS: Readonly<ZipLimits> = Object.freeze({
  maxEntries: 2000,
  maxTotalUncompressedBytes: 50 * MIB,
  maxRatio: 100,
  ratioCheckFromBytes: 1 * MIB,
});

export interface OoxmlLimits extends ZipLimits {
  /** Celle materializzate in tutti i fogli. */
  maxCells: number;
  maxSheets: number;
  /** Colonne per riga (XFD = 16.384). */
  maxColumns: number;
  /** Documenti Office incorporati letti in tutto il file. */
  maxEmbedded: number;
}

export const OOXML_LIMITS: Readonly<OoxmlLimits> = Object.freeze({
  ...ZIP_LIMITS,
  maxCells: 2_000_000,
  maxSheets: 200,
  maxColumns: 16_384,
  maxEmbedded: 20,
});

export const OOXML_MESSAGES = {
  zip_non_valido: "Il file è danneggiato o non è un documento Office valido.",
  zip64_non_ammesso: "Il file è troppo grande o in un formato zip non ammesso.",
  zip_cifrato: "Il file è protetto da password: caricalo senza protezione.",
  zip_troppe_voci: "Il file contiene troppe parti per essere controllato.",
  zip_troppo_grande: "Il file decompresso supera i 50 MB: dividilo in file più piccoli.",
  zip_bomba: "Il file ha un rapporto di compressione anomalo e non possiamo controllarlo.",
  zip_percorso_non_valido: "Il file contiene percorsi interni non ammessi.",
  ooxml_non_valido: "Il documento Office non è leggibile.",
  ooxml_tipo_sconosciuto: "Il file non è un documento Word, Excel o PowerPoint valido.",
  oggetto_incorporato: "Il file contiene oggetti incorporati che non possiamo controllare: salvalo senza.",
  macro_non_ammesse: "Il file contiene macro: salvalo senza macro (.xlsx, .docx o .pptx).",
  foglio_troppo_grande: "Il foglio di calcolo è troppo grande per essere controllato: dividilo in file più piccoli.",
} as const;
export type OoxmlErrorCode = keyof typeof OOXML_MESSAGES;

function failWith<T>(code: OoxmlErrorCode): Result<T> {
  return fail(code, OOXML_MESSAGES[code]);
}

class OoxmlError extends Error {
  readonly code: OoxmlErrorCode;
  constructor(code: OoxmlErrorCode) {
    super(code);
    this.code = code;
  }
}

// ── CRC-32 ────────────────────────────────────────────────────────────

let crcTable: Uint32Array | null = null;

/** CRC-32 (IEEE 802.3), come nello zip. */
export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ── Zip ───────────────────────────────────────────────────────────────

export interface ZipEntry {
  readonly name: string;
  readonly method: 0 | 8;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
  readonly isDirectory: boolean;
}

export interface ZipArchive {
  readonly entries: readonly ZipEntry[];
  /** Per nome in minuscolo (i nomi delle parti OPC non distinguono maiuscole). */
  readonly byName: ReadonlyMap<string, ZipEntry>;
  readonly totalUncompressedBytes: number;
  readonly bytes: Buffer;
}

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

function asBuffer(bytes: Uint8Array): Buffer {
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Vero se i byte iniziano con la testata locale di uno zip (`PK\x03\x04`). */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function safeEntryName(name: string): boolean {
  if (!name || name.length > 1024) return false;
  if (name.includes("\\") || name.includes("\0") || name.startsWith("/") || /^[A-Za-z]:/.test(name)) return false;
  if (/[\u0000-\u001f\u007f]/.test(name)) return false;
  const segments = name.replace(/\/$/, "").split("/");
  return segments.every((s) => s !== ".." && s !== "." && s !== "");
}

/**
 * Apre uno zip dalla directory centrale, con i limiti. Non decomprime nulla:
 * controlla solo struttura, nomi e dimensioni dichiarate.
 */
export function openZip(input: Uint8Array, limits: ZipLimits = ZIP_LIMITS): Result<ZipArchive> {
  const bytes = asBuffer(input);
  if (bytes.length < 22 || !looksLikeZip(bytes)) return failWith("zip_non_valido");
  let eocd = -1;
  const stop = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= stop; i--) {
    if (bytes.readUInt32LE(i) === SIG_EOCD && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return failWith("zip_non_valido");
  if (eocd >= 20 && bytes.readUInt32LE(eocd - 20) === SIG_ZIP64_LOCATOR) return failWith("zip64_non_ammesso");
  const diskNumber = bytes.readUInt16LE(eocd + 4);
  const cdDisk = bytes.readUInt16LE(eocd + 6);
  const entriesOnDisk = bytes.readUInt16LE(eocd + 8);
  const totalEntries = bytes.readUInt16LE(eocd + 10);
  const cdSize = bytes.readUInt32LE(eocd + 12);
  const cdOffset = bytes.readUInt32LE(eocd + 16);
  if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return failWith("zip64_non_ammesso");
  if (diskNumber !== 0 || cdDisk !== 0 || entriesOnDisk !== totalEntries) return failWith("zip_non_valido");
  if (totalEntries === 0) return failWith("zip_non_valido");
  if (totalEntries > limits.maxEntries) return failWith("zip_troppe_voci");
  if (cdOffset + cdSize > eocd) return failWith("zip_non_valido");

  const entries: ZipEntry[] = [];
  const byName = new Map<string, ZipEntry>();
  let pos = cdOffset;
  let totalUncompressed = 0;
  let totalCompressed = 0;
  for (let n = 0; n < totalEntries; n++) {
    if (pos + 46 > cdOffset + cdSize || bytes.readUInt32LE(pos) !== SIG_CENTRAL) return failWith("zip_non_valido");
    const flags = bytes.readUInt16LE(pos + 8);
    const method = bytes.readUInt16LE(pos + 10);
    const crc = bytes.readUInt32LE(pos + 16);
    const compressedSize = bytes.readUInt32LE(pos + 20);
    const uncompressedSize = bytes.readUInt32LE(pos + 24);
    const nameLength = bytes.readUInt16LE(pos + 28);
    const extraLength = bytes.readUInt16LE(pos + 30);
    const commentLength = bytes.readUInt16LE(pos + 32);
    const diskStart = bytes.readUInt16LE(pos + 34);
    const localHeaderOffset = bytes.readUInt32LE(pos + 42);
    const end = pos + 46 + nameLength + extraLength + commentLength;
    if (end > cdOffset + cdSize) return failWith("zip_non_valido");
    if (flags & 0x0001 || flags & 0x0040 || flags & 0x2000) return failWith("zip_cifrato");
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      return failWith("zip64_non_ammesso");
    }
    if (diskStart !== 0) return failWith("zip_non_valido");
    if (method !== 0 && method !== 8) return failWith("zip_non_valido");
    if (method === 0 && compressedSize !== uncompressedSize) return failWith("zip_non_valido");
    const rawName = bytes.subarray(pos + 46, pos + 46 + nameLength);
    const name = flags & 0x0800 ? rawName.toString("utf8") : rawName.toString("latin1");
    if (!safeEntryName(name)) return failWith("zip_percorso_non_valido");
    const key = name.toLowerCase();
    if (byName.has(key)) return failWith("zip_percorso_non_valido");
    if (
      uncompressedSize > limits.ratioCheckFromBytes &&
      (compressedSize === 0 || uncompressedSize / compressedSize > limits.maxRatio)
    ) {
      return failWith("zip_bomba");
    }
    totalUncompressed += uncompressedSize;
    totalCompressed += compressedSize;
    if (totalUncompressed > limits.maxTotalUncompressedBytes) return failWith("zip_troppo_grande");
    const entry: ZipEntry = Object.freeze({
      name,
      method: method as 0 | 8,
      crc32: crc,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      isDirectory: name.endsWith("/"),
    });
    entries.push(entry);
    byName.set(key, entry);
    pos = end;
  }
  if (pos !== cdOffset + cdSize) return failWith("zip_non_valido");
  if (totalUncompressed > limits.ratioCheckFromBytes && totalUncompressed / Math.max(totalCompressed, 1) > limits.maxRatio) {
    return failWith("zip_bomba");
  }

  // Local headers must exist, match the central directory and never overlap.
  const ranges: [number, number][] = [];
  for (const entry of entries) {
    const at = entry.localHeaderOffset;
    if (at + 30 > cdOffset || bytes.readUInt32LE(at) !== SIG_LOCAL) return failWith("zip_non_valido");
    const localNameLength = bytes.readUInt16LE(at + 26);
    const localExtraLength = bytes.readUInt16LE(at + 28);
    const localName = bytes.subarray(at + 30, at + 30 + localNameLength);
    const centralName = Buffer.from(entry.name, bytes.readUInt16LE(at + 6) & 0x0800 ? "utf8" : "latin1");
    if (!localName.equals(centralName)) return failWith("zip_non_valido");
    const dataEnd = at + 30 + localNameLength + localExtraLength + entry.compressedSize;
    if (dataEnd > cdOffset) return failWith("zip_non_valido");
    ranges.push([at, dataEnd]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++) if (ranges[i][0] < ranges[i - 1][1]) return failWith("zip_non_valido");

  return ok(Object.freeze({ entries: Object.freeze(entries), byName, totalUncompressedBytes: totalUncompressed, bytes }));
}

/** Voce per nome, senza distinguere maiuscole. */
export function zipEntry(archive: ZipArchive, name: string): ZipEntry | null {
  return archive.byName.get(name.toLowerCase()) ?? null;
}

/**
 * Decomprime una voce. L'uscita non può superare la dimensione dichiarata
 * (`maxOutputLength`); poi si verificano lunghezza e CRC.
 */
export function readZipEntry(archive: ZipArchive, entry: ZipEntry): Result<Buffer> {
  const bytes = archive.bytes;
  const at = entry.localHeaderOffset;
  const start = at + 30 + bytes.readUInt16LE(at + 26) + bytes.readUInt16LE(at + 28);
  const data = bytes.subarray(start, start + entry.compressedSize);
  let out: Buffer;
  if (entry.method === 0) {
    out = Buffer.from(data);
  } else {
    try {
      out = inflateRawSync(data, { maxOutputLength: Math.max(entry.uncompressedSize, 1) });
    } catch {
      return failWith("zip_non_valido");
    }
  }
  if (out.length !== entry.uncompressedSize || crc32(out) !== entry.crc32) return failWith("zip_non_valido");
  return ok(out);
}

// ── XML ───────────────────────────────────────────────────────────────

interface XmlVisitor {
  open?(name: string, rawAttrs: string, selfClosing: boolean): void;
  close?(name: string): void;
  text?(text: string): void;
}

const ENTITY = /&(lt|gt|amp|quot|apos|#\d{1,7}|#x[0-9a-fA-F]{1,6});/g;

/** Decodifica le entità XML predefinite e numeriche. Le altre restano come sono. */
export function decodeXmlEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(ENTITY, (_, entity: string) => {
    switch (entity) {
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "amp":
        return "&";
      case "quot":
        return '"';
      case "apos":
        return "'";
    }
    const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    if (!Number.isFinite(code) || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "�";
    return String.fromCodePoint(code);
  });
}

function localName(qname: string): string {
  const colon = qname.indexOf(":");
  return colon >= 0 ? qname.slice(colon + 1) : qname;
}

/** Attributi di un tag come coppie [nome qualificato, valore decodificato]. */
function parseAttrs(raw: string): [string, string][] {
  const out: [string, string][] = [];
  const re = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) out.push([match[1], decodeXmlEntities(match[2] ?? match[3] ?? "")]);
  return out;
}

function attr(raw: string, name: string): string | null {
  for (const [qname, value] of parseAttrs(raw)) if (qname === name || localName(qname) === name) return value;
  return null;
}

/** Attributo con prefisso di namespace e nome locale `local` (es. `r:id`). */
function prefixedAttr(raw: string, local: string): string | null {
  for (const [qname, value] of parseAttrs(raw)) if (qname.includes(":") && localName(qname) === local) return value;
  return null;
}

/**
 * Lettore XML a eventi, senza DTD. Commenti e istruzioni di elaborazione si
 * saltano; `CDATA` diventa testo; un `<!DOCTYPE` lancia (nessun documento
 * Office ne ha bisogno, e così niente entità personalizzate).
 */
function walkXml(xml: string, visitor: XmlVisitor): void {
  const length = xml.length;
  let i = 0;
  while (i < length) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) {
      visitor.text?.(decodeXmlEntities(xml.slice(i)));
      return;
    }
    if (lt > i) visitor.text?.(decodeXmlEntities(xml.slice(i, lt)));
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4);
      if (end < 0) throw new OoxmlError("ooxml_non_valido");
      i = end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt + 9);
      if (end < 0) throw new OoxmlError("ooxml_non_valido");
      visitor.text?.(xml.slice(lt + 9, end));
      i = end + 3;
      continue;
    }
    if (xml.startsWith("<?", lt)) {
      const end = xml.indexOf("?>", lt + 2);
      if (end < 0) throw new OoxmlError("ooxml_non_valido");
      i = end + 2;
      continue;
    }
    if (xml.startsWith("<!", lt)) throw new OoxmlError("ooxml_non_valido");
    // Find the end of the tag, skipping quoted attribute values.
    let j = lt + 1;
    let quote = "";
    for (; j < length; j++) {
      const ch = xml[j];
      if (quote) {
        if (ch === quote) quote = "";
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ">") {
        break;
      }
    }
    if (j >= length) throw new OoxmlError("ooxml_non_valido");
    const inner = xml.slice(lt + 1, j);
    i = j + 1;
    if (inner.startsWith("/")) {
      visitor.close?.(localName(inner.slice(1).trim()));
      continue;
    }
    const selfClosing = inner.endsWith("/");
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const space = body.search(/\s/);
    const qname = space < 0 ? body : body.slice(0, space);
    if (!qname) throw new OoxmlError("ooxml_non_valido");
    // A self-closing element gets only `open(…, true)`: no `close`.
    visitor.open?.(localName(qname), space < 0 ? "" : body.slice(space), selfClosing);
  }
}

/** Testo di una parte XML con codifica dichiarata dal BOM (UTF-8 di base). */
function decodeXmlBytes(bytes: Buffer): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString("utf16le");
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.from(bytes.subarray(2));
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return bytes.subarray(3).toString("utf8");
  return bytes.toString("utf8");
}

/**
 * Valori di attributo che possono essere testo dell'utente: almeno una lettera,
 * niente dichiarazioni di namespace, URL o identificativi di relazione.
 */
function textAttributes(raw: string): string[] {
  const out: string[] = [];
  for (const [qname, value] of parseAttrs(raw)) {
    if (qname === "xmlns" || qname.startsWith("xmlns:")) continue;
    const v = value.trim();
    if (!v || !/\p{L}/u.test(v) || /^[a-z][a-z0-9+.-]*:\/\//i.test(v) || /^rId\d+$/.test(v)) continue;
    out.push(v);
  }
  return out;
}

/**
 * Tutto il testo di una parte XML (commenti, grafici, cache delle tabelle
 * pivot…). Con `attributes` anche i valori degli attributi: le cache pivot
 * tengono i valori in `<s v="…">` e i nomi dei campi in `<cacheField name="…">`.
 */
function allText(xml: string, attributes = false): string {
  const parts: string[] = [];
  walkXml(xml, {
    open: attributes
      ? (_name, raw) => {
          if (raw) parts.push(...textAttributes(raw));
        }
      : undefined,
    text: (t) => {
      if (t.trim()) parts.push(t.trim());
    },
  });
  return parts.join(" ");
}

/** Elementi di un foglio, fuori dalle celle, con testo dell'utente: formule, convalide, intestazioni e piè di pagina. */
const SHEET_TEXT_ELEMENTS = new Set(["f", "formula", "formula1", "formula2", "oddHeader", "oddFooter", "evenHeader", "evenFooter", "firstHeader", "firstFooter"]);
/** Attributi di testo di convalide e collegamenti (messaggi, descrizioni). */
const SHEET_TEXT_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  dataValidation: ["prompt", "promptTitle", "error", "errorTitle"],
  hyperlink: ["display", "tooltip"],
};

/** Testo di un foglio che non sta nelle celle (le celle le legge `sheetGrid`). */
function sheetExtras(xml: string): string[] {
  const out: string[] = [];
  let capture = 0;
  walkXml(xml, {
    open(name, raw, selfClosing) {
      const names = SHEET_TEXT_ATTRIBUTES[name];
      if (names) for (const n of names) {
        const v = attr(raw, n);
        if (v && v.trim()) out.push(v.trim());
      }
      if (!selfClosing && SHEET_TEXT_ELEMENTS.has(name)) capture++;
    },
    close(name) {
      if (SHEET_TEXT_ELEMENTS.has(name)) capture = Math.max(0, capture - 1);
    },
    text(t) {
      if (capture > 0 && t.trim()) out.push(t.trim());
    },
  });
  return out;
}

// ── Documento estratto ────────────────────────────────────────────────

export const OOXML_KINDS = ["docx", "xlsx", "pptx"] as const;
export type OoxmlKind = (typeof OOXML_KINDS)[number];

export interface ExtractedTable {
  /** Nome del foglio (XLSX) oppure «Tabella n» (DOCX, PPTX). */
  name: string;
  rows: string[][];
}

export interface OoxmlDocument {
  kind: OoxmlKind;
  /** Tutto il testo, per la scansione: celle, paragrafi, commenti, grafici, nomi dei fogli. */
  text: string;
  /** XLSX: un foglio per tabella, nell'ordine del workbook. DOCX e PPTX: le tabelle. */
  tables: ExtractedTable[];
  /** Documenti Office incorporati letti (un livello). */
  embedded: number;
}

/** Tipo del documento Office dalle parti principali, oppure null. */
export function ooxmlKind(archive: ZipArchive): OoxmlKind | null {
  if (!zipEntry(archive, "[Content_Types].xml")) return null;
  const kinds: OoxmlKind[] = [];
  if (zipEntry(archive, "word/document.xml")) kinds.push("docx");
  if (zipEntry(archive, "xl/workbook.xml")) kinds.push("xlsx");
  if (zipEntry(archive, "ppt/presentation.xml")) kinds.push("pptx");
  return kinds.length === 1 ? kinds[0] : null;
}

/** Nomi delle parti che contengono macro o tipi di contenuto con macro. */
export function ooxmlHasMacros(archive: ZipArchive): Result<boolean> {
  if (archive.entries.some((e) => /(^|\/)vbaproject\.bin$/i.test(e.name) || /(^|\/)vbadata\.xml$/i.test(e.name))) return ok(true);
  const types = zipEntry(archive, "[Content_Types].xml");
  if (!types) return failWith("ooxml_tipo_sconosciuto");
  const read = readZipEntry(archive, types);
  if (!read.ok) return read;
  try {
    let macro = false;
    walkXml(decodeXmlBytes(read.value), {
      open(_name, raw) {
        const contentType = attr(raw, "ContentType");
        if (contentType && /macroEnabled|vbaProject|vba\b/i.test(contentType)) macro = true;
      },
    });
    return ok(macro);
  } catch (error) {
    if (error instanceof OoxmlError) return failWith(error.code);
    throw error;
  }
}

/**
 * Budget condiviso da tutto il file, documenti incorporati compresi: celle
 * materializzate, byte decompressi (≤ `maxTotalUncompressedBytes`, 50 MB in
 * tutto e non per documento) e documenti incorporati letti.
 */
interface Budget {
  cells: number;
  inflatedBytes: number;
  embedded: number;
}

function newBudget(): Budget {
  return { cells: 0, inflatedBytes: 0, embedded: 0 };
}

/** Conta i byte decompressi; oltre il limite del file intero il controllo si ferma. */
function chargeInflated(budget: Budget, bytes: number, limits: OoxmlLimits): void {
  budget.inflatedBytes += bytes;
  if (budget.inflatedBytes > limits.maxTotalUncompressedBytes) throw new OoxmlError("zip_troppo_grande");
}

/** Archivio in lettura: ricorda le parti già lette, per il recupero del testo restante. */
interface Reader {
  archive: ZipArchive;
  read: Set<string>;
  budget: Budget;
  limits: OoxmlLimits;
}

function readPart(reader: Reader, name: string): string | null {
  const entry = zipEntry(reader.archive, name);
  if (!entry) return null;
  reader.read.add(entry.name.toLowerCase());
  const read = readZipEntry(reader.archive, entry);
  if (!read.ok) throw new OoxmlError(read.code as OoxmlErrorCode);
  chargeInflated(reader.budget, read.value.length, reader.limits);
  return decodeXmlBytes(read.value);
}

function numbered(archive: ZipArchive, pattern: RegExp): string[] {
  return archive.entries
    .map((e) => ({ name: e.name, m: pattern.exec(e.name) }))
    .filter((x): x is { name: string; m: RegExpExecArray } => x.m !== null)
    .sort((a, b) => Number(a.m[1] || 0) - Number(b.m[1] || 0) || a.name.localeCompare(b.name))
    .map((x) => x.name);
}

/** Indice di colonna (0-based) da un riferimento di cella come `AB12`. */
export function columnIndex(ref: string): number | null {
  const match = /^([A-Za-z]{1,3})\d*$/.exec(ref);
  if (!match) return null;
  let n = 0;
  for (const ch of match[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function resolveTarget(base: string, target: string): string {
  const raw = target.startsWith("/") ? target.slice(1) : `${base}/${target}`;
  const out: string[] = [];
  for (const segment of raw.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return out.join("/");
}

function sharedStrings(reader: Reader): string[] {
  const xml = readPart(reader, "xl/sharedStrings.xml");
  if (xml === null) return [];
  const strings: string[] = [];
  let current: string[] | null = null;
  let inT = 0;
  let inPhonetic = 0;
  walkXml(xml, {
    open(name, _raw, selfClosing) {
      if (selfClosing) {
        // An empty <si/> still takes an index.
        if (name === "si") strings.push("");
        return;
      }
      if (name === "si") current = [];
      else if (name === "rPh") inPhonetic++;
      else if (name === "t") inT++;
    },
    close(name) {
      if (name === "si") {
        strings.push((current ?? []).join(""));
        current = null;
      } else if (name === "rPh") inPhonetic = Math.max(0, inPhonetic - 1);
      else if (name === "t") inT = Math.max(0, inT - 1);
    },
    text(t) {
      if (current && inT > 0 && inPhonetic === 0) current.push(t);
    },
  });
  return strings;
}

function sheetGrid(xml: string, shared: string[], used: Set<number>, budget: Budget, limits: OoxmlLimits): string[][] {
  const rows = new Map<number, string[]>();
  let rowIndex = -1;
  let nextColumn = 0;
  let cell: { column: number; type: string | null; value: string[]; inline: string[] } | null = null;
  let capture: "v" | "t" | null = null;
  let inInline = 0;
  walkXml(xml, {
    open(name, raw, selfClosing) {
      if (name === "row") {
        const r = attr(raw, "r");
        const parsed = r ? Number(r) - 1 : NaN;
        rowIndex = Number.isInteger(parsed) && parsed >= 0 ? parsed : rowIndex + 1;
        nextColumn = 0;
      } else if (name === "c") {
        const ref = attr(raw, "r");
        const column = ref ? columnIndex(ref) : null;
        cell = { column: column ?? nextColumn, type: attr(raw, "t"), value: [], inline: [] };
        if (selfClosing) cell = null;
        nextColumn = (column ?? nextColumn) + 1;
      } else if (cell && !selfClosing) {
        if (name === "v") capture = "v";
        else if (name === "is") inInline++;
        else if (name === "t" && inInline > 0) capture = "t";
      }
    },
    close(name) {
      if (name === "v" || name === "t") capture = null;
      else if (name === "is") inInline = Math.max(0, inInline - 1);
      else if (name === "c" && cell) {
        const raw = cell.value.join("");
        let value: string;
        switch (cell.type) {
          case "s": {
            const index = Number(raw);
            const valid = Number.isInteger(index) && index >= 0 && index < shared.length;
            if (valid) used.add(index);
            value = valid ? shared[index] : "";
            break;
          }
          case "inlineStr":
            value = cell.inline.join("");
            break;
          case "b":
            value = raw === "1" ? "TRUE" : raw === "0" ? "FALSE" : raw;
            break;
          default:
            value = raw;
        }
        if (value !== "") {
          if (cell.column >= limits.maxColumns) throw new OoxmlError("foglio_troppo_grande");
          const r = Math.max(rowIndex, 0);
          let row = rows.get(r);
          if (!row) {
            row = [];
            rows.set(r, row);
          }
          if (cell.column >= row.length) {
            budget.cells += cell.column + 1 - row.length;
            if (budget.cells > limits.maxCells) throw new OoxmlError("foglio_troppo_grande");
            while (row.length <= cell.column) row.push("");
          }
          row[cell.column] = value;
        }
        cell = null;
      }
    },
    text(t) {
      if (!cell || !capture) return;
      if (capture === "v") cell.value.push(t);
      else cell.inline.push(t);
    },
  });
  return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row);
}

function readXlsx(reader: Reader, budget: Budget, limits: OoxmlLimits): { text: string[]; tables: ExtractedTable[] } {
  const { archive } = reader;
  const workbook = readPart(reader, "xl/workbook.xml");
  if (workbook === null) throw new OoxmlError("ooxml_tipo_sconosciuto");
  const declared: { name: string; rid: string | null }[] = [];
  const definedNames: string[] = [];
  let inDefinedName = 0;
  walkXml(workbook, {
    open(name, raw, selfClosing) {
      if (name === "sheet") declared.push({ name: attr(raw, "name") ?? "", rid: prefixedAttr(raw, "id") });
      else if (name === "definedName" && !selfClosing) inDefinedName++;
    },
    close(name) {
      if (name === "definedName") inDefinedName = Math.max(0, inDefinedName - 1);
    },
    text(t) {
      // Named formulas can hold string literals.
      if (inDefinedName > 0 && t.trim()) definedNames.push(t.trim());
    },
  });
  const rels = new Map<string, string>();
  const relsXml = readPart(reader, "xl/_rels/workbook.xml.rels");
  if (relsXml !== null) {
    walkXml(relsXml, {
      open(name, raw) {
        if (name !== "Relationship") return;
        const id = attr(raw, "Id");
        const target = attr(raw, "Target");
        const type = attr(raw, "Type") ?? "";
        if (id && target && /\/worksheet$/.test(type) && attr(raw, "TargetMode") !== "External") rels.set(id, resolveTarget("xl", target));
      },
    });
  }
  const sheets = declared
    .map((s) => ({ name: s.name, path: s.rid ? rels.get(s.rid) ?? null : null }))
    .filter((s): s is { name: string; path: string } => s.path !== null && zipEntry(archive, s.path) !== null);
  // Worksheets the workbook does not list (or lists badly) are still in the file: read them too.
  const listed = new Set(sheets.map((s) => s.path.toLowerCase()));
  for (const path of numbered(archive, /^xl\/worksheets\/[^/]*?(\d*)\.xml$/i)) {
    if (!listed.has(path.toLowerCase())) sheets.push({ name: `Foglio ${sheets.length + 1}`, path });
  }
  if (sheets.length > limits.maxSheets) throw new OoxmlError("foglio_troppo_grande");
  const shared = sharedStrings(reader);
  const used = new Set<number>();
  const text: string[] = [];
  const tables: ExtractedTable[] = [];
  const seen = new Set<string>();
  for (const sheet of sheets) {
    const key = sheet.path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const xml = readPart(reader, sheet.path);
    if (xml === null) continue;
    const rows = sheetGrid(xml, shared, used, budget, limits);
    tables.push({ name: sheet.name, rows });
    if (sheet.name) text.push(sheet.name);
    for (const row of rows) text.push(row.filter((c) => c !== "").join("\t"));
    // Formulas, validation lists, headers and footers are text too.
    const extras = sheetExtras(xml);
    if (extras.length > 0) text.push(extras.join("\n"));
  }
  if (definedNames.length > 0) text.push(definedNames.join("\n"));
  // Shared strings no cell uses are still in the file: they are scanned too.
  const unused = shared.filter((value, index) => value.trim() !== "" && !used.has(index));
  if (unused.length > 0) text.push(unused.join("\n"));
  return { text, tables };
}

/** Lettore comune di DOCX e PPTX: paragrafi, interruzioni e tabelle (anche annidate). */
function readFlow(xml: string, tables: ExtractedTable[], out: string[]): void {
  const stack: { rows: string[][]; row: string[] | null; cell: string[] | null }[] = [];
  const buffer: string[] = [];
  let capture = 0;
  let inTabStops = 0;
  const push = (t: string) => {
    buffer.push(t);
    const top = stack[stack.length - 1];
    if (top?.cell) top.cell.push(t);
  };
  walkXml(xml, {
    open(name, _raw, selfClosing) {
      switch (name) {
        case "t":
        case "delText":
          if (!selfClosing) capture++;
          break;
        case "tabs":
          if (!selfClosing) inTabStops++;
          break;
        case "tab":
          if (inTabStops === 0) push("\t");
          break;
        case "br":
        case "cr":
          push("\n");
          break;
        case "p":
          if (selfClosing) buffer.push("\n");
          break;
        case "tbl":
          if (!selfClosing) stack.push({ rows: [], row: null, cell: null });
          break;
        case "tr":
          if (stack.length && !selfClosing) stack[stack.length - 1].row = [];
          break;
        case "tc":
          if (stack.length) {
            const top = stack[stack.length - 1];
            if (selfClosing) top.row?.push("");
            else top.cell = [];
          }
          break;
      }
    },
    close(name) {
      switch (name) {
        case "t":
        case "delText":
          capture = Math.max(0, capture - 1);
          break;
        case "tabs":
          inTabStops = Math.max(0, inTabStops - 1);
          break;
        case "p": {
          buffer.push("\n");
          const top = stack[stack.length - 1];
          if (top?.cell) top.cell.push(" ");
          break;
        }
        case "tc": {
          const top = stack[stack.length - 1];
          if (top?.cell) {
            top.row?.push(top.cell.join("").replace(/\s+/g, " ").trim());
            top.cell = null;
          }
          break;
        }
        case "tr": {
          const top = stack[stack.length - 1];
          if (top?.row) {
            top.rows.push(top.row);
            top.row = null;
          }
          break;
        }
        case "tbl": {
          const done = stack.pop();
          if (done) tables.push({ name: `Tabella ${tables.length + 1}`, rows: done.rows });
          break;
        }
      }
    },
    text(t) {
      if (capture > 0) push(t);
    },
  });
  out.push(buffer.join(""));
}

function readDocx(reader: Reader): { text: string[]; tables: ExtractedTable[] } {
  const text: string[] = [];
  const tables: ExtractedTable[] = [];
  const main = readPart(reader, "word/document.xml");
  if (main === null) throw new OoxmlError("ooxml_tipo_sconosciuto");
  readFlow(main, tables, text);
  for (const name of numbered(reader.archive, /^word\/(?:header|footer|footnotes|endnotes|comments)(\d*)\.xml$/i)) {
    readFlow(readPart(reader, name) ?? "", tables, text);
  }
  return { text, tables };
}

function readPptx(reader: Reader): { text: string[]; tables: ExtractedTable[] } {
  const text: string[] = [];
  const tables: ExtractedTable[] = [];
  if (!zipEntry(reader.archive, "ppt/presentation.xml")) throw new OoxmlError("ooxml_tipo_sconosciuto");
  const slides = numbered(reader.archive, /^ppt\/slides\/slide(\d+)\.xml$/i);
  for (const name of [...slides, ...numbered(reader.archive, /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/i)]) {
    readFlow(readPart(reader, name) ?? "", tables, text);
  }
  return { text, tables };
}

/**
 * Parti senza testo dell'utente (stili, temi, impostazioni) e metadati del
 * file (autore, titolo): restano fuori dal recupero del testo restante.
 */
const NON_CONTENT_PART =
  /(^\[content_types\]\.xml$|(^|\/)_rels\/|^docprops\/|^customxml\/|\/theme\/|(^|\/)(styles|styleswitheffects|theme\d*|settings|fonttable|websettings|numbering|presprops|viewprops|tablestyles|commentauthors|people|calcchain)\.xml$)/i;

const EMBEDDED_OFFICE = /\.(docx|xlsx|pptx)$/i;

function extract(archive: ZipArchive, depth: number, budget: Budget, limits: OoxmlLimits): OoxmlDocument {
  const kind = ooxmlKind(archive);
  if (!kind) throw new OoxmlError("ooxml_tipo_sconosciuto");
  const macros = ooxmlHasMacros(archive);
  if (!macros.ok) throw new OoxmlError(macros.code as OoxmlErrorCode);
  if (macros.value) throw new OoxmlError("macro_non_ammesse");
  chargeInflated(budget, zipEntry(archive, "[Content_Types].xml")?.uncompressedSize ?? 0, limits);
  const reader: Reader = { archive, read: new Set(), budget, limits };
  const parts = kind === "xlsx" ? readXlsx(reader, budget, limits) : kind === "docx" ? readDocx(reader) : readPptx(reader);
  // Everything else that can hold text (comments, charts, orphan parts, glossary…) is scanned too.
  for (const entry of archive.entries) {
    const key = entry.name.toLowerCase();
    if (entry.isDirectory || !key.endsWith(".xml") || reader.read.has(key) || NON_CONTENT_PART.test(key)) continue;
    const xml = readPart(reader, entry.name);
    if (xml) parts.text.push(allText(xml, true));
  }
  let embedded = 0;
  for (const entry of archive.entries) {
    if (entry.isDirectory || !/^(?:xl|word|ppt)\/embeddings\//i.test(entry.name)) continue;
    if (!EMBEDDED_OFFICE.test(entry.name) || depth >= 1) throw new OoxmlError("oggetto_incorporato");
    if (++budget.embedded > limits.maxEmbedded) throw new OoxmlError("zip_troppe_voci");
    const read = readZipEntry(archive, entry);
    if (!read.ok) throw new OoxmlError(read.code as OoxmlErrorCode);
    chargeInflated(budget, read.value.length, limits);
    // The nested archive shares one budget with the whole file: what is left now, and every part it inflates.
    const nested = openZip(read.value, { ...limits, maxTotalUncompressedBytes: Math.max(0, limits.maxTotalUncompressedBytes - budget.inflatedBytes) });
    if (!nested.ok) throw new OoxmlError(nested.code as OoxmlErrorCode);
    const doc = extract(nested.value, depth + 1, budget, limits);
    parts.text.push(doc.text);
    for (const table of doc.tables) parts.tables.push({ name: `Incorporato: ${table.name}`, rows: table.rows });
    embedded++;
  }
  return { kind, text: parts.text.filter((t) => t.trim() !== "").join("\n"), tables: parts.tables, embedded };
}

/**
 * Legge un documento Office per i controlli. `expected` (dall'estensione) deve
 * coincidere con il tipo trovato nelle parti.
 */
export function readOoxml(bytes: Uint8Array, expected?: OoxmlKind, limits: OoxmlLimits = OOXML_LIMITS): Result<OoxmlDocument> {
  const archive = openZip(bytes, limits);
  if (!archive.ok) return archive;
  const kind = ooxmlKind(archive.value);
  if (!kind || (expected && kind !== expected)) return failWith("ooxml_tipo_sconosciuto");
  try {
    return ok(extract(archive.value, 0, newBudget(), limits));
  } catch (error) {
    if (error instanceof OoxmlError) return failWith(error.code);
    if (error instanceof RangeError) return failWith("foglio_troppo_grande");
    throw error;
  }
}
