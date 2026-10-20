/**
 * Estrazione minima del testo dai PDF caricati, scritta in casa senza
 * dipendenze (PIANO §6.3 [D]).
 *
 * Serve ai controlli, non alla lettura: trovare parole come «visita medica» e
 * capire quando il testo non si può leggere e serve una revisione a mano.
 *
 * - Oggetti dal corpo del file (anche nei flussi di oggetti `ObjStm`); la
 *   tabella xref non serve.
 * - Flussi `FlateDecode` con `zlib.inflateSync` e gli stessi limiti
 *   dell'OOXML: ≤ 2.000 flussi, ≤ 50 MB decompressi in tutto, rapporto ≤ 100
 *   (oltre 1 MB). Anche `ASCIIHexDecode`, `ASCII85Decode`, `LZWDecode`,
 *   `RunLengthDecode` e i predittori PNG/TIFF; i filtri d'immagine si saltano.
 * - Testo dagli operatori `Tj`, `TJ`, `'` e `"` delle pagine e dei moduli
 *   (`Do`), con i font: `ToUnicode`, codifiche standard e `Differences`.
 *   Poi i testi di annotazioni, campi e segnalibri, e i flussi di contenuto
 *   che nessuna pagina usa (testo nascosto).
 * - Rifiutati: PDF cifrati, con script o azioni di avvio, con file allegati.
 *
 * **Testo scarso** (`lowText`, revisione manuale): meno di 200 lettere, più
 * del 30% di caratteri non stampabili, glifi senza mappa Unicode, flussi di
 * contenuto illeggibili, pagine fatte di sole immagini, testo spezzato glifo
 * per glifo (dove le parole non si ricompongono con sicurezza), testo oltre i
 * limiti (non controllato per intero).
 *
 * Modulo puro.
 */
import { constants as zlibConstants, inflateRawSync, inflateSync } from "node:zlib";
import { fail, ok, type Result } from "../types.ts";
import { windows1252Table } from "./charset.ts";

// ── Limiti ed esiti ───────────────────────────────────────────────────

const MIB = 1024 * 1024;

export interface PdfLimits {
  maxStreams: number;
  maxObjects: number;
  maxTotalDecodedBytes: number;
  maxRatio: number;
  ratioCheckFromBytes: number;
  maxTextChars: number;
  maxOperations: number;
  maxPages: number;
  maxFormDepth: number;
}

export const PDF_LIMITS: Readonly<PdfLimits> = Object.freeze({
  maxStreams: 2000,
  maxObjects: 200_000,
  maxTotalDecodedBytes: 50 * MIB,
  maxRatio: 100,
  ratioCheckFromBytes: 1 * MIB,
  maxTextChars: 5_000_000,
  maxOperations: 20_000_000,
  maxPages: 10_000,
  maxFormDepth: 12,
});

/** Soglie del testo scarso (PIANO §6.3). */
export const PDF_LOW_TEXT = Object.freeze({
  minLetters: 200,
  maxNonPrintableRatio: 0.3,
  /** Glifi senza mappa tollerati: il massimo tra questo numero e il 2% dei glifi. */
  undecodableGlyphs: 20,
  undecodableRatio: 0.02,
  /** Lettere sotto cui una pagina con immagini si considera una scansione. */
  imagePageMinLetters: 20,
  /** Testo spezzato: almeno 50 operazioni di testo, più della metà con un solo glifo. */
  fragmentedMinRuns: 50,
  fragmentedRatio: 0.5,
});

export const LOW_TEXT_REASONS = [
  "poche_lettere",
  "caratteri_non_stampabili",
  "font_senza_mappa",
  "flussi_non_leggibili",
  "pagine_immagine",
  "testo_frammentato",
  "testo_troncato",
] as const;
export type LowTextReason = (typeof LOW_TEXT_REASONS)[number];

export const PDF_MESSAGES = {
  pdf_non_valido: "Il PDF è danneggiato o non è leggibile.",
  pdf_cifrato: "Il PDF è protetto da password o cifrato: caricalo senza protezione.",
  pdf_troppi_flussi: "Il PDF contiene troppe parti per essere controllato: dividilo in file più piccoli.",
  pdf_troppo_grande: "Il PDF decompresso supera i 50 MB: dividilo in file più piccoli.",
  pdf_bomba: "Il PDF ha un rapporto di compressione anomalo e non possiamo controllarlo.",
  contenuto_attivo: "Il PDF contiene script o azioni automatiche: esportalo di nuovo in PDF senza script.",
  oggetto_incorporato: "Il PDF contiene file allegati che non possiamo controllare: caricali a parte.",
} as const;
export type PdfErrorCode = keyof typeof PDF_MESSAGES;

class PdfError extends Error {
  readonly code: PdfErrorCode;
  constructor(code: PdfErrorCode) {
    super(code);
    this.code = code;
  }
}

export interface PdfText {
  /** Testo estratto: pagine, poi annotazioni e campi, poi contenuti non usati da nessuna pagina. */
  text: string;
  pages: number;
  /** Lettere (Unicode) nel testo. */
  letters: number;
  /** Quota di caratteri non stampabili sui caratteri non bianchi. */
  nonPrintableRatio: number;
  glyphs: number;
  undecodableGlyphs: number;
  /** Pagine con immagini e quasi senza testo (scansioni). */
  imagePagesWithoutText: number;
  /** Testo scarso: serve la revisione a mano. */
  lowText: boolean;
  reasons: LowTextReason[];
  /** Il limite di caratteri ha fermato l'estrazione. */
  truncated: boolean;
}

/** Vero se i byte iniziano con `%PDF-`. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

// ── Lessico PDF ───────────────────────────────────────────────────────

const WHITESPACE = new Uint8Array(256);
for (const c of [0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]) WHITESPACE[c] = 1;
const DELIMITER = new Uint8Array(256);
for (const c of "()<>[]{}/%") DELIMITER[c.charCodeAt(0)] = 1;

class PdfName {
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
}
class PdfRef {
  readonly num: number;
  readonly gen: number;
  constructor(num: number, gen: number) {
    this.num = num;
    this.gen = gen;
  }
}
type PdfDict = Map<string, PdfValue>;
type PdfValue = number | boolean | null | PdfName | PdfRef | Buffer | PdfValue[] | PdfDict;

type Token =
  | { t: "num"; v: number; int: boolean }
  | { t: "name"; v: string }
  | { t: "str"; v: Buffer }
  | { t: "kw"; v: string }
  | { t: "[" | "]" | "<<" | ">>" | "{" | "}" };

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
const MAX_NESTING = 64;
const MAX_COLLECTION = 100_000;

/**
 * Byte che i lexer della struttura possono ancora leggere. La ricerca degli
 * oggetti riparte dopo ogni valore: una stringa mai chiusa (`(` senza `)`) si
 * leggerebbe fino alla fine del file per ogni oggetto, con tempi quadratici.
 * Il budget, proporzionale alla dimensione del file, tiene la lettura lineare.
 */
interface WorkBudget {
  left: number;
}

/** Letture ammesse per byte di struttura: un PDF normale ne usa meno di 3. */
const PARSE_WORK_PER_BYTE = 8;
const PARSE_WORK_BASE = MIB;

class Lexer {
  pos: number;
  readonly buf: Buffer;
  readonly end: number;
  private readonly work: WorkBudget | null;
  constructor(buf: Buffer, start = 0, end = buf.length, work: WorkBudget | null = null) {
    this.buf = buf;
    this.pos = start;
    this.end = end;
    this.work = work;
  }

  next(): Token | null {
    const from = this.pos;
    const tok = this.token();
    if (this.work) {
      this.work.left -= this.pos - from;
      if (this.work.left < 0) throw new PdfError("pdf_troppi_flussi");
    }
    return tok;
  }

  skipSpace(): void {
    const { buf, end } = this;
    while (this.pos < end) {
      const c = buf[this.pos];
      if (WHITESPACE[c]) this.pos++;
      else if (c === 0x25) {
        while (this.pos < end && buf[this.pos] !== 0x0a && buf[this.pos] !== 0x0d) this.pos++;
      } else break;
    }
  }

