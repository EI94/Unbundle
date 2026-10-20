/**
 * Cifratura applicativa della zona personale (PIANO §3.11, §6.6; spec privacy 6–7).
 *
 * AES-256-GCM a busta:
 * - una chiave master, `UC_PERSONAL_ZONE_KEY` (32 byte in base64), che non si
 *   inventa e non si scrive mai nel repository;
 * - una KEK per workspace derivata con HKDF-SHA256 (`info` =
 *   `uc-personal-kek-v1|<workspaceId>`);
 * - una DEK casuale per oggetto, avvolta dalla KEK.
 *
 * Formato della busta (93 byte di testata, poi il cifrato):
 *
 *     "UCZ1" | kekVersion(1) | iv_w(12) | tag_w(16) | dek_wrapped(32) | iv(12) | tag(16) | ct
 *
 * Entrambe le cifrature autenticano la testata (`UCZ1` + versione) e l'AAD
 * `workspaceId|caseId|objectId`: una busta copiata su un altro oggetto, un altro
 * caso o un altro workspace non si apre.
 *
 * Senza chiave la zona personale è chiusa: le funzioni restituiscono un esito
 * `chiave_assente` e il chiamante rifiuta file e valori personali.
 *
 * Modulo puro: nessuna lettura dell'ambiente (il chiamante passa il valore).
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { fail, ok, type Json, type Result } from "./types.ts";
import { UUID } from "./ids.ts";

export const ENVELOPE_MAGIC = "UCZ1";
/** Versione corrente della KEK. La rotazione non è nell'MVP: il byte la rende possibile. */
export const CURRENT_KEK_VERSION = 1;
/** Valore di `uc_files.encryption_key_ref` per i file della zona personale. */
export const ENCRYPTION_KEY_REF = "UC_PERSONAL_ZONE_KEY/v1/hkdf";
/** Testata fissa della busta, prima del cifrato. */
export const ENVELOPE_HEADER_BYTES = 4 + 1 + 12 + 16 + 32 + 12 + 16;
/** Limite di sicurezza sul contenuto di una busta (i caricamenti server arrivano a 4 MB). */
export const ENVELOPE_MAX_PLAINTEXT_BYTES = 64 * 1024 * 1024;

const MAGIC = Buffer.from(ENVELOPE_MAGIC, "ascii");
const KEK_SALT = "unbundle.uc.personal-zone";
const KEK_INFO = "uc-personal-kek-v1";
const ALGORITHM = "aes-256-gcm";

export const ZONE_KEY_MESSAGES = {
  chiave_assente: "La zona personale è chiusa: manca la chiave di cifratura.",
  chiave_non_valida: "La chiave della zona personale non è valida: servono 32 byte in base64.",
  workspace_non_valido: "Workspace non valido.",
  busta_non_valida: "Il dato cifrato non si può aprire.",
  versione_chiave: "Il dato è cifrato con una versione della chiave che qui non è disponibile.",
  json_non_valido: "Il dato cifrato non contiene un valore valido.",
} as const;
export type ZoneKeyErrorCode = keyof typeof ZONE_KEY_MESSAGES;

function failWith<T>(code: ZoneKeyErrorCode): Result<T> {
  return fail(code, ZONE_KEY_MESSAGES[code]);
}

/** KEK di un workspace. `key` non si registra, non si serializza, non lascia il server. */
export interface WorkspaceKek {
  readonly version: number;
  readonly workspaceId: string;
  readonly key: Buffer;
}

/**
 * Legge `UC_PERSONAL_ZONE_KEY`: esattamente 32 byte in base64 (standard o
 * base64url, con o senza `=`). Un valore vuoto è «chiave assente»; un valore
 * malformato o banale (tutti i byte uguali) è «chiave non valida».
 */
export function parsePersonalZoneKey(raw: string | null | undefined): Result<Buffer> {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return failWith("chiave_assente");
  if (!/^[A-Za-z0-9+/]{43}=?$/.test(value) && !/^[A-Za-z0-9_-]{43}=?$/.test(value)) return failWith("chiave_non_valida");
  const bytes = Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (bytes.byteLength !== 32) return failWith("chiave_non_valida");
  if (bytes.every((b) => b === bytes[0])) return failWith("chiave_non_valida");
  return ok(bytes);
}

/** Vero se la chiave della zona personale è configurata e valida. */
export function personalZoneKeyConfigured(raw: string | null | undefined): boolean {
  return parsePersonalZoneKey(raw).ok;
}

/**
 * KEK del workspace: HKDF-SHA256 dalla chiave master, con l'id del workspace
 * nell'`info`. Workspace diversi hanno KEK diverse.
 */
export function deriveWorkspaceKek(masterB64: string | null | undefined, workspaceId: string): Result<WorkspaceKek> {
  const master = parsePersonalZoneKey(masterB64);
  if (!master.ok) return master;
  if (typeof workspaceId !== "string" || !UUID.test(workspaceId)) return failWith("workspace_non_valido");
  const ws = workspaceId.toLowerCase();
  const key = Buffer.from(hkdfSync("sha256", master.value, KEK_SALT, `${KEK_INFO}|${ws}`, 32));
  master.value.fill(0);
  return ok(Object.freeze({ version: CURRENT_KEK_VERSION, workspaceId: ws, key }));
}

