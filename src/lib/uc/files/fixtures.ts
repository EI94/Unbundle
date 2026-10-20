/**
 * Costruttori di file sintetici per i test dei controlli sui file: zip, XLSX,
 * DOCX, PPTX e PDF minimi, generati in memoria. Nessun file reale, nessun dato
 * del cliente: solo testi d'esempio inventati nei test.
 *
 * Permettono anche di costruire file ostili (percorsi con `..`, bombe zip,
 * testate che mentono sulle dimensioni, flag di cifratura, PDF cifrati).
 * Modulo puro, usato solo dai test.
 */
import { deflateRawSync, deflateSync } from "node:zlib";
import { crc32 } from "./ooxml.ts";

export interface ZipFileSpec {
  name: string;
  data: string | Uint8Array;
  /** 8 = deflate (predefinito), 0 = memorizzato. */
  method?: 0 | 8;
  /** Flag del bit di uso generale in aggiunta a UTF-8 (es. 0x0001 = cifrato). */
  flags?: number;
  /** Dimensione decompressa dichiarata, se diversa da quella vera (testate che mentono). */
  declaredUncompressedSize?: number;
  /** CRC dichiarato, se diverso da quello vero. */
  crc?: number;
}

export interface ZipBuildOptions {
  /** Byte aggiunti dopo la fine dello zip (poliglotti). */
  trailing?: Uint8Array;
  /** Scrive il localizzatore zip64 prima della fine della directory centrale. */
  zip64Locator?: boolean;
}

function bytesOf(data: string | Uint8Array): Buffer {
  return typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
}

