/**
 * Archivio dei file dei casi d'uso (PIANO §6.1, §6.6): `put`, `read`,
 * `stream`, `head`, `delete`, `list` su due zone separate.
 *
 * | zona      | archivio                                                        |
 * |-----------|-----------------------------------------------------------------|
 * | standard  | Vercel Blob privato (`BLOB_READ_WRITE_TOKEN`)                    |
 * | personale | Vercel Blob separato (`UC_PERSONAL_BLOB_READ_WRITE_TOKEN`)       |
 * | entrambe  | cartella locale `UC_LOCAL_STORAGE_DIR`, solo senza `VERCEL`      |
 *
 * Con `UC_LOCAL_STORAGE_DIR` impostata e fuori da Vercel la cartella locale
 * vince sempre (il harness non deve mai scrivere su uno store vero, anche se
 * per sbaglio trova un token). Senza archivio la zona è «non configurata» e il
 * caricamento è spento.
 *
 * Percorsi: solo quelli di `ucBlobPath` (`uc/q|s|p/<ws>/<caso>/<uuid>`), mai il
 * nome del file. La zona standard accetta `q` (quarantena) e `s`; la personale
 * solo `p` (buste cifrate `.enc`): un percorso della zona sbagliata è un errore.
 * Gli oggetti sono sempre privati, senza suffisso casuale.
 *
 * I/O: escluso dai test puri, ma senza import dell'app (`@/…`): lo usano i
 * comandi in `queries/uc-files.ts` e gli script. `@vercel/blob` si carica solo
 * quando serve.
 */
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { isUcBlobPath, type BlobArea } from "./files/filename.ts";
import type { StorageZone } from "./vocab.ts";

export type UcStorageBackend = "blob" | "locale";

/** Variabili lette dall'archivio (il chiamante passa `process.env`). */
export interface UcStorageEnv {
  readonly [name: string]: string | undefined;
  VERCEL?: string;
  UC_LOCAL_STORAGE_DIR?: string;
  BLOB_READ_WRITE_TOKEN?: string;
  UC_PERSONAL_BLOB_READ_WRITE_TOKEN?: string;
}

export interface StoredObjectInfo {
  path: string;
  size: number;
  uploadedAt: Date;
}

export interface UcObjectStore {
  readonly zone: StorageZone;
  readonly backend: UcStorageBackend;
  /** Scrive l'oggetto (privato). `overwrite` di default vero: i percorsi sono legati all'id del file. */
  put(path: string, data: Uint8Array, opts?: { contentType?: string; overwrite?: boolean }): Promise<void>;
  /** Legge tutto l'oggetto; null se manca; errore oltre `maxBytes`. */
  read(path: string, maxBytes: number): Promise<Uint8Array | null>;
  /** Flusso dell'oggetto per il download; null se manca. */
  stream(path: string): Promise<{ stream: ReadableStream<Uint8Array>; size: number | null } | null>;
  head(path: string): Promise<StoredObjectInfo | null>;
  /** Cancella gli oggetti; quelli già assenti non sono un errore. */
  delete(paths: readonly string[]): Promise<void>;
  /** Oggetti sotto un prefisso uc (es. `uc/q/`), al massimo `limit`. */
  list(prefix: string, limit?: number): Promise<StoredObjectInfo[]>;
}

const AREAS_BY_ZONE: Readonly<Record<StorageZone, readonly BlobArea[]>> = {
  standard: ["quarantena", "standard"],
  personale: ["personale"],
};

/** Il percorso è della zona (quarantena e standard nello store standard, `p` nello store personale). */
export function pathBelongsToZone(path: string, zone: StorageZone): boolean {
  return AREAS_BY_ZONE[zone].some((area) => isUcBlobPath(path, area));
}

function assertPath(path: string, zone: StorageZone): void {
  if (typeof path !== "string" || !pathBelongsToZone(path, zone)) throw new Error("Percorso di archivio non valido per la zona");
}

/** Prefissi ammessi per l'elenco: `uc/q/`, `uc/s/`, `uc/p/` più eventuali uuid validi. */
function assertPrefix(prefix: string, zone: StorageZone): void {
  const m = /^uc\/([qsp])\/((?:[0-9a-f-]{36}\/){0,2})$/.exec(prefix);
  if (!m) throw new Error("Prefisso di archivio non valido");
  const allowed = zone === "standard" ? ["q", "s"] : ["p"];
  if (!allowed.includes(m[1])) throw new Error("Prefisso di archivio non valido per la zona");
}

