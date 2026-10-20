/**
 * Nomi di file sicuri e percorsi di archivio (PIANO §6.1).
 *
 * - `safeFileName`: il nome mostrato e salvato in `uc_files.file_name`. NFC,
 *   solo la parte finale (niente cartelle), niente caratteri di controllo o di
 *   direzione del testo, niente caratteri riservati di Windows, al massimo 255
 *   caratteri conservando l'estensione. Non entra mai in un percorso.
 * - `ucBlobPath`: il percorso nell'archivio, fatto solo di uuid:
 *   `uc/q|s|p/<workspace>/<caso>/<uuid>` (`.enc` per la zona personale).
 *
 * Modulo puro.
 */
import { UUID } from "../ids.ts";

export const MAX_FILE_NAME_LENGTH = 255;
const MAX_EXTENSION_LENGTH = 16;

const RESERVED_WINDOWS = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
/**
 * Controlli (C0, DEL, C1), marcatori e override di direzione, caratteri a
 * larghezza zero, BOM, separatori di riga e di paragrafo. Costruito da codici
 * numerici: nessun carattere invisibile nel sorgente.
 */
const INVISIBLE_RANGES: readonly (readonly [number, number])[] = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
  [0xfff9, 0xfffb],
];
const unicodeEscape = (code: number) => `\\u${code.toString(16).padStart(4, "0")}`;
const INVISIBLE = new RegExp(`[${INVISIBLE_RANGES.map(([a, b]) => `${unicodeEscape(a)}-${unicodeEscape(b)}`).join("")}]`, "g");
const RESERVED_CHARS = /[<>:"/\\|?*]/g;

/** Estensione in minuscolo, senza punto (es. `xlsx`), oppure null. */
export function fileExtension(name: string): string | null {
  const base = baseName(name).replace(/[\s.]+$/, "");
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return null;
  const ext = base.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,16}$/.test(ext) ? ext : null;
}

function baseName(name: string): string {
  const parts = name.split(/[/\\]/);
  return parts[parts.length - 1] ?? "";
}

function truncateChars(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join("");
}

/**
 * Nome di file ripulito, mai vuoto. Se dopo la pulizia non resta nulla si usa
 * `fallback` con l'estensione originale, se valida.
 */
export function safeFileName(input: string | null | undefined, fallback = "file"): string {
  const raw = typeof input === "string" ? input : "";
  let name = baseName(raw.normalize("NFC"))
    .replace(/[\t\n\r\f\v]+/g, " ")
    .replace(INVISIBLE, "")
    .replace(RESERVED_CHARS, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "");
  const ext = fileExtension(name);
  let stem = ext ? name.slice(0, name.length - ext.length - 1) : name;
  if (RESERVED_WINDOWS.test(stem)) stem = `_${stem}`;
  if (!stem.replace(/[_\s.-]/g, "")) {
    stem = fallback;
  }
  const suffix = ext && ext.length <= MAX_EXTENSION_LENGTH ? `.${ext}` : "";
  stem = truncateChars(stem, MAX_FILE_NAME_LENGTH - suffix.length).replace(/[.\s]+$/, "") || fallback;
  name = `${stem}${suffix}`;
  return name;
}

// ── Percorsi di archivio ──────────────────────────────────────────────

/** Zone di archivio: quarantena, standard, personale (cifrata). */
export const BLOB_AREAS = { quarantena: "q", standard: "s", personale: "p" } as const;
export type BlobArea = keyof typeof BLOB_AREAS;

/**
 * Percorso dell'oggetto nell'archivio. Solo uuid validati: il nome originale
 * del file non entra mai nel percorso.
 */
export function ucBlobPath(area: BlobArea, workspaceId: string, caseId: string, objectId: string): string {
  if (typeof area !== "string" || !Object.hasOwn(BLOB_AREAS, area)) throw new Error("Zona di archivio non valida");
  const code = BLOB_AREAS[area];
  for (const id of [workspaceId, caseId, objectId]) {
    if (typeof id !== "string" || !UUID.test(id)) throw new Error("Identificativo non valido nel percorso del file");
  }
  const path = `uc/${code}/${workspaceId.toLowerCase()}/${caseId.toLowerCase()}/${objectId.toLowerCase()}`;
  return area === "personale" ? `${path}.enc` : path;
}

/** Il percorso è un percorso uc ben formato (per i controlli su `head()` e cancellazioni). */
export function isUcBlobPath(path: string, area?: BlobArea): boolean {
  const match = /^uc\/([qsp])\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/([0-9a-f-]{36})(\.enc)?$/.exec(path);
  if (!match) return false;
  const [, code, ws, kase, id, enc] = match;
  if (![ws, kase, id].every((x) => UUID.test(x))) return false;
  if ((code === "p") !== (enc === ".enc")) return false;
  if (area === undefined) return true;
  return Object.hasOwn(BLOB_AREAS, area) && BLOB_AREAS[area] === code;
}