/** Zip con directory centrale, deflate grezzo e CRC veri (salvo override). */
export function buildZip(files: readonly ZipFileSpec[], options: ZipBuildOptions = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const data = bytesOf(file.data);
    const method = file.method ?? 8;
    const compressed = method === 8 ? deflateRawSync(data) : data;
    const crc = file.crc ?? crc32(data);
    const uncompressedSize = file.declaredUncompressedSize ?? data.length;
    const name = Buffer.from(file.name, "utf8");
    const flags = (file.flags ?? 0) | 0x0800;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(uncompressedSize, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(uncompressedSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + compressed.length;
  }
  const cd = Buffer.concat(centrals);
  const parts: Buffer[] = [...locals, cd];
  if (options.zip64Locator) {
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    parts.push(locator);
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  parts.push(eocd);
  if (options.trailing) parts.push(Buffer.from(options.trailing));
  return Buffer.concat(parts);
}

function xmlEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function columnLetters(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export type CellValue = string | number | boolean | null;

export interface SheetSpec {
  name: string;
  rows: readonly (readonly CellValue[])[];
}

export interface OfficeBuildOptions {
  /** Parti aggiuntive (commenti, incorporati, macro…). */
  extraFiles?: readonly ZipFileSpec[];
  /** Tipi di contenuto aggiuntivi in `[Content_Types].xml`. */
  extraContentTypes?: readonly string[];
  /** Tipo di contenuto principale (es. macroEnabled). */
  mainContentType?: string;
}

function contentTypes(overrides: string[], extra: readonly string[] = []): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[...overrides, ...extra].join("")}</Types>`;
}

const ROOT_RELS = (target: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${target}"/></Relationships>`;

/**
 * XLSX minimo: stringhe condivise per i testi (oppure `inlineStr` con
 * `inlineStrings`), numeri e booleani come valori.
 */
export function buildXlsx(sheets: readonly SheetSpec[], options: OfficeBuildOptions & { inlineStrings?: boolean } = {}): Buffer {
  const shared: string[] = [];
  const sharedIndex = new Map<string, number>();
  const sheetXml = sheets.map((sheet) => {
    const rows = sheet.rows
      .map((row, r) => {
        const cells = row
          .map((value, c) => {
            if (value === null || value === "") return "";
            const ref = `${columnLetters(c)}${r + 1}`;
            if (typeof value === "number") return `<c r="${ref}"><v>${value}</v></c>`;
            if (typeof value === "boolean") return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
            if (options.inlineStrings) return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
            let index = sharedIndex.get(value);
            if (index === undefined) {
              index = shared.length;
              shared.push(value);
              sharedIndex.set(value, index);
            }
            return `<c r="${ref}" t="s"><v>${index}</v></c>`;
          })
          .join("");
        return `<row r="${r + 1}">${cells}</row>`;
      })
      .join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
  });
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
    .map((s, i) => `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("")}</sheets></workbook>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;
  const sst = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared
    .map((s) => `<si><t xml:space="preserve">${xmlEscape(s)}</t></si>`)
    .join("")}</sst>`;
  const main = options.mainContentType ?? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
  return buildZip([
    {
      name: "[Content_Types].xml",
      data: contentTypes(
        [
          `<Override PartName="/xl/workbook.xml" ContentType="${main}"/>`,
          ...sheets.map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          ),
          `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>`,
        ],
        options.extraContentTypes,
      ),
    },
    { name: "_rels/.rels", data: ROOT_RELS("xl/workbook.xml") },
    { name: "xl/workbook.xml", data: workbook },
    { name: "xl/_rels/workbook.xml.rels", data: rels },
    ...sheetXml.map((xml, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: xml })),
    { name: "xl/sharedStrings.xml", data: sst },
    ...(options.extraFiles ?? []),
  ]);
}

/** DOCX minimo: paragraffi, poi tabelle (righe di celle). */
export function buildDocx(
  paragraphs: readonly string[],
  tables: readonly (readonly (readonly string[])[])[] = [],
  options: OfficeBuildOptions & { deletedText?: string } = {},
): Buffer {
  const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
  const body = [
    ...paragraphs.map(p),
    ...(options.deletedText ? [`<w:p><w:del w:id="1" w:author="x"><w:r><w:delText>${xmlEscape(options.deletedText)}</w:delText></w:r></w:del></w:p>`] : []),
    ...tables.map(
      (rows) =>
        `<w:tbl><w:tblGrid/>${rows.map((row) => `<w:tr>${row.map((cell) => `<w:tc><w:tcPr/>${p(cell)}</w:tc>`).join("")}</w:tr>`).join("")}</w:tbl>`,
    ),
  ].join("");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`;
  const main = options.mainContentType ?? "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
  return buildZip([
    { name: "[Content_Types].xml", data: contentTypes([`<Override PartName="/word/document.xml" ContentType="${main}"/>`], options.extraContentTypes) },
    { name: "_rels/.rels", data: ROOT_RELS("word/document.xml") },
    { name: "word/document.xml", data: document },
    ...(options.extraFiles ?? []),
  ]);
}

/** PPTX minimo: una diapositiva per elenco di testi. */
export function buildPptx(slides: readonly (readonly string[])[], options: OfficeBuildOptions = {}): Buffer {
  const slideXml = slides.map(
    (texts) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody>${texts
      .map((t) => `<a:p><a:r><a:t>${xmlEscape(t)}</a:t></a:r></a:p>`)
      .join("")}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  return buildZip([
    {
      name: "[Content_Types].xml",
      data: contentTypes(
        [
          `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>`,
          ...slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`),
        ],
        options.extraContentTypes,
      ),
    },
    { name: "_rels/.rels", data: ROOT_RELS("ppt/presentation.xml") },
    {
      name: "ppt/presentation.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`,
    },
    ...slideXml.map((xml, i) => ({ name: `ppt/slides/slide${i + 1}.xml`, data: xml })),
    ...(options.extraFiles ?? []),
  ]);
}

// ── PDF ───────────────────────────────────────────────────────────────

/** Stringa letterale PDF con gli escape necessari. */
export function pdfString(text: string): string {
  return `(${text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")})`;
}

/** Flusso di contenuto con una riga di testo `Tj` per ogni elemento. */
export function pdfTextContent(lines: readonly string[]): string {
  return `BT\n/F1 11 Tf\n72 760 Td\n14 TL\n${lines.map((l) => `${pdfString(l)} Tj T*`).join("\n")}\nET\n`;
}

export interface PdfPageSpec {
  /** Flusso di contenuto (es. `pdfTextContent([...])`). */
  content: string | Uint8Array;
  /** Comprime il flusso con FlateDecode (predefinito: sì). */
  compress?: boolean;
}

export interface PdfBuildOptions {
  /** Aggiunge `/Encrypt` al trailer. */
  encrypt?: boolean;
  /** Oggetti grezzi aggiuntivi (testo tra `obj` ed `endobj`). */
  extraObjects?: readonly string[];
  /** Flussi aggiuntivi: dizionario (senza `/Length`) e dati. */
  extraStreams?: readonly { dict: string; data: Uint8Array }[];
  /** Scrive `/Length` come riferimento indiretto. */
  indirectLength?: boolean;
}