/** Configurazione dell'archivio di ogni zona, senza I/O. */
export function storageConfig(env: UcStorageEnv): Record<StorageZone, UcStorageBackend | null> {
  const localDir = env.UC_LOCAL_STORAGE_DIR?.trim();
  if (localDir && !env.VERCEL) return { standard: "locale", personale: "locale" };
  return {
    standard: env.BLOB_READ_WRITE_TOKEN?.trim() ? "blob" : null,
    personale: env.UC_PERSONAL_BLOB_READ_WRITE_TOKEN?.trim() ? "blob" : null,
  };
}

/** La zona ha un archivio configurato. */
export function storeConfigured(zone: StorageZone, env: UcStorageEnv): boolean {
  return storageConfig(env)[zone] !== null;
}

/** Caricamento diretto dal browser su Vercel Blob: solo zona standard con Blob (mai sul harness). */
export function clientUploadAvailable(env: UcStorageEnv): boolean {
  return storageConfig(env).standard === "blob";
}

// ── Cartella locale (harness) ─────────────────────────────────────────

function localStore(zone: StorageZone, rootDir: string): UcObjectStore {
  const root = join(rootDir, zone === "standard" ? "standard" : "personale");
  const file = (path: string) => {
    assertPath(path, zone);
    const full = join(root, ...path.split("/"));
    const rel = relative(root, full);
    if (!rel || rel.startsWith("..") || rel.split(sep).includes("..")) throw new Error("Percorso di archivio non valido");
    return full;
  };
  const missing = (error: unknown) => (error as { code?: string } | null)?.code === "ENOENT";
  return {
    zone,
    backend: "locale",
    async put(path, data, opts = {}) {
      const target = file(path);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      if (opts.overwrite === false) {
        try {
          await stat(target);
          throw new Error("L'oggetto esiste già");
        } catch (error) {
          if (!missing(error)) throw error;
        }
      }
      const tmp = `${target}.${randomUUID()}.tmp`;
      await writeFile(tmp, data, { mode: 0o600 });
      await rename(tmp, target);
    },
    async read(path, maxBytes) {
      const target = file(path);
      try {
        const info = await stat(target);
        if (info.size > maxBytes) throw new Error("Oggetto più grande del limite");
        return new Uint8Array(await readFile(target));
      } catch (error) {
        if (missing(error)) return null;
        throw error;
      }
    },
    async stream(path) {
      const target = file(path);
      try {
        const info = await stat(target);
        const stream = Readable.toWeb(createReadStream(target)) as unknown as ReadableStream<Uint8Array>;
        return { stream, size: info.size };
      } catch (error) {
        if (missing(error)) return null;
        throw error;
      }
    },
    async head(path) {
      try {
        const info = await stat(file(path));
        return { path, size: info.size, uploadedAt: info.mtime };
      } catch (error) {
        if (missing(error)) return null;
        throw error;
      }
    },
    async delete(paths) {
      for (const p of paths) await rm(file(p), { force: true });
    },
    async list(prefix, limit = 1000) {
      assertPrefix(prefix, zone);
      const out: StoredObjectInfo[] = [];
      const base = join(root, ...prefix.split("/").filter(Boolean));
      const walk = async (dir: string): Promise<void> => {
        let entries: import("node:fs").Dirent[];
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch (error) {
          if (missing(error)) return;
          throw error;
        }
        for (const e of entries) {
          if (out.length >= limit) return;
          const full = join(dir, e.name);
          if (e.isDirectory()) {
            await walk(full);
            continue;
          }
          const path = relative(root, full).split(sep).join("/");
          if (!pathBelongsToZone(path, zone)) continue;
          const info = await stat(full);
          out.push({ path, size: info.size, uploadedAt: info.mtime });
        }
      };
      await walk(base);
      return out;
    },
  };
}

// ── Vercel Blob ───────────────────────────────────────────────────────

type BlobModule = typeof import("@vercel/blob");
let blobModule: Promise<BlobModule> | null = null;
function blob(): Promise<BlobModule> {
  blobModule ??= import("@vercel/blob");
  return blobModule;
}

function isBlobNotFound(error: unknown): boolean {
  return error instanceof Error && (error.name === "BlobNotFoundError" || /not found/i.test(error.message));
}

