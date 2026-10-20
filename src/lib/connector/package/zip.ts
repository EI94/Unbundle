/**
 * Zip minimo per i pacchetti della skill e del plugin (prompt WP9, pacchetto K9).
 *
 * Scrive archivi zip standard (metodo deflate, nomi UTF-8, nessuna cifratura, niente
 * zip64) in modo deterministico: voci in ordine, data fissa, permessi fissi. Lo stesso
 * contenuto dà sempre gli stessi byte, così due pacchetti si confrontano con un hash.
 * `readZip` rilegge un archivio (anche scritto da altri strumenti, purché senza zip64 né
 * cifratura) e controlla il CRC di ogni voce: lo script dei pacchetti lo usa per
 * verificare gli zip appena scritti, i test per controllarne il contenuto.
 *
 * Nessuna dipendenza esterna: solo `node:zlib` (`deflateRawSync`, `inflateRawSync`, `crc32`).
 */
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

export interface ZipInputEntry {
  /** Percorso con `/`; una cartella finisce con `/` e non ha contenuto. */
  path: string;
  data?: Buffer | string;
}

export interface ZipEntry {
  path: string;
  isDirectory: boolean;
  data: Buffer;
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;
const UTF8_FLAG = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const VERSION_NEEDED = 20;
/** «Creato da» Unix (3) con la versione 2.0: così i permessi negli attributi esterni valgono. */
const VERSION_MADE_BY = (3 << 8) | VERSION_NEEDED;
const FILE_MODE = 0o100644;
const DIR_MODE = 0o040755;
const MSDOS_DIRECTORY = 0x10;
const MAX_ENTRIES = 0xffff;
const MAX_SIZE = 0xffffffff;

/** Data fissa delle voci (ora DOS, senza fuso): 1 gennaio 2026, 00:00. */
const FIXED_DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
const FIXED_DOS_TIME = 0;

const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\\0]+$/;

function checkPath(path: string): void {
  if (!SAFE_PATH.test(path) || path.includes("//")) throw new Error(`Percorso non ammesso nello zip: ${JSON.stringify(path)}`);
}

/**
 * Crea un archivio zip. Le voci si ordinano per percorso; una cartella mancante si
 * aggiunge da sola prima dei suoi file (come fa `zip -r`).
 */
export function createZip(input: readonly ZipInputEntry[]): Buffer {
  const byPath = new Map<string, Buffer | null>();
  for (const entry of input) {
    checkPath(entry.path);
    const isDirectory = entry.path.endsWith("/");
    if (isDirectory && entry.data !== undefined && Buffer.byteLength(entry.data) > 0) {
      throw new Error(`Una cartella non ha contenuto: ${entry.path}`);
    }
    if (byPath.has(entry.path)) throw new Error(`Voce ripetuta nello zip: ${entry.path}`);
    byPath.set(entry.path, isDirectory ? null : Buffer.from(entry.data ?? ""));
  }
  for (const path of [...byPath.keys()]) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i += 1) {
      const dir = `${parts.slice(0, i).join("/")}/`;
      if (dir !== path && !byPath.has(dir)) byPath.set(dir, null);
    }
  }
  const paths = [...byPath.keys()].sort();
  if (paths.length > MAX_ENTRIES) throw new Error("Troppe voci per uno zip senza zip64.");

  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const path of paths) {
    const content = byPath.get(path) ?? null;
    const isDirectory = content === null;
    const name = Buffer.from(path, "utf8");
    const raw = content ?? Buffer.alloc(0);
    const method = raw.length === 0 ? METHOD_STORE : METHOD_DEFLATE;
    const stored = method === METHOD_DEFLATE ? deflateRawSync(raw, { level: 9 }) : raw;
    const crc = raw.length === 0 ? 0 : crc32(raw);
    if (raw.length > MAX_SIZE || stored.length > MAX_SIZE || offset > MAX_SIZE) throw new Error("Voce troppo grande per uno zip senza zip64.");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER, 0);
    local.writeUInt16LE(VERSION_NEEDED, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(FIXED_DOS_TIME, 10);
    local.writeUInt16LE(FIXED_DOS_DATE, 12);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, stored);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_HEADER, 0);
    central.writeUInt16LE(VERSION_MADE_BY, 4);
    central.writeUInt16LE(VERSION_NEEDED, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(FIXED_DOS_TIME, 12);
    central.writeUInt16LE(FIXED_DOS_DATE, 14);
    central.writeUInt32LE(crc >>> 0, 16);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    const attributes = isDirectory ? ((DIR_MODE << 16) | MSDOS_DIRECTORY) >>> 0 : (FILE_MODE << 16) >>> 0;
    central.writeUInt32LE(attributes, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + stored.length;
  }

  const centralSize = centrals.reduce((sum, b) => sum + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(paths.length, 8);
  end.writeUInt16LE(paths.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, end]);
}

function findEndOfCentral(buf: Buffer): number {
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === END_OF_CENTRAL) return i;
  }
  throw new Error("Zip non valido: manca la fine della directory centrale.");
}

/** Rilegge un archivio zip (senza zip64 né cifratura) e controlla il CRC di ogni voce. */
export function readZip(buf: Buffer): ZipEntry[] {
  if (buf.length < 22) throw new Error("Zip non valido: troppo corto.");
  const end = findEndOfCentral(buf);
  const count = buf.readUInt16LE(end + 10);
  const centralOffset = buf.readUInt32LE(end + 16);
  const entries: ZipEntry[] = [];
  let p = centralOffset;
  for (let i = 0; i < count; i += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL_HEADER) throw new Error("Zip non valido: directory centrale rovinata.");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLength = buf.readUInt16LE(p + 28);
    const extraLength = buf.readUInt16LE(p + 30);
    const commentLength = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const path = buf.subarray(p + 46, p + 46 + nameLength).toString(flags & UTF8_FLAG ? "utf8" : "latin1");
    p += 46 + nameLength + extraLength + commentLength;

    if (flags & 0x1) throw new Error(`Voce cifrata non ammessa: ${path}`);
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOCAL_HEADER) throw new Error(`Zip non valido: intestazione locale di ${path}.`);
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const stored = buf.subarray(dataStart, dataStart + compressedSize);
    if (stored.length !== compressedSize) throw new Error(`Zip non valido: dati troncati di ${path}.`);
    let data: Buffer;
    if (method === METHOD_STORE) data = Buffer.from(stored);
    else if (method === METHOD_DEFLATE) data = inflateRawSync(stored);
    else throw new Error(`Metodo di compressione non ammesso (${method}): ${path}`);
    if (data.length !== size) throw new Error(`Zip non valido: dimensione di ${path}.`);
    if ((size === 0 ? 0 : crc32(data)) >>> 0 !== crc >>> 0) throw new Error(`Zip non valido: CRC di ${path}.`);
    entries.push({ path, isDirectory: path.endsWith("/"), data });
  }
  return entries;
}