/** PDF minimo ma ben formato: catalogo, pagine, font, flussi, xref e trailer. */
export function buildPdf(pages: readonly PdfPageSpec[], options: PdfBuildOptions = {}): Buffer {
  const objects: Buffer[] = [];
  const add = (body: Buffer | string) => {
    objects.push(typeof body === "string" ? Buffer.from(body, "latin1") : body);
    return objects.length;
  };
  const catalog = add("");
  const pagesObj = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const stream = (dict: string, data: Buffer) => {
    if (options.indirectLength) {
      const lengthObj = add(String(data.length));
      return add(Buffer.concat([Buffer.from(`<< ${dict} /Length ${lengthObj} 0 R >>\nstream\n`, "latin1"), data, Buffer.from("\nendstream", "latin1")]));
    }
    return add(Buffer.concat([Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, "latin1"), data, Buffer.from("\nendstream", "latin1")]));
  };
  const kids: number[] = [];
  for (const page of pages) {
    const raw = typeof page.content === "string" ? Buffer.from(page.content, "latin1") : Buffer.from(page.content);
    const compress = page.compress ?? true;
    const content = stream(compress ? "/Filter /FlateDecode" : "", compress ? deflateSync(raw) : raw);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  for (const extra of options.extraStreams ?? []) stream(extra.dict, Buffer.from(extra.data));
  for (const extra of options.extraObjects ?? []) add(extra);
  objects[catalog - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`, "latin1");
  objects[pagesObj - 1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`, "latin1");

  const chunks: Buffer[] = [Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  let offset = chunks[0].length;
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(offset);
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, "latin1"), body, Buffer.from("\nendobj\n", "latin1")]);
    chunks.push(chunk);
    offset += chunk.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)].join("");
  const encrypt = options.encrypt ? ` /Encrypt ${objects.length + 1} 0 R` : "";
  chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${encrypt} >>\nstartxref\n${offset}\n%%EOF\n`, "latin1"));
  return Buffer.concat(chunks);
}

// ── PDF a oggetti espliciti ───────────────────────────────────────────

/** Codifica di un flusso nel PDF sintetico. */
export type PdfStreamEncoding = "none" | "flate" | "raw-deflate" | "ahx-flate" | "lzw" | "a85" | "rl" | "png-up";

export interface RawPdfStream {
  /** Voci del dizionario, senza `/Filter` né `/Length` (le aggiunge il costruttore). */
  dict: string;
  data: string | Uint8Array;
  encoding?: PdfStreamEncoding;
  /** `/Length` dichiarata, se diversa da quella vera (testate che mentono). */
  declaredLength?: number;
}

/** Corpo di un oggetto (testo tra `obj` ed `endobj`) oppure un flusso. Il numero è la posizione + 1. */
export type RawPdfObject = string | RawPdfStream;

/** LZW dei PDF (codici a 9 bit, EarlyChange 1): basta per testi brevi. */
export function lzwEncode(input: Uint8Array): Buffer {
  const dict = new Map<string, number>();
  for (let i = 0; i < 256; i++) dict.set(String.fromCharCode(i), i);
  let next = 258;
  const codes: number[] = [256];
  let current = "";
  for (const byte of input) {
    const ch = String.fromCharCode(byte);
    const joined = current + ch;
    if (dict.has(joined)) {
      current = joined;
      continue;
    }
    codes.push(dict.get(current)!);
    if (next >= 511) throw new Error("lzwEncode: input too long for 9-bit codes");
    dict.set(joined, next++);
    current = ch;
  }
  if (current) codes.push(dict.get(current)!);
  codes.push(257);
  let bits = 0;
  let count = 0;
  const out: number[] = [];
  for (const code of codes) {
    bits = (bits << 9) | code;
    count += 9;
    while (count >= 8) {
      out.push((bits >>> (count - 8)) & 0xff);
      count -= 8;
      bits &= (1 << count) - 1;
    }
  }
  if (count > 0) out.push((bits << (8 - count)) & 0xff);
  return Buffer.from(out);
}

/** ASCII85 con `~>` finale. */
export function ascii85Encode(input: Uint8Array): string {
  let out = "";
  for (let i = 0; i < input.length; i += 4) {
    const chunk = [input[i], input[i + 1] ?? 0, input[i + 2] ?? 0, input[i + 3] ?? 0];
    const real = Math.min(4, input.length - i);
    let value = ((chunk[0] << 24) | (chunk[1] << 16) | (chunk[2] << 8) | chunk[3]) >>> 0;
    if (value === 0 && real === 4) {
      out += "z";
      continue;
    }
    const digits: string[] = [];
    for (let k = 0; k < 5; k++) {
      digits.unshift(String.fromCharCode((value % 85) + 33));
      value = Math.floor(value / 85);
    }
    out += digits.slice(0, real + 1).join("");
  }
  return `${out}~>`;
}

/** RunLength con sole sequenze letterali e il marcatore di fine. */
export function runLengthEncode(input: Uint8Array): Buffer {
  const out: number[] = [];
  for (let i = 0; i < input.length; i += 128) {
    const chunk = input.subarray(i, i + 128);
    out.push(chunk.length - 1, ...chunk);
  }
  out.push(128);
  return Buffer.from(out);
}

/** Predittore PNG «Up» su righe di `columns` byte, poi deflate. */
export function pngUpEncode(input: Uint8Array, columns: number): Buffer {
  const rows: number[] = [];
  let previous = new Uint8Array(columns);
  for (let i = 0; i < input.length; i += columns) {
    const row = new Uint8Array(columns);
    row.set(input.subarray(i, i + columns));
    rows.push(2, ...row.map((b, k) => (b - previous[k]) & 0xff));
    previous = row;
  }
  return deflateSync(Buffer.from(rows));
}

const PNG_COLUMNS = 16;

function encodeStream(stream: RawPdfStream): { filter: string; data: Buffer } {
  const raw = typeof stream.data === "string" ? Buffer.from(stream.data, "latin1") : Buffer.from(stream.data);
  switch (stream.encoding ?? "flate") {
    case "none":
      return { filter: "", data: raw };
    case "flate":
      return { filter: "/Filter /FlateDecode", data: deflateSync(raw) };
    case "raw-deflate":
      return { filter: "/Filter /FlateDecode", data: deflateRawSync(raw) };
    case "ahx-flate":
      return { filter: "/Filter [/ASCIIHexDecode /FlateDecode]", data: Buffer.from(`${deflateSync(raw).toString("hex")}>`, "latin1") };
    case "lzw":
      return { filter: "/Filter /LZWDecode", data: lzwEncode(raw) };
    case "a85":
      return { filter: "/Filter /ASCII85Decode", data: Buffer.from(ascii85Encode(raw), "latin1") };
    case "rl":
      return { filter: "/Filter /RunLengthDecode", data: runLengthEncode(raw) };
    case "png-up":
      return { filter: `/Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns ${PNG_COLUMNS} >>`, data: pngUpEncode(raw, PNG_COLUMNS) };
  }
}

/**
 * PDF con oggetti dati per numero (posizione + 1), xref e trailer. `root` è il
 * numero del catalogo; `trailer` aggiunge voci al trailer (es. `/Encrypt 9 0 R`).
 */
export function buildRawPdf(objects: readonly RawPdfObject[], options: { root?: number; trailer?: string } = {}): Buffer {
  const chunks: Buffer[] = [Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  let offset = chunks[0].length;
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(offset);
    let body: Buffer;
    if (typeof object === "string") body = Buffer.from(object, "latin1");
    else {
      const { filter, data } = encodeStream(object);
      const length = object.declaredLength ?? data.length;
      body = Buffer.concat([Buffer.from(`<< ${object.dict} ${filter} /Length ${length} >>\nstream\n`, "latin1"), data, Buffer.from("\nendstream", "latin1")]);
    }
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, "latin1"), body, Buffer.from("\nendobj\n", "latin1")]);
    chunks.push(chunk);
    offset += chunk.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)].join("");
  chunks.push(
    Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root ${options.root ?? 1} 0 R${options.trailer ? ` ${options.trailer}` : ""} >>\nstartxref\n${offset}\n%%EOF\n`, "latin1"),
  );
  return Buffer.concat(chunks);
}

/** Pagina standard con un font `F1` (oggetto `font`) e il flusso `content`. */
export function pdfPage(parent: number, content: number, resources: string): string {
  return `<< /Type /Page /Parent ${parent} 0 R /MediaBox [0 0 595 842] /Resources ${resources} /Contents ${content} 0 R >>`;
}
