/**
 * Link dei referenti e impronte con chiave (PIANO §3.11, D13; spec privacy 12 e 15).
 *
 * - Link `ucr_…`: 24 byte casuali in base64url, come `createInviteToken` ma con
 *   un prefisso proprio. In banca dati va solo l'impronta sha256
 *   (`hashInviteToken`, `uc_request_tokens.token_hash`) e il prefisso di 12
 *   caratteri. Il token in chiaro esiste solo nell'email o nella risposta di
 *   «Copia link»: **nessuna funzione qui lo ricostruisce** da un segreto, da un
 *   nonce o dal database. Se si perde, se ne emette uno nuovo.
 * - `UC_SECRET` serve solo alle impronte con chiave: hash degli IP negli eventi
 *   e pseudonimi. Le sottochiavi si derivano con HKDF-SHA256, una per uso.
 *   Senza segreto non c'è impronta: `null`, mai un hash semplice (che si
 *   inverte provando tutti gli IP o tutti i nomi).
 *
 * Modulo puro: nessun accesso a rete o database, nessuna lettura dell'ambiente
 * (il chiamante passa `process.env.UC_SECRET`).
 */
import { createHmac, hkdfSync, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { hashInviteToken } from "../ai-readiness/token.ts";
import { UUID } from "./ids.ts";

// ── Link dei referenti ────────────────────────────────────────────────

export const REQUEST_TOKEN_PREFIX = "ucr_";
/** Byte casuali del token: 24 byte = 192 bit = 32 caratteri base64url. */
export const REQUEST_TOKEN_BYTES = 24;
/** Lunghezza di `uc_request_tokens.token_prefix` (`ucr_` + 8 caratteri). */
export const REQUEST_TOKEN_PREFIX_LENGTH = 12;

const REQUEST_TOKEN_PATTERN = /^ucr_[A-Za-z0-9_-]{32}$/;

export interface IssuedRequestToken {
  /** Il token in chiaro: solo nell'email o nella risposta di «Copia link». Mai in DB, log o eventi. */
  readonly token: string;
  /** sha256 esadecimale (64 caratteri): l'unica forma che si salva. */
  readonly hash: string;
  /** Primi 12 caratteri, per riconoscere il link nell'interfaccia senza poterlo usare. */
  readonly prefix: string;
}

/**
 * Emette un token nuovo. Non prende argomenti: ogni invio, promemoria, copia o
 * delega ha il suo token casuale, indipendente da tutto il resto.
 */
export function newRequestToken(): IssuedRequestToken {
  const token = `${REQUEST_TOKEN_PREFIX}${randomBytes(REQUEST_TOKEN_BYTES).toString("base64url")}`;
  return Object.freeze({ token, hash: hashRequestToken(token), prefix: requestTokenPrefix(token) });
}

/**
 * Il valore ha la forma di un link dei referenti? Si controlla prima di ogni
 * lettura dal database: la spazzatura sull'URL pubblico non arriva alla query.
 */
export function looksLikeRequestToken(value: unknown): value is string {
  return typeof value === "string" && REQUEST_TOKEN_PATTERN.test(value);
}

/** Impronta salvata in `uc_request_tokens.token_hash`: la stessa di `hashInviteToken`. */
export function hashRequestToken(token: string): string {
  if (!looksLikeRequestToken(token)) throw new Error("Token del referente non valido");
  return hashInviteToken(token);
}

/** Prefisso mostrabile (`uc_request_tokens.token_prefix`). */
export function requestTokenPrefix(token: string): string {
  if (!looksLikeRequestToken(token)) throw new Error("Token del referente non valido");
  return token.slice(0, REQUEST_TOKEN_PREFIX_LENGTH);
}

/** Percorso pubblico del link, dal token in chiaro. */
export function requestLinkPath(token: string): string {
  if (!looksLikeRequestToken(token)) throw new Error("Token del referente non valido");
  return `/r/${token}`;
}

// ── Sottochiavi da UC_SECRET ──────────────────────────────────────────

export const UC_KEY_PURPOSES = ["ip", "pseudonym"] as const;
export type UcKeyPurpose = (typeof UC_KEY_PURPOSES)[number];

/**
 * Lunghezza minima di `UC_SECRET` (AMBIENTE.md: `openssl rand -base64 32`, 44
 * caratteri). Un valore più corto si tratta come assente: niente impronte
 * finché non si configura un segreto vero.
 */
export const UC_SECRET_MIN_LENGTH = 32;

const HKDF_SALT = "unbundle.uc.secret.v1";

/**
 * Sottochiave da 32 byte per un uso preciso (HKDF-SHA256, `info` =
 * `uc-<uso>-v1`). Restituisce null senza segreto o con un segreto troppo corto.
 */
export function deriveSubkey(secret: string | null | undefined, purpose: UcKeyPurpose): Buffer | null {
  if (!(UC_KEY_PURPOSES as readonly string[]).includes(purpose)) throw new Error("Uso della chiave non valido");
  const trimmed = typeof secret === "string" ? secret.trim() : "";
  if (trimmed.length < UC_SECRET_MIN_LENGTH) return null;
  return Buffer.from(hkdfSync("sha256", Buffer.from(trimmed, "utf8"), HKDF_SALT, `uc-${purpose}-v1`, 32));
}

// ── Impronta degli IP ─────────────────────────────────────────────────

/** Lunghezza dell'impronta dell'IP (`uc_events.ip_hash`, `uc_answers.ip_hash`). */
export const IP_HASH_LENGTH = 32;

/**
 * Forma canonica di un indirizzo IP, oppure null se non è un IP.
 * - IPv4 con porta (`1.2.3.4:443`) → `1.2.3.4`;
 * - IPv6 tra parentesi, con zona o con porta → forma compressa minuscola;
 * - IPv4 mappato in IPv6 (`::ffff:1.2.3.4`) → `1.2.3.4`.
 */
export function normalizeIp(ip: string | null | undefined): string | null {
  if (typeof ip !== "string") return null;
  let value = ip.trim();
  if (!value || value.length > 100) return null;
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(value);
  if (bracketed) value = bracketed[1];
  const v4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(value);
  if (v4WithPort) value = v4WithPort[1];
  value = value.replace(/%[A-Za-z0-9_.-]+$/, "");
  const family = isIP(value);
  if (family === 4) return value;
  if (family !== 6) return null;
  let canonical: string;
  try {
    canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1).toLowerCase();
  } catch {
    return null;
  }
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
  if (mapped) {
    const hi = parseInt(mapped[1], 16);
    const lo = parseInt(mapped[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return canonical;
}

/**
 * Impronta dell'IP: HMAC-SHA256 con la sottochiave `ip`, esadecimale, troncata
 * a 32 caratteri. Senza chiave o con un IP non valido restituisce null: l'IP in
 * chiaro non si salva mai.
 */
export function ipHash(key: Uint8Array | null | undefined, ip: string | null | undefined): string | null {
  if (!key || key.byteLength < 32) return null;
  const normalized = normalizeIp(ip);
  if (!normalized) return null;
  return createHmac("sha256", key).update(`ip:${normalized}`).digest("hex").slice(0, IP_HASH_LENGTH);
}

/** Comodità: impronta dell'IP direttamente da `UC_SECRET`. */
export function ipHashFromSecret(secret: string | null | undefined, ip: string | null | undefined): string | null {
  return ipHash(deriveSubkey(secret, "ip"), ip);
}

// ── Pseudonimi ────────────────────────────────────────────────────────

/** Lunghezza della parte esadecimale dello pseudonimo (80 bit). */
export const PSEUDONYM_HEX_LENGTH = 20;

/**
 * Pseudonimo con chiave per workspace (spec privacy 8): HMAC-SHA256 con una
 * chiave derivata dalla sottochiave `pseudonym` e dall'id del workspace. Lo
 * stesso valore dà pseudonimi diversi in workspace diversi; senza la chiave
 * non si inverte provando i nomi. Il valore si normalizza (NFC, spazi,
 * minuscole) prima dell'impronta.
 *
 * Restituisce null senza chiave o con un valore vuoto.
 */
export function pseudonym(key: Uint8Array | null | undefined, workspaceId: string, value: string): string | null {
  if (!key || key.byteLength < 32) return null;
  if (!UUID.test(workspaceId)) throw new Error("Workspace non valido");
  const normalized = value.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) return null;
  const workspaceKey = Buffer.from(hkdfSync("sha256", key, workspaceId.toLowerCase(), "uc-pseudonym-ws-v1", 32));
  const digest = createHmac("sha256", workspaceKey).update(normalized).digest("hex");
  return `ps_${digest.slice(0, PSEUDONYM_HEX_LENGTH)}`;
}