  private token(): Token | null {
    this.skipSpace();
    const { buf, end } = this;
    if (this.pos >= end) return null;
    const c = buf[this.pos];
    switch (c) {
      case 0x28:
        return { t: "str", v: this.literal() };
      case 0x3c:
        if (buf[this.pos + 1] === 0x3c) {
          this.pos += 2;
          return { t: "<<" };
        }
        return { t: "str", v: this.hex() };
      case 0x3e:
        if (buf[this.pos + 1] === 0x3e) {
          this.pos += 2;
          return { t: ">>" };
        }
        this.pos++;
        return { t: "kw", v: ">" };
      case 0x5b:
        this.pos++;
        return { t: "[" };
      case 0x5d:
        this.pos++;
        return { t: "]" };
      case 0x7b:
        this.pos++;
        return { t: "{" };
      case 0x7d:
        this.pos++;
        return { t: "}" };
      case 0x2f:
        return { t: "name", v: this.name() };
      case 0x29:
        this.pos++;
        return { t: "kw", v: ")" };
    }
    const start = this.pos;
    while (this.pos < end && !WHITESPACE[buf[this.pos]] && !DELIMITER[buf[this.pos]]) this.pos++;
    const word = buf.toString("latin1", start, this.pos);
    if (NUMBER.test(word)) return { t: "num", v: Number(word), int: /^[+-]?\d+$/.test(word) };
    return { t: "kw", v: word };
  }

  private literal(): Buffer {
    const { buf, end } = this;
    this.pos++;
    const out = new ByteWriter(64);
    let depth = 1;
    while (this.pos < end) {
      const c = buf[this.pos++];
      if (c === 0x5c) {
        if (this.pos >= end) break;
        const e = buf[this.pos++];
        switch (e) {
          case 0x6e:
            out.push(0x0a);
            break;
          case 0x72:
            out.push(0x0d);
            break;
          case 0x74:
            out.push(0x09);
            break;
          case 0x62:
            out.push(0x08);
            break;
          case 0x66:
            out.push(0x0c);
            break;
          case 0x0d:
            if (buf[this.pos] === 0x0a) this.pos++;
            break;
          case 0x0a:
            break;
          default:
            if (e >= 0x30 && e <= 0x37) {
              let value = e - 0x30;
              for (let k = 0; k < 2 && this.pos < end && buf[this.pos] >= 0x30 && buf[this.pos] <= 0x37; k++) {
                value = value * 8 + (buf[this.pos++] - 0x30);
              }
              out.push(value & 0xff);
            } else out.push(e);
        }
      } else if (c === 0x28) {
        depth++;
        out.push(c);
      } else if (c === 0x29) {
        if (--depth === 0) break;
        out.push(c);
      } else out.push(c);
    }
    return out.result();
  }

  private hex(): Buffer {
    const { buf, end } = this;
    this.pos++;
    const out = new ByteWriter(64);
    let high = -1;
    while (this.pos < end) {
      const c = buf[this.pos++];
      if (c === 0x3e) break;
      const v = hexValue(c);
      if (v < 0) continue;
      if (high < 0) high = v;
      else {
        out.push(high * 16 + v);
        high = -1;
      }
    }
    if (high >= 0) out.push(high * 16);
    return out.result();
  }

  private name(): string {
    const { buf, end } = this;
    this.pos++;
    const out = new ByteWriter(32);
    while (this.pos < end && !WHITESPACE[buf[this.pos]] && !DELIMITER[buf[this.pos]]) {
      const c = buf[this.pos++];
      if (c === 0x23 && this.pos + 1 < end && hexValue(buf[this.pos]) >= 0 && hexValue(buf[this.pos + 1]) >= 0) {
        out.push(hexValue(buf[this.pos]) * 16 + hexValue(buf[this.pos + 1]));
        this.pos += 2;
      } else out.push(c);
    }
    return out.result().toString("latin1");
  }
}

/** Byte in crescita senza array di numeri (memoria contenuta anche su flussi grandi). */
class ByteWriter {
  private buf: Buffer;
  length = 0;

  constructor(initial = 256) {
    this.buf = Buffer.allocUnsafe(Math.max(16, initial));
  }

  push(byte: number): void {
    if (this.length === this.buf.length) {
      const next = Buffer.allocUnsafe(this.buf.length * 2);
      this.buf.copy(next, 0, 0, this.length);
      this.buf = next;
    }
    this.buf[this.length++] = byte;
  }

  result(): Buffer {
    return Buffer.from(this.buf.subarray(0, this.length));
  }
}

function hexValue(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x41 && c <= 0x46) return c - 0x37;
  if (c >= 0x61 && c <= 0x66) return c - 0x57;
  return -1;
}

/** Valore dal token già letto. `undefined` per una parola chiave che non è un valore. */
function valueFrom(lx: Lexer, tok: Token, depth: number, allowRefs: boolean): PdfValue | undefined {
  if (depth > MAX_NESTING) throw new PdfError("pdf_non_valido");
  switch (tok.t) {
    case "num": {
      if (allowRefs && tok.int && tok.v >= 0) {
        const save = lx.pos;
        const gen = lx.next();
        if (gen && gen.t === "num" && gen.int && gen.v >= 0) {
          const r = lx.next();
          if (r && r.t === "kw" && r.v === "R") return new PdfRef(tok.v, gen.v);
        }
        lx.pos = save;
      }
      return tok.v;
    }
    case "name":
      return new PdfName(tok.v);
    case "str":
      return tok.v;
    case "[": {
      const items: PdfValue[] = [];
      for (;;) {
        const next = lx.next();
        if (!next || next.t === "]") break;
        const value = valueFrom(lx, next, depth + 1, allowRefs);
        if (value !== undefined && items.length < MAX_COLLECTION) items.push(value);
      }
      return items;
    }
    case "<<": {
      const dict: PdfDict = new Map();
      for (;;) {
        const key = lx.next();
        if (!key || key.t === ">>") break;
        if (key.t !== "name") continue;
        const valueTok = lx.next();
        if (!valueTok || valueTok.t === ">>") break;
        const value = valueFrom(lx, valueTok, depth + 1, allowRefs);
        if (value !== undefined && dict.size < MAX_COLLECTION) dict.set(key.v, value);
      }
      return dict;
    }
    case "kw":
      if (tok.v === "true") return true;
      if (tok.v === "false") return false;
      if (tok.v === "null") return null;
      return undefined;
    default:
      return undefined;
  }
}

function parseValue(lx: Lexer, allowRefs = true): PdfValue | undefined {
  const tok = lx.next();
  return tok ? valueFrom(lx, tok, 0, allowRefs) : undefined;
}

