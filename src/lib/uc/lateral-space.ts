/**
 * Chi è Lateral Space (PIANO §3.3, D36): un utente con email **verificata** in
 * uno dei domini di `UC_LS_EMAIL_DOMAINS`. Confronto esatto, in minuscolo, senza
 * sottodomini impliciti. Senza la variabile nessuno è Lateral Space e la
 * sezione resta in sola lettura.
 *
 * Modulo puro: la lettura dell'ambiente e del database sta in
 * `src/lib/db/queries/uc-access.ts`.
 */
import type { UserContext } from "./types.ts";
import { CLIENT_CASE_ROLES, LS_CASE_ROLES, type CaseRole } from "./vocab.ts";

const DOMAIN = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Elenco dei domini da una variabile «a.it, b.com». I valori non validi si scartano. */
export function parseLsDomains(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out = new Set<string>();
  for (const part of raw.split(",")) {
    const domain = part.trim().toLowerCase().replace(/^@/, "");
    if (DOMAIN.test(domain)) out.add(domain);
  }
  return [...out];
}

/** Dominio dell'email in minuscolo, oppure null se l'indirizzo non è valido. */
export function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return null;
  const domain = trimmed.slice(at + 1);
  return DOMAIN.test(domain) ? domain : null;
}

/** Vero solo con email verificata e dominio esattamente nell'elenco. */
export function isLateralSpaceEmail(
  u: { email: string | null; emailVerified: boolean },
  lsDomains: readonly string[],
): boolean {
  if (!u.emailVerified) return false;
  const domain = emailDomain(u.email);
  return domain !== null && lsDomains.includes(domain);
}

/**
 * `users.email_verified` letto in modo prudente: vale solo una data valida, una
 * stringa non vuota (il driver può restituire il timestamp come testo) o `true`.
 * `undefined` (colonna non selezionata) e ogni altro valore contano come «non
 * verificata»: un dominio di Lateral Space senza verifica non è Lateral Space.
 */
export function isEmailVerifiedValue(value: unknown): boolean {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value === "string") return value.trim().length > 0;
  return value === true;
}

/** Contesto dell'utente per i comandi, dalla riga `users`. */
export function userContextFrom(
  row: { id: string; email: string | null; emailVerified?: Date | string | boolean | null },
  lsDomains: readonly string[],
): UserContext {
  const emailVerified = isEmailVerifiedValue(row.emailVerified);
  return {
    userId: row.id,
    emailVerified,
    emailDomain: emailDomain(row.email),
    isLateralSpace: isLateralSpaceEmail({ email: row.email, emailVerified }, lsDomains),
  };
}

/**
 * L'utente conta come persona del cliente? Email verificata e non di Lateral
 * Space. Un account con un dominio di Lateral Space ma senza verifica non è
 * Lateral Space (D36) e non è nemmeno cliente: altrimenti potrebbe firmare al
 * posto del cliente (D16). Con `lsDomains` si ricontrolla anche il dominio.
 */
export function isClientUser(user: Pick<UserContext, "isLateralSpace" | "emailVerified" | "emailDomain">, lsDomains?: readonly string[]): boolean {
  if (user.isLateralSpace || user.emailVerified !== true) return false;
  return !(lsDomains && user.emailDomain && lsDomains.includes(user.emailDomain));
}

/**
 * Un ruolo di caso vale per questo utente? I ruoli `ls_*` solo per utenti
 * Lateral Space, `owner_cliente`, `approvatore_privacy` e `ai_board` solo per le
 * persone del cliente con email verificata (`isClientUser`), `osservatore` per
 * entrambi. Si ricalcola a ogni comando e a ogni firma: un dominio tolto
 * dall'elenco annulla subito i ruoli `ls_*`.
 */
export function caseRoleAllowedFor(
  user: Pick<UserContext, "isLateralSpace" | "emailVerified" | "emailDomain">,
  role: CaseRole,
  lsDomains?: readonly string[],
): boolean {
  if ((LS_CASE_ROLES as readonly string[]).includes(role)) return user.isLateralSpace;
  if ((CLIENT_CASE_ROLES as readonly string[]).includes(role)) return isClientUser(user, lsDomains);
  return true;
}
