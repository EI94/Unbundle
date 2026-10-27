/**
 * Link personali di «Chiedi al referente» (SPEC §0, §2.1): `ucq_` più 24 byte casuali in
 * base64url (192 bit). In banca dati va solo l'impronta sha256 (`use_case_referent_tokens.token_hash`,
 * la stessa di `hashInviteToken`), mai il token né un suo prefisso. Insieme si salva l'impronta
 * dell'indirizzo a cui il link è partito (`recipient_hash`): se l'email del referente cambia, il
 * vecchio link smette di valere.
 *
 * Il token in chiaro esiste solo nell'email e nell'indirizzo della pagina. Modulo puro.
 */
import { createHash, randomBytes } from "node:crypto";
import { hashInviteToken } from "../../ai-readiness/token.ts";
import { REFERENT_TOKEN_PREFIX } from "./contract.ts";

/** Byte casuali: 24 = 192 bit = 32 caratteri base64url. */
export const REFERENT_TOKEN_BYTES = 24;

const TOKEN_PATTERN = /^ucq_[A-Za-z0-9_-]{32}$/;

/** Un token nuovo e la sua impronta. Ogni email ha il suo, indipendente da tutto il resto. */
export function newReferentToken(): { readonly token: string; readonly hash: string } {
  const token = `${REFERENT_TOKEN_PREFIX}${randomBytes(REFERENT_TOKEN_BYTES).toString("base64url")}`;
  return Object.freeze({ token, hash: hashReferentToken(token) });
}

/** Ha la forma di un link di «Chiedi al referente»? Si controlla prima di ogni lettura dal database. */
export function looksLikeReferentToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

/** L'impronta salvata (sha256 esadecimale, 64 caratteri). Un valore di forma sbagliata è un errore. */
export function hashReferentToken(token: string): string {
  if (!looksLikeReferentToken(token)) throw new Error("Link del referente non valido");
  return hashInviteToken(token);
}

/** sha256 esadecimale dell'email senza spazi intorno e in minuscolo (UTF-8). */
export function recipientHash(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase(), "utf8").digest("hex");
}

/**
 * La stessa impronta in SQL, su una colonna o un'espressione fidata (es. `c.email`): deve dare lo
 * stesso valore di `recipientHash` (lo provano i test, anche sul database).
 */
export const RECIPIENT_HASH_SQL = (column: string): string => {
  if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/.test(column)) throw new Error("Colonna non valida");
  return `encode(sha256(convert_to(lower(btrim(${column})), 'UTF8')), 'hex')`;
};