const isDict = (v: PdfValue | undefined): v is PdfDict => v instanceof Map;
const nameOf = (v: PdfValue | undefined): string | null => (v instanceof PdfName ? v.name : null);
const numberOf = (v: PdfValue | undefined, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

// ── Decodifica dei flussi ─────────────────────────────────────────────

interface Budget {
  used: number;
}

type Decoded = { kind: "data"; data: Buffer } | { kind: "image" } | { kind: "unsupported" };

const IMAGE_FILTERS = new Set(["DCTDecode", "DCT", "JPXDecode", "CCITTFaxDecode", "CCF", "JBIG2Decode"]);

function tooLarge(error: unknown): boolean {
  return error instanceof RangeError || (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ERR_BUFFER_TOO_LARGE");
}

class Decoder {
  readonly limits: PdfLimits;
  readonly budget: Budget;
  constructor(limits: PdfLimits, budget: Budget) {
    this.limits = limits;
    this.budget = budget;
  }

  private cap(inputLength: number): { cap: number; byBudget: boolean } {
    const remaining = this.limits.maxTotalDecodedBytes - this.budget.used;
    if (remaining <= 0) throw new PdfError("pdf_troppo_grande");
    const byRatio = Math.max(inputLength * this.limits.maxRatio, this.limits.ratioCheckFromBytes);
    return byRatio < remaining ? { cap: byRatio, byBudget: false } : { cap: remaining, byBudget: true };
  }

  private account(out: Buffer): Buffer {
    this.budget.used += out.length;
    if (this.budget.used > this.limits.maxTotalDecodedBytes) throw new PdfError("pdf_troppo_grande");
    return out;
  }

  inflate(data: Buffer): Buffer | null {
    const { cap, byBudget } = this.cap(data.length);
    const options = { maxOutputLength: Math.max(cap, 1), finishFlush: zlibConstants.Z_SYNC_FLUSH };
    try {
      return this.account(inflateSync(data, options));
    } catch (error) {
      if (error instanceof PdfError) throw error;
      if (tooLarge(error)) throw new PdfError(byBudget ? "pdf_troppo_grande" : "pdf_bomba");
    }
    try {
      return this.account(inflateRawSync(data, options));
    } catch (error) {
      if (error instanceof PdfError) throw error;
      if (tooLarge(error)) throw new PdfError(byBudget ? "pdf_troppo_grande" : "pdf_bomba");
      return null;
    }
  }

  /** LZW dei PDF: dizionario a prefisso + ultimo byte, senza copie delle voci. */
  lzw(data: Buffer, earlyChange: number): Buffer {
    const { cap, byBudget } = this.cap(data.length);
    const prefix = new Int32Array(4096);
    const suffix = new Uint8Array(4096);
    const length = new Uint16Array(4096);
    const first = new Uint8Array(4096);
    for (let i = 0; i < 256; i++) {
      prefix[i] = -1;
      suffix[i] = i;
      length[i] = 1;
      first[i] = i;
    }
    let size = 258;
    let codeLength = 9;
    let bitBuffer = 0;
    let bitCount = 0;
    let previous = -1;
    const out = new ByteWriter(Math.min(cap, data.length * 4 + 64));
    const scratch = new Uint8Array(4096);
    const emit = (code: number) => {
      const n = length[code];
      let c = code;
      for (let k = n - 1; k >= 0; k--) {
        scratch[k] = suffix[c];
        c = prefix[c];
      }
      for (let k = 0; k < n; k++) out.push(scratch[k]);
      if (out.length > cap) throw new PdfError(byBudget ? "pdf_troppo_grande" : "pdf_bomba");
    };
    for (let i = 0; i < data.length; i++) {
      bitBuffer = ((bitBuffer << 8) | data[i]) >>> 0;
      bitCount += 8;
      while (bitCount >= codeLength) {
        const code = (bitBuffer >>> (bitCount - codeLength)) & ((1 << codeLength) - 1);
        bitCount -= codeLength;
        bitBuffer &= (1 << bitCount) - 1;
        if (code === 256) {
          size = 258;
          codeLength = 9;
          previous = -1;
          continue;
        }
        if (code === 257) return this.account(out.result());
        if (code < size && code !== 256 && code !== 257) {
          emit(code);
          if (previous >= 0 && size < 4096) {
            prefix[size] = previous;
            suffix[size] = first[code];
            length[size] = length[previous] + 1;
            first[size] = first[previous];
            size++;
          }
        } else if (code === size && previous >= 0 && size < 4096) {
          prefix[size] = previous;
          suffix[size] = first[previous];
          length[size] = length[previous] + 1;
          first[size] = first[previous];
          size++;
          emit(code);
        } else {
          return this.account(out.result());
        }
        previous = code;
        const next = size + earlyChange;
        if (next >= 512 && codeLength === 9) codeLength = 10;
        else if (next >= 1024 && codeLength === 10) codeLength = 11;
        else if (next >= 2048 && codeLength === 11) codeLength = 12;
      }
    }
    return this.account(out.result());
  }

  runLength(data: Buffer): Buffer {
    const { cap, byBudget } = this.cap(data.length);
    const out = new ByteWriter(Math.min(cap, data.length * 2 + 64));
    for (let i = 0; i < data.length; ) {
      const length = data[i++];
      if (length === 128) break;
      if (length < 128) {
        for (let k = 0; k <= length && i < data.length; k++) out.push(data[i++]);
      } else {
        const value = data[i++];
        for (let k = 0; k < 257 - length; k++) out.push(value);
      }
      if (out.length > cap) throw new PdfError(byBudget ? "pdf_troppo_grande" : "pdf_bomba");
    }
    return this.account(out.result());
  }
}

function asciiHex(data: Buffer): Buffer {
  const out = new ByteWriter(data.length / 2 + 16);
  let high = -1;
  for (const c of data) {
    if (c === 0x3e) break;
    const v = hexValue(c);
    if (v < 0) continue;
    if (high < 0) high = v;
    else {
      out.push(high * 16 + v);
      high = -1;
    }
  }
  if (high >= 0) out.push(high * 16);
  return out.result();
}

function ascii85(data: Buffer): Buffer {
  const out = new ByteWriter(data.length + 16);
  const group: number[] = [];
  let i = 0;
  if (data[0] === 0x3c && data[1] === 0x7e) i = 2;
  for (; i < data.length; i++) {
    const c = data[i];
    if (c === 0x7e) break;
    if (WHITESPACE[c]) continue;
    if (c === 0x7a && group.length === 0) {
      for (let k = 0; k < 4; k++) out.push(0);
      continue;
    }
    if (c < 0x21 || c > 0x75) continue;
    group.push(c - 0x21);
    if (group.length === 5) {
      let value = 0;
      for (const g of group) value = value * 85 + g;
      for (const shift of [24, 16, 8, 0]) out.push((value >>> shift) & 0xff);
      group.length = 0;
    }
  }
  if (group.length > 1) {
    const count = group.length - 1;
    while (group.length < 5) group.push(84);
    let value = 0;
    for (const g of group) value = value * 85 + g;
    for (const shift of [24, 16, 8, 0].slice(0, count)) out.push((value >>> shift) & 0xff);
  }
  return out.result();
}

/** Predittori PNG (≥ 10) e TIFF (2, 8 bit) dei parametri di decodifica. */
function unpredict(data: Buffer, parms: PdfDict | null): Buffer | null {
  if (!parms) return data;
  const predictor = numberOf(parms.get("Predictor"), 1);
  if (predictor <= 1) return data;
  const colors = Math.max(1, Math.min(32, numberOf(parms.get("Colors"), 1)));
  const bits = numberOf(parms.get("BitsPerComponent"), 8);
  const columns = Math.max(1, Math.min(1 << 20, numberOf(parms.get("Columns"), 1)));
  if (![1, 2, 4, 8, 16].includes(bits)) return null;
  const bpp = Math.max(1, Math.ceil((colors * bits) / 8));
  const rowLength = Math.ceil((colors * bits * columns) / 8);
  if (predictor === 2) {
    if (bits !== 8) return null;
    const out = Buffer.from(data);
    for (let row = 0; row * rowLength < out.length; row++) {
      for (let i = row * rowLength + bpp; i < Math.min(out.length, (row + 1) * rowLength); i++) out[i] = (out[i] + out[i - bpp]) & 0xff;
    }
    return out;
  }
  if (predictor < 10) return null;
  const rows = Math.floor(data.length / (rowLength + 1));
  const out = Buffer.alloc(rows * rowLength);
  let prior = Buffer.alloc(rowLength);
  for (let r = 0; r < rows; r++) {
    const filter = data[r * (rowLength + 1)];
    const line = data.subarray(r * (rowLength + 1) + 1, (r + 1) * (rowLength + 1));
    const current = out.subarray(r * rowLength, (r + 1) * rowLength);
    for (let i = 0; i < rowLength; i++) {
      const left = i >= bpp ? current[i - bpp] : 0;
      const up = prior[i];
      const upLeft = i >= bpp ? prior[i - bpp] : 0;
      let value = line[i];
      switch (filter) {
        case 1:
          value += left;
          break;
        case 2:
          value += up;
          break;
        case 3:
          value += (left + up) >> 1;
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          break;
        }
      }
      current[i] = value & 0xff;
    }
    prior = current;
  }
  return out;
}

// ── Documento ─────────────────────────────────────────────────────────

interface PdfObject {
  value: PdfValue;
  /** Byte grezzi del flusso, se l'oggetto è un flusso. */
  raw: Buffer | null;
}

const OBJECT_HEADER = /(\d{1,10})[\t\n\f\r ]+(\d{1,5})[\t\n\f\r ]+obj(?![A-Za-z0-9])/g;

class PdfDocument {
  readonly objects = new Map<number, PdfObject>();
  readonly trailers: PdfDict[] = [];
  readonly buf: Buffer;
  readonly limits: PdfLimits;
  readonly decoder: Decoder;
  private readonly decodedCache = new Map<number, Decoded>();
  /** Budget condiviso dai lexer della struttura (oggetti, trailer, flussi di oggetti). */
  private readonly work: WorkBudget;

  constructor(buf: Buffer, limits: PdfLimits) {
    this.buf = buf;
    this.limits = limits;
    this.decoder = new Decoder(limits, { used: 0 });
    this.work = { left: PARSE_WORK_PER_BYTE * buf.length + PARSE_WORK_BASE };
  }

  parse(): void {
    const { buf } = this;
    const src = buf.toString("latin1");
    let streams = 0;
    let index = 0;
    for (;;) {
      OBJECT_HEADER.lastIndex = index;
      const match = OBJECT_HEADER.exec(src);
      if (!match) break;
      const before = match.index > 0 ? buf[match.index - 1] : 0x0a;
      if (!WHITESPACE[before] && !DELIMITER[before]) {
        index = match.index + match[1].length;
        continue;
      }
      if (this.objects.size >= this.limits.maxObjects) throw new PdfError("pdf_troppi_flussi");
      const lx = new Lexer(buf, match.index + match[0].length, buf.length, this.work);
      let value: PdfValue | undefined;
      try {
        value = parseValue(lx);
      } catch (error) {
        if (error instanceof PdfError && error.code === "pdf_non_valido") value = null;
        else throw error;
      }
      const afterValue = lx.pos;
      const keyword = lx.next();
      let raw: Buffer | null = null;
      let end = afterValue;
      if (keyword && keyword.t === "kw" && keyword.v === "stream" && isDict(value)) {
        if (++streams > this.limits.maxStreams) throw new PdfError("pdf_troppi_flussi");
        let start = lx.pos;
        if (buf[start] === 0x0d && buf[start + 1] === 0x0a) start += 2;
        else if (buf[start] === 0x0a || buf[start] === 0x0d) start += 1;
        let dataEnd = -1;
        const declared = value.get("Length");
        if (typeof declared === "number" && Number.isInteger(declared) && declared >= 0 && start + declared <= buf.length) {
          let k = start + declared;
          while (k < buf.length && WHITESPACE[buf[k]]) k++;
          if (src.startsWith("endstream", k)) dataEnd = start + declared;
        }
        if (dataEnd < 0) {
          const found = src.indexOf("endstream", start);
          dataEnd = found < 0 ? buf.length : found;
          if (found >= 0 && dataEnd > start && buf[dataEnd - 1] === 0x0a) dataEnd--;
          if (found >= 0 && dataEnd > start && buf[dataEnd - 1] === 0x0d) dataEnd--;
        }
        raw = buf.subarray(start, dataEnd);
        const close = src.indexOf("endstream", dataEnd);
        end = close < 0 ? buf.length : close + 9;
      }
      this.objects.set(Number(match[1]), { value: value === undefined ? null : value, raw });
      index = Math.max(end, match.index + match[0].length);
    }
    for (let at = src.indexOf("trailer"); at >= 0; at = src.indexOf("trailer", at + 7)) {
      const lx = new Lexer(buf, at + 7, buf.length, this.work);
      try {
        const value = parseValue(lx);
        if (isDict(value)) this.trailers.push(value);
      } catch (error) {
        // A broken trailer is ignored: objects are found by scanning. The work budget is not.
        if (error instanceof PdfError && error.code !== "pdf_non_valido") throw error;
      }
    }
    if (this.objects.size === 0) throw new PdfError("pdf_non_valido");
    this.expandObjectStreams();
  }

  private expandObjectStreams(): void {
    for (const [, object] of [...this.objects]) {
      if (!isDict(object.value) || nameOf(object.value.get("Type")) !== "ObjStm" || !object.raw) continue;
      const decoded = this.decodeObject(object);
      if (decoded.kind !== "data") continue;
      const count = Math.min(numberOf(this.resolve(object.value.get("N")), 0), this.limits.maxObjects);
      const first = numberOf(this.resolve(object.value.get("First")), 0);
      // The decompressed bytes are structure too: they extend the budget, linearly.
      this.work.left += PARSE_WORK_PER_BYTE * decoded.data.length;
      const header = new Lexer(decoded.data, 0, Math.min(first, decoded.data.length), this.work);
      const entries: [number, number][] = [];
      for (let k = 0; k < count; k++) {
        const num = header.next();
        const offset = header.next();
        if (!num || !offset || num.t !== "num" || offset.t !== "num") break;
        entries.push([num.v, offset.v]);
      }
      // Each object ends where the next one starts: its lexer never reads past it.
      const starts = [...new Set(entries.map(([, offset]) => first + offset))].filter((at) => at >= 0 && at < decoded.data.length).sort((a, b) => a - b);
      const endOf = (at: number) => {
        let lo = 0;
        let hi = starts.length;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (starts[mid] <= at) lo = mid + 1;
          else hi = mid;
        }
        return lo < starts.length ? starts[lo] : decoded.data.length;
      };
      for (const [num, offset] of entries) {
        if (this.objects.has(num)) continue;
        if (this.objects.size >= this.limits.maxObjects) throw new PdfError("pdf_troppi_flussi");
        const at = first + offset;
        if (at < 0 || at >= decoded.data.length) continue;
        try {
          const value = parseValue(new Lexer(decoded.data, at, endOf(at), this.work));
          this.objects.set(num, { value: value === undefined ? null : value, raw: null });
        } catch (error) {
          if (!(error instanceof PdfError && error.code === "pdf_non_valido")) throw error;
        }
      }
    }
  }

  resolve(value: PdfValue | undefined): PdfValue | undefined {
    let current = value;
    for (let hops = 0; current instanceof PdfRef && hops < 32; hops++) current = this.objects.get(current.num)?.value ?? null;
    return current instanceof PdfRef ? null : current;
  }

  dict(value: PdfValue | undefined): PdfDict | null {
    const resolved = this.resolve(value);
    return isDict(resolved) ? resolved : null;
  }

  /** L'oggetto flusso indicato dal valore (riferimento), oppure null. */
  streamObject(value: PdfValue | undefined): { num: number; object: PdfObject } | null {
    if (!(value instanceof PdfRef)) return null;
    const object = this.objects.get(value.num);
    return object?.raw && isDict(object.value) ? { num: value.num, object } : null;
  }

  decodeObject(object: PdfObject, num?: number): Decoded {
    if (num !== undefined) {
      const cached = this.decodedCache.get(num);
      if (cached) return cached;
    }
    const result = this.decode(object);
    if (num !== undefined) this.decodedCache.set(num, result);
    return result;
  }

  private decode(object: PdfObject): Decoded {
    if (!object.raw || !isDict(object.value)) return { kind: "unsupported" };
    const dict = object.value;
    if (dict.has("F") && !dict.has("Filter")) return { kind: "unsupported" };
    const filterValue = this.resolve(dict.get("Filter"));
    const filters = (Array.isArray(filterValue) ? filterValue.map((f) => this.resolve(f)) : filterValue == null ? [] : [filterValue])
      .map((f) => nameOf(f ?? undefined))
      .filter((f): f is string => f !== null);
    const parmsValue = this.resolve(dict.get("DecodeParms"));
    const parmsList = Array.isArray(parmsValue) ? parmsValue.map((p) => this.dict(p)) : [this.dict(parmsValue ?? undefined)];
    let data: Buffer | null = object.raw;
    for (let k = 0; k < filters.length && data; k++) {
      const filter = filters[k];
      const parms = parmsList[k] ?? null;
      if (IMAGE_FILTERS.has(filter)) return { kind: "image" };
      switch (filter) {
        case "FlateDecode":
        case "Fl":
          data = this.decoder.inflate(data);
          data = data && unpredict(data, parms);
          break;
        case "LZWDecode":
        case "LZW":
          data = unpredict(this.decoder.lzw(data, parms ? numberOf(parms.get("EarlyChange"), 1) : 1), parms);
          break;
        case "ASCIIHexDecode":
        case "AHx":
          data = asciiHex(data);
          break;
        case "ASCII85Decode":
        case "A85":
          data = ascii85(data);
          break;
        case "RunLengthDecode":
        case "RL":
          data = this.decoder.runLength(data);
          break;
        case "Crypt":
          if (nameOf(parms?.get("Name")) !== "Identity" && parms?.get("Name") !== undefined) return { kind: "unsupported" };
          break;
        default:
          return { kind: "unsupported" };
      }
    }
    return data ? { kind: "data", data } : { kind: "unsupported" };
  }

  encrypted(): boolean {
    if (this.trailers.some((t) => t.has("Encrypt"))) return true;
    for (const object of this.objects.values()) {
      if (isDict(object.value) && nameOf(object.value.get("Type")) === "XRef" && object.value.has("Encrypt")) return true;
    }
    return false;
  }

  catalog(): PdfDict | null {
    const roots: PdfValue[] = [];
    for (const trailer of this.trailers) if (trailer.has("Root")) roots.push(trailer.get("Root") as PdfValue);
    for (const object of this.objects.values()) {
      if (isDict(object.value) && nameOf(object.value.get("Type")) === "XRef" && object.value.has("Root")) roots.push(object.value.get("Root") as PdfValue);
    }
    for (let i = roots.length - 1; i >= 0; i--) {
      const root = this.dict(roots[i]);
      if (root && root.has("Pages")) return root;
    }
    for (const object of this.objects.values()) if (isDict(object.value) && nameOf(object.value.get("Type")) === "Catalog") return object.value;
    return null;
  }
}