/** AAD della busta: `workspaceId|caseId|objectId`, in minuscolo. Solo uuid. */
export function envelopeAad(parts: { workspaceId: string; caseId: string; objectId: string }): string {
  const values = [parts.workspaceId, parts.caseId, parts.objectId];
  for (const value of values) {
    if (typeof value !== "string" || !UUID.test(value)) throw new Error("AAD della busta non valida");
  }
  return values.map((v) => v.toLowerCase()).join("|");
}

function assertKek(kek: WorkspaceKek): void {
  if (!kek || !Buffer.isBuffer(kek.key) || kek.key.byteLength !== 32) throw new Error("KEK non valida");
  if (!Number.isInteger(kek.version) || kek.version < 1 || kek.version > 255) throw new Error("Versione della KEK non valida");
}

function associatedData(version: number, aad: string): Buffer {
  if (typeof aad !== "string" || aad.length === 0 || aad.length > 512) throw new Error("AAD della busta non valida");
  return Buffer.concat([MAGIC, Buffer.from([version]), Buffer.from(aad, "utf8")]);
}

function toBytes(plaintext: Uint8Array | string): Buffer {
  return typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : Buffer.from(plaintext);
}

/** Cifra `plaintext` in una busta legata a `aad` (usa `envelopeAad`). */
export function sealEnvelope(kek: WorkspaceKek, plaintext: Uint8Array | string, aad: string): Buffer {
  assertKek(kek);
  const data = toBytes(plaintext);
  if (data.byteLength > ENVELOPE_MAX_PLAINTEXT_BYTES) throw new Error("Contenuto troppo grande per la busta");
  const ad = associatedData(kek.version, aad);
  const dek = randomBytes(32);
  try {
    const ivWrap = randomBytes(12);
    const wrap = createCipheriv(ALGORITHM, kek.key, ivWrap);
    wrap.setAAD(ad);
    const dekWrapped = Buffer.concat([wrap.update(dek), wrap.final()]);
    const tagWrap = wrap.getAuthTag();

    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, dek, iv);
    cipher.setAAD(ad);
    const ct = Buffer.concat([cipher.update(data), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([MAGIC, Buffer.from([kek.version]), ivWrap, tagWrap, dekWrapped, iv, tag, ct]);
  } finally {
    dek.fill(0);
  }
}

/** Vero se i byte iniziano come una busta della zona personale. */
export function isEnvelope(bytes: Uint8Array | null | undefined): boolean {
  if (!bytes || bytes.byteLength < ENVELOPE_HEADER_BYTES) return false;
  return Buffer.from(bytes.buffer, bytes.byteOffset, 4).equals(MAGIC);
}

/** Versione della KEK scritta nella busta, oppure null se non è una busta. */
export function envelopeKekVersion(bytes: Uint8Array | null | undefined): number | null {
  return bytes && isEnvelope(bytes) ? bytes[4] : null;
}

/**
 * Apre una busta. Una KEK, un AAD o un byte sbagliati danno `busta_non_valida`
 * (GCM rileva ogni alterazione); una versione diversa dalla KEK data dà
 * `versione_chiave`.
 */
export function openEnvelope(kek: WorkspaceKek, sealed: Uint8Array, aad: string): Result<Buffer> {
  assertKek(kek);
  if (!isEnvelope(sealed)) return failWith("busta_non_valida");
  const buf = Buffer.from(sealed.buffer, sealed.byteOffset, sealed.byteLength);
  const version = buf[4];
  if (version !== kek.version) return failWith("versione_chiave");
  const ad = associatedData(version, aad);
  let offset = 5;
  const take = (n: number) => {
    const part = buf.subarray(offset, offset + n);
    offset += n;
    return part;
  };
  const ivWrap = take(12);
  const tagWrap = take(16);
  const dekWrapped = take(32);
  const iv = take(12);
  const tag = take(16);
  const ct = buf.subarray(offset);
  let dek: Buffer | null = null;
  try {
    const unwrap = createDecipheriv(ALGORITHM, kek.key, ivWrap);
    unwrap.setAAD(ad);
    unwrap.setAuthTag(tagWrap);
    dek = Buffer.concat([unwrap.update(dekWrapped), unwrap.final()]);
    const decipher = createDecipheriv(ALGORITHM, dek, iv);
    decipher.setAAD(ad);
    decipher.setAuthTag(tag);
    return ok(Buffer.concat([decipher.update(ct), decipher.final()]));
  } catch {
    return failWith("busta_non_valida");
  } finally {
    dek?.fill(0);
  }
}

/** Cifra un valore JSON (es. `uc_answers.value_encrypted`). */
export function sealJson(kek: WorkspaceKek, value: Json, aad: string): Buffer {
  return sealEnvelope(kek, JSON.stringify(value), aad);
}

/** Apre un valore JSON cifrato con `sealJson`. */
export function openJson(kek: WorkspaceKek, sealed: Uint8Array, aad: string): Result<Json> {
  const opened = openEnvelope(kek, sealed, aad);
  if (!opened.ok) return opened;
  try {
    return ok(JSON.parse(opened.value.toString("utf8")) as Json);
  } catch {
    return failWith("json_non_valido");
  } finally {
    opened.value.fill(0);
  }
}
