import { auth } from "@/lib/auth";
import { loginPathForMissingSession, SESSION_COOKIE_NAME } from "@/lib/auth/session-signal";
import { completeGranolaConnect, granolaAvailable } from "@/lib/db/queries/context-granola";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Un reindirizzamento che non resta in cache. */
function redirectTo(url: URL): Response {
  return new Response(null, { status: 303, headers: { Location: url.toString(), "Cache-Control": "no-store" } });
}

/**
 * Il ritorno da Granola dopo «Collega Granola» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §8.2):
 * `GET /api/granola/callback?code=…&state=…`.
 *
 * 0. Con Granola spento (§8.1): 404, come le altre rotte di Granola.
 * 1. Senza sessione: a `/login` (senza il codice nell'indirizzo).
 * 2. Lo stato vale una volta sola, e solo per chi l'ha creato: sconosciuto, scaduto, già usato o di un'altra persona →
 *    `/dashboard?granola=scaduto`, e niente altro.
 * 3. Poi alle Impostazioni del workspace da cui era partito il collegamento, all'ancora `#granola`, con
 *    `?granola=collegato`, `annullato` (`error` di Granola o codice mancante) o `errore` (i token non sono arrivati).
 * Il reindirizzamento resta sull'origine della richiesta: così il cookie della sessione e l'host restano gli stessi.
 */
export async function GET(request: Request): Promise<Response> {
  if (!granolaAvailable()) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });
  const url = new URL(request.url);
  const session = await auth();
  if (!session?.user?.id) {
    const hadCookie = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=`).test(request.headers.get("cookie") ?? "");
    return redirectTo(new URL(loginPathForMissingSession({ hadCookie }), url.origin));
  }
  const outcome = await completeGranolaConnect({
    userId: session.user.id,
    state: url.searchParams.get("state"),
    code: url.searchParams.get("code"),
    error: url.searchParams.get("error"),
  });
  if (outcome.status === "scaduto") return redirectTo(new URL("/dashboard?granola=scaduto", url.origin));
  const target = new URL(`/dashboard/${outcome.workspaceId}/settings`, url.origin);
  target.searchParams.set("granola", outcome.status);
  target.hash = "granola";
  return redirectTo(target);
}