// ── Testo dei PDF: codifiche, glifi, CMap ─────────────────────────────

const PDF_DOC_HIGH = [
  "•", "†", "‡", "…", "—", "–", "ƒ", "⁄", "‹", "›", "−", "‰", "„", "“", "”", "‘",
  "’", "‚", "™", "ﬁ", "ﬂ", "Ł", "Œ", "Š", "Ÿ", "Ž", "ı", "ł", "œ", "š", "ž", "�",
  "€",
];

/** Stringa di testo PDF (annotazioni, campi): UTF-16BE con BOM, UTF-8 con BOM o PDFDocEncoding. */
function pdfTextString(bytes: Buffer): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return utf16be(bytes.subarray(2));
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return bytes.subarray(3).toString("utf8");
  let out = "";
  for (const b of bytes) out += b >= 0x80 && b <= 0xa0 ? PDF_DOC_HIGH[b - 0x80] : String.fromCharCode(b);
  return out;
}

function utf16be(bytes: Buffer): string {
  const even = bytes.length - (bytes.length % 2);
  const swapped = Buffer.from(bytes.subarray(0, even));
  swapped.swap16();
  return swapped.toString("utf16le");
}

let winAnsi: string[] | null = null;
let macRoman: string[] | null = null;

function singleByteTable(label: string): string[] {
  const table: string[] = [];
  let decoder: TextDecoder | null = null;
  try {
    decoder = new TextDecoder(label);
  } catch {
    decoder = null;
  }
  for (let b = 0; b < 256; b++) table.push(decoder ? decoder.decode(Uint8Array.of(b)) : String.fromCharCode(b));
  return table;
}

