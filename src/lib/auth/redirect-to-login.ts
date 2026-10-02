import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, type Session } from "@/lib/auth";
import { safeInternalCallbackUrl } from "@/lib/navigation/safe-callback-url";
import {
  loginPathForMissingSession,
  SESSION_COOKIE_NAME,
} from "./session-signal";

/**
 * Redirect canonico verso /login quando manca una sessione valida.
 * Se il browser HA ancora un cookie __session (quindi il cookie esiste ma il
 * server lo ha rifiutato: scaduto, revocato, utente eliminato) aggiunge il
 * marker `session=stale` così il proxy lo cancella — senza, il rimbalzo
 * /login → /dashboard → /login diventa un loop infinito.
 */
export async function redirectToLogin(callbackPath?: string): Promise<never> {
  const cookieStore = await cookies();
  // The proxy overwrites this header with the requested dashboard pathname.
  const callback = safeInternalCallbackUrl(
    callbackPath ?? (await headers()).get("x-unbundle-pathname")
  );
  redirect(
    loginPathForMissingSession({
      hadCookie: cookieStore.has(SESSION_COOKIE_NAME),
      callbackPath: callback,
    })
  );
}

/** Sessione valida o redirect canonico a /login. */
export async function requireSession(callbackPath?: string): Promise<Session> {
  const session = await auth();
  if (session?.user?.id) return session;
  return redirectToLogin(callbackPath);
}
