import { createHash, randomBytes } from "node:crypto";

/**
 * Token del link di iscrizione a una lezione.
 *
 * Alfabeto base64url: sopravvive a un incollaggio in chat, a un QR e a
 * `encodeURIComponent` senza trasformazioni. 24 byte sono 192 bit: un link non
 * si indovina, e questo conta perche' il token e' l'unica cosa che separa un
 * estraneo dalla pagina di iscrizione.
 *
 * In banca dati finisce solo l'impronta. Il valore in chiaro esiste una volta
 * sola, nella risposta che lo crea, e non viene mai ripersistito: se il
 * formatore lo perde si rigenera, non si recupera.
 */

const PREFIX = "lrn_";

export function createJoinToken() {
  return `${PREFIX}${randomBytes(24).toString("base64url")}`;
}

export function hashJoinToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Il token ha la forma attesa?
 *
 * Serve a non interrogare la banca dati per ogni spazzatura che arriva
 * sull'URL pubblico, e a non confondere un token di corso con quelli di altra
 * natura che circolano nel prodotto (`air_` per le survey).
 */
export function looksLikeJoinToken(value: unknown): value is string {
  return typeof value === "string" && /^lrn_[A-Za-z0-9_-]{32}$/.test(value);
}

/** Percorso pubblico del link, dal token in chiaro. */
export function joinPath(token: string) {
  return `/c/${encodeURIComponent(token)}`;
}