function baseEncoding(name: string | null): string[] {
  if (name === "MacRomanEncoding") return (macRoman ??= singleByteTable("macintosh"));
  const table = (winAnsi ??= [...windows1252Table()]);
  if (name === "StandardEncoding") {
    const standard = [...table];
    standard[0x27] = "’";
    standard[0x60] = "‘";
    return standard;
  }
  return table;
}

const GLYPH_NAMES: Readonly<Record<string, string>> = {
  space: " ", nbspace: " ", exclam: "!", quotedbl: '"', numbersign: "#", dollar: "$", percent: "%", ampersand: "&",
  quotesingle: "'", quoteright: "’", quoteleft: "‘", parenleft: "(", parenright: ")", asterisk: "*", plus: "+",
  comma: ",", hyphen: "-", minus: "−", period: ".", slash: "/", colon: ":", semicolon: ";", less: "<", equal: "=",
  greater: ">", question: "?", at: "@", bracketleft: "[", backslash: "\\", bracketright: "]", asciicircum: "^",
  underscore: "_", grave: "`", braceleft: "{", bar: "|", braceright: "}", asciitilde: "~", endash: "–",
  emdash: "—", bullet: "•", ellipsis: "…", quotedblleft: "“", quotedblright: "”",
  quotesinglbase: "‚", quotedblbase: "„", guillemotleft: "«", guillemotright: "»", Euro: "€",
  degree: "°", section: "§", paragraph: "¶", copyright: "©", registered: "®",
  trademark: "™", dagger: "†", daggerdbl: "‡", germandbls: "ß", ae: "æ", AE: "Æ",
  oe: "œ", OE: "Œ", oslash: "ø", Oslash: "Ø", dotlessi: "ı", fi: "ﬁ", fl: "ﬂ",
  ff: "ff", ffi: "ffi", ffl: "ffl", zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6",
  seven: "7", eight: "8", nine: "9", periodcentered: "·", multiply: "×", divide: "÷",
};

const ACCENTS: Readonly<Record<string, string>> = {
  grave: "̀", acute: "́", circumflex: "̂", tilde: "̃", dieresis: "̈", ring: "̊",
  cedilla: "̧", caron: "̌",
};

/** Unicode di un nome di glifo (AGL ridotto), oppure null se sconosciuto. */
export function glyphToUnicode(name: string): string | null {
  if (!name) return null;
  const base = name.split(".")[0];
  if (!base) return null;
  if (base.includes("_")) {
    const parts = base.split("_").map(glyphToUnicode);
    return parts.every((p): p is string => p !== null) ? parts.join("") : null;
  }
  if (/^[A-Za-z]$/.test(base)) return base;
  if (Object.hasOwn(GLYPH_NAMES, base)) return GLYPH_NAMES[base];
  const uni = /^uni((?:[0-9A-Fa-f]{4})+)$/.exec(base);
  if (uni) {
    const units = uni[1].match(/.{4}/g)!.map((h) => parseInt(h, 16));
    if (units.some((u) => u >= 0xd800 && u <= 0xdfff)) return null;
    return String.fromCharCode(...units);
  }
  const u = /^u([0-9A-Fa-f]{4,6})$/.exec(base);
  if (u) {
    const code = parseInt(u[1], 16);
    return code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : null;
  }
  const accented = /^([A-Za-z])(grave|acute|circumflex|tilde|dieresis|ring|cedilla|caron)$/.exec(base);
  if (accented) return (accented[1] + ACCENTS[accented[2]]).normalize("NFC");
  return null;
}

interface CodeSpace {
  length: number;
  lo: number;
  hi: number;
}

interface CMapRange {
  length: number;
  lo: number;
  hi: number;
  base: string | null;
  list: string[] | null;
}

interface ToUnicodeMap {
  lengths: number[];
  spaces: CodeSpace[];
  single: Map<string, string>;
  ranges: CMapRange[];
}

const MAX_CMAP_ENTRIES = 200_000;

function codeValue(bytes: Buffer): number {
  let v = 0;
  for (const b of bytes) v = v * 256 + b;
  return v;
}

function cmapTarget(value: Buffer | PdfName): string {
  if (value instanceof PdfName) return glyphToUnicode(value.name) ?? "�";
  if (value.length === 1) return String.fromCharCode(value[0]);
  return utf16be(value);
}

/** Legge una CMap `ToUnicode` (codespace, bfchar, bfrange). */
function parseToUnicode(data: Buffer, defaultLength: number): ToUnicodeMap {
  const lx = new Lexer(data);
  const spaces: CodeSpace[] = [];
  const single = new Map<string, string>();
  const ranges: CMapRange[] = [];
  const pending: (Buffer | PdfName | Buffer[])[] = [];
  let entries = 0;
  for (;;) {
    const tok = lx.next();
    if (!tok) break;
    if (tok.t === "str") pending.push(tok.v);
    else if (tok.t === "name") pending.push(new PdfName(tok.v));
    else if (tok.t === "[") {
      const list: Buffer[] = [];
      for (;;) {
        const item = lx.next();
        if (!item || item.t === "]") break;
        if (item.t === "str" && list.length < 65_536) list.push(item.v);
      }
      pending.push(list);
    } else if (tok.t === "kw") {
      switch (tok.v) {
        case "begincodespacerange":
        case "beginbfchar":
        case "beginbfrange":
          pending.length = 0;
          break;
        case "endcodespacerange":
          for (let i = 0; i + 1 < pending.length; i += 2) {
            const lo = pending[i];
            const hi = pending[i + 1];
            if (Buffer.isBuffer(lo) && Buffer.isBuffer(hi) && lo.length >= 1 && lo.length <= 4 && lo.length === hi.length) {
              spaces.push({ length: lo.length, lo: codeValue(lo), hi: codeValue(hi) });
            }
          }
          pending.length = 0;
          break;
        case "endbfchar":
          for (let i = 0; i + 1 < pending.length && entries < MAX_CMAP_ENTRIES; i += 2) {
            const src = pending[i];
            const dst = pending[i + 1];
            if (!Buffer.isBuffer(src) || src.length < 1 || src.length > 4 || Array.isArray(dst)) continue;
            single.set(`${src.length}:${codeValue(src)}`, cmapTarget(dst));
            entries++;
          }
          pending.length = 0;
          break;
        case "endbfrange":
          for (let i = 0; i + 2 < pending.length && entries < MAX_CMAP_ENTRIES; i += 3) {
            const lo = pending[i];
            const hi = pending[i + 1];
            const dst = pending[i + 2];
            if (!Buffer.isBuffer(lo) || !Buffer.isBuffer(hi) || lo.length < 1 || lo.length > 4 || lo.length !== hi.length) continue;
            const loValue = codeValue(lo);
            const hiValue = Math.min(codeValue(hi), loValue + 65_535);
            if (hiValue < loValue) continue;
            if (Array.isArray(dst)) ranges.push({ length: lo.length, lo: loValue, hi: hiValue, base: null, list: dst.map((d) => cmapTarget(d)) });
            else if (Buffer.isBuffer(dst)) ranges.push({ length: lo.length, lo: loValue, hi: hiValue, base: cmapTarget(dst), list: null });
            entries++;
          }
          pending.length = 0;
          break;
      }
    }
  }
  const lengths = new Set<number>(spaces.map((s) => s.length));
  if (lengths.size === 0) {
    for (const key of single.keys()) lengths.add(Number(key.split(":")[0]));
    for (const range of ranges) lengths.add(range.length);
  }
  if (lengths.size === 0) lengths.add(defaultLength);
  return { lengths: [...lengths].sort((a, b) => a - b), spaces, single, ranges };
}