async function readAll(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Oggetto più grande del limite");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function blobStore(zone: StorageZone, token: string): UcObjectStore {
  return {
    zone,
    backend: "blob",
    async put(path, data, opts = {}) {
      assertPath(path, zone);
      const { put } = await blob();
      await put(path, Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: opts.overwrite !== false,
        contentType: opts.contentType ?? "application/octet-stream",
        token,
      });
    },
    async read(path, maxBytes) {
      assertPath(path, zone);
      const { get } = await blob();
      const result = await get(path, { access: "private", useCache: false, token });
      if (!result || result.statusCode !== 200) return null;
      if (result.blob.size > maxBytes) {
        await result.stream.cancel().catch(() => undefined);
        throw new Error("Oggetto più grande del limite");
      }
      return readAll(result.stream, maxBytes);
    },
    async stream(path) {
      assertPath(path, zone);
      const { get } = await blob();
      const result = await get(path, { access: "private", useCache: false, token });
      if (!result || result.statusCode !== 200) return null;
      return { stream: result.stream, size: result.blob.size };
    },
    async head(path) {
      assertPath(path, zone);
      const { head } = await blob();
      try {
        const info = await head(path, { token });
        return { path, size: info.size, uploadedAt: info.uploadedAt };
      } catch (error) {
        if (isBlobNotFound(error)) return null;
        throw error;
      }
    },
    async delete(paths) {
      if (paths.length === 0) return;
      for (const p of paths) assertPath(p, zone);
      const { del } = await blob();
      for (let i = 0; i < paths.length; i += 500) await del(paths.slice(i, i + 500), { token });
    },
    async list(prefix, limit = 1000) {
      assertPrefix(prefix, zone);
      const { list } = await blob();
      const out: StoredObjectInfo[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix, cursor, limit: Math.min(1000, limit - out.length), token });
        for (const b of page.blobs) if (pathBelongsToZone(b.pathname, zone)) out.push({ path: b.pathname, size: b.size, uploadedAt: b.uploadedAt });
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor && out.length < limit);
      return out;
    },
  };
}

/** Archivio della zona, oppure null se non è configurato («Archivio file non configurato»). */
export function ucStore(zone: StorageZone, env: UcStorageEnv): UcObjectStore | null {
  const backend = storageConfig(env)[zone];
  if (backend === "locale") return localStore(zone, env.UC_LOCAL_STORAGE_DIR!.trim());
  if (backend === "blob") {
    const token = (zone === "standard" ? env.BLOB_READ_WRITE_TOKEN : env.UC_PERSONAL_BLOB_READ_WRITE_TOKEN)!.trim();
    return blobStore(zone, token);
  }
  return null;
}

/**
 * Token per il caricamento diretto dal browser (modalità client-Blob, §6.2):
 * solo quel percorso esatto della quarantena, senza suffisso né sovrascrittura,
 * tipi ammessi e dimensione massima, valido 10 minuti.
 */
export async function clientUploadToken(
  env: UcStorageEnv,
  i: { pathname: string; maxBytes: number; allowedContentTypes: readonly string[]; validForMs?: number; now?: Date },
): Promise<string> {
  if (!clientUploadAvailable(env)) throw new Error("Caricamento diretto non disponibile");
  if (!isUcBlobPath(i.pathname, "quarantena")) throw new Error("Percorso di quarantena non valido");
  const { generateClientTokenFromReadWriteToken } = await import("@vercel/blob/client");
  return generateClientTokenFromReadWriteToken({
    token: env.BLOB_READ_WRITE_TOKEN!.trim(),
    pathname: i.pathname,
    maximumSizeInBytes: i.maxBytes,
    allowedContentTypes: [...i.allowedContentTypes],
    validUntil: (i.now ?? new Date()).getTime() + (i.validForMs ?? 10 * 60_000),
    addRandomSuffix: false,
    allowOverwrite: false,
  });
}

/**
 * Cancella oggetti uc dei due archivi (es. alla cancellazione del workspace).
 * Gli errori si registrano senza percorsi e non fermano il resto.
 */
export async function deleteUcObjects(groups: Partial<Record<StorageZone, readonly string[]>>, env: UcStorageEnv): Promise<{ deleted: number; failed: number }> {
  let deleted = 0;
  let failed = 0;
  for (const zone of ["standard", "personale"] as const) {
    const paths = (groups[zone] ?? []).filter((p) => pathBelongsToZone(p, zone));
    if (paths.length === 0) continue;
    const store = ucStore(zone, env);
    if (!store) {
      failed += paths.length;
      continue;
    }
    try {
      await store.delete(paths);
      deleted += paths.length;
    } catch (error) {
      failed += paths.length;
      console.error("[uc] cancellazione dei file non riuscita", zone, error instanceof Error ? error.name : "errore");
    }
  }
  return { deleted, failed };
}
