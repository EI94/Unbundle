/**
 * Contratto condiviso tra proxy (edge) e server per la gestione delle sessioni
 * non più valide. Nessuna dipendenza da firebase-admin: questo modulo deve
 * poter girare anche nel proxy.
 *
 * Il problema che risolve: il proxy vede solo la *presenza* del cookie
 * `__session`, non la sua validità. Un cookie presente ma scaduto/revocato
 * (utente eliminato, sessione revocata) causerebbe un redirect loop
 * /login ↔ /dashboard. Il contratto è:
 *
 * 1. cookie SCADUTO → il proxy lo riconosce da solo (claim `exp` del JWT,
 *    nessun roundtrip) e lo cancella subito;
 * 2. cookie NON scaduto ma rifiutato dal server (revoca, utente eliminato) →
 *    il server reindirizza a `/login?session=stale` e il proxy, vedendo il
 *    marker, serve il login cancellando il cookie.
 */

export const SESSION_COOKIE_NAME = "__session";
export const STALE_SESSION_PARAM = "session";
export const STALE_SESSION_VALUE = "stale";

export function loginPathForMissingSession(options: {
  hadCookie: boolean;
  callbackPath?: string | null;
}): string {
  const params = new URLSearchParams();
  if (options.hadCookie) {
    params.set(STALE_SESSION_PARAM, STALE_SESSION_VALUE);
  }
  const callback = options.callbackPath;
  if (callback && callback.startsWith("/") && !callback.startsWith("//")) {
    params.set("callbackUrl", callback);
  }
  const qs = params.toString();
  return qs ? `/login?${qs}` : "/login";
}

function decodeBase64UrlJson(segment: string): Record<string, unknown> | null {
  try {
    const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const json =
      typeof atob === "function"
        ? atob(padded)
        : Buffer.from(padded, "base64").toString("utf8");
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * True se il cookie di sessione è scaduto o malformato (da cancellare).
 * Decodifica il claim `exp` del JWT SENZA verificarne la firma: va bene solo
 * per decidere di *rimuovere* un cookie, mai per concedere accesso — la
 * verifica vera resta in `auth()` (firebase-admin, checkRevoked).
 */
export function isSessionCookieExpired(
  token: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): boolean {
  const segments = token.split(".");
  if (segments.length !== 3) return true;
  const payload = decodeBase64UrlJson(segments[1]);
  if (!payload) return true;
  const exp = payload.exp;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return true;
  return exp <= nowSeconds;
}