function cmapLookup(map: ToUnicodeMap, length: number, code: number): string | undefined {
  const direct = map.single.get(`${length}:${code}`);
  if (direct !== undefined) return direct;
  for (const range of map.ranges) {
    if (range.length !== length || code < range.lo || code > range.hi) continue;
    if (range.list) return range.list[code - range.lo];
    if (range.base) {
      const last = range.base.charCodeAt(range.base.length - 1) + (code - range.lo);
      return range.base.slice(0, -1) + String.fromCharCode(last & 0xffff);
    }
  }
  return undefined;
}

interface FontInfo {
  /** Font composito (Type0): codici a più byte. */
  composite: boolean;
  toUnicode: ToUnicodeMap | null;
  /** Font semplice: tabella dei 256 codici (null = glifo sconosciuto). */
  table: (string | null)[] | null;
  /** Font composito con CMap Unicode predefinita (UCS2/UTF16). */
  ucs2: boolean;
}

interface Decoded16 {
  text: string;
  glyphs: number;
  undecodable: number;
}

function decodeShown(bytes: Buffer, font: FontInfo | null): Decoded16 {
  if (!font) {
    const table = baseEncoding(null);
    let text = "";
    for (const b of bytes) text += table[b];
    return { text, glyphs: bytes.length, undecodable: 0 };
  }
  let text = "";
  let glyphs = 0;
  let undecodable = 0;
  if (font.toUnicode) {
    const map = font.toUnicode;
    for (let i = 0; i < bytes.length; ) {
      let length = map.lengths[0];
      for (const candidate of map.lengths) {
        if (i + candidate > bytes.length) break;
        const code = codeValue(bytes.subarray(i, i + candidate));
        if (map.spaces.length === 0 || map.spaces.some((s) => s.length === candidate && code >= s.lo && code <= s.hi)) {
          length = candidate;
          break;
        }
      }
      length = Math.max(1, Math.min(length, bytes.length - i));
      const code = codeValue(bytes.subarray(i, i + length));
      i += length;
      glyphs++;
      let mapped = cmapLookup(map, length, code);
      if (mapped === undefined && !font.composite && font.table && length === 1) mapped = font.table[code] ?? undefined;
      if (mapped === undefined) {
        undecodable++;
        text += "�";
      } else text += mapped;
    }
    return { text, glyphs, undecodable };
  }
  if (font.composite) {
    const count = Math.ceil(bytes.length / 2);
    if (font.ucs2) return { text: utf16be(bytes), glyphs: count, undecodable: 0 };
    return { text: "�".repeat(count), glyphs: count, undecodable: count };
  }
  const table = font.table ?? baseEncoding(null);
  for (const b of bytes) {
    glyphs++;
    const mapped = table[b];
    if (mapped === null || mapped === undefined) {
      undecodable++;
      text += "�";
    } else text += mapped;
  }
  return { text, glyphs, undecodable };
}

// ── Raccolta del testo ────────────────────────────────────────────────

class TextSink {
  private readonly parts: string[] = [];
  private length = 0;
  private last = "\n";
  truncated = false;
  readonly max: number;

  constructor(max: number) {
    this.max = max;
  }

  write(text: string): void {
    if (!text || this.truncated) return;
    const room = this.max - this.length;
    if (room <= 0) {
      this.truncated = true;
      return;
    }
    const piece = text.length > room ? text.slice(0, room) : text;
    if (piece.length < text.length) this.truncated = true;
    this.parts.push(piece);
    this.length += piece.length;
    this.last = piece[piece.length - 1];
  }

  space(): void {
    if (this.last !== " " && this.last !== "\n") this.write(" ");
  }

  newline(): void {
    if (this.last !== "\n") this.write("\n");
  }

  toString(): string {
    return this.parts.join("");
  }
}

interface Counters {
  glyphs: number;
  undecodable: number;
  runs: number;
  singleGlyphRuns: number;
  unreadableContent: number;
  operations: number;
}

interface PageStats {
  letters: number;
  images: number;
}

const NOT_LETTER = /\P{L}+/gu;

function countLetters(text: string): number {
  return text ? text.replace(NOT_LETTER, "").length : 0;
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function translate(m: Matrix, tx: number, ty: number): Matrix {
  return [m[0], m[1], m[2], m[3], tx * m[0] + ty * m[2] + m[4], tx * m[1] + ty * m[3] + m[5]];
}

/** Chiavi i cui valori stringa sono testo dell'utente (annotazioni, campi, segnalibri). */
const TEXT_KEYS = new Set(["Contents", "V", "RC", "Title", "Subj", "TU", "Alt", "ActualText", "E"]);
/** Chiavi che puntano a flussi senza testo dell'utente. */
const NON_CONTENT_KEYS = new Set(["FontFile", "FontFile2", "FontFile3", "ToUnicode", "CIDSet", "CIDToGIDMap", "Metadata", "Thumb", "Encoding", "SMask", "Mask"]);

class Extractor {
  readonly doc: PdfDocument;
  readonly limits: PdfLimits;
  readonly sink: TextSink;
  readonly counters: Counters = { glyphs: 0, undecodable: 0, runs: 0, singleGlyphRuns: 0, unreadableContent: 0, operations: 0 };
  private readonly fontCache = new Map<PdfDict, FontInfo>();
  private readonly cmapCache = new Map<number, ToUnicodeMap | null>();
  private readonly formStats = new Map<number, PageStats>();
  private readonly visitedStreams = new Set<number>();
  private fontIndex: Map<string, PdfDict[]> | null = null;

  constructor(doc: PdfDocument, limits: PdfLimits) {
    this.doc = doc;
    this.limits = limits;
    this.sink = new TextSink(limits.maxTextChars);
  }

  // Fonts.

  private font(value: PdfValue | undefined): FontInfo | null {
    const dict = this.doc.dict(value);
    if (!dict) return null;
    const cached = this.fontCache.get(dict);
    if (cached) return cached;
    const subtype = nameOf(this.doc.resolve(dict.get("Subtype")));
    const composite = subtype === "Type0";
    const toUnicodeRef = dict.get("ToUnicode");
    let toUnicode: ToUnicodeMap | null = null;
    const stream = this.doc.streamObject(toUnicodeRef);
    if (stream) {
      if (this.cmapCache.has(stream.num)) toUnicode = this.cmapCache.get(stream.num) ?? null;
      else {
        const decoded = this.doc.decodeObject(stream.object, stream.num);
        toUnicode = decoded.kind === "data" ? parseToUnicode(decoded.data, composite ? 2 : 1) : null;
        this.cmapCache.set(stream.num, toUnicode);
      }
    }
    let table: (string | null)[] | null = null;
    let ucs2 = false;
    const encoding = this.doc.resolve(dict.get("Encoding"));
    if (composite) {
      const name = nameOf(encoding ?? undefined);
      ucs2 = name !== null && /^Uni.*-(?:UCS2|UTF16)-[HV]$/.test(name);
    } else {
      let base: string | null = null;
      let differences: PdfValue[] | null = null;
      if (encoding instanceof PdfName) base = encoding.name;
      else if (isDict(encoding)) {
        base = nameOf(this.doc.resolve(encoding.get("BaseEncoding")));
        const diff = this.doc.resolve(encoding.get("Differences"));
        if (Array.isArray(diff)) differences = diff;
      }
      table = [...baseEncoding(base)];
      if (differences) {
        let code = 0;
        for (const item of differences) {
          if (typeof item === "number") code = Math.trunc(item);
          else if (item instanceof PdfName && code >= 0 && code < 256) table[code++] = glyphToUnicode(item.name);
        }
      }
    }
    const info: FontInfo = { composite, toUnicode, table, ucs2 };
    this.fontCache.set(dict, info);
    return info;
  }

  private buildFontIndex(): Map<string, PdfDict[]> {
    const index = new Map<string, PdfDict[]>();
    for (const object of this.doc.objects.values()) {
      const walk = (value: PdfValue | undefined, depth: number) => {
        if (depth > 4 || !isDict(value)) return;
        const fonts = this.doc.dict(value.get("Font"));
        if (fonts) {
          for (const [name, ref] of fonts) {
            const fontDict = this.doc.dict(ref);
            if (!fontDict || nameOf(fontDict.get("Type")) !== "Font") continue;
            const list = index.get(name) ?? [];
            if (!list.includes(fontDict)) list.push(fontDict);
            index.set(name, list);
          }
        }
        const resources = value.get("Resources");
        if (isDict(resources)) walk(resources, depth + 1);
      };
      walk(object.value, 0);
    }
    return index;
  }

  /** Font per nome: dalle risorse, oppure (contenuti senza risorse) dall'indice di tutto il documento. */
  private fontByName(resources: PdfDict | null, name: string): FontInfo | null {
    const fonts = resources ? this.doc.dict(resources.get("Font")) : null;
    if (fonts?.has(name)) return this.font(fonts.get(name));
    this.fontIndex ??= this.buildFontIndex();
    const candidates = this.fontIndex.get(name);
    return candidates && candidates.length > 0 ? this.font(candidates[0]) : null;
  }

  // Content streams.

  private contentOf(value: PdfValue | undefined): Buffer | null {
    const parts: Buffer[] = [];
    const refs = Array.isArray(value) ? value : [value];
    let unreadable = false;
    for (const ref of refs) {
      const stream = this.doc.streamObject(ref as PdfValue | undefined);
      if (!stream) {
        const resolved = this.doc.resolve(ref as PdfValue | undefined);
        if (Array.isArray(resolved)) {
          const nested = this.contentOf(resolved);
          if (nested) parts.push(nested, Buffer.from("\n"));
        }
        continue;
      }
      this.visitedStreams.add(stream.num);
      const decoded = this.doc.decodeObject(stream.object, stream.num);
      if (decoded.kind === "data") parts.push(decoded.data, Buffer.from("\n"));
      else unreadable = true;
    }
    if (unreadable) this.counters.unreadableContent++;
    return parts.length > 0 ? Buffer.concat(parts) : null;
  }

  private run(data: Buffer, resources: PdfDict | null, depth: number, stats: PageStats): void {
    const lx = new Lexer(data);
    const operands: PdfValue[] = [];
    let font: FontInfo | null = null;
    let fontSize = 1;
    let leading = 0;
    let tm: Matrix = IDENTITY;
    let lm: Matrix = IDENTITY;
    let predicted: { x: number; y: number } | null = null;
    let lastRunGlyphs = 0;
    const saved: { font: FontInfo | null; fontSize: number }[] = [];
    const sink = this.sink;
    const counters = this.counters;

    const reposition = (next: Matrix) => {
      tm = next;
      if (!predicted) return;
      const em = Math.max(Math.abs(fontSize) * Math.hypot(tm[0], tm[1]), 1e-6);
      const dy = Math.abs(tm[5] - predicted.y);
      const gap = tm[4] - predicted.x;
      if (dy > em * 0.5) sink.newline();
      else if (!(lastRunGlyphs <= 1 && gap < em * 0.35 && gap > -em * 0.5)) sink.space();
      predicted = null;
    };

    const show = (items: PdfValue[]) => {
      let glyphs = 0;
      let advance = 0;
      for (const item of items) {
        if (Buffer.isBuffer(item)) {
          const decoded = decodeShown(item, font);
          sink.write(decoded.text);
          glyphs += decoded.glyphs;
          counters.glyphs += decoded.glyphs;
          counters.undecodable += decoded.undecodable;
          stats.letters += countLetters(decoded.text);
          advance += decoded.glyphs * 0.5;
        } else if (typeof item === "number") {
          if (-item / 1000 > 0.18) sink.space();
          advance -= item / 1000;
        }
      }
      if (glyphs === 0) return;
      counters.runs++;
      if (glyphs === 1) counters.singleGlyphRuns++;
      lastRunGlyphs = glyphs;
      const distance = advance * fontSize;
      tm = [tm[0], tm[1], tm[2], tm[3], tm[4] + distance * tm[0], tm[5] + distance * tm[1]];
      predicted = { x: tm[4], y: tm[5] };
    };

    for (;;) {
      const tok = lx.next();
      if (!tok) break;
      if (++counters.operations > this.limits.maxOperations) {
        sink.truncated = true;
        break;
      }
      if (tok.t !== "kw") {
        let value: PdfValue | undefined;
        try {
          value = valueFrom(lx, tok, 0, false);
        } catch {
          value = undefined;
        }
        if (value !== undefined && operands.length < 64) operands.push(value);
        continue;
      }
      const op = tok.v;
      switch (op) {
        case "BT":
          tm = lm = IDENTITY;
          predicted = null;
          break;
        case "ET":
          sink.newline();
          predicted = null;
          break;
        case "Tf": {
          const name = nameOf(operands[0]);
          font = name ? this.fontByName(resources, name) : null;
          fontSize = numberOf(operands[1], 1) || 1;
          break;
        }
        case "TL":
          leading = numberOf(operands[0], 0);
          break;
        case "Td":
          lm = translate(lm, numberOf(operands[0], 0), numberOf(operands[1], 0));
          reposition(lm);
          break;
        case "TD":
          leading = -numberOf(operands[1], 0);
          lm = translate(lm, numberOf(operands[0], 0), numberOf(operands[1], 0));
          reposition(lm);
          break;
        case "Tm":
          lm = operands.length >= 6 ? (operands.slice(0, 6).map((v) => numberOf(v, 0)) as Matrix) : IDENTITY;
          reposition(lm);
          break;
        case "T*":
          sink.newline();
          lm = translate(lm, 0, -leading);
          tm = lm;
          predicted = null;
          break;
        case "Tj":
          if (Buffer.isBuffer(operands[0])) show([operands[0]]);
          break;
        case "'":
          sink.newline();
          lm = translate(lm, 0, -leading);
          tm = lm;
          predicted = null;
          if (Buffer.isBuffer(operands[0])) show([operands[0]]);
          break;
        case '"':
          sink.newline();
          lm = translate(lm, 0, -leading);
          tm = lm;
          predicted = null;
          if (Buffer.isBuffer(operands[2])) show([operands[2]]);
          break;
        case "TJ":
          if (Array.isArray(operands[0])) show(operands[0]);
          break;
        case "q":
          if (saved.length < 64) saved.push({ font, fontSize });
          break;
        case "Q": {
          const restored = saved.pop();
          if (restored) ({ font, fontSize } = restored);
          break;
        }
        case "Do": {
          const name = nameOf(operands[0]);
          if (name) this.xobject(resources, name, depth, stats);
          break;
        }
        case "BI":
          stats.images++;
          skipInlineImage(lx);
          break;
      }
      operands.length = 0;
    }
    sink.newline();
  }

  private xobject(resources: PdfDict | null, name: string, depth: number, stats: PageStats): void {
    const xobjects = resources ? this.doc.dict(resources.get("XObject")) : null;
    const ref = xobjects?.get(name);
    const stream = this.doc.streamObject(ref);
    if (!stream || !isDict(stream.object.value)) return;
    const dict = stream.object.value;
    const subtype = nameOf(this.doc.resolve(dict.get("Subtype")));
    if (subtype === "Image") {
      stats.images++;
      this.visitedStreams.add(stream.num);
      return;
    }
    if (subtype !== "Form") return;
    const known = this.formStats.get(stream.num);
    if (known) {
      stats.letters += known.letters;
      stats.images += known.images;
      return;
    }
    if (depth >= this.limits.maxFormDepth) return;
    const own: PageStats = { letters: 0, images: 0 };
    this.formStats.set(stream.num, own);
    this.visitedStreams.add(stream.num);
    const decoded = this.doc.decodeObject(stream.object, stream.num);
    if (decoded.kind !== "data") {
      this.counters.unreadableContent++;
      return;
    }
    const formResources = this.doc.dict(dict.get("Resources")) ?? resources;
    this.run(decoded.data, formResources, depth + 1, own);
    stats.letters += own.letters;
    stats.images += own.images;
  }

  // Pages.

  private pages(): { page: PdfDict; resources: PdfDict | null }[] {
    const out: { page: PdfDict; resources: PdfDict | null }[] = [];
    const seen = new Set<PdfDict>();
    const walk = (node: PdfDict | null, inherited: PdfDict | null, depth: number) => {
      if (!node || seen.has(node) || depth > 64 || out.length >= this.limits.maxPages) return;
      seen.add(node);
      const resources = this.doc.dict(node.get("Resources")) ?? inherited;
      const kids = this.doc.resolve(node.get("Kids"));
      if (nameOf(node.get("Type")) !== "Page" && Array.isArray(kids)) {
        for (const kid of kids) walk(this.doc.dict(kid), resources, depth + 1);
      } else out.push({ page: node, resources });
    };
    const catalog = this.doc.catalog();
    walk(catalog ? this.doc.dict(catalog.get("Pages")) : null, null, 0);
    if (out.length === 0) {
      const numbers = [...this.doc.objects.keys()].sort((a, b) => a - b);
      for (const num of numbers) {
        const value = this.doc.objects.get(num)?.value;
        if (!isDict(value) || nameOf(value.get("Type")) !== "Page") continue;
        let resources = this.doc.dict(value.get("Resources"));
        let parent = this.doc.dict(value.get("Parent"));
        for (let hops = 0; !resources && parent && hops < 32; hops++) {
          resources = this.doc.dict(parent.get("Resources"));
          parent = this.doc.dict(parent.get("Parent"));
        }
        out.push({ page: value, resources });
        if (out.length >= this.limits.maxPages) break;
      }
    }
    return out;
  }

  extract(): { pages: number; imagePagesWithoutText: number } {
    const pages = this.pages();
    let imagePagesWithoutText = 0;
    for (const { page, resources } of pages) {
      const stats: PageStats = { letters: 0, images: 0 };
      const content = this.contentOf(page.get("Contents"));
      if (content) this.run(content, resources, 0, stats);
      if (stats.images > 0 && stats.letters < PDF_LOW_TEXT.imagePageMinLetters) imagePagesWithoutText++;
      this.sink.newline();
    }
    this.extraStrings();
    this.orphanContent();
    return { pages: pages.length, imagePagesWithoutText };
  }

  /** Testi di annotazioni, campi dei moduli e segnalibri. */
  private extraStrings(): void {
    const visit = (value: PdfValue | undefined, depth: number) => {
      if (depth > 4) return;
      if (Array.isArray(value)) {
        for (const item of value) visit(item, depth + 1);
        return;
      }
      if (!isDict(value)) return;
      if (nameOf(value.get("Type")) === "Sig" || value.has("ByteRange")) return;
      for (const [key, item] of value) {
        if (TEXT_KEYS.has(key) && Buffer.isBuffer(item)) {
          const text = pdfTextString(item).replace(/<[^>]{0,500}>/g, " ");
          if (text.trim()) {
            this.sink.write(text);
            this.sink.newline();
          }
        } else if (isDict(item) || Array.isArray(item)) visit(item, depth + 1);
      }
    };
    for (const object of this.doc.objects.values()) if (!object.raw) visit(object.value, 0);
  }

  /** Flussi di contenuto che nessuna pagina usa: testo nascosto, versioni precedenti, moduli sciolti. */
  private orphanContent(): void {
    const nonContent = new Set<number>();
    const collect = (value: PdfValue | undefined, depth: number) => {
      if (depth > 4) return;
      if (Array.isArray(value)) for (const item of value) collect(item, depth + 1);
      else if (isDict(value)) {
        for (const [key, item] of value) {
          if (NON_CONTENT_KEYS.has(key) && item instanceof PdfRef) nonContent.add(item.num);
          else if (isDict(item) || Array.isArray(item)) collect(item, depth + 1);
        }
      }
    };
    for (const object of this.doc.objects.values()) collect(object.value, 0);
    const numbers = [...this.doc.objects.keys()].sort((a, b) => a - b);
    for (const num of numbers) {
      if (this.visitedStreams.has(num) || nonContent.has(num)) continue;
      const object = this.doc.objects.get(num)!;
      if (!object.raw || !isDict(object.value)) continue;
      const dict = object.value;
      const type = nameOf(dict.get("Type"));
      const subtype = nameOf(this.doc.resolve(dict.get("Subtype")));
      if (type && ["XRef", "ObjStm", "Metadata", "EmbeddedFile", "Pattern"].includes(type)) continue;
      if (subtype && subtype !== "Form") continue;
      if (dict.has("Length1") || dict.has("Length2") || dict.has("N")) continue;
      const decoded = this.doc.decodeObject(object, num);
      if (decoded.kind !== "data") continue;
      const head = decoded.data.toString("latin1", 0, Math.min(decoded.data.length, 1 * MIB));
      if (!/\bBT\b/.test(head) || !/(?:Tj|TJ|')/.test(head)) continue;
      this.visitedStreams.add(num);
      this.run(decoded.data, this.doc.dict(dict.get("Resources")), 0, { letters: 0, images: 0 });
    }
  }
}

function skipInlineImage(lx: Lexer): void {
  // Skip the image dictionary up to `ID`, then the binary data up to `EI`.
  for (;;) {
    const tok = lx.next();
    if (!tok) return;
    if (tok.t === "kw" && tok.v === "ID") break;
  }
  const { buf, end } = lx;
  let i = lx.pos + 1;
  for (; i + 1 < end; i++) {
    if (buf[i] === 0x45 && buf[i + 1] === 0x49 && WHITESPACE[buf[i - 1]] && (i + 2 >= end || WHITESPACE[buf[i + 2]] || DELIMITER[buf[i + 2]])) {
      lx.pos = i + 2;
      return;
    }
  }
  lx.pos = end;
}

// ── Contenuti attivi e allegati ───────────────────────────────────────

function activeContent(doc: PdfDocument): PdfErrorCode | null {
  let found: PdfErrorCode | null = null;
  const visit = (value: PdfValue | undefined, depth: number) => {
    if (found === "oggetto_incorporato" || depth > 6) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (!isDict(value)) return;
    if (value.has("EmbeddedFiles") || value.has("EF") || nameOf(value.get("Type")) === "EmbeddedFile") {
      found = "oggetto_incorporato";
      return;
    }
    const action = nameOf(value.get("S"));
    if (value.has("JS") || value.has("JavaScript") || action === "JavaScript" || action === "Launch") found ??= "contenuto_attivo";
    for (const item of value.values()) if (isDict(item) || Array.isArray(item)) visit(item, depth + 1);
  };
  for (const object of doc.objects.values()) visit(object.value, 0);
  return found;
}

// ── Indicatori ────────────────────────────────────────────────────────

function nonPrintableRatio(text: string): number {
  let visible = 0;
  let bad = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x20 || c === 0x0a || c === 0x09 || c === 0x0d || c === 0xa0) continue;
    visible++;
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0xfffd || (c >= 0xe000 && c <= 0xf8ff) || c >= 0xfff0) bad++;
  }
  return visible === 0 ? 0 : bad / visible;
}

/**
 * Estrae il testo di un PDF per i controlli. Fallisce su PDF non validi,
 * cifrati, con script, con allegati o oltre i limiti; altrimenti restituisce
 * il testo e il segnale `lowText` per la revisione a mano.
 */
export function extractPdfText(bytes: Uint8Array, limits: PdfLimits = PDF_LIMITS): Result<PdfText> {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!looksLikePdf(buf)) return fail("pdf_non_valido", PDF_MESSAGES.pdf_non_valido);
  try {
    const doc = new PdfDocument(buf, limits);
    doc.parse();
    if (doc.encrypted()) throw new PdfError("pdf_cifrato");
    const active = activeContent(doc);
    if (active) throw new PdfError(active);
    const extractor = new Extractor(doc, limits);
    const { pages, imagePagesWithoutText } = extractor.extract();
    const text = extractor.sink.toString().replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    const letters = countLetters(text);
    const ratio = nonPrintableRatio(text);
    const { glyphs, undecodable, runs, singleGlyphRuns, unreadableContent } = extractor.counters;
    const reasons: LowTextReason[] = [];
    if (letters < PDF_LOW_TEXT.minLetters) reasons.push("poche_lettere");
    if (ratio > PDF_LOW_TEXT.maxNonPrintableRatio) reasons.push("caratteri_non_stampabili");
    if (undecodable > Math.max(PDF_LOW_TEXT.undecodableGlyphs, glyphs * PDF_LOW_TEXT.undecodableRatio)) reasons.push("font_senza_mappa");
    if (unreadableContent > 0) reasons.push("flussi_non_leggibili");
    if (imagePagesWithoutText > 0) reasons.push("pagine_immagine");
    if (runs >= PDF_LOW_TEXT.fragmentedMinRuns && singleGlyphRuns / runs > PDF_LOW_TEXT.fragmentedRatio) reasons.push("testo_frammentato");
    // Text past the limits was not checked: a person has to look at it.
    if (extractor.sink.truncated) reasons.push("testo_troncato");
    return ok({
      text,
      pages,
      letters,
      nonPrintableRatio: ratio,
      glyphs,
      undecodableGlyphs: undecodable,
      imagePagesWithoutText,
      lowText: reasons.length > 0,
      reasons,
      truncated: extractor.sink.truncated,
    });
  } catch (error) {
    if (error instanceof PdfError) return fail(error.code, PDF_MESSAGES[error.code]);
    if (error instanceof RangeError) return fail("pdf_troppo_grande", PDF_MESSAGES.pdf_troppo_grande);
    throw error;
  }
}
